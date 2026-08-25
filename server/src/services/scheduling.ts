/**
 * Smart email scheduling: no weekends + optimal send time per prospect timezone.
 *
 * B2B email best practices:
 * - Tuesday-Thursday 9:00-11:00 local time = highest open rates
 * - Monday/Friday acceptable but lower engagement
 * - Saturday/Sunday = never send
 *
 * Optimal hour mapping by region/country (business morning in local TZ):
 * - Europe/Madrid (Spain, default): 9:00-11:00
 * - Europe/London (UK): 9:00-11:00
 * - Asia/Qatar (Qatar, UAE): 9:00-11:00
 * - America/New_York (US East): 9:00-11:00
 * - etc.
 */

// Map of country -> IANA timezone for common ABM targets
const COUNTRY_TIMEZONE_MAP: Record<string, string> = {
  'Spain': 'Europe/Madrid',
  'España': 'Europe/Madrid',
  'Espanya': 'Europe/Madrid',
  'France': 'Europe/Paris',
  'Francia': 'Europe/Paris',
  'Germany': 'Europe/Berlin',
  'Alemania': 'Europe/Berlin',
  'Italy': 'Europe/Rome',
  'Italia': 'Europe/Rome',
  'Portugal': 'Europe/Lisbon',
  'United Kingdom': 'Europe/London',
  'UK': 'Europe/London',
  'Netherlands': 'Europe/Amsterdam',
  'Belgium': 'Europe/Brussels',
  'Switzerland': 'Europe/Zurich',
  'Suiza': 'Europe/Zurich',
  'Qatar': 'Asia/Qatar',
  'UAE': 'Asia/Dubai',
  'United Arab Emirates': 'Asia/Dubai',
  'Saudi Arabia': 'Asia/Riyadh',
  'USA': 'America/New_York',
  'United States': 'America/New_York',
  'Mexico': 'America/Mexico_City',
  'Argentina': 'America/Argentina/Buenos_Aires',
  'Colombia': 'America/Bogota',
  'Chile': 'America/Santiago',
  'China': 'Asia/Shanghai',
  'Japan': 'Asia/Tokyo',
  'India': 'Asia/Kolkata',
  'Morocco': 'Africa/Casablanca',
  'Marruecos': 'Africa/Casablanca',
};

// Optimal send hours in the prospect's local time (9:00-11:00 range)
const OPTIMAL_START_HOUR = 9;
const OPTIMAL_END_HOUR = 11;

const MADRID_TZ = 'Europe/Madrid';

/**
 * Calendar fields of an instant, as seen in Madrid.
 *
 * The previous approach — `new Date(d.toLocaleString('en-US', {timeZone}))` — reparsed a
 * locale-formatted string, which ECMA-262 leaves implementation-defined. Worse, it silently
 * shifted the instant by Madrid's UTC offset: measured +2h under TZ=UTC (the production
 * server) and 0h under TZ=Europe/Madrid (a dev laptop), so it looked correct exactly where
 * nobody could observe the bug. Intl gives the fields directly, with no reparse and no shift.
 */
const MADRID_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: MADRID_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
});

interface MadridDateParts {
  /** YYYY-MM-DD in Madrid */
  iso: string;
  /** 0 = Sunday … 6 = Saturday, in Madrid */
  dow: number;
}

