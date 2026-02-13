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

/**
 * Resolve the preferred email language for a prospect based on their location.
 *
 * Rules:
 * - Region is Catalunya (or city is in Catalonia) → 'catalan'
 * - Country is Spain (or other Spanish-speaking) → 'spanish'
 * - Everything else → 'english'
 */
export function resolveProspectLanguage(prospect: {
  region?: string;
  country?: string;
  city?: string;
}): ProspectLanguage {
  const region = (prospect.region || '').toLowerCase().trim();
  const country = (prospect.country || '').toLowerCase().trim();
  const city = (prospect.city || '').toLowerCase().trim();

  // 1. Check if region is Catalan-speaking
  if (CATALAN_REGIONS.some(r => region.includes(r))) {
    return 'catalan';
  }

  // 2. Check if city is in Catalonia
  if (CATALAN_CITIES.some(c => city.includes(c) || city === c)) {
    return 'catalan';
  }

  // 3. Check if country is Spanish-speaking
  if (SPANISH_COUNTRIES.some(c => country === c || country.includes(c))) {
    return 'spanish';
  }

  // 4. Default: English
  return 'english';
}
