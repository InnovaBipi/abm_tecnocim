import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { getAllActiveTenants } from '../middleware/tenant';
import { sendEmail } from '../services/email';
import { config } from '../config/env';
import { logger } from '../config/logger';

/**
 * Deliverability alert monitor.
 *
 * For every active tenant that has `config.alerts` defined, computes the bounce
 * and complaint rate over a recent window and emails `recipient_email` when
 * either exceeds its threshold. Designed for high-risk campaigns (e.g. a
 * purchased list) where a spike in bounces/complaints can damage the sending
 * domain's reputation and must be caught fast.
 *
 * Rate math (matches the platform's source-of-truth conventions):
 *   - denominator (sent) = generated_emails.status IN ('sent','bounced') in window
 *     (the outbox is the real send record; email_events 'sent' is unreliable per tenant)
 *   - numerators (bounces/complaints) = email_events.event_type in window (from the Resend webhook)
 *
 * Idempotency: at most one alert per tenant per day, tracked in imap_sync_state
 * with mailbox='DELIV_ALERT' (same lightweight-flag pattern as the daily digest).
 */

const ALERT_MAILBOX = 'DELIV_ALERT';

interface AlertSettings {
  recipient_email: string;
  bounce_pct_threshold: number;
  complaint_pct_threshold: number;
  min_sample: number;
  window_hours?: number;
}

function dashboardBaseUrl(): string {
  return config.FRONTEND_URL && config.FRONTEND_URL.startsWith('http') && !config.FRONTEND_URL.includes('localhost')
    ? config.FRONTEND_URL.replace(/\/$/, '')
    : 'https://abm.tecnociminnova.com';
}

