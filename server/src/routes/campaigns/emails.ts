import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, getConnection } from '../../config/database';
import { getTenantConfig, buildTenantAIContext } from '../../middleware/tenant';
import { enrichProspect } from '../../services/enrichment';
import { resolveProspectTimezone, distributeEmailsAcrossBusinessDays, isBusinessDay, getNextBusinessDay } from '../../services/scheduling';
import { sanitizeEmailHtml } from '../../utils/sanitizeHtml';

const router = Router();

// Defensive caps to bound cost / DoS on unbounded loops.
const MAX_NUM_STEPS = 7;
const MAX_PROSPECTS_PER_REQUEST = 500;
const MAX_BULK_INSERT_EMAILS = 1000;
const MAX_EMAIL_IDS = 500;

// --- POST /:id/generate-emails - Generate personalized emails with AI ---
router.post('/:id/generate-emails', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { prospect_ids, num_steps = 4 } = req.body;

    if (!prospect_ids || !Array.isArray(prospect_ids) || prospect_ids.length === 0) {
      res.status(400).json({ success: false, error: 'prospect_ids array is required.' });
      return;
    }

    // Bound the prospect loop defensively (cost / DoS).
    if (prospect_ids.length > MAX_PROSPECTS_PER_REQUEST) {
      res.status(400).json({ success: false, error: `prospect_ids cannot exceed ${MAX_PROSPECTS_PER_REQUEST} per request.` });
      return;
    }

    // Validate num_steps to a reasonable range (1..7).
    if (!Number.isInteger(num_steps) || num_steps < 1 || num_steps > MAX_NUM_STEPS) {
      res.status(400).json({ success: false, error: `num_steps must be an integer between 1 and ${MAX_NUM_STEPS}.` });
      return;
    }

    // Load campaign
    const campaigns = await query<any[]>(
      `SELECT id, tenant_id, name, description, campaign_type, status,
              asset_type, asset_location, asset_price, asset_details,
              start_date, end_date, created_by, created_at, updated_at
       FROM campaigns WHERE id = ? AND tenant_id = ?`,
      [id, req.user!.tenantId]
    );
    if (campaigns.length === 0) {
      res.status(404).json({ success: false, error: 'Campaign not found.' });
      return;
    }
    const campaign = campaigns[0];

    // Parse asset_details
    let assetDetails = null;
    if (campaign.asset_details) {
      assetDetails = typeof campaign.asset_details === 'string'
        ? JSON.parse(campaign.asset_details) : campaign.asset_details;
    }

    // Load existing sequence steps as template reference
    const existingSteps = await query<any[]>(
      `SELECT ss.step_number, ss.subject, ss.body_html, ss.delay_days
       FROM sequence_steps ss
       JOIN email_sequences es ON ss.sequence_id = es.id
       WHERE es.campaign_id = ?
       ORDER BY ss.step_number ASC`,
      [id]
    );

    const { generatePersonalizedSequence } = await import('../../services/ai');

    // Build tenant AI context
    const tenant = await getTenantConfig(req.user!.tenantId);
    const tenantAIContext = tenant ? buildTenantAIContext(tenant) : undefined;

    const results: any[] = [];

    for (const prospectId of prospect_ids) {
      // Load prospect with enrichment
      const prospects = await query<any[]>(
        `SELECT p.id, p.tenant_id, p.email, p.first_name, p.last_name,
                p.title, p.city, p.region, p.country, p.linkedin_url,
                p.enrichment_data,
                c.name as company_name, c.industry as company_industry,
                c.employee_count, c.annual_revenue
         FROM prospects p
         LEFT JOIN companies c ON p.company_id = c.id
         WHERE p.id = ? AND p.tenant_id = ?`,
        [prospectId, req.user!.tenantId]
      );

      if (prospects.length === 0) continue;
      const prospect = prospects[0];

      let enrichment = null;
      if (prospect.enrichment_data) {
        enrichment = typeof prospect.enrichment_data === 'string'
          ? JSON.parse(prospect.enrichment_data) : prospect.enrichment_data;
      }

      // Auto-enrich if missing
      if (!enrichment && prospect.company_name) {
        try {
          await enrichProspect(prospectId);

          // Re-fetch prospect with new enrichment
          const enrichedProspects = await query<any[]>(
            `SELECT enrichment_data FROM prospects WHERE id = ? AND tenant_id = ?`,
            [prospectId, req.user!.tenantId]
          );

          if (enrichedProspects[0]?.enrichment_data) {
            enrichment = typeof enrichedProspects[0].enrichment_data === 'string'
              ? JSON.parse(enrichedProspects[0].enrichment_data)
              : enrichedProspects[0].enrichment_data;
          }
        } catch (enrichError) {
          // Log but don't block — generation can proceed with null enrichment
          console.warn(`[generate-emails] Auto-enrich failed for prospect ${prospectId}:`, enrichError);
        }
      }

      try {
        const generatedSteps = await generatePersonalizedSequence(
          {
            first_name: prospect.first_name,
            last_name: prospect.last_name,
            title: prospect.title,
            company_name: prospect.company_name,
            industry: prospect.company_industry,
            city: prospect.city,
            region: prospect.region,
            country: prospect.country,
            linkedin_url: prospect.linkedin_url,
          },
          enrichment,
          {
            name: campaign.name,
            description: campaign.description,
            asset_type: campaign.asset_type,
            asset_location: campaign.asset_location,
            asset_price: campaign.asset_price ? parseFloat(campaign.asset_price) : undefined,
            asset_details: assetDetails,
          },
          existingSteps,
          num_steps,
          tenantAIContext
        );

        // Save generated emails to DB
        for (const step of generatedSteps) {
          const emailId = uuidv4();
          const safeBodyHtml = sanitizeEmailHtml(step.body_html);
          await query(
            `INSERT INTO generated_emails (id, tenant_id, campaign_id, prospect_id, step_number, subject, body_html, delay_days, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')
             ON DUPLICATE KEY UPDATE subject = VALUES(subject), body_html = VALUES(body_html),
             delay_days = VALUES(delay_days), status = 'draft', updated_at = NOW()`,
            [emailId, req.user!.tenantId, id, prospectId, step.step_number, step.subject, safeBodyHtml, step.delay_days]
          );
        }

        results.push({
          prospect_id: prospectId,
          prospect_name: `${prospect.first_name || ''} ${prospect.last_name || ''}`.trim(),
          steps_generated: generatedSteps.length,
          status: 'success',
        });
      } catch (aiError: any) {
        results.push({
          prospect_id: prospectId,
          prospect_name: `${prospect.first_name || ''} ${prospect.last_name || ''}`.trim(),
          status: 'error',
          error: aiError.message,
        });
      }
    }

    res.json({
      success: true,
      data: {
        results,
        total_generated: results.filter(r => r.status === 'success').length,
        total_errors: results.filter(r => r.status === 'error').length,
      },
    });
  } catch (error: any) {
    console.error('Generate emails error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while generating emails.' });
  }
});

