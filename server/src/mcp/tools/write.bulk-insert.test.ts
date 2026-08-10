import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/database', () => ({ query: vi.fn(), getConnection: vi.fn() }));
vi.mock('../../services/scheduling', () => ({
  distributeEmailsAcrossBusinessDays: vi.fn(),
  resolveProspectTimezone: vi.fn(),
  isBusinessDay: vi.fn(),
  getNextBusinessDay: vi.fn(),
}));
vi.mock('../../middleware/tenant', () => ({
  getTenantConfig: vi.fn(),
  buildTenantAIContext: vi.fn(),
  clearTenantCache: vi.fn(),
}));
vi.mock('../../utils/sanitizeHtml', () => ({ sanitizeEmailHtml: (h: string) => h }));

import { query, getConnection } from '../../config/database';
import { registerWriteTools } from './write';
import type { McpAuth } from '../context';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockGetConnection = getConnection as unknown as ReturnType<typeof vi.fn>;

const auth: McpAuth = { userId: 'test-user', email: 'test@test.com', role: 'admin', tenantId: 'test-tenant-id' };

function getTool(name: string): (args: any) => Promise<any> {
  const tools: Record<string, any> = {};
  const server = {
    registerTool: (n: string, _config: any, cb: any) => {
      tools[n] = cb;
    },
  } as any;
  registerWriteTools(server, auth);
  return tools[name];
}

function makeConn() {
  return {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
}

const parse = (result: any) => JSON.parse(result.content[0].text);

const email = (pid: string, step = 1) => ({
  prospect_id: pid,
  step_number: step,
  subject: `Asunto ${step}`,
  body_html: `<p>Cuerpo ${step}</p>`,
  delay_days: step === 1 ? 0 : 3,
});

describe('emails_bulk_insert', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGetConnection.mockReset();
  });

  it('rejects when the campaign is not in the tenant', async () => {
    const tool = getTool('emails_bulk_insert');
    mockQuery.mockResolvedValueOnce([]); // campaign lookup
    const out = parse(await tool({ campaign_id: 'cam-x', emails: [email('p1')] }));
    expect(out.error).toContain('Campaign not found');
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('tenant_id'), ['cam-x', 'test-tenant-id']);
    expect(mockGetConnection).not.toHaveBeenCalled();
  });

  it('rejects malformed entries with their indexes, inserting nothing', async () => {
    const tool = getTool('emails_bulk_insert');
    mockQuery.mockResolvedValueOnce([{ id: 'cam-1' }]);
    const bad = { prospect_id: 'p1', subject: '', body_html: '<p>x</p>' };
    const out = parse(await tool({ campaign_id: 'cam-1', emails: [email('p1'), bad] }));
    expect(out.error).toContain('Malformed');
    expect(out.malformed_indexes).toEqual([1]);
    expect(mockGetConnection).not.toHaveBeenCalled();
  });

  it('rejects the WHOLE batch when any prospect_id is unknown (no silent skip)', async () => {
    const tool = getTool('emails_bulk_insert');
    mockQuery
      .mockResolvedValueOnce([{ id: 'cam-1' }]) // campaign
      .mockResolvedValueOnce([{ id: 'p1' }]); // prospects lookup: p2 missing
    const out = parse(await tool({ campaign_id: 'cam-1', emails: [email('p1'), email('p2')] }));
    expect(out.error).toContain('Unknown prospect_ids');
    expect(out.invalid_prospect_ids).toEqual(['p2']);
    expect(mockGetConnection).not.toHaveBeenCalled();
    // prospect lookup must be tenant-scoped
    const prospectCall = mockQuery.mock.calls[1];
    expect(prospectCall[0]).toContain('tenant_id');
    expect(prospectCall[1]).toContain('test-tenant-id');
  });

  it('inserts all emails transactionally on the happy path and reports enrollment gaps', async () => {
    const tool = getTool('emails_bulk_insert');
    mockQuery
      .mockResolvedValueOnce([{ id: 'cam-1' }]) // campaign
      .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }]) // prospects
      .mockResolvedValueOnce([{ prospect_id: 'p1' }]); // enrollment: p2 not enrolled
    const conn = makeConn();
    mockGetConnection.mockResolvedValue(conn);
    const emails = [email('p1', 1), email('p1', 2), email('p2', 1)];
    const out = parse(await tool({ campaign_id: 'cam-1', emails }));
    expect(out.inserted).toBe(3);
    expect(out.expected).toBe(3);
    expect(out.mismatch).toBe(false);
    expect(out.not_enrolled_prospect_ids).toEqual(['p2']);
    expect(out.note).toContain('prospects_add_to_campaign');
    expect(conn.commit).toHaveBeenCalledTimes(3);
    // every DELETE and INSERT inside the tx is tenant-scoped
    for (const [sql, params] of conn.query.mock.calls) {
      expect(sql).toContain('tenant_id');
      expect(params).toContain('test-tenant-id');
    }
  });

  it('rolls back the failing email only and flags the mismatch', async () => {
    const tool = getTool('emails_bulk_insert');
    mockQuery
      .mockResolvedValueOnce([{ id: 'cam-1' }])
      .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }])
      .mockResolvedValueOnce([{ prospect_id: 'p1' }, { prospect_id: 'p2' }]);
    const okConn = makeConn();
    const badConn = makeConn();
    badConn.query.mockRejectedValueOnce(new Error('deadlock'));
    mockGetConnection.mockResolvedValueOnce(badConn).mockResolvedValue(okConn);
    const out = parse(await tool({ campaign_id: 'cam-1', emails: [email('p1'), email('p2')] }));
    expect(out.inserted).toBe(1);
    expect(out.mismatch).toBe(true);
    expect(out.failed_prospect_ids).toEqual(['p1']);
    expect(badConn.rollback).toHaveBeenCalled();
    expect(badConn.release).toHaveBeenCalled();
    expect(okConn.commit).toHaveBeenCalled();
  });

  it('caps the batch at 500', async () => {
    const tool = getTool('emails_bulk_insert');
    const emails = Array.from({ length: 501 }, (_, i) => email(`p${i}`));
    const out = parse(await tool({ campaign_id: 'cam-1', emails }));
    expect(out.error).toContain('500');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
