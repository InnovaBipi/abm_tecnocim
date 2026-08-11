import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query } from '../../config/database';
import { checkCrossCampaignContact, formatBlocked } from '../../services/contactGuard';

const router = Router();

// --- Validation Schemas ---

const addProspectsSchema = z.object({
  prospect_ids: z.array(z.string().uuid()).min(1, 'At least one prospect ID is required'),
  force: z.boolean().optional(),
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

    const { prospect_ids, force } = validation.data;

    // Only prospects belonging to this tenant may be enrolled (prospect ids are
    // client-supplied; without this check a foreign tenant's prospect id would insert)
    const ph = prospect_ids.map(() => '?').join(',');
    const ownRows = await query<any[]>(
      `SELECT id FROM prospects WHERE id IN (${ph}) AND tenant_id = ?`,
      [...prospect_ids, req.user!.tenantId]
    );
    const ownIds = new Set(ownRows.map((r) => r.id));
    const invalidCount = prospect_ids.length - ownIds.size;

    // Cross-campaign contact guard (layer A): impacted/queued/reserved elsewhere -> blocked
    const guard = await checkCrossCampaignContact(req.user!.tenantId, String(id), [...ownIds], {
      checkEnrollment: true, checkDomain: true,
    });
    const blockedSet = force ? new Set<string>() : new Set(guard.blockedIds);

    let addedCount = 0;
    let skippedCount = 0;

    for (const prospectId of prospect_ids) {
      if (!ownIds.has(prospectId) || blockedSet.has(prospectId)) continue;
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

    const blocked = force ? [] : formatBlocked(guard);
    res.json({
      success: true,
      data: {
        message: `Added ${addedCount} prospect(s) to campaign. ${skippedCount} already in campaign.${blocked.length > 0 ? ` ${blocked.length} blocked (already contacted by another campaign).` : ''}`,
        addedCount,
        skippedCount,
        invalidCount,
        blocked_cross_campaign: blocked,
        domain_warnings: guard.domainWarnings,
        forced: !!force,
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
