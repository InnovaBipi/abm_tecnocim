import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { authenticate } from '../middleware/auth';
import { getTenantConfig } from '../middleware/tenant';
import { calculateOptimalSendTime, resolveProspectTimezone, distributeEmailsAcrossBusinessDays, getWarmupDailyLimit } from '../services/scheduling';

const router = Router();

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
              cam.asset_type, cam.asset_location
       FROM generated_emails ge
       JOIN prospects p ON ge.prospect_id = p.id
       JOIN campaigns cam ON ge.campaign_id = cam.id
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
    const { email_ids } = req.body;

    if (!email_ids || !Array.isArray(email_ids) || email_ids.length === 0) {
      res.status(400).json({ success: false, error: 'email_ids array is required.' });
      return;
    }

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
    const { email_ids } = req.body;

    // If email_ids provided, send only those. Otherwise, send all scheduled.
    let emailsToSend: any[];

    if (email_ids && Array.isArray(email_ids) && email_ids.length > 0) {
      const placeholders = email_ids.map(() => '?').join(',');
      emailsToSend = await query<any[]>(
        `SELECT ge.id, ge.tenant_id, ge.campaign_id, ge.prospect_id, ge.step_number,
                ge.subject, ge.body_html, ge.delay_days, ge.status,
                ge.approved_at, ge.approved_by, ge.sent_at, ge.scheduled_for,
                ge.metadata, ge.created_at, ge.updated_at,
                p.email as prospect_email, p.first_name, p.last_name, p.full_name,
                p.title as prospect_title, p.do_not_contact,
                cam.name as campaign_name,
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
                cam.name as campaign_name,
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

    const { sendEmail } = await import('../services/email');

    let sent = 0;
    let failed = 0;
    const results: any[] = [];
    // Build sender fallback from tenant config
    const tenant = await getTenantConfig(req.user!.tenantId);
    const tenantEmail = tenant?.config?.email;
    const tenantFromEmail = tenantEmail?.from_email || 'noreply@example.com';
    const tenantFromName = tenantEmail?.from_name || 'ABM Platform';
    const tenantReplyTo = tenantEmail?.reply_to || undefined;

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

      try {
        // Per-user sender priority: approver > tenant config > global
        // Per-user sender: approver fields fallback to tenant config
        // Note: sender_email/sender_name available after migration-004
        const fromEmail = tenantFromEmail;
        const fromName = tenantFromName;
        const fromAddress = `${fromName} <${fromEmail}>`;
        const replyTo = tenantReplyTo;

        const result = await sendEmail(
          email.prospect_email,
          email.subject,
          email.body_html,
          undefined,
          fromAddress,
          replyTo,
          req.user!.tenantId
        );

        if (result.success) {
          // Update status to sent
          await query(
            `UPDATE generated_emails SET status = 'sent', sent_at = NOW(),
             metadata = JSON_SET(COALESCE(metadata, '{}'), '$.resend_id', ?)
             WHERE id = ? AND tenant_id = ?`,
            [result.id, email.id, req.user!.tenantId]
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

export default router;