// --- GET /:id/generated-emails - List generated emails for campaign ---
router.get('/:id/generated-emails', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const status = req.query.status as string;
    const prospectId = req.query.prospect_id as string;

    let whereClauses = ['ge.campaign_id = ?', 'ge.tenant_id = ?'];
    let params: any[] = [id, req.user!.tenantId];

    if (status) {
      whereClauses.push('ge.status = ?');
      params.push(status);
    }

    if (prospectId) {
      whereClauses.push('ge.prospect_id = ?');
      params.push(prospectId);
    }

    const whereSQL = 'WHERE ' + whereClauses.join(' AND ');

    const emails = await query<any[]>(
      `SELECT ge.id, ge.tenant_id, ge.campaign_id, ge.prospect_id, ge.step_number,
              ge.subject, ge.body_html, ge.delay_days, ge.status,
              ge.approved_at, ge.approved_by, ge.sent_at, ge.scheduled_for,
              ge.metadata, ge.created_at, ge.updated_at,
              p.first_name, p.last_name, p.full_name, p.email as prospect_email,
              p.title as prospect_title, comp.name as company_name
       FROM generated_emails ge
       LEFT JOIN prospects p ON ge.prospect_id = p.id
       LEFT JOIN companies comp ON p.company_id = comp.id
       LEFT JOIN campaigns c ON ge.campaign_id = c.id
       ${whereSQL}
       ORDER BY p.last_name ASC, ge.step_number ASC`,
      params
    );

    // Group by prospect
    const byProspect: Record<string, any> = {};
    for (const email of emails) {
      if (!byProspect[email.prospect_id]) {
        byProspect[email.prospect_id] = {
          prospect_id: email.prospect_id,
          prospect_name: email.full_name || `${email.first_name || ''} ${email.last_name || ''}`.trim(),
          prospect_email: email.prospect_email,
          prospect_title: email.prospect_title,
          company_name: email.company_name,
          emails: [],
        };
      }
      byProspect[email.prospect_id].emails.push(email);
    }

    // Stats
    const stats = await query<any[]>(
      `SELECT status, COUNT(*) as count FROM generated_emails WHERE campaign_id = ? AND tenant_id = ? GROUP BY status`,
      [id, req.user!.tenantId]
    );

    res.json({
      success: true,
      data: {
        emails,
        byProspect: Object.values(byProspect),
        stats: stats.reduce((acc: any, row: any) => {
          acc[row.status] = row.count;
          return acc;
        }, {}),
      },
    });
  } catch (error: any) {
    console.error('List generated emails error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while fetching generated emails.' });
  }
});

