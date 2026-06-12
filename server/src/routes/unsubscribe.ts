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
 * Uses tenant branding + legal config.
 *
 * RGPD Art. 14: data source, controller identity, rights, legal basis
 * LSSI Art. 20: sender identification, commercial nature
 * LSSI Art. 21: unsubscribe mechanism
 */
export function getEmailFooter(
  recipientEmail: string,
  tenantId?: string,
  tenant?: Tenant | null,
  language?: 'spanish' | 'catalan' | 'english'
): string {
  const unsubscribeUrl = getUnsubscribeUrl(recipientEmail, tenantId);
  const companyName = tenant?.name || 'Tecnocim Innova';
  const footerHtml = tenant?.config?.branding?.footer_html || `<p>${companyName}</p>`;
  const legal = tenant?.config?.legal;
  const legalName = legal?.legal_name || companyName;
  const cif = legal?.cif || '';
  const address = legal?.address || '';
  const privacyUrl = legal?.privacy_url || '';
  const contactEmail = tenant?.config?.email?.reply_to || tenant?.config?.email?.from_email || '';

  const isEn = language === 'english';

  // Controller identity line (LSSI Art. 20 + RGPD Art. 14)
  const identityParts = [legalName];
  if (cif) identityParts.push(`${isEn ? 'Tax ID' : 'CIF'} ${cif}`);
  if (address) identityParts.push(address);
  const identityLine = identityParts.join(' | ');

  // Privacy policy link
  const dataSource = legal?.data_source || (isEn ? 'their corporate website' : 'su página web corporativa');
  const privacyLink = privacyUrl
    ? ` <a href="${privacyUrl}" style="color:#b0b0b0;text-decoration:underline;">${isEn ? 'Privacy policy' : 'Política de privacidad'}</a>.`
    : '';

  // RGPD/LSSI compliance disclaimer (default Spanish; English when language === 'english')
  const spanishDisclaimer = `<p style="margin:8px 0 0 0;font-size:10px;color:#b0b0b0;line-height:1.4;">
    ${identityLine}<br/>
    Este correo se dirige a la dirección de contacto público de su empresa, obtenida de fuentes de acceso público (${dataSource}), con base en interés legítimo (Art. 6.1.f RGPD).
    Puede ejercer sus derechos de acceso, rectificación, supresión y oposición contactando a <a href="mailto:${contactEmail}" style="color:#b0b0b0;">${contactEmail}</a> o usando el enlace inferior.${privacyLink}
  </p>`;
  const englishDisclaimer = `<p style="margin:8px 0 0 0;font-size:10px;color:#b0b0b0;line-height:1.4;">
    ${identityLine}<br/>
    This email is addressed to your company's public business contact, obtained from publicly available sources (${dataSource}), on the basis of legitimate interest (Art. 6.1.f GDPR).
    You may exercise your rights of access, rectification, erasure and objection by contacting <a href="mailto:${contactEmail}" style="color:#b0b0b0;">${contactEmail}</a> or using the link below.${privacyLink}
  </p>`;
  const rgpdDisclaimer = isEn ? englishDisclaimer : spanishDisclaimer;

  return `
<div style="margin-top:32px;font-size:12px;color:#9ca3af;line-height:1.5;">
  ${footerHtml}
  ${rgpdDisclaimer}
  <p style="margin:8px 0 0 0;">
    <a href="${unsubscribeUrl}" style="color:#9ca3af;text-decoration:none;font-size:11px;">${isEn ? 'Unsubscribe' : 'Darse de baja'}</a>
  </p>
</div>`;
}

/**
 * Resolve an email+token to a tenant and verify the token.
 * Returns the resolved tenant id (or null if no tenant could be resolved)
 * when the token is valid, or `false` when the token is invalid.
 */
async function resolveAndVerify(
  email: string,
  token: string,
  tenantId?: string
): Promise<{ resolvedTenantId: string | null } | false> {
  // Verify token (with tenant context if present)
  if (!verifyUnsubscribeToken(email, token, tenantId)) {
    // Fallback: try without tenant for backwards compatibility with old links
    if (tenantId || !verifyUnsubscribeToken(email, token)) {
      return false;
    }
  }

  // Resolve tenant: from URL param or from prospect record
  let resolvedTenantId: string | null = tenantId || null;
  if (!resolvedTenantId) {
    const prospectForTenant = await query<any[]>(
      'SELECT tenant_id FROM prospects WHERE email = ? LIMIT 1',
      [email.toLowerCase()]
    );
    if (prospectForTenant.length > 0) {
      resolvedTenantId = prospectForTenant[0].tenant_id;
    }
  }

  return { resolvedTenantId };
}

/**
 * Perform the actual unsubscribe: suppression list, prospect update, cancel enrollments.
 * Only executed on POST (after explicit user confirmation), never on GET.
 */
