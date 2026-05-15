import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query } from '../../config/database';
import { calculateOptimalSendTime, resolveProspectTimezone } from '../../services/scheduling';

const router = Router();

// --- Validation Schemas ---

const enrollProspectsSchema = z.object({
  prospect_ids: z.array(z.string().uuid()).min(1, 'At least one prospect ID is required'),
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
      'SELECT send_window FROM email_sequences WHERE id = ? AND tenant_id = ?',
      [id, req.user!.tenantId]
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
          'SELECT timezone, country, city FROM prospects WHERE id = ? AND tenant_id = ?',
          [prospectId, req.user!.tenantId]
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
      `UPDATE sequence_enrollments SET status = 'paused' WHERE sequence_id = ? AND tenant_id = ? AND status = 'active'`,
      [id, req.user!.tenantId]
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
       WHERE sequence_id = ? AND tenant_id = ? AND status = 'paused'`,
      [id, req.user!.tenantId]
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

export default router;
