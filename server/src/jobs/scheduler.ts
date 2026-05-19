import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { logger } from '../config/logger';
import { processJobs, addJob } from './queue';
import { sendEmail, sendSequenceEmail } from '../services/email';
import { recalculateAllScores } from '../services/scoring';
import { calculateOptimalSendTime, resolveProspectTimezone, isWithinSendWindow, getWarmupDailyLimit, getSentCountForDate } from '../services/scheduling';
import { pollImapForReplies } from '../services/imap';
import { getAllActiveTenants, getTenantConfig } from '../middleware/tenant';
import { resolveNextStep, evaluateConditionStep, EnrollmentContext } from './branching';
import { evaluateAbTestsForTenant } from './ab-testing';

// Daily digest accumulator: collects send results throughout the day per tenant
const dailyDigest = new Map<string, Array<{ name: string; email: string; subject: string; campaign: string; step: number; status: 'sent' | 'failed' | 'skipped'; reason?: string; tenant_id: string }>>();
let lastDigestDate = '';

/**
 * Initialize all scheduled jobs using node-cron.
 */
export function startScheduler(): void {
  logger.info('Starting job scheduler');

  // =============================================
  // Every 5 minutes: Check and send due sequence emails
  // =============================================
  cron.schedule('*/5 * * * *', async () => {
    try {
      await processDueSequenceEmails();
    } catch (error: any) {
      logger.error('Sequence email processing error', { error: error.message });
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
        logger.info('Processed queued jobs', { count: processed });
      }
    } catch (error: any) {
      logger.error('Job queue processing error', { error: error.message });
    }
  });

  // =============================================
  // Every hour: Process pending enrichment jobs
  // =============================================
  cron.schedule('0 * * * *', async () => {
    try {
      await processPendingEnrichments();
    } catch (error: any) {
      logger.error('Enrichment processing error', { error: error.message });
    }
  });

  // =============================================
  // Every day at 2 AM: Recalculate all scores
  // =============================================
  cron.schedule('0 2 * * *', async () => {
    try {
      logger.info('Starting daily score recalculation');
      const tenants = await getAllActiveTenants();
      for (const tenant of tenants) {
        const result = await recalculateAllScores(tenant.id);
        logger.info('Score recalculation complete', { tenant: tenant.name, processed: result.processed, errors: result.errors });
      }
      logger.info('Daily score recalculation complete for all tenants');

      // Also evaluate A/B test winners per tenant
      for (const tenant of tenants) {
        await evaluateAbTestsForTenant(tenant.id);
      }
    } catch (error: any) {
      logger.error('Daily score recalculation error', { error: error.message });
    }
  });

  // =============================================
  // Every 2 minutes: Process scheduled outbox emails
  // =============================================
  cron.schedule('*/2 * * * *', async () => {
    try {
      await processScheduledOutboxEmails();
    } catch (error: any) {
      logger.error('Scheduled outbox processing error', { error: error.message });
    }
  });

  // =============================================
  // Every 3 minutes: Poll IMAP for replies
  // =============================================
  cron.schedule('*/3 * * * *', async () => {
    try {
      await pollImapForReplies();
    } catch (error: any) {
      logger.error('IMAP polling error', { error: error.message });
    }
  });

  // =============================================
  // Daily at 19:00 CET (17:00 UTC): Send daily outbox digest
  // One email per tenant summarizing everything sent that day
  // =============================================
  cron.schedule('0 17 * * *', async () => {
    try {
      await sendDailyOutboxDigest();
    } catch (error: any) {
      logger.error('Daily outbox digest error', { error: error.message });
    }
  });

  logger.info('Job scheduler started', {
    jobs: 'sequences:5m, queue:5m, outbox:2m, imap:3m, enrichments:1h, scoring:2am, digest:17utc',
  });
}

// =============================================
// Warm-up & Daily Limit Helpers
// =============================================

/**
 * Calculate the max daily sends based on tenant config + domain age warm-up curve.
 *
 * Priority:
 * 1. Tenant config warmup (daily_limit_base → daily_limit_max over ramp_up_days)
 * 2. Default curve: Day 1-3: 5, Day 4-7: 15, Day 8-14: 30, Day 15-21: 50, Day 22-30: 100, Day 31+: no cap
 *
 * NOTE: getWarmupDailyLimit and getSentCountForDate are now imported from services/scheduling.ts
 */

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
 * Count all emails sent today (across all sequences + outbox).
 * Uses generated_emails as source of truth for outbox sends,
 * plus email_events for sequence sends, to avoid double-counting
 * from webhook echo events.
 */
