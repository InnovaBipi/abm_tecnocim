import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, hashPassword, comparePassword, requireRole } from '../middleware/auth';
import { config } from '../config/env';
import { getTenantConfig, clearTenantCache } from '../middleware/tenant';

const router = Router();

// All routes require authentication
router.use(authenticate);

// --- Profile ---

router.get('/profile', async (req: Request, res: Response): Promise<void> => {
  try {
    const users = await query<any[]>(
      'SELECT * FROM users WHERE id = ?',
      [req.user!.id]
    );

    if (users.length === 0) {
      res.status(404).json({ success: false, error: 'User not found.' });
      return;
    }

    res.json({ success: true, data: users[0] });
  } catch (error: any) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, error: 'An error occurred.' });
  }
});

const updateProfileSchema = z.object({
  name: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().email().optional(),
  sender_email: z.string().email().nullable().optional(),
  sender_name: z.string().nullable().optional(),
});

router.put('/profile', async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = updateProfileSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ success: false, error: 'Validation failed', details: validation.error.flatten().fieldErrors });
      return;
    }

    const data = validation.data;
    const setClauses: string[] = [];
    const params: any[] = [];

    // Support both "name" (split into first/last) and direct first_name/last_name
    if (data.name) {
      const parts = data.name.trim().split(/\s+/);
      setClauses.push('first_name = ?', 'last_name = ?');
      params.push(parts[0], parts.slice(1).join(' ') || null);
    }
    if (data.first_name !== undefined) {
      setClauses.push('first_name = ?');
      params.push(data.first_name);
    }
    if (data.last_name !== undefined) {
      setClauses.push('last_name = ?');
      params.push(data.last_name);
    }
    if (data.email) {
      setClauses.push('email = ?');
      params.push(data.email);
    }
    if (data.sender_email !== undefined) {
      setClauses.push('sender_email = ?');
      params.push(data.sender_email);
    }
    if (data.sender_name !== undefined) {
      setClauses.push('sender_name = ?');
      params.push(data.sender_name);
    }

    if (setClauses.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update.' });
      return;
    }

    params.push(req.user!.id, req.user!.tenantId);
    await query(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`, params);

    const updated = await query<any[]>(
      'SELECT * FROM users WHERE id = ?',
      [req.user!.id]
    );

    res.json({ success: true, data: updated[0] });
  } catch (error: any) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, error: 'An error occurred.' });
  }
});

// --- Password ---

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
});

router.put('/password', async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = changePasswordSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ success: false, error: 'Validation failed', details: validation.error.flatten().fieldErrors });
      return;
    }

    const { currentPassword, newPassword } = validation.data;

    const users = await query<any[]>('SELECT password FROM users WHERE id = ?', [req.user!.id]);
    if (users.length === 0) {
      res.status(404).json({ success: false, error: 'User not found.' });
      return;
    }

    const isValid = await comparePassword(currentPassword, users[0].password);
    if (!isValid) {
      res.status(400).json({ success: false, error: 'Current password is incorrect.' });
      return;
    }

    const hashedPassword = await hashPassword(newPassword);
    await query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user!.id]);

    res.json({ success: true, data: { message: 'Password changed successfully.' } });
  } catch (error: any) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, error: 'An error occurred.' });
  }
});

// --- Email Settings ---

router.get('/email', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenant = await getTenantConfig(req.user!.tenantId);
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant not found.' });
      return;
    }

    const emailConfig = tenant.config.email || {};
    const imapConfig = tenant.config.imap || {};

    const effectiveKey = emailConfig.resend_api_key || config.RESEND_API_KEY;

    res.json({
      success: true,
      data: {
        from_email: emailConfig.from_email || '',
        from_name: emailConfig.from_name || '',
        reply_to: emailConfig.reply_to || '',
        notification_email: emailConfig.notification_email || '',
        resend_api_key: effectiveKey ? effectiveKey.substring(0, 8) + '...' : '',
        is_configured: !!effectiveKey,
        webhook_configured: !!emailConfig.webhook_secret,
        imap_host: imapConfig.host || '',
        imap_port: imapConfig.port || 993,
        imap_user: imapConfig.user || '',
        imap_configured: !!(imapConfig.host && imapConfig.user && imapConfig.pass),
      },
    });
  } catch (error: any) {
    console.error('Get email settings error:', error);
    res.status(500).json({ success: false, error: 'An error occurred.' });
  }
});

router.put('/email', async (req: Request, res: Response): Promise<void> => {
  try {
    const { from_email, from_name, reply_to, notification_email, resend_api_key, webhook_secret, imap_host, imap_port, imap_user, imap_pass } = req.body;

    // Build the JSON_SET query to update specific fields in config
    const updates: string[] = [];
    const params: any[] = [];

    if (from_email !== undefined) { updates.push("'$.email.from_email', ?"); params.push(from_email); }
    if (from_name !== undefined) { updates.push("'$.email.from_name', ?"); params.push(from_name); }
    if (reply_to !== undefined) { updates.push("'$.email.reply_to', ?"); params.push(reply_to); }
    if (notification_email !== undefined) { updates.push("'$.email.notification_email', ?"); params.push(notification_email); }
    if (resend_api_key !== undefined) { updates.push("'$.email.resend_api_key', ?"); params.push(resend_api_key); }
    if (webhook_secret !== undefined) { updates.push("'$.email.webhook_secret', ?"); params.push(webhook_secret); }
    if (imap_host !== undefined) { updates.push("'$.imap.host', ?"); params.push(imap_host); }
    if (imap_port !== undefined) { updates.push("'$.imap.port', ?"); params.push(imap_port); }
    if (imap_user !== undefined) { updates.push("'$.imap.user', ?"); params.push(imap_user); }
    if (imap_pass !== undefined) { updates.push("'$.imap.pass', ?"); params.push(imap_pass); }

    if (updates.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update.' });
      return;
    }

    params.push(req.user!.tenantId);
    await query(
      `UPDATE tenants SET config = JSON_SET(config, ${updates.join(', ')}) WHERE id = ?`,
      params
    );

    // Clear cache so changes take effect immediately
    clearTenantCache(req.user!.tenantId);

    res.json({
      success: true,
      data: { message: 'Email settings updated successfully.' },
    });
  } catch (error: any) {
    console.error('Update email settings error:', error);
    res.status(500).json({ success: false, error: 'An error occurred.' });
  }
});

// --- POST /email/webhook-setup - Create the Resend webhook using the tenant's own stored key ---
// Server-side: the resend_api_key never leaves the server (the API masks it on read,
// so this is the only way to wire the webhook without exposing the key).
router.post('/email/webhook-setup', requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const tenant = await getTenantConfig(req.user!.tenantId);
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant not found.' });
      return;
    }

    const apiKey = tenant.config.email?.resend_api_key || config.RESEND_API_KEY;
    if (!apiKey) {
      res.status(400).json({ success: false, error: 'No Resend API key configured for this tenant.' });
      return;
    }

    const base = (config.FRONTEND_URL && config.FRONTEND_URL.startsWith('http') && !config.FRONTEND_URL.includes('localhost'))
      ? config.FRONTEND_URL.replace(/\/$/, '')
      : 'https://abm.tecnociminnova.com';
    const endpoint = (typeof req.body?.endpoint === 'string' && req.body.endpoint.startsWith('https://'))
      ? req.body.endpoint
      : `${base}/api/webhooks/resend`;
    const events = ['email.sent', 'email.delivered', 'email.opened', 'email.clicked', 'email.bounced', 'email.complained'];

    const resp = await fetch('https://api.resend.com/webhooks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, events }),
    });
    const data: any = await resp.json().catch(() => ({}));

    if (!resp.ok || !data?.signing_secret) {
      res.status(502).json({ success: false, error: `Resend webhook creation failed: ${data?.message || `HTTP ${resp.status}`}` });
      return;
    }

    await query(
      `UPDATE tenants SET config = JSON_SET(config, '$.email.webhook_secret', ?) WHERE id = ?`,
      [data.signing_secret, req.user!.tenantId]
    );
    clearTenantCache(req.user!.tenantId);

    res.json({
      success: true,
      data: { message: 'Webhook created and signing secret stored.', webhook_id: data.id, endpoint, events },
    });
  } catch (error: any) {
    console.error('Webhook setup error:', error);
    res.status(500).json({ success: false, error: 'An error occurred while setting up the webhook.' });
  }
});

// --- Legal / RGPD Settings (footer identity) ---

router.get('/legal', async (req: Request, res: Response): Promise<void> => {
  try {
    const tenant = await getTenantConfig(req.user!.tenantId);
    if (!tenant) {
      res.status(404).json({ success: false, error: 'Tenant not found.' });
      return;
    }

    const legal: any = tenant.config.legal || {};
    res.json({
      success: true,
      data: {
        legal_name: legal.legal_name || '',
        cif: legal.cif || '',
        address: legal.address || '',
        privacy_url: legal.privacy_url || '',
        data_source: legal.data_source || '',
      },
    });
  } catch (error: any) {
    console.error('Get legal settings error:', error);
    res.status(500).json({ success: false, error: 'An error occurred.' });
  }
});

router.put('/legal', async (req: Request, res: Response): Promise<void> => {
  try {
    const { legal_name, cif, address, privacy_url, data_source } = req.body;

    // Collect only provided fields (partial update). Sending null clears a field.
    const patch: Record<string, any> = {};
    if (legal_name !== undefined) patch.legal_name = legal_name;
    if (cif !== undefined) patch.cif = cif;
    if (address !== undefined) patch.address = address;
    if (privacy_url !== undefined) patch.privacy_url = privacy_url;
    if (data_source !== undefined) patch.data_source = data_source;

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update.' });
      return;
    }

    // Merge into config.legal, creating the object if it doesn't exist yet.
    await query(
      `UPDATE tenants
       SET config = JSON_SET(
         config,
         '$.legal',
         JSON_MERGE_PATCH(COALESCE(JSON_EXTRACT(config, '$.legal'), JSON_OBJECT()), CAST(? AS JSON))
       )
       WHERE id = ?`,
      [JSON.stringify(patch), req.user!.tenantId]
    );

    // Clear cache so the footer picks up the change immediately
    clearTenantCache(req.user!.tenantId);

    res.json({
      success: true,
      data: { message: 'Legal settings updated successfully.' },
    });
  } catch (error: any) {
    console.error('Update legal settings error:', error);
    res.status(500).json({ success: false, error: 'An error occurred.' });
  }
});

// --- Warmup Settings ---

router.put('/warmup', async (req: Request, res: Response): Promise<void> => {
  try {
    const { daily_limit_base, daily_limit_max, ramp_up_days } = req.body;

    const updates: string[] = [];
    const params: any[] = [];

    if (daily_limit_base !== undefined) { updates.push("'$.warmup.daily_limit_base', CAST(? AS UNSIGNED)"); params.push(daily_limit_base); }
    if (daily_limit_max !== undefined) { updates.push("'$.warmup.daily_limit_max', CAST(? AS UNSIGNED)"); params.push(daily_limit_max); }
    if (ramp_up_days !== undefined) { updates.push("'$.warmup.ramp_up_days', CAST(? AS UNSIGNED)"); params.push(ramp_up_days); }

    if (updates.length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update.' });
      return;
    }

    params.push(req.user!.tenantId);
    await query(
      `UPDATE tenants SET config = JSON_SET(config, ${updates.join(', ')}) WHERE id = ?`,
      params
    );

    clearTenantCache(req.user!.tenantId);

    res.json({
      success: true,
      data: { message: 'Warmup settings updated successfully.' },
    });
  } catch (error: any) {
    console.error('Update warmup settings error:', error);
    res.status(500).json({ success: false, error: 'An error occurred.' });
  }
});

// --- API Keys ---

router.get('/api-keys', async (_req: Request, res: Response): Promise<void> => {
  try {
    const keys = [
      {
        name: 'Resend (Email)',
        service: 'resend',
        is_active: !!config.RESEND_API_KEY,
        masked_key: config.RESEND_API_KEY ? config.RESEND_API_KEY.substring(0, 8) + '...' : null,
      },
      {
        name: 'Google Gemini (AI)',
        service: 'gemini',
        is_active: !!config.GEMINI_API_KEY,
        masked_key: config.GEMINI_API_KEY ? config.GEMINI_API_KEY.substring(0, 8) + '...' : null,
      },
      {
        name: 'Perplexity (AI)',
        service: 'perplexity',
        is_active: !!config.PERPLEXITY_API_KEY,
        masked_key: config.PERPLEXITY_API_KEY ? config.PERPLEXITY_API_KEY.substring(0, 8) + '...' : null,
      },
      {
        name: 'Firecrawl (Scraping)',
        service: 'firecrawl',
        is_active: !!config.FIRECRAWL_API_KEY,
        masked_key: config.FIRECRAWL_API_KEY ? config.FIRECRAWL_API_KEY.substring(0, 8) + '...' : null,
      },
    ];

    res.json({ success: true, data: { keys } });
  } catch (error: any) {
    console.error('Get API keys error:', error);
    res.status(500).json({ success: false, error: 'An error occurred.' });
  }
});

// --- Scoring Rules ---

router.get('/scoring-rules', async (req: Request, res: Response): Promise<void> => {
  try {
    const rules = await query<any[]>(
      'SELECT * FROM scoring_rules WHERE tenant_id = ? ORDER BY created_at DESC',
      [req.user!.tenantId]
    );

    res.json({ success: true, data: { rules } });
  } catch (error: any) {
    console.error('Get scoring rules error:', error);
    res.status(500).json({ success: false, error: 'An error occurred.' });
  }
});

const createRuleSchema = z.object({
  name: z.string().min(1, 'Rule name is required'),
  field: z.string().min(1, 'Field is required'),
  condition: z.string().min(1, 'Condition is required'),
  value: z.string().optional(),
  score: z.number(),
});

router.post('/scoring-rules', async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = createRuleSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ success: false, error: 'Validation failed', details: validation.error.flatten().fieldErrors });
      return;
    }

    const data = validation.data;
    const id = uuidv4();

    // Map frontend fields to DB columns
    const categoryMap: Record<string, string> = {
      email: 'demographic',
      title: 'demographic',
      seniority: 'demographic',
      company: 'firmographic',
      industry: 'firmographic',
      employee_count: 'firmographic',
    };
    const category = categoryMap[data.field] || 'behavioral';

    const operatorMap: Record<string, string> = {
      equals: 'equals',
      contains: 'contains',
      starts_with: 'contains',
      ends_with: 'contains',
      not_empty: 'exists',
      greater_than: 'greater_than',
      less_than: 'less_than',
    };
    const operator = operatorMap[data.condition] || 'equals';

    await query(
      `INSERT INTO scoring_rules (id, tenant_id, name, category, field_name, operator, field_value, points)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, req.user!.tenantId, data.name, category, data.field, operator, JSON.stringify(data.value || ''), data.score]
    );

    const created = await query<any[]>('SELECT * FROM scoring_rules WHERE id = ?', [id]);

    res.status(201).json({ success: true, data: created[0] });
  } catch (error: any) {
    console.error('Create scoring rule error:', error);
    res.status(500).json({ success: false, error: 'An error occurred.' });
  }
});