async function performUnsubscribe(email: string, resolvedTenantId: string | null): Promise<void> {
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

  // Stop all active enrollments.
  // Select the prospect together with its tenant_id so every downstream write
  // is tenant-scoped, even when resolvedTenantId was not supplied via the link.
  const prospects = await query<any[]>(
    resolvedTenantId
      ? 'SELECT id, tenant_id FROM prospects WHERE email = ? AND tenant_id = ?'
      : 'SELECT id, tenant_id FROM prospects WHERE email = ?',
    resolvedTenantId ? [email.toLowerCase(), resolvedTenantId] : [email.toLowerCase()]
  );

  if (prospects.length > 0) {
    await query(
      `UPDATE sequence_enrollments SET status = 'unsubscribed', completed_at = NOW()
       WHERE prospect_id = ? AND tenant_id = ? AND status IN ('active', 'paused')`,
      [prospects[0].id, prospects[0].tenant_id]
    );

    await query(
      `INSERT INTO prospect_activities (id, tenant_id, prospect_id, activity_type, title, description)
       VALUES (?, ?, ?, 'unsubscribed', 'Unsubscribed', 'Prospect unsubscribed via link.')`,
      [uuidv4(), prospects[0].tenant_id, prospects[0].id]
    );
  }
}

/**
 * GET /api/unsubscribe?email=...&token=...
 *
 * Public endpoint - no auth required.
 *
 * Shows a CONFIRMATION page (does NOT unsubscribe). This protects against
 * automated link scanners (Outlook SafeLinks, antivirus prefetch) that issue
 * GET requests and would otherwise unsubscribe recipients unintentionally.
 * The actual unsubscribe is performed by the POST handler below, triggered when
 * the user clicks the confirmation button. Existing links keep working: an old
 * GET link now lands on the confirmation page instead of unsubscribing directly.
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

    const verification = await resolveAndVerify(email, token, tenantId);
    if (verification === false) {
      res.status(403).send(unsubscribePage('Error', 'Invalid or expired link.'));
      return;
    }

    // Get tenant for branding
    const tenant = verification.resolvedTenantId
      ? await getTenantConfig(verification.resolvedTenantId)
      : null;
    const companyName = tenant?.name || 'Tecnocim Innova';

    // Render a confirmation page that POSTs back to this same endpoint.
    res.status(200).send(unsubscribeConfirmPage(email, token, tenantId, companyName));
  } catch (error: any) {
    console.error('Unsubscribe (GET) error:', error.message);
    res.status(500).send(unsubscribePage('Error', 'An error occurred. Please contact support.'));
  }
});

/**
 * POST /api/unsubscribe
 *
 * Public endpoint - no auth required.
 * Executes the real unsubscribe after the user confirms (clicks the button on
 * the GET confirmation page). Receives email + token (+ optional tid) as form fields.
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const email = (req.body?.email as string) || '';
    const token = (req.body?.token as string) || '';
    const tenantId = (req.body?.tid as string) || undefined;

    if (!email || !token) {
      res.status(400).send(unsubscribePage('Error', 'Invalid link.'));
      return;
    }

    const verification = await resolveAndVerify(email, token, tenantId);
    if (verification === false) {
      res.status(403).send(unsubscribePage('Error', 'Invalid or expired link.'));
      return;
    }

    const resolvedTenantId = verification.resolvedTenantId;
    await performUnsubscribe(email, resolvedTenantId);

    const tenant = resolvedTenantId ? await getTenantConfig(resolvedTenantId) : null;
    const companyName = tenant?.name || 'Tecnocim Innova';
    res.status(200).send(unsubscribePage(
      'Unsubscribed',
      `The address <strong>${escapeHtml(email)}</strong> has been removed from our mailing lists. You will no longer receive commercial emails from ${escapeHtml(companyName)}.`
    ));
  } catch (error: any) {
    console.error('Unsubscribe (POST) error:', error.message);
    res.status(500).send(unsubscribePage('Error', 'An error occurred. Please contact support.'));
  }
});

/**
 * Escape a string for safe interpolation into HTML attribute/text contexts.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Confirmation page shown on GET. Renders a form that POSTs back to the same
 * endpoint so that automated link scanners (which only issue GETs) never
 * trigger an unsubscribe. The user must click the button to confirm.
 */
function unsubscribeConfirmPage(
  email: string,
  token: string,
  tenantId: string | undefined,
  companyName: string
): string {
  const safeEmail = escapeHtml(email);
  const safeToken = escapeHtml(token);
  const safeCompany = escapeHtml(companyName);
  const tidField = tenantId
    ? `<input type="hidden" name="tid" value="${escapeHtml(tenantId)}">`
    : '';
  return `<!DOCTYPE html>
<html lang="ca">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Confirm unsubscribe - ${safeCompany}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f9fafb; color: #374151; }
    .card { background: white; border-radius: 12px; padding: 40px; max-width: 480px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; }
    h1 { font-size: 24px; margin-bottom: 16px; color: #1e40af; }
    p { font-size: 16px; line-height: 1.6; color: #6b7280; }
    button { margin-top: 24px; background: #1e40af; color: white; border: none; border-radius: 8px; padding: 12px 28px; font-size: 16px; cursor: pointer; }
    button:hover { background: #1e3a8a; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Confirm unsubscribe</h1>
    <p>Please confirm that you want to remove <strong>${safeEmail}</strong> from the mailing lists of ${safeCompany}. You will no longer receive commercial emails.</p>
    <form method="POST" action="/api/unsubscribe">
      <input type="hidden" name="email" value="${safeEmail}">
      <input type="hidden" name="token" value="${safeToken}">
      ${tidField}
      <button type="submit">Confirm unsubscribe</button>
    </form>
  </div>
</body>
</html>`;
}

/**
 * Simple HTML page for unsubscribe confirmation.
 */
function unsubscribePage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="ca">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Tecnocim Innova</title>
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
