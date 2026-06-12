import { Resend } from 'resend';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { query } from '../config/database';
import { getEmailFooter, getUnsubscribeUrl } from '../routes/unsubscribe';
import { getTenantConfig, type Tenant } from '../middleware/tenant';
import { decryptSecret } from '../utils/crypto';

// Per-tenant Resend client cache
const resendClients = new Map<string, Resend>();

function getResendClientForTenant(tenantApiKey: string): Resend {
  if (!tenantApiKey) {
    throw new Error('Resend API key is not configured for this tenant.');
  }
  let client = resendClients.get(tenantApiKey);
  if (!client) {
    client = new Resend(tenantApiKey);
    resendClients.set(tenantApiKey, client);
  }
  return client;
}

// Fallback for global config (used when no tenant context)
function getResendClient(): Resend {
  if (!config.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured. Cannot send emails.');
  }
  return getResendClientForTenant(config.RESEND_API_KEY);
}

/**
 * Send a single email via Resend.
 * If tenantId is provided, uses the tenant's Resend API key and config.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
  from?: string,
  replyTo?: string,
  tenantId?: string,
  language?: 'spanish' | 'catalan' | 'english'
): Promise<{ id: string; success: boolean }> {
  let client: Resend;
  let tenant: Tenant | null = null;

  if (tenantId) {
    tenant = await getTenantConfig(tenantId);
    const tenantApiKey = tenant?.config?.email?.resend_api_key
      ? decryptSecret(tenant.config.email.resend_api_key)
      : '';
    const apiKey = tenantApiKey || config.RESEND_API_KEY;
    client = getResendClientForTenant(apiKey);
  } else {
    client = getResendClient();
  }

  try {
    // Append compliance footer with unsubscribe link (tenant-branded)
    const htmlWithFooter = html + getEmailFooter(to, tenantId, tenant, language);

    // Build List-Unsubscribe header for email clients
    const unsubscribeUrl = getUnsubscribeUrl(to, tenantId);

    const defaultFrom = tenant?.config?.email?.from_email || config.EMAIL_FROM;
    const defaultReplyTo = tenant?.config?.email?.reply_to || config.EMAIL_REPLY_TO;

    const result = await client.emails.send({
      from: from || defaultFrom,
      to: [to],
      subject,
      html: htmlWithFooter,
      text: text || undefined,
      replyTo: replyTo || defaultReplyTo || undefined,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      // Note: open/click tracking is configured at domain level via Resend API
      // (resend.domains.update), not per-email. Enabled on tecnocim.com domain.
    });

    if (result.error) {
      logger.error('Resend send error', { error: result.error });
      return { id: '', success: false };
    }

    return { id: result.data?.id || '', success: true };
  } catch (error: any) {
    logger.error('Email send failed', { to, error: error.message });
    throw error;
  }
}

/**
 * Send a sequence step email to an enrolled prospect.
 * Records email events for tracking.
 */
