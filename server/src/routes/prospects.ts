import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate } from '../middleware/auth';
import { checkCrossCampaignContact, formatBlocked } from '../services/contactGuard';

const router = Router();

// All routes require authentication
router.use(authenticate);

// --- Validation Schemas ---

const createProspectSchema = z.object({
  email: z.string().email('Invalid email address'),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  title: z.string().optional(),
  seniority: z.string().optional(),
  department: z.string().optional(),
  phone: z.string().optional(),
  linkedin_url: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  timezone: z.string().optional(),
  company_id: z.string().uuid().optional().nullable(),
  status: z.enum(['new', 'enriched', 'qualified', 'contacted', 'replied', 'interested', 'meeting', 'converted', 'unsubscribed', 'bounced']).optional(),
  source: z.string().optional(),
  source_detail: z.string().optional(),
  custom_fields: z.record(z.any()).optional(),
  notes: z.string().optional().nullable(),
  enrichment_data: z.record(z.any()).optional().nullable(),
  company_name: z.string().optional().nullable(),
  do_not_contact: z.boolean().optional(),
});

const updateProspectSchema = createProspectSchema.partial();

const bulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'At least one ID is required'),
});

const bulkUpdateSchema = z.object({
  prospect_ids: z.array(z.string().uuid()).min(1, 'At least one prospect ID is required'),
  updates: z.object({
    status: z.enum(['new', 'enriched', 'qualified', 'contacted', 'replied', 'interested', 'meeting', 'converted', 'unsubscribed', 'bounced']).optional(),
    company_id: z.string().uuid().optional().nullable(),
    source: z.string().optional(),
  }).refine(
    (data) => Object.values(data).some((v) => v !== undefined),
    { message: 'At least one field to update is required' }
  ),
});

