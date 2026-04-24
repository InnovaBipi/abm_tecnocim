import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate } from '../middleware/auth';
import { getTenantConfig, buildTenantAIContext } from '../middleware/tenant';
import { calculateOptimalSendTime, resolveProspectTimezone } from '../services/scheduling';

const router = Router();

// All routes require authentication
router.use(authenticate);

// --- Validation Schemas ---

const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required'),
  description: z.string().optional(),
  asset_type: z.string().optional(),
  asset_location: z.string().optional(),
  asset_price: z.number().positive().optional(),
  asset_details: z.record(z.any()).optional(),
  campaign_type: z.enum(['outbound', 'nurture', 'reactivation']).optional(),
  status: z.enum(['draft', 'active', 'paused', 'completed', 'archived']).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

const updateCampaignSchema = createCampaignSchema.partial();

const addProspectsSchema = z.object({
  prospect_ids: z.array(z.string().uuid()).min(1, 'At least one prospect ID is required'),
});

// --- GET / - List campaigns with prospect counts and email stats ---
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const offset = (page - 1) * limit;

    const status = req.query.status as string;
    const campaignType = req.query.campaign_type as string;
    const search = req.query.search as string;

    let whereClauses: string[] = ['cam.tenant_id = ?'];
    let params: any[] = [req.user!.tenantId];

    if (status) {
      whereClauses.push('cam.status = ?');
      params.push(status);
    }

    if (campaignType) {
      whereClauses.push('cam.campaign_type = ?');
      params.push(campaignType);
    }

    if (search && search.trim()) {
      whereClauses.push('(cam.name LIKE ? OR cam.description LIKE ?)');
      const pattern = `%${search}%`;
      params.push(pattern, pattern);
    }

    const whereSQL = 'WHERE ' + whereClauses.join(' AND ');

    // Count
    const countResult = await query<any[]>(
      `SELECT COUNT(*) as total FROM campaigns cam ${whereSQL}`,
      params
    );
    const total = countResult[0].total;

    // Fetch campaigns with aggregated stats
    const campaigns = await query<any[]>(
      `SELECT cam.*,
              (SELECT COUNT(*) FROM campaign_prospects cp WHERE cp.campaign_id = cam.id AND cp.status = 'active') as prospect_count,
              (SELECT COUNT(*) FROM email_events ee
               JOIN email_sequences es ON ee.sequence_id = es.id
               WHERE es.campaign_id = cam.id AND ee.event_type = 'sent') as emails_sent,
              (SELECT COUNT(*) FROM email_events ee
               JOIN email_sequences es ON ee.sequence_id = es.id
               WHERE es.campaign_id = cam.id AND ee.event_type = 'opened') as emails_opened,
              (SELECT COUNT(*) FROM email_events ee
               JOIN email_sequences es ON ee.sequence_id = es.id
               WHERE es.campaign_id = cam.id AND ee.event_type = 'replied') as emails_replied
       FROM campaigns cam
       ${whereSQL}
       ORDER BY cam.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: {
        campaigns,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    console.error('List campaigns error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while fetching campaigns.',
    });
  }
});

// --- GET /:id - Single campaign with prospects and sequences ---
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const campaigns = await query<any[]>(
      'SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?',
      [id, req.user!.tenantId]
    );

    if (campaigns.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Campaign not found.',
      });
      return;
    }

    // Fetch campaign prospects
    const prospects = await query<any[]>(
      `SELECT p.id, p.email, p.first_name, p.last_name, p.full_name, p.title,
              p.status, p.lead_score, cp.status as campaign_status, cp.added_at
       FROM campaign_prospects cp
       JOIN prospects p ON cp.prospect_id = p.id
       WHERE cp.campaign_id = ? AND p.tenant_id = ?
       ORDER BY cp.added_at DESC`,
      [id, req.user!.tenantId]
    );

    // Fetch sequences
    const sequences = await query<any[]>(
      `SELECT es.*,
              (SELECT COUNT(*) FROM sequence_enrollments se WHERE se.sequence_id = es.id AND se.tenant_id = ?) as enrollment_count,
              (SELECT COUNT(*) FROM sequence_steps ss WHERE ss.sequence_id = es.id) as step_count
       FROM email_sequences es
       WHERE es.campaign_id = ? AND es.tenant_id = ?
       ORDER BY es.created_at DESC`,
      [req.user!.tenantId, id, req.user!.tenantId]
    );

    // Email stats
    const emailStats = await query<any[]>(
      `SELECT ee.event_type, COUNT(*) as count
       FROM email_events ee
       JOIN email_sequences es ON ee.sequence_id = es.id
       WHERE es.campaign_id = ? AND ee.tenant_id = ?
       GROUP BY ee.event_type`,
      [id, req.user!.tenantId]
    );

    res.json({
      success: true,
      data: {
        ...campaigns[0],
        prospects,
        sequences,
        emailStats: emailStats.reduce((acc: any, row: any) => {
          acc[row.event_type] = row.count;
          return acc;
        }, {}),
      },
    });
  } catch (error: any) {
    console.error('Get campaign error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while fetching the campaign.',
    });
  }
});

// --- POST / - Create campaign ---
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = createCampaignSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const data = validation.data;
    const id = uuidv4();

    await query(
      `INSERT INTO campaigns (id, tenant_id, name, description, asset_type, asset_location, asset_price,
       asset_details, campaign_type, status, start_date, end_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.user!.tenantId,
        data.name,
        data.description || null,
        data.asset_type || null,
        data.asset_location || null,
        data.asset_price || null,
        data.asset_details ? JSON.stringify(data.asset_details) : null,
        data.campaign_type || 'outbound',
        data.status || 'draft',
        data.start_date || null,
        data.end_date || null,
        req.user!.id,
      ]
    );

    const created = await query<any[]>('SELECT * FROM campaigns WHERE id = ?', [id]);

    res.status(201).json({
      success: true,
      data: created[0],
    });
  } catch (error: any) {
    console.error('Create campaign error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while creating the campaign.',
    });
  }
});

