/**
 * Tests for server/src/services/contactGuard.ts — cross-campaign contact guard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({
  query: vi.fn(),
}));

vi.mock('../middleware/tenant', () => ({
  getTenantConfig: vi.fn(),
}));

import { query } from '../config/database';
import { getTenantConfig } from '../middleware/tenant';
import { checkCrossCampaignContact, formatBlocked, shouldSkipEmail } from './contactGuard';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockGetTenant = getTenantConfig as ReturnType<typeof vi.fn>;

const T = 'test-tenant-id';
const CAMPAIGN = 'campaign-b';
const OTHER = { campaign_id: 'campaign-a', campaign_name: 'Campaña de Alfons' };

/** Queue mock results for one chunk: [Q1 emails, Q2 enrollment?, Q3 own+conflicts?] */
function queueChunk(opts: {
  emails?: any[];
  enrolled?: any[];
  own?: any[];
  conflicts?: any[];
  withEnrollment?: boolean;
  withDomain?: boolean;
}) {
  mockQuery.mockResolvedValueOnce(opts.emails || []);
  if (opts.withEnrollment) mockQuery.mockResolvedValueOnce(opts.enrolled || []);
  if (opts.withDomain) {
    mockQuery.mockResolvedValueOnce(opts.own || []);
    if ((opts.own || []).length > 0) mockQuery.mockResolvedValueOnce(opts.conflicts || []);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTenant.mockResolvedValue({ id: T, config: {} }); // cooldown default 365
});

