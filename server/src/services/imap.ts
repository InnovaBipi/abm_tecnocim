import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { getAllActiveTenants } from '../middleware/tenant';
import { classifyReply } from './ai';
import { decryptSecret } from '../utils/crypto';

/**
 * Poll IMAP inbox for a single tenant.
 * Uses sequence-number based fetch (OVH rejects UID FETCH on some servers).
 * Tracks last synced UID to avoid reprocessing.
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
      pass: decryptSecret(imapConfig.pass),
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
      const totalMessages = (client as any).mailbox?.exists || 0;
      if (totalMessages === 0) {
        lock.release();
        await client.logout();
        return;
      }

      // Fetch envelopes using sequence-number range (works on OVH, UID fetch doesn't).
      // We fetch the last N messages and filter by UID > lastUid after.
      // Start from a reasonable window — last 50 messages or all if fewer.
      const startSeq = Math.max(1, totalMessages - 49);
      const rangeStr = `${startSeq}:${totalMessages}`;

      // Collect all envelopes in a single fast IMAP command
      const messages: Array<{
        uid: number;
        seqNo: number;
        envelope: any;
      }> = [];

      try {
        let seqNo = startSeq;
        for await (const msg of client.fetch(rangeStr, { envelope: true, uid: true })) {
          messages.push({
            uid: msg.uid,
            seqNo: seqNo++,
            envelope: msg.envelope,
          });
        }
      } catch (fetchErr: any) {
        console.warn(`IMAP [${tenantId}]: Envelope fetch partially failed after ${messages.length} messages: ${fetchErr.message}`);
      }

      // Filter to only new messages (UID > lastUid)
      const newMessages = messages.filter(m => m.uid > lastUid);

      if (newMessages.length === 0) {
        // Update highestUid even if no new prospect replies — avoid refetching
        if (messages.length > 0) {
          const maxFetched = Math.max(...messages.map(m => m.uid));
          if (maxFetched > highestUid) highestUid = maxFetched;
        }
        lock.release();
        await client.logout();
        // Persist sync state even when no new messages
        if (highestUid > lastUid) {
          await updateSyncState(tenantId, highestUid, syncState.length > 0);
        }
        return;
      }

      console.log(`IMAP [${tenantId}]: ${newMessages.length} new messages (UIDs > ${lastUid})`);

      for (const msg of newMessages) {
        if (msg.uid > highestUid) highestUid = msg.uid;

        const senderAddress = msg.envelope?.from?.[0]?.address?.toLowerCase();
        if (!senderAddress) continue;

        // Check if sender is a prospect in this tenant (exact email match)
        let matchedProspects = await query<any[]>(
          'SELECT id, status FROM prospects WHERE LOWER(email) = ? AND tenant_id = ? LIMIT 1',
          [senderAddress, tenantId]
        );

        // Fallback: domain match. Generic-inbox outreach (info@, ir@, comercial@...) often gets
        // replies from a personal address (name@company.com) that does NOT equal the stored
        // generic email. If exactly ONE prospect in this tenant shares the sender's domain,
        // link the reply to that prospect. Unambiguous-only (LIMIT 2 -> require length === 1)
        // and free-email providers are excluded so personal mailboxes never aggregate.
        let matchType = 'exact';
        if (matchedProspects.length === 0) {
          const atIdx = senderAddress.lastIndexOf('@');
          const senderDomain = atIdx >= 0 ? senderAddress.slice(atIdx + 1) : '';
          const FREE_DOMAINS = new Set([
            'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es',
            'live.com', 'yahoo.com', 'yahoo.es', 'icloud.com', 'me.com', 'aol.com',
            'proton.me', 'protonmail.com',
          ]);
          if (senderDomain && !FREE_DOMAINS.has(senderDomain)) {
            const domainMatches = await query<any[]>(
              `SELECT id, status FROM prospects
               WHERE tenant_id = ? AND LOWER(SUBSTRING_INDEX(email, '@', -1)) = ?
               LIMIT 2`,
              [tenantId, senderDomain]
            );
            if (domainMatches.length === 1) {
              matchedProspects = domainMatches;
              matchType = 'domain';
              console.log(`IMAP [${tenantId}]: domain-matched reply from ${senderAddress} -> prospect ${domainMatches[0].id} (domain ${senderDomain})`);
            }
          }
        }
        if (matchedProspects.length === 0) continue;

        const prospect = matchedProspects[0];

        // Deduplicate by UID
        const existingByUid = await query<any[]>(
          `SELECT id FROM email_events
           WHERE prospect_id = ? AND event_type = 'replied'
           AND JSON_EXTRACT(metadata, '$.uid') = ?
           LIMIT 1`,
          [prospect.id, msg.uid]
        );
        if (existingByUid.length > 0) continue;

        // Dedup by time window
        const recentReplies = await query<any[]>(
          `SELECT id FROM email_events
           WHERE prospect_id = ? AND event_type = 'replied'
           AND occurred_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)
           LIMIT 1`,
          [prospect.id]
        );
        if (recentReplies.length > 0) continue;

        // Fetch body for this specific message using sequence number
        let replyBodyText = '';
        try {
          const seqRange = `${msg.seqNo}:${msg.seqNo}`;
          for await (const fullMsg of client.fetch(seqRange, { source: true })) {
            if (fullMsg.source) {
              const parsed = await simpleParser(fullMsg.source);
              replyBodyText = (parsed.text || '').substring(0, 2000);
            }
          }
        } catch (bodyErr: any) {
          console.warn(`IMAP [${tenantId}]: Body fetch failed for seq ${msg.seqNo} (classifying without body): ${bodyErr.message}`);
        }

        // Match to sequence via In-Reply-To
        const inReplyTo = msg.envelope?.inReplyTo || null;
        let sequenceId: string | null = null;
        let enrollmentId: string | null = null;
        let stepId: string | null = null;

        if (inReplyTo) {
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

        // Fallback: most recent active enrollment
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

        // Classify the reply using AI
        let replyClassification = 'other';
        if (replyBodyText.trim().length > 0) {
          try {
            replyClassification = await classifyReply(replyBodyText, msg.envelope?.subject || '');
            console.log(`IMAP [${tenantId}]: Reply from ${senderAddress} classified as: ${replyClassification}`);
          } catch (classifyErr: any) {
            console.warn(`IMAP [${tenantId}]: Classification failed for UID ${msg.uid}, defaulting to 'other': ${classifyErr.message}`);
          }
        }

        // Insert reply event
        await query(
          `INSERT INTO email_events (id, tenant_id, enrollment_id, prospect_id, sequence_id, step_id,
           event_type, subject, metadata)
           VALUES (?, ?, ?, ?, ?, ?, 'replied', ?, ?)`,
          [
            uuidv4(), tenantId, enrollmentId, prospect.id, sequenceId, stepId,
            msg.envelope?.subject || null,
            JSON.stringify({
              source: 'imap',
              from: senderAddress,
              uid: msg.uid,
              match_type: matchType,
              reply_classification: replyClassification,
              reply_snippet: replyBodyText.substring(0, 500),
            }),
          ]
        );

        // Update prospect status based on classification
        if (replyClassification === 'negative' || replyClassification === 'unsubscribe') {
          await query(
            `UPDATE prospects SET status = 'rejected', do_not_contact = TRUE, last_replied = NOW() WHERE id = ?`,
            [prospect.id]
          );
          await query(
            `UPDATE sequence_enrollments SET status = 'replied', completed_at = NOW()
             WHERE prospect_id = ? AND status = 'active'`,
            [prospect.id]
          );
          // Also cancel all scheduled outbox emails
          await query(
            `UPDATE generated_emails SET status = 'rejected',
             metadata = JSON_SET(COALESCE(metadata, '{}'), '$.skip_reason', 'prospect_rejected')
             WHERE prospect_id = ? AND status = 'scheduled'`,
            [prospect.id]
          );
          console.log(`IMAP [${tenantId}]: Stopped ALL sequences for ${senderAddress} (rejection: ${replyClassification})`);
        } else if (replyClassification === 'out_of_office') {
          await query(
            `UPDATE prospects SET last_replied = NOW() WHERE id = ?`,
            [prospect.id]
          );
        } else {
          // Positive or other: mark as replied, stop sequences
          await query(
            `UPDATE prospects SET status = 'replied', last_replied = NOW() WHERE id = ?`,
            [prospect.id]
          );
          await query(
            `UPDATE sequence_enrollments SET status = 'replied', completed_at = NOW()
             WHERE prospect_id = ? AND status = 'active'`,
            [prospect.id]
          );
          await query(
            `UPDATE generated_emails SET status = 'rejected',
             metadata = JSON_SET(COALESCE(metadata, '{}'), '$.skip_reason', 'prospect_replied')
             WHERE prospect_id = ? AND status = 'scheduled'`,
            [prospect.id]
          );
        }

        // Log activity
        await query(
          `INSERT INTO prospect_activities (id, tenant_id, prospect_id, activity_type, title, description)
           VALUES (?, ?, ?, 'email_replied', 'Respuesta recibida (IMAP)', ?)`,
          [
            uuidv4(), tenantId, prospect.id,
            `Clasificación: ${replyClassification} | Asunto: ${msg.envelope?.subject || '(sin asunto)'}`,
          ]
        );

        console.log(`IMAP [${tenantId}]: Reply detected from ${senderAddress} [${replyClassification}]`);
      }
    } finally {
      lock.release();
    }

    // Persist sync state
    if (highestUid > lastUid) {
      await updateSyncState(tenantId, highestUid, syncState.length > 0);
    }

    await client.logout();
  } catch (error: any) {
    console.error(`IMAP polling error [${tenantId}]:`, error.message);
    try { await client.logout(); } catch { /* ignore */ }
  }
}

/** Update or insert IMAP sync state */
async function updateSyncState(tenantId: string, highestUid: number, exists: boolean): Promise<void> {
  if (exists) {
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

/**
 * Poll IMAP inbox for all active tenants that have IMAP configured.
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
