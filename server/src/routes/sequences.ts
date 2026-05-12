import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query, getConnection } from '../config/database';
import { authenticate } from '../middleware/auth';
import { getTenantConfig, buildTenantAIContext } from '../middleware/tenant';
import { calculateOptimalSendTime, resolveProspectTimezone } from '../services/scheduling';

const router = Router();

// All routes require authentication
router.use(authenticate);

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

const stepSchema = z.object({
  step_number: z.number().positive(),
  step_type: z.enum(['email', 'wait', 'condition']).optional(),
  subject: z.string().optional(),
  body_html: z.string().optional(),
  body_text: z.string().optional(),
  delay_days: z.number().min(0).optional(),
  delay_hours: z.number().min(0).optional(),
  ab_variant: z.string().max(1).optional().nullable(),
  is_active: z.boolean().optional(),
});

const addStepsSchema = z.object({
  steps: z.array(stepSchema).min(1, 'At least one step is required'),
});

const enrollProspectsSchema = z.object({
  prospect_ids: z.array(z.string().uuid()).min(1, 'At least one prospect ID is required'),
});

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
       ORDER BY es.created_at DESC
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

// --- POST /:id/steps - Add/update steps ---
router.post('/:id/steps', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const validation = addStepsSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    // Verify sequence exists
    const sequence = await query<any[]>('SELECT id FROM email_sequences WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    if (sequence.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Sequence not found.',
      });
      return;
    }

    const { steps } = validation.data;

    // Use a connection for transaction
    const conn = await getConnection();

    try {
      await conn.beginTransaction();

      // Delete existing steps and re-insert (upsert pattern)
      await conn.execute('DELETE FROM sequence_steps WHERE sequence_id = ?', [id]);

      for (const step of steps) {
        const stepId = uuidv4();
        await conn.execute(
          `INSERT INTO sequence_steps (id, sequence_id, step_number, step_type, subject,
           body_html, body_text, delay_days, delay_hours, ab_variant, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            stepId,
            id,
            step.step_number,
            step.step_type || 'email',
            step.subject || null,
            step.body_html || null,
            step.body_text || null,
            step.delay_days || 0,
            step.delay_hours || 0,
            step.ab_variant || null,
            step.is_active !== undefined ? step.is_active : true,
          ]
        );
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // Fetch updated steps
    const updatedSteps = await query<any[]>(
      `SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_number ASC`,
      [id]
    );

    res.json({
      success: true,
      data: updatedSteps,
    });
  } catch (error: any) {
    console.error('Add/update steps error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while updating sequence steps.',
    });
  }
});

// --- POST /:id/enroll - Enroll prospects ---
router.post('/:id/enroll', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const validation = enrollProspectsSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    // Verify sequence exists and is active or draft
    const sequences = await query<any[]>(
      'SELECT id, status FROM email_sequences WHERE id = ? AND tenant_id = ?',
      [id, req.user!.tenantId]
    );

    if (sequences.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Sequence not found.',
      });
      return;
    }

    // Get the first step to calculate next_send_at
    const firstStep = await query<any[]>(
      `SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_number ASC LIMIT 1`,
      [id]
    );

    // Get sequence send_window for scheduling
    const seqForWindow = await query<any[]>(
      'SELECT send_window FROM email_sequences WHERE id = ?',
      [id]
    );
    const seqSendWindow = seqForWindow.length > 0
      ? (typeof seqForWindow[0].send_window === 'string'
          ? (() => { try { return JSON.parse(seqForWindow[0].send_window); } catch { return undefined; } })()
          : seqForWindow[0].send_window)
      : undefined;

    const { prospect_ids } = validation.data;
    let enrolledCount = 0;
    let skippedCount = 0;

    for (const prospectId of prospect_ids) {
      try {
        const enrollmentId = uuidv4();

        // Get prospect timezone for smart scheduling
        const prospectRows = await query<any[]>(
          'SELECT timezone, country, city FROM prospects WHERE id = ?',
          [prospectId]
        );
        const prospectData = prospectRows.length > 0 ? prospectRows[0] : {};
        const prospectTz = resolveProspectTimezone(prospectData);

        // Calculate raw next send time based on first step delay
        let rawNextSendAt = new Date();
        if (firstStep.length > 0) {
          rawNextSendAt.setDate(rawNextSendAt.getDate() + (firstStep[0].delay_days || 0));
          rawNextSendAt.setHours(rawNextSendAt.getHours() + (firstStep[0].delay_hours || 0));
        }

        // Adjust to optimal send time (no weekends, best hour for prospect's timezone)
        const nextSendAt = calculateOptimalSendTime(rawNextSendAt, prospectTz, seqSendWindow);

        // A/B variant assignment: check if sequence has A/B steps
        const abSteps = await query<any[]>(
          `SELECT DISTINCT ab_variant FROM sequence_steps
           WHERE sequence_id = ? AND ab_variant IS NOT NULL`,
          [id]
        );
        const assignedVariant = abSteps.length > 1 ? (Math.random() < 0.5 ? 'A' : 'B') : null;

        // Get first step ID for branched tracking
        const firstStepId = firstStep.length > 0 ? firstStep[0].id : null;

        await query(
          `INSERT INTO sequence_enrollments (id, tenant_id, sequence_id, prospect_id, current_step, current_step_id, ab_variant, status, next_send_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, 'active', ?)`,
          [enrollmentId, req.user!.tenantId, id, prospectId, firstStepId, assignedVariant, nextSendAt]
        );

        // Log activity
        await query(
          `INSERT INTO prospect_activities (id, tenant_id, prospect_id, activity_type, title, performed_by)
           VALUES (?, ?, ?, 'enrolled', 'Enrolled in email sequence', ?)`,
          [uuidv4(), req.user!.tenantId, prospectId, req.user!.id]
        );

        enrolledCount++;
      } catch (err: any) {
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
        message: `Enrolled ${enrolledCount} prospect(s). ${skippedCount} already enrolled.`,
        enrolledCount,
        skippedCount,
      },
    });
  } catch (error: any) {
    console.error('Enroll prospects error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while enrolling prospects.',
    });
  }
});

// --- POST /:id/pause - Pause sequence ---
router.post('/:id/pause', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const existing = await query<any[]>('SELECT id, status FROM email_sequences WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    if (existing.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Sequence not found.',
      });
      return;
    }

    await query('UPDATE email_sequences SET status = ? WHERE id = ? AND tenant_id = ?', ['paused', id, req.user!.tenantId]);

    // Pause all active enrollments
    await query(
      `UPDATE sequence_enrollments SET status = 'paused' WHERE sequence_id = ? AND status = 'active'`,
      [id]
    );

    res.json({
      success: true,
      data: { message: 'Sequence paused successfully.' },
    });
  } catch (error: any) {
    console.error('Pause sequence error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while pausing the sequence.',
    });
  }
});

// --- POST /:id/resume - Resume sequence ---
router.post('/:id/resume', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const existing = await query<any[]>('SELECT id, status FROM email_sequences WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    if (existing.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Sequence not found.',
      });
      return;
    }

    await query('UPDATE email_sequences SET status = ? WHERE id = ? AND tenant_id = ?', ['active', id, req.user!.tenantId]);

    // Resume paused enrollments and recalculate next_send_at
    await query(
      `UPDATE sequence_enrollments SET status = 'active', next_send_at = NOW()
       WHERE sequence_id = ? AND status = 'paused'`,
      [id]
    );

    res.json({
      success: true,
      data: { message: 'Sequence resumed successfully.' },
    });
  } catch (error: any) {
    console.error('Resume sequence error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while resuming the sequence.',
    });
  }
});

// --- POST /:id/generate-personalized - Generate full personalized sequence with AI ---
router.post('/:id/generate-personalized', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { prospect_id, num_steps } = req.body;

    if (!prospect_id) {
      res.status(400).json({ success: false, error: 'prospect_id is required.' });
      return;
    }

    // Load sequence with campaign
    const sequences = await query<any[]>(
      `SELECT es.*, c.name as campaign_name, c.asset_type, c.asset_location,
              c.asset_price, c.description as campaign_description, c.asset_details
       FROM email_sequences es
       LEFT JOIN campaigns c ON es.campaign_id = c.id
       WHERE es.id = ? AND es.tenant_id = ?`,
      [id, req.user!.tenantId]
    );

    if (sequences.length === 0) {
      res.status(404).json({ success: false, error: 'Sequence not found.' });
      return;
    }

    const sequence = sequences[0];

    // Load existing steps as template reference
    const existingSteps = await query<any[]>(
      `SELECT step_number, subject, body_html, delay_days FROM sequence_steps
       WHERE sequence_id = ? ORDER BY step_number ASC`,
      [id]
    );

    // Load prospect with enrichment
    const prospects = await query<any[]>(
      `SELECT p.*, c.name as company_name, c.industry as company_industry,
              c.employee_count, c.annual_revenue
       FROM prospects p
       LEFT JOIN companies c ON p.company_id = c.id
       WHERE p.id = ? AND p.tenant_id = ?`,
      [prospect_id, req.user!.tenantId]
    );

    if (prospects.length === 0) {
      res.status(404).json({ success: false, error: 'Prospect not found.' });
      return;
    }

    const prospect = prospects[0];

    // Parse enrichment_data
    let enrichment = null;
    if (prospect.enrichment_data) {
      enrichment = typeof prospect.enrichment_data === 'string'
        ? JSON.parse(prospect.enrichment_data)
        : prospect.enrichment_data;
    }

    // Parse asset_details
    let assetDetails = null;
    if (sequence.asset_details) {
      assetDetails = typeof sequence.asset_details === 'string'
        ? JSON.parse(sequence.asset_details)
        : sequence.asset_details;
    }

    const { generatePersonalizedSequence } = await import('../services/ai');

    // Build tenant AI context
    const tenant = await getTenantConfig(req.user!.tenantId);
    const tenantAIContext = tenant ? buildTenantAIContext(tenant) : undefined;

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
        name: sequence.campaign_name || sequence.name,
        description: sequence.campaign_description,
        asset_type: sequence.asset_type,
        asset_location: sequence.asset_location,
        asset_price: sequence.asset_price ? parseFloat(sequence.asset_price) : undefined,
        asset_details: assetDetails,
      },
      existingSteps,
      num_steps || 4,
      tenantAIContext
    );

    res.json({
      success: true,
      data: {
        prospect: {
          id: prospect.id,
          name: `${prospect.first_name || ''} ${prospect.last_name || ''}`.trim(),
          email: prospect.email,
          title: prospect.title,
          company: prospect.company_name,
        },
        campaign: {
          name: sequence.campaign_name,
          asset_type: sequence.asset_type,
          location: sequence.asset_location,
        },
        steps: generatedSteps,
      },
    });
  } catch (error: any) {
    console.error('Generate personalized sequence error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'An error occurred while generating the personalized sequence.',
    });
  }
});

// --- POST /:id/generate-step - Generate email content with AI ---
router.post('/:id/generate-step', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { step_number, prospect_id } = req.body;

    // Load the sequence with campaign
    const sequences = await query<any[]>(
      `SELECT es.*, c.name as campaign_name, c.asset_type, c.asset_location,
              c.asset_price, c.description as campaign_description
       FROM email_sequences es
       LEFT JOIN campaigns c ON es.campaign_id = c.id
       WHERE es.id = ? AND es.tenant_id = ?`,
      [id, req.user!.tenantId]
    );

    if (sequences.length === 0) {
      res.status(404).json({ success: false, error: 'Sequence not found.' });
      return;
    }

    const sequence = sequences[0];

    // Load prospect data if provided
    let prospectData: any = {
      first_name: 'Prospecto',
      title: 'Director',
      company_name: 'Empresa',
    };

    if (prospect_id) {
      const prospects = await query<any[]>(
        `SELECT p.*, c.name as company_name, c.industry as company_industry
         FROM prospects p
         LEFT JOIN companies c ON p.company_id = c.id
         WHERE p.id = ? AND p.tenant_id = ?`,
        [prospect_id, req.user!.tenantId]
      );
      if (prospects.length > 0) {
        prospectData = prospects[0];
      }
    }

    const { generateEmail } = await import('../services/ai');

    // Build tenant AI context
    const tenantForAI = await getTenantConfig(req.user!.tenantId);
    const tenantAICtx = tenantForAI ? buildTenantAIContext(tenantForAI) : undefined;

    const result = await generateEmail(
      {
        first_name: prospectData.first_name,
        last_name: prospectData.last_name,
        title: prospectData.title,
        company_name: prospectData.company_name,
        industry: prospectData.company_industry,
        city: prospectData.city,
        region: prospectData.region,
        country: prospectData.country,
      },
      {
        name: sequence.campaign_name || sequence.name,
        asset_type: sequence.asset_type,
        asset_location: sequence.asset_location,
        asset_price: sequence.asset_price,
        description: sequence.campaign_description,
      },
      step_number || 1,
      tenantAICtx
    );

    res.json({
      success: true,
      data: {
        subject: result.subject,
        body: result.body,
        step_number: step_number || 1,
      },
    });
  } catch (error: any) {
    console.error('Generate email step error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'An error occurred while generating email content.',
    });
  }
});

// --- POST /:id/generate-branched - Generate branched decision tree sequence with AI ---
router.post('/:id/generate-branched', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { prospect_id } = req.body;

    if (!prospect_id) {
      res.status(400).json({ success: false, error: 'prospect_id is required.' });
      return;
    }

    // Load sequence with campaign
    const sequences = await query<any[]>(
      `SELECT es.*, c.name as campaign_name, c.asset_type, c.asset_location,
              c.asset_price, c.description as campaign_description, c.asset_details
       FROM email_sequences es
       LEFT JOIN campaigns c ON es.campaign_id = c.id
       WHERE es.id = ? AND es.tenant_id = ?`,
      [id, req.user!.tenantId]
    );

    if (sequences.length === 0) {
      res.status(404).json({ success: false, error: 'Sequence not found.' });
      return;
    }

    const sequence = sequences[0];

    // Load prospect with enrichment
    const prospects = await query<any[]>(
      `SELECT p.*, c.name as company_name, c.industry as company_industry
       FROM prospects p
       LEFT JOIN companies c ON p.company_id = c.id
       WHERE p.id = ? AND p.tenant_id = ?`,
      [prospect_id, req.user!.tenantId]
    );

    if (prospects.length === 0) {
      res.status(404).json({ success: false, error: 'Prospect not found.' });
      return;
    }

    const prospect = prospects[0];

    let enrichment = null;
    if (prospect.enrichment_data) {
      enrichment = typeof prospect.enrichment_data === 'string'
        ? JSON.parse(prospect.enrichment_data)
        : prospect.enrichment_data;
    }

    let assetDetails = null;
    if (sequence.asset_details) {
      assetDetails = typeof sequence.asset_details === 'string'
        ? JSON.parse(sequence.asset_details)
        : sequence.asset_details;
    }

    const { generateBranchedSequence } = await import('../services/ai');

    const tenant = await getTenantConfig(req.user!.tenantId);
    const tenantAIContext = tenant ? buildTenantAIContext(tenant) : undefined;

    const branchedSteps = await generateBranchedSequence(
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
        name: sequence.campaign_name || sequence.name,
        description: sequence.campaign_description,
        asset_type: sequence.asset_type,
        asset_location: sequence.asset_location,
        asset_price: sequence.asset_price,
        asset_details: assetDetails,
      },
      tenantAIContext
    );

    // Save branched steps to sequence_steps (2-pass: insert then wire FKs)
    const conn = await getConnection();
    try {
      await conn.beginTransaction();

      // Delete existing steps
      await conn.execute('DELETE FROM sequence_steps WHERE sequence_id = ?', [id]);

      // Pass 1: Insert all steps, collect step_number -> UUID mapping
      const stepIdMap: Record<number, string> = {};
      for (const step of branchedSteps) {
        const stepId = uuidv4();
        stepIdMap[step.step_number] = stepId;

        await conn.execute(
          `INSERT INTO sequence_steps (id, sequence_id, step_number, step_type, subject,
           body_html, delay_days, delay_hours, branch_label, condition_config, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
          [
            stepId, id, step.step_number, step.step_type,
            step.subject || null, step.body_html || null,
            step.delay_days, step.delay_hours,
            step.branch_label || null,
            step.condition_config ? JSON.stringify(step.condition_config) : null,
          ]
        );
      }

      // Pass 2: Wire condition nodes to their YES/NO targets
      for (const step of branchedSteps) {
        if (step.yes_target_step || step.no_target_step) {
          const yesId = step.yes_target_step ? stepIdMap[step.yes_target_step] : null;
          const noId = step.no_target_step ? stepIdMap[step.no_target_step] : null;
          await conn.execute(
            `UPDATE sequence_steps SET yes_next_step_id = ?, no_next_step_id = ?
             WHERE id = ? AND sequence_id = ?`,
            [yesId, noId, stepIdMap[step.step_number], id]
          );
        }
      }

      // Mark sequence as branched
      await conn.execute(
        `UPDATE email_sequences SET sequence_type = 'branched' WHERE id = ? AND tenant_id = ?`,
        [id, req.user!.tenantId]
      );

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    // Load saved steps for response
    const savedSteps = await query<any[]>(
      `SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY step_number ASC`,
      [id]
    );

    res.json({
      success: true,
      data: {
        prospect: {
          id: prospect.id,
          name: `${prospect.first_name} ${prospect.last_name}`,
          email: prospect.email,
          title: prospect.title,
          company: prospect.company_name,
        },
        campaign: {
          name: sequence.campaign_name || sequence.name,
          asset_type: sequence.asset_type,
          location: sequence.asset_location,
        },
        sequence_type: 'branched',
        steps: savedSteps,
      },
    });
  } catch (error: any) {
    console.error('Generate branched sequence error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'An error occurred while generating the branched sequence.',
    });
  }
});

