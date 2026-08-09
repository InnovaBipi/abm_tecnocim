import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { query } from '../../config/database';
import { McpAuth, textResult } from '../context';

/**
 * Thin wrapper around McpServer.registerTool. The SDK's generic over-instantiates on some
 * zod input schemas (TS2589 "excessively deep"); this keeps runtime behaviour intact (zod still
 * validates the args) while sidestepping the pathological type inference. Reused by all tool files.
 */
export function reg(
  server: McpServer,
  name: string,
  config: { title?: string; description?: string; inputSchema?: Record<string, unknown> },
  cb: (args: any, extra: any) => any
): void {
  (server.registerTool as any)(name, config, cb);
}

/**
 * Phase A read-only tools. Every query is scoped to auth.tenantId (multi-tenant isolation).
 * Grouped here for the scaffold; split into per-domain files in Phase C.
 */
export function registerReadOnlyTools(server: McpServer, auth: McpAuth): void {
  const t = auth.tenantId;

  // --- dashboard_stats ---
  reg(server,
    'dashboard_stats',
    {
      title: 'Dashboard stats',
      description:
        'Key CamiaCasa/ABM metrics for the current tenant: total prospects, companies, active campaigns, emails sent, replies and bounces.',
      inputSchema: {},
    },
    async () => {
      const [prospects] = await query<any[]>('SELECT COUNT(*) AS c FROM prospects WHERE tenant_id = ?', [t]);
      const [companies] = await query<any[]>('SELECT COUNT(*) AS c FROM companies WHERE tenant_id = ?', [t]);
      const [campaigns] = await query<any[]>(
        "SELECT COUNT(*) AS c FROM campaigns WHERE tenant_id = ? AND status = 'active'",
        [t]
      );
      const [sent] = await query<any[]>(
        "SELECT COUNT(*) AS c FROM generated_emails WHERE tenant_id = ? AND status = 'sent'",
        [t]
      );
      const [scheduled] = await query<any[]>(
        "SELECT COUNT(*) AS c FROM generated_emails WHERE tenant_id = ? AND status = 'scheduled'",
        [t]
      );
      const [replied] = await query<any[]>(
        "SELECT COUNT(*) AS c FROM email_events WHERE tenant_id = ? AND event_type = 'replied'",
        [t]
      );
      const [bounced] = await query<any[]>(
        "SELECT COUNT(*) AS c FROM generated_emails WHERE tenant_id = ? AND status = 'bounced'",
        [t]
      );
      return textResult({
        prospects: prospects.c,
        companies: companies.c,
        active_campaigns: campaigns.c,
        emails_sent: sent.c,
        emails_scheduled: scheduled.c,
        replies: replied.c,
        bounced: bounced.c,
      });
    }
  );

  // --- prospects_list ---
  reg(server,
    'prospects_list',
    {
      title: 'List prospects',
      description:
        'List prospects for the current tenant with optional status filter and text search over name/email/company. Paginated.',
      inputSchema: {
        status: z.string().optional().describe("Filter by status, e.g. 'contacted', 'replied', 'enriched'."),
        search: z.string().optional().describe('Free-text match on name, email or company name.'),
        limit: z.string().optional().describe('Page size (default 20, max 100).'),
        page: z.string().optional().describe('1-based page number.'),
      },
    },
    async (args: any) => {
      const { status, search, limit, page } = args as { status?: string; search?: string; limit?: string; page?: string };
      const lim = Math.min(100, Math.max(1, parseInt(limit || '', 10) || 20));
      const pg = Math.max(1, parseInt(page || '', 10) || 1);
      const off = (pg - 1) * lim;
      let where = 'p.tenant_id = ?';
      const params: any[] = [t];
      if (status) {
        where += ' AND p.status = ?';
        params.push(status);
      }
      if (search) {
        where += ' AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.email LIKE ? OR c.name LIKE ?)';
        const like = `%${search}%`;
        params.push(like, like, like, like);
      }
      const rows = await query<any[]>(
        `SELECT p.id, p.email, p.first_name, p.last_name, p.title, p.status, p.do_not_contact,
                c.name AS company_name
         FROM prospects p
         LEFT JOIN companies c ON p.company_id = c.id AND c.tenant_id = p.tenant_id
         WHERE ${where}
         ORDER BY p.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, lim, off]
      );
      const [count] = await query<any[]>(
        `SELECT COUNT(*) AS total FROM prospects p
         LEFT JOIN companies c ON p.company_id = c.id AND c.tenant_id = p.tenant_id
         WHERE ${where}`,
        params
      );
      return textResult({ total: count.total, page: pg, limit: lim, prospects: rows });
    }
  );

  // --- replies_list ---
  reg(server,
    'replies_list',
    {
      title: 'List replies',
      description:
        'List detected replies (email_events of type replied) for the current tenant, with prospect context, classification and snippet. Filter by date and classification.',
      inputSchema: {
        since: z.string().optional().describe('Only replies on/after this date (YYYY-MM-DD).'),
        classification: z
          .string()
          .optional()
          .describe('Filter by AI classification: positive | negative | unsubscribe | out_of_office | other.'),
        limit: z.string().optional().describe('Max rows (default 30, max 100).'),
      },
    },
    async ({ since, classification, limit }: { since?: string; classification?: string; limit?: string }) => {
      if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
        return textResult({ error: 'since must be YYYY-MM-DD' });
      }
      const lim = Math.min(100, Math.max(1, parseInt(limit || '', 10) || 30));
      let where = "ee.tenant_id = ? AND ee.event_type = 'replied'";
      const params: any[] = [t];
      if (since) {
        where += ' AND ee.occurred_at >= ?';
        params.push(since);
      }
      if (classification) {
        where += " AND JSON_UNQUOTE(JSON_EXTRACT(ee.metadata, '$.reply_classification')) = ?";
        params.push(classification);
      }
      const rows = await query<any[]>(
        `SELECT ee.id, ee.prospect_id, ee.subject, ee.metadata, ee.occurred_at,
                p.email AS prospect_email, p.full_name, p.first_name, p.last_name, p.status AS prospect_status,
                c.name AS company_name
         FROM email_events ee
         JOIN prospects p ON ee.prospect_id = p.id AND p.tenant_id = ee.tenant_id
         LEFT JOIN companies c ON p.company_id = c.id AND c.tenant_id = ee.tenant_id
         WHERE ${where}
         ORDER BY ee.occurred_at DESC
         LIMIT ?`,
        [...params, lim]
      );
      const data = rows.map((r) => {
        let meta: any = {};
        try {
          meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata || {};
        } catch {
          meta = {};
        }
        return {
          id: r.id,
          prospect_email: r.prospect_email,
          prospect_name: r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || null,
          company_name: r.company_name,
          prospect_status: r.prospect_status,
          subject: r.subject,
          occurred_at: r.occurred_at,
          classification: meta.reply_classification || null,
          snippet: meta.reply_snippet || null,
          from: meta.from || null,
        };
      });
      return textResult({ count: data.length, replies: data });
    }
  );
}
