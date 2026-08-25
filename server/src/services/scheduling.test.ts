/**
 * Unit tests for scheduling.ts pure functions:
 *   - resolveProspectTimezone
 *   - resolveProspectLanguage
 *   - calculateOptimalSendTime
 *
 * No database interaction — the DB-dependent functions (getWarmupDailyLimit,
 * getSentCountForDate, distributeEmailsAcrossBusinessDays) are covered
 * separately when integration tests exist.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The module imports `query` and `getTenantConfig` at the bottom for the
// warmup-aware helpers. Mock them so the module can be imported without a
// live database connection.
vi.mock('../config/database', () => ({
  query: vi.fn(),
}));

vi.mock('../middleware/tenant', () => ({
  getTenantConfig: vi.fn(),
}));

import {
  resolveProspectTimezone,
  resolveProspectLanguage,
  calculateOptimalSendTime,
  isBusinessDay,
  getNextBusinessDay,
  nextBusinessDayKeepingTime,
  isWithinSendWindow,
} from './scheduling';

const MADRID_HHMM = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false,
});

// ---------------------------------------------------------------------------------
// resolveProspectTimezone
// ---------------------------------------------------------------------------------

describe('resolveProspectTimezone', () => {
  it('uses explicit timezone when provided and not the generic default', () => {
    const result = resolveProspectTimezone({ timezone: 'America/New_York', country: 'Spain' });
    expect(result).toBe('America/New_York');
  });

  it('falls through to country lookup when no explicit timezone is set', () => {
    const result = resolveProspectTimezone({ country: 'Germany' });
    expect(result).toBe('Europe/Berlin');
  });

  it('maps Spain to Europe/Madrid via country', () => {
    const result = resolveProspectTimezone({ country: 'Spain' });
    expect(result).toBe('Europe/Madrid');
  });

  it('maps UK to Europe/London via country', () => {
    const result = resolveProspectTimezone({ country: 'UK' });
    expect(result).toBe('Europe/London');
  });

  it('maps France to Europe/Paris via country', () => {
    const result = resolveProspectTimezone({ country: 'France' });
    expect(result).toBe('Europe/Paris');
  });

  it('defaults to Europe/Madrid when no timezone and no recognisable country', () => {
    const result = resolveProspectTimezone({ country: 'Atlantis' });
    expect(result).toBe('Europe/Madrid');
  });

  it('defaults to Europe/Madrid when prospect object is empty', () => {
    const result = resolveProspectTimezone({});
    expect(result).toBe('Europe/Madrid');
  });
});

// ---------------------------------------------------------------------------------
// resolveProspectLanguage
// ---------------------------------------------------------------------------------

describe('resolveProspectLanguage', () => {
  it('returns catalan for region Catalunya', () => {
    const result = resolveProspectLanguage({ region: 'Catalunya', country: 'Spain' });
    expect(result).toBe('catalan');
  });

  it('returns catalan for region cataluña (Spanish spelling)', () => {
    const result = resolveProspectLanguage({ region: 'Cataluña' });
    expect(result).toBe('catalan');
  });

  it('returns catalan for city Barcelona', () => {
    const result = resolveProspectLanguage({ city: 'Barcelona', country: 'Spain' });
    expect(result).toBe('catalan');
  });

  it('returns catalan for city Girona', () => {
    const result = resolveProspectLanguage({ city: 'Girona' });
    expect(result).toBe('catalan');
  });

  it('returns catalan for city Sant Cugat', () => {
    const result = resolveProspectLanguage({ city: 'Sant Cugat', country: 'Spain' });
    expect(result).toBe('catalan');
  });

  it('returns spanish for country Spain (non-Catalan location)', () => {
    const result = resolveProspectLanguage({ country: 'Spain', city: 'Madrid' });
    expect(result).toBe('spanish');
  });

  it('returns spanish for country España', () => {
    const result = resolveProspectLanguage({ country: 'España' });
    expect(result).toBe('spanish');
  });

  it('returns english for country UK', () => {
    const result = resolveProspectLanguage({ country: 'UK' });
    expect(result).toBe('english');
  });

  it('returns english for country Germany', () => {
    const result = resolveProspectLanguage({ country: 'Germany' });
    expect(result).toBe('english');
  });

  it('returns english for international role title regardless of country', () => {
    const result = resolveProspectLanguage({ country: 'Spain', title: 'Global Sales Director' });
    expect(result).toBe('english');
  });

  it('returns english for EMEA role title', () => {
    const result = resolveProspectLanguage({ country: 'Spain', title: 'EMEA Account Manager' });
    expect(result).toBe('english');
  });

  it('defaults to english when no location data', () => {
    const result = resolveProspectLanguage({});
    expect(result).toBe('english');
  });

  it('respects defaultLanguage override — returns spanish for non-Catalan location', () => {
    const result = resolveProspectLanguage({ country: 'Germany' }, 'spanish');
    expect(result).toBe('spanish');
  });

  it('respects defaultLanguage but still overrides to catalan for Catalan region', () => {
    const result = resolveProspectLanguage({ region: 'Catalunya' }, 'spanish');
    expect(result).toBe('catalan');
  });

  it('does NOT apply international-title override when defaultLanguage is set', () => {
    // With defaultLanguage='spanish', the "international title → english" logic is skipped
    const result = resolveProspectLanguage({ title: 'Global Director' }, 'spanish');
    expect(result).toBe('spanish');
  });
});

// ---------------------------------------------------------------------------------
// calculateOptimalSendTime
//
// Timezone note for UTC-hour assertions:
// We use 'Atlantic/Reykjavik' (always UTC+0, no DST) when we need local time = UTC.
// Europe/London in summer is UTC+1 (BST), so local 9am = 8am UTC — do NOT use it
// when asserting getUTCHours() === 9.
// ---------------------------------------------------------------------------------

describe('calculateOptimalSendTime', () => {
  it('candidate within 9-11 window returns same day (Reykjavik = UTC+0)', () => {
    // Tuesday 2025-06-10 09:30 UTC = 09:30 Reykjavik (UTC+0 always)
    // 09:30 is within the [9, 11) window
    const candidate = new Date('2025-06-10T09:30:00.000Z');
    const result = calculateOptimalSendTime(candidate, 'Atlantic/Reykjavik');

    expect(result.toISOString().startsWith('2025-06-10')).toBe(true);
    expect(result.getUTCHours()).toBe(9);
  });

  it('candidate before window pushes to start_hour on same day (Reykjavik = UTC+0)', () => {
    // Tuesday 2025-06-10 07:00 UTC = 07:00 Reykjavik — before the 9-11 window
    const candidate = new Date('2025-06-10T07:00:00.000Z');
    const result = calculateOptimalSendTime(candidate, 'Atlantic/Reykjavik');

    expect(result.toISOString().startsWith('2025-06-10')).toBe(true);
    // Pushed to start_hour=9 local time. Reykjavik=UTC+0 → 9 UTC
    expect(result.getUTCHours()).toBe(9);
  });

  it('Friday after window advances to Monday (Reykjavik = UTC+0)', () => {
    // Friday 2025-06-13 16:00 UTC = 16:00 Reykjavik — past the 9-11 window
    const candidate = new Date('2025-06-13T16:00:00.000Z');
    const result = calculateOptimalSendTime(candidate, 'Atlantic/Reykjavik');

    // Friday (5) past window → next Mon (1), which is 2025-06-16
    expect(result.getUTCDay()).toBe(1); // Monday
    expect(result.getUTCHours()).toBe(9);
  });

  it('Saturday candidate moves to Monday (Reykjavik = UTC+0)', () => {
    // Saturday 2025-06-14 08:00 UTC
    const candidate = new Date('2025-06-14T08:00:00.000Z');
    const result = calculateOptimalSendTime(candidate, 'Atlantic/Reykjavik');

    expect(result.getUTCDay()).toBe(1); // Monday
    expect(result.getUTCHours()).toBe(9);
  });

  it('Sunday candidate moves to Monday (Reykjavik = UTC+0)', () => {
    // Sunday 2025-06-15 08:00 UTC
    const candidate = new Date('2025-06-15T08:00:00.000Z');
    const result = calculateOptimalSendTime(candidate, 'Atlantic/Reykjavik');

    expect(result.getUTCDay()).toBe(1); // Monday
    expect(result.getUTCHours()).toBe(9);
  });

  it('respects custom sendWindow days — skips Wednesday if not in allowed list', () => {
    // Wednesday 2025-06-11 09:00 UTC = 09:00 Reykjavik — within hour window but day blocked
    const candidate = new Date('2025-06-11T09:00:00.000Z');
    const result = calculateOptimalSendTime(candidate, 'Atlantic/Reykjavik', {
      days: [1, 2, 4, 5], // Mon, Tue, Thu, Fri — no Wednesday (3)
      start_hour: 9,
      end_hour: 11,
    });

    // Wednesday (3) is not allowed, next is Thursday (4)
    expect(result.getUTCDay()).toBe(4); // Thursday
  });

  it('New York timezone: candidate at 14:00 UTC (10:00 NYC) lands in window', () => {
    // Tuesday 2025-06-10 14:00 UTC = 10:00 America/New_York (UTC-4 in summer, EDT)
    // 10:00 is within the 9-11 window
    const candidate = new Date('2025-06-10T14:00:00.000Z');
    const result = calculateOptimalSendTime(candidate, 'America/New_York');

    expect(result.toISOString().startsWith('2025-06-10')).toBe(true);
    // 9-11 NYC local = 13-15 UTC (EDT = UTC-4)
    expect(result.getUTCHours()).toBeGreaterThanOrEqual(13);
    expect(result.getUTCHours()).toBeLessThan(15);
  });

  it('Madrid timezone: candidate at 07:00 UTC (09:00 Madrid CEST) lands in window', () => {
    // Tuesday 2025-06-10 07:00 UTC = 09:00 Madrid (CEST = UTC+2)
    // 09:00 is exactly at the start of the window
    const candidate = new Date('2025-06-10T07:00:00.000Z');
    const result = calculateOptimalSendTime(candidate, 'Europe/Madrid');

    expect(result.toISOString().startsWith('2025-06-10')).toBe(true);
    // Result should be 9:xx Madrid local = 7:xx UTC
    expect(result.getUTCHours()).toBeGreaterThanOrEqual(7);
    expect(result.getUTCHours()).toBeLessThan(9);
  });

  it('returns a Date object and is never NaN', () => {
    const candidate = new Date('2025-06-10T09:00:00.000Z');
    const result = calculateOptimalSendTime(candidate, 'Europe/Madrid');
    expect(result).toBeInstanceOf(Date);
    expect(isNaN(result.getTime())).toBe(false);
  });
});

// ─────────────────────────────────────────────────
// isBusinessDay
// ─────────────────────────────────────────────────

describe('isBusinessDay', () => {
  it('returns true for Monday', () => {
    // 2025-06-09 is a Monday
    expect(isBusinessDay(new Date('2025-06-09T10:00:00.000Z'))).toBe(true);
  });

  it('returns true for Friday', () => {
    // 2025-06-13 is a Friday
    expect(isBusinessDay(new Date('2025-06-13T10:00:00.000Z'))).toBe(true);
  });

  it('returns false for Saturday', () => {
    // 2025-06-14 is a Saturday
    expect(isBusinessDay(new Date('2025-06-14T10:00:00.000Z'))).toBe(false);
  });

  it('returns false for Sunday', () => {
    // 2025-06-15 is a Sunday
    expect(isBusinessDay(new Date('2025-06-15T10:00:00.000Z'))).toBe(false);
  });

  it('handles Friday-to-Saturday timezone edge case (UTC 23:00 = CET Saturday)', () => {
    // Friday 23:00 UTC = Saturday 01:00 CET
    expect(isBusinessDay(new Date('2025-06-13T23:00:00.000Z'))).toBe(false);
  });
});

// ─────────────────────────────────────────────────
// getNextBusinessDay
// ─────────────────────────────────────────────────

describe('getNextBusinessDay', () => {
  it('returns same date for a Monday', () => {
    const monday = new Date('2025-06-09T10:00:00.000Z');
    const result = getNextBusinessDay(monday);
    expect(result.toISOString().substring(0, 10)).toBe('2025-06-09');
  });

  it('returns Monday for Saturday input', () => {
    const saturday = new Date('2025-06-14T10:00:00.000Z');
    const result = getNextBusinessDay(saturday);
    expect(result.toISOString().substring(0, 10)).toBe('2025-06-16');
  });

  it('returns Monday for Sunday input', () => {
    const sunday = new Date('2025-06-15T10:00:00.000Z');
    const result = getNextBusinessDay(sunday);
    expect(result.toISOString().substring(0, 10)).toBe('2025-06-16');
  });

  it('does not mutate the input date', () => {
    const saturday = new Date('2025-06-14T10:00:00.000Z');
    const original = saturday.toISOString();
    getNextBusinessDay(saturday);
    expect(saturday.toISOString()).toBe(original);
  });
});

// ---------------------------------------------------------------------------------
// distributeEmailsAcrossBusinessDays — startDate (future launch date)
// ---------------------------------------------------------------------------------

import {
  distributeEmailsAcrossBusinessDays,
  getMadridDateString,
  getNextBusinessDays,
  nationalHolidays,
  resolveHolidays,
} from './scheduling';
import { query } from '../config/database';
import { getTenantConfig } from '../middleware/tenant';

describe('distributeEmailsAcrossBusinessDays with startDate', () => {
  const mockedQuery = vi.mocked(query);
  const mockedGetTenantConfig = vi.mocked(getTenantConfig);

  beforeEach(() => {
    vi.clearAllMocks();
    // Old domain (warmup ramp finished) + fixed 100/day config, empty queue, nothing sent.
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('MIN(occurred_at)')) return [{ first_sent: '2026-01-01 09:00:00' }] as any;
      if (sql.includes('COUNT(*)')) return [{ count: 0 }] as any;
      return [] as any;
    });
    mockedGetTenantConfig.mockResolvedValue({
      config: { warmup: { daily_limit_base: 100, daily_limit_max: 100, ramp_up_days: 1 } },
    } as any);
  });

  const emails = (n: number, delayDays = 0) =>
    Array.from({ length: n }, (_, i) => ({
      id: `email-${delayDays}-${i}`,
      prospectTimezone: 'Europe/Madrid',
      delayDays,
    }));

  // Next weekday at least `minDaysAhead` days in the future.
  const futureWeekday = (minDaysAhead: number): Date => {
    const d = new Date();
    d.setDate(d.getDate() + minDaysAhead);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  it('without startDate schedules no earlier than today (existing behavior)', async () => {
    const { schedule } = await distributeEmailsAcrossBusinessDays(emails(3), 'tenant-x');
    const todayStr = getMadridDateString();
    expect(schedule.size).toBe(3);
    for (const date of schedule.values()) {
      expect(getMadridDateString(date) >= todayStr).toBe(true);
    }
  });

  it('with a future startDate schedules nothing before that date', async () => {
    const start = futureWeekday(10);
    const startStr = getMadridDateString(start);
    const { schedule } = await distributeEmailsAcrossBusinessDays(emails(5), 'tenant-x', undefined, start);
    expect(schedule.size).toBe(5);
    for (const date of schedule.values()) {
      expect(getMadridDateString(date) >= startStr).toBe(true);
    }
  });

  it('applies delay_days relative to the future startDate, not today', async () => {
    const start = futureWeekday(10);
    const minDelayed = new Date(start);
    minDelayed.setDate(minDelayed.getDate() + 3);
    const minDelayedStr = getMadridDateString(minDelayed);
    const { schedule } = await distributeEmailsAcrossBusinessDays(emails(2, 3), 'tenant-x', undefined, start);
    expect(schedule.size).toBe(2);
    for (const date of schedule.values()) {
      expect(getMadridDateString(date) >= minDelayedStr).toBe(true);
    }
  });

  it('ignores a past startDate and behaves as if starting today', async () => {
    const past = new Date('2020-01-06T00:00:00');
    const todayStr = getMadridDateString();
    const { schedule } = await distributeEmailsAcrossBusinessDays(emails(2), 'tenant-x', undefined, past);
    expect(schedule.size).toBe(2);
    for (const date of schedule.values()) {
      expect(getMadridDateString(date) >= todayStr).toBe(true);
    }
  });

  it('shifts a weekend startDate to the following Monday', async () => {
    // Find a Saturday at least 10 days out.
    const d = new Date();
    d.setDate(d.getDate() + 10);
    while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    const monday = new Date(d);
    monday.setDate(monday.getDate() + 2);
    const mondayStr = getMadridDateString(monday);

    const { schedule } = await distributeEmailsAcrossBusinessDays(emails(2), 'tenant-x', undefined, d);
    expect(schedule.size).toBe(2);
    for (const date of schedule.values()) {
      expect(getMadridDateString(date) >= mondayStr).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------
// distributeEmailsAcrossBusinessDays — warmup limit across sibling campaigns
// Regression: days appended after the initial horizon used to start at capacity 0,
// ignoring what other campaigns already had scheduled, so a second campaign could
// stack past the daily limit (observed: 160 emails on a 80/day tenant).
// ---------------------------------------------------------------------------------

describe('distributeEmailsAcrossBusinessDays respects the tenant-wide daily limit', () => {
  const mockedQuery = vi.mocked(query);
  const mockedGetTenantConfig = vi.mocked(getTenantConfig);

  /** Mock a tenant whose queue already holds `existing` emails on each given day. */
  const mockQueueOn = (occupied: Record<string, number>) => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('MIN(occurred_at)')) return [{ first_sent: '2026-01-01 09:00:00' }] as any;
      if (sql.includes('GROUP BY DATE(scheduled_for)')) {
        return Object.entries(occupied).map(([dt, cnt]) => ({ dt: `${dt}T00:00:00.000Z`, cnt })) as any;
      }
      if (sql.includes('COUNT(*)')) return [{ count: 0 }] as any;
      return [] as any;
    });
    mockedGetTenantConfig.mockResolvedValue({
      config: { warmup: { daily_limit_base: 10, daily_limit_max: 10, ramp_up_days: 1 } },
    } as any);
  };

  const emails = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `e-${i}`, prospectTimezone: 'Europe/Madrid', delayDays: 0 }));

  const futureWeekday = (minDaysAhead: number): Date => {
    const d = new Date();
    d.setDate(d.getDate() + minDaysAhead);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const businessDaysFrom = (start: Date, n: number): string[] => {
    const out: string[] = [];
    const d = new Date(start);
    while (out.length < n) {
      if (d.getDay() !== 0 && d.getDay() !== 6) out.push(getMadridDateString(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  };

  beforeEach(() => vi.clearAllMocks());

  it('never exceeds the daily limit on days beyond the initial horizon (the 160/80 bug)', async () => {
    const start = futureWeekday(10);
    const days = businessDaysFrom(start, 14);
    // A sibling campaign already filled the first TEN business days to the limit.
    // 25 emails give an initial horizon of ceil(25/10)+5 = 8 days, so days 9-10 are
    // only reached after the horizon is extended mid-loop — precisely where capacity
    // used to be re-initialised to zero and got double-booked.
    const occupied: Record<string, number> = {};
    for (const d of days.slice(0, 10)) occupied[d] = 10;
    mockQueueOn(occupied);

    const { schedule, dayTotals, dailyLimit } = await distributeEmailsAcrossBusinessDays(
      emails(25), 'tenant-x', undefined, start
    );

    expect(dailyLimit).toBe(10);
    expect(schedule.size).toBe(25);
    for (const [day, total] of Object.entries(dayTotals)) {
      expect(total, `day ${day} over limit`).toBeLessThanOrEqual(10);
    }
    // The ten full days must stay untouched; everything lands on day 11 onwards.
    const scheduledDays = [...schedule.values()].map(getMadridDateString);
    for (const full of days.slice(0, 10)) expect(scheduledDays).not.toContain(full);
    for (const d of scheduledDays) expect(d >= days[10]).toBe(true);
  });

  it('reports dayTotals including other campaigns, not just this call', async () => {
    const start = futureWeekday(10);
    const [d0] = businessDaysFrom(start, 1);
    mockQueueOn({ [d0]: 7 }); // 3 slots left on day 0

    const { distribution, dayTotals } = await distributeEmailsAcrossBusinessDays(
      emails(3), 'tenant-x', undefined, start
    );
    expect(distribution[d0]).toBe(3);   // what this call added
    expect(dayTotals[d0]).toBe(10);     // real occupancy (7 existing + 3)
  });

  it('leaves nothing silently unscheduled: every email is either scheduled or reported', async () => {
    const start = futureWeekday(10);
    mockQueueOn({});
    const { schedule, unassigned } = await distributeEmailsAcrossBusinessDays(
      emails(45), 'tenant-x', undefined, start
    );
    expect(schedule.size + unassigned.length).toBe(45);
    expect(unassigned).toEqual([]); // 45 emails at 10/day fit well inside the horizon
  });
});

// ---------------------------------------------------------------------------
// distributeEmailsAcrossBusinessDays — sequence ordering
//
// Regression: delayDays is a floor measured from the global start, so step 1 (delay 0) has
// the lowest floor and step 3 (delay 7) the highest. Once daily capacity saturates, a step 1
// processed late gets pushed past its own step 3, which settled early on an emptier day.
// Observed in production (PINTURAS EUROSOL): s1=2026-10-05 s2=2026-10-01 s3=2026-09-30 —
// the prospect would have received the sign-off five days before the introduction.
// ---------------------------------------------------------------------------
describe('distributeEmailsAcrossBusinessDays preserves sequence order', () => {
  const mockedQuery = vi.mocked(query);
  const mockedGetTenantConfig = vi.mocked(getTenantConfig);

  const mockQueueOn = (occupied: Record<string, number>, limit = 10) => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('MIN(occurred_at)')) return [{ first_sent: '2026-01-01 09:00:00' }] as any;
      if (sql.includes('GROUP BY DATE(scheduled_for)')) {
        return Object.entries(occupied).map(([dt, cnt]) => ({ dt: `${dt}T00:00:00.000Z`, cnt })) as any;
      }
      if (sql.includes('COUNT(*)')) return [{ count: 0 }] as any;
      return [] as any;
    });
    mockedGetTenantConfig.mockResolvedValue({
      config: { warmup: { daily_limit_base: limit, daily_limit_max: limit, ramp_up_days: 1 } },
    } as any);
  };

  const futureWeekday = (minDaysAhead: number): Date => {
    const d = new Date();
    d.setDate(d.getDate() + minDaysAhead);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  /** A 3-step sequence with the pipeline's real cadence (0 / +3 / +7). */
  const sequence = (prospectId: string, campaignId = 'camp-1') =>
    [0, 3, 7].map((delayDays, i) => ({
      id: `${campaignId}-${prospectId}-s${i + 1}`,
      prospectTimezone: 'Europe/Madrid',
      delayDays,
      campaignId,
      prospectId,
      stepNumber: i + 1,
    }));

  const dayOf = (schedule: Map<string, Date>, id: string) => getMadridDateString(schedule.get(id)!);

  beforeEach(() => vi.clearAllMocks());

  it('keeps step1 < step2 < step3 when capacity is saturated (the PINTURAS EUROSOL bug)', async () => {
    const start = futureWeekday(10);
    // 20 sequences at 2/day is what actually reproduces the inversion. With only a handful of
    // sequences the queue never gets tight enough to push a step 1 past day 7, and the test
    // passes even against the broken code — which is worse than no test.
    //
    // The input must be grouped by step, not by prospect: interleaved per-prospect order
    // (s3,s2,s1 for p9, then for p8…) lets every step 1 find an early slot and the order
    // survives by luck. Feeding all the step 3s first is what the unordered SQL can produce,
    // and it is what breaks: the step 3s settle on days 7-16, the step 2s fill 3-6 and 17-22,
    // and the step 1s have nothing left until day 23 — weeks after their own sign-off.
    mockQueueOn({}, 2);
    const shuffled = Array.from({ length: 20 }, (_, i) => sequence(`p${i}`))
      .flat()
      .sort((a, b) => b.stepNumber - a.stepNumber);

    const { schedule, unassigned } = await distributeEmailsAcrossBusinessDays(
      shuffled, 'tenant-x', undefined, start
    );

    expect(unassigned).toEqual([]);
    for (let i = 0; i < 20; i++) {
      const s1 = dayOf(schedule, `camp-1-p${i}-s1`);
      const s2 = dayOf(schedule, `camp-1-p${i}-s2`);
      const s3 = dayOf(schedule, `camp-1-p${i}-s3`);
      expect(s1 < s2).toBe(true);
      expect(s2 < s3).toBe(true);
    }
  });

  it('holds the order across 50 sequences on a tight daily limit', async () => {
    const start = futureWeekday(10);
    mockQueueOn({}, 5);
    const all = Array.from({ length: 50 }, (_, i) => sequence(`p${i}`)).flat();

    const { schedule } = await distributeEmailsAcrossBusinessDays(all, 'tenant-x', undefined, start);

    for (let i = 0; i < 50; i++) {
      const s = [1, 2, 3].map((k) => dayOf(schedule, `camp-1-p${i}-s${k}`));
      expect(s[0] < s[1]).toBe(true);
      expect(s[1] < s[2]).toBe(true);
    }
  });

  it('is independent of input order', async () => {
    const start = futureWeekday(10);
    const base = Array.from({ length: 8 }, (_, i) => sequence(`p${i}`)).flat();
    const results: string[] = [];

    for (let run = 0; run < 5; run++) {
      mockQueueOn({}, 3);
      const shuffled = base.slice().sort(() => (run % 2 === 0 ? 1 : -1));
      const { schedule } = await distributeEmailsAcrossBusinessDays(shuffled, 'tenant-x', undefined, start);
      results.push([...schedule.keys()].sort().map((k) => `${k}=${dayOf(schedule, k)}`).join('|'));
    }
    expect(new Set(results).size).toBe(1);
  });

  it('treats the same prospect in two campaigns as two independent sequences', async () => {
    const start = futureWeekday(10);
    mockQueueOn({}, 10);
    const both = [...sequence('shared', 'camp-A'), ...sequence('shared', 'camp-B')];

    const { schedule, unassigned } = await distributeEmailsAcrossBusinessDays(both, 'tenant-x', undefined, start);

    expect(unassigned).toEqual([]);
    expect(schedule.size).toBe(6);
    for (const c of ['camp-A', 'camp-B']) {
      expect(dayOf(schedule, `${c}-shared-s1`) < dayOf(schedule, `${c}-shared-s2`)).toBe(true);
      expect(dayOf(schedule, `${c}-shared-s2`) < dayOf(schedule, `${c}-shared-s3`)).toBe(true);
    }
  });

  it('never exceeds the daily limit while enforcing order', async () => {
    const start = futureWeekday(10);
    mockQueueOn({}, 4);
    const all = Array.from({ length: 20 }, (_, i) => sequence(`p${i}`)).flat();

    const { schedule, dayTotals } = await distributeEmailsAcrossBusinessDays(all, 'tenant-x', undefined, start);

    expect(schedule.size).toBe(60);
    for (const n of Object.values(dayTotals)) expect(n).toBeLessThanOrEqual(4);
  });

  it('drops a whole sequence rather than scheduling half of it', async () => {
    const start = futureWeekday(10);
    // The initial horizon is sized from the email count (`ceil(n/limit) + 5`), so a lot of
    // emails alone never exhausts it. What does is a queue that is already full: the run has
    // to extend past MAX_BUSINESS_DAYS to find room, and extension is where it gives up.
    const full: Record<string, number> = {};
    const d = new Date(start);
    while (Object.keys(full).length < 300) {
      if (d.getDay() !== 0 && d.getDay() !== 6) full[getMadridDateString(d)] = 1;
      d.setDate(d.getDate() + 1);
    }
    mockQueueOn(full, 1);
    const all = Array.from({ length: 100 }, (_, i) => sequence(`p${i}`)).flat();

    const { schedule, unassigned } = await distributeEmailsAcrossBusinessDays(all, 'tenant-x', undefined, start);

    expect(unassigned.length).toBeGreaterThan(0);
    expect(schedule.size + unassigned.length).toBe(300);
    // Every dropped sequence must be dropped whole: no prospect half-scheduled.
    for (let i = 0; i < 100; i++) {
      const ids = [1, 2, 3].map((k) => `camp-1-p${i}-s${k}`);
      const placed = ids.filter((id) => schedule.has(id)).length;
      expect(placed === 0 || placed === 3).toBe(true);
    }
  });

  it('falls back to the previous per-email behavior without sequence fields', async () => {
    const start = futureWeekday(10);
    mockQueueOn({}, 3);
    const legacy = Array.from({ length: 9 }, (_, i) => ({
      id: `e-${i}`, prospectTimezone: 'Europe/Madrid', delayDays: 0,
    }));

    const { schedule, unassigned, dayTotals } = await distributeEmailsAcrossBusinessDays(
      legacy, 'tenant-x', undefined, start
    );
    expect(unassigned).toEqual([]);
    expect(schedule.size).toBe(9);
    for (const n of Object.values(dayTotals)) expect(n).toBeLessThanOrEqual(3);
  });

  it('keeps a partial sequence ordered when the first step was already sent', async () => {
    const start = futureWeekday(10);
    mockQueueOn({}, 2);
    // Callers set delayDays: 0 for the anchor when the previous step already went out.
    const partial = [
      { id: 'x-s2', prospectTimezone: 'Europe/Madrid', delayDays: 0, campaignId: 'c', prospectId: 'x', stepNumber: 2 },
      { id: 'x-s3', prospectTimezone: 'Europe/Madrid', delayDays: 4, campaignId: 'c', prospectId: 'x', stepNumber: 3 },
    ];

    const { schedule } = await distributeEmailsAcrossBusinessDays(partial, 'tenant-x', undefined, start);
    expect(dayOf(schedule, 'x-s2') < dayOf(schedule, 'x-s3')).toBe(true);
  });

  // The scheduler can only order steps it can see. Approving one regenerated step on its own —
  // routine after email QA rejects it — used to group it alone with its floor measured from
  // today, which put it before its own earlier step already sitting in the queue.
  it('respects an already-scheduled earlier step as a floor', async () => {
    mockQueueOn({}, 10);
    const existing = new Map([['c::x', [{ stepNumber: 1, scheduledFor: new Date('2026-09-15T07:30:00Z') }]]]);
    const lone = [{ id: 'x-s2', prospectTimezone: 'Europe/Madrid', delayDays: 3, campaignId: 'c', prospectId: 'x', stepNumber: 2 }];

    const { schedule, unassigned } = await distributeEmailsAcrossBusinessDays(
      lone, 'tenant-x', undefined, new Date('2026-08-24T12:00:00Z'), existing
    );

    expect(unassigned).toEqual([]);
    expect(dayOf(schedule, 'x-s2') > '2026-09-15').toBe(true);
  });

  it('respects an already-scheduled later step as a ceiling', async () => {
    mockQueueOn({}, 10);
    const existing = new Map([['c::x', [{ stepNumber: 3, scheduledFor: new Date('2026-09-10T07:30:00Z') }]]]);
    const lone = [{ id: 'x-s1', prospectTimezone: 'Europe/Madrid', delayDays: 0, campaignId: 'c', prospectId: 'x', stepNumber: 1 }];

    const { schedule, unassigned } = await distributeEmailsAcrossBusinessDays(
      lone, 'tenant-x', undefined, new Date('2026-09-01T12:00:00Z'), existing
    );

    expect(unassigned).toEqual([]);
    expect(dayOf(schedule, 'x-s1') < '2026-09-10').toBe(true);
  });

  it('leaves a step unscheduled rather than placing it past a later sibling', async () => {
    mockQueueOn({}, 10);
    // step 3 already on the 2nd; a step 1 that cannot start before the 3rd has nowhere legal.
    const existing = new Map([['c::x', [{ stepNumber: 3, scheduledFor: new Date('2026-09-02T07:30:00Z') }]]]);
    const lone = [{ id: 'x-s1', prospectTimezone: 'Europe/Madrid', delayDays: 0, campaignId: 'c', prospectId: 'x', stepNumber: 1 }];

    const { schedule, unassigned } = await distributeEmailsAcrossBusinessDays(
      lone, 'tenant-x', undefined, new Date('2026-09-03T12:00:00Z'), existing
    );

    expect(schedule.size).toBe(0);
    expect(unassigned).toEqual(['x-s1']);
  });

  // Order alone is not enough: a sequence whose three steps land on consecutive days is
  // ordered but reads as harassment. With room to breathe, the 0/+3/+7 cadence must survive.
  it('preserves the 0/+3/+7 cadence when capacity allows', async () => {
    const start = futureWeekday(10);
    mockQueueOn({}, 80);
    const all = Array.from({ length: 5 }, (_, i) => sequence(`p${i}`)).flat();

    const { schedule } = await distributeEmailsAcrossBusinessDays(all, 'tenant-x', undefined, start);

    const days = (id: string) => new Date(`${dayOf(schedule, id)}T00:00:00Z`).getTime() / 86_400_000;
    for (let i = 0; i < 5; i++) {
      const [s1, s2, s3] = [1, 2, 3].map((s) => days(`camp-1-p${i}-s${s}`));
      // >= rather than ===: a target landing on a weekend or holiday rolls forward.
      expect(s2 - s1).toBeGreaterThanOrEqual(3);
      expect(s3 - s2).toBeGreaterThanOrEqual(4);
    }
  });

  // The invariants have to hold for queue shapes nobody thought to write a case for.
  it('holds every invariant across randomised queues', async () => {
    // Deterministic PRNG (mulberry32): a failure here is reproducible, not a flake.
    let seed = 0x9e3779b9;
    const rand = () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = (n: number) => Math.floor(rand() * n);

    for (let run = 0; run < 60; run++) {
      const limit = 1 + pick(12);
      const nSeqs = 1 + pick(25);
      const start = futureWeekday(5 + pick(20));

      // Pre-load some days so the run has to work around an existing queue.
      const occupied: Record<string, number> = {};
      const d = new Date(start);
      for (let i = 0; i < pick(8); i++) {
        occupied[getMadridDateString(d)] = pick(limit + 1);
        d.setDate(d.getDate() + 1);
      }
      mockQueueOn(occupied, limit);

      const all = Array.from({ length: nSeqs }, (_, i) => sequence(`p${i}`, `c${pick(3)}`)).flat();
      const { schedule, dayTotals, unassigned } = await distributeEmailsAcrossBusinessDays(
        all, 'tenant-x', undefined, start
      );

      const ctx = `run=${run} limit=${limit} seqs=${nSeqs}`;
      // Nothing vanishes: every email is either scheduled or reported.
      expect(schedule.size + unassigned.length, ctx).toBe(all.length);
      // Capacity is never oversold.
      for (const n of Object.values(dayTotals)) expect(n, ctx).toBeLessThanOrEqual(limit);

      const byProspect = new Map<string, string[]>();
      for (const e of all) {
        const when = schedule.get(e.id);
        if (!when) continue;
        const day = getMadridDateString(when);
        // Never a weekend, never a holiday.
        expect(isBusinessDay(when), `${ctx} ${day}`).toBe(true);
        const key = `${e.campaignId}::${e.prospectId}`;
        if (!byProspect.has(key)) byProspect.set(key, []);
        byProspect.get(key)![e.stepNumber - 1] = day;
      }
      for (const [key, days] of byProspect) {
        const present = days.filter(Boolean);
        // A sequence is all-or-nothing, and strictly ordered.
        expect(present.length, `${ctx} ${key}`).toBe(3);
        expect(present[0] < present[1] && present[1] < present[2], `${ctx} ${key} ${present}`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Holidays. Before this existed, isBusinessDay() only skipped Sat/Sun, so 52 emails were
// scheduled on 2026-10-12 (Fiesta Nacional) and had to be moved by hand.
// ---------------------------------------------------------------------------
describe('holidays', () => {
  const mockedGetTenantConfig = vi.mocked(getTenantConfig);
  const mockedQuery = vi.mocked(query);

  // Midday UTC — always inside the same Madrid calendar day, whatever the offset.
  const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

  beforeEach(() => vi.clearAllMocks());

  it('treats national holidays as non-business days', () => {
    expect(isBusinessDay(at('2026-10-12'))).toBe(false); // Fiesta Nacional, a Monday
    expect(isBusinessDay(at('2026-12-25'))).toBe(false); // Navidad, a Friday
    expect(isBusinessDay(at('2027-01-01'))).toBe(false); // Año Nuevo, a Friday
    expect(isBusinessDay(at('2026-10-13'))).toBe(true);  // the Tuesday after
  });

  it('computes Good Friday, the one movable national holiday', () => {
    expect(nationalHolidays(2026).has('2026-04-03')).toBe(true);
    expect(nationalHolidays(2027).has('2027-03-26')).toBe(true);
    expect(nationalHolidays(2028).has('2028-04-14')).toBe(true);
    expect(isBusinessDay(at('2026-04-03'))).toBe(false);
  });

  it('lets a tenant add and remove days', async () => {
    mockedGetTenantConfig.mockResolvedValue({
      config: { scheduling: { holidays: ['2026-06-24', '-2026-10-12'] } },
    } as any);

    const set = await resolveHolidays('tenant-x', [2026]);
    expect(set.has('2026-06-24')).toBe(true);  // Sant Joan, added
    expect(set.has('2026-10-12')).toBe(false); // Fiesta Nacional, removed
    expect(set.has('2026-12-25')).toBe(true);  // national ones still there
  });

  it('lets a tenant opt out of holidays entirely', async () => {
    mockedGetTenantConfig.mockResolvedValue({
      config: { scheduling: { skipHolidays: false } },
    } as any);
    expect((await resolveHolidays('tenant-x', [2026])).size).toBe(0);
  });

  it('falls back to the national calendar when the tenant lookup fails', async () => {
    mockedGetTenantConfig.mockRejectedValue(new Error('db down'));
    const set = await resolveHolidays('tenant-x', [2026]);
    expect(set.has('2026-10-12')).toBe(true);
  });

  it('never schedules on a holiday', async () => {
    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('MIN(occurred_at)')) return [{ first_sent: '2026-01-01 09:00:00' }] as any;
      if (sql.includes('COUNT(*)')) return [{ count: 0 }] as any;
      return [] as any;
    });
    mockedGetTenantConfig.mockResolvedValue({
      config: { warmup: { daily_limit_base: 2, daily_limit_max: 2, ramp_up_days: 1 } },
    } as any);

    // Start the Thursday before 12-oct-2026 so the queue has to run straight through it.
    const { schedule } = await distributeEmailsAcrossBusinessDays(
      Array.from({ length: 20 }, (_, i) => ({ id: `h-${i}`, prospectTimezone: 'Europe/Madrid', delayDays: 0 })),
      'tenant-x', undefined, new Date('2026-10-08T12:00:00Z')
    );

    const days = [...schedule.values()].map((d) => getMadridDateString(d));
    expect(days.length).toBe(20);
    expect(days).not.toContain('2026-10-12');
  });
});

// ---------------------------------------------------------------------------
// Date arithmetic. Both of these were wrong in ways that only showed up off this machine:
// the locale round-trip shifted by Madrid's offset under TZ=UTC (production), and stepping a
// day by +24h lands on the same day when Madrid's day has 25 hours.
// ---------------------------------------------------------------------------
describe('date arithmetic is timezone- and DST-independent', () => {
  it('reads the Madrid calendar day regardless of the process timezone', () => {
    // 2026-10-24T22:30Z is already 2026-10-25 in Madrid (UTC+2 that evening).
    expect(getMadridDateString(new Date('2026-10-24T22:30:00Z'))).toBe('2026-10-25');
    // 2026-09-01T07:30Z is 09:30 Madrid — the pipeline's usual send time.
    expect(getMadridDateString(new Date('2026-09-01T07:30:00Z'))).toBe('2026-09-01');
    // 23:30Z on New Year's Eve is already 00:30 on the 1st in Madrid — a year rollover that
    // a UTC-based reading would get wrong.
    expect(getMadridDateString(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
  });

  it('crosses the DST change without repeating or skipping a day', () => {
    // Spain falls back on 2026-10-25, making that Madrid day 25 hours long.
    const days = getNextBusinessDays(new Date('2026-10-23T12:00:00Z'), 5, new Set())
      .map((d) => getMadridDateString(d));
    expect(days).toEqual(['2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']);
    expect(new Set(days).size).toBe(days.length); // no repeats
  });

  it('crosses the spring DST change too', () => {
    // Spain springs forward on 2026-03-29 (a Sunday): that Madrid day has 23 hours.
    const days = getNextBusinessDays(new Date('2026-03-26T12:00:00Z'), 4, new Set())
      .map((d) => getMadridDateString(d));
    expect(days).toEqual(['2026-03-26', '2026-03-27', '2026-03-30', '2026-03-31']);
  });
});

// ---------------------------------------------------------------------------
// The weekend/holiday auto-adjust on PUT. Restoring the caller's clock with
// setUTCHours() on a midday-anchored result silently landed a day late for any
// late-UTC instant, so the "bumped to Monday" contract quietly meant Tuesday.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Holidays on the SEQUENCES path. calculateOptimalSendTime only skipped Sat/Sun, so the
// platform held two definitions of "business day": campaigns knew about 12-oct, sequences
// did not, and sequence sends still landed on it.
// ---------------------------------------------------------------------------
describe('calculateOptimalSendTime with holidays', () => {
  // Reykjavik is UTC+0 year-round, so local == UTC and the assertions stay readable.
  const TZ = 'Atlantic/Reykjavik';
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it('moves off a holiday that falls on a working weekday', () => {
    // 2026-10-12 is a Monday and Fiesta Nacional.
    const out = calculateOptimalSendTime(new Date('2026-10-12T08:00:00.000Z'), TZ, undefined,
      new Set(['2026-10-12']));
    expect(iso(out)).toBe('2026-10-13');
  });

  it('skips a holiday bridge that spans several days', () => {
    // Thu 2026-12-24 candidate with 25th and 28th blocked: 26-27 is a weekend, so the next
    // working day is Tue 2026-12-29. A one-week loop bound would not have reached it.
    const out = calculateOptimalSendTime(new Date('2026-12-24T20:00:00.000Z'), TZ, undefined,
      new Set(['2026-12-25', '2026-12-28']));
    expect(iso(out)).toBe('2026-12-29');
  });

  it('lands on the holiday when no holiday set is passed (previous behaviour)', () => {
    const out = calculateOptimalSendTime(new Date('2026-10-12T08:00:00.000Z'), TZ);
    expect(iso(out)).toBe('2026-10-12');
  });

  it('lands on the holiday when the tenant opted out (empty set)', () => {
    const out = calculateOptimalSendTime(new Date('2026-10-12T08:00:00.000Z'), TZ, undefined, new Set());
    expect(iso(out)).toBe('2026-10-12');
  });

  it('combines a weekend and a holiday', () => {
    // Fri 2026-10-09 past the window → Mon the 12th, which is the holiday → Tue the 13th.
    const out = calculateOptimalSendTime(new Date('2026-10-09T20:00:00.000Z'), TZ, undefined,
      new Set(['2026-10-12']));
    expect(iso(out)).toBe('2026-10-13');
  });

  it('leaves an ordinary working day untouched', () => {
    const out = calculateOptimalSendTime(new Date('2026-10-14T08:00:00.000Z'), TZ, undefined,
      new Set(['2026-10-12']));
    expect(iso(out)).toBe('2026-10-14');
  });

  it('uses the real national calendar, Good Friday included', () => {
    const hol = nationalHolidays(2026);
    // 2026-04-03 is Good Friday.
    const out = calculateOptimalSendTime(new Date('2026-04-03T08:00:00.000Z'), TZ, undefined, hol);
    expect(iso(out)).toBe('2026-04-06');
  });
});

// isWithinSendWindow is the gate on the ACTUAL send. Without holidays here, every enrollment
// whose next_send_at was written before the calendar existed still comes due on a holiday and
// still goes out — recomputing future dates only helps rows computed after the change.
describe('isWithinSendWindow with holidays', () => {
  const TZ = 'Atlantic/Reykjavik'; // UTC+0 year-round, so local == UTC
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('refuses to send on a holiday that is otherwise a working weekday', () => {
    vi.setSystemTime(new Date('2026-10-12T10:00:00.000Z')); // Monday, Fiesta Nacional
    expect(isWithinSendWindow(TZ, undefined, new Set(['2026-10-12']))).toBe(false);
  });

  it('still sends on that day when no calendar is passed (previous behaviour)', () => {
    vi.setSystemTime(new Date('2026-10-12T10:00:00.000Z'));
    expect(isWithinSendWindow(TZ)).toBe(true);
  });

  it('still sends when the tenant opted out of holidays', () => {
    vi.setSystemTime(new Date('2026-10-12T10:00:00.000Z'));
    expect(isWithinSendWindow(TZ, undefined, new Set())).toBe(true);
  });

  it('sends normally on an ordinary working day', () => {
    vi.setSystemTime(new Date('2026-10-13T10:00:00.000Z')); // Tuesday
    expect(isWithinSendWindow(TZ, undefined, new Set(['2026-10-12']))).toBe(true);
  });

  it('keeps refusing weekends regardless of the calendar', () => {
    vi.setSystemTime(new Date('2026-10-10T10:00:00.000Z')); // Saturday
    expect(isWithinSendWindow(TZ, undefined, new Set())).toBe(false);
  });
});

describe('nextBusinessDayKeepingTime', () => {
  const noHolidays = new Set<string>();

  it('bumps a late-UTC Sunday to Monday, not Tuesday', () => {
    // 2026-08-22T23:30Z is Sunday 01:30 in Madrid. The old setUTCHours() restore produced
    // 2026-08-24T23:30Z, which is Madrid *Tuesday* 01:30 — a day past the intended Monday.
    const out = nextBusinessDayKeepingTime(new Date('2026-08-22T23:30:00Z'), noHolidays);
    expect(getMadridDateString(out)).toBe('2026-08-24');
    expect(MADRID_HHMM.format(out)).toBe('01:30');
  });

  it('keeps the Madrid wall-clock time across the bump', () => {
    // Saturday 09:30 Madrid → Monday, still 09:30 Madrid.
    const out = nextBusinessDayKeepingTime(new Date('2026-08-22T07:30:00Z'), noHolidays);
    expect(getMadridDateString(out)).toBe('2026-08-24');
    expect(MADRID_HHMM.format(out)).toBe('09:30');
  });

  it('leaves a business day untouched', () => {
    const input = new Date('2026-08-25T07:30:00Z');
    expect(nextBusinessDayKeepingTime(input, noHolidays).toISOString()).toBe(input.toISOString());
  });

  it('walks past a holiday into the next year', () => {
    // 2026-12-31 is a Thursday; 2027-01-01 (Friday) is Año Nuevo, so the next
    // business day is Monday 2027-01-04. Needs both years in the holiday set.
    const holidays = new Set([...nationalHolidays(2026), ...nationalHolidays(2027)]);
    const out = nextBusinessDayKeepingTime(new Date('2027-01-01T08:30:00Z'), holidays);
    expect(getMadridDateString(out)).toBe('2027-01-04');
  });

  it('preserves the wall clock across the autumn DST change', () => {
    // Sunday 2026-10-25 is the 25-hour day; Monday the 26th is UTC+1.
    const out = nextBusinessDayKeepingTime(new Date('2026-10-25T08:30:00Z'), noHolidays);
    expect(getMadridDateString(out)).toBe('2026-10-26');
    expect(MADRID_HHMM.format(out)).toBe('09:30');
  });
});
