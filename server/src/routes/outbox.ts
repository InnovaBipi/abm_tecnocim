import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate } from '../middleware/auth';
import { getTenantConfig } from '../middleware/tenant';
import { calculateOptimalSendTime, resolveProspectTimezone, distributeEmailsAcrossBusinessDays, getWarmupDailyLimit, isBusinessDay } from '../services/scheduling';
import { resolveSender, type ResolvedSender } from '../services/sender';
import { checkCrossCampaignContact, shouldSkipEmail, type GuardVerdict } from '../services/contactGuard';

const router = Router();

// Defensive cap to bound batch send / approve loops (cost / DoS).
const MAX_EMAIL_IDS = 200;

// Bounded array of UUIDs for batch operations on email ids.
const emailIdsSchema = z
  .array(z.string().uuid())
  .min(1, 'email_ids array is required')
  .max(MAX_EMAIL_IDS, `email_ids cannot exceed ${MAX_EMAIL_IDS} per request`);

// Calendar day (interpreted in server local time) for future-dated redistribution.
const startDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start_date must be YYYY-MM-DD');

router.use(authenticate);

// --- GET / - List all generated emails cross-campaign ---
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const status = req.query.status as string;
    const campaignId = req.query.campaign_id as string;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    let whereClauses: string[] = ['ge.tenant_id = ?'];
    let params: any[] = [req.user!.tenantId];

    if (status) {
      whereClauses.push('ge.status = ?');
      params.push(status);
    }

    if (campaignId) {
      whereClauses.push('ge.campaign_id = ?');
      params.push(campaignId);
    }

    const whereSQL = 'WHERE ' + whereClauses.join(' AND ');

    const countResult = await query<any[]>(
      `SELECT COUNT(*) as total FROM generated_emails ge ${whereSQL}`,
      params
    );
    const total = countResult[0].total;

    const emails = await query<any[]>(
      `SELECT ge.id, ge.tenant_id, ge.campaign_id, ge.prospect_id, ge.step_number,
              ge.subject, ge.body_html, ge.delay_days, ge.status,
              ge.approved_at, ge.approved_by, ge.sent_at, ge.scheduled_for,
              ge.metadata, ge.created_at, ge.updated_at,
              p.first_name, p.last_name, p.full_name, p.email as prospect_email,
              p.title as prospect_title, cam.name as campaign_name,
              cam.asset_type, cam.asset_location,
              cam.sender_user_id, su.sender_name, su.sender_email
       FROM generated_emails ge
       JOIN prospects p ON ge.prospect_id = p.id AND p.tenant_id = ge.tenant_id
       JOIN campaigns cam ON ge.campaign_id = cam.id AND cam.tenant_id = ge.tenant_id
       LEFT JOIN users su ON cam.sender_user_id = su.id AND su.tenant_id = ge.tenant_id
       ${whereSQL}
       ORDER BY ge.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: {
        emails,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error: any) {
    console.error('Outbox list error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while fetching outbox.' });
  }
});

// --- GET /stats - Counts by status ---
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const stats = await query<any[]>(
      `SELECT status, COUNT(*) as count FROM generated_emails WHERE tenant_id = ? GROUP BY status`,
      [req.user!.tenantId]
    );

    const totalResult = await query<any[]>(
      `SELECT COUNT(*) as total FROM generated_emails WHERE tenant_id = ?`,
      [req.user!.tenantId]
    );

    res.json({
      success: true,
      data: {
        total: totalResult[0].total,
        byStatus: stats.reduce((acc: any, row: any) => {
          acc[row.status] = row.count;
          return acc;
        }, {}),
      },
    });
  } catch (error: any) {
    console.error('Outbox stats error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while fetching outbox stats.' });
  }
});

// --- PUT /:emailId/approve - Approve → Schedule single email (warmup-aware) ---
router.put('/:emailId/approve', async (req: Request, res: Response): Promise<void> => {
  try {
    const { emailId } = req.params;
    const tenantId = req.user!.tenantId;

    // Get email with prospect data for timezone calculation
    const emails = await query<any[]>(
      `SELECT ge.id, ge.status, ge.delay_days, ge.step_number, p.timezone, p.country, p.city
       FROM generated_emails ge
       JOIN prospects p ON ge.prospect_id = p.id
       WHERE ge.id = ? AND ge.tenant_id = ? AND ge.status IN ('draft', 'rejected')`,
      [emailId, tenantId]
    );

    if (emails.length === 0) {
      res.status(404).json({ success: false, error: 'Email no encontrado o no está en estado borrador.' });
      return;
    }

    const prospect = emails[0];
    const prospectTz = resolveProspectTimezone(prospect);

    // Use warmup-aware distribution (even for single email, checks day capacity)
    const { schedule } = await distributeEmailsAcrossBusinessDays(
      [{ id: prospect.id, prospectTimezone: prospectTz, delayDays: prospect.delay_days || 0 }],
      tenantId
    );

    const scheduledFor = schedule.get(prospect.id);
    if (!scheduledFor) {
      res.status(500).json({ success: false, error: 'Could not find available send slot.' });
      return;
    }

    await query(
      `UPDATE generated_emails SET status = 'scheduled', approved_at = NOW(), approved_by = ?, scheduled_for = ?
       WHERE id = ? AND tenant_id = ? AND status IN ('draft', 'rejected')`,
      [req.user!.id, scheduledFor, emailId, tenantId]
    );

    const updated = await query<any[]>(
      `SELECT id, tenant_id, campaign_id, prospect_id, step_number,
              subject, body_html, delay_days, status, approved_at,
              approved_by, sent_at, scheduled_for, metadata, created_at, updated_at
       FROM generated_emails WHERE id = ? AND tenant_id = ?`,
      [emailId, tenantId]
    );

    res.json({ success: true, data: updated[0] });
  } catch (error: any) {
    console.error('Outbox approve error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while approving the email.' });
  }
});

// --- PUT /:emailId/reject - Reject single email ---
router.put('/:emailId/reject', async (req: Request, res: Response): Promise<void> => {
  try {
    const { emailId } = req.params;

    await query(
      `UPDATE generated_emails SET status = 'rejected', scheduled_for = NULL
       WHERE id = ? AND tenant_id = ? AND status IN ('draft', 'approved', 'scheduled')`,
      [emailId, req.user!.tenantId]
    );

    const updated = await query<any[]>(
      `SELECT id, tenant_id, campaign_id, prospect_id, step_number,
              subject, body_html, delay_days, status, approved_at,
              approved_by, sent_at, scheduled_for, metadata, created_at, updated_at
       FROM generated_emails WHERE id = ? AND tenant_id = ?`,
      [emailId, req.user!.tenantId]
    );

    res.json({ success: true, data: updated[0] });
  } catch (error: any) {
    console.error('Outbox reject error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while rejecting the email.' });
  }
});

// --- POST /bulk-approve - Bulk approve → schedule emails (warmup-aware) ---
router.post('/bulk-approve', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = emailIdsSchema.safeParse(req.body?.email_ids);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid email_ids.' });
      return;
    }
    const email_ids = parsed.data;

    const tenantId = req.user!.tenantId;

    // Get emails with prospect timezone data and delay_days
    const placeholders = email_ids.map(() => '?').join(',');
    const emails = await query<any[]>(
      `SELECT ge.id, ge.delay_days, ge.step_number, p.timezone, p.country, p.city
       FROM generated_emails ge
       JOIN prospects p ON ge.prospect_id = p.id
       WHERE ge.id IN (${placeholders}) AND ge.tenant_id = ? AND ge.status IN ('draft', 'rejected')`,
      [...email_ids, tenantId]
    );

    // Distribute across business days respecting warmup limits
    const emailsForDistribution = emails.map(e => ({
      id: e.id,
      prospectTimezone: resolveProspectTimezone(e),
      delayDays: e.delay_days || 0,
    }));

    const { schedule, distribution, dailyLimit } = await distributeEmailsAcrossBusinessDays(
      emailsForDistribution,
      tenantId
    );

    let scheduled = 0;
    for (const email of emails) {
      const scheduledFor = schedule.get(email.id);
      if (!scheduledFor) continue;

      await query(
        `UPDATE generated_emails SET status = 'scheduled', approved_at = NOW(), approved_by = ?, scheduled_for = ?
         WHERE id = ? AND tenant_id = ? AND status IN ('draft', 'rejected')`,
        [req.user!.id, scheduledFor, email.id, tenantId]
      );
      scheduled++;
    }

    res.json({
      success: true,
      data: {
        message: `Programados ${scheduled} email(s) para envío.`,
        count: scheduled,
        distribution,
        daily_limit: dailyLimit,
      },
    });
  } catch (error: any) {
    console.error('Outbox bulk approve error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while bulk approving.' });
  }
});

// --- POST /send - Force send scheduled emails via Resend ---
router.post('/send', async (req: Request, res: Response): Promise<void> => {
  try {
    // Weekend guard: reject force-sends on weekends (CET)
    const nowCet = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
    const dayOfWeek = nowCet.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      res.status(400).json({
        success: false,
        error: 'No se pueden enviar emails en fin de semana. Los emails programados se enviarán automáticamente el próximo día laborable.',
      });
      return;
    }

    const { email_ids } = req.body;

    // If email_ids provided, validate + bound it (cost / DoS). Otherwise, send all scheduled.
    let emailsToSend: any[];

    if (email_ids !== undefined && email_ids !== null) {
      const parsed = emailIdsSchema.safeParse(email_ids);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid email_ids.' });
        return;
      }
    }

    if (email_ids && Array.isArray(email_ids) && email_ids.length > 0) {
      const placeholders = email_ids.map(() => '?').join(',');
      emailsToSend = await query<any[]>(
        `SELECT ge.id, ge.tenant_id, ge.campaign_id, ge.prospect_id, ge.step_number,
                ge.subject, ge.body_html, ge.delay_days, ge.status,
                ge.approved_at, ge.approved_by, ge.sent_at, ge.scheduled_for,
                ge.metadata, ge.created_at, ge.updated_at,
                p.email as prospect_email, p.first_name, p.last_name, p.full_name,
                p.title as prospect_title, p.do_not_contact,
                cam.name as campaign_name, cam.sender_user_id,
                u.first_name as approver_first_name, u.last_name as approver_last_name
         FROM generated_emails ge
         JOIN prospects p ON ge.prospect_id = p.id
         JOIN campaigns cam ON ge.campaign_id = cam.id
         LEFT JOIN users u ON ge.approved_by = u.id
         WHERE ge.id IN (${placeholders}) AND ge.tenant_id = ? AND ge.status = 'scheduled'`,
        [...email_ids, req.user!.tenantId]
      );
    } else {
      emailsToSend = await query<any[]>(
        `SELECT ge.id, ge.tenant_id, ge.campaign_id, ge.prospect_id, ge.step_number,
                ge.subject, ge.body_html, ge.delay_days, ge.status,
                ge.approved_at, ge.approved_by, ge.sent_at, ge.scheduled_for,
                ge.metadata, ge.created_at, ge.updated_at,
                p.email as prospect_email, p.first_name, p.last_name, p.full_name,
                p.title as prospect_title, p.do_not_contact,
                cam.name as campaign_name, cam.sender_user_id,
                u.first_name as approver_first_name, u.last_name as approver_last_name
         FROM generated_emails ge
         JOIN prospects p ON ge.prospect_id = p.id
         JOIN campaigns cam ON ge.campaign_id = cam.id
         LEFT JOIN users u ON ge.approved_by = u.id
         WHERE ge.tenant_id = ? AND ge.status = 'scheduled'
         ORDER BY ge.campaign_id, ge.prospect_id, ge.step_number`,
        [req.user!.tenantId]
      );
    }

    if (emailsToSend.length === 0) {
      res.json({ success: true, data: { message: 'No hay emails programados para enviar.', sent: 0, failed: 0 } });
      return;
    }

    const { sendEmail, getCampaignAttachments } = await import('../services/email');

    let sent = 0;
    let failed = 0;
    const results: any[] = [];
    // Resolved sender cache: `${senderUserId}` -> ResolvedSender (tenant is fixed here)
    const senderCache = new Map<string, ResolvedSender>();

    // Cross-campaign guard (final safety net, same policy as the scheduler):
    // only real sends in OTHER campaigns block; audited overrides pass.
    const guardVerdicts = new Map<string, GuardVerdict>(); // `${campaignId}:${prospectId}`
    {
      const groups = new Map<string, string[]>(); // campaignId -> prospectIds
      for (const email of emailsToSend) {
        if (!groups.has(email.campaign_id)) groups.set(email.campaign_id, []);
        groups.get(email.campaign_id)!.push(email.prospect_id);
      }
      for (const [campaignId, prospectIds] of groups) {
        const res2 = await checkCrossCampaignContact(req.user!.tenantId, campaignId, prospectIds, {
          queuedBlocks: false, checkEnrollment: false, checkDomain: false,
        });
        for (const [pid, verdict] of res2.verdicts) {
          guardVerdicts.set(`${campaignId}:${pid}`, verdict);
        }
      }
    }

    for (let idx = 0; idx < emailsToSend.length; idx++) {
      const email = emailsToSend[idx];

      // Rate limit: wait 600ms between sends (max ~1.6/sec, within Resend's 2/sec limit)
      if (idx > 0) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }

      // Skip do_not_contact
      if (email.do_not_contact) {
        results.push({ id: email.id, status: 'skipped', reason: 'do_not_contact' });
        continue;
      }

      // Check suppression list (per-tenant)
      const suppressed = await query<any[]>(
        'SELECT id FROM suppression_list WHERE email = ? AND tenant_id = ?',
        [email.prospect_email, req.user!.tenantId]
      );
      if (suppressed.length > 0) {
        results.push({ id: email.id, status: 'skipped', reason: 'suppressed' });
        continue;
      }

      // Cross-campaign guard: already contacted by another campaign -> reject + skip
      const guardVerdict = guardVerdicts.get(`${email.campaign_id}:${email.prospect_id}`);
      if (shouldSkipEmail(guardVerdict, email.metadata)) {
        await query(
          `UPDATE generated_emails SET status = 'rejected',
           metadata = JSON_SET(COALESCE(metadata, '{}'), '$.skip_reason', 'cross_campaign_contact')
           WHERE id = ? AND tenant_id = ?`,
          [email.id, req.user!.tenantId]
        );
        results.push({ id: email.id, status: 'skipped', reason: 'cross_campaign_contact', other_campaign: guardVerdict?.other_campaign_name });
        continue;
      }

      try {
        // Sender cascade: campaign.sender_user_id -> users.sender_email/name -> tenant config
        const senderKey = email.sender_user_id || '';
        if (!senderCache.has(senderKey)) {
          senderCache.set(senderKey, await resolveSender(req.user!.tenantId, email.sender_user_id));
        }
        const resolved = senderCache.get(senderKey)!;
        const fromAddress = resolved.fromAddress;
        const replyTo = resolved.replyTo;

        // Optional per-campaign attachment (e.g. blind-teaser PDF); [] when none → unchanged behaviour.
        const attachments = await getCampaignAttachments(email.campaign_id, req.user!.tenantId);

        const result = await sendEmail(
          email.prospect_email,
          email.subject,
          email.body_html,
          undefined,
          fromAddress,
          replyTo,
          req.user!.tenantId,
          undefined,
          attachments
        );

        if (result.success) {
          // Update status to sent
          await query(
            `UPDATE generated_emails SET status = 'sent', sent_at = NOW(),
             metadata = JSON_SET(COALESCE(metadata, '{}'), '$.resend_id', ?)
             WHERE id = ? AND tenant_id = ?`,
            [result.id, email.id, req.user!.tenantId]
          );

          // Record email_event 'sent' (parity with the scheduler path): links webhook
          // follow-ups by resend_email_id and records from_email for per-sender audit
          await query(
            `INSERT INTO email_events (id, tenant_id, prospect_id, event_type, resend_email_id, subject, from_email)
             VALUES (?, ?, ?, 'sent', ?, ?, ?)`,
            [uuidv4(), req.user!.tenantId, email.prospect_id, result.id, email.subject, fromAddress]
          );

          // Update prospect last_contacted
          await query(
            `UPDATE prospects SET last_contacted = NOW(),
             status = CASE WHEN status IN ('new', 'enriched', 'qualified') THEN 'contacted' ELSE status END
             WHERE id = ? AND tenant_id = ?`,
            [email.prospect_id, req.user!.tenantId]
          );

          // Log activity
          await query(
            `INSERT INTO prospect_activities (id, tenant_id, prospect_id, activity_type, title, description)
             VALUES (?, ?, ?, 'email_sent', ?, ?)`,
            [
              uuidv4(),
              req.user!.tenantId,
              email.prospect_id,
              `Email enviado: Paso ${email.step_number}`,
              `Asunto: ${email.subject} | Propiedad: ${email.campaign_name}`,
            ]
          );

          sent++;
          results.push({ id: email.id, status: 'sent', resend_id: result.id });
        } else {
          failed++;
          await query(
            `UPDATE generated_emails SET status = 'bounced',
             metadata = JSON_SET(COALESCE(metadata, '{}'), '$.error', 'Send failed')
             WHERE id = ? AND tenant_id = ?`,
            [email.id, req.user!.tenantId]
          );
          results.push({ id: email.id, status: 'failed' });
        }
      } catch (sendError: any) {
        failed++;
        await query(
          `UPDATE generated_emails SET status = 'bounced',
           metadata = JSON_SET(COALESCE(metadata, '{}'), '$.error', ?)
           WHERE id = ? AND tenant_id = ?`,
          [sendError.message || 'Unknown error', email.id, req.user!.tenantId]
        );
        results.push({ id: email.id, status: 'failed', error: sendError.message });
      }
    }

    res.json({
      success: true,
      data: {
        message: `Enviados: ${sent}, Fallidos: ${failed}, Total: ${emailsToSend.length}`,
        sent,
        failed,
        skipped: results.filter(r => r.status === 'skipped').length,
        results,
      },
    });
  } catch (error: any) {
    console.error('Outbox send error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while sending emails.' });
  }
});

// --- POST /redistribute - Redistribute scheduled emails across business days (warmup-aware) ---
router.post('/redistribute', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email_ids, campaign_id, start_date } = req.body;
    const tenantId = req.user!.tenantId;

    // If email_ids provided, validate + bound it (cost / DoS).
    if (email_ids !== undefined && email_ids !== null) {
      const parsed = emailIdsSchema.safeParse(email_ids);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid email_ids.' });
        return;
      }
    }

    // Optional future start date: distribution begins no earlier than this day.
    let startDate: Date | undefined;
    if (start_date !== undefined && start_date !== null) {
      const parsed = startDateSchema.safeParse(start_date);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: 'Invalid start_date. Use an ISO date (YYYY-MM-DD).' });
        return;
      }
      startDate = new Date(`${parsed.data}T00:00:00`);
    }

    let whereClause = 'ge.tenant_id = ? AND p.tenant_id = ? AND ge.status = \'scheduled\'';
    const params: any[] = [tenantId, tenantId];

    if (email_ids && Array.isArray(email_ids) && email_ids.length > 0) {
      const placeholders = email_ids.map(() => '?').join(',');
      whereClause += ` AND ge.id IN (${placeholders})`;
      params.push(...email_ids);
    } else if (campaign_id) {
      whereClause += ' AND ge.campaign_id = ?';
      params.push(campaign_id);
    }

    const emails = await query<any[]>(
      `SELECT ge.id, ge.delay_days, ge.step_number, p.timezone, p.country, p.city,
              prev.status as prev_step_status
       FROM generated_emails ge
       JOIN prospects p ON ge.prospect_id = p.id AND p.tenant_id = ge.tenant_id
       LEFT JOIN generated_emails prev
         ON prev.prospect_id = ge.prospect_id
         AND prev.campaign_id = ge.campaign_id
         AND prev.tenant_id = ge.tenant_id
         AND prev.step_number = ge.step_number - 1
       WHERE ${whereClause}`,
      params
    );

    if (emails.length === 0) {
      res.json({ success: true, data: { message: 'No hay emails programados para redistribuir.', count: 0 } });
      return;
    }

    const emailsForDistribution = emails.map((e: any) => ({
      id: e.id,
      prospectTimezone: resolveProspectTimezone(e),
      // If previous step already sent (or it's step 1), delay is no longer needed —
      // the gap was already enforced in the original scheduling
      delayDays: (e.step_number <= 1 || e.prev_step_status === 'sent') ? 0 : (e.delay_days || 0),
    }));

    // Pass emailIds to exclude from capacity counts — prevents double-counting
    // the emails being redistributed as already-scheduled capacity
    const emailIds = emails.map((e: any) => e.id);
    const { schedule, distribution, dailyLimit } = await distributeEmailsAcrossBusinessDays(
      emailsForDistribution,
      tenantId,
      emailIds,
      startDate
    );

    let updated = 0;
    for (const [emailId, scheduledFor] of schedule) {
      const dateStr = scheduledFor.toISOString().replace('T', ' ').substring(0, 19);
      await query(
        'UPDATE generated_emails SET scheduled_for = ? WHERE id = ? AND tenant_id = ?',
        [dateStr, emailId, tenantId]
      );
      updated++;
    }

    res.json({
      success: true,
      data: {
        message: `Redistribuidos ${updated} email(s) en días laborables.`,
        count: updated,
        distribution,
        daily_limit: dailyLimit,
      },
    });
  } catch (error: any) {
    console.error('Outbox redistribute error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while redistributing.' });
  }
});

export default router;