export async function checkDeliverabilityAndAlert(): Promise<void> {
  // Only evaluate during business hours in Madrid (08:00–20:59 CET) to avoid night noise.
  const hourCet = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(new Date())
  ) % 24;
  if (hourCet < 8 || hourCet >= 21) return;

  const tenants = await getAllActiveTenants();

  for (const tenant of tenants) {
    try {
      const alerts = tenant.config?.alerts as AlertSettings | undefined;
      if (!alerts?.recipient_email) continue;

      const windowHours = alerts.window_hours || 48;
      const minSample = alerts.min_sample || 30;
      const bounceThreshold = alerts.bounce_pct_threshold ?? 2;
      const complaintThreshold = alerts.complaint_pct_threshold ?? 0.1;

      // Denominator: real outbox sends over the window (source of truth).
      const sentRows = await query<any[]>(
        `SELECT COUNT(*) as cnt FROM generated_emails
         WHERE tenant_id = ? AND status IN ('sent', 'bounced')
           AND COALESCE(sent_at, updated_at) >= DATE_SUB(NOW(), INTERVAL ? HOUR)`,
        [tenant.id, windowHours]
      );
      const sent = Number(sentRows[0]?.cnt || 0);
      if (sent < minSample) continue; // insufficient sample — skip

      // Numerators: bounce/complaint events over the same window (from the webhook).
      const evRows = await query<any[]>(
        `SELECT
           SUM(CASE WHEN event_type = 'bounced' THEN 1 ELSE 0 END) as bounces,
           SUM(CASE WHEN event_type = 'complaint' THEN 1 ELSE 0 END) as complaints
         FROM email_events
         WHERE tenant_id = ? AND occurred_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)`,
        [tenant.id, windowHours]
      );
      const bounces = Number(evRows[0]?.bounces || 0);
      const complaints = Number(evRows[0]?.complaints || 0);

      const bouncePct = Math.round((bounces / sent) * 10000) / 100;
      const complaintPct = Math.round((complaints / sent) * 10000) / 100;

      const overBounce = bouncePct > bounceThreshold;
      const overComplaint = complaintPct > complaintThreshold;
      if (!overBounce && !overComplaint) continue;

      // Idempotency: only one alert per tenant per day.
      const alreadyToday = await query<any[]>(
        `SELECT id FROM imap_sync_state
         WHERE tenant_id = ? AND mailbox = ? AND DATE(last_synced_at) = CURDATE() LIMIT 1`,
        [tenant.id, ALERT_MAILBOX]
      );
      if (alreadyToday.length > 0) continue;

      const reasons: string[] = [];
      if (overBounce) reasons.push(`rebotes ${bouncePct}% (umbral ${bounceThreshold}%)`);
      if (overComplaint) reasons.push(`quejas ${complaintPct}% (umbral ${complaintThreshold}%)`);

      const subject = `[ALERTA] ${tenant.name} — deliverability sobre umbral (${reasons.join(' · ')})`;
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5">
          <h2 style="margin:0 0 8px">Alerta de deliverability — ${tenant.name}</h2>
          <p style="margin:0 0 12px">En las últimas <strong>${windowHours}h</strong> se ha superado el umbral configurado.</p>
          <table style="border-collapse:collapse;font-size:14px">
            <tr><td style="padding:4px 12px 4px 0;color:#555">Enviados (ventana)</td><td style="padding:4px 0"><strong>${sent}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#555">Rebotes</td><td style="padding:4px 0"><strong style="color:${overBounce ? '#c0392b' : '#111'}">${bounces} (${bouncePct}%)</strong> — umbral ${bounceThreshold}%</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#555">Quejas spam</td><td style="padding:4px 0"><strong style="color:${overComplaint ? '#c0392b' : '#111'}">${complaints} (${complaintPct}%)</strong> — umbral ${complaintThreshold}%</td></tr>
          </table>
          <p style="margin:14px 0 0">
            <a href="${dashboardBaseUrl()}" style="color:#ff7f00">Abrir panel</a>
          </p>
          <p style="margin:14px 0 0;font-size:12px;color:#888">
            Los rebotes/quejas se auto-suprimen, pero una lista con tasa alta seguirá generando más.
            Considera depurar o ralentizar el envío. Aviso máximo una vez al día.
          </p>
        </div>`;

      // Send via the tenant's own (verified) Resend key to guarantee delivery.
      await sendEmail(alerts.recipient_email, subject, html, undefined, undefined, undefined, tenant.id);

      // Mark alerted today (upsert the DELIV_ALERT flag row).
      const existing = await query<any[]>(
        `SELECT id FROM imap_sync_state WHERE tenant_id = ? AND mailbox = ? LIMIT 1`,
        [tenant.id, ALERT_MAILBOX]
      );
      if (existing.length > 0) {
        await query(
          `UPDATE imap_sync_state SET last_synced_at = NOW() WHERE tenant_id = ? AND mailbox = ?`,
          [tenant.id, ALERT_MAILBOX]
        );
      } else {
        await query(
          `INSERT INTO imap_sync_state (id, tenant_id, mailbox, last_uid, last_synced_at) VALUES (?, ?, ?, 0, NOW())`,
          [uuidv4(), tenant.id, ALERT_MAILBOX]
        );
      }

      logger.warn('Deliverability alert sent', {
        tenant: tenant.name,
        recipient: alerts.recipient_email,
        sent,
        bounces,
        complaints,
        bouncePct,
        complaintPct,
      });
    } catch (err: any) {
      logger.error('Deliverability alert check failed', { tenant: tenant?.name, error: err.message });
    }
  }
}

/**
 * Register the hourly deliverability monitor cron. Called once at startup from index.ts.
 * The check itself is gated to business hours (see checkDeliverabilityAndAlert).
 */
export function startDeliverabilityAlerts(): void {
  cron.schedule('15 * * * *', async () => {
    try {
      await checkDeliverabilityAndAlert();
    } catch (err: any) {
      logger.error('Deliverability alert cron failed', { error: err.message });
    }
  });
  logger.info('Deliverability alert monitor started');
}
