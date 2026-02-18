import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { processJobs, addJob } from './queue';
import { sendEmail, sendSequenceEmail } from '../services/email';
import { recalculateAllScores } from '../services/scoring';
import { calculateOptimalSendTime, resolveProspectTimezone, isWithinSendWindow } from '../services/scheduling';
import { pollImapForReplies } from '../services/imap';

/**
 * Initialize all scheduled jobs using node-cron.
 */
export function startScheduler(): void {
  console.log('Starting job scheduler...');

  // =============================================
  // Every 5 minutes: Check and send due sequence emails
  // =============================================
  cron.schedule('*/5 * * * *', async () => {
    try {
      await processDueSequenceEmails();
    } catch (error: any) {
      console.error('Sequence email processing error:', error.message);
    }
  });

  // =============================================
  // Every 5 minutes: Process pending jobs from the queue
  // =============================================
  cron.schedule('*/5 * * * *', async () => {
    try {
      let processed = 0;
      let batchCount = 0;

      // Process up to 10 jobs per cycle
      do {
        batchCount = await processJobs();
        processed += batchCount;
      } while (batchCount > 0 && processed < 10);

      if (processed > 0) {
        console.log(`Processed ${processed} queued job(s).`);
      }
    } catch (error: any) {
      console.error('Job queue processing error:', error.message);
    }
  });

  // =============================================
  // Every hour: Process pending enrichment jobs
  // =============================================
  cron.schedule('0 * * * *', async () => {
    try {
      await processPendingEnrichments();
    } catch (error: any) {
      console.error('Enrichment processing error:', error.message);
    }
  });

  // =============================================
  // Every day at 2 AM: Recalculate all scores
  // =============================================
  cron.schedule('0 2 * * *', async () => {
    try {
      console.log('Starting daily score recalculation...');
      const result = await recalculateAllScores();
      console.log(`Daily score recalculation complete: ${result.processed} processed, ${result.errors} errors.`);
    } catch (error: any) {
      console.error('Daily score recalculation error:', error.message);
    }
  });

  // =============================================
  // Every 2 minutes: Process scheduled outbox emails
  // =============================================
  cron.schedule('*/2 * * * *', async () => {
    try {
      await processScheduledOutboxEmails();
    } catch (error: any) {
      console.error('Scheduled outbox processing error:', error.message);
    }
  });

  // =============================================
  // Every 3 minutes: Poll IMAP for replies
  // =============================================
  cron.schedule('*/3 * * * *', async () => {
    try {
      await pollImapForReplies();
    } catch (error: any) {
      console.error('IMAP polling error:', error.message);
    }
  });

  console.log('Job scheduler started successfully.');
  console.log('  - Sequence emails: every 5 minutes');
  console.log('  - Job queue: every 5 minutes');
  console.log('  - Scheduled outbox: every 2 minutes');
  console.log('  - IMAP reply polling: every 3 minutes');
  console.log('  - Enrichments: every hour');
  console.log('  - Score recalculation: daily at 2 AM');
}

// =============================================
// Warm-up & Daily Limit Helpers
// =============================================

/**
 * Calculate the max daily sends based on domain age (warm-up curve).
 * Domain age = days since first email_event of type 'sent'.
 * Day 1-3: 5, Day 4-7: 15, Day 8-14: 30, Day 15-21: 50, Day 22-30: 100, Day 31+: no cap
 */