// --- GET /:id/graph - Get sequence as graph (nodes + edges) for visualization ---
router.get('/:id/graph', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Verify sequence belongs to tenant
    const sequences = await query<any[]>(
      'SELECT id, sequence_type FROM email_sequences WHERE id = ? AND tenant_id = ?',
      [id, req.user!.tenantId]
    );

    if (sequences.length === 0) {
      res.status(404).json({ success: false, error: 'Sequence not found.' });
      return;
    }

    const steps = await query<any[]>(
      `SELECT id, step_number, step_type, subject, delay_days, delay_hours,
              ab_variant, condition_config, yes_next_step_id, no_next_step_id,
              branch_label, is_active
       FROM sequence_steps WHERE sequence_id = ? ORDER BY step_number ASC`,
      [id]
    );

    const nodes = steps.map(s => {
      const condConfig = s.condition_config
        ? (typeof s.condition_config === 'string' ? JSON.parse(s.condition_config) : s.condition_config)
        : null;

      return {
        id: s.id,
        step_number: s.step_number,
        type: s.step_type,
        label: s.step_type === 'condition'
          ? `${condConfig?.type || 'condition'}?`
          : (s.subject || `Step ${s.step_number}`),
        delay_days: s.delay_days,
        delay_hours: s.delay_hours,
        ab_variant: s.ab_variant,
        branch_label: s.branch_label,
        is_active: s.is_active,
      };
    });

    const edges: Array<{ from: string; to: string; label: string }> = [];
    for (const step of steps) {
      if (step.yes_next_step_id) {
        edges.push({ from: step.id, to: step.yes_next_step_id, label: 'YES' });
      }
      if (step.no_next_step_id) {
        edges.push({ from: step.id, to: step.no_next_step_id, label: 'NO' });
      }
      // Implicit linear edges for non-condition steps without explicit routing
      if (!step.yes_next_step_id && !step.no_next_step_id && step.step_type !== 'condition') {
        const nextLinear = steps.find((s: any) => s.step_number === step.step_number + 1);
        if (nextLinear) {
          edges.push({ from: step.id, to: nextLinear.id, label: '' });
        }
      }
    }

    res.json({
      success: true,
      data: {
        sequence_type: sequences[0].sequence_type || 'linear',
        nodes,
        edges,
      },
    });
  } catch (error: any) {
    console.error('Get sequence graph error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'An error occurred while fetching the sequence graph.',
    });
  }
});

export default router;
