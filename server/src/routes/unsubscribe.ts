import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { config } from '../config/env';

const router = Router();

/**
 * Generate an unsubscribe token for an email address.
 * Uses HMAC-SHA256 so tokens can't be forged without the JWT_SECRET.
 */
export function generateUnsubscribeToken(email: string): string {
  return crypto
    .createHmac('sha256', config.JWT_SECRET)
    .update(email.toLowerCase())
    .digest('hex');
}

/**
 * Verify an unsubscribe token against an email.
 */
function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = generateUnsubscribeToken(email);
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

/**
 * Build the unsubscribe URL for an email.
 */
export function getUnsubscribeUrl(email: string): string {
  const token = generateUnsubscribeToken(email);
  const baseUrl = config.NODE_ENV === 'production'
    ? config.FRONTEND_URL
    : `http://localhost:${config.PORT}`;
  return `${baseUrl}/api/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
}

/**
 * Build the compliance footer for all outgoing emails.
 */
export function getEmailFooter(recipientEmail: string): string {
  const unsubscribeUrl = getUnsubscribeUrl(recipientEmail);

  return `
<div style="margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;line-height:1.5;">
  <p style="margin:0;">
    CamiaCasa · Sant Vicenç dels Horts, Barcelona · <a href="https://camiacasa.cat" style="color:#9ca3af;">camiacasa.cat</a>
  </p>
  <p style="margin:4px 0 0 0;">
    Has rebut aquest email perquè ets un contacte professional de CamiaCasa.
    <a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Cancel·lar subscripció</a>
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

    if (!email || !token) {
      res.status(400).send(unsubscribePage('Error', 'Enllaç no vàlid.'));
      return;
    }

    // Verify token
    if (!verifyUnsubscribeToken(email, token)) {
      res.status(403).send(unsubscribePage('Error', 'Enllaç no vàlid o expirat.'));
      return;
    }

    // Add to suppression list
    await query(
      `INSERT IGNORE INTO suppression_list (id, email, reason, source)
       VALUES (?, ?, 'unsubscribed', 'unsubscribe_link')`,
      [uuidv4(), email.toLowerCase()]
    );

    // Update prospect
    await query(
      `UPDATE prospects SET do_not_contact = TRUE, status = 'unsubscribed'
       WHERE email = ?`,
      [email.toLowerCase()]
    );

    // Stop all active enrollments
    const prospects = await query<any[]>(
      'SELECT id FROM prospects WHERE email = ?',
      [email.toLowerCase()]
    );

    if (prospects.length > 0) {
      await query(
        `UPDATE sequence_enrollments SET status = 'unsubscribed', completed_at = NOW()
         WHERE prospect_id = ? AND status IN ('active', 'paused')`,
        [prospects[0].id]
      );

      await query(
        `INSERT INTO prospect_activities (id, prospect_id, activity_type, title, description)
         VALUES (?, ?, 'unsubscribed', 'Subscripció cancel·lada', 'El prospect ha cancel·lat la subscripció via link.')`,
        [uuidv4(), prospects[0].id]
      );
    }

    res.status(200).send(unsubscribePage(
      'Subscripció cancel·lada',
      `L'adreça <strong>${email}</strong> ha estat eliminada de les nostres llistes. No rebràs més emails comercials de CamiaCasa.`
    ));
  } catch (error: any) {
    console.error('Unsubscribe error:', error.message);
    res.status(500).send(unsubscribePage('Error', 'Hi ha hagut un error. Si us plau, contacta amb alfons.marques@camiacasa.cat.'));
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
  <title>${title} - CamiaCasa</title>
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
