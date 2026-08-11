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

// Guard logic has its own suite (services/contactGuard.test.ts); here it defaults to "all free"
// and individual tests override the resolved value to exercise blocked/force paths.
vi.mock('../../services/contactGuard', () => ({
  checkCrossCampaignContact: vi.fn(async (_t: string, _c: string, ids: string[]) => ({
    verdicts: new Map(ids.map((id) => [id, { blocked: false }])),
    blockedIds: [],
    domainWarnings: [],
  })),
  formatBlocked: vi.fn((r: any) =>
    r.blockedIds.map((id: string) => ({
      prospect_id: id,
      reason: 'contacted_other_campaign',
      other_campaign_id: 'cam-a',
      other_campaign_name: 'Otra campaña',
      email_status: 'sent',
    }))),
  shouldSkipEmail: vi.fn((verdict: any, metadata: any) => {
    if (!verdict?.blocked) return false;
    const meta = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    return !meta?.contact_guard_override;
  }),
}));
vi.mock('../../services/sender', () => ({
  applyCampaignSenderToAIContext: vi.fn(async (ctx: any) => ctx),
}));

import { query, getConnection } from '../../config/database';
import { checkCrossCampaignContact } from '../../services/contactGuard';
import { registerWriteTools } from './write';
import type { McpAuth } from '../context';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockGetConnection = getConnection as unknown as ReturnType<typeof vi.fn>;
const mockGuard = checkCrossCampaignContact as unknown as ReturnType<typeof vi.fn>;

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
      .mockResolvedValueOnce([{ prospect_id: 'p1' }]) // enrollment: p2 not enrolled
      .mockResolvedValueOnce([]); // no protected rows
    const conn = makeConn();
    mockGetConnection.mockResolvedValue(conn);
    const emails = [email('p1', 1), email('p1', 2), email('p2', 1)];
    const out = parse(await tool({ campaign_id: 'cam-1', emails }));
    expect(out.inserted).toBe(3);
    expect(out.expected).toBe(3);
    expect(out.mismatch).toBe(false);
    expect(out.skipped_protected).toEqual([]);
    expect(out.not_enrolled_prospect_ids).toEqual(['p2']);
    expect(out.note).toContain('prospects_add_to_campaign');
    expect(conn.commit).toHaveBeenCalledTimes(3);
    // every DELETE and INSERT inside the tx is tenant-scoped, and the DELETE only touches draft/rejected
    for (const [sql, params] of conn.query.mock.calls) {
      expect(sql).toContain('tenant_id');
      expect(params).toContain('test-tenant-id');
      if (sql.includes('DELETE')) expect(sql).toContain("status IN ('draft', 'rejected')");
    }
  });

  it('rolls back the failing email only and flags the mismatch', async () => {
    const tool = getTool('emails_bulk_insert');
    mockQuery
      .mockResolvedValueOnce([{ id: 'cam-1' }])
      .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }])
      .mockResolvedValueOnce([{ prospect_id: 'p1' }, { prospect_id: 'p2' }])
      .mockResolvedValueOnce([]); // no protected rows
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

  it('rejects batches with duplicate prospect+step pairs before touching the DB', async () => {
    const tool = getTool('emails_bulk_insert');
    mockQuery.mockResolvedValueOnce([{ id: 'cam-1' }]); // campaign
    const out = parse(await tool({ campaign_id: 'cam-1', emails: [email('p1', 1), email('p1', 1)] }));
    expect(out.error).toContain('Duplicate prospect+step');
    expect(out.duplicate_keys).toEqual(['p1:1']);
    expect(mockGetConnection).not.toHaveBeenCalled();
  });

  it('never replaces emails that progressed beyond draft (skipped_protected, no mismatch)', async () => {
    const tool = getTool('emails_bulk_insert');
    mockQuery
      .mockResolvedValueOnce([{ id: 'cam-1' }])
      .mockResolvedValueOnce([{ id: 'p1' }])
      .mockResolvedValueOnce([{ prospect_id: 'p1' }])
      .mockResolvedValueOnce([{ prospect_id: 'p1', step_number: 1, status: 'sent' }]); // step 1 already sent
    const conn = makeConn();
    mockGetConnection.mockResolvedValue(conn);
    const out = parse(await tool({ campaign_id: 'cam-1', emails: [email('p1', 1), email('p1', 2)] }));
    expect(out.inserted).toBe(1); // only step 2
    expect(out.skipped_protected).toEqual([{ prospect_id: 'p1', step_number: 1, status: 'sent' }]);
    expect(out.mismatch).toBe(false); // skip is intentional, not data loss
    expect(out.note).toContain('email_update');
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it('warns about do_not_contact / unsubscribed prospects without blocking the insert', async () => {
    const tool = getTool('emails_bulk_insert');
    mockQuery
      .mockResolvedValueOnce([{ id: 'cam-1' }])
      .mockResolvedValueOnce([
        { id: 'p1', do_not_contact: 1, status: 'contacted' },
        { id: 'p2', do_not_contact: 0, status: 'unsubscribed' },
        { id: 'p3', do_not_contact: 0, status: 'new' },
      ])
      .mockResolvedValueOnce([{ prospect_id: 'p1' }, { prospect_id: 'p2' }, { prospect_id: 'p3' }])
      .mockResolvedValueOnce([]);
    const conn = makeConn();
    mockGetConnection.mockResolvedValue(conn);
    const out = parse(await tool({ campaign_id: 'cam-1', emails: [email('p1'), email('p2'), email('p3')] }));
    expect(out.inserted).toBe(3);
    expect(out.do_not_contact_prospect_ids.sort()).toEqual(['p1', 'p2']);
    expect(out.note).toContain('scheduler will never send');
  });

  it('caps the batch at 500', async () => {
    const tool = getTool('emails_bulk_insert');
    const emails = Array.from({ length: 501 }, (_, i) => email(`p${i}`));
    const out = parse(await tool({ campaign_id: 'cam-1', emails }));
    expect(out.error).toContain('500');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('skips prospects blocked by the cross-campaign guard and reports them', async () => {
    const tool = getTool('emails_bulk_insert');
    mockQuery
      .mockResolvedValueOnce([{ id: 'cam-1' }])
      .mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }])
      .mockResolvedValueOnce([{ prospect_id: 'p1' }, { prospect_id: 'p2' }])
      .mockResolvedValueOnce([]); // no protected rows
    mockGuard.mockResolvedValueOnce({
      verdicts: new Map([
        ['p1', { blocked: true, reason: 'contacted_other_campaign', other_campaign_name: 'Otra campaña', email_status: 'sent' }],
        ['p2', { blocked: false }],
      ]),
      blockedIds: ['p1'],
      domainWarnings: [],
    });
    const conn = makeConn();
    mockGetConnection.mockResolvedValue(conn);
    const out = parse(await tool({ campaign_id: 'cam-1', emails: [email('p1'), email('p2')] }));
    expect(out.inserted).toBe(1); // only p2
    expect(out.blocked_cross_campaign).toEqual([expect.objectContaining({ prospect_id: 'p1' })]);
    expect(out.mismatch).toBe(false); // blocked skip is intentional
    expect(out.note).toContain('force:true');
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it('force:true inserts blocked prospects WITH the audited metadata override', async () => {
    const tool = getTool('emails_bulk_insert');
    mockQuery
      .mockResolvedValueOnce([{ id: 'cam-1' }])
      .mockResolvedValueOnce([{ id: 'p1' }])
      .mockResolvedValueOnce([{ prospect_id: 'p1' }])
      .mockResolvedValueOnce([]);
    mockGuard.mockResolvedValueOnce({
      verdicts: new Map([['p1', { blocked: true, reason: 'contacted_other_campaign' }]]),
      blockedIds: ['p1'],
      domainWarnings: [],
    });
    const conn = makeConn();
    mockGetConnection.mockResolvedValue(conn);
    const out = parse(await tool({ campaign_id: 'cam-1', emails: [email('p1')], force: true }));
    expect(out.inserted).toBe(1);
    expect(out.blocked_cross_campaign).toEqual([]);
    const insert = conn.query.mock.calls.find(([sql]: [string]) => sql.includes('INSERT'))!;
    const metadataParam = insert[1][insert[1].length - 1];
    expect(JSON.parse(metadataParam).contact_guard_override.by).toBe('test-user');
  });
});