// --- PUT /:id - Update campaign ---
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const validation = updateCampaignSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const existing = await query<any[]>('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    if (existing.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Campaign not found.',
      });
      return;
    }

    const data = validation.data;
    const setClauses: string[] = [];
    const params: any[] = [];

    const fieldMap: Record<string, string> = {
      name: 'name',
      description: 'description',
      asset_type: 'asset_type',
      asset_location: 'asset_location',
      asset_price: 'asset_price',
      campaign_type: 'campaign_type',
      status: 'status',
      start_date: 'start_date',
      end_date: 'end_date',
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      if ((data as any)[key] !== undefined) {
        setClauses.push(`${column} = ?`);
        params.push((data as any)[key]);
      }
    }

    if (data.asset_details !== undefined) {
      setClauses.push('asset_details = ?');
      params.push(JSON.stringify(data.asset_details));
    }

    if (setClauses.length === 0) {
      res.status(400).json({
        success: false,
        error: 'No fields to update.',
      });
      return;
    }

    params.push(id);
    params.push(req.user!.tenantId);

    await query(
      `UPDATE campaigns SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`,
      params
    );

    const updated = await query<any[]>('SELECT * FROM campaigns WHERE id = ?', [id]);

    res.json({
      success: true,
      data: updated[0],
    });
  } catch (error: any) {
    console.error('Update campaign error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while updating the campaign.',
    });
  }
});

// --- DELETE /:id - Delete campaign ---
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const existing = await query<any[]>('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    if (existing.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Campaign not found.',
      });
      return;
    }

    await query('DELETE FROM campaigns WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);

    res.json({
      success: true,
      data: { message: 'Campaign deleted successfully.' },
    });
  } catch (error: any) {
    console.error('Delete campaign error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while deleting the campaign.',
    });
  }
});

// --- POST /:id/prospects - Add prospects to campaign ---
router.post('/:id/prospects', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const validation = addProspectsSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    // Verify campaign exists
    const campaign = await query<any[]>('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    if (campaign.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Campaign not found.',
      });
      return;
    }

    const { prospect_ids } = validation.data;
    let addedCount = 0;
    let skippedCount = 0;

    for (const prospectId of prospect_ids) {
      try {
        const cpId = uuidv4();
        await query(
          `INSERT INTO campaign_prospects (id, campaign_id, prospect_id, status)
           VALUES (?, ?, ?, 'active')`,
          [cpId, id, prospectId]
        );
        addedCount++;
      } catch (err: any) {
        // Duplicate entry - prospect already in campaign
        if (err.code === 'ER_DUP_ENTRY') {
          skippedCount++;
        } else {
          throw err;
        }
      }
    }

    res.json({
      success: true,
      data: {
        message: `Added ${addedCount} prospect(s) to campaign. ${skippedCount} already in campaign.`,
        addedCount,
        skippedCount,
      },
    });
  } catch (error: any) {
    console.error('Add prospects to campaign error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while adding prospects to the campaign.',
    });
  }
});