// --- GET / - List prospects with pagination, search, filters, sorting ---
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const offset = (page - 1) * limit;

    const search = req.query.search as string;
    const status = req.query.status as string;
    const source = req.query.source as string;
    const scoreMin = req.query.score_min ? parseInt(req.query.score_min as string) : undefined;
    const scoreMax = req.query.score_max ? parseInt(req.query.score_max as string) : undefined;
    const companyId = req.query.company_id as string;
    const sortBy = (req.query.sort_by as string) || 'created_at';
    const sortOrder = (req.query.sort_order as string)?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Allowed sort columns to prevent SQL injection
    const allowedSortColumns = ['created_at', 'updated_at', 'lead_score', 'first_name', 'last_name', 'email', 'status'];
    const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at';

    let whereClauses: string[] = ['p.tenant_id = ?'];
    let params: any[] = [req.user!.tenantId];

    // Full-text search
    if (search && search.trim()) {
      whereClauses.push('MATCH(p.first_name, p.last_name, p.email, p.title) AGAINST(? IN BOOLEAN MODE)');
      params.push(search + '*');
    }

    // Filters
    if (status) {
      whereClauses.push('p.status = ?');
      params.push(status);
    }

    if (source) {
      whereClauses.push('p.source = ?');
      params.push(source);
    }

    if (scoreMin !== undefined) {
      whereClauses.push('p.lead_score >= ?');
      params.push(scoreMin);
    }

    if (scoreMax !== undefined) {
      whereClauses.push('p.lead_score <= ?');
      params.push(scoreMax);
    }

    if (companyId) {
      whereClauses.push('p.company_id = ?');
      params.push(companyId);
    }

    const whereSQL = 'WHERE ' + whereClauses.join(' AND ');

    // Count total matching records
    const countResult = await query<any[]>(
      `SELECT COUNT(*) as total FROM prospects p ${whereSQL}`,
      params
    );
    const total = countResult[0].total;

    // Fetch records with company info
    const prospects = await query<any[]>(
      `SELECT p.id, p.tenant_id, p.email, p.first_name, p.last_name, p.full_name,
              p.title, p.company_id, p.phone, p.city, p.region, p.country,
              p.timezone, p.status, p.lead_score, p.source, p.linkedin_url,
              p.do_not_contact, p.last_contacted, p.created_at, p.updated_at,
              c.name as company_name, c.domain as company_domain, c.tier as company_tier
       FROM prospects p
       LEFT JOIN companies c ON p.company_id = c.id
       ${whereSQL}
       ORDER BY p.${safeSortBy} ${sortOrder}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: {
        prospects,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    console.error('List prospects error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while fetching prospects.',
    });
  }
});

// --- GET /export - Export prospects as CSV ---
router.get('/export', async (req: Request, res: Response): Promise<void> => {
  try {
    const search = req.query.search as string;
    const status = req.query.status as string;
    const source = req.query.source as string;
    const scoreMin = req.query.score_min ? parseInt(req.query.score_min as string) : undefined;
    const scoreMax = req.query.score_max ? parseInt(req.query.score_max as string) : undefined;
    const companyId = req.query.company_id as string;

    let whereClauses: string[] = ['p.tenant_id = ?'];
    let params: any[] = [req.user!.tenantId];

    if (search && search.trim()) {
      whereClauses.push('MATCH(p.first_name, p.last_name, p.email, p.title) AGAINST(? IN BOOLEAN MODE)');
      params.push(search + '*');
    }

    if (status) {
      whereClauses.push('p.status = ?');
      params.push(status);
    }

    if (source) {
      whereClauses.push('p.source = ?');
      params.push(source);
    }

    if (scoreMin !== undefined) {
      whereClauses.push('p.lead_score >= ?');
      params.push(scoreMin);
    }

    if (scoreMax !== undefined) {
      whereClauses.push('p.lead_score <= ?');
      params.push(scoreMax);
    }

    if (companyId) {
      whereClauses.push('p.company_id = ?');
      params.push(companyId);
    }

    const whereSQL = 'WHERE ' + whereClauses.join(' AND ');

    const prospects = await query<any[]>(
      `SELECT p.email, p.first_name, p.last_name, p.title, c.name as company_name,
              c.industry, p.city, p.region, p.country, p.status, p.lead_score,
              p.source, p.created_at
       FROM prospects p
       LEFT JOIN companies c ON p.company_id = c.id
       ${whereSQL}
       ORDER BY p.created_at DESC`,
      params
    );

    // Build CSV
    const csvHeaders = ['email', 'first_name', 'last_name', 'title', 'company_name', 'industry', 'city', 'region', 'country', 'status', 'score', 'source', 'created_at'];

    const escapeCsvField = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      let str = String(value);
      // Neutralize CSV formula injection: a leading =, +, -, @, tab or CR makes
      // spreadsheet apps evaluate the cell as a formula. Prefix with a single quote.
      if (/^[=+\-@\t\r]/.test(str)) {
        str = "'" + str;
      }
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const lines: string[] = [csvHeaders.join(',')];
    for (const row of prospects) {
      lines.push([
        escapeCsvField(row.email),
        escapeCsvField(row.first_name),
        escapeCsvField(row.last_name),
        escapeCsvField(row.title),
        escapeCsvField(row.company_name),
        escapeCsvField(row.industry),
        escapeCsvField(row.city),
        escapeCsvField(row.region),
        escapeCsvField(row.country),
        escapeCsvField(row.status),
        escapeCsvField(row.lead_score),
        escapeCsvField(row.source),
        escapeCsvField(row.created_at ? new Date(row.created_at).toISOString() : ''),
      ].join(','));
    }

    const csv = '\uFEFF' + lines.join('\r\n');
    const dateStr = new Date().toISOString().substring(0, 10);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="prospects-export-${dateStr}.csv"`);
    res.send(csv);
  } catch (error: any) {
    console.error('Export prospects error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while exporting prospects.',
    });
  }
});

