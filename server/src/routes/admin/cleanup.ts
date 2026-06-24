import { Router, Request, Response } from 'express';
import { query } from '../../config/database';
import { authenticate } from '../../middleware/auth';

const router = Router();

// DELETE ALL SCHEDULED emails created today (tenant-scoped)
router.post('/cleanup-today', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;

    // Count ALL SCHEDULED emails created today
    const countResult = await query<any[]>(
      `SELECT COUNT(*) as count FROM generated_emails
       WHERE tenant_id = ? AND DATE(created_at) = CURDATE() AND status IN ('scheduled', 'draft')`,
      [tenantId]
    );

    const countToDelete = countResult[0]?.count || 0;

    if (countToDelete === 0) {
      res.json({ success: true, data: { message: 'No emails to delete', deleted: 0 } });
      return;
    }

    // DELETE ALL SCHEDULED/DRAFT emails created today (tenant-scoped)
    const deleteResult = await query(
      `DELETE FROM generated_emails
       WHERE tenant_id = ? AND DATE(created_at) = CURDATE() AND status IN ('scheduled', 'draft')`,
      [tenantId]
    );

    // Verify prospects preserved
    const prospectCount = await query<any[]>(
      `SELECT COUNT(*) as count FROM prospects
       WHERE tenant_id = ?`,
      [tenantId]
    );

    res.json({
      success: true,
      data: {
        message: `Deleted ALL ${deleteResult[0]?.affectedRows || 0} emails created today`,
        deleted: deleteResult[0]?.affectedRows || 0,
        prospects_preserved: prospectCount[0]?.count || 0,
      },
    });
  } catch (error: any) {
    console.error('Cleanup error:', error);
    res.status(500).json({ success: false, error: 'Cleanup failed: ' + error.message });
  }
});

export default router;
