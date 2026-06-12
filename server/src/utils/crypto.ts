import crypto from 'crypto';

/**
 * Per-tenant secret encryption at rest (AES-256-GCM).
 *
 * BACKWARD-COMPATIBILITY CONTRACT:
 * - Without process.env.SECRETS_ENCRYPTION_KEY, everything is a no-op:
 *   encryptSecret() returns the plaintext unchanged, so existing plaintext
 *   secrets keep working and nothing new gets encrypted.
 * - With the key set, encryptSecret() produces a self-describing string
 *   prefixed with 'enc:v1:'. decryptSecret() tolerates BOTH encrypted values
 *   (prefixed) and legacy plaintext (no prefix), so a mixed DB is fine.
 *
 * No migration is needed: encryption only happens when settings are rewritten.
 */

const ENC_PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard nonce length
const TAG_LENGTH = 16;

/** Derive a 32-byte key from the env var via SHA-256 (guarantees correct length). */
function getKey(): Buffer | null {
  const raw = process.env.SECRETS_ENCRYPTION_KEY;
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

/**
 * Returns true if the value looks like an encrypted secret produced by encryptSecret().
 */
export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

/**
 * Encrypt a plaintext secret for storage at rest.
 * No-op (returns the input unchanged) when SECRETS_ENCRYPTION_KEY is not set.
 * Already-encrypted values are returned as-is (idempotent).
 */
export function encryptSecret(plain: string): string {
  if (!plain) return plain;
  if (isEncrypted(plain)) return plain;

  const key = getKey();
  if (!key) return plain; // No-op: encryption disabled

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Layout: iv | tag | ciphertext, base64-encoded
  const packed = Buffer.concat([iv, tag, ciphertext]).toString('base64');
  return ENC_PREFIX + packed;
}

/**
 * Decrypt a secret read from storage.
 * - Falsy input -> ''
 * - Legacy plaintext (no 'enc:v1:' prefix) -> returned unchanged
 * - Encrypted value -> decrypted (requires SECRETS_ENCRYPTION_KEY; throws a
 *   clear error if the key is missing or the payload is malformed).
 */
export function decryptSecret(value: string): string {
  if (!value) return '';
  if (!isEncrypted(value)) return value; // Legacy plaintext, pass through

  const key = getKey();
  if (!key) {
    throw new Error(
      'Cannot decrypt secret: SECRETS_ENCRYPTION_KEY is not set but an encrypted value was found.'
    );
  }

  const packed = Buffer.from(value.slice(ENC_PREFIX.length), 'base64');
  if (packed.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Cannot decrypt secret: malformed encrypted payload.');
  }

  const iv = packed.subarray(0, IV_LENGTH);
  const tag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}