function madridParts(date: Date): MadridDateParts {
  const parts = MADRID_FMT.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const [y, m, d] = [Number(get('year')), Number(get('month')), Number(get('day'))];
  // Weekday derived from the numeric date rather than Intl's `weekday` token. A token the
  // runtime's ICU spells differently ("Mon.", a non-English fallback) would fall through a
  // lookup table to a default, and a default of Sunday makes isBusinessDay() return false for
  // *every* date — which turns getNextBusinessDays' unbounded `while` into an infinite loop.
  return { iso: `${get('year')}-${get('month')}-${get('day')}`, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/**
 * Advance to the next MADRID calendar day, anchored at 12:00 UTC.
 *
 * Two wrong ways to do this, both of which were in this file:
 *   - `d.getTime() + 24*60*60*1000` — 2026-10-25 in Spain lasts 25 hours, so 24h from its
 *     midnight lands back on the same day at 23:00.
 *   - `d.setDate(d.getDate() + 1)` — calendar-aware, but in the *process* timezone. On the
 *     production server (UTC, no DST) that is again exactly 24h, so it has the same bug.
 *
 * Stepping the Madrid calendar date itself is the only version that holds regardless of where
 * the process runs. 12:00 UTC is 13:00 or 14:00 in Madrid — never near a day boundary, so the
 * anchor can't drift. Callers set their own time-of-day afterwards.
 */
function addOneDay(date: Date): Date {
  const [y, m, d] = madridParts(date).iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
}

/**
 * The Madrid calendar day of an instant, anchored at 12:00 UTC.
 *
 * Same anchor `addOneDay` produces, so the first day of a horizon is indistinguishable from
 * every day appended after it. Anchoring matters: the day carries its clock time into the
 * optimal-send seed, and an unanchored `now` late in the UTC evening is already tomorrow in
 * Madrid — the slot gets booked against tomorrow's capacity while the send lands on this
 * morning, i.e. in the past, firing on the next scheduler tick and busting today's warmup.
 */
function madridMidday(date: Date): Date {
  const [y, m, d] = madridParts(date).iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/** Spanish national holidays, as MM-DD. The movable ones are computed separately. */
const FIXED_NATIONAL_HOLIDAYS = [
  '01-01', // Año Nuevo
  '01-06', // Epifanía
  '05-01', // Fiesta del Trabajo
  '08-15', // Asunción
  '10-12', // Fiesta Nacional
  '11-01', // Todos los Santos
  '12-06', // Constitución
  '12-08', // Inmaculada
  '12-25', // Navidad
];

/**
 * Good Friday for a given year (Meeus/Jones/Butcher computus, Gregorian).
 *
 * It is the only movable national holiday in Spain, and it is not derivable from a fixed
 * date — hence the arithmetic rather than a hardcoded table that would silently expire.
 */
function goodFriday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(Date.UTC(year, month - 1, day, 12));
  const gf = new Date(easter.getTime() - 2 * 24 * 60 * 60 * 1000); // Easter is never near DST
  return `${gf.getUTCFullYear()}-${String(gf.getUTCMonth() + 1).padStart(2, '0')}-${String(gf.getUTCDate()).padStart(2, '0')}`;
}

const nationalHolidayCache = new Map<number, Set<string>>();

/** Cached set, NOT to be handed out — isBusinessDay reads it on every call. */
function nationalHolidaySet(year: number): Set<string> {
  let cached = nationalHolidayCache.get(year);
  if (!cached) {
    cached = new Set(FIXED_NATIONAL_HOLIDAYS.map((md) => `${year}-${md}`));
    cached.add(goodFriday(year));
    nationalHolidayCache.set(year, cached);
  }
  return cached;
}

/**
 * National holidays for a year, as YYYY-MM-DD.
 *
 * Returns a copy: the cache is process-lifetime state that `isBusinessDay` reads on its
 * default path, so one caller doing `.add()` on it would corrupt the calendar for every
 * tenant until restart.
 */
export function nationalHolidays(year: number): Set<string> {
  return new Set(nationalHolidaySet(year));
}

/**
 * Holiday set for a tenant, covering `years`.
 *
 * Tenant config (`config.scheduling`):
 *   - `skipHolidays: false` → send on holidays like before (empty set)
 *   - `holidays: ["2026-06-24", "-2026-10-12"]` → a bare date adds one, a `-` prefix removes one
 *
 * Regional holidays live here rather than hardcoded: the sender may be in Catalonia while the
 * recipients are in Andalucía and Murcia, so there is no single right regional calendar.
 */
export async function resolveHolidays(tenantId: string, years: number[]): Promise<Set<string>> {
  let cfg: any = {};
  try {
    const tenant = await getTenantConfig(tenantId);
    cfg = (tenant as any)?.config?.scheduling ?? {};
  } catch {
    // Tenant lookup failures must not block scheduling — fall back to the national calendar.
  }
  if (cfg.skipHolidays === false) return new Set();

  const set = new Set<string>();
  for (const y of years) for (const d of nationalHolidaySet(y)) set.add(d);
  for (const entry of Array.isArray(cfg.holidays) ? cfg.holidays : []) {
    if (typeof entry !== 'string') continue;
    if (entry.startsWith('-')) set.delete(entry.slice(1));
    else set.add(entry);
  }
  return set;
}

/**
 * Check if a date falls on a business day in Europe/Madrid: Mon-Fri and not a holiday.
 *
 * `holidays` defaults to the national calendar for that year. Callers with a tenant in scope
 * should pass the resolved set from `resolveHolidays()`.
 */
export function isBusinessDay(date: Date, holidays?: Set<string>): boolean {
  const { iso, dow } = madridParts(date);
  if (dow === 0 || dow === 6) return false;
  const set = holidays ?? nationalHolidaySet(Number(iso.slice(0, 4)));
  return !set.has(iso);
}

/**
 * Get the next business day from a given date.
 * If the given date IS a business day, returns a copy of the same date.
 * Otherwise advances past weekends and holidays.
 */
export function getNextBusinessDay(date: Date, holidays?: Set<string>): Date {
  let result = new Date(date);
  while (!isBusinessDay(result, holidays)) result = addOneDay(result);
  return result;
}

const MADRID_TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: MADRID_TZ, hour: '2-digit', minute: '2-digit', hour12: false,
});

