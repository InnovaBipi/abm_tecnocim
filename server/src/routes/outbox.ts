import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { authenticate } from '../middleware/auth';
import { getTenantConfig } from '../middleware/tenant';
import { calculateOptimalSendTime, resolveProspectTimezone } from '../services/scheduling';

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
      `SELECT ge.*, p.first_name, p.last_name, p.full_name, p.email as prospect_email,
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

// --- PUT /:emailId/approve - Approve → Schedule single email ---
router.put('/:emailId/approve', async (req: Request, res: Response): Promise<void> => {
  try {
    const { emailId } = req.params;

    // Get email with prospect data for timezone calculation
    const emails = await query<any[]>(
      `SELECT ge.id, ge.status, ge.delay_days, ge.step_number, p.timezone, p.country, p.city
       FROM generated_emails ge
       JOIN prospects p ON ge.prospect_id = p.id
       WHERE ge.id = ? AND ge.tenant_id = ? AND ge.status IN ('draft', 'rejected')`,
      [emailId, req.user!.tenantId]
    );

    if (emails.length === 0) {
      res.status(404).json({ success: false, error: 'Email no encontrado o no está en estado borrador.' });
      return;
    }

    const prospect = emails[0];
    const prospectTz = resolveProspectTimezone(prospect);
    // Add delay_days so step 2/3/4 are staggered into the future
    const baseDate = new Date();
    const delayDays = prospect.delay_days || 0;
    if (delayDays > 0) {
      baseDate.setDate(baseDate.getDate() + delayDays);
    }
    const scheduledFor = calculateOptimalSendTime(baseDate, prospectTz);

    await query(
      `UPDATE generated_emails SET status = 'scheduled', approved_at = NOW(), approved_by = ?, scheduled_for = ?
       WHERE id = ? AND tenant_id = ? AND status IN ('draft', 'rejected')`,
      [req.user!.id, scheduledFor, emailId, req.user!.tenantId]
    );

    const updated = await query<any[]>('SELECT * FROM generated_emails WHERE id = ?', [emailId]);

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

    const updated = await query<any[]>('SELECT * FROM generated_emails WHERE id = ?', [emailId]);

    res.json({ success: true, data: updated[0] });
  } catch (error: any) {
    console.error('Outbox reject error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while rejecting the email.' });
  }
});

// --- POST /bulk-approve - Bulk approve → schedule emails ---
router.post('/bulk-approve', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email_ids } = req.body;

    if (!email_ids || !Array.isArray(email_ids) || email_ids.length === 0) {
      res.status(400).json({ success: false, error: 'email_ids array is required.' });
      return;
    }

    // Get emails with prospect timezone data and delay_days
    const placeholders = email_ids.map(() => '?').join(',');
    const emails = await query<any[]>(
      `SELECT ge.id, ge.delay_days, ge.step_number, p.timezone, p.country, p.city
       FROM generated_emails ge
       JOIN prospects p ON ge.prospect_id = p.id
       WHERE ge.id IN (${placeholders}) AND ge.tenant_id = ? AND ge.status IN ('draft', 'rejected')`,
      [...email_ids, req.user!.tenantId]
    );

    let scheduled = 0;
    for (const email of emails) {
      const prospectTz = resolveProspectTimezone(email);
      // Add delay_days so step 2/3/4 are staggered into the future
      const baseDate = new Date();
      const delayDays = email.delay_days || 0;
      if (delayDays > 0) {
        baseDate.setDate(baseDate.getDate() + delayDays);
      }
      const scheduledFor = calculateOptimalSendTime(baseDate, prospectTz);

      await query(
        `UPDATE generated_emails SET status = 'scheduled', approved_at = NOW(), approved_by = ?, scheduled_for = ?
         WHERE id = ? AND status IN ('draft', 'rejected')`,
        [req.user!.id, scheduledFor, email.id]
      );
      scheduled++;
    }

    res.json({
      success: true,
      data: { message: `Programados ${scheduled} email(s).`, count: scheduled },
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
        `SELECT ge.*, p.email as prospect_email, p.first_name, p.last_name, p.full_name,
                p.title as prospect_title, p.do_not_contact,
                cam.name as campaign_name
         FROM generated_emails ge
         JOIN prospects p ON ge.prospect_id = p.id
         JOIN campaigns cam ON ge.campaign_id = cam.id
         WHERE ge.id IN (${placeholders}) AND ge.tenant_id = ? AND ge.status = 'scheduled'`,
        [...email_ids, req.user!.tenantId]
      );
    } else {
      emailsToSend = await query<any[]>(
        `SELECT ge.*, p.email as prospect_email, p.first_name, p.last_name, p.full_name,
                p.title as prospect_title, p.do_not_contact,
                cam.name as campaign_name
         FROM generated_emails ge
         JOIN prospects p ON ge.prospect_id = p.id
         JOIN campaigns cam ON ge.campaign_id = cam.id
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
    // Build from address from tenant config
    const tenant = await getTenantConfig(req.user!.tenantId);
    const tenantEmail = tenant?.config?.email;
    const rawFrom = tenantEmail?.from_email || 'noreply@example.com';
    const fromName = tenantEmail?.from_name || 'ABM Platform';
    const fromAddress = `${fromName} <${rawFrom}>`;
    const replyTo = tenantEmail?.reply_to || undefined;

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
        const result = await sendEmail(
          email.prospect_email,
          email.subject,
          email.body_html,
          undefined,
          fromAddress,
          replyTo
        );

        if (result.success) {
          // Update status to sent
          await query(
            `UPDATE generated_emails SET status = 'sent', sent_at = NOW(),
             metadata = JSON_SET(COALESCE(metadata, '{}'), '$.resend_id', ?)
             WHERE id = ?`,
            [result.id, email.id]
          );

          // Update prospect last_contacted
          await query(
            `UPDATE prospects SET last_contacted = NOW(),
             status = CASE WHEN status IN ('new', 'enriched', 'qualified') THEN 'contacted' ELSE status END
             WHERE id = ?`,
            [email.prospect_id]
          );

          // Log activity
          await query(
            `INSERT INTO prospect_activities (id, prospect_id, activity_type, title, description)
             VALUES (?, ?, 'email_sent', ?, ?)`,
            [
              uuidv4(),
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
             WHERE id = ?`,
            [email.id]
          );
          results.push({ id: email.id, status: 'failed' });
        }
      } catch (sendError: any) {
        failed++;
        await query(
          `UPDATE generated_emails SET status = 'bounced',
           metadata = JSON_SET(COALESCE(metadata, '{}'), '$.error', ?)
           WHERE id = ?`,
          [sendError.message || 'Unknown error', email.id]
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
