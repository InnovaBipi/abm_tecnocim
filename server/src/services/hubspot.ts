/**
 * HubSpot client — no SDK, plain fetch with a timeout and one retry.
 *
 * Two independent surfaces (see docs/hubspot-integration.md):
 *
 *  - Forms API (public, no token): submitForm(). Reuses the website contact form,
 *    so whatever HubSpot already does on a form submission (create/update the
 *    contact, fire the Teams-notification workflow) happens for ABM replies too.
 *    Provisional bridge until a Private App token exists.
 *
 *  - CRM v3 (Private App token): upsertContact() / upsertCompany() /
 *    associateContactWithCompany() / createNote(). Scopes needed:
 *    crm.objects.contacts.read+write, crm.objects.companies.read+write
 *    (notes ride on crm.objects.contacts.write).
 *
 * Every method throws HubSpotError on a non-2xx that is not handled (409 on
 * contact create IS handled: it becomes a PATCH). The caller (replyRouter) is
 * the one that swallows and logs.
 */

export const HUBSPOT_API_BASE = 'https://api.hubapi.com';
export const HUBSPOT_FORMS_BASE = 'https://api.hsforms.com';

// HubSpot-defined association type id: note → contact
const ASSOC_NOTE_TO_CONTACT = 202;

export class HubSpotError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'HubSpotError';
    this.status = status;
    this.body = body;
  }
}

export interface HubSpotClientOptions {
  accessToken?: string;
  apiBase?: string;
  formsBase?: string;
  timeoutMs?: number;
  /** Extra attempts after the first one on network errors / 429 / 5xx. Default 1. */
  retries?: number;
  /** Backoff between attempts (ms). Default 1000. Tests set 0. */
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

export interface FormField {
  objectTypeId: '0-1' | '0-2';
  name: string;
  value: string;
}

export interface FormSubmission {
  portalId: string;
  formGuid: string;
  fields: FormField[];
  context?: { pageUri?: string; pageName?: string; hutk?: string };
  consentText?: string;
}

export interface ContactProperties {
  email: string;
  firstname?: string;
  lastname?: string;
  phone?: string;
  company?: string;
  jobtitle?: string;
  website?: string;
  lifecyclestage?: string;
  hs_lead_status?: string;
  hubspot_owner_id?: string;
  [custom: string]: string | undefined;
}

export interface UpsertResult {
  id: string;
  created: boolean;
}

/** Strip undefined/empty values — HubSpot rejects empty strings on some properties. */
function compact(props: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') out[k] = String(v);
  }
  return out;
}

/** HubSpot 409 on contact create: "Contact already exists. Existing ID: 12345" */
export function parseExistingId(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    const msg: string = parsed?.message || '';
    const m = msg.match(/Existing ID:\s*(\d+)/i);
    if (m) return m[1];
  } catch { /* not JSON */ }
  const m = body.match(/Existing ID:\s*(\d+)/i);
  return m ? m[1] : null;
}

/** Domain from an email or URL: "j@acme.com" → "acme.com"; "https://www.acme.com/x" → "acme.com". */
export function domainOf(value: string | null | undefined): string | null {
  if (!value) return null;
  let v = value.trim().toLowerCase();
  if (v.includes('@')) v = v.split('@').pop() || '';
  v = v.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0];
  return v && v.includes('.') ? v : null;
}

const FREE_MAIL = new Set([
  'gmail.com', 'hotmail.com', 'hotmail.es', 'outlook.com', 'outlook.es', 'yahoo.com', 'yahoo.es',
  'icloud.com', 'live.com', 'msn.com', 'protonmail.com', 'proton.me', 'telefonica.net', 'terra.es',
]);
export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL.has(domain.toLowerCase());
}

export class HubSpotClient {
  private readonly token: string;
  private readonly apiBase: string;
  private readonly formsBase: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly propertyCache = new Map<string, boolean>();