// --- PUT /:id/generated-emails/:emailId - Edit a generated email ---
router.put('/:id/generated-emails/:emailId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, emailId } = req.params;
    const { subject, body_html, status, sent_at, scheduled_for } = req.body;

    const existing = await query<any[]>(
      'SELECT id FROM generated_emails WHERE id = ? AND campaign_id = ? AND tenant_id = ?',
      [emailId, id, req.user!.tenantId]
    );

    if (existing.length === 0) {
      res.status(404).json({ success: false, error: 'Email not found.' });
      return;
    }

    const setClauses: string[] = [];
    const params: any[] = [];

    if (subject !== undefined) {
      setClauses.push('subject = ?');
      params.push(subject);
    }
    if (body_html !== undefined) {
      setClauses.push('body_html = ?');
      params.push(sanitizeEmailHtml(body_html));
    }
    if (status !== undefined) {
      setClauses.push('status = ?');
      params.push(status);
    }
    if (sent_at !== undefined) {
      setClauses.push('sent_at = ?');
      params.push(sent_at);
    }
    if (scheduled_for !== undefined) {
      const scheduledDate = new Date(scheduled_for);
      if (isNaN(scheduledDate.getTime())) {
        res.status(400).json({ success: false, error: 'Invalid scheduled_for date format.' });
        return;
      }
      // Auto-adjust weekend dates to next Monday
      let finalDate = scheduledDate;
      if (!isBusinessDay(scheduledDate)) {
        finalDate = getNextBusinessDay(scheduledDate);
        finalDate.setUTCHours(scheduledDate.getUTCHours(), scheduledDate.getUTCMinutes(), 0, 0);
      }
      setClauses.push('scheduled_for = ?');
      params.push(finalDate.toISOString().replace('T', ' ').substring(0, 19));
    }

    if (setClauses.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update.' });
      return;
    }

    params.push(emailId, req.user!.tenantId);
    await query(`UPDATE generated_emails SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`, params);

    const updated = await query<any[]>(
      `SELECT id, tenant_id, campaign_id, prospect_id, step_number,
              subject, body_html, delay_days, status, approved_at,
              approved_by, sent_at, scheduled_for, metadata, created_at, updated_at
       FROM generated_emails WHERE id = ? AND tenant_id = ?`,
      [emailId, req.user!.tenantId]
    );

    res.json({ success: true, data: updated[0] });
  } catch (error: any) {
    console.error('Edit generated email error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while editing the email.' });
  }
});