export async function sendSequenceEmail(
  enrollment: {
    id: string;
    sequence_id: string;
    prospect_id: string;
    current_step: number;
    tenant_id: string;
  },
  step: {
    id: string;
    subject: string;
    body_html: string;
    body_text?: string;
    step_number: number;
  }
): Promise<{ success: boolean; resendEmailId?: string }> {
  try {
    // Get prospect details
    const prospects = await query<any[]>(
      'SELECT * FROM prospects WHERE id = ?',
      [enrollment.prospect_id]
    );

    if (prospects.length === 0) {
      throw new Error(`Prospect ${enrollment.prospect_id} not found.`);
    }

    const prospect = prospects[0];

    // Check suppression list (filter by tenant to avoid cross-tenant blocking)
    const suppressed = await query<any[]>(
      'SELECT id FROM suppression_list WHERE email = ? AND tenant_id = ?',
      [prospect.email, enrollment.tenant_id]
    );

    if (suppressed.length > 0) {
      logger.info('Skipping email, on suppression list', { prospectEmail: prospect.email });
      return { success: false };
    }

    // Check do_not_contact flag
    if (prospect.do_not_contact) {
      logger.info('Skipping email, do_not_contact flag set', { prospectEmail: prospect.email });
      return { success: false };
    }

    // Get sequence details for from/reply-to
    const sequences = await query<any[]>(
      'SELECT * FROM email_sequences WHERE id = ?',
      [enrollment.sequence_id]
    );

    const sequence = sequences.length > 0 ? sequences[0] : null;

    // Personalize the subject and body
    const personalizedSubject = personalizeTemplate(step.subject, prospect);
    const personalizedHtml = personalizeTemplate(step.body_html, prospect);
    const personalizedText = step.body_text
      ? personalizeTemplate(step.body_text, prospect)
      : undefined;

    // Get tenant context from the prospect
    const tenantId = prospect.tenant_id;
    const tenant = tenantId ? await getTenantConfig(tenantId) : null;
    const tenantEmail = tenant?.config?.email;

    // Determine from address (sequence > tenant > global)
    const defaultFromName = tenantEmail?.from_name || 'Tecnocim Innova';
    const defaultFromEmail = tenantEmail?.from_email || config.EMAIL_FROM;
    const fromAddress = sequence?.from_email
      ? `${sequence.from_name || defaultFromName} <${sequence.from_email}>`
      : `${defaultFromName} <${defaultFromEmail}>`;

    // Determine reply-to address
    const replyToAddress = sequence?.reply_to || tenantEmail?.reply_to || config.EMAIL_REPLY_TO || undefined;

    // Send via Resend (tenant-aware)
    const result = await sendEmail(
      prospect.email,
      personalizedSubject,
      personalizedHtml,
      personalizedText,
      fromAddress,
      replyToAddress,
      tenantId
    );

    // Record the email event
    const eventId = uuidv4();
    await query(
      `INSERT INTO email_events (id, enrollment_id, prospect_id, sequence_id, step_id,
       event_type, resend_email_id, subject, from_email)
       VALUES (?, ?, ?, ?, ?, 'sent', ?, ?, ?)`,
      [
        eventId,
        enrollment.id,
        enrollment.prospect_id,
        enrollment.sequence_id,
        step.id,
        result.id,
        personalizedSubject,
        fromAddress,
      ]
    );

    // Update prospect last_contacted
    await query(
      'UPDATE prospects SET last_contacted = NOW(), status = CASE WHEN status = ? THEN ? ELSE status END WHERE id = ?',
      ['new', 'contacted', enrollment.prospect_id]
    );

    // Log activity
    await query(
      `INSERT INTO prospect_activities (id, tenant_id, prospect_id, activity_type, title, description)
       VALUES (?, ?, ?, 'email_sent', ?, ?)`,
      [
        uuidv4(),
        enrollment.tenant_id,
        enrollment.prospect_id,
        `Sequence email sent (Step ${step.step_number})`,
        `Subject: ${personalizedSubject}`,
      ]
    );

    return { success: true, resendEmailId: result.id };
  } catch (error: any) {
    logger.error('Send sequence email failed', { enrollmentId: enrollment.id, prospectId: enrollment.prospect_id, error: error.message });

    // Record the failure
    await query(
      `INSERT INTO email_events (id, enrollment_id, prospect_id, sequence_id, step_id,
       event_type, metadata)
       VALUES (?, ?, ?, ?, ?, 'bounced', ?)`,
      [
        uuidv4(),
        enrollment.id,
        enrollment.prospect_id,
        enrollment.sequence_id,
        step.id,
        JSON.stringify({ error: error.message }),
      ]
    );

    return { success: false };
  }
}

/**
 * Replace template variables in email content with prospect data.
 * Supports {{variable}} syntax.
 */
function personalizeTemplate(template: string, prospect: any): string {
  if (!template) return '';

  const replacements: Record<string, string> = {
    '{{first_name}}': prospect.first_name || '',
    '{{last_name}}': prospect.last_name || '',
    '{{full_name}}': prospect.full_name || `${prospect.first_name || ''} ${prospect.last_name || ''}`.trim(),
    '{{email}}': prospect.email || '',
    '{{title}}': prospect.title || '',
    '{{company}}': prospect.company_name || '',
    '{{city}}': prospect.city || '',
    '{{region}}': prospect.region || '',
    '{{country}}': prospect.country || '',
    '{{phone}}': prospect.phone || '',
  };

  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
  }

  return result;
}