describe('checkCrossCampaignContact', () => {
  it('returns a non-blocked verdict for a free prospect', async () => {
    queueChunk({ emails: [] });
    const r = await checkCrossCampaignContact(T, CAMPAIGN, ['p1']);
    expect(r.verdicts.get('p1')).toEqual({ blocked: false });
    expect(r.blockedIds).toEqual([]);
    // Q1 must be tenant-scoped and exclude the operated campaign
    expect(mockQuery.mock.calls[0][0]).toContain('ge.tenant_id = ?');
    expect(mockQuery.mock.calls[0][0]).toContain('ge.campaign_id <> ?');
    expect(mockQuery.mock.calls[0][1].slice(0, 2)).toEqual([T, CAMPAIGN]);
  });

  it('blocks on sent in another campaign with campaign name attached', async () => {
    queueChunk({ emails: [{ prospect_id: 'p1', status: 'sent', sent_at: new Date().toISOString(), ...OTHER }] });
    const r = await checkCrossCampaignContact(T, CAMPAIGN, ['p1']);
    const v = r.verdicts.get('p1')!;
    expect(v.blocked).toBe(true);
    expect(v.reason).toBe('contacted_other_campaign');
    expect(v.other_campaign_name).toBe('Campaña de Alfons');
    expect(r.blockedIds).toEqual(['p1']);
  });

  it('draft-only in another campaign warns but does not block', async () => {
    queueChunk({ emails: [{ prospect_id: 'p1', status: 'draft', sent_at: null, ...OTHER }] });
    const r = await checkCrossCampaignContact(T, CAMPAIGN, ['p1']);
    const v = r.verdicts.get('p1')!;
    expect(v.blocked).toBe(false);
    expect(v.draft_only).toBe(true);
  });

  it('scheduled blocks with queuedBlocks (default) but not at send time (queuedBlocks:false)', async () => {
    queueChunk({ emails: [{ prospect_id: 'p1', status: 'scheduled', sent_at: null, ...OTHER }] });
    const withQueue = await checkCrossCampaignContact(T, CAMPAIGN, ['p1']);
    expect(withQueue.verdicts.get('p1')!.blocked).toBe(true);
    expect(withQueue.verdicts.get('p1')!.reason).toBe('queued_other_campaign');

    queueChunk({ emails: [{ prospect_id: 'p1', status: 'scheduled', sent_at: null, ...OTHER }] });
    const sendTime = await checkCrossCampaignContact(T, CAMPAIGN, ['p1'], { queuedBlocks: false });
    expect(sendTime.verdicts.get('p1')!.blocked).toBe(false);
  });

  it('active enrollment in another live campaign reserves the prospect (only with checkEnrollment)', async () => {
    queueChunk({ emails: [], withEnrollment: true, enrolled: [{ prospect_id: 'p1', ...OTHER }] });
    const withEnroll = await checkCrossCampaignContact(T, CAMPAIGN, ['p1'], { checkEnrollment: true });
    expect(withEnroll.verdicts.get('p1')!.reason).toBe('enrolled_other_campaign');

    queueChunk({ emails: [] });
    const without = await checkCrossCampaignContact(T, CAMPAIGN, ['p1']);
    expect(without.verdicts.get('p1')!.blocked).toBe(false);
  });

  it('never sees the operated campaign (own follow-ups excluded by SQL param)', async () => {
    // The SQL excludes campaign_id = CAMPAIGN; simulate DB honouring it (no rows)
    queueChunk({ emails: [] });
    const r = await checkCrossCampaignContact(T, CAMPAIGN, ['p1']);
    expect(r.verdicts.get('p1')!.blocked).toBe(false);
    expect(mockQuery.mock.calls[0][1]).toContain(CAMPAIGN);
  });

  it('cooldown releases old sent contacts but never queued ones', async () => {
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 3600 * 1000).toISOString();
    queueChunk({ emails: [{ prospect_id: 'p1', status: 'sent', sent_at: twoYearsAgo, ...OTHER }] });
    const released = await checkCrossCampaignContact(T, CAMPAIGN, ['p1'], { cooldownDays: 365 });
    expect(released.verdicts.get('p1')!.blocked).toBe(false);

    queueChunk({ emails: [{ prospect_id: 'p1', status: 'scheduled', sent_at: twoYearsAgo, ...OTHER }] });
    const queued = await checkCrossCampaignContact(T, CAMPAIGN, ['p1'], { cooldownDays: 365 });
    expect(queued.verdicts.get('p1')!.blocked).toBe(true);
  });

  it('handles a mixed batch correctly', async () => {
    queueChunk({
      emails: [
        { prospect_id: 'p-sent', status: 'sent', sent_at: new Date().toISOString(), ...OTHER },
        { prospect_id: 'p-draft', status: 'draft', sent_at: null, ...OTHER },
      ],
    });
    const r = await checkCrossCampaignContact(T, CAMPAIGN, ['p-free', 'p-sent', 'p-draft']);
    expect(r.blockedIds).toEqual(['p-sent']);
    expect(r.verdicts.get('p-free')!.blocked).toBe(false);
    expect(r.verdicts.get('p-draft')!.draft_only).toBe(true);
  });

  it('domain conflicts produce warnings without blocking; freemail ignored', async () => {
    queueChunk({
      emails: [],
      withDomain: true,
      own: [
        { id: 'p1', email: 'comercial@acme.com', company_id: 'comp-1', dom: 'acme.com' },
        { id: 'p2', email: 'someone@gmail.com', company_id: null, dom: 'gmail.com' },
      ],
      conflicts: [
        { id: 'p-other', email: 'info@acme.com', company_id: 'comp-1', dom: 'acme.com', ...OTHER },
      ],
    });
    const r = await checkCrossCampaignContact(T, CAMPAIGN, ['p1', 'p2'], { checkDomain: true });
    expect(r.blockedIds).toEqual([]);
    expect(r.domainWarnings).toHaveLength(1);
    expect(r.domainWarnings[0]).toMatchObject({
      prospect_id: 'p1',
      conflicting_email: 'info@acme.com',
      via: 'company',
      other_campaign_name: 'Campaña de Alfons',
    });
  });

  it('empty input short-circuits without queries', async () => {
    const r = await checkCrossCampaignContact(T, CAMPAIGN, []);
    expect(r.blockedIds).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('formatBlocked', () => {
  it('flattens blocked verdicts for API responses', async () => {
    queueChunk({ emails: [{ prospect_id: 'p1', status: 'sent', sent_at: new Date().toISOString(), ...OTHER }] });
    const r = await checkCrossCampaignContact(T, CAMPAIGN, ['p1']);
    expect(formatBlocked(r)).toEqual([{
      prospect_id: 'p1',
      reason: 'contacted_other_campaign',
      other_campaign_id: 'campaign-a',
      other_campaign_name: 'Campaña de Alfons',
      email_status: 'sent',
    }]);
  });
});

describe('shouldSkipEmail', () => {
  const blocked = { blocked: true, reason: 'contacted_other_campaign' as const };

  it('skips blocked emails without override', () => {
    expect(shouldSkipEmail(blocked, null)).toBe(true);
    expect(shouldSkipEmail(blocked, '{}')).toBe(true);
  });

  it('respects the audited contact_guard_override (object and JSON string metadata)', () => {
    expect(shouldSkipEmail(blocked, { contact_guard_override: { by: 'u1', at: 'x' } })).toBe(false);
    expect(shouldSkipEmail(blocked, JSON.stringify({ contact_guard_override: { by: 'u1' } }))).toBe(false);
  });

  it('never skips non-blocked emails', () => {
    expect(shouldSkipEmail({ blocked: false }, null)).toBe(false);
    expect(shouldSkipEmail(undefined, null)).toBe(false);
  });
});
