import { config } from '../config/env';

/**
 * Reject URLs that point at internal/private network resources (SSRF guard).
 * The target host comes from user-controlled prospect/company domains, so it must
 * never be allowed to reach localhost, link-local metadata, or private ranges.
 * Throws on an unsafe URL; returns the normalized URL string otherwise.
 */
export function assertPublicUrl(rawUrl: string): string {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Blocked non-http(s) URL scheme: ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase();
  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '169.254.169.254', 'metadata.google.internal'];
  if (blockedHosts.includes(host)) {
    throw new Error(`Blocked internal host: ${host}`);
  }
  // Block private / reserved IPv4 ranges and any raw IP that resolves to them.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
    if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)) {
      throw new Error(`Blocked private IP: ${host}`);
    }
  }
  // Block obvious internal-only hostnames (no public TLD).
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error(`Blocked non-public host: ${host}`);
  }
  return u.toString();
}

/**
 * Scrape a URL using the Firecrawl API and return markdown content.
 * Firecrawl handles JavaScript rendering, anti-bot measures, etc.
 */
export async function scrapeUrl(url: string): Promise<string> {
  assertPublicUrl(url);
  if (!config.FIRECRAWL_API_KEY) {
    throw new Error('FIRECRAWL_API_KEY is not configured. Cannot scrape URLs.');
  }

  const apiUrl = 'https://api.firecrawl.dev/v1/scrape';

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
      waitFor: 3000,
      timeout: 30000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Firecrawl API error (${response.status}): ${errorText}`);
  }

  const data: any = await response.json();

  if (!data.success) {
    throw new Error(`Firecrawl scrape failed: ${data.error || 'Unknown error'}`);
  }

  return data.data?.markdown || data.data?.content || '';
}

/**
 * Scrape a company's homepage and extract key business information.
 * @param domain - The company domain (e.g., "example.com")
 * @returns Markdown content from the company website
 */
export async function scrapeCompanyWebsite(domain: string): Promise<string> {
  // Ensure the domain has a protocol
  let url = domain;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }

  try {
    // Try HTTPS first
    const content = await scrapeUrl(url);
    return content;
  } catch (error: any) {
    // If HTTPS fails, try HTTP
    if (url.startsWith('https://')) {
      try {
        const httpUrl = url.replace('https://', 'http://');
        const content = await scrapeUrl(httpUrl);
        return content;
      } catch {
        // Both failed, throw the original error
        throw error;
      }
    }
    throw error;
  }
}

/**
 * Basic URL scrape without Firecrawl (fallback using native fetch).
 * Only works on simple pages without JavaScript rendering requirements.
 */
export async function basicScrape(url: string): Promise<string> {
  assertPublicUrl(url);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TecnocimBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    // Very basic HTML to text extraction
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')   // Remove scripts
      .replace(/<style[\s\S]*?<\/style>/gi, '')     // Remove styles
      .replace(/<[^>]+>/g, ' ')                      // Remove HTML tags
      .replace(/\s+/g, ' ')                          // Normalize whitespace
      .trim();

    return text.substring(0, 10000); // Limit to 10K chars
  } catch (error: any) {
    throw new Error(`Basic scrape failed for ${url}: ${error.message}`);
  }
}