/**
 * Next business day, keeping the original MADRID time of day.
 *
 * `getNextBusinessDay` returns its result anchored at 12:00 UTC, so callers that restored the
 * caller's clock with `setUTCHours(d.getUTCHours(), …)` silently moved the result: a Sunday
 * 23:30 UTC input resolved to Madrid Monday, then came back out as Monday 23:30 UTC — which is
 * Madrid *Tuesday* 01:30. The weekend auto-adjust was off by a day for any late-UTC instant.
 *
 * Rebuilding from Madrid parts is the only version that survives the day boundary. The offset
 * is read at the target day's midday, far from any DST transition.
 */
export function nextBusinessDayKeepingTime(date: Date, holidays?: Set<string>): Date {
  const [hh, mm] = MADRID_TIME_FMT.format(date).split(':').map(Number);
  const target = getNextBusinessDay(date, holidays);
  const [y, m, d] = madridParts(target).iso.split('-').map(Number);
  const offset = getTimezoneOffsetHours(MADRID_TZ, target);
  return new Date(Date.UTC(y, m - 1, d, hh - offset, mm, 0, 0));
}

/**
 * Resolve the IANA timezone for a prospect based on their data.
 * Priority: explicit timezone field > country lookup > default Europe/Madrid.
 */
export function resolveProspectTimezone(prospect: {
  timezone?: string;
  country?: string;
  city?: string;
}): string {
  // 1. Use explicit timezone if set and not the generic default
  if (prospect.timezone && prospect.timezone !== 'Europe/Madrid') {
    return prospect.timezone;
  }

  // 2. Look up by country
  if (prospect.country) {
    const tz = COUNTRY_TIMEZONE_MAP[prospect.country];
    if (tz) return tz;
  }

  // 3. Default
  return prospect.timezone || 'Europe/Madrid';
}

/**
 * Get the UTC offset in hours for a given IANA timezone at a specific date.
 * Uses Intl.DateTimeFormat to handle DST correctly.
 */
function getTimezoneOffsetHours(timezone: string, date: Date): number {
  try {
    // Format date parts in the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0', 10);

    const tzYear = get('year');
    const tzMonth = get('month') - 1; // JS months are 0-indexed
    const tzDay = get('day');
    const tzHour = get('hour') === 24 ? 0 : get('hour');
    const tzMinute = get('minute');

    // Create a UTC date with the timezone's local components
    const localAsUtc = Date.UTC(tzYear, tzMonth, tzDay, tzHour, tzMinute, 0);
    const utcMs = date.getTime();

    // Offset = local - UTC (in hours)
    return (localAsUtc - utcMs) / (1000 * 60 * 60);
  } catch {
    // Fallback: assume Europe/Madrid (UTC+1 or UTC+2 in summer)
    return 1;
  }
}

/**
 * Calculate the optimal send time for a prospect, given a candidate datetime.
 *
 * Rules:
 * 1. Never on Saturday (6) or Sunday (0)
 * 2. Send between 9:00-11:00 in the prospect's local timezone
 * 3. If the candidate is outside business hours, push to next available slot
 * 4. Respects sequence send_window if provided
 *
 * @param candidateUtc - The raw calculated send time (UTC)
 * @param prospectTimezone - IANA timezone string for the prospect
 * @param sendWindow - Optional sequence send_window settings
 * @returns Adjusted Date in UTC
 */
