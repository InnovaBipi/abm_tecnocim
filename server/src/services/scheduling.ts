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

/**
 * Check if a date falls on a business day (Mon-Fri) in Europe/Madrid timezone.
 */
export function isBusinessDay(date: Date): boolean {
  const madridDate = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  const dow = madridDate.getDay();
  return dow >= 1 && dow <= 5;
}

/**
 * Get the next business day (Mon-Fri) from a given date.
 * If the given date IS a business day, returns a copy of the same date.
 * If on weekend, advances to next Monday.
 */
export function getNextBusinessDay(date: Date): Date {
  const result = new Date(date);
  let madridDate = new Date(result.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  let dow = madridDate.getDay();

  while (dow === 0 || dow === 6) {
    result.setDate(result.getDate() + 1);
    madridDate = new Date(result.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
    dow = madridDate.getDay();
  }

  return result;
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
  }
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

  // Is the current day allowed?
  const isDayAllowed = allowedDays.includes(localDay);

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
  let nextDay = (localDay + 1) % 7;

  while (!allowedDays.includes(nextDay) && daysToAdd < 8) {
    daysToAdd++;
    nextDay = (localDay + daysToAdd) % 7;
  }

  // Set to next allowed day at optimal start_hour
  localDate.setUTCDate(localDate.getUTCDate() + daysToAdd);
  localDate.setUTCHours(startHour, optimalMinute, 0, 0);

  // Convert back to UTC
  const resultUtc = new Date(localDate.getTime() - (offsetHours * 60 * 60 * 1000));

  return resultUtc;
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
  }
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
  const d = date
    ? new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Madrid' }))
    : new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
export function getNextBusinessDays(startDate: Date, count: number): Date[] {
  const days: Date[] = [];
  const d = new Date(startDate);
  while (days.length < count) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) {
      days.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
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
 */
export async function distributeEmailsAcrossBusinessDays(
  emails: Array<{ id: string; prospectTimezone: string; delayDays: number }>,
  tenantId: string,
  excludeIds?: string[],
  startDate?: Date
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
  let effectiveStart = now;
  if (startDate && startDate.getTime() > now.getTime()) {
    effectiveStart = new Date(startDate);
    // Anchor at local midday: business days inherit this time-of-day, and the
    // optimal-send seed (setUTCHours) must not roll the UTC date back a day
    // for a midnight-local start in timezones ahead of UTC.
    effectiveStart.setHours(12, 0, 0, 0);
  }

  // Get today's sent count and add to capacity tracking
  const todayStr = getMadridDateString();
  const sentToday = await getSentCountForDate(tenantId, todayStr);
  scheduledCounts.set(todayStr, (scheduledCounts.get(todayStr) || 0) + sentToday);

  // Generate enough business days (worst case: all emails on separate days).
  // The horizon grows on demand below, so an underestimate here is harmless.
  const daysNeeded = Math.ceil(emails.length / Math.max(dailyLimit, 1)) + 5;
  const businessDays = getNextBusinessDays(effectiveStart, daysNeeded);

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

  for (const email of emails) {
    // Determine earliest allowed date based on delay_days
    const earliestDate = new Date(effectiveStart);
    if (email.delayDays > 0) {
      earliestDate.setDate(earliestDate.getDate() + email.delayDays);
    }
    const earliestStr = getMadridDateString(earliestDate);

    // Find the first business day at or after earliestStr with free capacity,
    // extending the horizon as needed.
    let assignedDay: Date | null = null;
    for (let i = 0; assignedDay === null; i++) {
      if (i >= businessDays.length) {
        if (businessDays.length >= MAX_BUSINESS_DAYS) break;
        const lastDay = businessDays[businessDays.length - 1];
        businessDays.push(
          ...getNextBusinessDays(new Date(lastDay.getTime() + 24 * 60 * 60 * 1000), HORIZON_CHUNK)
        );
      }
      const day = businessDays[i];
      const dateStr = getMadridDateString(day);
      if (dateStr < earliestStr) continue;

      if (capacityOf(dateStr) < dailyLimit) {
        assignedDay = day;
        dayCapacity.set(dateStr, capacityOf(dateStr) + 1);
        distribution[dateStr] = (distribution[dateStr] || 0) + 1;
      }
    }

    if (!assignedDay) {
      unassigned.push(email.id);
      logger.warn('No capacity within horizon, email left unscheduled', {
        tenantId, emailId: email.id, horizonDays: MAX_BUSINESS_DAYS, dailyLimit,
      });
    }

    if (assignedDay) {
      // Seed at OPTIMAL_START_HOUR in prospect's local time (converted to UTC).
      // E.g., Spain CEST (UTC+2): 9 AM local = 7 AM UTC seed.
      // This ensures calculateOptimalSendTime finds the candidate within window.
      const candidateUtc = new Date(assignedDay);
      const tz = email.prospectTimezone || 'Europe/Madrid';
      const tzOffset = getTimezoneOffsetHours(tz, candidateUtc);
      candidateUtc.setUTCHours(Math.round(OPTIMAL_START_HOUR - tzOffset), 0, 0, 0);
      const optimalTime = calculateOptimalSendTime(candidateUtc, tz);
      schedule.set(email.id, optimalTime);
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