async function getTotalSentToday(tenantId: string): Promise<number> {
  // Outbox sends (generated_emails)
  const outbox = await query<any[]>(
    `SELECT COUNT(*) as count FROM generated_emails
     WHERE status = 'sent' AND tenant_id = ? AND DATE(sent_at) = CURDATE()`,
    [tenantId]
  );
  // Sequence sends (email_events from sequence path, no resend_email_id overlap)
  const sequences = await query<any[]>(
    `SELECT COUNT(*) as count FROM email_events
     WHERE event_type = 'sent' AND tenant_id = ? AND DATE(occurred_at) = CURDATE()
     AND sequence_id IS NOT NULL`,
    [tenantId]
  );
  return (outbox[0]?.count || 0) + (sequences[0]?.count || 0);
}

/**
 * Check for sequence enrollments that have a due send time
 * and process them.
 */
async function processDueSequenceEmails(): Promise<void> {
  // Hard block: never send on weekends (Saturday=6, Sunday=0) in CET
  const nowCet = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  const dayOfWeek = nowCet.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return;
  }

  // Find enrollments where it is time to send the next email
  const dueEnrollments = await query<any[]>(
    `SELECT se.*, es.status as sequence_status, es.settings as sequence_settings, es.sequence_type, p.tenant_id
     FROM sequence_enrollments se
     JOIN email_sequences es ON se.sequence_id = es.id
     JOIN prospects p ON se.prospect_id = p.id
     WHERE se.status = 'active'
     AND se.next_send_at <= NOW()
     AND es.status = 'active'
     ORDER BY se.next_send_at ASC
     LIMIT 50`
  );

  if (dueEnrollments.length === 0) {
    return;
  }

  logger.info('Processing due sequence emails', { count: dueEnrollments.length });

  // Per-tenant warm-up cache: tenantId -> { limit, sentToday }
  const tenantWarmup = new Map<string, { limit: number; sentToday: number }>();
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
        logger.info('Rescheduled enrollment outside send window', { enrollmentId: enrollment.id, nextSendAt: nextOptimal.toISOString(), timezone: prospectTz });
        continue;
      }

      // --- Warm-up & daily limit checks (per-tenant) ---
      const enrollmentTenantId = enrollment.tenant_id;
      if (!tenantWarmup.has(enrollmentTenantId)) {
        tenantWarmup.set(enrollmentTenantId, {
          limit: await getWarmupDailyLimit(enrollmentTenantId),
          sentToday: await getTotalSentToday(enrollmentTenantId),
        });
      }
      const tw = tenantWarmup.get(enrollmentTenantId)!;

      // Check tenant warm-up limit
      if (tw.sentToday >= tw.limit) {
        const tomorrow = calculateOptimalSendTime(
          new Date(Date.now() + 24 * 60 * 60 * 1000),
          prospectTz,
          seqSendWindow
        );
        await query(
          'UPDATE sequence_enrollments SET next_send_at = ? WHERE id = ?',
          [tomorrow, enrollment.id]
        );
        logger.warn('Warm-up limit reached, rescheduled to tomorrow', { tenantId: enrollmentTenantId, dailyLimit: tw.limit, enrollmentId: enrollment.id });
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
        logger.warn('Sequence daily limit reached, rescheduled', { sequenceId: enrollment.sequence_id, dailyLimit: seqDailyLimit, enrollmentId: enrollment.id });
        continue;
      }

      // Handle different step types
      // Build enrollment context for branching
      const enrollmentCtx: EnrollmentContext = {
        id: enrollment.id,
        sequence_id: enrollment.sequence_id,
        prospect_id: enrollment.prospect_id,
        current_step: enrollment.current_step,
        current_step_id: enrollment.current_step_id,
        tenant_id: enrollment.tenant_id,
      };

      if (step.step_type === 'condition') {
        // Condition step: evaluate and route to YES/NO target — no email sent
        const condResult = await evaluateConditionStep(step, enrollmentCtx);
        if (condResult) {
          const { step: targetStep, conditionResult, conditionStepId } = condResult;
          const rawNext = new Date();
          rawNext.setDate(rawNext.getDate() + (targetStep.delay_days || 0));
          rawNext.setHours(rawNext.getHours() + (targetStep.delay_hours || 0));
          const nextSendAt = calculateOptimalSendTime(rawNext, prospectTz, seqSendWindow);

          const pathEntry = JSON.stringify({
            from_step: step.step_number,
            condition_step: conditionStepId || step.id,
            to_step: targetStep.step_number,
            condition_result: conditionResult,
            evaluated_at: new Date().toISOString(),
          });

          await query(
            `UPDATE sequence_enrollments
             SET current_step = ?, current_step_id = ?, next_send_at = ?,
                 path_history = JSON_ARRAY_APPEND(COALESCE(path_history, JSON_ARRAY()), '$', CAST(? AS JSON))
             WHERE id = ? AND tenant_id = ?`,
            [targetStep.step_number, targetStep.id, nextSendAt, pathEntry, enrollment.id, enrollment.tenant_id]
          );
          logger.info('Condition step evaluated', { stepNumber: step.step_number, result: conditionResult ? 'YES' : 'NO', targetStep: targetStep.step_number });
        } else {
          await query(
            `UPDATE sequence_enrollments SET status = 'completed', completed_at = NOW(), next_send_at = NULL
             WHERE id = ? AND tenant_id = ?`,
            [enrollment.id, enrollment.tenant_id]
          );
        }
        continue; // Skip to next enrollment — no email to send
      }

      if (step.step_type === 'email') {
        // Rate limit: wait 600ms before sending (max ~1.6/sec, within Resend's 2/sec limit)
        if (tw.sentToday > 0) {
          await new Promise((resolve) => setTimeout(resolve, 600));
        }

        // Send the email
        await sendSequenceEmail(
          {
            id: enrollment.id,
            sequence_id: enrollment.sequence_id,
            prospect_id: enrollment.prospect_id,
            current_step: enrollment.current_step,
            tenant_id: enrollment.tenant_id,
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
        tw.sentToday++;
        sequenceSentCache[enrollment.sequence_id] = (sequenceSentCache[enrollment.sequence_id] || 0) + 1;
      }

      // Resolve next step (supports both linear and branched sequences)
      const nextResult = await resolveNextStep(enrollmentCtx, step);

      if (nextResult) {
        const { step: nextStep, conditionResult, conditionStepId } = nextResult;

        // Calculate raw candidate time based on next step delay
        const rawNextSendAt = new Date();
        rawNextSendAt.setDate(rawNextSendAt.getDate() + (nextStep.delay_days || 0));
        rawNextSendAt.setHours(rawNextSendAt.getHours() + (nextStep.delay_hours || 0));

        // Adjust to optimal send time for prospect's timezone (no weekends)
        const nextSendAt = calculateOptimalSendTime(rawNextSendAt, prospectTz, seqSendWindow);

        // Build path_history entry for branched sequences
        const pathEntry = conditionResult !== undefined ? JSON.stringify({
          from_step: step.step_number,
          condition_step: conditionStepId,
          to_step: nextStep.step_number,
          condition_result: conditionResult,
          evaluated_at: new Date().toISOString(),
        }) : null;

        if (pathEntry) {
          await query(
            `UPDATE sequence_enrollments
             SET current_step = ?, current_step_id = ?, next_send_at = ?,
                 path_history = JSON_ARRAY_APPEND(COALESCE(path_history, JSON_ARRAY()), '$', CAST(? AS JSON))
             WHERE id = ? AND tenant_id = ?`,
            [nextStep.step_number, nextStep.id, nextSendAt, pathEntry, enrollment.id, enrollment.tenant_id]
          );
        } else {
          await query(
            `UPDATE sequence_enrollments SET current_step = ?, current_step_id = ?, next_send_at = ?
             WHERE id = ? AND tenant_id = ?`,
            [nextStep.step_number, nextStep.id, nextSendAt, enrollment.id, enrollment.tenant_id]
          );
        }
      } else {
        // No more steps - mark as completed
        await query(
          `UPDATE sequence_enrollments SET status = 'completed', completed_at = NOW(), next_send_at = NULL
           WHERE id = ? AND tenant_id = ?`,
          [enrollment.id, enrollment.tenant_id]
        );
      }
    } catch (error: any) {
      logger.error('Failed to process enrollment', { enrollmentId: enrollment.id, error: error.message });

      // Log activity about the failure
      await query(
        `INSERT INTO prospect_activities (id, tenant_id, prospect_id, activity_type, title, description)
         VALUES (?, ?, ?, 'error', 'Sequence email failed', ?)`,
        [uuidv4(), enrollment.tenant_id, enrollment.prospect_id, `Error: ${error.message}`]
      );
    }
  }
}