export function calculateOptimalSendTime(
  candidateUtc: Date,
  prospectTimezone: string,
  sendWindow?: {
    days?: number[];       // 0=Sun, 1=Mon, ..., 6=Sat
    start_hour?: number;   // Local hour
    end_hour?: number;     // Local hour
    timezone?: string;     // Window timezone (usually sender's)
  },
  /**
   * Days to treat as non-working on top of the send window, as YYYY-MM-DD.
   *
   * Optional so the 8 existing call sites keep their exact behaviour until they pass a set.
   * Without it the sequences path skipped only Sat/Sun while the campaigns path already knew
   * about holidays, so the platform held two different definitions of "business day" and
   * sequence sends still landed on 12-oct.
   */
  holidays?: Set<string>
): Date {
  const effectiveTz = prospectTimezone || 'Europe/Madrid';
  const startHour = sendWindow?.start_hour ?? OPTIMAL_START_HOUR;
  const endHour = sendWindow?.end_hour ?? OPTIMAL_END_HOUR;
  const allowedDays = sendWindow?.days ?? [1, 2, 3, 4, 5]; // Mon-Fri by default

  // Get the offset for the prospect's timezone
  const offsetHours = getTimezoneOffsetHours(effectiveTz, candidateUtc);

  // Convert candidate to prospect's local time components
  let localMs = candidateUtc.getTime() + (offsetHours * 60 * 60 * 1000);
  let localDate = new Date(localMs);

  // Pick a random minute within the optimal window to look more natural (not all at :00)
  const optimalMinute = Math.floor(Math.random() * 45) + 5; // 05-49 minutes

  // Check if we need to adjust the time
  const localHour = localDate.getUTCHours();
  const localDay = localDate.getUTCDay();

  // localDate carries local wall time in its UTC fields, so read the calendar day from those.
  const localIso = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const isHoliday = (d: Date) => !!holidays && holidays.has(localIso(d));

  // Is the current day allowed? A holiday is treated exactly like a disallowed weekday.
  const isDayAllowed = allowedDays.includes(localDay) && !isHoliday(localDate);

  // Is the current hour within the window?
  const isHourInWindow = localHour >= startHour && localHour < endHour;

  if (isDayAllowed && isHourInWindow) {
    // Already in a good slot - use as is but randomize minutes slightly
    localDate.setUTCMinutes(optimalMinute);
    localDate.setUTCSeconds(0);
    localDate.setUTCMilliseconds(0);

    // Convert back to UTC
    const resultUtc = new Date(localDate.getTime() - (offsetHours * 60 * 60 * 1000));
    return resultUtc;
  }

  // Need to adjust: either wrong day or wrong hour

  if (isDayAllowed && localHour < startHour) {
    // Same day, but too early - push to start_hour
    localDate.setUTCHours(startHour, optimalMinute, 0, 0);
    return new Date(localDate.getTime() - (offsetHours * 60 * 60 * 1000));
  }

  // Past the window or wrong day - find the next allowed day
  // Move to next day at start_hour
  let daysToAdd = 1;
  const dayAt = (add: number) => {
    const probe = new Date(localDate.getTime());
    probe.setUTCDate(probe.getUTCDate() + add);
    return probe;
  };
  // Bound at 21 rather than 8: a long holiday bridge can push past a single week.
  const MAX_SKIP_DAYS = 21;
  let found = false;
  while (daysToAdd < MAX_SKIP_DAYS) {
    const probe = dayAt(daysToAdd);
    if (allowedDays.includes(probe.getUTCDay()) && !isHoliday(probe)) { found = true; break; }
    daysToAdd++;
  }
  if (!found) {
    // Misconfigured window (e.g. days: []) or a holiday list covering the horizon. Falling
    // through silently would schedule on day 21 whatever it is — possibly a Saturday, which
    // the outbox filter then never releases, stranding the row for good.
    logger.warn('No allowed send day within horizon, falling back to the next weekday', {
      allowedDays, horizonDays: MAX_SKIP_DAYS,
    });
    daysToAdd = 1;
    while (![1, 2, 3, 4, 5].includes(dayAt(daysToAdd).getUTCDay())) daysToAdd++;
  }

  // Set to next allowed day at optimal start_hour
  localDate.setUTCDate(localDate.getUTCDate() + daysToAdd);
  localDate.setUTCHours(startHour, optimalMinute, 0, 0);

  // Re-read the offset AT THE TARGET DAY, not at the candidate. The skip can now span three
  // weeks, easily crossing a DST transition: converting back with the old offset would land a
  // 9:30 local target at 8:30 local, i.e. before start_hour and outside the send window.
  const approxUtc = new Date(localDate.getTime() - (offsetHours * 60 * 60 * 1000));
  const targetOffset = getTimezoneOffsetHours(effectiveTz, approxUtc);
  return new Date(localDate.getTime() - (targetOffset * 60 * 60 * 1000));
}

/**
 * Check if an enrollment should be sent now based on prospect timezone
 * and send window. Returns true if the current time is within the allowed
 * send window for the prospect.
 */
export function isWithinSendWindow(
  prospectTimezone: string,
  sendWindow?: {
    days?: number[];
    start_hour?: number;
    end_hour?: number;
  },
  /**
   * Holidays to treat as non-sending days.
   *
   * This is the gate on the ACTUAL send, so without it the holiday work is only half done:
   * every enrollment whose next_send_at was written before the calendar existed still comes
   * due on 12-oct, still passes this check, and still goes out. Recomputing future dates
   * only helps rows computed after the change.
   */
  holidays?: Set<string>
): boolean {
  const now = new Date();
  const effectiveTz = prospectTimezone || 'Europe/Madrid';
  const startHour = sendWindow?.start_hour ?? OPTIMAL_START_HOUR;
  const endHour = sendWindow?.end_hour ?? 17; // Default to 5pm for "is it OK to send now" check
  const allowedDays = sendWindow?.days ?? [1, 2, 3, 4, 5];

  const offsetHours = getTimezoneOffsetHours(effectiveTz, now);
  const localMs = now.getTime() + (offsetHours * 60 * 60 * 1000);
  const localDate = new Date(localMs);

  const localHour = localDate.getUTCHours();
  const localDay = localDate.getUTCDay();

  const localIso = `${localDate.getUTCFullYear()}-${String(localDate.getUTCMonth() + 1).padStart(2, '0')}-${String(localDate.getUTCDate()).padStart(2, '0')}`;
  if (holidays?.has(localIso)) return false;

  return allowedDays.includes(localDay) && localHour >= startHour && localHour < endHour;
}

// ============================================
// LANGUAGE RESOLUTION
// ============================================

