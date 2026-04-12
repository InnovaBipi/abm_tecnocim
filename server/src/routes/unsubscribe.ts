import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { config } from '../config/env';
import { getTenantConfig, type Tenant } from '../middleware/tenant';

const router = Router();

/**
 * Generate an unsubscribe token for an email address (includes tenantId for scoping).
 * Uses HMAC-SHA256 so tokens can't be forged without the JWT_SECRET.
 */
export function generateUnsubscribeToken(email: string, tenantId?: string): string {
  const data = tenantId ? `${email.toLowerCase()}:${tenantId}` : email.toLowerCase();
  return crypto
    .createHmac('sha256', config.JWT_SECRET)
    .update(data)
    .digest('hex');
}

/**
 * Verify an unsubscribe token against an email and tenant.
 */
function verifyUnsubscribeToken(email: string, token: string, tenantId?: string): boolean {
  const expected = generateUnsubscribeToken(email, tenantId);
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Build the unsubscribe URL for an email (with tenant context).
 */
export function getUnsubscribeUrl(email: string, tenantId?: string): string {
  const token = generateUnsubscribeToken(email, tenantId);
  const baseUrl = config.NODE_ENV === 'production'
    ? config.FRONTEND_URL
    : `http://localhost:${config.PORT}`;
  const tenantParam = tenantId ? `&tid=${encodeURIComponent(tenantId)}` : '';
  return `${baseUrl}/api/unsubscribe?email=${encodeURIComponent(email)}&token=${token}${tenantParam}`;
}

/**
 * Build the compliance footer for all outgoing emails.
 * Uses tenant branding if provided.
 */
export function getEmailFooter(recipientEmail: string, tenantId?: string, tenant?: Tenant | null): string {
  const unsubscribeUrl = getUnsubscribeUrl(recipientEmail, tenantId);
  const companyName = tenant?.name || 'ABM Platform';
  const footerHtml = tenant?.config?.branding?.footer_html || `<p>${companyName}</p>`;

  return `
<div style="margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;line-height:1.5;">
  ${footerHtml}
  <p style="margin:4px 0 0 0;">
    <a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>
  </p>
</div>`;
}

/**
 * GET /api/unsubscribe?email=...&token=...
 *
 * Public endpoint - no auth required.
 * Shows a confirmation page and processes the unsubscribe.
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const email = req.query.email as string;
    const token = req.query.token as string;
    const tenantId = req.query.tid as string || undefined;

    if (!email || !token) {
      res.status(400).send(unsubscribePage('Error', 'Invalid link.'));
      return;
    }

    // Verify token (with tenant context if present)
    if (!verifyUnsubscribeToken(email, token, tenantId)) {
      // Fallback: try without tenant for backwards compatibility with old links
      if (tenantId || !verifyUnsubscribeToken(email, token)) {
        res.status(403).send(unsubscribePage('Error', 'Invalid or expired link.'));
        return;
      }
    }

    // Resolve tenant: from URL param or from prospect record
    let resolvedTenantId = tenantId;
    if (!resolvedTenantId) {
      const prospectForTenant = await query<any[]>(
        'SELECT tenant_id FROM prospects WHERE email = ? LIMIT 1',
        [email.toLowerCase()]
      );
      if (prospectForTenant.length > 0) {
        resolvedTenantId = prospectForTenant[0].tenant_id;
      }
    }

    // Get tenant for branding
    const tenant = resolvedTenantId ? await getTenantConfig(resolvedTenantId) : null;

    // Add to suppression list (per-tenant)
    if (resolvedTenantId) {
      await query(
        `INSERT IGNORE INTO suppression_list (id, tenant_id, email, reason, source)
         VALUES (?, ?, ?, 'unsubscribed', 'unsubscribe_link')`,
        [uuidv4(), resolvedTenantId, email.toLowerCase()]
      );
    }

    // Update prospect (scoped to tenant if known)
    if (resolvedTenantId) {
      await query(
        `UPDATE prospects SET do_not_contact = TRUE, status = 'unsubscribed'
         WHERE email = ? AND tenant_id = ?`,
        [email.toLowerCase(), resolvedTenantId]
      );
    } else {
      await query(
        `UPDATE prospects SET do_not_contact = TRUE, status = 'unsubscribed'
         WHERE email = ?`,
        [email.toLowerCase()]
      );
    }

    // Stop all active enrollments
    const prospects = await query<any[]>(
      resolvedTenantId
        ? 'SELECT id FROM prospects WHERE email = ? AND tenant_id = ?'
        : 'SELECT id FROM prospects WHERE email = ?',
      resolvedTenantId ? [email.toLowerCase(), resolvedTenantId] : [email.toLowerCase()]
    );

    if (prospects.length > 0) {
      await query(
        `UPDATE sequence_enrollments SET status = 'unsubscribed', completed_at = NOW()
         WHERE prospect_id = ? AND status IN ('active', 'paused')`,
        [prospects[0].id]
      );

      await query(
        `INSERT INTO prospect_activities (id, prospect_id, activity_type, title, description)
         VALUES (?, ?, 'unsubscribed', 'Unsubscribed', 'Prospect unsubscribed via link.')`,
        [uuidv4(), prospects[0].id]
      );
    }

    const companyName = tenant?.name || 'our platform';
    res.status(200).send(unsubscribePage(
      'Unsubscribed',
      `The address <strong>${email}</strong> has been removed from our mailing lists. You will no longer receive commercial emails from ${companyName}.`
    ));
  } catch (error: any) {
    console.error('Unsubscribe error:', error.message);
    res.status(500).send(unsubscribePage('Error', 'An error occurred. Please contact support.'));
  }
});

/**
 * Simple HTML page for unsubscribe confirmation.
 */
function unsubscribePage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="ca">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Tecnocim</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f9fafb; color: #374151; }
    .card { background: white; border-radius: 12px; padding: 40px; max-width: 480px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; }
    h1 { font-size: 24px; margin-bottom: 16px; color: #1e40af; }
    p { font-size: 16px; line-height: 1.6; color: #6b7280; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export default router;
