import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { query, getConnection } from '../../config/database';
import {
  distributeEmailsAcrossBusinessDays,
  resolveProspectTimezone,
  isBusinessDay,
  getNextBusinessDay,
} from '../../services/scheduling';
import { getTenantConfig, buildTenantAIContext, clearTenantCache } from '../../middleware/tenant';
import { sanitizeEmailHtml } from '../../utils/sanitizeHtml';
import { McpAuth, textResult } from '../context';
import { reg } from './readonly';

// Defensive caps (cost / DoS), mirroring the REST route limits.
const MAX_GENERATE_PROSPECTS = 25;
const MAX_NUM_STEPS = 7;
const MAX_IDS = 500;

const toMysqlDate = (d: Date): string => d.toISOString().replace('T', ' ').substring(0, 19);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Phase C tools: reads that complete the picture (campaigns/companies/outbox) plus the write
 * actions that let a client OPERATE the platform in natural language. Every query is scoped to
 * auth.tenantId — the tenant is taken from the OAuth token, never from tool input.
 */
export function registerWriteTools(server: McpServer, auth: McpAuth): void {
  const t = auth.tenantId;

  // ─────────────────────────────── READS ───────────────────────────────

  // --- campaigns_list ---
  reg(server, 'campaigns_list', {
    title: 'List campaigns',
    description: 'List campaigns for the current tenant with prospect and sent-email counts. Optional status/type/search filters.',
    inputSchema: {
      status: z.string().optional().describe('draft | active | paused | completed | archived'),
      campaign_type: z.string().optional().describe('outbound | nurture | reactivation'),
      search: z.string().optional().describe('Match on name/description.'),
      limit: z.string().optional().describe('Page size (default 25, max 100).'),
      page: z.string().optional(),
    },
  }, async (args: any) => {
    const { status, campaign_type, search, limit, page } = args || {};
    const lim = Math.min(100, Math.max(1, parseInt(limit || '', 10) || 25));
    const pg = Math.max(1, parseInt(page || '', 10) || 1);
    let where = 'cam.tenant_id = ?';
    const params: any[] = [t];
    if (status) { where += ' AND cam.status = ?'; params.push(status); }
    if (campaign_type) { where += ' AND cam.campaign_type = ?'; params.push(campaign_type); }
    if (search) { where += ' AND (cam.name LIKE ? OR cam.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    const rows = await query<any[]>(
      `SELECT cam.id, cam.name, cam.status, cam.campaign_type, cam.asset_type, cam.asset_location,
              cam.start_date, cam.created_at,
              (SELECT COUNT(*) FROM campaign_prospects cp WHERE cp.campaign_id = cam.id AND cp.status = 'active') AS prospects,
              (SELECT COUNT(*) FROM generated_emails ge WHERE ge.campaign_id = cam.id AND ge.tenant_id = cam.tenant_id AND ge.status = 'sent') AS emails_sent,
              (SELECT COUNT(*) FROM generated_emails ge WHERE ge.campaign_id = cam.id AND ge.tenant_id = cam.tenant_id AND ge.status = 'scheduled') AS emails_scheduled,
              (SELECT COUNT(*) FROM generated_emails ge WHERE ge.campaign_id = cam.id AND ge.tenant_id = cam.tenant_id AND ge.status = 'draft') AS emails_draft
       FROM campaigns cam WHERE ${where} ORDER BY cam.created_at DESC LIMIT ? OFFSET ?`,
      [...params, lim, (pg - 1) * lim]
    );
    const [count] = await query<any[]>(`SELECT COUNT(*) AS total FROM campaigns cam WHERE ${where}`, params);
    return textResult({ total: count.total, page: pg, limit: lim, campaigns: rows });
  });

  // --- campaign_get ---
  reg(server, 'campaign_get', {
    title: 'Get campaign',
    description: 'Full detail for one campaign: config, prospect count, and email pipeline counts by status.',
    inputSchema: { campaign_id: z.string().describe('Campaign UUID.') },
  }, async ({ campaign_id }: any) => {
    const rows = await query<any[]>(
      `SELECT id, name, description, campaign_type, status, asset_type, asset_location, asset_price,
              asset_details, start_date, end_date, created_at, updated_at
       FROM campaigns WHERE id = ? AND tenant_id = ?`, [campaign_id, t]);
    if (!rows.length) return textResult({ error: 'Campaign not found.' });
    const [pc] = await query<any[]>(
      "SELECT COUNT(*) AS c FROM campaign_prospects WHERE campaign_id = ? AND status = 'active'", [campaign_id]);
    const stats = await query<any[]>(
      'SELECT status, COUNT(*) AS c FROM generated_emails WHERE campaign_id = ? AND tenant_id = ? GROUP BY status',
      [campaign_id, t]);
    return textResult({
      ...rows[0],
      prospects: pc.c,
      emails_by_status: stats.reduce((a: any, r: any) => { a[r.status] = r.c; return a; }, {}),
    });
  });

  // --- campaign_metrics ---
  reg(server, 'campaign_metrics', {
    title: 'Campaign metrics',
    description: 'Engagement metrics for a campaign: sent/delivered/opened/clicked/replied/bounced with rates.',
    inputSchema: { campaign_id: z.string().describe('Campaign UUID.') },
  }, async ({ campaign_id }: any) => {
    const [own] = await query<any[]>('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?', [campaign_id, t]);
    if (!own) return textResult({ error: 'Campaign not found.' });
    const [p] = await query<any[]>(
      `SELECT SUM(CASE WHEN status IN ('sent','opened','replied') THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounced
       FROM generated_emails WHERE campaign_id = ? AND tenant_id = ?`, [campaign_id, t]);
    const [eng] = await query<any[]>(
      `SELECT SUM(CASE WHEN ee.event_type = 'delivered' THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN ee.event_type = 'opened' THEN 1 ELSE 0 END) AS opened,
              SUM(CASE WHEN ee.event_type = 'clicked' THEN 1 ELSE 0 END) AS clicked,
              SUM(CASE WHEN ee.event_type = 'replied' THEN 1 ELSE 0 END) AS replied
       FROM email_events ee JOIN campaign_prospects cp ON ee.prospect_id = cp.prospect_id
       WHERE cp.campaign_id = ? AND ee.tenant_id = ?`, [campaign_id, t]);
    const sent = p?.sent || 0;
    const rate = (n: number) => (sent > 0 ? Math.round((n / sent) * 10000) / 100 : 0);
    return textResult({
      totals: { sent, delivered: eng?.delivered || 0, opened: eng?.opened || 0, clicked: eng?.clicked || 0, replied: eng?.replied || 0, bounced: p?.bounced || 0 },
      rates: { open_rate: rate(eng?.opened || 0), click_rate: rate(eng?.clicked || 0), reply_rate: rate(eng?.replied || 0), bounce_rate: rate(p?.bounced || 0) },
    });
  });

  // --- companies_list ---
  reg(server, 'companies_list', {
    title: 'List companies',
    description: 'List companies for the current tenant with prospect counts. Optional search/tier/industry.',
    inputSchema: {
      search: z.string().optional().describe('Match on name/domain/industry.'),
      tier: z.string().optional().describe('A | B | C | D'),
      industry: z.string().optional(),
      limit: z.string().optional().describe('Page size (default 25, max 100).'),
      page: z.string().optional(),
    },
  }, async (args: any) => {
    const { search, tier, industry, limit, page } = args || {};
    const lim = Math.min(100, Math.max(1, parseInt(limit || '', 10) || 25));
    const pg = Math.max(1, parseInt(page || '', 10) || 1);
    let where = 'c.tenant_id = ?';
    const params: any[] = [t];
    if (search) { where += ' AND (c.name LIKE ? OR c.domain LIKE ? OR c.industry LIKE ?)'; const l = `%${search}%`; params.push(l, l, l); }
    if (tier) { where += ' AND c.tier = ?'; params.push(tier); }
    if (industry) { where += ' AND c.industry LIKE ?'; params.push(`%${industry}%`); }
    const rows = await query<any[]>(
      `SELECT c.id, c.name, c.domain, c.industry, c.city, c.country, c.tier, c.is_target,
              (SELECT COUNT(*) FROM prospects p WHERE p.company_id = c.id AND p.tenant_id = c.tenant_id) AS prospects
       FROM companies c WHERE ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`,
      [...params, lim, (pg - 1) * lim]);
    const [count] = await query<any[]>(`SELECT COUNT(*) AS total FROM companies c WHERE ${where}`, params);
    return textResult({ total: count.total, page: pg, limit: lim, companies: rows });
  });

  // --- generated_emails_list ---
  reg(server, 'generated_emails_list', {
    title: 'List generated emails',
    description: 'List generated/outbox emails for the tenant. Filter by status and/or campaign. Bodies omitted unless include_body=true.',
    inputSchema: {
      status: z.string().optional().describe('draft | scheduled | sent | rejected | bounced | opened | replied'),
      campaign_id: z.string().optional(),
      include_body: z.boolean().optional().describe('Include body_html (default false, saves tokens).'),
      limit: z.string().optional().describe('Page size (default 50, max 100).'),
      page: z.string().optional(),
    },
  }, async (args: any) => {
    const { status, campaign_id, include_body, limit, page } = args || {};
    const lim = Math.min(100, Math.max(1, parseInt(limit || '', 10) || 50));
    const pg = Math.max(1, parseInt(page || '', 10) || 1);
    let where = 'ge.tenant_id = ?';
    const params: any[] = [t];
    if (status) { where += ' AND ge.status = ?'; params.push(status); }
    if (campaign_id) { where += ' AND ge.campaign_id = ?'; params.push(campaign_id); }
    const bodyCol = include_body ? 'ge.body_html,' : '';
    const rows = await query<any[]>(
      `SELECT ge.id, ge.campaign_id, ge.prospect_id, ge.step_number, ge.subject, ${bodyCol}
              ge.status, ge.scheduled_for, ge.sent_at,
              p.email AS prospect_email, p.full_name, cam.name AS campaign_name
       FROM generated_emails ge
       JOIN prospects p ON ge.prospect_id = p.id AND p.tenant_id = ge.tenant_id
       JOIN campaigns cam ON ge.campaign_id = cam.id AND cam.tenant_id = ge.tenant_id
       WHERE ${where} ORDER BY ge.created_at DESC LIMIT ? OFFSET ?`,
      [...params, lim, (pg - 1) * lim]);
    const [count] = await query<any[]>(`SELECT COUNT(*) AS total FROM generated_emails ge WHERE ${where}`, params);
    return textResult({ total: count.total, page: pg, limit: lim, emails: rows });
  });

  // ─────────────────────────────── WRITES ───────────────────────────────

  // --- company_create ---
  reg(server, 'company_create', {
    title: 'Create company',
    description: 'Create a company (account) for the current tenant. Deduplicates by domain. Returns the created id.',
    inputSchema: {
      name: z.string().describe('Company name (required).'),
      domain: z.string().optional(),
      industry: z.string().optional(),
      city: z.string().optional(),
      region: z.string().optional(),
      country: z.string().optional(),
      website_url: z.string().optional(),
      linkedin_url: z.string().optional(),
      description: z.string().optional(),
      tier: z.string().optional().describe('A | B | C | D (default C).'),
    },
  }, async (a: any) => {
    if (!a?.name) return textResult({ error: 'name is required.' });
    if (a.domain) {
      const dup = await query<any[]>('SELECT id FROM companies WHERE domain = ? AND tenant_id = ?', [a.domain, t]);
      if (dup.length) return textResult({ id: dup[0].id, deduped: true, message: 'Company with this domain already exists.' });
    }
    const id = uuidv4();
    await query(
      `INSERT INTO companies (id, tenant_id, name, domain, industry, city, region, country, website_url, linkedin_url, description, tier, is_target)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [id, t, a.name, a.domain || null, a.industry || null, a.city || null, a.region || null, a.country || null,
       a.website_url || null, a.linkedin_url || null, a.description || null, a.tier || 'C']);
    return textResult({ id, created: true });
  });

  // --- prospect_create ---
  reg(server, 'prospect_create', {
    title: 'Create prospect',
    description: 'Create a prospect (contact) for the current tenant. Deduplicates by email. Link to a company via company_id.',
    inputSchema: {
      email: z.string().describe('Email (required, unique per tenant).'),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      title: z.string().optional(),
      company_id: z.string().optional().describe('Company UUID to link (create the company first).'),
      city: z.string().optional(),
      region: z.string().optional(),
      country: z.string().optional(),
      timezone: z.string().optional(),
      source: z.string().optional().describe("Default 'manual'."),
      source_detail: z.string().optional().describe('Evidence URL for LOPDGDD compliance.'),
    },
  }, async (a: any) => {
    if (!a?.email) return textResult({ error: 'email is required.' });
    const email = String(a.email).toLowerCase().trim();
    const dup = await query<any[]>('SELECT id FROM prospects WHERE email = ? AND tenant_id = ?', [email, t]);
    if (dup.length) return textResult({ id: dup[0].id, deduped: true, message: 'Prospect with this email already exists.' });
    if (a.company_id) {
      const c = await query<any[]>('SELECT id FROM companies WHERE id = ? AND tenant_id = ?', [a.company_id, t]);
      if (!c.length) return textResult({ error: 'company_id not found for this tenant.' });
    }
    const id = uuidv4();
    await query(
      `INSERT INTO prospects (id, tenant_id, email, first_name, last_name, title, city, region, country, timezone, company_id, status, source, source_detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
      [id, t, email, a.first_name || null, a.last_name || null, a.title || null, a.city || null, a.region || null,
       a.country || null, a.timezone || null, a.company_id || null, a.source || 'manual', a.source_detail || null]);
    return textResult({ id, created: true });
  });

  // --- prospect_enrich ---
  reg(server, 'prospect_enrich', {
    title: 'Enrich prospect',
    description: 'Run the enrichment pipeline (Perplexity/Firecrawl/Gemini) for one prospect and store the result. Tenant-scoped.',
    inputSchema: { prospect_id: z.string().describe('Prospect UUID.') },
  }, async ({ prospect_id }: any) => {
    const own = await query<any[]>('SELECT id FROM prospects WHERE id = ? AND tenant_id = ?', [prospect_id, t]);
    if (!own.length) return textResult({ error: 'Prospect not found.' });
    const { enrichProspect } = await import('../../services/enrichment');
    const result = await enrichProspect(prospect_id);
    return textResult({ success: !!result.success, error: (result as any).error || null });
  });

  // --- prospects_add_to_campaign ---
  reg(server, 'prospects_add_to_campaign', {
    title: 'Add prospects to campaign',
    description: 'Enroll one or more prospects into a campaign. Verifies both campaign and prospects belong to the tenant.',
    inputSchema: {
      campaign_id: z.string().describe('Campaign UUID.'),
      prospect_ids: z.array(z.string()).describe('Prospect UUIDs (max 500).'),
    },
  }, async ({ campaign_id, prospect_ids }: any) => {
    if (!Array.isArray(prospect_ids) || !prospect_ids.length) return textResult({ error: 'prospect_ids required.' });
    if (prospect_ids.length > MAX_IDS) return textResult({ error: `prospect_ids cannot exceed ${MAX_IDS}.` });
    const cam = await query<any[]>('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?', [campaign_id, t]);
    if (!cam.length) return textResult({ error: 'Campaign not found.' });
    let added = 0, skipped = 0, invalid = 0;
    for (const pid of prospect_ids) {
      const own = await query<any[]>('SELECT id FROM prospects WHERE id = ? AND tenant_id = ?', [pid, t]);
      if (!own.length) { invalid++; continue; }
      try {
        await query(
          'INSERT INTO campaign_prospects (id, campaign_id, prospect_id, status) VALUES (?, ?, ?, ?)',
          [uuidv4(), campaign_id, pid, 'active']);
        added++;
      } catch (e: any) {
        if (e.code === 'ER_DUP_ENTRY') skipped++; else throw e;
      }
    }
    return textResult({ added, skipped, invalid });
  });

  // --- campaign_create ---
  reg(server, 'campaign_create', {
    title: 'Create campaign',
    description: 'Create a campaign for the current tenant. Starts in draft (safe — no sending until activated).',
    inputSchema: {
      name: z.string().describe('Campaign name (required).'),
      description: z.string().optional(),
      asset_type: z.string().optional(),
      asset_location: z.string().optional(),
      asset_price: z.string().optional().describe('Numeric string, optional.'),
      campaign_type: z.string().optional().describe('outbound | nurture | reactivation (default outbound).'),
      start_date: z.string().optional().describe('YYYY-MM-DD.'),
      end_date: z.string().optional().describe('YYYY-MM-DD.'),
    },
  }, async (a: any) => {
    if (!a?.name) return textResult({ error: 'name is required.' });
    const id = uuidv4();
    const price = a.asset_price ? parseFloat(a.asset_price) : null;
    await query(
      `INSERT INTO campaigns (id, tenant_id, name, description, asset_type, asset_location, asset_price, campaign_type, status, start_date, end_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [id, t, a.name, a.description || null, a.asset_type || null, a.asset_location || null,
       price, a.campaign_type || 'outbound', a.start_date || null, a.end_date || null, auth.userId]);
    return textResult({ id, status: 'draft', created: true });
  });

  // --- campaign_set_status ---
  reg(server, 'campaign_set_status', {
    title: 'Set campaign status',
    description: "Change a campaign's status. Use 'paused' to stop sends, 'active' to resume. Tenant-scoped.",
    inputSchema: {
      campaign_id: z.string(),
      status: z.string().describe('draft | active | paused | completed | archived'),
    },
  }, async ({ campaign_id, status }: any) => {
    const allowed = ['draft', 'active', 'paused', 'completed', 'archived'];
    if (!allowed.includes(status)) return textResult({ error: `status must be one of ${allowed.join(', ')}.` });
    const own = await query<any[]>('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?', [campaign_id, t]);
    if (!own.length) return textResult({ error: 'Campaign not found.' });
    await query('UPDATE campaigns SET status = ? WHERE id = ? AND tenant_id = ?', [status, campaign_id, t]);
    return textResult({ campaign_id, status, updated: true });
  });

  // --- campaign_generate_emails ---
  reg(server, 'campaign_generate_emails', {
    title: 'Generate emails (AI)',
    description: 'Generate a personalized multi-step sequence (Gemini) for the given prospects in a campaign. Saves as DRAFT (no sending). Max 25 prospects/call.',
    inputSchema: {
      campaign_id: z.string(),
      prospect_ids: z.array(z.string()).describe('Prospect UUIDs already enrolled (max 25).'),
      num_steps: z.string().optional().describe('1..7, default 4.'),
    },
  }, async ({ campaign_id, prospect_ids, num_steps }: any) => {
    if (!Array.isArray(prospect_ids) || !prospect_ids.length) return textResult({ error: 'prospect_ids required.' });
    if (prospect_ids.length > MAX_GENERATE_PROSPECTS) return textResult({ error: `prospect_ids cannot exceed ${MAX_GENERATE_PROSPECTS} per call.` });
    const steps = Math.min(MAX_NUM_STEPS, Math.max(1, parseInt(num_steps || '', 10) || 4));
    const cams = await query<any[]>(
      `SELECT id, name, description, asset_type, asset_location, asset_price, asset_details
       FROM campaigns WHERE id = ? AND tenant_id = ?`, [campaign_id, t]);
    if (!cams.length) return textResult({ error: 'Campaign not found.' });
    const campaign = cams[0];
    const assetDetails = campaign.asset_details
      ? (typeof campaign.asset_details === 'string' ? JSON.parse(campaign.asset_details) : campaign.asset_details)
      : null;
    const existingSteps = await query<any[]>(
      `SELECT ss.step_number, ss.subject, ss.body_html, ss.delay_days
       FROM sequence_steps ss JOIN email_sequences es ON ss.sequence_id = es.id
       WHERE es.campaign_id = ? AND es.tenant_id = ? ORDER BY ss.step_number ASC`, [campaign_id, t]);
    const { generatePersonalizedSequence } = await import('../../services/ai');
    const tenant = await getTenantConfig(t);
    const aiCtx = tenant ? buildTenantAIContext(tenant) : undefined;
    const results: any[] = [];
    for (const pid of prospect_ids) {
      const ps = await query<any[]>(
        `SELECT p.id, p.email, p.first_name, p.last_name, p.title, p.city, p.region, p.country, p.linkedin_url,
                p.enrichment_data, c.name AS company_name, c.industry AS company_industry
         FROM prospects p LEFT JOIN companies c ON p.company_id = c.id AND c.tenant_id = p.tenant_id
         WHERE p.id = ? AND p.tenant_id = ?`, [pid, t]);
      if (!ps.length) { results.push({ prospect_id: pid, status: 'not_found' }); continue; }
      const prospect = ps[0];
      const enrichment = prospect.enrichment_data
        ? (typeof prospect.enrichment_data === 'string' ? JSON.parse(prospect.enrichment_data) : prospect.enrichment_data)
        : null;
      try {
        const generated = await generatePersonalizedSequence(
          { first_name: prospect.first_name, last_name: prospect.last_name, title: prospect.title,
            company_name: prospect.company_name, industry: prospect.company_industry,
            city: prospect.city, region: prospect.region, country: prospect.country, linkedin_url: prospect.linkedin_url },
          enrichment,
          { name: campaign.name, description: campaign.description, asset_type: campaign.asset_type,
            asset_location: campaign.asset_location, asset_price: campaign.asset_price ? parseFloat(campaign.asset_price) : undefined,
            asset_details: assetDetails },
          existingSteps, steps, aiCtx);
        for (const step of generated) {
          await query(
            `INSERT INTO generated_emails (id, tenant_id, campaign_id, prospect_id, step_number, subject, body_html, delay_days, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')
             ON DUPLICATE KEY UPDATE subject = VALUES(subject), body_html = VALUES(body_html),
             delay_days = VALUES(delay_days), status = 'draft', updated_at = NOW()`,
            [uuidv4(), t, campaign_id, pid, step.step_number, step.subject, sanitizeEmailHtml(step.body_html), step.delay_days]);
        }
        results.push({ prospect_id: pid, status: 'success', steps: generated.length });
      } catch (e: any) {
        results.push({ prospect_id: pid, status: 'error', error: e.message });
      }
    }
    return textResult({ generated: results.filter(r => r.status === 'success').length, errors: results.filter(r => r.status === 'error').length, results });
  });

  // --- campaign_schedule_drafts ---
  reg(server, 'campaign_schedule_drafts', {
    title: 'Schedule campaign drafts',
    description: 'Convert ALL draft emails of a campaign to scheduled, distributed across business days at the warmup limit from start_date (default today). Does NOT activate the campaign — safe for preparing a future queue.',
    inputSchema: {
      campaign_id: z.string(),
      start_date: z.string().optional().describe('YYYY-MM-DD; queue starts no earlier than this day.'),
    },
  }, async ({ campaign_id, start_date }: any) => {
    let startDate: Date | undefined;
    if (start_date) {
      if (!DATE_RE.test(start_date)) return textResult({ error: 'start_date must be YYYY-MM-DD.' });
      startDate = new Date(`${start_date}T00:00:00`);
    }
    const cam = await query<any[]>('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?', [campaign_id, t]);
    if (!cam.length) return textResult({ error: 'Campaign not found.' });
    const emails = await query<any[]>(
      `SELECT ge.id, ge.delay_days, p.timezone, p.country, p.city
       FROM generated_emails ge JOIN prospects p ON ge.prospect_id = p.id AND p.tenant_id = ge.tenant_id
       WHERE ge.campaign_id = ? AND ge.tenant_id = ? AND ge.status = 'draft'`, [campaign_id, t]);
    if (!emails.length) return textResult({ count: 0, message: 'No drafts to schedule.' });
    const forDist = emails.map(e => ({ id: e.id, prospectTimezone: resolveProspectTimezone(e), delayDays: e.delay_days || 0 }));
    const { schedule, distribution, dailyLimit } = await distributeEmailsAcrossBusinessDays(forDist, t, undefined, startDate);
    let scheduled = 0;
    for (const e of emails) {
      const when = schedule.get(e.id);
      if (!when) continue;
      await query(
        `UPDATE generated_emails SET status = 'scheduled', approved_at = NOW(), approved_by = ?, scheduled_for = ?
         WHERE id = ? AND tenant_id = ? AND status = 'draft'`, [auth.userId, toMysqlDate(when), e.id, t]);
      scheduled++;
    }
    return textResult({ count: scheduled, daily_limit: dailyLimit, distribution, start_date: start_date || 'today', note: 'Campaign NOT activated.' });
  });

  // --- outbox_redistribute ---
  reg(server, 'outbox_redistribute', {
    title: 'Redistribute scheduled emails',
    description: 'Re-spread already-scheduled emails across business days respecting the warmup limit. Scope by campaign_id or email_ids. Optional start_date to shift the queue to a future date.',
    inputSchema: {
      campaign_id: z.string().optional(),
      email_ids: z.array(z.string()).optional().describe('Specific email UUIDs (max 500).'),
      start_date: z.string().optional().describe('YYYY-MM-DD; queue starts no earlier than this day.'),
    },
  }, async ({ campaign_id, email_ids, start_date }: any) => {
    let startDate: Date | undefined;
    if (start_date) {
      if (!DATE_RE.test(start_date)) return textResult({ error: 'start_date must be YYYY-MM-DD.' });
      startDate = new Date(`${start_date}T00:00:00`);
    }
    if (email_ids && (!Array.isArray(email_ids) || email_ids.length > MAX_IDS)) return textResult({ error: `email_ids must be an array of <= ${MAX_IDS}.` });
    let where = "ge.tenant_id = ? AND p.tenant_id = ? AND ge.status = 'scheduled'";
    const params: any[] = [t, t];
    if (email_ids && email_ids.length) { where += ` AND ge.id IN (${email_ids.map(() => '?').join(',')})`; params.push(...email_ids); }
    else if (campaign_id) { where += ' AND ge.campaign_id = ?'; params.push(campaign_id); }
    const emails = await query<any[]>(
      `SELECT ge.id, ge.delay_days, ge.step_number, p.timezone, p.country, p.city, prev.status AS prev_step_status
       FROM generated_emails ge JOIN prospects p ON ge.prospect_id = p.id AND p.tenant_id = ge.tenant_id
       LEFT JOIN generated_emails prev ON prev.prospect_id = ge.prospect_id AND prev.campaign_id = ge.campaign_id
         AND prev.tenant_id = ge.tenant_id AND prev.step_number = ge.step_number - 1
       WHERE ${where}`, params);
    if (!emails.length) return textResult({ count: 0, message: 'No scheduled emails to redistribute.' });
    const forDist = emails.map((e: any) => ({
      id: e.id, prospectTimezone: resolveProspectTimezone(e),
      delayDays: (e.step_number <= 1 || e.prev_step_status === 'sent') ? 0 : (e.delay_days || 0),
    }));
    const excludeIds = emails.map((e: any) => e.id);
    const { schedule, distribution, dailyLimit } = await distributeEmailsAcrossBusinessDays(forDist, t, excludeIds, startDate);
    let updated = 0;
    for (const [id, when] of schedule) {
      await query('UPDATE generated_emails SET scheduled_for = ? WHERE id = ? AND tenant_id = ?', [toMysqlDate(when), id, t]);
      updated++;
    }
    return textResult({ count: updated, daily_limit: dailyLimit, distribution });
  });

  // --- email_update ---
  reg(server, 'email_update', {
    title: 'Update a generated email',
    description: 'Edit one generated email: subject, body_html, status, or scheduled_for. Weekend scheduled_for auto-adjusts to Monday. Tenant-scoped.',
    inputSchema: {
      email_id: z.string(),
      subject: z.string().optional(),
      body_html: z.string().optional(),
      status: z.string().optional().describe('draft | scheduled | rejected | sent'),
      scheduled_for: z.string().optional().describe('ISO datetime or YYYY-MM-DD; weekends move to Monday.'),
    },
  }, async (a: any) => {
    const own = await query<any[]>('SELECT id FROM generated_emails WHERE id = ? AND tenant_id = ?', [a.email_id, t]);
    if (!own.length) return textResult({ error: 'Email not found.' });
    const set: string[] = [];
    const params: any[] = [];
    if (a.subject !== undefined) { set.push('subject = ?'); params.push(a.subject); }
    if (a.body_html !== undefined) { set.push('body_html = ?'); params.push(sanitizeEmailHtml(a.body_html)); }
    if (a.status !== undefined) { set.push('status = ?'); params.push(a.status); }
    if (a.scheduled_for !== undefined) {
      const d = new Date(a.scheduled_for);
      if (isNaN(d.getTime())) return textResult({ error: 'Invalid scheduled_for.' });
      let fin = d;
      if (!isBusinessDay(d)) { fin = getNextBusinessDay(d); fin.setUTCHours(d.getUTCHours(), d.getUTCMinutes(), 0, 0); }
      set.push('scheduled_for = ?'); params.push(toMysqlDate(fin));
    }
    if (!set.length) return textResult({ error: 'Nothing to update.' });
    params.push(a.email_id, t);
    await query(`UPDATE generated_emails SET ${set.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
    return textResult({ email_id: a.email_id, updated: true });
  });

  // --- emails_reject ---
  reg(server, 'emails_reject', {
    title: 'Reject emails',
    description: 'Bulk-reject generated emails (draft/approved/scheduled -> rejected, unscheduled). Tenant-scoped. Max 500.',
    inputSchema: { email_ids: z.array(z.string()).describe('Email UUIDs (max 500).') },
  }, async ({ email_ids }: any) => {
    if (!Array.isArray(email_ids) || !email_ids.length) return textResult({ error: 'email_ids required.' });
    if (email_ids.length > MAX_IDS) return textResult({ error: `email_ids cannot exceed ${MAX_IDS}.` });
    const ph = email_ids.map(() => '?').join(',');
    const r = await query<any>(
      `UPDATE generated_emails SET status = 'rejected', scheduled_for = NULL
       WHERE id IN (${ph}) AND tenant_id = ? AND status IN ('draft','approved','scheduled')`, [...email_ids, t]);
    return textResult({ rejected: r.affectedRows ?? null });
  });

  // --- emails_bulk_insert ---
  reg(server, 'emails_bulk_insert', {
    title: 'Bulk insert emails',
    description:
      'Insert pre-written emails (e.g. Claude-generated sequences) into a campaign as DRAFT. Unlike the REST bulk-insert endpoint, validation is fail-fast and all-or-nothing: if ANY prospect_id is invalid or any entry is malformed, NOTHING is inserted and the offending ids/indexes are returned. Replaces existing drafts for the same prospect+step. Max 500 emails/call.',
    inputSchema: {
      campaign_id: z.string().describe('Campaign UUID.'),
      emails: z.array(z.object({
        prospect_id: z.string().describe('Prospect UUID (must exist in this tenant).'),
        step_number: z.number().optional().describe('Sequence step (default 1).'),
        subject: z.string().describe('Email subject.'),
        body_html: z.string().describe('Email body (HTML, will be sanitized).'),
        delay_days: z.number().optional().describe('Days after previous step (default 0).'),
      })).describe('Emails to insert (max 500).'),
    },
  }, async ({ campaign_id, emails }: any) => {
    if (!Array.isArray(emails) || !emails.length) return textResult({ error: 'emails array is required.' });
    if (emails.length > MAX_IDS) return textResult({ error: `emails cannot exceed ${MAX_IDS} per call.` });
    const cam = await query<any[]>('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?', [campaign_id, t]);
    if (!cam.length) return textResult({ error: 'Campaign not found.' });

    // Fail-fast validation: reject the WHOLE batch before touching the DB, returning exactly
    // what is wrong — this is the guard against the silent-skip data loss of the REST endpoint.
    const malformed: number[] = [];
    emails.forEach((e: any, i: number) => {
      if (!e?.prospect_id || !e?.subject || !e?.body_html) malformed.push(i);
    });
    if (malformed.length) {
      return textResult({ error: 'Malformed entries (missing prospect_id/subject/body_html). Nothing inserted.', malformed_indexes: malformed });
    }
    const uniqueIds: string[] = [...new Set(emails.map((e: any) => String(e.prospect_id)))] as string[];
    const ph = uniqueIds.map(() => '?').join(',');
    const found = await query<any[]>(
      `SELECT id FROM prospects WHERE id IN (${ph}) AND tenant_id = ?`, [...uniqueIds, t]);
    const foundSet = new Set(found.map((r) => r.id));
    const invalid = uniqueIds.filter((id) => !foundSet.has(id));
    if (invalid.length) {
      return textResult({ error: 'Unknown prospect_ids for this tenant. Nothing inserted.', invalid_prospect_ids: invalid });
    }
    const enrolled = await query<any[]>(
      `SELECT prospect_id FROM campaign_prospects WHERE campaign_id = ? AND prospect_id IN (${ph})`,
      [campaign_id, ...uniqueIds]);
    const enrolledSet = new Set(enrolled.map((r) => r.prospect_id));
    const notEnrolled = uniqueIds.filter((id) => !enrolledSet.has(id));

    let inserted = 0;
    const failed: string[] = [];
    for (const email of emails) {
      const conn = await getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(
          'DELETE FROM generated_emails WHERE prospect_id = ? AND campaign_id = ? AND step_number = ? AND tenant_id = ?',
          [email.prospect_id, campaign_id, email.step_number || 1, t]);
        await conn.query(
          `INSERT INTO generated_emails (id, tenant_id, campaign_id, prospect_id, step_number, subject, body_html, delay_days, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
          [uuidv4(), t, campaign_id, email.prospect_id, email.step_number || 1, email.subject,
           sanitizeEmailHtml(email.body_html), email.delay_days || 0]);
        await conn.commit();
        inserted++;
      } catch (txError: any) {
        await conn.rollback();
        failed.push(email.prospect_id);
        console.error(`[mcp emails_bulk_insert] tx failed for prospect ${email.prospect_id}:`, txError?.message);
      } finally {
        conn.release();
      }
    }
    return textResult({
      inserted,
      expected: emails.length,
      mismatch: inserted !== emails.length,
      failed_prospect_ids: failed,
      not_enrolled_prospect_ids: notEnrolled,
      note: notEnrolled.length
        ? 'Some prospects are not enrolled in this campaign — enroll them with prospects_add_to_campaign or their emails will not appear in campaign views.'
        : undefined,
    });
  });

  // --- settings_set_warmup ---
  reg(server, 'settings_set_warmup', {
    title: 'Set warmup limits',
    description: 'Update the tenant warmup schedule (daily_limit_base, daily_limit_max, ramp_up_days). Clears the tenant config cache.',
    inputSchema: {
      daily_limit_base: z.string().optional().describe('Integer 1..10000.'),
      daily_limit_max: z.string().optional().describe('Integer 1..10000.'),
      ramp_up_days: z.string().optional().describe('Integer 1..365.'),
    },
  }, async (a: any) => {
    const updates: string[] = [];
    const params: any[] = [];
    const num = (v: any, min: number, max: number) => {
      const n = parseInt(v, 10);
      return Number.isInteger(n) && n >= min && n <= max ? n : null;
    };
    if (a.daily_limit_base !== undefined) { const n = num(a.daily_limit_base, 1, 10000); if (n === null) return textResult({ error: 'daily_limit_base out of range.' }); updates.push("'$.warmup.daily_limit_base', CAST(? AS UNSIGNED)"); params.push(n); }
    if (a.daily_limit_max !== undefined) { const n = num(a.daily_limit_max, 1, 10000); if (n === null) return textResult({ error: 'daily_limit_max out of range.' }); updates.push("'$.warmup.daily_limit_max', CAST(? AS UNSIGNED)"); params.push(n); }
    if (a.ramp_up_days !== undefined) { const n = num(a.ramp_up_days, 1, 365); if (n === null) return textResult({ error: 'ramp_up_days out of range.' }); updates.push("'$.warmup.ramp_up_days', CAST(? AS UNSIGNED)"); params.push(n); }
    if (!updates.length) return textResult({ error: 'Nothing to update.' });
    params.push(t);
    await query(`UPDATE tenants SET config = JSON_SET(config, ${updates.join(', ')}) WHERE id = ?`, params);
    clearTenantCache(t);
    return textResult({ updated: true });
  });
}
