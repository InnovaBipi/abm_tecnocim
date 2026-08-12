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

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
} from './scheduling';

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

import { distributeEmailsAcrossBusinessDays, getMadridDateString } from './scheduling';
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
