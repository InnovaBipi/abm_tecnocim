/**
 * Tenant isolation tests for server/src/routes/prospects.ts
 *
 * These tests verify the CRITICAL multi-tenancy guarantee: every query is
 * scoped by `tenant_id`, and a resource belonging to another tenant is not
 * reachable (returns 404, never another tenant's data).
 *
 * Strategy mirrors auth.test.ts: mock ../config/database, override the
 * authenticate middleware to inject a fixed req.user, and mount the router in
 * a minimal Express app driven via Node's native http server + fetch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'node:http';
import express from 'express';

// --- Mocks declared before any import that triggers them ---

vi.mock('../config/database', () => ({
  query: vi.fn(),
}));

// authenticate always injects the SAME tenant — this is the tenant whose data
// the caller is allowed to see. Anything scoped to another tenant must be invisible.
vi.mock('../middleware/auth', () => ({
  authenticate: vi.fn((req: any, _res: any, next: () => void) => {
    req.user = {
      id: 'test-user-id',
      email: 'test@tecnocim.com',
      role: 'admin',
      tenantId: TENANT_A,
    };
    next();
  }),
}));

// --- Imports after mock declarations ---
import { query } from '../config/database';

const mockQuery = query as ReturnType<typeof vi.fn>;

// Fixed tenants for the isolation assertions.
const TENANT_A = 'tenant-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'tenant-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTHER_TENANT_PROSPECT_ID = '11111111-1111-1111-1111-111111111111';

// ---------------------------------------------------------------------------------
// Minimal HTTP test server helper (same shape as auth.test.ts)
// ---------------------------------------------------------------------------------

interface TestServer {
  fetch: (path: string, options?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
}

async function createTestServer(): Promise<TestServer> {
  const { default: prospectsRouter } = await import('./prospects');
  const app = express();
  app.use(express.json());
  app.use('/api/prospects', prospectsRouter);

  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;

  return {
    fetch: (path, options) => fetch(`${base}${path}`, options),
    close: () => new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------------
// GET /api/prospects — list must be scoped to the caller's tenant
// ---------------------------------------------------------------------------------

describe('GET /api/prospects — tenant isolation', () => {
  it('filters every query by tenant_id using the JWT tenantId', async () => {
    const srv = await createTestServer();

    // First call = COUNT(*), second = SELECT list. Both must carry tenant_id.
    mockQuery
      .mockResolvedValueOnce([{ total: 0 }]) // count query
      .mockResolvedValueOnce([]); // list query

    const res = await srv.fetch('/api/prospects?page=1&limit=25');
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    // Every SQL call issued by the handler must filter by tenant_id and pass TENANT_A.
    for (const call of mockQuery.mock.calls) {
      const [sql, params] = call as [string, unknown[]];
      expect(sql).toContain('tenant_id');
      expect(params).toEqual(expect.arrayContaining([TENANT_A]));
    }

    // And the caller's tenant_id must never be substituted by another tenant.
    for (const call of mockQuery.mock.calls) {
      const [, params] = call as [string, unknown[]];
      expect(params).not.toEqual(expect.arrayContaining([TENANT_B]));
    }

    await srv.close();
  });
});

// ---------------------------------------------------------------------------------
// GET /api/prospects/:id — cross-tenant access must 404 (never leak existence)
// ---------------------------------------------------------------------------------

describe('GET /api/prospects/:id — cross-tenant access', () => {
  it('returns 404 when the prospect belongs to another tenant', async () => {
    const srv = await createTestServer();

    // The prospect exists in TENANT_B, but the scoped lookup (tenant_id = TENANT_A)
    // returns no rows — exactly what a cross-tenant request must observe.
    mockQuery.mockResolvedValueOnce([]); // scoped SELECT finds nothing for TENANT_A

    const res = await srv.fetch(`/api/prospects/${OTHER_TENANT_PROSPECT_ID}`);
    const body = await res.json() as any;

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Prospect not found.');

    // The single lookup performed must be scoped to TENANT_A and the requested id.
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('tenant_id');
    expect(params).toEqual(expect.arrayContaining([OTHER_TENANT_PROSPECT_ID, TENANT_A]));
    // No response/body must ever carry the foreign tenant id.
    expect(JSON.stringify(body)).not.toContain(TENANT_B);

    await srv.close();
  });
});

// ---------------------------------------------------------------------------------
// DELETE /api/prospects/:id — bulk/single mutations stay tenant-scoped
// ---------------------------------------------------------------------------------

describe('DELETE /api/prospects/:id — tenant isolation', () => {
  it('returns 404 and never deletes a foreign-tenant prospect', async () => {
    const srv = await createTestServer();

    // Existence check is tenant-scoped → no rows for TENANT_A → 404, no DELETE issued.
    mockQuery.mockResolvedValueOnce([]);

    const res = await srv.fetch(`/api/prospects/${OTHER_TENANT_PROSPECT_ID}`, {
      method: 'DELETE',
    });
    const body = await res.json() as any;

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);

    // Only the scoped existence SELECT ran; no DELETE was reached.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('tenant_id');
    expect(params).toEqual(expect.arrayContaining([OTHER_TENANT_PROSPECT_ID, TENANT_A]));

    await srv.close();
  });
});
