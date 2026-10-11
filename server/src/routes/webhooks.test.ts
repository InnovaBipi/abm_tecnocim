/**
 * Tests for server/src/routes/webhooks.ts — Resend webhook attribution.
 *
 * The case that matters: a tenant that shares its Resend account with other
 * apps (New Brokers: website + client portal). Its own webhook receives events
 * for mail the ABM never sent, and those must not touch any prospect.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';

const TENANT_SECRET = 'whsec_' + Buffer.from('tenant-secret-0005').toString('base64');
const GLOBAL_SECRET = 'whsec_' + Buffer.from('global-secret').toString('base64');

vi.mock('../config/database', () => ({
  query: vi.fn(),
}));

vi.mock('../config/env', () => ({
  config: { NODE_ENV: 'production', RESEND_WEBHOOK_SECRET: GLOBAL_SECRET },
}));

vi.mock('../middleware/tenant', () => ({
  getAllActiveTenants: vi.fn(),
}));

import { query } from '../config/database';
import { getAllActiveTenants } from '../middleware/tenant';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockTenants = getAllActiveTenants as ReturnType<typeof vi.fn>;

async function createTestServer() {
  const { default: webhooksRouter } = await import('./webhooks');
  const app = express();
  app.use(express.json({
    verify: (req: any, _res, buf) => { req.rawBody = buf.toString('utf8'); },
  }));
  app.use('/api/webhooks', webhooksRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    post: (body: object, secret: string) => {
      const raw = JSON.stringify(body);
      const id = 'msg_1';
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = crypto
        .createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64'))
        .update(`${id}.${ts}.${raw}`)
        .digest('base64');
      return fetch(`http://127.0.0.1:${port}/api/webhooks/resend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'svix-id': id,
          'svix-timestamp': ts,
          'svix-signature': `v1,${sig}`,
        },
        body: raw,
      });
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const bounce = {
  type: 'email.bounced',
  data: { email_id: 'resend-unknown', to: ['cliente@rhenus.example'], subject: 'Tu código de acceso' },
};

/** Route each SQL to a canned result; record everything that was run. */
function routeQueries(opts: { emailEvent?: object | null; prospect?: object | null }) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM email_events')) return opts.emailEvent ? [opts.emailEvent] : [];
    if (sql.includes('FROM prospects WHERE email')) return opts.prospect ? [opts.prospect] : [];
    return [];
  });
}

const writes = () =>
  mockQuery.mock.calls
    .map(([sql]) => String(sql))
    .filter((sql) => /^\s*(INSERT|UPDATE)/i.test(sql));

describe('POST /api/webhooks/resend — attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTenants.mockResolvedValue([
      { id: 'tenant-newbrokers-0005', config: { email: { webhook_secret: TENANT_SECRET } } },
      { id: 'tenant-tecnocim-0003', config: { email: {} } },
    ]);
  });

  it('ignores mail the ABM did not send when signed by a tenant webhook', async () => {
    routeQueries({ emailEvent: null, prospect: { id: 'p-other', tenant_id: 'tenant-tecnocim-0003' } });
    const srv = await createTestServer();
    const res = await srv.post(bounce, TENANT_SECRET);
    const body: any = await res.json();
    await srv.close();

    expect(res.status).toBe(200);
    expect(body.skipped).toBe('email not sent by the ABM');
    // Never looked the recipient up across tenants, never wrote anything
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('FROM prospects WHERE email'))).toBe(false);
    expect(writes()).toEqual([]);
  });

  it('still processes ABM mail signed by a tenant webhook (resend_email_id match)', async () => {
    routeQueries({
      emailEvent: { prospect_id: 'p-nb', sequence_id: null, enrollment_id: null, step_id: null, tenant_id: 'tenant-newbrokers-0005' },
    });
    const srv = await createTestServer();
    const res = await srv.post({ ...bounce, data: { ...bounce.data, email_id: 'resend-abm' } }, TENANT_SECRET);
    const body: any = await res.json();
    await srv.close();

    expect(body.event).toBe('bounced');
    expect(body.prospect_id).toBe('p-nb');
    const suppression = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT IGNORE INTO suppression_list'));
    expect(suppression?.[1]).toContain('tenant-newbrokers-0005');
  });

  it('keeps the legacy recipient fallback for events signed with the global secret', async () => {
    routeQueries({ emailEvent: null, prospect: { id: 'p-legacy', tenant_id: 'tenant-tecnocim-0003' } });
    const srv = await createTestServer();
    const res = await srv.post(bounce, GLOBAL_SECRET);
    const body: any = await res.json();
    await srv.close();

    expect(body.event).toBe('bounced');
    expect(body.prospect_id).toBe('p-legacy');
  });

  it('asks Svix to retry a fresh unmatched bounce (send row may not be written yet)', async () => {
    routeQueries({ emailEvent: null });
    const srv = await createTestServer();
    const fresh = { ...bounce, data: { ...bounce.data, created_at: new Date().toISOString() } };
    const res = await srv.post(fresh, TENANT_SECRET);
    await srv.close();

    expect(res.status).toBe(503);
    expect(writes()).toEqual([]);
  });

  it('drops an old unmatched bounce instead of retrying it', async () => {
    routeQueries({ emailEvent: null });
    const srv = await createTestServer();
    const old = { ...bounce, data: { ...bounce.data, created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() } };
    const res = await srv.post(old, TENANT_SECRET);
    await srv.close();

    expect(res.status).toBe(200);
    expect(writes()).toEqual([]);
  });

  it('treats a tenant secret equal to the global one as global (keeps the fallback)', async () => {
    mockTenants.mockResolvedValue([
      { id: 'tenant-technova-0002', config: { email: { webhook_secret: GLOBAL_SECRET } } },
    ]);
    routeQueries({ emailEvent: null, prospect: { id: 'p-legacy', tenant_id: 'tenant-technova-0002' } });
    const srv = await createTestServer();
    const res = await srv.post(bounce, GLOBAL_SECRET);
    const body: any = await res.json();
    await srv.close();

    expect(body.prospect_id).toBe('p-legacy');
  });

  it('rejects an event signed with an unknown secret', async () => {
    routeQueries({});
    const srv = await createTestServer();
    const res = await srv.post(bounce, 'whsec_' + Buffer.from('someone-else').toString('base64'));
    await srv.close();

    expect(res.status).toBe(401);
    expect(writes()).toEqual([]);
  });
});