/**
 * Auto-cancel follow-up emails where a previous step bounced.
 * Runs before sending to prevent orphaned scheduled emails.
 */
async function cancelBouncedFollowups(): Promise<void> {
  // Find prospect+campaign combos where any step has bounced
  const bounced = await query<any[]>(
    `SELECT DISTINCT prospect_id, campaign_id FROM generated_emails
     WHERE status = 'bounced'`
  );

  for (const b of bounced) {
    await query(
      `UPDATE generated_emails
       SET status = 'rejected',
           metadata = JSON_SET(COALESCE(metadata, '{}'), '$.skip_reason', 'previous_step_bounced')
       WHERE prospect_id = ? AND campaign_id = ? AND status = 'scheduled'
       AND step_number > (
         SELECT MIN(step_number) FROM (
           SELECT step_number FROM generated_emails
           WHERE prospect_id = ? AND campaign_id = ? AND status = 'bounced'
         ) as bounced_steps
       )`,
      [b.prospect_id, b.campaign_id, b.prospect_id, b.campaign_id]
    );
  }
}

/**
 * Auto-cancel follow-up emails where the prospect has replied.
 * If the reply is classified as negative/unsubscribe, also marks prospect as do_not_contact.
 * Runs before sending to prevent emailing prospects who already responded.
 */
