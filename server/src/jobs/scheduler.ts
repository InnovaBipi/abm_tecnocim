import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { processJobs, addJob } from './queue';
import { sendSequenceEmail } from '../services/email';
import { recalculateAllScores } from '../services/scoring';

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

  console.log('Job scheduler started successfully.');
  console.log('  - Sequence emails: every 5 minutes');
  console.log('  - Job queue: every 5 minutes');
  console.log('  - Enrichments: every hour');
  console.log('  - Score recalculation: daily at 2 AM');
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

      // Handle different step types
      if (step.step_type === 'email') {
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
      }

      // Calculate next step send time
      const nextStepNumber = enrollment.current_step + 1;
      const nextStep = await query<any[]>(
        `SELECT * FROM sequence_steps
         WHERE sequence_id = ? AND step_number = ? AND is_active = TRUE`,
        [enrollment.sequence_id, nextStepNumber]
      );

      if (nextStep.length > 0) {
        // Calculate next send time based on step delay
        const nextSendAt = new Date();
        nextSendAt.setDate(nextSendAt.getDate() + (nextStep[0].delay_days || 0));
        nextSendAt.setHours(nextSendAt.getHours() + (nextStep[0].delay_hours || 0));

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
