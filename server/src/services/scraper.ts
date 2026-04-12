import { config } from '../config/env';

/**
 * Scrape a URL using the Firecrawl API and return markdown content.
 * Firecrawl handles JavaScript rendering, anti-bot measures, etc.
 */
export async function scrapeUrl(url: string): Promise<string> {
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