// --- POST /:id/approve-emails - Bulk approve -> schedule for sending (warmup-aware) ---
router.post('/:id/approve-emails', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { email_ids } = req.body;
    const tenantId = req.user!.tenantId;

    if (!email_ids || !Array.isArray(email_ids) || email_ids.length === 0) {
      res.status(400).json({ success: false, error: 'email_ids array is required.' });
      return;
    }
    if (email_ids.length > MAX_EMAIL_IDS) {
      res.status(400).json({ success: false, error: `email_ids cannot exceed ${MAX_EMAIL_IDS} per request.` });
      return;
    }

    // Verify campaign belongs to tenant
    const campaign = await query<any[]>(
      'SELECT id, status FROM campaigns WHERE id = ? AND tenant_id = ?',
      [id, tenantId]
    );
    if (campaign.length === 0) {
      res.status(404).json({ success: false, error: 'Campaign not found.' });
      return;
    }

    // Get emails with prospect timezone data for smart scheduling
    const placeholders = email_ids.map(() => '?').join(',');
    const emails = await query<any[]>(
      `SELECT ge.id, ge.delay_days, ge.step_number, p.timezone, p.country, p.city
       FROM generated_emails ge
       JOIN prospects p ON ge.prospect_id = p.id
       WHERE ge.id IN (${placeholders}) AND ge.campaign_id = ? AND ge.tenant_id = ? AND ge.status IN ('draft', 'rejected', 'bounced')`,
      [...email_ids, id, tenantId]
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
         WHERE id = ? AND tenant_id = ? AND status IN ('draft', 'rejected', 'bounced')`,
        [req.user!.id, scheduledFor, email.id, tenantId]
      );
      scheduled++;
    }

    // Auto-activate campaign if it's in draft — scheduled emails need an active campaign
    if (scheduled > 0 && campaign[0].status === 'draft') {
      await query(
        `UPDATE campaigns SET status = 'active' WHERE id = ? AND tenant_id = ?`,
        [id, tenantId]
      );
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
    console.error('Approve emails error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while approving emails.' });
  }
});

// --- POST /:id/reject-emails - Bulk reject ---
router.post('/:id/reject-emails', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { email_ids } = req.body;

    if (!email_ids || !Array.isArray(email_ids) || email_ids.length === 0) {
      res.status(400).json({ success: false, error: 'email_ids array is required.' });
      return;
    }
    if (email_ids.length > MAX_EMAIL_IDS) {
      res.status(400).json({ success: false, error: `email_ids cannot exceed ${MAX_EMAIL_IDS} per request.` });
      return;
    }

    const placeholders = email_ids.map(() => '?').join(',');
    await query(
      `UPDATE generated_emails SET status = 'rejected', scheduled_for = NULL
       WHERE id IN (${placeholders}) AND campaign_id = ? AND tenant_id = ? AND status IN ('draft', 'approved', 'scheduled')`,
      [...email_ids, id, req.user!.tenantId]
    );

    res.json({ success: true, data: { message: `Rechazados ${email_ids.length} email(s).` } });
  } catch (error: any) {
    console.error('Reject emails error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while rejecting emails.' });
  }
});

// --- POST /:id/bulk-insert-emails - Bulk insert generated emails (bypasses AI, for Claude Code pipeline) ---
router.post('/:id/bulk-insert-emails', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { emails } = req.body;

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      res.status(400).json({ success: false, error: 'emails array is required.' });
      return;
    }

    // Bound the insert loop defensively (cost / DoS).
    if (emails.length > MAX_BULK_INSERT_EMAILS) {
      res.status(400).json({ success: false, error: `emails cannot exceed ${MAX_BULK_INSERT_EMAILS} per request.` });
      return;
    }

    // Verify campaign belongs to tenant
    const campaign = await query<any[]>('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    if (campaign.length === 0) {
      res.status(404).json({ success: false, error: 'Campaign not found.' });
      return;
    }

    const tenantId = req.user!.tenantId;
    let inserted = 0;
    for (const email of emails) {
      if (!email.prospect_id || !email.subject || !email.body_html) continue;

      // Verify prospect belongs to this tenant
      const prospect = await query<any[]>('SELECT id FROM prospects WHERE id = ? AND tenant_id = ?', [email.prospect_id, tenantId]);
      if (prospect.length === 0) continue;

      // Atomic transaction: delete old + insert new
      const conn = await getConnection();
      try {
        await conn.beginTransaction();

        await conn.query(
          'DELETE FROM generated_emails WHERE prospect_id = ? AND campaign_id = ? AND step_number = ? AND tenant_id = ?',
          [email.prospect_id, id, email.step_number || 1, tenantId]
        );

        const emailId = uuidv4();
        await conn.query(
          `INSERT INTO generated_emails (id, tenant_id, campaign_id, prospect_id, step_number, subject, body_html, delay_days, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
          [emailId, tenantId, id, email.prospect_id, email.step_number || 1, email.subject, sanitizeEmailHtml(email.body_html), email.delay_days || 0]
        );

        await conn.commit();
        inserted++;
      } catch (txError: any) {
        await conn.rollback();
        console.error(`[bulk-insert-emails] Transaction failed for prospect ${email.prospect_id}:`, txError);
      } finally {
        conn.release();
      }
    }

    res.json({ success: true, data: { message: `Inserted ${inserted} email(s).`, inserted } });
  } catch (error: any) {
    console.error('Bulk insert emails error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while inserting emails.' });
  }
});

export default router;
