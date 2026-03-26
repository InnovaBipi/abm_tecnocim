import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { getAllActiveTenants } from '../middleware/tenant';
import { classifyReply } from './ai';

/**
 * Poll IMAP inbox for a single tenant.
 * Matches incoming emails to prospects and creates 'replied' events, all scoped to tenantId.
 */
export async function pollImapForTenant(
  tenantId: string,
  imapConfig: { host: string; port: number; user: string; pass: string }
): Promise<void> {
  const client = new ImapFlow({
    host: imapConfig.host,
    port: imapConfig.port,
    secure: true,
    auth: {
      user: imapConfig.user,
      pass: imapConfig.pass,
    },
    logger: false,
  });

  try {
    await client.connect();

    // Read last synced UID for this tenant
    const syncState = await query<any[]>(
      `SELECT last_uid FROM imap_sync_state WHERE tenant_id = ? AND mailbox = 'INBOX' LIMIT 1`,
      [tenantId]
    );
    const lastUid = syncState.length > 0 ? syncState[0].last_uid : 0;

    const lock = await client.getMailboxLock('INBOX');
    let highestUid = lastUid;

    try {
      // Search for messages with UID > lastUid
      let searchResult: any;
      try {
        searchResult = await client.search({ uid: lastUid > 0 ? `${lastUid + 1}:*` : '1:*' }, { uid: true });
      } catch (searchErr: any) {
        console.error(`IMAP search failed [${tenantId}] (lastUid=${lastUid}):`, searchErr.message);
        lock.release();
        await client.logout();
        return;
      }

      // search() can return false if no results
      const uids = Array.isArray(searchResult) ? searchResult : [];

      // Filter out UIDs <= lastUid (IMAP range semantics include the boundary)
      const newUids = uids.filter((uid: number) => uid > lastUid);

      if (newUids.length === 0) {
        lock.release();
        await client.logout();
        return;
      }

      console.log(`IMAP [${tenantId}]: Fetching ${newUids.length} new messages (UIDs > ${lastUid})`);

      // Batch fetch all messages at once (single IMAP command, less connection stress)
      // Wrapped in try-catch so partial success still updates highestUid
      try {
        for await (const message of client.fetch(newUids, { uid: true, envelope: true, source: true })) {
          if (message.uid > highestUid) {
            highestUid = message.uid;
          }

          const senderAddress = message.envelope?.from?.[0]?.address?.toLowerCase();
          if (!senderAddress) continue;

          // Parse the full message body for reply classification
          let replyBodyText = '';
          try {
            if (message.source) {
              const parsed = await simpleParser(message.source);
              replyBodyText = (parsed.text || '').substring(0, 2000); // limit to 2000 chars
            }
          } catch (parseErr: any) {
            console.warn(`IMAP [${tenantId}]: Failed to parse body for UID ${message.uid}: ${parseErr.message}`);
          }

        // Match sender against prospects scoped to tenant
        const prospects = await query<any[]>(
          'SELECT id, status FROM prospects WHERE LOWER(email) = ? AND tenant_id = ? LIMIT 1',
          [senderAddress, tenantId]
        );

        if (prospects.length === 0) continue;

        const prospect = prospects[0];

        // Deduplicate: check by IMAP UID (strongest)
        const existingByUid = await query<any[]>(
          `SELECT id FROM email_events
           WHERE prospect_id = ? AND event_type = 'replied'
           AND JSON_EXTRACT(metadata, '$.uid') = ?
           LIMIT 1`,
          [prospect.id, message.uid]
        );

        if (existingByUid.length > 0) continue;

        // Also dedup by time window (catches non-UID duplicates)
        const recentReplies = await query<any[]>(
          `SELECT id FROM email_events
           WHERE prospect_id = ? AND event_type = 'replied'
           AND occurred_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
           LIMIT 1`,
          [prospect.id]
        );

        if (recentReplies.length > 0) continue;

        // Try to match to sequence via In-Reply-To from envelope
        const inReplyTo = message.envelope?.inReplyTo || null;

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

        // Classify the reply using AI (positive, negative, out_of_office, unsubscribe, other)
        let replyClassification = 'other';
        if (replyBodyText.trim().length > 0) {
          try {
            replyClassification = await classifyReply(replyBodyText, message.envelope?.subject || '');
            console.log(`IMAP [${tenantId}]: Reply from ${senderAddress} classified as: ${replyClassification}`);
          } catch (classifyErr: any) {
            console.warn(`IMAP [${tenantId}]: Classification failed for UID ${message.uid}, defaulting to 'other': ${classifyErr.message}`);
          }
        }

        // Insert 'replied' email event with tenant_id and classification
        await query(
          `INSERT INTO email_events (id, tenant_id, enrollment_id, prospect_id, sequence_id, step_id,
           event_type, subject, metadata)
           VALUES (?, ?, ?, ?, ?, ?, 'replied', ?, ?)`,
          [
            uuidv4(),
            tenantId,
            enrollmentId,
            prospect.id,
            sequenceId,
            stepId,
            message.envelope?.subject || null,
            JSON.stringify({
              source: 'imap',
              from: senderAddress,
              uid: message.uid,
              reply_classification: replyClassification,
              reply_snippet: replyBodyText.substring(0, 500),
            }),
          ]
        );

        // Update prospect status based on classification
        if (replyClassification === 'negative' || replyClassification === 'unsubscribe') {
          // Rejection or unsubscribe: mark as rejected + do_not_contact
          await query(
            `UPDATE prospects SET status = 'rejected', do_not_contact = TRUE, last_replied = NOW() WHERE id = ?`,
            [prospect.id]
          );
        } else if (replyClassification === 'out_of_office') {
          // OOO: keep status, just record the reply timestamp
          await query(
            `UPDATE prospects SET last_replied = NOW() WHERE id = ?`,
            [prospect.id]
          );
        } else {
          // Positive or other: mark as replied
          await query(
            `UPDATE prospects SET status = 'replied', last_replied = NOW() WHERE id = ?`,
            [prospect.id]
          );
        }

        // If negative/unsubscribe, also stop all active enrollments for this prospect
        if (replyClassification === 'negative' || replyClassification === 'unsubscribe') {
          await query(
            `UPDATE sequence_enrollments SET status = 'replied', completed_at = NOW()
             WHERE prospect_id = ? AND status = 'active'`,
            [prospect.id]
          );
          console.log(`IMAP [${tenantId}]: Stopped ALL sequences for ${senderAddress} (rejection: ${replyClassification})`);
        }

        // Log activity with tenant_id
        await query(
          `INSERT INTO prospect_activities (id, tenant_id, prospect_id, activity_type, title, description)
           VALUES (?, ?, ?, 'email_replied', 'Respuesta recibida (IMAP)', ?)`,
          [
            uuidv4(),
            tenantId,
            prospect.id,
            `Asunto: ${message.envelope?.subject || '(sin asunto)'}`,
          ]
        );

        console.log(`IMAP [${tenantId}]: Reply detected from ${senderAddress} (prospect ${prospect.id})`);
        }
      } catch (fetchErr: any) {
        // On fetch failure, advance past all UIDs so we don't re-process them endlessly
        const maxUid = Math.max(...newUids);
        if (maxUid > highestUid) highestUid = maxUid;
        console.error(`IMAP [${tenantId}]: Fetch interrupted, advancing to UID ${highestUid}: ${fetchErr.message}`);
      }
    } finally {
      lock.release();
    }

    // Update or insert last_uid in sync state for this tenant
    if (highestUid > lastUid) {
      if (syncState.length > 0) {
        await query(
          `UPDATE imap_sync_state SET last_uid = ?, last_synced_at = NOW() WHERE tenant_id = ? AND mailbox = 'INBOX'`,
          [highestUid, tenantId]
        );
      } else {
        await query(
          `INSERT INTO imap_sync_state (id, tenant_id, mailbox, last_uid, last_synced_at) VALUES (?, ?, 'INBOX', ?, NOW())`,
          [uuidv4(), tenantId, highestUid]
        );
      }
    }

    await client.logout();
  } catch (error: any) {
    console.error(`IMAP polling error [${tenantId}]:`, error.message, error.stack?.split('\n').slice(0, 3).join(' | '));
    try { await client.logout(); } catch { /* ignore logout errors */ }
  }
}

/**
 * Poll IMAP inbox for all active tenants that have IMAP configured.
 * Iterates over tenants and calls pollImapForTenant for each.
 */
export async function pollImapForReplies(): Promise<void> {
  const tenants = await getAllActiveTenants();

  for (const tenant of tenants) {
    const imap = tenant.config?.imap;
    if (!imap?.host || !imap?.user || !imap?.pass) {
      continue;
    }

    try {
      await pollImapForTenant(tenant.id, imap);
    } catch (error: any) {
      console.error(`IMAP polling failed for tenant ${tenant.id}:`, error.message);
    }
  }
}
