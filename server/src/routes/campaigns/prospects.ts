import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query } from '../../config/database';

const router = Router();

// --- Validation Schemas ---

const addProspectsSchema = z.object({
  prospect_ids: z.array(z.string().uuid()).min(1, 'At least one prospect ID is required'),
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

    // Verify campaign exists and belongs to tenant (tenant_id check)
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

// --- DELETE /:id/prospects/:prospectId - Remove prospect from campaign ---
// Note: campaign_prospects has no tenant_id column; tenant isolation is enforced
// by verifying campaign ownership (tenant_id) before operating on the join table.
router.delete('/:id/prospects/:prospectId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, prospectId } = req.params;
    const tenantId = req.user!.tenantId;

    // Verify campaign belongs to this tenant (tenant_id filter on campaigns)
    const campaignCheck = await query<any[]>(
      'SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?',
      [id, tenantId]
    );
    if (campaignCheck.length === 0) {
      res.status(404).json({ success: false, error: 'Campaign not found.' });
      return;
    }

    // Safe: campaign_id already verified as belonging to tenant_id above
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
