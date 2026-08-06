import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query } from '../../config/database';
import { requireRole } from '../../middleware/auth';

const router = Router();

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5MB cap (DB + email size)

const uploadSchema = z.object({
  filename: z.string().min(1).max(255),
  mime_type: z.literal('application/pdf'),
  content_base64: z.string().min(1),
});

// Verify the campaign exists and belongs to the caller's tenant.
async function campaignInTenant(campaignId: string, tenantId: string): Promise<boolean> {
  const rows = await query<any[]>('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?', [campaignId, tenantId]);
  return rows.length > 0;
}

// --- POST /:id/attachments - Upsert the campaign's attachment (admin/manager) ---
router.post('/:id/attachments', requireRole('admin', 'manager'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const tenantId = req.user!.tenantId;

    const validation = uploadSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ success: false, error: 'Validation failed', details: validation.error.flatten().fieldErrors });
      return;
    }
    const { filename, mime_type, content_base64 } = validation.data;

    if (!(await campaignInTenant(id, tenantId))) {
      res.status(404).json({ success: false, error: 'Campaign not found.' });
      return;
    }

    // Base64 charset sanity check.
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(content_base64)) {
      res.status(400).json({ success: false, error: 'content_base64 is not valid base64.' });
      return;
    }

    const buffer = Buffer.from(content_base64, 'base64');
    if (buffer.length === 0) {
      res.status(400).json({ success: false, error: 'Decoded attachment is empty.' });
      return;
    }
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      res.status(413).json({ success: false, error: `Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes.` });
      return;
    }
    // Magic bytes: a real PDF starts with "%PDF".
    if (buffer.subarray(0, 4).toString('latin1') !== '%PDF') {
      res.status(400).json({ success: false, error: 'File does not look like a PDF (missing %PDF header).' });
      return;
    }

    // One attachment per campaign: replace any existing.
    await query('DELETE FROM campaign_attachments WHERE campaign_id = ? AND tenant_id = ?', [id, tenantId]);

    const attachmentId = uuidv4();
    await query(
      `INSERT INTO campaign_attachments (id, tenant_id, campaign_id, filename, mime_type, file_size, content_base64)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [attachmentId, tenantId, id, filename, mime_type, buffer.length, content_base64]
    );

    res.status(201).json({
      success: true,
      data: { id: attachmentId, campaign_id: id, filename, mime_type, file_size: buffer.length },
    });
  } catch (error: any) {
    console.error('Upload attachment error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while uploading the attachment.' });
  }
});

// --- GET /:id/attachments - Attachment metadata (no blob) ---
router.get('/:id/attachments', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const tenantId = req.user!.tenantId;
    const rows = await query<any[]>(
      `SELECT id, campaign_id, filename, mime_type, file_size, created_at, updated_at
       FROM campaign_attachments WHERE campaign_id = ? AND tenant_id = ?`,
      [id, tenantId]
    );
    res.json({ success: true, data: rows[0] || null });
  } catch (error: any) {
    console.error('Get attachment error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while fetching the attachment.' });
  }
});

// --- DELETE /:id/attachments - Remove the campaign's attachment (admin/manager) ---
router.delete('/:id/attachments', requireRole('admin', 'manager'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id);
    const tenantId = req.user!.tenantId;
    const result = await query<any>('DELETE FROM campaign_attachments WHERE campaign_id = ? AND tenant_id = ?', [id, tenantId]);
    res.json({ success: true, data: { deleted: result.affectedRows || 0 } });
  } catch (error: any) {
    console.error('Delete attachment error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while deleting the attachment.' });
  }
});

export default router;
