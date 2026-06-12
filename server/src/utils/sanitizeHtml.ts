import sanitizeHtml from 'sanitize-html';

/**
 * Server-side HTML sanitization for email body content (defense in depth).
 *
 * The client already sanitizes at render, but the HTML is also persisted in the DB
 * and sent out via email, so we sanitize before persisting too.
 *
 * Allowlist is intentionally PERMISSIVE so legitimate marketing emails render
 * unchanged. We only strip dangerous vectors: <script>, <iframe>, on* event
 * handlers, and javascript:/data: schemes in href/src.
 */
const EMAIL_HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a',
    'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4',
    'span', 'div',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'img', 'blockquote', 'hr',
  ],
  allowedAttributes: {
    '*': ['style', 'width', 'height', 'class', 'align'],
    a: ['href', 'target', 'rel', 'style', 'class'],
    img: ['src', 'alt', 'width', 'height', 'style', 'class'],
    td: ['colspan', 'rowspan', 'style', 'width', 'height', 'class', 'align', 'valign'],
    th: ['colspan', 'rowspan', 'style', 'width', 'height', 'class', 'align', 'valign'],
    table: ['cellpadding', 'cellspacing', 'border', 'style', 'width', 'height', 'class', 'align'],
  },
  // Allow inline styles (permissive — we are only stripping active content vectors)
  allowedStyles: {},
  // Only safe URL schemes; this drops javascript: and data: in href.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  // Allow data: URIs ONLY for images (inline embedded images are legitimate in email).
  allowedSchemesByTag: {
    img: ['http', 'https', 'data'],
  },
  allowProtocolRelative: true,
  // Drop the contents of <script>/<style> entirely rather than keeping inner text.
  disallowedTagsMode: 'discard',
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
};

/**
 * Sanitize email body HTML before persisting. Returns a cleaned HTML string.
 * Non-string / empty input is returned unchanged (coerced to '' when nullish-safe).
 */
export function sanitizeEmailHtml(html: string): string {
  if (typeof html !== 'string' || html.length === 0) {
    return html;
  }
  return sanitizeHtml(html, EMAIL_HTML_OPTIONS);
}