// --- GET /:id - Single prospect with company data and recent activities ---
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const prospects = await query<any[]>(
      `SELECT p.id, p.tenant_id, p.email, p.first_name, p.last_name, p.full_name,
              p.title, p.seniority, p.department, p.company_id, p.phone,
              p.linkedin_url, p.city, p.region, p.country, p.timezone,
              p.email_verified, p.email_status, p.status, p.lead_score,
              p.custom_fields, p.enrichment_data, p.source, p.source_detail,
              p.last_contacted, p.last_replied, p.do_not_contact,
              p.created_at, p.updated_at,
              c.name as company_name, c.domain as company_domain,
              c.industry as company_industry, c.tier as company_tier,
              c.website_url as company_website, c.employee_count as company_employee_count
       FROM prospects p
       LEFT JOIN companies c ON p.company_id = c.id
       WHERE p.id = ? AND p.tenant_id = ?`,
      [id, req.user!.tenantId]
    );

    if (prospects.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Prospect not found.',
      });
      return;
    }

    // Fetch recent activities
    const activities = await query<any[]>(
      `SELECT id, prospect_id, activity_type, title, description, metadata,
              performed_by, occurred_at
       FROM prospect_activities
       WHERE prospect_id = ? AND tenant_id = ?
       ORDER BY occurred_at DESC
       LIMIT 20`,
      [id, req.user!.tenantId]
    );

    // Fetch tags
    const tags = await query<any[]>(
      `SELECT t.id, t.name, t.color
       FROM tags t
       JOIN prospect_tags pt ON t.id = pt.tag_id
       WHERE pt.prospect_id = ? AND t.tenant_id = ?`,
      [id, req.user!.tenantId]
    );

    res.json({
      success: true,
      data: {
        ...prospects[0],
        activities,
        tags,
      },
    });
  } catch (error: any) {
    console.error('Get prospect error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while fetching the prospect.',
    });
  }
});