  constructor(opts: HubSpotClientOptions = {}) {
    this.token = opts.accessToken || '';
    this.apiBase = (opts.apiBase || HUBSPOT_API_BASE).replace(/\/$/, '');
    this.formsBase = (opts.formsBase || HUBSPOT_FORMS_BASE).replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.retries = opts.retries ?? 1;
    this.retryDelayMs = opts.retryDelayMs ?? 1000;
    this.fetchImpl = opts.fetchImpl || fetch;
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  private async request(
    url: string,
    init: { method: string; body?: unknown; auth?: boolean }
  ): Promise<{ status: number; text: string; json: any }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (init.auth !== false) {
      if (!this.token) throw new HubSpotError('HubSpot access token is not configured', 0, '');
      headers.Authorization = `Bearer ${this.token}`;
    }

    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const resp = await this.fetchImpl(url, {
          method: init.method,
          headers,
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: controller.signal,
        });
        const text = await resp.text();
        let json: any = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = null; }

        const retryable = resp.status === 429 || resp.status >= 500;
        if (retryable && attempt < this.retries) {
          lastErr = new HubSpotError(`HubSpot HTTP ${resp.status}`, resp.status, text);
          await this.sleep(attempt);
          continue;
        }
        return { status: resp.status, text, json };
      } catch (err: any) {
        // Network error / abort → retry once, then surface
        lastErr = err?.name === 'AbortError'
          ? new HubSpotError(`HubSpot request timed out after ${this.timeoutMs}ms`, 0, '')
          : err;
        if (attempt < this.retries) {
          await this.sleep(attempt);
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr instanceof Error ? lastErr : new HubSpotError('HubSpot request failed', 0, String(lastErr));
  }

  private sleep(attempt: number): Promise<void> {
    const ms = this.retryDelayMs * (attempt + 1);
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  private fail(what: string, r: { status: number; text: string }): never {
    throw new HubSpotError(`${what} failed: HTTP ${r.status} ${r.text.substring(0, 300)}`, r.status, r.text);
  }

  // ---------------------------------------------------------------------------
  // Forms API (no token)
  // ---------------------------------------------------------------------------

  async submitForm(sub: FormSubmission): Promise<{ inlineMessage?: string; redirectUri?: string }> {
    const url = `${this.formsBase}/submissions/v3/integration/submit/${encodeURIComponent(sub.portalId)}/${encodeURIComponent(sub.formGuid)}`;
    const context: Record<string, string> = {};
    if (sub.context?.pageUri) context.pageUri = sub.context.pageUri;
    if (sub.context?.pageName) context.pageName = sub.context.pageName;
    if (sub.context?.hutk) context.hutk = sub.context.hutk;

    const payload: Record<string, unknown> = {
      submittedAt: Date.now().toString(),
      fields: sub.fields.filter((f) => f.value !== undefined && f.value !== null && String(f.value) !== ''),
      context,
    };
    if (sub.consentText) {
      payload.legalConsentOptions = {
        consent: { consentToProcess: true, text: sub.consentText },
      };
    }

    const r = await this.request(url, { method: 'POST', body: payload, auth: false });
    if (r.status < 200 || r.status >= 300) this.fail('Form submission', r);
    return r.json || {};
  }

  // ---------------------------------------------------------------------------
  // CRM v3 (Private App token)
  // ---------------------------------------------------------------------------

  /** Cheap credential/scope probe: GET one contact. Throws HubSpotError on 401/403. */
  async ping(): Promise<void> {
    const r = await this.request(`${this.apiBase}/crm/v3/objects/contacts?limit=1`, { method: 'GET' });
    if (r.status < 200 || r.status >= 300) this.fail('HubSpot ping', r);
  }

  /** True if the portal defines a contact property with this name (cached per client). */
  async hasContactProperty(name: string): Promise<boolean> {
    const cached = this.propertyCache.get(name);
    if (cached !== undefined) return cached;
    const r = await this.request(`${this.apiBase}/crm/v3/properties/contacts/${encodeURIComponent(name)}`, { method: 'GET' });
    const exists = r.status >= 200 && r.status < 300;
    // 404 = not defined; 403 (no crm.schemas.contacts.read) = unknown → treat as absent
    this.propertyCache.set(name, exists);
    return exists;
  }

  /**
   * Create-or-update a contact keyed by email.
   * POST → 201 created; 409 "Existing ID: n" → PATCH n.
   */
  async upsertContact(props: ContactProperties): Promise<UpsertResult> {
    const properties = compact(props);
    const create = await this.request(`${this.apiBase}/crm/v3/objects/contacts`, {
      method: 'POST', body: { properties },
    });
    if (create.status >= 200 && create.status < 300) {
      return { id: String(create.json?.id), created: true };
    }
    if (create.status !== 409) this.fail('Contact create', create);

    const existingId = parseExistingId(create.text);
    if (!existingId) this.fail('Contact create (409 without Existing ID)', create);

    // Never demote: leave lifecyclestage alone on an existing contact
    // (HubSpot refuses backwards lifecycle moves and it is not our call).
    const { lifecyclestage: _drop, ...patchProps } = properties;
    const patch = await this.request(`${this.apiBase}/crm/v3/objects/contacts/${existingId}`, {
      method: 'PATCH', body: { properties: patchProps },
    });
    if (patch.status < 200 || patch.status >= 300) this.fail('Contact update', patch);
    return { id: existingId, created: false };
  }

  /** Find a company by exact domain. Requires crm.objects.companies.read. */
  async findCompanyByDomain(domain: string): Promise<string | null> {
    const r = await this.request(`${this.apiBase}/crm/v3/objects/companies/search`, {
      method: 'POST',
      body: {
        filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: domain }] }],
        properties: ['domain', 'name'],
        limit: 1,
      },
    });
    if (r.status < 200 || r.status >= 300) this.fail('Company search', r);
    const hit = r.json?.results?.[0];
    return hit?.id ? String(hit.id) : null;
  }

  /** Search first (HubSpot allows duplicate company domains), then create or patch. */
  async upsertCompany(props: { domain: string; name?: string; website?: string; [k: string]: string | undefined }): Promise<UpsertResult> {
    const properties = compact(props);
    const existing = await this.findCompanyByDomain(props.domain);
    if (existing) {
      const { domain: _d, ...patchProps } = properties;
      if (Object.keys(patchProps).length > 0) {
        const patch = await this.request(`${this.apiBase}/crm/v3/objects/companies/${existing}`, {
          method: 'PATCH', body: { properties: patchProps },
        });
        if (patch.status < 200 || patch.status >= 300) this.fail('Company update', patch);
      }
      return { id: existing, created: false };
    }
    const create = await this.request(`${this.apiBase}/crm/v3/objects/companies`, {
      method: 'POST', body: { properties },
    });
    if (create.status < 200 || create.status >= 300) this.fail('Company create', create);
    return { id: String(create.json?.id), created: true };
  }

  /** Default (primary) contact → company association, v4 API. Idempotent. */
  async associateContactWithCompany(contactId: string, companyId: string): Promise<void> {
    const r = await this.request(
      `${this.apiBase}/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/default/companies/${encodeURIComponent(companyId)}`,
      { method: 'PUT' }
    );
    if (r.status < 200 || r.status >= 300) this.fail('Contact-company association', r);
  }

  /** Timeline note on a contact (engagement). */
  async createNote(contactId: string, body: string, ownerId?: string): Promise<string> {
    const r = await this.request(`${this.apiBase}/crm/v3/objects/notes`, {
      method: 'POST',
      body: {
        properties: compact({
          hs_timestamp: new Date().toISOString(),
          hs_note_body: body.substring(0, 65_000),
          hubspot_owner_id: ownerId,
        }),
        associations: [{
          to: { id: contactId },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC_NOTE_TO_CONTACT }],
        }],
      },
    });
    if (r.status < 200 || r.status >= 300) this.fail('Note create', r);
    return String(r.json?.id);
  }
}