export type ProspectLanguage = 'catalan' | 'spanish' | 'english';

// Catalan-speaking regions (comarca / region names)
const CATALAN_REGIONS = [
  'catalunya', 'cataluña', 'catalonia',
  'illes balears', 'baleares', 'balearic islands',
  'pais valencia', 'país valencià', 'comunitat valenciana', 'comunidad valenciana',
];

// Cities that are clearly in Catalonia
const CATALAN_CITIES = [
  'barcelona', 'girona', 'lleida', 'tarragona',
  'sabadell', 'terrassa', 'badalona', 'hospitalet',
  'mataro', 'mataró', 'reus', 'figueres', 'olot',
  'vic', 'manresa', 'igualada', 'vilafranca',
  'sitges', 'tortosa', 'amposta', 'valls',
  'sant cugat', 'granollers', 'mollet',
  'sant vicenç dels horts', 'sant boi',
  'cornella', 'cornellà', 'esplugues',
  'gavà', 'gava', 'castelldefels',
  'el prat', 'sant feliu', 'cerdanyola',
  'rubí', 'rubi', 'sant adrià', 'sant adria',
  'blanes', 'lloret', 'tossa', 'platja d\'aro',
  'palafurgell', 'palafrugell', 'begur',
  'la bisbal', 'roses', 'cadaqués', 'cadaques',
  'puigcerdà', 'puigcerda', 'la seu d\'urgell',
  'sort', 'tremp', 'balaguer', 'mollerussa',
  'solsona', 'berga', 'ripoll', 'camprodon',
];

// Spanish-speaking countries
const SPANISH_COUNTRIES = [
  'spain', 'españa', 'espanya',
  'mexico', 'méxico', 'argentina', 'colombia', 'chile',
  'peru', 'perú', 'ecuador', 'venezuela', 'uruguay',
  'paraguay', 'bolivia', 'costa rica', 'panama', 'panamá',
  'guatemala', 'honduras', 'el salvador', 'nicaragua',
  'cuba', 'dominican republic', 'república dominicana',
  'puerto rico',
];

// Keywords in prospect title that indicate an international role → default to English
const INTERNATIONAL_TITLE_KEYWORDS = [
  'international', 'europe', 'global', 'worldwide', 'emea',
  'apac', 'latam', 'americas', 'asia', 'africa', 'middle east',
  'cross-border', 'overseas',
];

/**
 * Resolve the preferred email language for a prospect based on their location.
 *
 * When defaultLanguage is not provided:
 * 0. International roles (title contains "International", "Europe", "Global", etc.) → 'english'
 * 1. Region is Catalunya (or city is in Catalonia) → 'catalan'
 * 2. Country is Spain (or other Spanish-speaking) → 'spanish'
 * 3. Everything else → 'english'
 *
 * When defaultLanguage is provided (e.g. 'spanish' for Technova):
 * 1. Region is Catalunya (or city is in Catalonia) → 'catalan'
 * 2. Everything else → defaultLanguage
 */
export function resolveProspectLanguage(prospect: {
  region?: string;
  country?: string;
  city?: string;
  title?: string;
}, defaultLanguage?: ProspectLanguage): ProspectLanguage {
  const region = (prospect.region || '').toLowerCase().trim();
  const country = (prospect.country || '').toLowerCase().trim();
  const city = (prospect.city || '').toLowerCase().trim();
  const title = (prospect.title || '').toLowerCase().trim();

  // 0. International roles get English (only when no defaultLanguage override)
  if (!defaultLanguage && title && INTERNATIONAL_TITLE_KEYWORDS.some(kw => title.includes(kw))) {
    return 'english';
  }

  // 1. Check if region is Catalan-speaking
  if (CATALAN_REGIONS.some(r => region.includes(r))) {
    return 'catalan';
  }

  // 2. Check if city is in Catalonia
  if (CATALAN_CITIES.some(c => city.includes(c) || city === c)) {
    return 'catalan';
  }

  // If tenant specifies a default language, use it for everyone else
  if (defaultLanguage) {
    return defaultLanguage;
  }

  // 3. Check if country is Spanish-speaking
  if (SPANISH_COUNTRIES.some(c => country === c || country.includes(c))) {
    return 'spanish';
  }

  // 4. Default: English
  return 'english';
}

// ============================================
// WARMUP-AWARE SCHEDULING
// ============================================

import { query } from '../config/database';
import { getTenantConfig } from '../middleware/tenant';
import { logger } from '../config/logger';

/**
 * Get a YYYY-MM-DD date string in Europe/Madrid timezone.
 * Avoids relying on MySQL CURDATE() which uses the server's UTC timezone.
 */
export function getMadridDateString(date?: Date): string {
  return madridParts(date ?? new Date()).iso;
}

/**
 * Calculate the warmup daily limit for a tenant based on domain age.
 * Uses tenant config warmup curve or sensible defaults.
 */