// --- POST /:id/generate-emails - Generate personalized emails with AI ---
router.post('/:id/generate-emails', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { prospect_ids, num_steps = 4 } = req.body;

    if (!prospect_ids || !Array.isArray(prospect_ids) || prospect_ids.length === 0) {
      res.status(400).json({ success: false, error: 'prospect_ids array is required.' });
      return;
    }

    // Load campaign
    const campaigns = await query<any[]>('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
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

    const { generatePersonalizedSequence } = await import('../services/ai');

    // Build tenant AI context
    const tenant = await getTenantConfig(req.user!.tenantId);
    const tenantAIContext = tenant ? buildTenantAIContext(tenant) : undefined;

    const results: any[] = [];

    for (const prospectId of prospect_ids) {
      // Load prospect with enrichment
      const prospects = await query<any[]>(
        `SELECT p.*, c.name as company_name, c.industry as company_industry,
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
          await query(
            `INSERT INTO generated_emails (id, tenant_id, campaign_id, prospect_id, step_number, subject, body_html, delay_days, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')
             ON DUPLICATE KEY UPDATE subject = VALUES(subject), body_html = VALUES(body_html),
             delay_days = VALUES(delay_days), status = 'draft', updated_at = NOW()`,
            [emailId, req.user!.tenantId, id, prospectId, step.step_number, step.subject, step.body_html, step.delay_days]
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

// --- GET /:id/metrics - Campaign engagement metrics ---
// Uses generated_emails as primary source (campaign flow) + email_events for engagement
router.get('/:id/metrics', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const tenantId = req.user!.tenantId;

    const campaign = await query<any[]>('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    if (campaign.length === 0) {
      res.status(404).json({ success: false, error: 'Campaign not found.' });
      return;
    }

    // Pipeline counts from generated_emails (the primary data for campaign emails)
    const pipelineStats = await query<any[]>(
      `SELECT
         SUM(CASE WHEN status IN ('sent', 'opened', 'replied') THEN 1 ELSE 0 END) as sent,
         SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) as bounced
       FROM generated_emails
       WHERE campaign_id = ? AND tenant_id = ?`,
      [id, tenantId]
    );

    // Engagement counts from email_events (webhooks update these for opened/clicked/replied)
    // Link via campaign_prospects to scope to this campaign's prospects
    const engagementStats = await query<any[]>(
      `SELECT
         SUM(CASE WHEN ee.event_type = 'delivered' THEN 1 ELSE 0 END) as delivered,
         SUM(CASE WHEN ee.event_type = 'opened' THEN 1 ELSE 0 END) as opened,
         SUM(CASE WHEN ee.event_type = 'clicked' THEN 1 ELSE 0 END) as clicked,
         SUM(CASE WHEN ee.event_type = 'replied' THEN 1 ELSE 0 END) as replied
       FROM email_events ee
       JOIN campaign_prospects cp ON ee.prospect_id = cp.prospect_id
       WHERE cp.campaign_id = ? AND ee.tenant_id = ?
       AND ee.event_type IN ('delivered', 'opened', 'clicked', 'replied')`,
      [id, tenantId]
    );

    // Per-step breakdown from generated_emails
    const stepBreakdown = await query<any[]>(
      `SELECT
         ge.step_number,
         MAX(ge.subject) as step_subject,
         COUNT(*) as total,
         SUM(CASE WHEN ge.status IN ('sent', 'opened', 'replied') THEN 1 ELSE 0 END) as sent,
         SUM(CASE WHEN ge.status = 'bounced' THEN 1 ELSE 0 END) as bounced
       FROM generated_emails ge
       WHERE ge.campaign_id = ? AND ge.tenant_id = ?
       AND ge.status NOT IN ('draft', 'rejected')
       GROUP BY ge.step_number
       ORDER BY ge.step_number`,
      [id, tenantId]
    );

    const p = pipelineStats[0] || {};
    const eng = engagementStats[0] || {};
    const sent = p.sent || 0;
    const opened = eng.opened || 0;
    const clicked = eng.clicked || 0;
    const replied = eng.replied || 0;

    res.json({
      success: true,
      data: {
        totals: {
          sent,
          delivered: eng.delivered || 0,
          opened,
          clicked,
          replied,
          bounced: p.bounced || 0,
        },
        rates: {
          open_rate: sent > 0 ? Math.round((opened / sent) * 10000) / 100 : 0,
          click_rate: sent > 0 ? Math.round((clicked / sent) * 10000) / 100 : 0,
          reply_rate: sent > 0 ? Math.round((replied / sent) * 10000) / 100 : 0,
          bounce_rate: sent > 0 ? Math.round(((p.bounced || 0) / sent) * 10000) / 100 : 0,
        },
        step_breakdown: stepBreakdown.map((row: any) => ({
          step_number: row.step_number,
          step_subject: row.step_subject,
          total: row.total,
          sent: row.sent,
          bounced: row.bounced,
        })),
      },
    });
  } catch (error: any) {
    console.error('Campaign metrics error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while fetching campaign metrics.' });
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
      `SELECT ge.*, p.first_name, p.last_name, p.full_name, p.email as prospect_email,
              p.title as prospect_title, c.name as company_name
       FROM generated_emails ge
       JOIN prospects p ON ge.prospect_id = p.id
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
      `SELECT status, COUNT(*) as count FROM generated_emails WHERE campaign_id = ? GROUP BY status`,
      [id]
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
    const { subject, body_html } = req.body;

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
      params.push(body_html);
    }

    if (setClauses.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update.' });
      return;
    }

    params.push(emailId);
    await query(`UPDATE generated_emails SET ${setClauses.join(', ')} WHERE id = ?`, params);

    const updated = await query<any[]>('SELECT * FROM generated_emails WHERE id = ?', [emailId]);

    res.json({ success: true, data: updated[0] });
  } catch (error: any) {
    console.error('Edit generated email error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while editing the email.' });
  }
});