async function cancelRepliedFollowups(): Promise<void> {
  // Find prospects who have replied (from IMAP detection or webhooks)
  const replied = await query<any[]>(
    `SELECT DISTINCT ee.prospect_id, ge.campaign_id, ee.metadata
     FROM email_events ee
     JOIN generated_emails ge ON ge.prospect_id = ee.prospect_id AND ge.status = 'scheduled'
     WHERE ee.event_type = 'replied'`
  );

  for (const r of replied) {
    // Cancel all scheduled follow-ups for this prospect+campaign
    const result = await query<any>(
      `UPDATE generated_emails
       SET status = 'rejected',
           metadata = JSON_SET(COALESCE(metadata, '{}'), '$.skip_reason', 'prospect_replied')
       WHERE prospect_id = ? AND campaign_id = ? AND status = 'scheduled'`,
      [r.prospect_id, r.campaign_id]
    );

    if (result.affectedRows > 0) {
      logger.info('Cancelled scheduled emails for replied prospect', { count: result.affectedRows, prospectId: r.prospect_id, campaignId: r.campaign_id });
    }

    // If reply was classified as negative/unsubscribe, mark prospect
    let classification: string | undefined;
    try {
      const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
      classification = meta?.reply_classification;
    } catch { /* ignore parse errors */ }

    if (classification === 'negative' || classification === 'unsubscribe') {
      // Also cancel ALL scheduled emails across all campaigns for this prospect
      await query(
        `UPDATE generated_emails
         SET status = 'rejected',
             metadata = JSON_SET(COALESCE(metadata, '{}'), '$.skip_reason', 'prospect_rejected')
         WHERE prospect_id = ? AND status = 'scheduled'`,
        [r.prospect_id]
      );

      // Mark prospect to prevent future outreach
      await query(
        `UPDATE prospects SET status = 'rejected', do_not_contact = TRUE WHERE id = ? AND do_not_contact = FALSE`,
        [r.prospect_id]
      );
    }
  }
}

/**
 * Rescue emails that were incorrectly scheduled on weekend dates.
 * Runs on Mondays only. Reschedules them to NOW() so they get picked up this cycle.
 */
async function rescueWeekendEmails(): Promise<void> {
  const tenants = await getAllActiveTenants();
  for (const tenant of tenants) {
    const [result] = await query<any[]>(
      `SELECT COUNT(*) as cnt FROM generated_emails
       WHERE tenant_id = ? AND status = 'scheduled' AND DAYOFWEEK(scheduled_for) IN (1, 7) AND scheduled_for < NOW()`,
      [tenant.id]
    );
    if (result.cnt > 0) {
      logger.info('Monday rescue: rescheduling weekend-dated emails', { tenant: tenant.name, count: result.cnt });
      await query(
        `UPDATE generated_emails SET scheduled_for = NOW()
         WHERE tenant_id = ? AND status = 'scheduled' AND DAYOFWEEK(scheduled_for) IN (1, 7) AND scheduled_for < NOW()`,
        [tenant.id]
      );
    }
  }
}

/**
 * Process scheduled outbox emails whose scheduled_for time has arrived.
 * Sends up to 20 emails per cycle with 600ms delay between sends.
 */
