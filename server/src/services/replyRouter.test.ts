/**
 * Tests for server/src/services/replyRouter.ts — forward-to-human + HubSpot after a reply.
 *
 * Everything external is mocked: DB (query), tenant config, Resend (sendEmail) and the
 * HubSpot client (injected through deps.createClient).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({ query: vi.fn() }));
vi.mock('../middleware/tenant', () => ({ getTenantConfig: vi.fn() }));
vi.mock('./email', () => ({ sendEmail: vi.fn() }));
vi.mock('../utils/crypto', () => ({ decryptSecret: vi.fn((s: string) => (s ? s.replace(/^enc:v1:/, '') : '')) }));
vi.mock('../config/env', () => ({ config: { FRONTEND_URL: 'https://abm.tecnociminnova.com' } }));

import { query } from '../config/database';
import { getTenantConfig } from '../middleware/tenant';
import { sendEmail } from './email';
import { routeReply, shouldForward, shouldSyncHubSpot, buildForwardEmail, type RouteReplyInput } from './replyRouter';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockTenant = getTenantConfig as unknown as ReturnType<typeof vi.fn>;
const mockSend = sendEmail as unknown as ReturnType<typeof vi.fn>;

const T = 'tenant-tecnocim-0003';
const P = 'prospect-1';
const E = 'event-1';

const PROSPECT_ROW = {
  id: P, email: 'ana.perez@acme.com', first_name: 'Ana', last_name: 'Pérez', full_name: 'Ana Pérez',
  title: 'CFO', phone: '+34 600 000 000', linkedin_url: 'https://linkedin.com/in/anaperez',
  hubspot_contact_id: null, company_id: 'company-1',
  company_name: 'Acme', company_domain: 'acme.com', company_website: 'https://www.acme.com',
  company_hubspot_id: null, campaign_name: 'CDTI Sur 2026', step_number: 2,
};

function tenantWith(config: Record<string, unknown>) {
  return {
    id: T, name: 'Tecnocim Innova', slug: 'tecnocim',
    config: {
      email: { from_email: 'abm@tecnocim.com', from_name: 'Tecnocim Innova', reply_to: 'abm@tecnocim.com' },
      ...config,
    },
  };
}

const FORWARD_ROBERT = { to: ['Robert.Belmonte@tecnocim.com'], only_positive: false };
const HS_FORM = { mode: 'form', portal_id: '145850079', form_guid: '9c812eca-b6fb-4c2e-b2c9-5623008cfc0c' };
const HS_CRM = { mode: 'crm', access_token: 'enc:v1:pat-eu1-secret', owner_id: '34489913', create_company: true };

function input(classification: RouteReplyInput['classification'], extra: Partial<RouteReplyInput> = {}): RouteReplyInput {
  return {
    tenantId: T, prospectId: P, eventId: E, classification,
    subject: 'RE: Ayudas CDTI para Acme', snippet: 'Hola, sí me interesa. ¿Podemos hablar el jueves?',
    from: 'ana.perez@acme.com', source: 'imap', ...extra,
  };
}

function fakeClient(overrides: Record<string, any> = {}) {
  return {
    submitForm: vi.fn().mockResolvedValue({}),
    hasContactProperty: vi.fn().mockResolvedValue(false),
    upsertContact: vi.fn().mockResolvedValue({ id: '501', created: true }),
    upsertCompany: vi.fn().mockResolvedValue({ id: '9001', created: true }),
    associateContactWithCompany: vi.fn().mockResolvedValue(undefined),
    createNote: vi.fn().mockResolvedValue('31'),
    ping: vi.fn(),
    ...overrides,
  };
}

function depsWith(client: any) {
  const createClient = vi.fn(() => client);
  return { deps: { createClient }, createClient };
}

/** Rows inserted into hubspot_sync_log during the test, as {action, status, detail}. */
function syncLogRows() {
  return mockQuery.mock.calls
    .filter((c) => (c[0] as string).includes('INSERT INTO hubspot_sync_log'))
    .map((c) => ({ mode: c[1][4], action: c[1][5], status: c[1][6], hubspotId: c[1][7], error: c[1][8] }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM prospects p')) return [PROSPECT_ROW];
    if (sql.includes('SELECT id FROM hubspot_sync_log')) return [];
    return { affectedRows: 1 };
  });
  mockSend.mockResolvedValue({ id: 'res_1', success: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('decision helpers', () => {
  it('shouldForward follows the classification matrix', () => {
    const cfg = { to: ['r@t.com'], only_positive: false };
    expect(shouldForward('positive', cfg)).toBe(true);
    expect(shouldForward('other', cfg)).toBe(true);
    expect(shouldForward('negative', cfg)).toBe(true);
    expect(shouldForward('out_of_office', cfg)).toBe(false);
    expect(shouldForward('out_of_office', { ...cfg, forward_out_of_office: true })).toBe(true);
    expect(shouldForward('unsubscribe', cfg)).toBe(false);
    expect(shouldForward('unsubscribe', { ...cfg, forward_out_of_office: true })).toBe(false);
    expect(shouldForward('negative', { ...cfg, only_positive: true })).toBe(false);
    expect(shouldForward('positive', { ...cfg, only_positive: true })).toBe(true);
    expect(shouldForward('positive', undefined)).toBe(false);
    expect(shouldForward('positive', { to: [], only_positive: false })).toBe(false);
  });

  it('shouldSyncHubSpot: only positive/other, only when enabled with a valid mode', () => {
    expect(shouldSyncHubSpot('positive', HS_FORM as any)).toBe(true);
    expect(shouldSyncHubSpot('other', HS_CRM as any)).toBe(true);
    expect(shouldSyncHubSpot('negative', HS_FORM as any)).toBe(false);
    expect(shouldSyncHubSpot('out_of_office', HS_FORM as any)).toBe(false);
    expect(shouldSyncHubSpot('unsubscribe', HS_FORM as any)).toBe(false);
    expect(shouldSyncHubSpot('positive', { ...HS_FORM, enabled: false } as any)).toBe(false);
    expect(shouldSyncHubSpot('positive', { mode: 'nope' } as any)).toBe(false);
    expect(shouldSyncHubSpot('positive', undefined)).toBe(false);
  });
});

describe('routeReply — positive reply', () => {
  it('form mode: forwards to Robert AND submits the HubSpot form; both logged ok', async () => {
    mockTenant.mockResolvedValue(tenantWith({ hubspot: HS_FORM, reply_forward: FORWARD_ROBERT }));
    const client = fakeClient();
    const { deps, createClient } = depsWith(client);

    const r = await routeReply(input('positive'), deps);

    expect(r.forward.status).toBe('ok');
    expect(r.hubspot.status).toBe('ok');

    // Email to Robert, via the tenant sender, Reply-To = prospect
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [to, subject, html, text, from, replyTo, tenantId] = mockSend.mock.calls[0];
    expect(to).toBe('Robert.Belmonte@tecnocim.com');
    expect(subject).toBe('[ABM] Resposta de Ana Pérez (Acme)');
    expect(from).toBe('Tecnocim Innova <abm@tecnocim.com>');
    expect(replyTo).toBe('ana.perez@acme.com');
    expect(tenantId).toBe(T);
    expect(html).toContain('Positiva');
    expect(html).toContain('¿Podemos hablar el jueves?');
    expect(html).toContain('CFO');
    expect(html).toContain('+34 600 000 000');
    expect(html).toContain('https://linkedin.com/in/anaperez');
    expect(html).toContain('CDTI Sur 2026');
    expect(html).toContain('paso 2');
    expect(html).toContain(`https://abm.tecnociminnova.com/prospects/${P}`);
    expect(text).toContain('Ficha en ABM: https://abm.tecnociminnova.com/prospects/prospect-1');

    // HubSpot form: no token, website-form field names, ABM page context
    expect(createClient).toHaveBeenCalledWith({ accessToken: '', apiBase: undefined });
    expect(client.submitForm).toHaveBeenCalledTimes(1);
    const sub = client.submitForm.mock.calls[0][0];
    expect(sub.portalId).toBe('145850079');
    expect(sub.formGuid).toBe('9c812eca-b6fb-4c2e-b2c9-5623008cfc0c');
    const byName = Object.fromEntries(sub.fields.map((f: any) => [`${f.objectTypeId}:${f.name}`, f.value]));
    expect(byName['0-1:email']).toBe('ana.perez@acme.com');
    expect(byName['0-1:firstname']).toBe('Ana');
    expect(byName['0-1:lastname']).toBe('Pérez');
    expect(byName['0-1:phone']).toBe('+34 600 000 000');
    expect(byName['0-1:company']).toBe('Acme');
    expect(byName['0-1:message']).toContain('CDTI Sur 2026');
    expect(byName['0-1:message']).toContain('¿Podemos hablar el jueves?');
    expect(byName['0-2:name']).toBe('Acme');
    expect(byName['0-2:necesidad']).toContain('ABM');
    expect(sub.context.pageUri).toBe(`https://abm.tecnociminnova.com/prospects/${P}`);
    expect(client.upsertContact).not.toHaveBeenCalled();

    // Audit trail
    expect(syncLogRows()).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: 'email', action: 'forward_email', status: 'ok' }),
      expect.objectContaining({ mode: 'form', action: 'form_submit', status: 'ok' }),
    ]));
    // Every log row is tenant-scoped
    for (const c of mockQuery.mock.calls.filter((c) => (c[0] as string).includes('INSERT INTO hubspot_sync_log'))) {
      expect(c[1][1]).toBe(T);
      expect(c[1][3]).toBe(E);
    }
  });

  it('crm mode: upsert contact as lead with owner, company by domain + association, note, ids persisted', async () => {
    mockTenant.mockResolvedValue(tenantWith({ hubspot: HS_CRM, reply_forward: FORWARD_ROBERT }));
    const client = fakeClient();
    const { deps, createClient } = depsWith(client);

    const r = await routeReply(input('positive'), deps);

    expect(r.hubspot).toEqual({ status: 'ok', hubspotId: '501' });
    expect(createClient).toHaveBeenCalledWith({ accessToken: 'pat-eu1-secret', apiBase: undefined }); // decrypted

    expect(client.upsertContact).toHaveBeenCalledWith(expect.objectContaining({
      email: 'ana.perez@acme.com', firstname: 'Ana', lastname: 'Pérez', phone: '+34 600 000 000',
      company: 'Acme', jobtitle: 'CFO', lifecyclestage: 'lead', hs_lead_status: 'NEW', hubspot_owner_id: '34489913',
    }));
    // abm_source not defined in the portal → not sent
    expect(client.upsertContact.mock.calls[0][0]).not.toHaveProperty('abm_source');

    expect(client.upsertCompany).toHaveBeenCalledWith({ domain: 'acme.com', name: 'Acme', website: 'https://www.acme.com' });
    expect(client.associateContactWithCompany).toHaveBeenCalledWith('501', '9001');
    expect(client.createNote).toHaveBeenCalledWith('501', expect.stringContaining('¿Podemos hablar el jueves?'), '34489913');
    expect(client.submitForm).not.toHaveBeenCalled();

    const prospectUpdate = mockQuery.mock.calls.find((c) => (c[0] as string).includes('UPDATE prospects SET hubspot_contact_id'))!;
    expect(prospectUpdate[1]).toEqual(['501', P, T]);
    const companyUpdate = mockQuery.mock.calls.find((c) => (c[0] as string).includes('UPDATE companies SET hubspot_company_id'))!;
    expect(companyUpdate[1]).toEqual(['9001', 'company-1', T]);

    expect(syncLogRows().map((x) => `${x.action}:${x.status}`)).toEqual(expect.arrayContaining([
      'forward_email:ok', 'contact_upsert:ok', 'company_upsert:ok', 'note_create:ok',
    ]));
  });

  it('crm mode: uses abm_source when the portal defines it', async () => {
    mockTenant.mockResolvedValue(tenantWith({ hubspot: HS_CRM }));
    const client = fakeClient({ hasContactProperty: vi.fn().mockResolvedValue(true) });
    await routeReply(input('positive'), depsWith(client).deps);
    expect(client.upsertContact.mock.calls[0][0].abm_source).toBe('ABM · CDTI Sur 2026');
  });

  it('crm mode: skips company for free-mail prospects without a company domain', async () => {
    mockTenant.mockResolvedValue(tenantWith({ hubspot: HS_CRM }));
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM prospects p')) return [{ ...PROSPECT_ROW, email: 'ana@gmail.com', company_domain: null, company_website: null, company_id: null }];
      if (sql.includes('SELECT id FROM hubspot_sync_log')) return [];
      return { affectedRows: 1 };
    });
    const client = fakeClient();
    await routeReply(input('positive'), depsWith(client).deps);
    expect(client.upsertCompany).not.toHaveBeenCalled();
    expect(syncLogRows()).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'company_upsert', status: 'skipped' }),
    ]));
  });
});

