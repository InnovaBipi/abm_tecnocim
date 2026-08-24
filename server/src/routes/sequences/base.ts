import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query } from '../../config/database';

const router = Router();

// --- Validation Schemas ---

const createSequenceSchema = z.object({
  name: z.string().min(1, 'Sequence name is required'),
  campaign_id: z.string().uuid().optional().nullable(),
  description: z.string().optional(),
  from_name: z.string().optional(),
  from_email: z.string().email().optional(),
  reply_to: z.string().email().optional(),
  send_window: z.object({
    days: z.array(z.number().min(0).max(6)),
    start_hour: z.number().min(0).max(23),
    end_hour: z.number().min(0).max(23),
    timezone: z.string(),
  }).optional(),
  settings: z.object({
    stop_on_reply: z.boolean(),
    stop_on_bounce: z.boolean(),
    daily_limit: z.number().positive(),
  }).optional(),
});

const updateSequenceSchema = createSequenceSchema.partial();

// --- GET / - List sequences ---
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const offset = (page - 1) * limit;

    const status = req.query.status as string;
    const campaignId = req.query.campaign_id as string;

    let whereClauses: string[] = ['es.tenant_id = ?'];
    let params: any[] = [req.user!.tenantId];

    if (status) {
      whereClauses.push('es.status = ?');
      params.push(status);
    }

    if (campaignId) {
      whereClauses.push('es.campaign_id = ?');
      params.push(campaignId);
    }

    const whereSQL = 'WHERE ' + whereClauses.join(' AND ');

    const countResult = await query<any[]>(
      `SELECT COUNT(*) as total FROM email_sequences es ${whereSQL}`,
      params
    );
    const total = countResult[0].total;

    const sequences = await query<any[]>(
      `SELECT es.*,
              (SELECT COUNT(*) FROM sequence_steps ss WHERE ss.sequence_id = es.id) as step_count,
              (SELECT COUNT(*) FROM sequence_enrollments se WHERE se.sequence_id = es.id) as enrollment_count,
              (SELECT COUNT(*) FROM sequence_enrollments se WHERE se.sequence_id = es.id AND se.status = 'active') as active_enrollment_count,
              c.name as campaign_name
       FROM email_sequences es
       LEFT JOIN campaigns c ON es.campaign_id = c.id
       ${whereSQL}
       ORDER BY es.created_at DESC, es.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: {
        sequences,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    console.error('List sequences error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while fetching sequences.',
    });
  }
});

// --- GET /:id - Sequence with steps and enrollment stats ---
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const sequences = await query<any[]>(
      `SELECT es.*, c.name as campaign_name
       FROM email_sequences es
       LEFT JOIN campaigns c ON es.campaign_id = c.id
       WHERE es.id = ? AND es.tenant_id = ?`,
      [id, req.user!.tenantId]
    );

    if (sequences.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Sequence not found.',
      });
      return;
    }

    // Fetch steps
    const steps = await query<any[]>(
      `SELECT * FROM sequence_steps
       WHERE sequence_id = ?
       ORDER BY step_number ASC`,
      [id]
    );

    // Fetch enrollment stats
    const enrollmentStats = await query<any[]>(
      `SELECT status, COUNT(*) as count
       FROM sequence_enrollments
       WHERE sequence_id = ? AND tenant_id = ?
       GROUP BY status`,
      [id, req.user!.tenantId]
    );

    // Fetch recent enrollments
    const enrollments = await query<any[]>(
      `SELECT se.*, p.email, p.first_name, p.last_name, p.full_name
       FROM sequence_enrollments se
       JOIN prospects p ON se.prospect_id = p.id
       WHERE se.sequence_id = ? AND se.tenant_id = ?
       ORDER BY se.enrolled_at DESC
       LIMIT 50`,
      [id, req.user!.tenantId]
    );

    // Per-step email stats
    const stepStats = await query<any[]>(
      `SELECT ss.id as step_id, ss.step_number,
              SUM(CASE WHEN ee.event_type = 'sent' THEN 1 ELSE 0 END) as sent,
              SUM(CASE WHEN ee.event_type = 'opened' THEN 1 ELSE 0 END) as opened,
              SUM(CASE WHEN ee.event_type = 'clicked' THEN 1 ELSE 0 END) as clicked,
              SUM(CASE WHEN ee.event_type = 'replied' THEN 1 ELSE 0 END) as replied,
              SUM(CASE WHEN ee.event_type = 'bounced' THEN 1 ELSE 0 END) as bounced
       FROM sequence_steps ss
       LEFT JOIN email_events ee ON ee.step_id = ss.id AND ee.tenant_id = ?
       WHERE ss.sequence_id = ?
       GROUP BY ss.id, ss.step_number
       ORDER BY ss.step_number ASC`,
      [req.user!.tenantId, id]
    );

    res.json({
      success: true,
      data: {
        ...sequences[0],
        steps,
        enrollments,
        enrollmentStats: enrollmentStats.reduce((acc: any, row: any) => {
          acc[row.status] = row.count;
          return acc;
        }, {}),
        stepStats,
      },
    });
  } catch (error: any) {
    console.error('Get sequence error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while fetching the sequence.',
    });
  }
});

// --- POST / - Create sequence ---
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = createSequenceSchema.safeParse(req.body);
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
      `INSERT INTO email_sequences (id, tenant_id, campaign_id, name, description, from_name, from_email,
       reply_to, send_window, settings, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.user!.tenantId,
        data.campaign_id || null,
        data.name,
        data.description || null,
        data.from_name || null,
        data.from_email || null,
        data.reply_to || null,
        data.send_window ? JSON.stringify(data.send_window) : null,
        data.settings ? JSON.stringify(data.settings) : null,
        req.user!.id,
      ]
    );

    const created = await query<any[]>('SELECT * FROM email_sequences WHERE id = ?', [id]);

    res.status(201).json({
      success: true,
      data: created[0],
    });
  } catch (error: any) {
    console.error('Create sequence error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while creating the sequence.',
    });
  }
});