export async function getWarmupDailyLimit(tenantId: string): Promise<number> {
  const result = await query<any[]>(
    `SELECT MIN(occurred_at) as first_sent
     FROM email_events WHERE event_type = 'sent' AND tenant_id = ?`,
    [tenantId]
  );

  const firstSent = result[0]?.first_sent ? new Date(result[0].first_sent) : null;
  const now = new Date();
  const domainAgeDays = firstSent
    ? Math.floor((now.getTime() - firstSent.getTime()) / (1000 * 60 * 60 * 24)) + 1
    : 0;

  try {
    const tenant = await getTenantConfig(tenantId);
    const warmup = tenant?.config?.warmup;
    if (warmup?.daily_limit_base && warmup?.daily_limit_max) {
      const base = warmup.daily_limit_base;
      const max = warmup.daily_limit_max;
      const rampDays = warmup.ramp_up_days || 30;
      if (domainAgeDays === 0) return base;
      if (domainAgeDays >= rampDays) return max;
      return Math.min(max, Math.round(base + (max - base) * (domainAgeDays / rampDays)));
    }
  } catch {
    // Fall through to defaults
  }

  if (domainAgeDays === 0) return 5;
  if (domainAgeDays <= 3) return 5;
  if (domainAgeDays <= 7) return 15;
  if (domainAgeDays <= 14) return 30;
  if (domainAgeDays <= 21) return 50;
  if (domainAgeDays <= 30) return 100;
  return Infinity;
}

/**
 * Count all emails sent on a specific date for a tenant.
 * Dual-source: generated_emails (outbox) + email_events (sequences) to match getTotalSentToday().
 */
export async function getSentCountForDate(tenantId: string, dateStr: string): Promise<number> {
  const outbox = await query<any[]>(
    `SELECT COUNT(*) as count FROM generated_emails
     WHERE status = 'sent' AND tenant_id = ? AND DATE(sent_at) = ?`,
    [tenantId, dateStr]
  );
  const sequences = await query<any[]>(
    `SELECT COUNT(*) as count FROM email_events
     WHERE event_type = 'sent' AND tenant_id = ? AND DATE(occurred_at) = ?
     AND sequence_id IS NOT NULL`,
    [tenantId, dateStr]
  );
  return (outbox[0]?.count || 0) + (sequences[0]?.count || 0);
}

/**
 * Get count of already-scheduled emails per future date for a tenant.
 * When redistributing, pass excludeIds to avoid double-counting the emails being moved.
 */
async function getScheduledCountByDate(tenantId: string, excludeIds?: string[]): Promise<Map<string, number>> {
  const todayMadrid = getMadridDateString();
  let sql = `SELECT DATE(scheduled_for) as dt, COUNT(*) as cnt
     FROM generated_emails
     WHERE tenant_id = ? AND status = 'scheduled' AND scheduled_for >= ?`;
  const params: any[] = [tenantId, todayMadrid];

  if (excludeIds && excludeIds.length > 0) {
    sql += ` AND id NOT IN (${excludeIds.map(() => '?').join(',')})`;
    params.push(...excludeIds);
  }
  sql += ' GROUP BY DATE(scheduled_for)';

  const rows = await query<any[]>(sql, params);

  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.dt) {
      const dateStr = getMadridDateString(new Date(row.dt));
      map.set(dateStr, row.cnt);
    }
  }
  return map;
}

/**
 * Get the next N business days starting from a date.
 */
export function getNextBusinessDays(startDate: Date, count: number, holidays?: Set<string>): Date[] {
  const days: Date[] = [];
  let d = new Date(startDate);
  while (days.length < count) {
    // Was `d.getDay()` — the server's local weekday, while isBusinessDay() normalizes to
    // Madrid. On a UTC server the two disagree for any instant in the last hour(s) of a
    // Madrid day, so the horizon could include a day the sender considers a weekend.
    if (isBusinessDay(d, holidays)) days.push(new Date(d));
    d = addOneDay(d);
  }
  return days;
}

/**
 * Distribute emails across business days respecting the warmup daily limit.
 * Returns a Map of emailId → scheduled_for Date.
 *
 * Takes into account:
 * - Already-scheduled emails per day
 * - Already-sent emails for today
 * - Each email's delay_days (minimum offset from now)
 * - Prospect timezone for optimal send time within each day
 * - **Sequence order**: steps of the same (campaign, prospect) are placed in order, each
 *   strictly after the previous one. Pass `campaignId`/`prospectId`/`stepNumber` to opt in.
 *
 * Why sequence awareness matters: `delayDays` is a floor measured from the global start, so
 * step 1 (delay 0) has the *lowest* floor and step 3 (delay 7) the highest. Once daily
 * capacity saturates, a step 1 processed late gets pushed past its own step 3, which settled
 * early on an emptier day. Observed in production: a prospect scheduled to receive "I'll stop
 * bothering you" five days before the introduction. Emails without the optional fields fall
 * back to singleton groups, i.e. exactly the previous behavior.
 */