describe('routeReply — classification gates', () => {
  it('out_of_office: no email, no HubSpot, both skipped (and logged as skipped)', async () => {
    mockTenant.mockResolvedValue(tenantWith({ hubspot: HS_FORM, reply_forward: FORWARD_ROBERT }));
    const client = fakeClient();
    const r = await routeReply(input('out_of_office'), depsWith(client).deps);
    expect(r.forward.status).toBe('skipped');
    expect(r.hubspot.status).toBe('skipped');
    expect(mockSend).not.toHaveBeenCalled();
    expect(client.submitForm).not.toHaveBeenCalled();
    expect(syncLogRows().every((x) => x.status === 'skipped')).toBe(true);
  });

  it('out_of_office with forward_out_of_office: email yes, HubSpot still no', async () => {
    mockTenant.mockResolvedValue(tenantWith({ hubspot: HS_FORM, reply_forward: { ...FORWARD_ROBERT, forward_out_of_office: true } }));
    const client = fakeClient();
    const r = await routeReply(input('out_of_office'), depsWith(client).deps);
    expect(r.forward.status).toBe('ok');
    expect(r.hubspot.status).toBe('skipped');
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(client.submitForm).not.toHaveBeenCalled();
  });

  it('unsubscribe: nothing at all — no email, no HubSpot, no log rows', async () => {
    mockTenant.mockResolvedValue(tenantWith({ hubspot: HS_CRM, reply_forward: { ...FORWARD_ROBERT, forward_out_of_office: true } }));
    const client = fakeClient();
    const r = await routeReply(input('unsubscribe'), depsWith(client).deps);
    expect(r).toEqual({
      forward: { status: 'skipped', detail: 'unsubscribe' },
      hubspot: { status: 'skipped', detail: 'unsubscribe' },
    });
    expect(mockSend).not.toHaveBeenCalled();
    expect(client.upsertContact).not.toHaveBeenCalled();
    expect(syncLogRows()).toHaveLength(0);
  });

  it('negative: forwarded to a human (mislabels happen) but never a HubSpot lead', async () => {
    mockTenant.mockResolvedValue(tenantWith({ hubspot: HS_FORM, reply_forward: FORWARD_ROBERT }));
    const client = fakeClient();
    const r = await routeReply(input('negative'), depsWith(client).deps);
    expect(r.forward.status).toBe('ok');
    expect(r.hubspot.status).toBe('skipped');
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][2]).toContain('Negativa');
    expect(client.submitForm).not.toHaveBeenCalled();
  });

  it('negative with only_positive: not forwarded either', async () => {
    mockTenant.mockResolvedValue(tenantWith({ reply_forward: { ...FORWARD_ROBERT, only_positive: true } }));
    const r = await routeReply(input('negative'), depsWith(fakeClient()).deps);
    expect(r.forward.status).toBe('skipped');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('not configured: returns skipped without touching the DB beyond the tenant lookup', async () => {
    mockTenant.mockResolvedValue(tenantWith({}));
    const r = await routeReply(input('positive'), depsWith(fakeClient()).deps);
    expect(r.forward).toEqual({ status: 'skipped', detail: 'not configured' });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('routeReply — failure isolation', () => {
  it('HubSpot failure does not break the forward, does not throw, and is logged as error', async () => {
    mockTenant.mockResolvedValue(tenantWith({ hubspot: HS_FORM, reply_forward: FORWARD_ROBERT }));
    const client = fakeClient({ submitForm: vi.fn().mockRejectedValue(new Error('HubSpot HTTP 500')) });
    const r = await routeReply(input('positive'), depsWith(client).deps);
    expect(r.forward.status).toBe('ok');
    expect(r.hubspot).toEqual({ status: 'error', detail: 'HubSpot HTTP 500' });
    expect(syncLogRows()).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'form_submit', status: 'error', error: 'HubSpot HTTP 500' }),
    ]));
    expect(console.error).toHaveBeenCalled();
  });

  it('crm: contact upsert failure stops the chain (no company/note) and reports error', async () => {
    mockTenant.mockResolvedValue(tenantWith({ hubspot: HS_CRM }));
    const client = fakeClient({ upsertContact: vi.fn().mockRejectedValue(Object.assign(new Error('403 scopes'), { status: 403 })) });
    const r = await routeReply(input('positive'), depsWith(client).deps);
    expect(r.hubspot.status).toBe('error');
    expect(client.upsertCompany).not.toHaveBeenCalled();
    expect(client.createNote).not.toHaveBeenCalled();
  });

  it('crm: company/note failures are best-effort — contact still counts as ok', async () => {
    mockTenant.mockResolvedValue(tenantWith({ hubspot: HS_CRM }));
    const client = fakeClient({
      upsertCompany: vi.fn().mockRejectedValue(new Error('search 403')),
      createNote: vi.fn().mockRejectedValue(new Error('note 400')),
    });
    const r = await routeReply(input('positive'), depsWith(client).deps);
    expect(r.hubspot).toEqual({ status: 'ok', hubspotId: '501' });
    expect(syncLogRows().map((x) => `${x.action}:${x.status}`)).toEqual(expect.arrayContaining([
      'contact_upsert:ok', 'company_upsert:error', 'note_create:error',
    ]));
  });

  it('Resend failure is logged as error, HubSpot still runs, nothing throws', async () => {
    mockTenant.mockResolvedValue(tenantWith({ hubspot: HS_FORM, reply_forward: FORWARD_ROBERT }));
    mockSend.mockRejectedValue(new Error('Resend down'));
    const client = fakeClient();
    const r = await routeReply(input('positive'), depsWith(client).deps);
    expect(r.forward).toEqual({ status: 'error', detail: 'Robert.Belmonte@tecnocim.com: Resend down' });
    expect(r.hubspot.status).toBe('ok');
    expect(client.submitForm).toHaveBeenCalledTimes(1);
  });

  it('crm without a usable token: error, no client call', async () => {
    mockTenant.mockResolvedValue(tenantWith({ hubspot: { mode: 'crm', owner_id: '1' } }));
    const client = fakeClient();
    const r = await routeReply(input('positive'), depsWith(client).deps);
    expect(r.hubspot).toEqual({ status: 'error', detail: 'access_token missing' });
    expect(client.upsertContact).not.toHaveBeenCalled();
  });

  it('a DB crash inside routing is swallowed and reported as error', async () => {
    mockTenant.mockResolvedValue(tenantWith({ hubspot: HS_FORM }));
    mockQuery.mockRejectedValue(new Error('ECONNRESET'));
    const r = await routeReply(input('positive'), depsWith(fakeClient()).deps);
    expect(r.forward.status).toBe('error');
    expect(r.hubspot.status).toBe('error');
  });

  it('idempotent: actions already ok for this event are skipped', async () => {
    mockTenant.mockResolvedValue(tenantWith({ hubspot: HS_FORM, reply_forward: FORWARD_ROBERT }));
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM prospects p')) return [PROSPECT_ROW];
      if (sql.includes('SELECT id FROM hubspot_sync_log')) return [{ id: 'done' }];
      return { affectedRows: 1 };
    });
    const client = fakeClient();
    const r = await routeReply(input('positive'), depsWith(client).deps);
    expect(r.forward).toEqual({ status: 'skipped', detail: 'already forwarded' });
    expect(r.hubspot).toEqual({ status: 'skipped', detail: 'already synced' });
    expect(mockSend).not.toHaveBeenCalled();
    expect(client.submitForm).not.toHaveBeenCalled();
  });
});

describe('buildForwardEmail', () => {
  it('escapes HTML in the reply body and falls back to the email as display name', () => {
    const p = { ...PROSPECT_ROW, first_name: null, last_name: null, full_name: null, title: null, phone: null, linkedin_url: null, company_name: null, campaign_name: null, step_number: null };
    const { subject, html } = buildForwardEmail(input('other', { snippet: '<script>alert(1)</script> & co' }), p as any, 'Tecnocim Innova');
    expect(subject).toBe('[ABM] Resposta de ana.perez@acme.com (—)');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
    expect(html).toContain('Sin campaña identificada');
  });
});
