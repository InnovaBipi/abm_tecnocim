import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { config } from '../config/env';
import { getAllActiveTenants } from '../middleware/tenant';
import { decryptSecret } from '../utils/crypto';

const router = Router();

/** How long after a send an unmatched bounce/complaint is retried instead of dropped. */
const FRESH_EVENT_RETRY_MS = 2 * 60 * 1000;

/**
 * Check if a single secret matches the webhook signature.
 */
function checkSignature(secret: string, svixId: string, svixTimestamp: string, svixSignature: string, rawBody: string): boolean {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;

  const expectedSignature = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  const signatures = svixSignature.split(' ');
  for (const sig of signatures) {
    const sigValue = sig.replace(/^v1,/, '');
    try {
      if (crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(sigValue))) {
        return true;
      }
    } catch { /* length mismatch */ }
  }
  return false;
}

/**
 * Result of verifying a webhook.
 * - tenantIds: the tenants whose OWN webhook signed this event. Each per-tenant
 *   webhook (created by POST /settings/email/webhook-setup) has its own signing
 *   secret, so a match identifies the Resend webhook the event came from.
 * - null: verified by the global RESEND_WEBHOOK_SECRET (or unsigned in dev), so
 *   the source account is unknown — legacy, unscoped behaviour.
 */
export interface WebhookVerification {
  valid: boolean;
  tenantIds: string[] | null;
}

/**
 * Verify Resend/Svix webhook signature.
 * Tries the per-tenant secrets first, then the global secret.
 */
export async function verifyWebhookSignature(req: Request): Promise<WebhookVerification> {
  const svixId = req.headers['svix-id'] as string;
  const svixTimestamp = req.headers['svix-timestamp'] as string;
  const svixSignature = req.headers['svix-signature'] as string;

  if (!svixId || !svixTimestamp || !svixSignature) {
    // Only allow missing headers in development (never in production)
    return { valid: config.NODE_ENV !== 'production', tenantIds: null };
  }

  // Reject timestamps older than 5 minutes (replay protection)
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(svixTimestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > 300) {
    console.warn('Webhook timestamp too old or invalid');
    return { valid: false, tenantIds: null };
  }

  const rawBody = (req as any).rawBody || JSON.stringify(req.body);

  // Per-tenant secrets are stored encrypted at rest, so they MUST be passed
  // through decryptSecret() before use (it returns legacy plaintext unchanged).
  // The env secret is never encrypted.
  const tenantSecrets: Array<{ tenantId: string; secret: string }> = [];
  try {
    const tenants = await getAllActiveTenants();
    for (const t of tenants) {
      const ws = (t.config.email as any)?.webhook_secret;
      if (!ws) continue;
      let decrypted: string;
      try {
        decrypted = decryptSecret(ws);
      } catch {
        // Malformed/undecryptable secret for this tenant — skip it, try the rest
        continue;
      }
      if (decrypted) tenantSecrets.push({ tenantId: t.id, secret: decrypted });
    }
  } catch { /* if DB fails, continue with what we have */ }

  const globalSecret = config.RESEND_WEBHOOK_SECRET;

  // No secrets configured: fail-closed in production (never accept unsigned webhooks),
  // allow only in development to ease local testing.
  if (tenantSecrets.length === 0 && !globalSecret) {
    if (config.NODE_ENV === 'production') {
      console.warn('Webhook rejected: no signing secret configured for any tenant');
      return { valid: false, tenantIds: null };
    }
    return { valid: true, tenantIds: null };
  }

  // The global secret wins: a tenant that stored the same value must not turn
  // the global webhook's events into tenant-scoped ones.
  if (globalSecret && checkSignature(globalSecret, svixId, svixTimestamp, svixSignature, rawBody)) {
    return { valid: true, tenantIds: null };
  }

  const matched = tenantSecrets
    .filter(({ secret }) => checkSignature(secret, svixId, svixTimestamp, svixSignature, rawBody))
    .map(({ tenantId }) => tenantId);
  if (matched.length > 0) return { valid: true, tenantIds: matched };

  console.warn('Webhook signature verification failed (tried', tenantSecrets.length + (globalSecret ? 1 : 0), 'secrets)');
  return { valid: false, tenantIds: null };
}

/**
 * POST /api/webhooks/resend
 *
 * Handles Resend webhook events: delivered, opened, clicked, bounced, complained.
 * Verifies Svix webhook signature when RESEND_WEBHOOK_SECRET is configured.
 */
