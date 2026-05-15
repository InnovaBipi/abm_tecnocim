const isDev = process.env.NODE_ENV !== 'production';

/** Keys that must never appear in log metadata */
const SENSITIVE_KEYS = new Set([
  'password', 'token', 'secret', 'api_key', 'apiKey',
  'resend_api_key', 'imap_password', 'authorization',
]);

/**
 * Recursively redact sensitive values from a metadata object.
 * Returns a shallow clone with sensitive values replaced by '[REDACTED]'.
 */
function sanitize(meta: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      clean[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      clean[key] = sanitize(value as Record<string, unknown>);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function formatMessage(level: string, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ' ' + JSON.stringify(sanitize(meta)) : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>): void {
    console.log(formatMessage('info', message, meta));
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(formatMessage('warn', message, meta));
  },
  error(message: string, meta?: Record<string, unknown>): void {
    console.error(formatMessage('error', message, meta));
  },
  debug(message: string, meta?: Record<string, unknown>): void {
    if (isDev) {
      console.log(formatMessage('debug', message, meta));
    }
  },
};
