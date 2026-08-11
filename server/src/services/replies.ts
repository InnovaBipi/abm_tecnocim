import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';

/**
 * Shared reply-recording pipeline.
 *
 * A "reply" is a row in email_events with event_type='replied'; everything
 * downstream (follow-up cancellation, cancelRepliedFollowups() sweep, digest,
 * replies_list) keys off that row — it doesn't care where it came from.
 *
 * Sources:
 *  - 'imap':   automatic detection (services/imap.ts delegates here)
 *  - 'manual': M365 mailbox sweeps recorded via POST /api/replies or the MCP
 *              reply_record tool (the only viable path for O365 mailboxes,
 *              where basic-auth IMAP is dead)
 *
 * Unlike the original inline imap.ts block, every UPDATE here is scoped by
 * tenant_id as well as prospect_id.
 */

export type ReplyClassification = 'positive' | 'negative' | 'unsubscribe' | 'out_of_office' | 'other';

export interface RecordReplyInput {
  tenantId: string;
  prospectId: string;
  classification: ReplyClassification;
  subject?: string | null;
  snippet?: string | null;
  source: 'imap' | 'manual';
  from?: string | null;          // address the prospect replied from
  receivedBy?: string | null;    // mailbox that received the reply (per-sender attribution)
  inReplyTo?: string | null;     // Message-ID (IMAP path) for sequence attribution
  recordedBy?: string | null;    // userId that recorded it (manual path)
  extraMetadata?: Record<string, unknown>;
}

export interface RecordReplyResult {
  eventId: string;
  prospectStatus: 'rejected' | 'replied' | 'unchanged';
  doNotContact: boolean;
  enrollmentsStopped: number;
  scheduledCancelled: number;
}

export async function recordReply(input: RecordReplyInput): Promise<RecordReplyResult> {
  const {
    tenantId, prospectId, classification, subject = null, snippet = null,
    source, from = null, receivedBy = null, inReplyTo = null, recordedBy = null,
    extraMetadata = {},
  } = input;

  // Attribute to a sequence/enrollment: In-Reply-To first, then most recent active enrollment
  let sequenceId: string | null = null;
  let enrollmentId: string | null = null;
  let stepId: string | null = null;

  if (inReplyTo) {
    const matchedEvents = await query<any[]>(
      `SELECT sequence_id, enrollment_id, step_id FROM email_events
       WHERE (resend_email_id = ? OR message_id = ?)
       AND prospect_id = ? AND tenant_id = ?
       LIMIT 1`,
      [inReplyTo, inReplyTo, prospectId, tenantId]
    );
    if (matchedEvents.length > 0) {
      sequenceId = matchedEvents[0].sequence_id;
      enrollmentId = matchedEvents[0].enrollment_id;
      stepId = matchedEvents[0].step_id;
    }
  }

  if (!enrollmentId) {
    const activeEnrollments = await query<any[]>(
      `SELECT se.id as enrollment_id, se.sequence_id,
              (SELECT ss.id FROM sequence_steps ss
               WHERE ss.sequence_id = se.sequence_id AND ss.step_number = se.current_step
               LIMIT 1) as step_id
       FROM sequence_enrollments se
       WHERE se.prospect_id = ? AND se.tenant_id = ? AND se.status = 'active'
       ORDER BY se.enrolled_at DESC
       LIMIT 1`,
      [prospectId, tenantId]
    );
    if (activeEnrollments.length > 0) {
      enrollmentId = activeEnrollments[0].enrollment_id;
      sequenceId = activeEnrollments[0].sequence_id;
      stepId = activeEnrollments[0].step_id;
    }
  }

  const eventId = uuidv4();
  await query(
    `INSERT INTO email_events (id, tenant_id, enrollment_id, prospect_id, sequence_id, step_id,
     event_type, subject, from_email, metadata)
     VALUES (?, ?, ?, ?, ?, ?, 'replied', ?, ?, ?)`,
    [
      eventId, tenantId, enrollmentId, prospectId, sequenceId, stepId,
      subject,
      from,
      JSON.stringify({
        source,
        from,
        received_by: receivedBy,
        recorded_by: recordedBy,
        reply_classification: classification,
        reply_snippet: (snippet || '').substring(0, 2000),
        ...extraMetadata,
      }),
    ]
  );

  let prospectStatus: RecordReplyResult['prospectStatus'] = 'unchanged';
  let doNotContact = false;
  let enrollmentsStopped = 0;
  let scheduledCancelled = 0;

  if (classification === 'negative' || classification === 'unsubscribe') {
    await query(
      `UPDATE prospects SET status = 'rejected', do_not_contact = TRUE, last_replied = NOW()
       WHERE id = ? AND tenant_id = ?`,
      [prospectId, tenantId]
    );
    prospectStatus = 'rejected';
    doNotContact = true;
    const enr: any = await query(
      `UPDATE sequence_enrollments SET status = 'replied', completed_at = NOW()
       WHERE prospect_id = ? AND tenant_id = ? AND status = 'active'`,
      [prospectId, tenantId]
    );
    enrollmentsStopped = enr?.affectedRows ?? 0;
    const cancelled: any = await query(
      `UPDATE generated_emails SET status = 'rejected',
       metadata = JSON_SET(COALESCE(metadata, '{}'), '$.skip_reason', 'prospect_rejected')
       WHERE prospect_id = ? AND tenant_id = ? AND status = 'scheduled'`,
      [prospectId, tenantId]
    );
    scheduledCancelled = cancelled?.affectedRows ?? 0;
  } else if (classification === 'out_of_office') {
    await query(
      `UPDATE prospects SET last_replied = NOW() WHERE id = ? AND tenant_id = ?`,
      [prospectId, tenantId]
    );
  } else {
    // positive / other: mark replied, stop sequences and pending outbox emails
    await query(
      `UPDATE prospects SET status = 'replied', last_replied = NOW()
       WHERE id = ? AND tenant_id = ?`,
      [prospectId, tenantId]
    );
    prospectStatus = 'replied';
    const enr: any = await query(
      `UPDATE sequence_enrollments SET status = 'replied', completed_at = NOW()
       WHERE prospect_id = ? AND tenant_id = ? AND status = 'active'`,
      [prospectId, tenantId]
    );
    enrollmentsStopped = enr?.affectedRows ?? 0;
    const cancelled: any = await query(
      `UPDATE generated_emails SET status = 'rejected',
       metadata = JSON_SET(COALESCE(metadata, '{}'), '$.skip_reason', 'prospect_replied')
       WHERE prospect_id = ? AND tenant_id = ? AND status = 'scheduled'`,
      [prospectId, tenantId]
    );
    scheduledCancelled = cancelled?.affectedRows ?? 0;
  }

  const sourceLabel = source === 'imap' ? 'Respuesta recibida (IMAP)' : 'Respuesta registrada (manual)';
  await query(
    `INSERT INTO prospect_activities (id, tenant_id, prospect_id, activity_type, title, description)
     VALUES (?, ?, ?, 'email_replied', ?, ?)`,
    [
      uuidv4(), tenantId, prospectId, sourceLabel,
      `Clasificación: ${classification} | Asunto: ${subject || '(sin asunto)'}`,
    ]
  );

  return { eventId, prospectStatus, doNotContact, enrollmentsStopped, scheduledCancelled };
}
