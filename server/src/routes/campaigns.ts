import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate } from '../middleware/auth';

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

    let whereClauses: string[] = [];
    let params: any[] = [];

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

    const whereSQL = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

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
      'SELECT * FROM campaigns WHERE id = ?',
      [id]
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
       WHERE cp.campaign_id = ?
       ORDER BY cp.added_at DESC`,
      [id]
    );

    // Fetch sequences
    const sequences = await query<any[]>(
      `SELECT es.*,
              (SELECT COUNT(*) FROM sequence_enrollments se WHERE se.sequence_id = es.id) as enrollment_count,
              (SELECT COUNT(*) FROM sequence_steps ss WHERE ss.sequence_id = es.id) as step_count
       FROM email_sequences es
       WHERE es.campaign_id = ?
       ORDER BY es.created_at DESC`,
      [id]
    );

    // Email stats
    const emailStats = await query<any[]>(
      `SELECT ee.event_type, COUNT(*) as count
       FROM email_events ee
       JOIN email_sequences es ON ee.sequence_id = es.id
       WHERE es.campaign_id = ?
       GROUP BY ee.event_type`,
      [id]
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
      `INSERT INTO campaigns (id, name, description, asset_type, asset_location, asset_price,
       asset_details, campaign_type, status, start_date, end_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
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

    const existing = await query<any[]>('SELECT id FROM campaigns WHERE id = ?', [id]);
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

    await query(
      `UPDATE campaigns SET ${setClauses.join(', ')} WHERE id = ?`,
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

    const existing = await query<any[]>('SELECT id FROM campaigns WHERE id = ?', [id]);
    if (existing.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Campaign not found.',
      });
      return;
    }

    await query('DELETE FROM campaigns WHERE id = ?', [id]);

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
    const campaign = await query<any[]>('SELECT id FROM campaigns WHERE id = ?', [id]);
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

// --- DELETE /:id/prospects/:prospectId - Remove prospect from campaign ---
router.delete('/:id/prospects/:prospectId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, prospectId } = req.params;

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
