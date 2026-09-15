/**
 * Tests for server/src/services/hubspot.ts — fetch-based HubSpot client.
 * No network: a fake fetch records every call and replays scripted responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HubSpotClient, HubSpotError, parseExistingId, domainOf, isFreeMailDomain } from './hubspot';

type Scripted = { status: number; body?: unknown };

function fakeFetch(script: Scripted[]) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: any }> = [];
  const impl = vi.fn(async (url: string, init: any) => {
    calls.push({
      url,
      method: init?.method,
      headers: init?.headers || {},
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    const next = script.shift();
    if (!next) throw new Error(`fakeFetch: no scripted response for ${init?.method} ${url}`);
    const text = next.body === undefined ? '' : (typeof next.body === 'string' ? next.body : JSON.stringify(next.body));
    return { status: next.status, ok: next.status >= 200 && next.status < 300, text: async () => text } as any;
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

function client(f: typeof fetch, extra: Partial<ConstructorParameters<typeof HubSpotClient>[0]> = {}) {
  return new HubSpotClient({ accessToken: 'pat-test', fetchImpl: f, retryDelayMs: 0, timeoutMs: 500, ...extra });
}

beforeEach(() => vi.clearAllMocks());

describe('helpers', () => {
  it('parseExistingId reads the id out of a 409 body', () => {
    expect(parseExistingId(JSON.stringify({ message: 'Contact already exists. Existing ID: 98765' }))).toBe('98765');
    expect(parseExistingId('Existing ID: 42')).toBe('42');
    expect(parseExistingId(JSON.stringify({ message: 'nope' }))).toBeNull();
  });

  it('domainOf normalises emails and URLs', () => {
    expect(domainOf('Ana@Acme.COM')).toBe('acme.com');
    expect(domainOf('https://www.acme.com/about')).toBe('acme.com');
    expect(domainOf('acme')).toBeNull();
    expect(domainOf(null)).toBeNull();
    expect(isFreeMailDomain('gmail.com')).toBe(true);
    expect(isFreeMailDomain('acme.com')).toBe(false);
  });
});

describe('form mode: submitForm', () => {
  it('posts the website-form payload to the public Forms API without auth', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { inlineMessage: 'Thanks' } }]);
    const c = new HubSpotClient({ fetchImpl: impl, retryDelayMs: 0 }); // no token on purpose

    const res = await c.submitForm({
      portalId: '145850079',
      formGuid: '9c812eca-b6fb-4c2e-b2c9-5623008cfc0c',
      fields: [
        { objectTypeId: '0-1', name: 'email', value: 'ana@acme.com' },
        { objectTypeId: '0-1', name: 'firstname', value: 'Ana' },
        { objectTypeId: '0-1', name: 'lastname', value: 'Pérez' },
        { objectTypeId: '0-1', name: 'phone', value: '' },            // dropped
        { objectTypeId: '0-1', name: 'company', value: 'Acme' },
        { objectTypeId: '0-1', name: 'message', value: 'Sí, hablemos' },
        { objectTypeId: '0-2', name: 'name', value: 'Acme' },
        { objectTypeId: '0-2', name: 'necesidad', value: 'ABM · Respuesta a campaña X' },
      ],
      context: { pageUri: 'https://abm.tecnociminnova.com/prospects/p1', pageName: 'ABM' },
      consentText: 'interés legítimo',
    });

    expect(res.inlineMessage).toBe('Thanks');
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe('https://api.hsforms.com/submissions/v3/integration/submit/145850079/9c812eca-b6fb-4c2e-b2c9-5623008cfc0c');
    expect(call.method).toBe('POST');
    expect(call.headers.Authorization).toBeUndefined();
    expect(call.body.fields.map((f: any) => f.name)).toEqual(['email', 'firstname', 'lastname', 'company', 'message', 'name', 'necesidad']);
    expect(call.body.fields.find((f: any) => f.name === 'necesidad').objectTypeId).toBe('0-2');
    expect(call.body.context).toEqual({ pageUri: 'https://abm.tecnociminnova.com/prospects/p1', pageName: 'ABM' });
    expect(call.body.legalConsentOptions.consent.consentToProcess).toBe(true);
    expect(typeof call.body.submittedAt).toBe('string');
  });

  it('throws HubSpotError with the status on a 4xx', async () => {
    const { impl } = fakeFetch([{ status: 400, body: { status: 'error', message: 'Bad form guid' } }]);
    const c = new HubSpotClient({ fetchImpl: impl, retryDelayMs: 0 });
    await expect(c.submitForm({ portalId: '1', formGuid: 'x', fields: [] })).rejects.toMatchObject({ name: 'HubSpotError', status: 400 });
  });
});

describe('crm mode: upsertContact', () => {
  it('creates the contact (201) with the lead properties and a bearer token', async () => {
    const { impl, calls } = fakeFetch([{ status: 201, body: { id: '501' } }]);
    const r = await client(impl).upsertContact({
      email: 'ana@acme.com', firstname: 'Ana', lastname: 'Pérez', phone: undefined,
      lifecyclestage: 'lead', hs_lead_status: 'NEW', hubspot_owner_id: '34489913',
    });
    expect(r).toEqual({ id: '501', created: true });
    expect(calls[0].url).toBe('https://api.hubapi.com/crm/v3/objects/contacts');
    expect(calls[0].headers.Authorization).toBe('Bearer pat-test');
    expect(calls[0].body.properties).toEqual({
      email: 'ana@acme.com', firstname: 'Ana', lastname: 'Pérez',
      lifecyclestage: 'lead', hs_lead_status: 'NEW', hubspot_owner_id: '34489913',
    });
  });

  it('409 → PATCH the existing id, without touching lifecyclestage', async () => {
    const { impl, calls } = fakeFetch([
      { status: 409, body: { status: 'error', message: 'Contact already exists. Existing ID: 777' } },
      { status: 200, body: { id: '777' } },
    ]);
    const r = await client(impl).upsertContact({
      email: 'ana@acme.com', firstname: 'Ana', lifecyclestage: 'lead', hs_lead_status: 'NEW', hubspot_owner_id: '1',
    });
    expect(r).toEqual({ id: '777', created: false });
    expect(calls).toHaveLength(2);
    expect(calls[1].method).toBe('PATCH');
    expect(calls[1].url).toBe('https://api.hubapi.com/crm/v3/objects/contacts/777');
    expect(calls[1].body.properties).toEqual({ email: 'ana@acme.com', firstname: 'Ana', hs_lead_status: 'NEW', hubspot_owner_id: '1' });
  });

  it('403 (missing scope) surfaces as HubSpotError 403', async () => {
    const { impl } = fakeFetch([{ status: 403, body: { message: 'This app hasn\'t been granted all required scopes' } }]);
    await expect(client(impl).upsertContact({ email: 'a@b.com' })).rejects.toMatchObject({ status: 403 });
  });

  it('refuses to run without a token', async () => {
    const { impl, calls } = fakeFetch([]);
    const c = new HubSpotClient({ fetchImpl: impl });
    await expect(c.upsertContact({ email: 'a@b.com' })).rejects.toBeInstanceOf(HubSpotError);
    expect(calls).toHaveLength(0);
  });
});

describe('crm mode: company, association, note', () => {
  it('upsertCompany: search hit → PATCH, search miss → POST', async () => {
    const hit = fakeFetch([
      { status: 200, body: { results: [{ id: '9001', properties: { domain: 'acme.com' } }] } },
      { status: 200, body: { id: '9001' } },
    ]);
    const r1 = await client(hit.impl).upsertCompany({ domain: 'acme.com', name: 'Acme' });
    expect(r1).toEqual({ id: '9001', created: false });
    expect(hit.calls[0].url).toBe('https://api.hubapi.com/crm/v3/objects/companies/search');
    expect(hit.calls[0].body.filterGroups[0].filters[0]).toEqual({ propertyName: 'domain', operator: 'EQ', value: 'acme.com' });
    expect(hit.calls[1].method).toBe('PATCH');
    expect(hit.calls[1].body.properties).toEqual({ name: 'Acme' });

    const miss = fakeFetch([
      { status: 200, body: { results: [] } },
      { status: 201, body: { id: '9002' } },
    ]);
    const r2 = await client(miss.impl).upsertCompany({ domain: 'new.com', name: 'New' });
    expect(r2).toEqual({ id: '9002', created: true });
    expect(miss.calls[1].method).toBe('POST');
    expect(miss.calls[1].body.properties).toEqual({ domain: 'new.com', name: 'New' });
  });

  it('associates contact→company via the v4 default association', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: {} }]);
    await client(impl).associateContactWithCompany('501', '9001');
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe('https://api.hubapi.com/crm/v4/objects/contacts/501/associations/default/companies/9001');
  });

  it('createNote attaches the note to the contact (association 202) with the owner', async () => {
    const { impl, calls } = fakeFetch([{ status: 201, body: { id: '31' } }]);
    const id = await client(impl).createNote('501', 'Respondió: sí', '34489913');
    expect(id).toBe('31');
    expect(calls[0].url).toBe('https://api.hubapi.com/crm/v3/objects/notes');
    expect(calls[0].body.properties.hs_note_body).toBe('Respondió: sí');
    expect(calls[0].body.properties.hubspot_owner_id).toBe('34489913');
    expect(calls[0].body.associations[0]).toEqual({
      to: { id: '501' },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
    });
  });

  it('hasContactProperty caches and treats 404 as absent', async () => {
    const { impl, calls } = fakeFetch([{ status: 404, body: {} }]);
    const c = client(impl);
    expect(await c.hasContactProperty('abm_source')).toBe(false);
    expect(await c.hasContactProperty('abm_source')).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('honours a custom apiBase (EU data residency)', async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { results: [] } }]);
    await client(impl, { apiBase: 'https://api-eu1.hubapi.com' }).ping();
    expect(calls[0].url).toBe('https://api-eu1.hubapi.com/crm/v3/objects/contacts?limit=1');
  });
});

describe('transport', () => {
  it('retries once on 5xx then succeeds', async () => {
    const { impl, calls } = fakeFetch([{ status: 502, body: 'bad gateway' }, { status: 200, body: { results: [] } }]);
    await client(impl).ping();
    expect(calls).toHaveLength(2);
  });

  it('retries once on 429 and then gives up with the last status', async () => {
    const { impl, calls } = fakeFetch([{ status: 429, body: {} }, { status: 429, body: {} }]);
    await expect(client(impl).ping()).rejects.toMatchObject({ status: 429 });
    expect(calls).toHaveLength(2);
  });

  it('does not retry a 4xx', async () => {
    const { impl, calls } = fakeFetch([{ status: 401, body: {} }]);
    await expect(client(impl).ping()).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(1);
  });

  it('times out and reports it as a HubSpotError', async () => {
    const never = vi.fn((_url: string, init: any) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const c = new HubSpotClient({ accessToken: 't', fetchImpl: never as any, timeoutMs: 10, retries: 0 });
    await expect(c.ping()).rejects.toThrow(/timed out/);
  });
});