async function processScheduledOutboxEmails(): Promise<void> {
  // Hard block: never send on weekends (Saturday=6, Sunday=0) in CET
  const nowCet = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  const dayOfWeek = nowCet.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return;
  }

  // Monday rescue: reschedule emails incorrectly set for weekend dates
  if (dayOfWeek === 1) {
    await rescueWeekendEmails();
  }

  // Auto-cancel follow-ups after bounces and replies
  await cancelBouncedFollowups();
  await cancelRepliedFollowups();

  // Only send step N if step N-1 for the same prospect+campaign is already 'sent' (or it's step 1)
  const emailsToSend = await query<any[]>(
    `SELECT ge.*, p.email as prospect_email, p.first_name, p.last_name, p.full_name,
            p.title as prospect_title, p.do_not_contact, p.tenant_id,
            cam.name as campaign_name
     FROM generated_emails ge
     JOIN prospects p ON ge.prospect_id = p.id
     JOIN campaigns cam ON ge.campaign_id = cam.id
     WHERE ge.status = 'scheduled' AND ge.scheduled_for <= NOW()
       AND DAYOFWEEK(ge.scheduled_for) NOT IN (1, 7)
       AND cam.status = 'active'
       AND (ge.step_number = 1 OR EXISTS (
         SELECT 1 FROM generated_emails prev
         WHERE prev.prospect_id = ge.prospect_id
           AND prev.campaign_id = ge.campaign_id
           AND prev.step_number = ge.step_number - 1
           AND prev.status = 'sent'
       ))
     ORDER BY ge.scheduled_for ASC
     LIMIT 20`
  );

  if (emailsToSend.length === 0) {
    return;
  }

  logger.info('Processing scheduled outbox emails', { count: emailsToSend.length });

  // Per-tenant warm-up cache: tenantId -> { limit, sentToday }
  const tenantWarmup = new Map<string, { limit: number; sentToday: number }>();

  let sent = 0;
  let failed = 0;
  const results: Array<{ name: string; email: string; subject: string; campaign: string; step: number; status: 'sent' | 'failed' | 'skipped'; reason?: string; tenant_id: string }> = [];

  for (const email of emailsToSend) {
    const prospectName = email.full_name || `${email.first_name || ''} ${email.last_name || ''}`.trim() || email.prospect_email;
    const emailTenantId = email.tenant_id;

    // Resolve per-tenant warm-up
    if (!tenantWarmup.has(emailTenantId)) {
      tenantWarmup.set(emailTenantId, {
        limit: await getWarmupDailyLimit(emailTenantId),
        sentToday: await getTotalSentToday(emailTenantId),
      });
    }
    const tw = tenantWarmup.get(emailTenantId)!;

    // Check tenant warm-up limit
    if (tw.sentToday >= tw.limit) {
      logger.warn('Warm-up limit reached, skipping email', { tenantId: emailTenantId, dailyLimit: tw.limit, emailId: email.id });
      results.push({ name: prospectName, email: email.prospect_email, subject: email.subject, campaign: email.campaign_name, step: email.step_number, status: 'skipped', reason: `Limite warm-up alcanzado (${tw.limit}/dia)`, tenant_id: emailTenantId });
      continue;
    }

    // Rate limit: wait 600ms between sends
    if (sent > 0 || failed > 0) {
      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    // Skip if prospect has replied to any email in this campaign
    const prospectReplied = await query<any[]>(
      `SELECT id FROM email_events
       WHERE prospect_id = ? AND event_type = 'replied' LIMIT 1`,
      [email.prospect_id]
    );
    if (prospectReplied.length > 0) {
      logger.info('Skipping scheduled email, prospect replied', { emailId: email.id });
      await query(
        `UPDATE generated_emails SET status = 'rejected',
         metadata = JSON_SET(COALESCE(metadata, '{}'), '$.skip_reason', 'prospect_replied')
         WHERE id = ?`,
        [email.id]
      );
      results.push({ name: prospectName, email: email.prospect_email, subject: email.subject, campaign: email.campaign_name, step: email.step_number, status: 'skipped', reason: 'prospecto respondió', tenant_id: emailTenantId });
      continue;
    }

    // Skip do_not_contact
    if (email.do_not_contact) {
      logger.info('Skipping scheduled email, do_not_contact', { emailId: email.id });
      await query(
        `UPDATE generated_emails SET status = 'rejected',
         metadata = JSON_SET(COALESCE(metadata, '{}'), '$.skip_reason', 'do_not_contact')
         WHERE id = ?`,
        [email.id]
      );
      results.push({ name: prospectName, email: email.prospect_email, subject: email.subject, campaign: email.campaign_name, step: email.step_number, status: 'skipped', reason: 'do_not_contact', tenant_id: emailTenantId });
      continue;
    }

    // Check suppression list (scoped by tenant)
    const suppressed = await query<any[]>(
      'SELECT id FROM suppression_list WHERE email = ? AND tenant_id = ?',
      [email.prospect_email, emailTenantId]
    );
    if (suppressed.length > 0) {
      logger.info('Skipping scheduled email, suppressed', { emailId: email.id });
      await query(
        `UPDATE generated_emails SET status = 'rejected',
         metadata = JSON_SET(COALESCE(metadata, '{}'), '$.skip_reason', 'suppressed')
         WHERE id = ?`,
        [email.id]
      );
      results.push({ name: prospectName, email: email.prospect_email, subject: email.subject, campaign: email.campaign_name, step: email.step_number, status: 'skipped', reason: 'lista de supresion', tenant_id: emailTenantId });
      continue;
    }

    try {
      // Resolve per-tenant email config
      const tenant = await getTenantConfig(emailTenantId);
      const tenantEmail = tenant?.config?.email;
      const rawFrom = tenantEmail?.from_email || 'noreply@example.com';
      const fromName = tenantEmail?.from_name || 'Tecnocim Innova';
      const fromAddress = `${fromName} <${rawFrom}>`;
      const replyTo = tenantEmail?.reply_to || undefined;

      const result = await sendEmail(
        email.prospect_email,
        email.subject,
        email.body_html,
        undefined,
        fromAddress,
        replyTo,
        emailTenantId
      );

      if (result.success) {
        await query(
          `UPDATE generated_emails SET status = 'sent', sent_at = NOW(),
           metadata = JSON_SET(COALESCE(metadata, '{}'), '$.resend_id', ?)
           WHERE id = ?`,
          [result.id, email.id]
        );

        // Record email_event 'sent' so webhook follow-ups (delivered/opened/clicked) can link back
        await query(
          `INSERT INTO email_events (id, tenant_id, prospect_id, event_type, resend_email_id, subject, from_email)
           VALUES (?, ?, ?, 'sent', ?, ?, ?)`,
          [
            uuidv4(),
            emailTenantId,
            email.prospect_id,
            result.id,
            email.subject,
            fromAddress,
          ]
        );

        await query(
          `UPDATE prospects SET last_contacted = NOW(),
           status = CASE WHEN status IN ('new', 'enriched', 'qualified') THEN 'contacted' ELSE status END
           WHERE id = ?`,
          [email.prospect_id]
        );

        await query(
          `INSERT INTO prospect_activities (id, tenant_id, prospect_id, activity_type, title, description)
           VALUES (?, ?, ?, 'email_sent', ?, ?)`,
          [
            uuidv4(),
            emailTenantId,
            email.prospect_id,
            `Email enviado (programado): Paso ${email.step_number}`,
            `Asunto: ${email.subject} | Campaña: ${email.campaign_name}`,
          ]
        );

        sent++;
        tw.sentToday++;
        results.push({ name: prospectName, email: email.prospect_email, subject: email.subject, campaign: email.campaign_name, step: email.step_number, status: 'sent', tenant_id: emailTenantId });
      } else {
        failed++;
        await query(
          `UPDATE generated_emails SET status = 'bounced',
           metadata = JSON_SET(COALESCE(metadata, '{}'), '$.error', 'Send failed')
           WHERE id = ?`,
          [email.id]
        );
        results.push({ name: prospectName, email: email.prospect_email, subject: email.subject, campaign: email.campaign_name, step: email.step_number, status: 'failed', reason: 'Envio fallido', tenant_id: emailTenantId });
      }
    } catch (sendError: any) {
      failed++;
      await query(
        `UPDATE generated_emails SET status = 'bounced',
         metadata = JSON_SET(COALESCE(metadata, '{}'), '$.error', ?)
         WHERE id = ?`,
        [sendError.message || 'Unknown error', email.id]
      );
      results.push({ name: prospectName, email: email.prospect_email, subject: email.subject, campaign: email.campaign_name, step: email.step_number, status: 'failed', reason: sendError.message || 'Error desconocido', tenant_id: emailTenantId });
    }
  }

  if (sent > 0 || failed > 0) {
    logger.info('Scheduled outbox cycle complete', { sent, failed });
  }

  // Results are now queried from DB at digest time — no in-memory accumulation needed
}

