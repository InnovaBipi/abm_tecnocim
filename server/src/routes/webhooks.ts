import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { config } from '../config/env';

const router = Router();

/**
 * Verify Resend/Svix webhook signature.
 * Returns true if valid (or if no secret configured - skip verification).
 */
function verifyWebhookSignature(req: Request): boolean {
  const secret = config.RESEND_WEBHOOK_SECRET;
  if (!secret) return true; // No secret configured, skip verification

  const svixId = req.headers['svix-id'] as string;
  const svixTimestamp = req.headers['svix-timestamp'] as string;
  const svixSignature = req.headers['svix-signature'] as string;

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.warn('Webhook missing svix headers');
    return false;
  }

  // Reject timestamps older than 5 minutes (replay protection)
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(svixTimestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > 300) {
    console.warn('Webhook timestamp too old or invalid');
    return false;
  }

  // Decode the secret: remove 'whsec_' prefix and base64-decode
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');

  // Construct the signed content
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;

  // Compute expected signature
  const expectedSignature = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  // The svix-signature header may contain multiple signatures (v1,xxx v1,yyy)
  const signatures = svixSignature.split(' ');
  for (const sig of signatures) {
    const sigValue = sig.replace(/^v1,/, '');
    if (crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(sigValue))) {
      return true;
    }
  }

  console.warn('Webhook signature verification failed');
  return false;
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
    if (!verifyWebhookSignature(req)) {
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
      'email.sent': 'sent',
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

    // Find the original email event by resend_email_id to get prospect/sequence context
    const originalEvents = await query<any[]>(
      `SELECT prospect_id, sequence_id, enrollment_id, step_id
       FROM email_events
       WHERE resend_email_id = ?
       LIMIT 1`,
      [resendEmailId]
    );

    // Also check generated_emails for outbox-sent emails
    let prospectId: string | null = null;
    let sequenceId: string | null = null;
    let enrollmentId: string | null = null;
    let stepId: string | null = null;

    if (originalEvents.length > 0) {
      prospectId = originalEvents[0].prospect_id;
      sequenceId = originalEvents[0].sequence_id;
      enrollmentId = originalEvents[0].enrollment_id;
      stepId = originalEvents[0].step_id;
    } else {
      // Try to find prospect by email
      if (recipientEmail) {
        const prospects = await query<any[]>(
          'SELECT id FROM prospects WHERE email = ? LIMIT 1',
          [recipientEmail]
        );
        if (prospects.length > 0) {
          prospectId = prospects[0].id;
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
      `INSERT INTO email_events (id, enrollment_id, prospect_id, sequence_id, step_id,
       event_type, resend_email_id, subject, link_clicked, user_agent, ip_address, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
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
        if (recipientEmail) {
          await query(
            `INSERT IGNORE INTO suppression_list (id, email, reason, source)
             VALUES (?, ?, 'bounced', 'resend_webhook')`,
            [uuidv4(), recipientEmail]
          );
        }

        // Update prospect status
        await query(
          `UPDATE prospects SET status = 'bounced', email_status = 'invalid'
           WHERE id = ? AND status NOT IN ('unsubscribed')`,
          [prospectId]
        );

        // Stop active enrollments for this prospect
        await query(
          `UPDATE sequence_enrollments SET status = 'bounced', completed_at = NOW()
           WHERE prospect_id = ? AND status = 'active'`,
          [prospectId]
        );

        // Log activity
        await query(
          `INSERT INTO prospect_activities (id, prospect_id, activity_type, title, description)
           VALUES (?, ?, 'email_bounced', 'Email rebotado', ?)`,
          [uuidv4(), prospectId, `El email ha rebotado. Añadido a lista de supresión.`]
        );
        break;

      case 'complaint':
        // Spam complaint - add to suppression and mark do_not_contact
        if (recipientEmail) {
          await query(
            `INSERT IGNORE INTO suppression_list (id, email, reason, source)
             VALUES (?, ?, 'complaint', 'resend_webhook')`,
            [uuidv4(), recipientEmail]
          );
        }

        await query(
          `UPDATE prospects SET do_not_contact = TRUE, status = 'unsubscribed'
           WHERE id = ?`,
          [prospectId]
        );

        // Stop all enrollments
        await query(
          `UPDATE sequence_enrollments SET status = 'unsubscribed', completed_at = NOW()
           WHERE prospect_id = ? AND status IN ('active', 'paused')`,
          [prospectId]
        );

        await query(
          `INSERT INTO prospect_activities (id, prospect_id, activity_type, title, description)
           VALUES (?, ?, 'spam_complaint', 'Queja de spam', ?)`,
          [uuidv4(), prospectId, `El prospect ha marcado el email como spam. Marcado como do_not_contact.`]
        );
        break;

      case 'opened':
        // Add +3 to lead_score (capped at 100)
        await query(
          `UPDATE prospects SET lead_score = LEAST(lead_score + 3, 100) WHERE id = ?`,
          [prospectId]
        );

        await query(
          `INSERT INTO prospect_activities (id, prospect_id, activity_type, title)
           VALUES (?, ?, 'email_opened', 'Email abierto')`,
          [uuidv4(), prospectId]
        );
        break;

      case 'clicked': {
        // Add +10 to lead_score (capped at 100)
        await query(
          `UPDATE prospects SET lead_score = LEAST(lead_score + 10, 100) WHERE id = ?`,
          [prospectId]
        );

        // Check if prospect should be auto-upgraded to 'interested'
        const clickedProspects = await query<any[]>(
          'SELECT lead_score, status FROM prospects WHERE id = ?',
          [prospectId]
        );
        if (clickedProspects.length > 0) {
          const p = clickedProspects[0];
          const earlyStages = ['new', 'enriched', 'qualified', 'contacted'];
          if (p.lead_score >= 70 && earlyStages.includes(p.status)) {
            await query(
              `UPDATE prospects SET status = 'interested' WHERE id = ?`,
              [prospectId]
            );
            await query(
              `INSERT INTO prospect_activities (id, prospect_id, activity_type, title, description)
               VALUES (?, ?, 'auto_qualified', 'Auto-calificado como interesado', ?)`,
              [uuidv4(), prospectId, `Score ${p.lead_score} >= 70 tras click. Promocionado automáticamente.`]
            );
          }

          // Insert score history record
          await query(
            `INSERT INTO prospect_score_history (id, prospect_id, score, score_breakdown)
             VALUES (?, ?, ?, ?)`,
            [uuidv4(), prospectId, p.lead_score, JSON.stringify({ trigger: 'email_clicked', increment: 10 })]
          );
        }

        await query(
          `INSERT INTO prospect_activities (id, prospect_id, activity_type, title, description)
           VALUES (?, ?, 'email_clicked', 'Link clicado', ?)`,
          [uuidv4(), prospectId, `Link: ${data.click?.link || 'unknown'}`]
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
