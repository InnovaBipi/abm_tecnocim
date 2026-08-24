import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// --- Validation Schemas ---

const createCompanySchema = z.object({
  name: z.string().min(1, 'Company name is required'),
  domain: z.string().optional(),
  industry: z.string().optional(),
  employee_count: z.string().optional(),
  annual_revenue: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  website_url: z.string().optional(),
  linkedin_url: z.string().optional(),
  description: z.string().optional(),
  tier: z.enum(['A', 'B', 'C', 'D']).optional(),
  is_target: z.boolean().optional(),
});

const updateCompanySchema = createCompanySchema.partial();

// --- GET / - List companies with pagination, search, filters ---
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const offset = (page - 1) * limit;

    const search = req.query.search as string;
    const tier = req.query.tier as string;
    const industry = req.query.industry as string;
    const isTarget = req.query.is_target as string;
    const sortBy = (req.query.sort_by as string) || 'created_at';
    const sortOrder = (req.query.sort_order as string)?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const allowedSortColumns = ['created_at', 'updated_at', 'name', 'account_score', 'tier'];
    const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'created_at';

    let whereClauses: string[] = ['c.tenant_id = ?'];
    let params: any[] = [req.user!.tenantId];

    if (search && search.trim()) {
      whereClauses.push('(c.name LIKE ? OR c.domain LIKE ? OR c.industry LIKE ?)');
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    if (tier) {
      whereClauses.push('c.tier = ?');
      params.push(tier);
    }

    if (industry) {
      whereClauses.push('c.industry LIKE ?');
      params.push(`%${industry}%`);
    }

    if (isTarget === 'true' || isTarget === 'false') {
      whereClauses.push('c.is_target = ?');
      params.push(isTarget === 'true');
    }

    const whereSQL = 'WHERE ' + whereClauses.join(' AND ');

    // Count
    const countResult = await query<any[]>(
      `SELECT COUNT(*) as total FROM companies c ${whereSQL}`,
      params
    );
    const total = countResult[0].total;

    // Fetch companies with prospect count
    const companies = await query<any[]>(
      `SELECT c.*,
              (SELECT COUNT(*) FROM prospects p WHERE p.company_id = c.id) as prospect_count
       FROM companies c
       ${whereSQL}
       ORDER BY c.${safeSortBy} ${sortOrder}, c.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: {
        companies,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    console.error('List companies error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while fetching companies.',
    });
  }
});

// --- GET /:id - Single company with associated prospects ---
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const companies = await query<any[]>(
      'SELECT * FROM companies WHERE id = ? AND tenant_id = ?',
      [id, req.user!.tenantId]
    );

    if (companies.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Company not found.',
      });
      return;
    }

    // Fetch associated prospects
    const prospects = await query<any[]>(
      `SELECT id, email, first_name, last_name, full_name, title, seniority,
              status, lead_score, last_contacted
       FROM prospects
       WHERE company_id = ? AND tenant_id = ?
       ORDER BY lead_score DESC`,
      [id, req.user!.tenantId]
    );

    // Fetch tags
    const tags = await query<any[]>(
      `SELECT t.id, t.name, t.color
       FROM tags t
       JOIN company_tags ct ON t.id = ct.tag_id
       WHERE ct.company_id = ? AND t.tenant_id = ?`,
      [id, req.user!.tenantId]
    );

    res.json({
      success: true,
      data: {
        ...companies[0],
        prospects,
        tags,
      },
    });
  } catch (error: any) {
    console.error('Get company error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while fetching the company.',
    });
  }
});

// --- POST / - Create company ---
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = createCompanySchema.safeParse(req.body);
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

    // Check for duplicate domain if provided
    if (data.domain) {
      const existing = await query<any[]>(
        'SELECT id FROM companies WHERE domain = ? AND tenant_id = ?',
        [data.domain, req.user!.tenantId]
      );

      if (existing.length > 0) {
        res.status(409).json({
          success: false,
          error: 'A company with this domain already exists.',
        });
        return;
      }
    }

    await query(
      `INSERT INTO companies (id, tenant_id, name, domain, industry, employee_count, annual_revenue,
       city, region, country, website_url, linkedin_url, description, tier, is_target)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.user!.tenantId,
        data.name,
        data.domain || null,
        data.industry || null,
        data.employee_count || null,
        data.annual_revenue || null,
        data.city || null,
        data.region || null,
        data.country || null,
        data.website_url || null,
        data.linkedin_url || null,
        data.description || null,
        data.tier || 'C',
        data.is_target || false,
      ]
    );

    const created = await query<any[]>('SELECT * FROM companies WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);

    res.status(201).json({
      success: true,
      data: created[0],
    });
  } catch (error: any) {
    console.error('Create company error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while creating the company.',
    });
  }
});

// --- PUT /:id - Update company ---
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const validation = updateCompanySchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const existing = await query<any[]>('SELECT id FROM companies WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    if (existing.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Company not found.',
      });
      return;
    }

    const data = validation.data;
    const setClauses: string[] = [];
    const params: any[] = [];

    const fieldMap: Record<string, string> = {
      name: 'name',
      domain: 'domain',
      industry: 'industry',
      employee_count: 'employee_count',
      annual_revenue: 'annual_revenue',
      city: 'city',
      region: 'region',
      country: 'country',
      website_url: 'website_url',
      linkedin_url: 'linkedin_url',
      description: 'description',
      tier: 'tier',
      is_target: 'is_target',
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      if ((data as any)[key] !== undefined) {
        setClauses.push(`${column} = ?`);
        params.push((data as any)[key]);
      }
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
      `UPDATE companies SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`,
      params
    );

    const updated = await query<any[]>('SELECT * FROM companies WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);

    res.json({
      success: true,
      data: updated[0],
    });
  } catch (error: any) {
    console.error('Update company error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while updating the company.',
    });
  }
});

// --- DELETE /:id - Delete company ---
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const existing = await query<any[]>('SELECT id FROM companies WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    if (existing.length === 0) {
      res.status(404).json({
        success: false,
        error: 'Company not found.',
      });
      return;
    }

    await query('DELETE FROM companies WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);

    res.json({
      success: true,
      data: { message: 'Company deleted successfully.' },
    });
  } catch (error: any) {
    console.error('Delete company error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred while deleting the company.',
    });
  }
});

export default router;