// --- POST / - Create prospect ---
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = createProspectSchema.safeParse(req.body);
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

    // Check for duplicate email in this tenant
    const existing = await query<any[]>(
      'SELECT id FROM prospects WHERE email = ? AND tenant_id = ?',
      [data.email, req.user!.tenantId]
    );

    if (existing.length > 0) {
      res.status(409).json({
        success: false,
        error: 'A prospect with this email already exists.',
      });
      return;
    }

    await query(
      `INSERT INTO prospects (id, tenant_id, email, first_name, last_name, title, seniority, department,
       phone, linkedin_url, city, region, country, timezone, company_id, status, source,
       source_detail, custom_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.user!.tenantId,
        data.email,
        data.first_name || null,
        data.last_name || null,
        data.title || null,
        data.seniority || null,
        data.department || null,
        data.phone || null,
        data.linkedin_url || null,
        data.city || null,
        data.region || null,
        data.country || null,
        data.timezone || null,
        data.company_id || null,
        data.status || 'new',
        data.source || 'manual',
        data.source_detail || null,
        data.custom_fields ? JSON.stringify(data.custom_fields) : null,
      ]
    );

    // Log activity
    await query(
      `INSERT INTO prospect_activities (id, tenant_id, prospect_id, activity_type, title, performed_by)
       VALUES (?, ?, ?, 'created', 'Prospect created', ?)`,
      [uuidv4(), req.user!.tenantId, id, req.user!.id]
    );

    // Fetch the created prospect
    const created = await query<any[]>(
      `SELECT id, tenant_id, email, first_name, last_name, full_name, title,
              seniority, department, company_id, phone, linkedin_url, city,
              region, country, timezone, email_verified, email_status, status,
              lead_score, custom_fields, enrichment_data, source, source_detail,
              last_contacted, last_replied, do_not_contact, created_at, updated_at
       FROM prospects WHERE id = ? AND tenant_id = ?`,
      [id, req.user!.tenantId]
    );

    res.status(201).json({
      success: true,
      data: created[0],
    });
  } catch (error: any) {
    console.error('Create prospect error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while creating the prospect.',
    });
  }
});

// --- PUT /:id - Update prospect ---
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const validation = updateProspectSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    // Check if prospect exists in this tenant
    const existing = await query<any[]>('SELECT id FROM prospects WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    if (existing.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Prospect not found.',
      });
      return;
    }

    const data = validation.data;

    // Build dynamic SET clause
    const setClauses: string[] = [];
    const params: any[] = [];

    const fieldMap: Record<string, string> = {
      email: 'email',
      first_name: 'first_name',
      last_name: 'last_name',
      title: 'title',
      seniority: 'seniority',
      department: 'department',
      phone: 'phone',
      linkedin_url: 'linkedin_url',
      city: 'city',
      region: 'region',
      country: 'country',
      timezone: 'timezone',
      company_id: 'company_id',
      status: 'status',
      source: 'source',
      source_detail: 'source_detail',
      notes: 'notes',
      do_not_contact: 'do_not_contact',
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      if ((data as any)[key] !== undefined) {
        setClauses.push(`${column} = ?`);
        params.push((data as any)[key]);
      }
    }

    if (data.custom_fields !== undefined) {
      setClauses.push('custom_fields = ?');
      params.push(JSON.stringify(data.custom_fields));
    }

    if ((data as any).enrichment_data !== undefined) {
      setClauses.push('enrichment_data = ?');
      params.push(JSON.stringify((data as any).enrichment_data));
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
      `UPDATE prospects SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`,
      params
    );

    // Log activity
    await query(
      `INSERT INTO prospect_activities (id, tenant_id, prospect_id, activity_type, title, description, performed_by)
       VALUES (?, ?, ?, 'updated', 'Prospect updated', ?, ?)`,
      [uuidv4(), req.user!.tenantId, id, `Updated fields: ${Object.keys(data).join(', ')}`, req.user!.id]
    );

    const updated = await query<any[]>(
      `SELECT id, tenant_id, email, first_name, last_name, full_name, title,
              seniority, department, company_id, phone, linkedin_url, city,
              region, country, timezone, email_verified, email_status, status,
              lead_score, custom_fields, enrichment_data, source, source_detail,
              last_contacted, last_replied, do_not_contact, created_at, updated_at
       FROM prospects WHERE id = ? AND tenant_id = ?`,
      [id, req.user!.tenantId]
    );

    res.json({
      success: true,
      data: updated[0],
    });
  } catch (error: any) {
    console.error('Update prospect error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while updating the prospect.',
    });
  }
});

// --- DELETE /:id - Delete prospect ---
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const existing = await query<any[]>('SELECT id FROM prospects WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    if (existing.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Prospect not found.',
      });
      return;
    }

    await query('DELETE FROM prospects WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);

    res.json({
      success: true,
      data: { message: 'Prospect deleted successfully.' },
    });
  } catch (error: any) {
    console.error('Delete prospect error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while deleting the prospect.',
    });
  }
});

// --- POST /bulk-delete - Delete multiple prospects ---
router.post('/bulk-delete', async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = bulkDeleteSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const { ids } = validation.data;
    const placeholders = ids.map(() => '?').join(', ');

    const result = await query<any>(
      `DELETE FROM prospects WHERE id IN (${placeholders}) AND tenant_id = ?`,
      [...ids, req.user!.tenantId]
    );

    res.json({
      success: true,
      data: {
        message: `${result.affectedRows || ids.length} prospect(s) deleted successfully.`,
        deletedCount: result.affectedRows || ids.length,
      },
    });
  } catch (error: any) {
    console.error('Bulk delete prospects error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while deleting prospects.',
    });
  }
});

// --- PUT /bulk-update - Bulk update multiple prospects ---
router.put('/bulk-update', async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = bulkUpdateSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const { prospect_ids, updates } = validation.data;

    // Build dynamic SET clause from provided fields
    const setClauses: string[] = [];
    const params: any[] = [];

    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      params.push(updates.status);
    }

    if (updates.company_id !== undefined) {
      setClauses.push('company_id = ?');
      params.push(updates.company_id);
    }

    if (updates.source !== undefined) {
      setClauses.push('source = ?');
      params.push(updates.source);
    }

    if (setClauses.length === 0) {
      res.status(400).json({
        success: false,
        error: 'No fields to update.',
      });
      return;
    }

    const placeholders = prospect_ids.map(() => '?').join(', ');
    params.push(...prospect_ids, req.user!.tenantId);

    const result = await query<any>(
      `UPDATE prospects SET ${setClauses.join(', ')} WHERE id IN (${placeholders}) AND tenant_id = ?`,
      params
    );

    res.json({
      success: true,
      data: {
        message: `${result.affectedRows || 0} prospect(s) updated successfully.`,
        updatedCount: result.affectedRows || 0,
      },
    });
  } catch (error: any) {
    console.error('Bulk update prospects error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while updating prospects.',
    });
  }
});

// --- POST /:id/enrich - Trigger enrichment for a prospect ---
router.post('/:id/enrich', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const existing = await query<any[]>('SELECT id, email, first_name FROM prospects WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    if (existing.length === 0) {
      res.status(404).json({ success: false, error: 'Prospect not found.' });
      return;
    }

    // Import enrichment service dynamically to avoid circular deps
    const { enrichProspect } = await import('../services/enrichment');
    const result = await enrichProspect(id as string);

    if (!result.success) {
      res.status(500).json({
        success: false,
        error: result.error || 'Enrichment failed.',
      });
      return;
    }

    // Fetch updated prospect
    const updated = await query<any[]>(
      `SELECT p.id, p.tenant_id, p.email, p.first_name, p.last_name, p.full_name,
              p.title, p.seniority, p.department, p.company_id, p.phone,
              p.linkedin_url, p.city, p.region, p.country, p.timezone,
              p.email_verified, p.email_status, p.status, p.lead_score,
              p.custom_fields, p.enrichment_data, p.source, p.source_detail,
              p.last_contacted, p.last_replied, p.do_not_contact,
              p.created_at, p.updated_at,
              c.name as company_name, c.domain as company_domain
       FROM prospects p
       LEFT JOIN companies c ON p.company_id = c.id
       WHERE p.id = ? AND p.tenant_id = ?`,
      [id, req.user!.tenantId]
    );

    res.json({
      success: true,
      data: updated[0],
    });
  } catch (error: any) {
    console.error('Enrich prospect error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while enriching the prospect.',
    });
  }
});

// --- POST /:id/recalculate-score - Recalculate lead score for a prospect ---
router.post('/:id/recalculate-score', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const existing = await query<any[]>('SELECT id FROM prospects WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    if (existing.length === 0) {
      res.status(404).json({ success: false, error: 'Prospect not found.' });
      return;
    }

    const { calculateScore } = await import('../services/scoring');
    const result = await calculateScore(id as string);

    res.json({
      success: true,
      data: {
        score: result.score,
        breakdown: result.breakdown,
      },
    });
  } catch (error: any) {
    console.error('Recalculate score error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while recalculating the score.',
    });
  }
});

// --- POST /bulk-add-campaign - Add multiple prospects to a campaign ---
router.post('/bulk-add-campaign', async (req: Request, res: Response): Promise<void> => {
  try {
    const schema = z.object({
      ids: z.array(z.string().uuid()).min(1, 'At least one prospect ID is required'),
      campaign_id: z.string().uuid('Valid campaign ID is required'),
      force: z.boolean().optional(),
    });

    const validation = schema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const { ids, campaign_id, force } = validation.data;

    // Verify campaign exists in this tenant
    const campaign = await query<any[]>('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?', [campaign_id, req.user!.tenantId]);
    if (campaign.length === 0) {
      res.status(404).json({ success: false, error: 'Campaign not found.' });
      return;
    }

    // Only this tenant's prospects can be enrolled
    const ph = ids.map(() => '?').join(',');
    const ownRows = await query<any[]>(
      `SELECT id FROM prospects WHERE id IN (${ph}) AND tenant_id = ?`,
      [...ids, req.user!.tenantId]
    );
    const ownIds = new Set(ownRows.map((r) => r.id));
    const invalidCount = ids.length - ownIds.size;

    // Cross-campaign contact guard (layer A)
    const guard = await checkCrossCampaignContact(req.user!.tenantId, campaign_id, [...ownIds], {
      checkEnrollment: true, checkDomain: true,
    });
    const blockedSet = force ? new Set<string>() : new Set(guard.blockedIds);

    let addedCount = 0;
    let skippedCount = 0;

    for (const prospectId of ids) {
      if (!ownIds.has(prospectId) || blockedSet.has(prospectId)) continue;
      try {
        const cpId = uuidv4();
        await query(
          `INSERT INTO campaign_prospects (id, campaign_id, prospect_id, status)
           VALUES (?, ?, ?, 'active')`,
          [cpId, campaign_id, prospectId]
        );
        addedCount++;
      } catch (err: any) {
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
    console.error('Bulk add to campaign error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while adding prospects to the campaign.',
    });
  }
});

export default router;