router.put('/scoring-rules/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const validation = createRuleSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({ success: false, error: 'Validation failed', details: validation.error.flatten().fieldErrors });
      return;
    }

    const existing = await query<any[]>('SELECT id FROM scoring_rules WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    if (existing.length === 0) {
      res.status(404).json({ success: false, error: 'Scoring rule not found.' });
      return;
    }

    const data = validation.data;

    await query(
      `UPDATE scoring_rules SET name = ?, field_name = ?, field_value = ?, points = ?
       WHERE id = ? AND tenant_id = ?`,
      [data.name, data.field, JSON.stringify(data.value || ''), data.score, id, req.user!.tenantId]
    );

    const updated = await query<any[]>('SELECT * FROM scoring_rules WHERE id = ?', [id]);

    res.json({ success: true, data: updated[0] });
  } catch (error: any) {
    console.error('Update scoring rule error:', error);
    res.status(500).json({ success: false, error: 'An error occurred.' });
  }
});

router.delete('/scoring-rules/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const existing = await query<any[]>('SELECT id FROM scoring_rules WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);
    if (existing.length === 0) {
      res.status(404).json({ success: false, error: 'Scoring rule not found.' });
      return;
    }

    await query('DELETE FROM scoring_rules WHERE id = ? AND tenant_id = ?', [id, req.user!.tenantId]);

    res.json({ success: true, data: { message: 'Scoring rule deleted successfully.' } });
  } catch (error: any) {
    console.error('Delete scoring rule error:', error);
    res.status(500).json({ success: false, error: 'An error occurred.' });
  }
});

export default router;
