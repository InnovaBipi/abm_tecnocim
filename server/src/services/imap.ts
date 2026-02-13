import { ImapFlow } from 'imapflow';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env';
import { query } from '../config/database';

/**
 * Poll IMAP inbox for new replies from prospects.
 * Matches incoming emails to prospects and creates 'replied' events.
 */
export async function pollImapForReplies(): Promise<void> {
  if (!config.OVH_IMAP_HOST || !config.OVH_EMAIL || !config.OVH_EMAIL_PASS) {
    // IMAP not configured — skip silently
    return;
  }

  const client = new ImapFlow({
    host: config.OVH_IMAP_HOST,
    port: config.OVH_IMAP_PORT,
    secure: true,
    auth: {
      user: config.OVH_EMAIL,
      pass: config.OVH_EMAIL_PASS,
    },
    logger: false,
  });

  try {
    await client.connect();

    // Read last synced UID
    const syncState = await query<any[]>(
      `SELECT last_uid FROM imap_sync_state WHERE mailbox = 'INBOX' LIMIT 1`
    );
    const lastUid = syncState.length > 0 ? syncState[0].last_uid : 0;

    const lock = await client.getMailboxLock('INBOX');
    let highestUid = lastUid;

    try {
      // Fetch messages with UID > lastUid
      const searchRange = lastUid > 0 ? `${lastUid + 1}:*` : '1:*';

      for await (const message of client.fetch(searchRange, {
        uid: true,
        envelope: true,
        headers: ['in-reply-to', 'references', 'message-id'],
      })) {
        // Skip if UID is not actually newer (IMAP range semantics)
        if (message.uid <= lastUid) continue;

        if (message.uid > highestUid) {
          highestUid = message.uid;
        }

        const senderAddress = message.envelope?.from?.[0]?.address?.toLowerCase();
        if (!senderAddress) continue;

        // Match sender against prospects
        const prospects = await query<any[]>(
          'SELECT id, status FROM prospects WHERE LOWER(email) = ? LIMIT 1',
          [senderAddress]
        );

        if (prospects.length === 0) continue;

        const prospect = prospects[0];

        // Deduplicate: check if we already have a reply event from this prospect within 5 minutes
        const recentReplies = await query<any[]>(
          `SELECT id FROM email_events
           WHERE prospect_id = ? AND event_type = 'replied'
           AND occurred_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
           LIMIT 1`,
          [prospect.id]
        );

        if (recentReplies.length > 0) continue;

        // Try to match to sequence via In-Reply-To header
        const headers = message.headers ? message.headers.toString() : '';
        const inReplyToMatch = headers.match(/in-reply-to:\s*<?([^>\s]+)>?/i);
        const inReplyTo = inReplyToMatch ? inReplyToMatch[1] : null;

        let sequenceId: string | null = null;
        let enrollmentId: string | null = null;
        let stepId: string | null = null;

        if (inReplyTo) {
          // Try matching by resend_email_id or message_id
          const matchedEvents = await query<any[]>(
            `SELECT sequence_id, enrollment_id, step_id FROM email_events
             WHERE (resend_email_id = ? OR message_id = ?)
             AND prospect_id = ?
             LIMIT 1`,
            [inReplyTo, inReplyTo, prospect.id]
          );

          if (matchedEvents.length > 0) {
            sequenceId = matchedEvents[0].sequence_id;
            enrollmentId = matchedEvents[0].enrollment_id;
            stepId = matchedEvents[0].step_id;
          }
        }

        // Fallback: match to most recent active enrollment for this prospect
        if (!enrollmentId) {
          const activeEnrollments = await query<any[]>(
            `SELECT se.id as enrollment_id, se.sequence_id,
                    (SELECT ss.id FROM sequence_steps ss
                     WHERE ss.sequence_id = se.sequence_id AND ss.step_number = se.current_step
                     LIMIT 1) as step_id
             FROM sequence_enrollments se
             WHERE se.prospect_id = ? AND se.status = 'active'
             ORDER BY se.enrolled_at DESC
             LIMIT 1`,
            [prospect.id]
          );

          if (activeEnrollments.length > 0) {
            enrollmentId = activeEnrollments[0].enrollment_id;
            sequenceId = activeEnrollments[0].sequence_id;
            stepId = activeEnrollments[0].step_id;
          }
        }

        // Insert 'replied' email event
        await query(
          `INSERT INTO email_events (id, enrollment_id, prospect_id, sequence_id, step_id,
           event_type, subject, metadata)
           VALUES (?, ?, ?, ?, ?, 'replied', ?, ?)`,
          [
            uuidv4(),
            enrollmentId,
            prospect.id,
            sequenceId,
            stepId,
            message.envelope?.subject || null,
            JSON.stringify({ source: 'imap', from: senderAddress, uid: message.uid }),
          ]
        );

        // Update prospect status and last_replied
        await query(
          `UPDATE prospects SET status = 'replied', last_replied = NOW() WHERE id = ?`,
          [prospect.id]
        );

        // Log activity
        await query(
          `INSERT INTO prospect_activities (id, prospect_id, activity_type, title, description)
           VALUES (?, ?, 'email_replied', 'Respuesta recibida (IMAP)', ?)`,
          [
            uuidv4(),
            prospect.id,
            `Asunto: ${message.envelope?.subject || '(sin asunto)'}`,
          ]
        );

        console.log(`IMAP: Reply detected from ${senderAddress} (prospect ${prospect.id})`);
      }
    } finally {
      lock.release();
    }

    // Update last_uid in sync state
    if (highestUid > lastUid) {
      await query(
        `UPDATE imap_sync_state SET last_uid = ?, last_synced_at = NOW() WHERE mailbox = 'INBOX'`,
        [highestUid]
      );
    }

    await client.logout();
  } catch (error: any) {
    console.error('IMAP polling error:', error.message);
    try { await client.logout(); } catch { /* ignore logout errors */ }
  }
}
