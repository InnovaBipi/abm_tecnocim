import DOMPurify from 'dompurify';

/**
 * Sanitize HTML before rendering it with `dangerouslySetInnerHTML`.
 *
 * Use this for ANY HTML that originates from a user, the AI generator, or tenant
 * configuration (email bodies, previews, footers). DOMPurify's safe defaults strip
 * <script>, inline event handlers (onerror, onclick, ...) and `javascript:` URIs
 * while preserving the formatting/styles/images that marketing emails rely on.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  return DOMPurify.sanitize(html);
}

/**
 * Return a URL safe to use in an `href`/`src`, or '#' if it is not a plain
 * http(s) URL. Blocks `javascript:`, `data:`, and other dangerous schemes that
 * would otherwise execute when a user clicks a link built from stored data.
 */
export function safeExternalUrl(url: string | null | undefined): string {
  if (!url) return '#';
  try {
    const u = new URL(url, window.location.origin);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '#';
  } catch {
    return '#';
  }
}
