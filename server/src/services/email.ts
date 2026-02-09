import { Resend } from 'resend';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env';
import { query } from '../config/database';

// Initialize Resend client (may be undefined if API key not configured)
let resend: Resend | null = null;

function getResendClient(): Resend {
  if (!resend) {
    if (!config.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY is not configured. Cannot send emails.');
    }
    resend = new Resend(config.RESEND_API_KEY);
  }
  return resend;
}

/**
 * Send a single email via Resend.
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
  from?: string
): Promise<{ id: string; success: boolean }> {
  const client = getResendClient();

  try {
    const result = await client.emails.send({
      from: from || config.EMAIL_FROM,
      to: [to],
      subject,
      html,
      text: text || undefined,
    });

    if (result.error) {
      console.error('Resend send error:', result.error);
      return { id: '', success: false };
    }

    return { id: result.data?.id || '', success: true };
  } catch (error: any) {
    console.error('Email send failed:', error.message);
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

    // Check suppression list
    const suppressed = await query<any[]>(
      'SELECT id FROM suppression_list WHERE email = ?',
      [prospect.email]
    );

    if (suppressed.length > 0) {
      console.log(`Skipping email to ${prospect.email} - on suppression list.`);
      return { success: false };
    }

    // Check do_not_contact flag
    if (prospect.do_not_contact) {
      console.log(`Skipping email to ${prospect.email} - do_not_contact flag is set.`);
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

    // Determine from address
    const fromAddress = sequence?.from_email
      ? `${sequence.from_name || 'CamiaCasa'} <${sequence.from_email}>`
      : config.EMAIL_FROM;

    // Send via Resend
    const result = await sendEmail(
      prospect.email,
      personalizedSubject,
      personalizedHtml,
      personalizedText,
      fromAddress
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
      `INSERT INTO prospect_activities (id, prospect_id, activity_type, title, description)
       VALUES (?, ?, 'email_sent', ?, ?)`,
      [
        uuidv4(),
        enrollment.prospect_id,
        `Sequence email sent (Step ${step.step_number})`,
        `Subject: ${personalizedSubject}`,
      ]
    );

    return { success: true, resendEmailId: result.id };
  } catch (error: any) {
    console.error('Send sequence email failed:', error.message);

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