/**
 * Send a summary notification email after processing scheduled outbox emails.
 * Scoped per tenant - reads notification_email from tenant config.
 */
async function sendOutboxNotification(
  results: Array<{ name: string; email: string; subject: string; campaign: string; step: number; status: string; reason?: string; tenant_id: string }>,
  sent: number,
  failed: number,
  tenantId: string
): Promise<void> {
  const tenant = await getTenantConfig(tenantId);
  if (!tenant) {
    logger.warn('Cannot send outbox notification, tenant not found', { tenantId });
    return;
  }

  const notificationEmail = tenant.config?.email?.notification_email;
  if (!notificationEmail) {
    logger.warn('No notification_email configured, skipping notification', { tenant: tenant.name });
    return;
  }

  const tenantEmail = tenant.config?.email;
  const rawFrom = tenantEmail?.from_email || 'noreply@example.com';
  const fromName = tenantEmail?.from_name || 'Tecnocim Innova';
  const fromAddress = `${fromName} <${rawFrom}>`;
  const tenantName = tenant.name || 'Tecnocim Innova';
  const skipped = results.filter(r => r.status === 'skipped').length;
  const now = new Date().toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Madrid' });

  const sentRows = results.filter(r => r.status === 'sent')
    .map(r => `<tr><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">✅</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0"><strong>${r.name}</strong><br><span style="color:#64748b;font-size:12px">${r.email}</span></td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${r.subject}</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;text-align:center">${r.step}</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${r.campaign}</td></tr>`)
    .join('');

  const failedRows = results.filter(r => r.status === 'failed')
    .map(r => `<tr><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">❌</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0"><strong>${r.name}</strong><br><span style="color:#64748b;font-size:12px">${r.email}</span></td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${r.subject}</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;text-align:center">${r.step}</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;color:#dc2626">${r.reason}</td></tr>`)
    .join('');

  const skippedRows = results.filter(r => r.status === 'skipped')
    .map(r => `<tr><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">⏭️</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0"><strong>${r.name}</strong><br><span style="color:#64748b;font-size:12px">${r.email}</span></td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0">${r.subject}</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;text-align:center">${r.step}</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;color:#d97706">${r.reason}</td></tr>`)
    .join('');

  const statusEmoji = failed > 0 ? '⚠️' : '✅';
  const statusText = failed > 0 ? `${sent} enviados, ${failed} fallidos` : `${sent} enviados correctamente`;

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:700px;margin:0 auto">
  <div style="background:#1e293b;color:white;padding:20px 24px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">${statusEmoji} Outbox: ${statusText}</h2>
    <p style="margin:4px 0 0;font-size:13px;color:#94a3b8">${now}</p>
  </div>
  <div style="background:#f8fafc;padding:20px 24px;border:1px solid #e2e8f0;border-top:none">
    <div style="display:flex;gap:16px;margin-bottom:20px">
      <div style="background:white;padding:12px 20px;border-radius:8px;border:1px solid #e2e8f0;text-align:center;flex:1">
        <div style="font-size:24px;font-weight:bold;color:#059669">${sent}</div>
        <div style="font-size:12px;color:#64748b">Enviados</div>
      </div>
      <div style="background:white;padding:12px 20px;border-radius:8px;border:1px solid #e2e8f0;text-align:center;flex:1">
        <div style="font-size:24px;font-weight:bold;color:#dc2626">${failed}</div>
        <div style="font-size:12px;color:#64748b">Fallidos</div>
      </div>
      <div style="background:white;padding:12px 20px;border-radius:8px;border:1px solid #e2e8f0;text-align:center;flex:1">
        <div style="font-size:24px;font-weight:bold;color:#d97706">${skipped}</div>
        <div style="font-size:12px;color:#64748b">Omitidos</div>
      </div>
    </div>
    ${sentRows ? `
    <h3 style="font-size:14px;color:#059669;margin:16px 0 8px">Enviados correctamente</h3>
    <table style="width:100%;border-collapse:collapse;background:white;border-radius:6px;font-size:13px;border:1px solid #e2e8f0">
      <tr style="background:#f1f5f9"><th style="padding:8px 12px;text-align:left;width:30px"></th><th style="padding:8px 12px;text-align:left">Prospecto</th><th style="padding:8px 12px;text-align:left">Asunto</th><th style="padding:8px 12px;text-align:center;width:50px">Paso</th><th style="padding:8px 12px;text-align:left">Propiedad</th></tr>
      ${sentRows}
    </table>` : ''}
    ${failedRows ? `
    <h3 style="font-size:14px;color:#dc2626;margin:16px 0 8px">Fallidos</h3>
    <table style="width:100%;border-collapse:collapse;background:white;border-radius:6px;font-size:13px;border:1px solid #e2e8f0">
      <tr style="background:#fef2f2"><th style="padding:8px 12px;text-align:left;width:30px"></th><th style="padding:8px 12px;text-align:left">Prospecto</th><th style="padding:8px 12px;text-align:left">Asunto</th><th style="padding:8px 12px;text-align:center;width:50px">Paso</th><th style="padding:8px 12px;text-align:left">Error</th></tr>
      ${failedRows}
    </table>` : ''}
    ${skippedRows ? `
    <h3 style="font-size:14px;color:#d97706;margin:16px 0 8px">Omitidos</h3>
    <table style="width:100%;border-collapse:collapse;background:white;border-radius:6px;font-size:13px;border:1px solid #e2e8f0">
      <tr style="background:#fffbeb"><th style="padding:8px 12px;text-align:left;width:30px"></th><th style="padding:8px 12px;text-align:left">Prospecto</th><th style="padding:8px 12px;text-align:left">Asunto</th><th style="padding:8px 12px;text-align:center;width:50px">Paso</th><th style="padding:8px 12px;text-align:left">Motivo</th></tr>
      ${skippedRows}
    </table>` : ''}
  </div>
  <div style="padding:12px 24px;font-size:11px;color:#94a3b8;text-align:center;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
    ${tenantName} ABM — Notificacion automatica del scheduler
  </div>
</div>`;

  await sendEmail(
    notificationEmail,
    `${statusEmoji} Outbox: ${statusText}`,
    html,
    undefined,
    fromAddress,
    undefined,
    tenantId
  );
  logger.info('Outbox notification sent', { to: notificationEmail, tenant: tenantName });
}

/**
 * Send a single daily digest email per tenant with everything sent/failed today.
 * Queries the DB directly (survives server restarts) and uses a DB flag to guarantee
 * exactly 1 notification email per tenant per day — never more.
 */
async function sendDailyOutboxDigest(): Promise<void> {
  const tenants = await getAllActiveTenants();
  const today = new Date().toISOString().slice(0, 10);

  for (const tenant of tenants) {
    try {
      // Check if digest was already sent today for this tenant (survives restarts).
      // Uses imap_sync_state with mailbox='DIGEST' as a lightweight flag.
      const alreadySent = await query<any[]>(
        `SELECT id FROM imap_sync_state
         WHERE tenant_id = ? AND mailbox = 'DIGEST'
         AND DATE(last_synced_at) = CURDATE()
         LIMIT 1`,
        [tenant.id]
      );

      if (alreadySent.length > 0) {
        logger.debug('Daily digest already sent today, skipping', { tenant: tenant.name });
        continue;
      }

      // Query today's actual send results directly from the DB
      const sentEmails = await query<any[]>(
        `SELECT ge.subject, ge.step_number, ge.sent_at,
                p.email as prospect_email, p.first_name, p.last_name, p.full_name,
                cam.name as campaign_name
         FROM generated_emails ge
         JOIN prospects p ON ge.prospect_id = p.id
         JOIN campaigns cam ON ge.campaign_id = cam.id
         WHERE ge.tenant_id = ? AND ge.status = 'sent' AND DATE(ge.sent_at) = CURDATE()
         ORDER BY ge.sent_at`,
        [tenant.id]
      );

      const failedEmails = await query<any[]>(
        `SELECT ge.subject, ge.step_number,
                p.email as prospect_email, p.first_name, p.last_name, p.full_name,
                cam.name as campaign_name,
                JSON_EXTRACT(ge.metadata, '$.error') as error_msg
         FROM generated_emails ge
         JOIN prospects p ON ge.prospect_id = p.id
         JOIN campaigns cam ON ge.campaign_id = cam.id
         WHERE ge.tenant_id = ? AND ge.status = 'bounced' AND DATE(ge.updated_at) = CURDATE()`,
        [tenant.id]
      );

      const skippedEmails = await query<any[]>(
        `SELECT ge.subject, ge.step_number,
                p.email as prospect_email, p.first_name, p.last_name, p.full_name,
                cam.name as campaign_name,
                JSON_EXTRACT(ge.metadata, '$.skip_reason') as skip_reason
         FROM generated_emails ge
         JOIN prospects p ON ge.prospect_id = p.id
         JOIN campaigns cam ON ge.campaign_id = cam.id
         WHERE ge.tenant_id = ? AND ge.status = 'rejected' AND DATE(ge.updated_at) = CURDATE()`,
        [tenant.id]
      );

      const totalSent = sentEmails.length;
      const totalFailed = failedEmails.length;

      if (totalSent === 0 && totalFailed === 0) {
        logger.debug('Daily digest: nothing to report', { tenant: tenant.name });
        continue;
      }

      // Build results array for the notification formatter
      const results = [
        ...sentEmails.map((e: any) => ({
          name: e.full_name || `${e.first_name || ''} ${e.last_name || ''}`.trim(),
          email: e.prospect_email, subject: e.subject, campaign: e.campaign_name,
          step: e.step_number, status: 'sent' as const, tenant_id: tenant.id,
        })),
        ...failedEmails.map((e: any) => ({
          name: e.full_name || `${e.first_name || ''} ${e.last_name || ''}`.trim(),
          email: e.prospect_email, subject: e.subject, campaign: e.campaign_name,
          step: e.step_number, status: 'failed' as const, reason: e.error_msg || 'Error', tenant_id: tenant.id,
        })),
        ...skippedEmails.map((e: any) => ({
          name: e.full_name || `${e.first_name || ''} ${e.last_name || ''}`.trim(),
          email: e.prospect_email, subject: e.subject, campaign: e.campaign_name,
          step: e.step_number, status: 'skipped' as const, reason: e.skip_reason || 'Skipped', tenant_id: tenant.id,
        })),
      ];

      await sendOutboxNotification(results, totalSent, totalFailed, tenant.id);

      // Mark digest as sent today in the DB (prevents duplicates even on restart).
      // Uses imap_sync_state with mailbox='DIGEST' as a lightweight flag.
      const existingDigestRow = await query<any[]>(
        `SELECT id FROM imap_sync_state WHERE tenant_id = ? AND mailbox = 'DIGEST' LIMIT 1`,
        [tenant.id]
      );
      if (existingDigestRow.length > 0) {
        await query(
          `UPDATE imap_sync_state SET last_synced_at = NOW() WHERE tenant_id = ? AND mailbox = 'DIGEST'`,
          [tenant.id]
        );
      } else {
        await query(
          `INSERT INTO imap_sync_state (id, tenant_id, mailbox, last_uid, last_synced_at) VALUES (?, ?, 'DIGEST', 0, NOW())`,
          [uuidv4(), tenant.id]
        );
      }

      logger.info('Daily digest sent', { tenant: tenant.name, sent: totalSent, failed: totalFailed });
    } catch (err: any) {
      logger.error('Failed to send daily digest', { tenant: tenant.name, error: err.message });
    }
  }

  // Clear in-memory accumulator (no longer needed but keep tidy)
  dailyDigest.clear();
  lastDigestDate = '';
}

/**
 * Process prospects that need enrichment but have not been enriched yet.
 */
async function processPendingEnrichments(): Promise<void> {
  // Find prospects that are new and not yet enriched
  const prospects = await query<any[]>(
    `SELECT id, tenant_id FROM prospects
     WHERE status = 'new'
     AND enrichment_data IS NULL
     AND do_not_contact = FALSE
     ORDER BY created_at ASC
     LIMIT 20`
  );

  if (prospects.length === 0) {
    return;
  }

  logger.info('Queuing prospects for enrichment', { count: prospects.length });

  for (const prospect of prospects) {
    await addJob('enrich_prospect', { prospect_id: prospect.id, tenant_id: prospect.tenant_id }, {
      queue: 'enrichment',
      priority: 1,
    });
  }
}
