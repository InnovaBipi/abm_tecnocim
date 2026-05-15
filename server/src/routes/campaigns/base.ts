import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query } from '../../config/database';

const router = Router();

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
      `SELECT cam.id, cam.tenant_id, cam.name, cam.description, cam.campaign_type,
              cam.status, cam.asset_type, cam.asset_location, cam.asset_price,
              cam.start_date, cam.end_date, cam.created_by, cam.created_at, cam.updated_at,
              (SELECT COUNT(*) FROM campaign_prospects cp WHERE cp.campaign_id = cam.id AND cp.status = 'active') as prospect_count,
              (SELECT COUNT(*) FROM email_events ee
               JOIN email_sequences es ON ee.sequence_id = es.id
               WHERE es.campaign_id = cam.id AND ee.tenant_id = cam.tenant_id AND ee.event_type = 'sent') as emails_sent,
              (SELECT COUNT(*) FROM email_events ee
               JOIN email_sequences es ON ee.sequence_id = es.id
               WHERE es.campaign_id = cam.id AND ee.tenant_id = cam.tenant_id AND ee.event_type = 'opened') as emails_opened,
              (SELECT COUNT(*) FROM email_events ee
               JOIN email_sequences es ON ee.sequence_id = es.id
               WHERE es.campaign_id = cam.id AND ee.tenant_id = cam.tenant_id AND ee.event_type = 'replied') as emails_replied
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
      `SELECT id, tenant_id, name, description, campaign_type, status,
              asset_type, asset_location, asset_price, asset_details,
              start_date, end_date, created_by, created_at, updated_at
       FROM campaigns WHERE id = ? AND tenant_id = ?`,
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
      `SELECT es.id, es.tenant_id, es.campaign_id, es.name, es.description,
              es.status, es.sequence_type, es.from_name, es.from_email, es.reply_to,
              es.send_window, es.settings, es.created_by, es.created_at, es.updated_at,
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

    const created = await query<any[]>(
      `SELECT id, tenant_id, name, description, campaign_type, status,
              asset_type, asset_location, asset_price, asset_details,
              start_date, end_date, created_by, created_at, updated_at
       FROM campaigns WHERE id = ? AND tenant_id = ?`,
      [id, req.user!.tenantId]
    );

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

    const updated = await query<any[]>(
      `SELECT id, tenant_id, name, description, campaign_type, status,
              asset_type, asset_location, asset_price, asset_details,
              start_date, end_date, created_by, created_at, updated_at
       FROM campaigns WHERE id = ? AND tenant_id = ?`,
      [id, req.user!.tenantId]
    );

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

export default router;
