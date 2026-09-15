import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { config } from '../config/env';
import { getTenantConfig, type Tenant, type TenantConfig } from '../middleware/tenant';
import { decryptSecret } from '../utils/crypto';
import { sendEmail } from './email';
import { HubSpotClient, domainOf, isFreeMailDomain } from './hubspot';
import type { ReplyClassification } from './replies';

/**
 * Reply router — what happens AFTER a reply has been recorded (replies.ts).
 *
 *   classification   forward email          HubSpot lead
 *   ─────────────    ─────────────────────  ─────────────────────
 *   positive         yes                    yes
 *   other            yes (unless only_pos)  yes
 *   negative         yes (unless only_pos)  no   (classifier mislabels engaged
 *                                                 replies; a human should see it)
 *   out_of_office    only if configured     no
 *   unsubscribe      never                  never
 *
 * Contract: routeReply() NEVER throws. Every action lands in hubspot_sync_log
 * (ok / error / skipped) and errors go to console.error. Reply detection
 * (IMAP or manual) must not fail because HubSpot or Resend are down.
 *
 * Idempotent per (event_id, action): re-running the same reply (backfill script)
 * skips actions that already have an 'ok' row.
 */

export interface RouteReplyInput {
  tenantId: string;
  prospectId: string;
  eventId: string;            // email_events.id of the 'replied' row
  classification: ReplyClassification;
  subject?: string | null;
  snippet?: string | null;    // reply body (already capped at 2000 chars upstream)
  from?: string | null;
  source?: 'imap' | 'manual';
}

export type ActionStatus = 'ok' | 'error' | 'skipped';

export interface ActionResult {
  status: ActionStatus;
  detail?: string;
  hubspotId?: string | null;
}

export interface RouteReplyResult {
  forward: ActionResult;
  hubspot: ActionResult;
}

interface ProspectContext {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  phone: string | null;
  linkedin_url: string | null;
  hubspot_contact_id: string | null;
  company_id: string | null;
  company_name: string | null;
  company_domain: string | null;
  company_website: string | null;
  company_hubspot_id: string | null;
  campaign_name: string | null;
  step_number: number | null;
}

// Actions that count as "HubSpot done" for the idempotency check, per mode.
const HUBSPOT_DONE_ACTION: Record<'crm' | 'form', string> = {
  crm: 'contact_upsert',
  form: 'form_submit',
};