async function getWarmupDailyLimit(): Promise<number> {
  const result = await query<any[]>(
    `SELECT MIN(occurred_at) as first_sent
     FROM email_events WHERE event_type = 'sent'`
  );

  if (!result[0]?.first_sent) {
    // No emails ever sent — start of warm-up
    return 5;
  }

  const firstSent = new Date(result[0].first_sent);
  const now = new Date();
  const domainAgeDays = Math.floor((now.getTime() - firstSent.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  if (domainAgeDays <= 3) return 5;
  if (domainAgeDays <= 7) return 15;
  if (domainAgeDays <= 14) return 30;
  if (domainAgeDays <= 21) return 50;
  if (domainAgeDays <= 30) return 100;
  return Infinity; // No cap after 30 days
}

/**
 * Count emails sent today for a specific sequence.
 */
async function getSequenceSentToday(sequenceId: string): Promise<number> {
  const result = await query<any[]>(
    `SELECT COUNT(*) as count FROM email_events
     WHERE sequence_id = ? AND event_type = 'sent'
     AND DATE(occurred_at) = CURDATE()`,
    [sequenceId]
  );
  return result[0]?.count || 0;
}

/**
 * Count all emails sent today (across all sequences).
 */
async function getTotalSentToday(): Promise<number> {
  const result = await query<any[]>(
    `SELECT COUNT(*) as count FROM email_events
     WHERE event_type = 'sent'
     AND DATE(occurred_at) = CURDATE()`
  );
  return result[0]?.count || 0;
}

/**
 * Check for sequence enrollments that have a due send time
 * and process them.
 */
async function processDueSequenceEmails(): Promise<void> {
  // Find enrollments where it is time to send the next email
  const dueEnrollments = await query<any[]>(
    `SELECT se.*, es.status as sequence_status, es.settings as sequence_settings
     FROM sequence_enrollments se
     JOIN email_sequences es ON se.sequence_id = es.id
     WHERE se.status = 'active'
     AND se.next_send_at <= NOW()
     AND es.status = 'active'
     ORDER BY se.next_send_at ASC
     LIMIT 50`
  );

  if (dueEnrollments.length === 0) {
    return;
  }

  console.log(`Processing ${dueEnrollments.length} due sequence email(s)...`);

  // Cache warm-up limit and global counter at loop start
  const warmupLimit = await getWarmupDailyLimit();
  let globalSentToday = await getTotalSentToday();
  // Cache per-sequence counters: sequenceId -> sentToday
  const sequenceSentCache: Record<string, number> = {};

  for (const enrollment of dueEnrollments) {
    try {
      // Parse settings
      const settings = typeof enrollment.sequence_settings === 'string'
        ? JSON.parse(enrollment.sequence_settings)
        : enrollment.sequence_settings || {};

      // Check if prospect has replied (stop_on_reply setting)
      if (settings.stop_on_reply) {
        const replies = await query<any[]>(
          `SELECT id FROM email_events
           WHERE prospect_id = ? AND sequence_id = ? AND event_type = 'replied'
           LIMIT 1`,
          [enrollment.prospect_id, enrollment.sequence_id]
        );

        if (replies.length > 0) {
          // Mark enrollment as replied
          await query(
            `UPDATE sequence_enrollments SET status = 'replied', completed_at = NOW()
             WHERE id = ?`,
            [enrollment.id]
          );
          continue;
        }
      }

      // Check if prospect has bounced (stop_on_bounce setting)
      if (settings.stop_on_bounce) {
        const bounces = await query<any[]>(
          `SELECT id FROM email_events
           WHERE prospect_id = ? AND sequence_id = ? AND event_type = 'bounced'
           LIMIT 1`,
          [enrollment.prospect_id, enrollment.sequence_id]
        );

        if (bounces.length > 0) {
          await query(
            `UPDATE sequence_enrollments SET status = 'bounced', completed_at = NOW()
             WHERE id = ?`,
            [enrollment.id]
          );
          continue;
        }
      }

      // Get the current step
      const steps = await query<any[]>(
        `SELECT * FROM sequence_steps
         WHERE sequence_id = ? AND step_number = ? AND is_active = TRUE`,
        [enrollment.sequence_id, enrollment.current_step]
      );

      if (steps.length === 0) {
        // No more steps - mark as completed
        await query(
          `UPDATE sequence_enrollments SET status = 'completed', completed_at = NOW()
           WHERE id = ?`,
          [enrollment.id]
        );
        continue;
      }

      const step = steps[0];

      // Get prospect details for timezone-aware scheduling
      const prospects = await query<any[]>(
        'SELECT timezone, country, city FROM prospects WHERE id = ?',
        [enrollment.prospect_id]
      );
      const prospect = prospects.length > 0 ? prospects[0] : {};
      const prospectTz = resolveProspectTimezone(prospect);

      // Load sequence send_window
      const seqRows = await query<any[]>(
        'SELECT send_window FROM email_sequences WHERE id = ?',
        [enrollment.sequence_id]
      );
      const seqSendWindow = seqRows.length > 0
        ? (typeof seqRows[0].send_window === 'string'
            ? (() => { try { return JSON.parse(seqRows[0].send_window); } catch { return undefined; } })()
            : seqRows[0].send_window)
        : undefined;

      // Check if we're within the send window for this prospect
      if (!isWithinSendWindow(prospectTz, seqSendWindow)) {
        // Not in send window - reschedule to the next optimal time
        const nextOptimal = calculateOptimalSendTime(new Date(), prospectTz, seqSendWindow);
        await query(
          'UPDATE sequence_enrollments SET next_send_at = ? WHERE id = ?',
          [nextOptimal, enrollment.id]
        );
        console.log(`Rescheduled enrollment ${enrollment.id} to ${nextOptimal.toISOString()} (outside send window for ${prospectTz})`);
        continue;
      }

      // --- Warm-up & daily limit checks ---
      // Check global warm-up limit
      if (globalSentToday >= warmupLimit) {
        const tomorrow = calculateOptimalSendTime(
          new Date(Date.now() + 24 * 60 * 60 * 1000),
          prospectTz,
          seqSendWindow
        );
        await query(
          'UPDATE sequence_enrollments SET next_send_at = ? WHERE id = ?',
          [tomorrow, enrollment.id]
        );
        console.log(`Warm-up limit reached (${warmupLimit}/day). Rescheduled enrollment ${enrollment.id} to tomorrow.`);
        continue;
      }

      // Check per-sequence daily_limit
      const seqDailyLimit = settings.daily_limit || 50;
      if (!(enrollment.sequence_id in sequenceSentCache)) {
        sequenceSentCache[enrollment.sequence_id] = await getSequenceSentToday(enrollment.sequence_id);
      }
      if (sequenceSentCache[enrollment.sequence_id] >= seqDailyLimit) {
        const tomorrow = calculateOptimalSendTime(
          new Date(Date.now() + 24 * 60 * 60 * 1000),
          prospectTz,
          seqSendWindow
        );
        await query(
          'UPDATE sequence_enrollments SET next_send_at = ? WHERE id = ?',
          [tomorrow, enrollment.id]
        );
        console.log(`Sequence daily limit reached (${seqDailyLimit}/day) for sequence ${enrollment.sequence_id}. Rescheduled enrollment ${enrollment.id}.`);
        continue;
      }

      // Handle different step types
      if (step.step_type === 'email') {
        // Rate limit: wait 600ms before sending (max ~1.6/sec, within Resend's 2/sec limit)
        if (globalSentToday > 0) {
          await new Promise((resolve) => setTimeout(resolve, 600));
        }

        // Send the email
        await sendSequenceEmail(
          {
            id: enrollment.id,
            sequence_id: enrollment.sequence_id,
            prospect_id: enrollment.prospect_id,
            current_step: enrollment.current_step,
          },
          {
            id: step.id,
            subject: step.subject,
            body_html: step.body_html,
            body_text: step.body_text,
            step_number: step.step_number,
          }
        );

        // Increment cached counters after successful send
        globalSentToday++;
        sequenceSentCache[enrollment.sequence_id] = (sequenceSentCache[enrollment.sequence_id] || 0) + 1;
      }

      // Calculate next step send time
      const nextStepNumber = enrollment.current_step + 1;
      const nextStep = await query<any[]>(
        `SELECT * FROM sequence_steps
         WHERE sequence_id = ? AND step_number = ? AND is_active = TRUE`,
        [enrollment.sequence_id, nextStepNumber]
      );

      if (nextStep.length > 0) {
        // Calculate raw candidate time based on step delay
        const rawNextSendAt = new Date();
        rawNextSendAt.setDate(rawNextSendAt.getDate() + (nextStep[0].delay_days || 0));
        rawNextSendAt.setHours(rawNextSendAt.getHours() + (nextStep[0].delay_hours || 0));

        // Adjust to optimal send time for prospect's timezone (no weekends)
        const nextSendAt = calculateOptimalSendTime(rawNextSendAt, prospectTz, seqSendWindow);

        await query(
          `UPDATE sequence_enrollments SET current_step = ?, next_send_at = ? WHERE id = ?`,
          [nextStepNumber, nextSendAt, enrollment.id]
        );
      } else {
        // No more steps - mark as completed
        await query(
          `UPDATE sequence_enrollments SET status = 'completed', completed_at = NOW(), next_send_at = NULL
           WHERE id = ?`,
          [enrollment.id]
        );
      }
    } catch (error: any) {
      console.error(`Failed to process enrollment ${enrollment.id}:`, error.message);

      // Log activity about the failure
      await query(
        `INSERT INTO prospect_activities (id, prospect_id, activity_type, title, description)
         VALUES (?, ?, 'error', 'Sequence email failed', ?)`,
        [uuidv4(), enrollment.prospect_id, `Error: ${error.message}`]
      );
    }
  }
}

/**
 * Process scheduled outbox emails whose scheduled_for time has arrived.
 * Sends up to 20 emails per cycle with 600ms delay between sends.
 */
async function processScheduledOutboxEmails(): Promise<void> {
  const emailsToSend = await query<any[]>(
    `SELECT ge.*, p.email as prospect_email, p.first_name, p.last_name, p.full_name,
            p.title as prospect_title, p.do_not_contact,
            cam.name as campaign_name
     FROM generated_emails ge
     JOIN prospects p ON ge.prospect_id = p.id
     JOIN campaigns cam ON ge.campaign_id = cam.id
     WHERE ge.status = 'scheduled' AND ge.scheduled_for <= NOW()
     ORDER BY ge.scheduled_for ASC
     LIMIT 20`
  );

  if (emailsToSend.length === 0) {
    return;
  }

  console.log(`Processing ${emailsToSend.length} scheduled outbox email(s)...`);

  // Check warm-up limit
  const warmupLimit = await getWarmupDailyLimit();
  let globalSentToday = await getTotalSentToday();

  // Build from address
  const { config: envConfig } = await import('../config/env');
  const rawFrom = envConfig.EMAIL_FROM || 'noreply@camiacasa.cat';
  const fromAddress = rawFrom.includes('<') ? rawFrom : `Alfons Marques <${rawFrom}>`;

  let sent = 0;
  let failed = 0;

  for (const email of emailsToSend) {
    // Check global warm-up limit
    if (globalSentToday >= warmupLimit) {
      console.log(`Warm-up limit reached (${warmupLimit}/day). Stopping scheduled outbox processing.`);
      break;
    }

    // Rate limit: wait 600ms between sends
    if (sent > 0 || failed > 0) {
      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    // Skip do_not_contact
    if (email.do_not_contact) {
      console.log(`Skipping scheduled email ${email.id} - do_not_contact`);
      await query(
        `UPDATE generated_emails SET status = 'rejected',
         metadata = JSON_SET(COALESCE(metadata, '{}'), '$.skip_reason', 'do_not_contact')
         WHERE id = ?`,
        [email.id]
      );
      continue;
    }

    // Check suppression list
    const suppressed = await query<any[]>(
      'SELECT id FROM suppression_list WHERE email = ?',
      [email.prospect_email]
    );
    if (suppressed.length > 0) {
      console.log(`Skipping scheduled email ${email.id} - suppressed`);
      await query(
        `UPDATE generated_emails SET status = 'rejected',
         metadata = JSON_SET(COALESCE(metadata, '{}'), '$.skip_reason', 'suppressed')
         WHERE id = ?`,
        [email.id]
      );
      continue;
    }

    try {
      const result = await sendEmail(
        email.prospect_email,
        email.subject,
        email.body_html,
        undefined,
        fromAddress,
        envConfig.EMAIL_REPLY_TO
      );

      if (result.success) {
        await query(
          `UPDATE generated_emails SET status = 'sent', sent_at = NOW(),
           metadata = JSON_SET(COALESCE(metadata, '{}'), '$.resend_id', ?)
           WHERE id = ?`,
          [result.id, email.id]
        );

        await query(
          `UPDATE prospects SET last_contacted = NOW(),
           status = CASE WHEN status IN ('new', 'enriched', 'qualified') THEN 'contacted' ELSE status END
           WHERE id = ?`,
          [email.prospect_id]
        );

        await query(
          `INSERT INTO prospect_activities (id, prospect_id, activity_type, title, description)
           VALUES (?, ?, 'email_sent', ?, ?)`,
          [
            uuidv4(),
            email.prospect_id,
            `Email enviado (programado): Paso ${email.step_number}`,
            `Asunto: ${email.subject} | Propiedad: ${email.campaign_name}`,
          ]
        );

        sent++;
        globalSentToday++;
      } else {
        failed++;
        await query(
          `UPDATE generated_emails SET status = 'bounced',
           metadata = JSON_SET(COALESCE(metadata, '{}'), '$.error', 'Send failed')
           WHERE id = ?`,
          [email.id]
        );
      }
    } catch (sendError: any) {
      failed++;
      await query(
        `UPDATE generated_emails SET status = 'bounced',
         metadata = JSON_SET(COALESCE(metadata, '{}'), '$.error', ?)
         WHERE id = ?`,
        [sendError.message || 'Unknown error', email.id]
      );
    }
  }

  if (sent > 0 || failed > 0) {
    console.log(`Scheduled outbox: sent ${sent}, failed ${failed}`);
  }
}

/**
 * Process prospects that need enrichment but have not been enriched yet.
 */
async function processPendingEnrichments(): Promise<void> {
  // Find prospects that are new and not yet enriched
  const prospects = await query<any[]>(
    `SELECT id FROM prospects
     WHERE status = 'new'
     AND enrichment_data IS NULL
     AND do_not_contact = FALSE
     ORDER BY created_at ASC
     LIMIT 20`
  );

  if (prospects.length === 0) {
    return;
  }

  console.log(`Queuing ${prospects.length} prospect(s) for enrichment...`);

  for (const prospect of prospects) {
    await addJob('enrich_prospect', { prospect_id: prospect.id }, {
      queue: 'enrichment',
      priority: 1,
    });
  }
}