// --- PUT /:id - Update sequence ---
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const validation = updateSequenceSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const existing = await query<any[]>('SELECT id FROM email_sequences WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    if (existing.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Sequence not found.',
      });
      return;
    }

    const data = validation.data;
    const setClauses: string[] = [];
    const params: any[] = [];

    const simpleFields: Record<string, string> = {
      name: 'name',
      campaign_id: 'campaign_id',
      description: 'description',
      from_name: 'from_name',
      from_email: 'from_email',
      reply_to: 'reply_to',
    };

    for (const [key, column] of Object.entries(simpleFields)) {
      if ((data as any)[key] !== undefined) {
        setClauses.push(`${column} = ?`);
        params.push((data as any)[key]);
      }
    }

    if (data.send_window !== undefined) {
      setClauses.push('send_window = ?');
      params.push(JSON.stringify(data.send_window));
    }

    if (data.settings !== undefined) {
      setClauses.push('settings = ?');
      params.push(JSON.stringify(data.settings));
    }

    if (setClauses.length === 0) {
      res.status(400).json({
        success: false,
        error: 'No fields to update.',
      });
      return;
    }

    params.push(id, req.user!.tenantId);

    await query(
      `UPDATE email_sequences SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`,
      params
    );

    const updated = await query<any[]>('SELECT * FROM email_sequences WHERE id = ?', [id]);

    res.json({
      success: true,
      data: updated[0],
    });
  } catch (error: any) {
    console.error('Update sequence error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while updating the sequence.',
    });
  }
});

// --- DELETE /:id - Delete sequence ---
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const existing = await query<any[]>('SELECT id FROM email_sequences WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    if (existing.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Sequence not found.',
      });
      return;
    }

    await query('DELETE FROM email_sequences WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);

    res.json({
      success: true,
      data: { message: 'Sequence deleted successfully.' },
    });
  } catch (error: any) {
    console.error('Delete sequence error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while deleting the sequence.',
    });
  }
});

export default router;
