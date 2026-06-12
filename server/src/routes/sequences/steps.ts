import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query, getConnection } from '../../config/database';
import { getTenantConfig, buildTenantAIContext } from '../../middleware/tenant';
import { sanitizeEmailHtml } from '../../utils/sanitizeHtml';

const router = Router();

// Defensive caps to bound cost / DoS on unbounded loops.
const MAX_STEPS = 50;
const MAX_NUM_STEPS = 7;

// --- Validation Schemas ---

const stepSchema = z.object({
  step_number: z.number().int().positive().max(MAX_STEPS),
  step_type: z.enum(['email', 'wait', 'condition']).optional(),
  subject: z.string().optional().nullable(),
  body_html: z.string().optional().nullable(),
  body_text: z.string().optional().nullable(),
  delay_days: z.number().min(0).optional(),
  delay_hours: z.number().min(0).optional(),
  ab_variant: z.string().max(1).optional().nullable(),
  is_active: z.boolean().optional(),
  branch_label: z.string().max(50).optional().nullable(),
  condition_config: z.object({
    type: z.enum(['opened', 'clicked', 'replied']),
    step_id: z.string().uuid().optional(),
    threshold_hours: z.number().min(1).optional(),
  }).optional().nullable(),
  yes_target_step: z.number().positive().optional().nullable(),
  no_target_step: z.number().positive().optional().nullable(),
});

const addStepsSchema = z.object({
  steps: z.array(stepSchema).min(1, 'At least one step is required').max(MAX_STEPS, `At most ${MAX_STEPS} steps are allowed`),
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
           body_html, body_text, delay_days, delay_hours, ab_variant, branch_label,
           condition_config, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            stepId,
            id,
            step.step_number,
            step.step_type || 'email',
            step.subject || null,
            step.body_html ? sanitizeEmailHtml(step.body_html) : null,
            step.body_text || null,
            step.delay_days || 0,
            step.delay_hours || 0,
            step.ab_variant || null,
            step.branch_label || null,
            step.condition_config ? JSON.stringify(step.condition_config) : null,
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

// --- POST /:id/generate-personalized - Generate full personalized sequence with AI ---
router.post('/:id/generate-personalized', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { prospect_id, num_steps } = req.body;

    if (!prospect_id) {
      res.status(400).json({ success: false, error: 'prospect_id is required.' });
      return;
    }

    // Validate num_steps to a reasonable range (1..7) when provided.
    if (num_steps !== undefined && (!Number.isInteger(num_steps) || num_steps < 1 || num_steps > MAX_NUM_STEPS)) {
      res.status(400).json({ success: false, error: `num_steps must be an integer between 1 and ${MAX_NUM_STEPS}.` });
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

    const { generatePersonalizedSequence } = await import('../../services/ai');

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

    const { generateEmail } = await import('../../services/ai');

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

    const { generateBranchedSequence } = await import('../../services/ai');

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
            step.subject || null, step.body_html ? sanitizeEmailHtml(step.body_html) : null,
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

// --- POST /:id/wire-steps - Wire branching graph (set yes/no next step IDs) ---
router.post('/:id/wire-steps', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { wiring } = req.body;

    if (!wiring || !Array.isArray(wiring)) {
      res.status(400).json({ success: false, error: 'wiring array is required.' });
      return;
    }

    // Verify sequence belongs to tenant and get all valid step IDs
    const allSteps = await query<any[]>(
      `SELECT ss.id FROM sequence_steps ss
       JOIN email_sequences es ON ss.sequence_id = es.id
       WHERE es.id = ? AND es.tenant_id = ?`,
      [id, req.user!.tenantId]
    );

    if (allSteps.length === 0) {
      res.status(404).json({ success: false, error: 'Sequence not found or has no steps.' });
      return;
    }

    const validIds = new Set(allSteps.map((s: any) => s.id));

    let wired = 0;
    for (const w of wiring) {
      if (!w.step_id || !validIds.has(w.step_id)) continue;
      if (w.yes_next_step_id && !validIds.has(w.yes_next_step_id)) continue;
      if (w.no_next_step_id && !validIds.has(w.no_next_step_id)) continue;

      await query(
        `UPDATE sequence_steps ss
         JOIN email_sequences es ON ss.sequence_id = es.id AND es.tenant_id = ?
         SET ss.yes_next_step_id = ?, ss.no_next_step_id = ?
         WHERE ss.id = ? AND ss.sequence_id = ?`,
        [req.user!.tenantId, w.yes_next_step_id || null, w.no_next_step_id || null, w.step_id, id]
      );
      wired++;
    }

    if (wired > 0) {
      await query(
        'UPDATE email_sequences SET sequence_type = ? WHERE id = ? AND tenant_id = ?',
        ['branched', id, req.user!.tenantId]
      );
    }

    res.json({ success: true, data: { wired } });
  } catch (error: any) {
    console.error('Wire steps error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while wiring steps.' });
  }
});

export default router;
