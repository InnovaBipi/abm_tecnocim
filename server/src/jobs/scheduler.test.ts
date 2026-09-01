import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({ query: vi.fn() }));
vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { query } from '../config/database';
import { logger } from '../config/logger';
import { cancelOrphanedFollowups, hygieneStep, rejectStaleScheduled } from './scheduler';

const mockedQuery = vi.mocked(query);
const mockedLogger = vi.mocked(logger);

// ---------------------------------------------------------------------------
// The reaper. A follow-up whose predecessor was rejected can never be released by the send
// gate (which requires prev.status = 'sent'), so it ages in 'scheduled' forever — 22 of them
// had piled up in production.
//
// The dangerous mistake, and one this nearly shipped with: treating any non-'sent' predecessor
// as terminal. A predecessor still in 'scheduled' or 'draft' is WAITING, and 38 legitimate
// queued follow-ups were one condition away from being cancelled.
// ---------------------------------------------------------------------------
describe('cancelOrphanedFollowups', () => {
  beforeEach(() => vi.clearAllMocks());

  const sqlOf = () => String(mockedQuery.mock.calls[0][0]).replace(/\s+/g, ' ');

  it('only cancels rows whose PREVIOUS step is rejected', async () => {
    mockedQuery.mockResolvedValue({ affectedRows: 0 } as any);
    await cancelOrphanedFollowups();
    const sql = sqlOf();
    expect(sql).toMatch(/prev\.status = 'rejected'/);
    expect(sql).toMatch(/ge\.status = 'scheduled'/);
    // Direct predecessor only — not "any earlier step".
    expect(sql).toMatch(/prev\.step_number = ge\.step_number - 1/);
  });

  it('never treats a waiting predecessor as terminal', async () => {
    mockedQuery.mockResolvedValue({ affectedRows: 0 } as any);
    await cancelOrphanedFollowups();
    const sql = sqlOf();
    // These would each cancel live follow-ups whose first step simply had not gone out yet.
    expect(sql).not.toMatch(/prev\.status = 'scheduled'/);
    expect(sql).not.toMatch(/prev\.status = 'draft'/);
    expect(sql).not.toMatch(/prev\.status != 'sent'/);
    expect(sql).not.toMatch(/prev\.status <> 'sent'/);
  });

  it('stays scoped to one tenant per row via the join', async () => {
    mockedQuery.mockResolvedValue({ affectedRows: 0 } as any);
    await cancelOrphanedFollowups();
    expect(sqlOf()).toMatch(/prev\.tenant_id = ge\.tenant_id/);
  });

  it('records why the row was rejected', async () => {
    mockedQuery.mockResolvedValue({ affectedRows: 3 } as any);
    await cancelOrphanedFollowups();
    expect(sqlOf()).toMatch(/skip_reason.*orphaned_predecessor_rejected/);
  });

  it('says nothing when there was nothing to cancel', async () => {
    mockedQuery.mockResolvedValue({ affectedRows: 0 } as any);
    await cancelOrphanedFollowups();
    expect(mockedLogger.info).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The staleness sweep. Measured legitimate lateness is p99 = 1.65 days and only 0.10% of
// 4864 real sends ever exceeded 7 days, so 7 sits far above healthy warmup backlog.
//
// The failure mode that matters is not a missed stale row — it is a stalled sender. If the
// job stops for a fortnight, the whole queue goes stale, and a sweep with no brake would
// convert an outage into permanent data loss.
// ---------------------------------------------------------------------------
describe('rejectStaleScheduled', () => {
  // resetAllMocks, not clearAllMocks: mockResolvedValueOnce queues survive a clear and leak
  // into the next test, shifting which call each stubbed value answers.
  beforeEach(() => vi.resetAllMocks());

  /** One row per tenant from the grouped scan, then the per-tenant UPDATE. */
  const mockScan = (rows: Array<{ tenantId: string; stale: number; due: number }>) => {
    mockedQuery.mockResolvedValueOnce(rows as any);
    for (const r of rows) mockedQuery.mockResolvedValue({ affectedRows: r.stale } as any);
  };
  const updates = () => mockedQuery.mock.calls.filter((c) => /UPDATE generated_emails/.test(String(c[0])));
  const scanSql = () => String(mockedQuery.mock.calls[0][0]).replace(/\s+/g, ' ');

  it('does nothing when no row is stale', async () => {
    mockScan([{ tenantId: 't1', stale: 0, due: 500 }]);
    await rejectStaleScheduled();
    expect(updates()).toHaveLength(0);
  });

  it('sweeps a small stale batch', async () => {
    mockScan([{ tenantId: 't1', stale: 5, due: 1000 }]); // 0.5%
    await rejectStaleScheduled();
    expect(updates()).toHaveLength(1);
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });

  it('refuses to sweep when most of the due queue is stale, and says why', async () => {
    mockScan([{ tenantId: 't1', stale: 600, due: 1000 }]); // 60% — the sender stopped
    await rejectStaleScheduled();
    expect(updates()).toHaveLength(0);
    expect(mockedLogger.error).toHaveBeenCalled();
  });

  it('holds the line right at the threshold', async () => {
    mockScan([{ tenantId: 't1', stale: 101, due: 1000 }]); // 10.1% > 10%
    await rejectStaleScheduled();
    expect(updates()).toHaveLength(0);

    vi.resetAllMocks();
    mockScan([{ tenantId: 't1', stale: 99, due: 1000 }]); // 9.9% <= 10%
    await rejectStaleScheduled();
    expect(updates()).toHaveLength(1);
  });

  // A global ratio let one small tenant's outage hide inside everyone else's healthy volume,
  // and swept that tenant's whole backlog — the data loss the brake exists to prevent.
  it('judges each tenant on its own queue', async () => {
    mockScan([
      { tenantId: 'healthy', stale: 2, due: 900 },   // 0.2% -> sweep
      { tenantId: 'stalled', stale: 40, due: 50 },   // 80%  -> abort
    ]);
    await rejectStaleScheduled();
    const swept = updates().map((c) => (c[1] as any[])[0]);
    expect(swept).toEqual(['healthy']);
    expect(mockedLogger.error).toHaveBeenCalledTimes(1);
  });

  it('only ever considers emails of ACTIVE campaigns', async () => {
    mockScan([{ tenantId: 't1', stale: 1, due: 100 }]);
    await rejectStaleScheduled();
    // A draft/paused campaign sits past-due by design; sweeping it destroys a prepared queue.
    expect(scanSql()).toMatch(/JOIN campaigns cam ON cam\.id = ge\.campaign_id AND cam\.status = 'active'/);
    expect(String(updates()[0][0]).replace(/\s+/g, ' '))
      .toMatch(/JOIN campaigns cam ON cam\.id = ge\.campaign_id AND cam\.status = 'active'/);
  });

  it('never sweeps a follow-up still blocked behind an unsent step 1', async () => {
    mockScan([{ tenantId: 't1', stale: 1, due: 100 }]);
    await rejectStaleScheduled();
    // Those rows are gated, not late. Ageing them out delivers one-step sequences.
    for (const sql of [scanSql(), String(updates()[0][0]).replace(/\s+/g, ' ')]) {
      expect(sql).toMatch(/ge\.step_number = 1 OR EXISTS/);
      expect(sql).toMatch(/prev\.status = 'sent'/);
    }
  });

  it('measures staleness against the DUE queue, not the whole queue', async () => {
    mockScan([{ tenantId: 't1', stale: 1, due: 100 }]);
    await rejectStaleScheduled();
    // Future-dated emails in the denominator would dilute the stalled-sender signal away.
    expect(scanSql()).toMatch(/ge\.scheduled_for <= NOW\(\)/);
  });

  it('uses a 7-day cutoff and records the reason', async () => {
    mockScan([{ tenantId: 't1', stale: 2, due: 1000 }]);
    await rejectStaleScheduled();
    const upd = updates()[0];
    expect(String(upd[0])).toMatch(/INTERVAL \? DAY/);
    expect((upd[1] as any[])[1]).toBe(7);
    expect(String(upd[0])).toMatch(/skip_reason.*stale_schedule/);
  });
});

// ---------------------------------------------------------------------------
// Hygiene-step isolation. Every queue-hygiene helper runs before the send query, and none of
// them used to be guarded: when cancelRepliedFollowups started throwing "Data truncated for
// column 'status'", the throw reached the cron wrapper and skipped the send batch — silently,
// for every tenant, on every 2-minute cycle, for 29 days.
// ---------------------------------------------------------------------------
describe('hygieneStep', () => {
  beforeEach(() => vi.clearAllMocks());

  it('swallows a failing step and logs which one failed', async () => {
    const boom = vi.fn().mockRejectedValue(new Error("Data truncated for column 'status' at row 1"));

    await expect(hygieneStep('cancelRepliedFollowups', boom)).resolves.toBeUndefined();

    expect(boom).toHaveBeenCalledOnce();
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        step: 'cancelRepliedFollowups',
        error: "Data truncated for column 'status' at row 1",
      })
    );
  });

  it('stays out of the way when the step succeeds', async () => {
    const ok = vi.fn().mockResolvedValue(undefined);

    await hygieneStep('rejectStaleScheduled', ok);

    expect(ok).toHaveBeenCalledOnce();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  });
});