router.post('/resend', async (req: Request, res: Response): Promise<void> => {
  try {
    // Verify webhook signature
    const verification = await verifyWebhookSignature(req);
    if (!verification.valid) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    const { type, data } = req.body;

    if (!type || !data) {
      res.status(400).json({ error: 'Invalid webhook payload' });
      return;
    }

    const resendEmailId = data.email_id;
    const recipientEmail = Array.isArray(data.to) ? data.to[0] : data.to;

    if (!resendEmailId) {
      res.status(200).json({ received: true, skipped: 'no email_id' });
      return;
    }

    // Map Resend event types to our internal event types
    const eventTypeMap: Record<string, string> = {
      'email.sent': 'delivery_accepted',
      'email.delivered': 'delivered',
      'email.opened': 'opened',
      'email.clicked': 'clicked',
      'email.bounced': 'bounced',
      'email.complained': 'complaint',
    };

    const eventType = eventTypeMap[type];
    if (!eventType) {
      // Unknown event type - acknowledge but skip
      res.status(200).json({ received: true, skipped: `unknown type: ${type}` });
      return;
    }

    // Find the original email event by resend_email_id to get prospect/sequence/tenant context
    const originalEvents = await query<any[]>(
      `SELECT prospect_id, sequence_id, enrollment_id, step_id, tenant_id
       FROM email_events
       WHERE resend_email_id = ?
       LIMIT 1`,
      [resendEmailId]
    );

    let prospectId: string | null = null;
    let sequenceId: string | null = null;
    let enrollmentId: string | null = null;
    let stepId: string | null = null;
    let tenantId: string | null = null;

    if (originalEvents.length > 0) {
      // PREFERRED PATH: the resend_email_id uniquely identifies the original
      // send, so prospect_id + tenant_id come straight from our own record.
      // This is authoritative and never crosses tenants.
      prospectId = originalEvents[0].prospect_id;
      sequenceId = originalEvents[0].sequence_id;
      enrollmentId = originalEvents[0].enrollment_id;
      stepId = originalEvents[0].step_id;
      tenantId = originalEvents[0].tenant_id;
    } else if (verification.tenantIds !== null) {
      // Signed by a tenant's OWN webhook. Resend webhooks are account-wide, and
      // a tenant may share its Resend account with other apps (New Brokers shares
      // it with its website and client portal). An unknown resend_email_id there
      // is mail the ABM did not send: matching its recipient against prospects
      // would let portal/website bounces suppress prospects, even in another
      // tenant. So no recipient fallback for tenant webhooks. Every send path
      // records its resend_email_id today; the cost is losing late opens/clicks
      // of mail sent before that recording existed.
      //
      // Race: the email_events row is written AFTER sendEmail() returns, so a
      // fast bounce/complaint can arrive first. For a fresh one, answer 503 so
      // Svix retries (~5s later) and finds the row; losing it would mean mailing
      // a dead address again on the next step.
      const createdAt = Date.parse(data.created_at);
      const isFresh = !isNaN(createdAt) && Date.now() - createdAt < FRESH_EVENT_RETRY_MS;
      if (isFresh && (eventType === 'bounced' || eventType === 'complaint')) {
        res.status(503).json({ received: false, retry: 'send not recorded yet' });
        return;
      }
      res.status(200).json({ received: true, skipped: 'email not sent by the ABM' });
      return;
    } else {
      // FALLBACK PATH (best-effort, global secret only): no email_event matched the resend_email_id
      // (e.g. the event predates event recording). The Resend webhook is GLOBAL,
      // so this lookup intentionally cannot be scoped to a single tenant up front.
      //
      // RISK: if the same email exists as a prospect in more than one tenant we
      // could attribute the event to the wrong tenant. To bound the blast radius
      // we match the EXACT email only (no domain/fuzzy match) and take a single
      // row. The resend_email_id match above is ALWAYS preferred over this email
      // match, so this branch only runs when we have no authoritative record.
      // All downstream INSERT/UPDATE statements use the tenant_id resolved here,
      // so they stay tenant-consistent.
      // NOTE: this single SELECT is the one deliberate cross-tenant read; it is
      // safe because it only resolves which tenant owns the recipient.
      if (recipientEmail) {
        const prospects = await query<any[]>(
          'SELECT id, tenant_id FROM prospects WHERE email = ? LIMIT 1',
          [recipientEmail]
        );
        if (prospects.length > 0) {
          prospectId = prospects[0].id;
          tenantId = prospects[0].tenant_id;
        }
      }
    }

    if (!prospectId) {
      // Can't link to a prospect - acknowledge but skip
      res.status(200).json({ received: true, skipped: 'prospect not found' });
      return;
    }

    // Record the event
    await query(
      `INSERT INTO email_events (id, tenant_id, enrollment_id, prospect_id, sequence_id, step_id,
       event_type, resend_email_id, subject, link_clicked, user_agent, ip_address, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        tenantId,
        enrollmentId,
        prospectId,
        sequenceId,
        stepId,
        eventType,
        resendEmailId,
        data.subject || null,
        data.click?.link || null,
        data.click?.userAgent || null,
        data.click?.ipAddress || null,
        JSON.stringify({ raw_type: type, timestamp: data.created_at }),
      ]
    );

    // Handle specific event types with side effects
    switch (eventType) {
      case 'bounced':
        // Add to suppression list
        if (recipientEmail && tenantId) {
          await query(
            `INSERT IGNORE INTO suppression_list (id, tenant_id, email, reason, source)
             VALUES (?, ?, ?, 'bounced', 'resend_webhook')`,
            [uuidv4(), tenantId, recipientEmail]
          );
        }

        // Update prospect status and prevent re-enrollment
        await query(
          `UPDATE prospects SET status = 'bounced', email_status = 'invalid', do_not_contact = TRUE
           WHERE id = ? AND tenant_id = ? AND status NOT IN ('unsubscribed')`,
          [prospectId, tenantId]
        );

        // Stop active enrollments for this prospect
        await query(
          `UPDATE sequence_enrollments SET status = 'bounced', completed_at = NOW()
           WHERE prospect_id = ? AND tenant_id = ? AND status = 'active'`,
          [prospectId, tenantId]
        );

        // Log activity
        await query(
          `INSERT INTO prospect_activities (id, tenant_id, prospect_id, activity_type, title, description)
           VALUES (?, ?, ?, 'email_bounced', 'Email rebotado', ?)`,
          [uuidv4(), tenantId, prospectId, `El email ha rebotado. Añadido a lista de supresión.`]
        );
        break;

      case 'complaint':
        // Spam complaint - add to suppression and mark do_not_contact
        if (recipientEmail && tenantId) {
          await query(
            `INSERT IGNORE INTO suppression_list (id, tenant_id, email, reason, source)
             VALUES (?, ?, ?, 'complaint', 'resend_webhook')`,
            [uuidv4(), tenantId, recipientEmail]
          );
        }

        await query(
          `UPDATE prospects SET do_not_contact = TRUE, status = 'unsubscribed'
           WHERE id = ? AND tenant_id = ?`,
          [prospectId, tenantId]
        );

        // Stop all enrollments
        await query(
          `UPDATE sequence_enrollments SET status = 'unsubscribed', completed_at = NOW()
           WHERE prospect_id = ? AND tenant_id = ? AND status IN ('active', 'paused')`,
          [prospectId, tenantId]
        );

        await query(
          `INSERT INTO prospect_activities (id, tenant_id, prospect_id, activity_type, title, description)
           VALUES (?, ?, ?, 'spam_complaint', 'Queja de spam', ?)`,
          [uuidv4(), tenantId, prospectId, `El prospect ha marcado el email como spam. Marcado como do_not_contact.`]
        );
        break;

      case 'opened':
        // Add +3 to lead_score (capped at 100)
        await query(
          `UPDATE prospects SET lead_score = LEAST(lead_score + 3, 100) WHERE id = ? AND tenant_id = ?`,
          [prospectId, tenantId]
        );

        await query(
          `INSERT INTO prospect_activities (id, tenant_id, prospect_id, activity_type, title)
           VALUES (?, ?, ?, 'email_opened', 'Email abierto')`,
          [uuidv4(), tenantId, prospectId]
        );
        break;

      case 'clicked': {
        // Add +10 to lead_score (capped at 100)
        await query(
          `UPDATE prospects SET lead_score = LEAST(lead_score + 10, 100) WHERE id = ? AND tenant_id = ?`,
          [prospectId, tenantId]
        );

        // Check if prospect should be auto-upgraded to 'interested'
        const clickedProspects = await query<any[]>(
          'SELECT lead_score, status FROM prospects WHERE id = ? AND tenant_id = ?',
          [prospectId, tenantId]
        );
        if (clickedProspects.length > 0) {
          const p = clickedProspects[0];
          const earlyStages = ['new', 'enriched', 'qualified', 'contacted'];
          if (p.lead_score >= 70 && earlyStages.includes(p.status)) {
            await query(
              `UPDATE prospects SET status = 'interested' WHERE id = ? AND tenant_id = ?`,
              [prospectId, tenantId]
            );
            await query(
              `INSERT INTO prospect_activities (id, tenant_id, prospect_id, activity_type, title, description)
               VALUES (?, ?, ?, 'auto_qualified', 'Auto-calificado como interesado', ?)`,
              [uuidv4(), tenantId, prospectId, `Score ${p.lead_score} >= 70 tras click. Promocionado automáticamente.`]
            );
          }

          // Insert score history record (tenant-scoped)
          await query(
            `INSERT INTO prospect_score_history (id, tenant_id, prospect_id, score, score_breakdown)
             VALUES (?, ?, ?, ?, ?)`,
            [uuidv4(), tenantId, prospectId, p.lead_score, JSON.stringify({ trigger: 'email_clicked', increment: 10 })]
          );
        }

        await query(
          `INSERT INTO prospect_activities (id, tenant_id, prospect_id, activity_type, title, description)
           VALUES (?, ?, ?, 'email_clicked', 'Link clicado', ?)`,
          [uuidv4(), tenantId, prospectId, `Link: ${data.click?.link || 'unknown'}`]
        );
        break;
      }

      case 'delivered':
        // Just record - no side effects beyond the event
        break;
    }

    res.status(200).json({ received: true, event: eventType, prospect_id: prospectId });
  } catch (error: any) {
    console.error('Resend webhook error:', error.message);
    // Always return 200 to Resend to prevent retries on our errors
    res.status(200).json({ received: true, error: 'internal processing error' });
  }
});

export default router;