// --- POST /:id/approve-emails - Bulk approve → schedule for sending ---
router.post('/:id/approve-emails', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { email_ids } = req.body;

    if (!email_ids || !Array.isArray(email_ids) || email_ids.length === 0) {
      res.status(400).json({ success: false, error: 'email_ids array is required.' });
      return;
    }

    // Verify campaign belongs to tenant
    const campaign = await query<any[]>(
      'SELECT id, status FROM campaigns WHERE id = ? AND tenant_id = ?',
      [id, req.user!.tenantId]
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
       WHERE ge.id IN (${placeholders}) AND ge.campaign_id = ? AND ge.tenant_id = ? AND ge.status IN ('draft', 'rejected')`,
      [...email_ids, id, req.user!.tenantId]
    );

    let scheduled = 0;
    for (const email of emails) {
      const prospectTz = resolveProspectTimezone(email);
      const baseDate = new Date();
      const delayDays = email.delay_days || 0;
      if (delayDays > 0) {
        baseDate.setDate(baseDate.getDate() + delayDays);
      }
      const scheduledFor = calculateOptimalSendTime(baseDate, prospectTz);

      await query(
        `UPDATE generated_emails SET status = 'scheduled', approved_at = NOW(), approved_by = ?, scheduled_for = ?
         WHERE id = ? AND tenant_id = ? AND status IN ('draft', 'rejected')`,
        [req.user!.id, scheduledFor, email.id, req.user!.tenantId]
      );
      scheduled++;
    }

    res.json({
      success: true,
      data: { message: `Programados ${scheduled} email(s) para envío.`, count: scheduled },
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

// --- DELETE /:id/prospects/:prospectId - Remove prospect from campaign ---
router.delete('/:id/prospects/:prospectId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, prospectId } = req.params;

    // Verify campaign belongs to this tenant before deleting
    const campaignCheck = await query<any[]>(
      'SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?',
      [id, req.user!.tenantId]
    );
    if (campaignCheck.length === 0) {
      res.status(404).json({ success: false, error: 'Campaign not found.' });
      return;
    }

    const result = await query<any>(
      'DELETE FROM campaign_prospects WHERE campaign_id = ? AND prospect_id = ?',
      [id, prospectId]
    );

    if (result.affectedRows === 0) {
      res.status(404).json({
        success: false,
        error: 'Prospect not found in this campaign.',
      });
      return;
    }

    res.json({
      success: true,
      data: { message: 'Prospect removed from campaign successfully.' },
    });
  } catch (error: any) {
    console.error('Remove prospect from campaign error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while removing the prospect from the campaign.',
    });
  }
});

export default router;
