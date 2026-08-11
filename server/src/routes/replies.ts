import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate } from '../middleware/auth';
import { recordReply } from '../services/replies';

const router = Router();

router.use(authenticate);

const CLASSIFICATIONS = ['positive', 'negative', 'unsubscribe', 'out_of_office', 'other'] as const;

const recordReplySchema = z.object({
  prospect_id: z.string().uuid().optional(),
  prospect_email: z.string().email().optional(),
  classification: z.enum(CLASSIFICATIONS),
  subject: z.string().max(500).optional(),
  snippet: z.string().max(2000).optional(),
  received_by: z.string().email().optional(),
  force: z.boolean().optional().default(false),
}).refine((d) => d.prospect_id || d.prospect_email, {
  message: 'prospect_id o prospect_email es obligatorio',
});

// --- GET / - List detected replies (email_events of type 'replied') ---
// Filters: ?since=YYYY-MM-DD, ?classification=positive|negative|..., ?prospect_id=
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    let whereClause = "ee.tenant_id = ? AND ee.event_type = 'replied'";
    const params: any[] = [tenantId];

    const since = req.query.since as string;
    if (since) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
        res.status(400).json({ success: false, error: 'Invalid since date. Use YYYY-MM-DD.' });
        return;
      }
      whereClause += ' AND ee.occurred_at >= ?';
      params.push(since);
    }

    const classification = req.query.classification as string;
    if (classification) {
      if (!CLASSIFICATIONS.includes(classification as any)) {
        res.status(400).json({ success: false, error: 'Invalid classification.' });
        return;
      }
      whereClause += " AND JSON_UNQUOTE(JSON_EXTRACT(ee.metadata, '$.reply_classification')) = ?";
      params.push(classification);
    }

    const prospectId = req.query.prospect_id as string;
    if (prospectId) {
      whereClause += ' AND ee.prospect_id = ?';
      params.push(prospectId);
    }

    const countRows = await query<any[]>(
      `SELECT COUNT(*) as total FROM email_events ee WHERE ${whereClause}`,
      params
    );
    const total = countRows[0]?.total || 0;

    const rows = await query<any[]>(
      `SELECT ee.id, ee.prospect_id, ee.subject, ee.metadata, ee.occurred_at,
              p.email as prospect_email, p.first_name, p.last_name, p.full_name,
              p.status as prospect_status, p.do_not_contact,
              c.name as company_name
       FROM email_events ee
       JOIN prospects p ON ee.prospect_id = p.id AND p.tenant_id = ee.tenant_id
       LEFT JOIN companies c ON p.company_id = c.id AND c.tenant_id = ee.tenant_id
       WHERE ${whereClause}
       ORDER BY ee.occurred_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const data = rows.map((row: any) => {
      let metadata: any = {};
      try {
        metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {};
      } catch {
        metadata = {};
      }
      return {
        id: row.id,
        prospect_id: row.prospect_id,
        prospect_email: row.prospect_email,
        prospect_name: row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' ') || null,
        prospect_status: row.prospect_status,
        do_not_contact: !!row.do_not_contact,
        company_name: row.company_name,
        subject: row.subject,
        occurred_at: row.occurred_at,
        reply_from: metadata.from || null,
        reply_classification: metadata.reply_classification || null,
        reply_snippet: metadata.reply_snippet || null,
        match_type: metadata.match_type || null,
        received_by: metadata.received_by || null,
        source: metadata.source || null,
      };
    });

    res.json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    console.error('Replies list error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while listing replies.' });
  }
});

// --- POST / - Record a reply detected in a manual mailbox sweep (e.g. M365) ---
// Feeds the same pipeline as IMAP detection: inserts the email_events 'replied' row,
// updates prospect status, stops enrollments and cancels scheduled follow-ups.
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenantId = req.user!.tenantId;
    const validation = recordReplySchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: validation.error.issues[0]?.message || 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }
    const data = validation.data;

    // Resolve prospect within the tenant (by id or by email)
    let prospectRows: any[];
    if (data.prospect_id) {
      prospectRows = await query<any[]>(
        'SELECT id, email FROM prospects WHERE id = ? AND tenant_id = ?',
        [data.prospect_id, tenantId]
      );
    } else {
      prospectRows = await query<any[]>(
        'SELECT id, email FROM prospects WHERE LOWER(email) = ? AND tenant_id = ? LIMIT 1',
        [data.prospect_email!.toLowerCase(), tenantId]
      );
    }
    if (prospectRows.length === 0) {
      res.status(404).json({ success: false, error: 'Prospect not found.' });
      return;
    }
    const prospect = prospectRows[0];

    // Dedupe: one recorded reply per prospect per 24h unless force
    if (!data.force) {
      const existing = await query<any[]>(
        `SELECT id FROM email_events
         WHERE prospect_id = ? AND tenant_id = ? AND event_type = 'replied'
           AND occurred_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
         LIMIT 1`,
        [prospect.id, tenantId]
      );
      if (existing.length > 0) {
        res.status(409).json({
          success: false,
          error: 'Ya existe una respuesta registrada en las últimas 24h para este prospect. Usa force:true para registrar otra.',
          data: { existing_event_id: existing[0].id },
        });
        return;
      }
    }

    const result = await recordReply({
      tenantId,
      prospectId: prospect.id,
      classification: data.classification,
      subject: data.subject || null,
      snippet: data.snippet || null,
      source: 'manual',
      from: prospect.email,
      receivedBy: data.received_by || null,
      recordedBy: req.user!.id,
    });

    res.status(201).json({
      success: true,
      data: {
        event_id: result.eventId,
        prospect_id: prospect.id,
        classification: data.classification,
        actions: {
          prospect_status: result.prospectStatus,
          do_not_contact: result.doNotContact,
          enrollments_stopped: result.enrollmentsStopped,
          scheduled_emails_cancelled: result.scheduledCancelled,
        },
      },
    });
  } catch (error: any) {
    console.error('Record reply error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while recording the reply.' });
  }
});

export default router;