export async function distributeEmailsAcrossBusinessDays(
  emails: Array<{
    id: string;
    prospectTimezone: string;
    delayDays: number;
    /** Sequence identity. Both are needed: one prospect can be enrolled in several campaigns. */
    campaignId?: string;
    prospectId?: string;
    stepNumber?: number;
  }>,
  tenantId: string,
  excludeIds?: string[],
  startDate?: Date,
  /**
   * Steps of the same sequences that are already scheduled or sent and are NOT part of this
   * call, keyed by `campaignId::prospectId`. They bound the placement: a step must land after
   * every lower-numbered sibling and before every higher-numbered one.
   *
   * Without this, approving one regenerated step on its own re-creates the very inversion this
   * function exists to prevent — it groups alone, its floor is measured from today, and it can
   * land in August while its own step 1 sits in September.
   */
  existingSteps?: Map<string, Array<{ stepNumber: number; scheduledFor: Date }>>
): Promise<{
  schedule: Map<string, Date>;
  distribution: Record<string, number>;
  /** Per-day occupancy after this call (includes other campaigns' emails). */
  dayTotals: Record<string, number>;
  /** Emails that found no slot within the horizon — callers must surface these. */
  unassigned: string[];
  dailyLimit: number;
}> {
  const dailyLimit = await getWarmupDailyLimit(tenantId);
  const scheduledCounts = await getScheduledCountByDate(tenantId, excludeIds);

  // Distribution starts today, or at startDate when a future launch date is requested.
  // delay_days offsets are relative to this start (step cadence is preserved).
  const now = new Date();
  // Anchor at Madrid midday in BOTH branches. `setHours(12)` would anchor in the *process*
  // timezone, reintroducing the process-TZ dependence this module otherwise eliminated, and
  // leaving `now` unanchored made the first day of the horizon behave unlike every later one
  // (see madridMidday).
  const effectiveStart =
    startDate && startDate.getTime() > now.getTime() ? madridMidday(startDate) : madridMidday(now);

  // Get today's sent count and add to capacity tracking
  const todayStr = getMadridDateString();
  const sentToday = await getSentCountForDate(tenantId, todayStr);
  scheduledCounts.set(todayStr, (scheduledCounts.get(todayStr) || 0) + sentToday);

  // Holidays for the whole horizon. Resolved once: the queue can run a year out, and the
  // tenant may override the national calendar.
  const startYear = Number(getMadridDateString(effectiveStart).slice(0, 4));
  const holidays = await resolveHolidays(tenantId, [startYear, startYear + 1, startYear + 2]);

  // Generate enough business days (worst case: all emails on separate days).
  // The horizon grows on demand below, so an underestimate here is harmless.
  const daysNeeded = Math.ceil(emails.length / Math.max(dailyLimit, 1)) + 5;
  const businessDays = getNextBusinessDays(effectiveStart, daysNeeded, holidays);

  const schedule = new Map<string, Date>();
  const distribution: Record<string, number> = {};
  const unassigned: string[] = [];

  // Remaining capacity per day, ALWAYS seeded from what the tenant already has
  // scheduled that day (other campaigns included). Reading it lazily is what keeps
  // days appended later in the loop from starting at a phantom zero — the bug that
  // let sibling campaigns stack past the warmup limit on the same day.
  const dayCapacity = new Map<string, number>();
  const capacityOf = (dateStr: string): number => {
    if (!dayCapacity.has(dateStr)) dayCapacity.set(dateStr, scheduledCounts.get(dateStr) || 0);
    return dayCapacity.get(dateStr)!;
  };

  // Safety stop: ~1 business year. Beyond this the queue is pathological and we
  // report the leftovers instead of scheduling them years out.
  const MAX_BUSINESS_DAYS = 260;
  const HORIZON_CHUNK = 20;

  /** Claim the first business day at or after `earliestStr` that still has capacity. */
  const claimSlot = (earliestStr: string): { day: Date; dateStr: string } | null => {
    for (let i = 0; ; i++) {
      if (i >= businessDays.length) {
        if (businessDays.length >= MAX_BUSINESS_DAYS) return null;
        businessDays.push(...getNextBusinessDays(addOneDay(businessDays[businessDays.length - 1]), HORIZON_CHUNK, holidays));
      }
      const day = businessDays[i];
      const dateStr = getMadridDateString(day);
      if (dateStr < earliestStr) continue;
      if (capacityOf(dateStr) < dailyLimit) {
        dayCapacity.set(dateStr, capacityOf(dateStr) + 1);
        distribution[dateStr] = (distribution[dateStr] || 0) + 1;
        return { day, dateStr };
      }
    }
  };

  /** Give a claimed day back, so an abandoned sequence doesn't leak capacity. */
  const releaseSlot = (dateStr: string): void => {
    dayCapacity.set(dateStr, Math.max(0, capacityOf(dateStr) - 1));
    if (distribution[dateStr]) {
      distribution[dateStr] -= 1;
      if (distribution[dateStr] === 0) delete distribution[dateStr];
    }
  };

  // Group into sequences. Emails without sequence identity become singletons, which
  // reproduces the pre-existing per-email behavior exactly.
  type Item = (typeof emails)[number];
  const groups = new Map<string, Item[]>();
  emails.forEach((e, idx) => {
    const key = e.prospectId
      ? (e.campaignId ? `${e.campaignId}::${e.prospectId}` : e.prospectId)
      : `__solo::${idx}::${e.id}`;
    const g = groups.get(key);
    if (g) g.push(e); else groups.set(key, [e]);
  });

  const floorOf = (delayDays: number): string => {
    let d = new Date(effectiveStart);
    for (let i = 0; i < Math.max(0, delayDays); i++) d = addOneDay(d);
    return getMadridDateString(d);
  };

  // Deterministic order: earliest anchor first, then key. Without this the output depends on
  // the SQL row order, which none of the callers pin down.
  const ordered = [...groups.entries()]
    .map(([key, items]) => {
      const steps = items.slice().sort((a, b) => (a.stepNumber ?? 0) - (b.stepNumber ?? 0));
      return { key, steps, anchorFloor: floorOf(steps[0].delayDays || 0) };
    })
    .sort((a, b) => (a.anchorFloor < b.anchorFloor ? -1 : a.anchorFloor > b.anchorFloor ? 1 : a.key < b.key ? -1 : 1));

  for (const { key, steps } of ordered) {
    const claimed: Array<{ email: Item; day: Date; dateStr: string }> = [];
    let failed = false;
    const siblings = existingSteps?.get(key) ?? [];

    for (let k = 0; k < steps.length; k++) {
      const email = steps[k];
      let earliestStr: string;
      if (k === 0) {
        earliestStr = floorOf(email.delayDays || 0);
      } else {
        // Cadence is relative to where the PREVIOUS step actually landed, not to the global
        // start — and never on the same day, so the order is strict.
        const gap = Math.max(1, (email.delayDays || 0) - (steps[k - 1].delayDays || 0));
        let d = claimed[k - 1].day;
        for (let i = 0; i < gap; i++) d = addOneDay(d);
        earliestStr = getMadridDateString(d);
      }

      // Bounds from siblings that are already scheduled/sent outside this call.
      const step = email.stepNumber ?? 0;
      let ceiling: string | null = null;
      for (const s of siblings) {
        const sDay = getMadridDateString(s.scheduledFor);
        if (s.stepNumber < step) {
          const after = getMadridDateString(addOneDay(s.scheduledFor));
          if (after > earliestStr) earliestStr = after;
        } else if (s.stepNumber > step) {
          if (ceiling === null || sDay < ceiling) ceiling = sDay;
        }
      }

      const slot = claimSlot(earliestStr);
      // Landing on or after a later step's date would invert the sequence just as badly as
      // the original bug. Better to leave it unscheduled and report it.
      if (!slot || (ceiling !== null && slot.dateStr >= ceiling)) {
        if (slot) releaseSlot(slot.dateStr);
        failed = true;
        break;
      }
      claimed.push({ email, day: slot.day, dateStr: slot.dateStr });
    }

    if (failed) {
      // Half a sequence — an intro and a sign-off with no follow-up — is worse than none.
      claimed.forEach((c) => releaseSlot(c.dateStr));
      steps.forEach((e) => unassigned.push(e.id));
      logger.warn('No capacity within horizon, sequence left unscheduled', {
        tenantId, emailIds: steps.map((e) => e.id), horizonDays: MAX_BUSINESS_DAYS, dailyLimit,
      });
      continue;
    }

    for (const { email, day } of claimed) {
      // Seed at OPTIMAL_START_HOUR in prospect's local time (converted to UTC).
      // E.g., Spain CEST (UTC+2): 9 AM local = 7 AM UTC seed.
      // This ensures calculateOptimalSendTime finds the candidate within window.
      const candidateUtc = new Date(day);
      const tz = email.prospectTimezone || 'Europe/Madrid';
      const tzOffset = getTimezoneOffsetHours(tz, candidateUtc);
      candidateUtc.setUTCHours(Math.round(OPTIMAL_START_HOUR - tzOffset), 0, 0, 0);
      schedule.set(email.id, calculateOptimalSendTime(candidateUtc, tz));
    }
  }

  // dayTotals = distribution of THIS call + what the tenant already had that day,
  // so callers can show/log real per-day occupancy instead of just their own slice.
  const dayTotals: Record<string, number> = {};
  for (const dateStr of Object.keys(distribution)) {
    dayTotals[dateStr] = dayCapacity.get(dateStr) ?? distribution[dateStr];
  }

  return { schedule, distribution, dayTotals, unassigned, dailyLimit };
}