const CLASSIFICATION_LABEL: Record<ReplyClassification, string> = {
  positive: 'Positiva',
  negative: 'Negativa',
  unsubscribe: 'Baja / no contactar',
  out_of_office: 'Fuera de oficina',
  other: 'Sin clasificar',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function dashboardBaseUrl(): string {
  const raw = process.env.PUBLIC_URL || config.FRONTEND_URL;
  return raw && raw.startsWith('http') && !raw.includes('localhost')
    ? raw.replace(/\/$/, '')
    : 'https://abm.tecnociminnova.com';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function displayName(p: ProspectContext): string {
  return p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email;
}

async function logAction(
  input: RouteReplyInput,
  mode: string,
  action: string,
  status: ActionStatus,
  hubspotId: string | null = null,
  error: string | null = null
): Promise<void> {
  try {
    await query(
      `INSERT INTO hubspot_sync_log (id, tenant_id, prospect_id, event_id, mode, action, status, hubspot_id, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), input.tenantId, input.prospectId, input.eventId, mode, action, status, hubspotId, error ? error.substring(0, 2000) : null]
    );
  } catch (err: any) {
    console.error(`replyRouter [${input.tenantId}]: could not write hubspot_sync_log (${action}/${status}): ${err.message}`);
  }
}

async function alreadyDone(input: RouteReplyInput, action: string): Promise<boolean> {
  const rows = await query<any[]>(
    `SELECT id FROM hubspot_sync_log
     WHERE tenant_id = ? AND event_id = ? AND action = ? AND status = 'ok' LIMIT 1`,
    [input.tenantId, input.eventId, action]
  );
  return rows.length > 0;
}

async function loadProspectContext(tenantId: string, prospectId: string): Promise<ProspectContext | null> {
  const rows = await query<any[]>(
    `SELECT p.id, p.email, p.first_name, p.last_name, p.full_name, p.title, p.phone, p.linkedin_url,
            p.hubspot_contact_id, p.company_id,
            c.name AS company_name, c.domain AS company_domain, c.website_url AS company_website,
            c.hubspot_company_id AS company_hubspot_id,
            (SELECT ca.name FROM generated_emails ge JOIN campaigns ca ON ca.id = ge.campaign_id
               WHERE ge.prospect_id = p.id AND ge.tenant_id = p.tenant_id
                 AND ge.status IN ('sent', 'opened', 'replied')
               ORDER BY ge.sent_at DESC, ge.step_number DESC LIMIT 1) AS campaign_name,
            (SELECT ge.step_number FROM generated_emails ge
               WHERE ge.prospect_id = p.id AND ge.tenant_id = p.tenant_id
                 AND ge.status IN ('sent', 'opened', 'replied')
               ORDER BY ge.sent_at DESC, ge.step_number DESC LIMIT 1) AS step_number
     FROM prospects p
     LEFT JOIN companies c ON c.id = p.company_id AND c.tenant_id = p.tenant_id
     WHERE p.id = ? AND p.tenant_id = ?
     LIMIT 1`,
    [prospectId, tenantId]
  );
  return rows.length > 0 ? (rows[0] as ProspectContext) : null;
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export function shouldForward(classification: ReplyClassification, cfg: TenantConfig['reply_forward'] | undefined): boolean {
  if (!cfg || !Array.isArray(cfg.to) || cfg.to.length === 0) return false;
  switch (classification) {
    case 'unsubscribe': return false;
    case 'out_of_office': return !!cfg.forward_out_of_office;
    case 'positive': return true;
    case 'negative':
    case 'other':
    default: return !cfg.only_positive;
  }
}

export function shouldSyncHubSpot(classification: ReplyClassification, cfg: TenantConfig['hubspot'] | undefined): boolean {
  if (!cfg || cfg.enabled === false) return false;
  if (cfg.mode !== 'crm' && cfg.mode !== 'form') return false;
  return classification === 'positive' || classification === 'other';
}

// ---------------------------------------------------------------------------
// Forward email
// ---------------------------------------------------------------------------

export function buildForwardEmail(
  input: RouteReplyInput,
  p: ProspectContext,
  tenantName: string
): { subject: string; html: string; text: string } {
  const name = displayName(p);
  const company = p.company_name || '—';
  const subject = `[ABM] Resposta de ${name} (${company})`;
  const label = CLASSIFICATION_LABEL[input.classification] || input.classification;
  const link = `${dashboardBaseUrl()}/prospects/${p.id}`;
  const body = (input.snippet || '').trim() || '(sin cuerpo — el prospecto respondió pero no se pudo leer el texto)';
  const campaign = p.campaign_name
    ? `${p.campaign_name}${p.step_number ? ` · paso ${p.step_number}` : ''}`
    : 'Sin campaña identificada';

  const row = (k: string, v: string | null | undefined, href?: string) => {
    if (!v) return '';
    const val = href ? `<a href="${escapeHtml(href)}">${escapeHtml(v)}</a>` : escapeHtml(v);
    return `<tr><td style="padding:4px 12px 4px 0;color:#64748b;white-space:nowrap">${k}</td><td style="padding:4px 0">${val}</td></tr>`;
  };

  const html = `
<div style="font-family:Poppins,Arial,sans-serif;font-size:14px;color:#181b31;max-width:640px">
  <p style="margin:0 0 4px;font-size:12px;color:#64748b">${escapeHtml(tenantName)} · ABM · respuesta detectada (${input.source === 'manual' ? 'registro manual' : 'IMAP'})</p>
  <h2 style="margin:0 0 12px;font-size:18px">Respuesta de ${escapeHtml(name)} — ${escapeHtml(company)}</h2>
  <p style="margin:0 0 16px"><strong>Clasificación:</strong> ${escapeHtml(label)}</p>

  <div style="border-left:4px solid #ff7f00;background:#f8fafc;padding:12px 16px;margin:0 0 20px;white-space:pre-wrap">${escapeHtml(body)}</div>
  ${input.subject ? `<p style="margin:0 0 20px;color:#64748b">Asunto: ${escapeHtml(input.subject)}</p>` : ''}

  <h3 style="margin:0 0 8px;font-size:15px">Ficha del prospecto</h3>
  <table style="border-collapse:collapse;margin:0 0 20px">
    ${row('Nombre', name)}
    ${row('Cargo', p.title)}
    ${row('Empresa', p.company_name)}
    ${row('Email', p.email, `mailto:${p.email}`)}
    ${row('Teléfono', p.phone, p.phone ? `tel:${p.phone.replace(/\s+/g, '')}` : undefined)}
    ${row('LinkedIn', p.linkedin_url, p.linkedin_url || undefined)}
    ${row('Campaña', campaign)}
  </table>

  <p style="margin:0 0 20px"><a href="${escapeHtml(link)}" style="background:#ff7f00;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">Abrir ficha en ABM</a></p>
  <p style="margin:0;font-size:12px;color:#94a3b8">Responde a este correo para contestar directamente al prospecto (Reply-To: ${escapeHtml(p.email)}).</p>
</div>`;

  const text = [
    `${tenantName} · ABM · respuesta detectada`,
    `Respuesta de ${name} — ${company}`,
    `Clasificación: ${label}`,
    '',
    body,
    '',
    input.subject ? `Asunto: ${input.subject}` : '',
    'Ficha del prospecto',
    `  Nombre: ${name}`,
    p.title ? `  Cargo: ${p.title}` : '',
    p.company_name ? `  Empresa: ${p.company_name}` : '',
    `  Email: ${p.email}`,
    p.phone ? `  Teléfono: ${p.phone}` : '',
    p.linkedin_url ? `  LinkedIn: ${p.linkedin_url}` : '',
    `  Campaña: ${campaign}`,
    '',
    `Ficha en ABM: ${link}`,
  ].filter((l) => l !== '').join('\n');

  return { subject, html, text };
}

async function forwardReply(input: RouteReplyInput, tenant: Tenant, p: ProspectContext): Promise<ActionResult> {
  const cfg = tenant.config.reply_forward;
  if (!cfg) return { status: 'skipped', detail: 'not configured' };
  if (!shouldForward(input.classification, cfg)) {
    await logAction(input, 'email', 'forward_email', 'skipped', null, `classification=${input.classification}`);
    return { status: 'skipped', detail: `classification=${input.classification}` };
  }
  if (await alreadyDone(input, 'forward_email')) {
    return { status: 'skipped', detail: 'already forwarded' };
  }

  const { subject, html, text } = buildForwardEmail(input, p, tenant.name);
  const tenantEmail = tenant.config.email || ({} as TenantConfig['email']);
  const from = tenantEmail.from_email
    ? `${tenantEmail.from_name || tenant.name} <${tenantEmail.from_email}>`
    : undefined;

  const failures: string[] = [];
  let sentAny = false;
  for (const to of cfg!.to) {
    try {
      const r = await sendEmail(to, subject, html, text, from, p.email, tenant.id);
      if (r.success) sentAny = true;
      else failures.push(`${to}: Resend returned an error`);
    } catch (err: any) {
      failures.push(`${to}: ${err.message}`);
    }
  }

  if (sentAny && failures.length === 0) {
    await logAction(input, 'email', 'forward_email', 'ok');
    return { status: 'ok' };
  }
  const detail = failures.join('; ');
  console.error(`replyRouter [${tenant.id}]: forward_email failed for prospect ${p.id}: ${detail}`);
  await logAction(input, 'email', 'forward_email', sentAny ? 'ok' : 'error', null, detail);
  return { status: sentAny ? 'ok' : 'error', detail };
}

// ---------------------------------------------------------------------------
// HubSpot
// ---------------------------------------------------------------------------

function noteBody(input: RouteReplyInput, p: ProspectContext): string {
  const campaign = p.campaign_name
    ? `"${p.campaign_name}"${p.step_number ? ` (paso ${p.step_number})` : ''}`
    : 'campaña no identificada';
  return [
    `[ABM] Respuesta a ${campaign} — clasificación: ${input.classification}`,
    input.subject ? `Asunto: ${input.subject}` : '',
    '---',
    (input.snippet || '').trim() || '(sin cuerpo)',
    '---',
    `Origen: ABM · ${dashboardBaseUrl()}/prospects/${p.id}`,
  ].filter((l) => l !== '').join('\n');
}

export function buildFormFields(input: RouteReplyInput, p: ProspectContext): Array<{ objectTypeId: '0-1' | '0-2'; name: string; value: string }> {
  const first = p.first_name || displayName(p).split(/\s+/)[0] || '';
  const last = p.last_name || displayName(p).split(/\s+/).slice(1).join(' ') || '';
  const company = p.company_name || domainOf(p.email) || '';
  const campaign = p.campaign_name || 'campaña ABM';
  // Same field names the website contact form sends (tecnocim-landing app/api/hubspot/route.ts):
  // contact: email, firstname, lastname, phone, company, message · company: name, necesidad
  return [
    { objectTypeId: '0-1', name: 'email', value: p.email },
    { objectTypeId: '0-1', name: 'firstname', value: first },
    { objectTypeId: '0-1', name: 'lastname', value: last },
    { objectTypeId: '0-1', name: 'phone', value: p.phone || '' },
    { objectTypeId: '0-1', name: 'company', value: company },
    { objectTypeId: '0-1', name: 'message', value: noteBody(input, p) },
    { objectTypeId: '0-2', name: 'name', value: company },
    { objectTypeId: '0-2', name: 'necesidad', value: `ABM · Respuesta a campaña ${campaign}` },
  ];
}

async function syncViaForm(input: RouteReplyInput, tenant: Tenant, p: ProspectContext, client: HubSpotClient): Promise<ActionResult> {
  const cfg = tenant.config.hubspot!;
  if (!cfg.portal_id || !cfg.form_guid) {
    await logAction(input, 'form', 'form_submit', 'error', null, 'portal_id/form_guid missing');
    return { status: 'error', detail: 'portal_id/form_guid missing' };
  }
  try {
    await client.submitForm({
      portalId: cfg.portal_id,
      formGuid: cfg.form_guid,
      fields: buildFormFields(input, p),
      context: {
        pageUri: `${dashboardBaseUrl()}/prospects/${p.id}`,
        pageName: `ABM · Respuesta ${p.campaign_name ? `campaña ${p.campaign_name}` : 'a campaña'}`,
      },
      consentText: 'Contacto B2B que ha respondido a una comunicación comercial (interés legítimo). Registrado desde la plataforma ABM.',
    });
    await logAction(input, 'form', 'form_submit', 'ok');
    return { status: 'ok' };
  } catch (err: any) {
    console.error(`replyRouter [${tenant.id}]: HubSpot form submit failed for prospect ${p.id}: ${err.message}`);
    await logAction(input, 'form', 'form_submit', 'error', null, err.message);
    return { status: 'error', detail: err.message };
  }
}

async function syncViaCrm(input: RouteReplyInput, tenant: Tenant, p: ProspectContext, client: HubSpotClient): Promise<ActionResult> {
  const cfg = tenant.config.hubspot!;
  const name = displayName(p);
  const first = p.first_name || name.split(/\s+/)[0] || '';
  const last = p.last_name || name.split(/\s+/).slice(1).join(' ') || '';

  // 1. Contact
  let contactId: string;
  try {
    const props: Record<string, string | undefined> = {
      email: p.email,
      firstname: first,
      lastname: last,
      phone: p.phone || undefined,
      company: p.company_name || undefined,
      jobtitle: p.title || undefined,
      lifecyclestage: 'lead',
      hs_lead_status: 'NEW',
      hubspot_owner_id: cfg.owner_id || undefined,
    };
    // Only touch a custom source property if the portal actually defines it — never invent names.
    if (await client.hasContactProperty('abm_source')) {
      props.abm_source = p.campaign_name ? `ABM · ${p.campaign_name}` : 'ABM';
    }
    const r = await client.upsertContact(props as any);
    contactId = r.id;
    await query(
      'UPDATE prospects SET hubspot_contact_id = ? WHERE id = ? AND tenant_id = ?',
      [contactId, p.id, tenant.id]
    );
    await logAction(input, 'crm', 'contact_upsert', 'ok', contactId, r.created ? 'created' : 'updated');
  } catch (err: any) {
    console.error(`replyRouter [${tenant.id}]: HubSpot contact upsert failed for prospect ${p.id}: ${err.message}`);
    await logAction(input, 'crm', 'contact_upsert', 'error', null, err.message);
    return { status: 'error', detail: err.message };
  }

  // 2. Company (best effort)
  if (cfg.create_company !== false) {
    const domain = domainOf(p.company_domain) || domainOf(p.company_website) || domainOf(p.email);
    if (domain && !isFreeMailDomain(domain)) {
      try {
        const r = await client.upsertCompany({
          domain,
          name: p.company_name || undefined,
          website: p.company_website || undefined,
        });
        await client.associateContactWithCompany(contactId, r.id);
        if (p.company_id) {
          await query(
            'UPDATE companies SET hubspot_company_id = ? WHERE id = ? AND tenant_id = ?',
            [r.id, p.company_id, tenant.id]
          );
        }
        await logAction(input, 'crm', 'company_upsert', 'ok', r.id, r.created ? 'created' : 'updated');
      } catch (err: any) {
        console.error(`replyRouter [${tenant.id}]: HubSpot company upsert failed for prospect ${p.id}: ${err.message}`);
        await logAction(input, 'crm', 'company_upsert', 'error', null, err.message);
      }
    } else {
      await logAction(input, 'crm', 'company_upsert', 'skipped', null, domain ? 'free-mail domain' : 'no domain');
    }
  }

  // 3. Note with the reply (best effort)
  try {
    const noteId = await client.createNote(contactId, noteBody(input, p), cfg.owner_id);
    await logAction(input, 'crm', 'note_create', 'ok', noteId);
  } catch (err: any) {
    console.error(`replyRouter [${tenant.id}]: HubSpot note failed for prospect ${p.id}: ${err.message}`);
    await logAction(input, 'crm', 'note_create', 'error', null, err.message);
  }

  return { status: 'ok', hubspotId: contactId };
}

async function syncHubSpot(input: RouteReplyInput, tenant: Tenant, p: ProspectContext, deps: RouterDeps): Promise<ActionResult> {
  const cfg = tenant.config.hubspot;
  if (!cfg) return { status: 'skipped', detail: 'not configured' };
  if (!shouldSyncHubSpot(input.classification, cfg)) {
    const detail = cfg.enabled === false ? 'disabled' : `classification=${input.classification}`;
    await logAction(input, cfg.mode || 'none', 'hubspot', 'skipped', null, detail);
    return { status: 'skipped', detail };
  }
  const mode = cfg!.mode;
  if (await alreadyDone(input, HUBSPOT_DONE_ACTION[mode])) {
    return { status: 'skipped', detail: 'already synced' };
  }

  let token = '';
  if (mode === 'crm') {
    try {
      token = cfg!.access_token ? decryptSecret(cfg!.access_token) : '';
    } catch (err: any) {
      await logAction(input, 'crm', 'contact_upsert', 'error', null, `token decrypt: ${err.message}`);
      return { status: 'error', detail: `token decrypt: ${err.message}` };
    }
    if (!token) {
      await logAction(input, 'crm', 'contact_upsert', 'error', null, 'access_token missing');
      return { status: 'error', detail: 'access_token missing' };
    }
  }

  const client = deps.createClient({ accessToken: token, apiBase: cfg!.api_base });
  return mode === 'crm'
    ? syncViaCrm(input, tenant, p, client)
    : syncViaForm(input, tenant, p, client);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface RouterDeps {
  createClient: (opts: { accessToken: string; apiBase?: string }) => HubSpotClient;
}

const defaultDeps: RouterDeps = {
  createClient: (opts) => new HubSpotClient(opts),
};

/**
 * Route a recorded reply: forward to humans + push to HubSpot. Never throws.
 */
export async function routeReply(input: RouteReplyInput, deps: RouterDeps = defaultDeps): Promise<RouteReplyResult> {
  const skipped = (detail: string): RouteReplyResult => ({
    forward: { status: 'skipped', detail },
    hubspot: { status: 'skipped', detail },
  });

  try {
    const tenant = await getTenantConfig(input.tenantId);
    if (!tenant) return skipped('tenant not found');
    if (!tenant.config.hubspot && !tenant.config.reply_forward) return skipped('not configured');

    if (input.classification === 'unsubscribe') {
      return skipped('unsubscribe');
    }

    const prospect = await loadProspectContext(input.tenantId, input.prospectId);
    if (!prospect) return skipped('prospect not found');

    const forward = await forwardReply(input, tenant, prospect).catch((err: any): ActionResult => {
      console.error(`replyRouter [${input.tenantId}]: forward crashed: ${err.message}`);
      return { status: 'error', detail: err.message };
    });
    const hubspot = await syncHubSpot(input, tenant, prospect, deps).catch((err: any): ActionResult => {
      console.error(`replyRouter [${input.tenantId}]: hubspot crashed: ${err.message}`);
      return { status: 'error', detail: err.message };
    });

    return { forward, hubspot };
  } catch (err: any) {
    console.error(`replyRouter [${input.tenantId}]: routing crashed for event ${input.eventId}: ${err.message}`);
    return {
      forward: { status: 'error', detail: err.message },
      hubspot: { status: 'error', detail: err.message },
    };
  }
}
