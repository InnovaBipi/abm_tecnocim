import { query } from '../config/database';
import { getTenantConfig } from '../middleware/tenant';
import { logger } from '../config/logger';
import type { TenantAIContext } from './ai';

/**
 * Per-campaign sender resolution.
 *
 * Send-time cascade (two levels, deterministic):
 *   campaign.sender_user_id -> users.sender_email/sender_name -> tenant config.
 *
 * The campaign anchor (not approved_by) decides identity: whoever approves an
 * email must never change whose name it goes out under.
 */

export interface ResolvedSender {
  fromAddress: string;          // "Name <email>"
  replyTo: string | undefined;
  senderName: string;
  senderEmail: string;
  source: 'user' | 'tenant';
}

export function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

/**
 * Resolve the effective sender for a campaign's emails.
 * Falls back to tenant config when senderUserId is null, the user is gone or
 * inactive, has no sender_email, or the sender domain doesn't match the
 * tenant's verified sending domain (Resend would reject -> bounced).
 */
export async function resolveSender(
  tenantId: string,
  senderUserId: string | null | undefined
): Promise<ResolvedSender> {
  const tenant = await getTenantConfig(tenantId);
  const tenantEmail = tenant?.config?.email;
  const tenantFrom = tenantEmail?.from_email || 'noreply@example.com';
  const tenantName = tenantEmail?.from_name || tenant?.name || 'Tecnocim Innova';
  const fallback: ResolvedSender = {
    fromAddress: `${tenantName} <${tenantFrom}>`,
    replyTo: tenantEmail?.reply_to || undefined,
    senderName: tenantName,
    senderEmail: tenantFrom,
    source: 'tenant',
  };

  if (!senderUserId) return fallback;

  const rows = await query<any[]>(
    `SELECT sender_email, sender_name, first_name, last_name
     FROM users WHERE id = ? AND tenant_id = ? AND is_active = TRUE LIMIT 1`,
    [senderUserId, tenantId]
  );
  if (rows.length === 0 || !rows[0].sender_email) {
    logger.warn('Campaign sender unresolved, falling back to tenant sender', {
      tenantId, senderUserId,
    });
    return fallback;
  }

  // Defense in depth besides the settings-time validation: never hand Resend
  // a From it can't sign (unverified domain), which would surface as a bounce.
  if (domainOf(rows[0].sender_email) !== domainOf(tenantFrom)) {
    logger.warn('Campaign sender domain mismatch, falling back to tenant sender', {
      tenantId, senderUserId, senderEmail: rows[0].sender_email, tenantFrom,
    });
    return fallback;
  }

  const name = rows[0].sender_name
    || `${rows[0].first_name || ''} ${rows[0].last_name || ''}`.trim()
    || tenantName;
  return {
    fromAddress: `${name} <${rows[0].sender_email}>`,
    replyTo: rows[0].sender_email,
    senderName: name,
    senderEmail: rows[0].sender_email,
    source: 'user',
  };
}

/**
 * Validate that a user's sender_email belongs to the tenant's verified sending
 * domain. Throws with a user-facing message (route handlers return it as 400).
 */
export async function assertSenderDomainAllowed(tenantId: string, senderEmail: string): Promise<void> {
  const tenant = await getTenantConfig(tenantId);
  const tenantFrom = tenant?.config?.email?.from_email;
  if (!tenantFrom) return; // tenant has no sending config yet: nothing to enforce against
  const allowed = domainOf(tenantFrom);
  if (domainOf(senderEmail) !== allowed) {
    throw new Error(`sender_email debe pertenecer al dominio verificado @${allowed}`);
  }
}

/**
 * When the campaign has an assigned sender, override the AI context so the
 * generated body is signed by that person (otherwise the tenant-level
 * ai.sender_name would produce a From/signature mismatch).
 */
export async function applyCampaignSenderToAIContext(
  aiCtx: TenantAIContext,
  tenantId: string,
  senderUserId: string | null | undefined
): Promise<TenantAIContext> {
  if (!senderUserId) return aiCtx;
  const sender = await resolveSender(tenantId, senderUserId);
  if (sender.source !== 'user') return aiCtx;
  return { ...aiCtx, sender_name: sender.senderName, contact_email: sender.senderEmail };
}
