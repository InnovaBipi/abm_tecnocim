/**
 * Tests for server/src/routes/prospects.ts
 *
 * Strategy: mount the router in a minimal Express app and call it via Node's
 * built-in http.createServer + native fetch (Node 18+).
 * No supertest dependency required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'node:http';
import express from 'express';
import type { Request, Response } from 'express';

// --- Mocks declared before any import that triggers them ---

vi.mock('../config/database', () => ({
  query: vi.fn(),
}));

vi.mock('../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth')>();
  return {
    ...actual,
    authenticate: vi.fn((req: any, _res: any, next: () => void) => {
      req.user = {
        id: 'test-user-id',
        email: 'test@tecnocim.com',
        role: 'admin',
        tenantId: 'test-tenant-id',
      };
      next();
    }),
  };
});

// --- Imports after mocks ---
import { query } from '../config/database';

const mockQuery = query as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------------
// HTTP test server helper
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

function postJSON(srv: TestServer, path: string, body: unknown) {
  return srv.fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function putJSON(srv: TestServer, path: string, body: unknown) {
  return srv.fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------

const TENANT_ID = 'test-tenant-id';

const mockProspect = {
  id: 'prospect-uuid-001',
  tenant_id: TENANT_ID,
  email: 'john.doe@example.com',
  first_name: 'John',
  last_name: 'Doe',
  title: 'CTO',
  status: 'new',
  lead_score: 70,
  created_at: '2025-01-01T00:00:00Z',
  company_name: 'Acme Corp',
  company_domain: 'acme.com',
  company_tier: 'A',
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------------
// GET /api/prospects — list with pagination
// ---------------------------------------------------------------------------------

describe('GET /api/prospects', () => {
  it('returns a paginated list filtered by tenant_id', async () => {
    const srv = await createTestServer();

    mockQuery
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([mockProspect]);

    const res = await srv.fetch('/api/prospects');
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.prospects).toHaveLength(1);
    expect(body.data.prospects[0].email).toBe('john.doe@example.com');
    expect(body.data.pagination.total).toBe(1);

    await srv.close();
  });

  it('includes tenant_id in both COUNT and SELECT queries', async () => {
    const srv = await createTestServer();

    mockQuery
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);

    await srv.fetch('/api/prospects');

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('tenant_id'),
      expect.arrayContaining([TENANT_ID])
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('tenant_id'),
      expect.arrayContaining([TENANT_ID])
    );

    await srv.close();
  });

  it('returns empty prospects array when no records exist', async () => {
    const srv = await createTestServer();

    mockQuery
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);

    const res = await srv.fetch('/api/prospects');
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.data.prospects).toHaveLength(0);
    expect(body.data.pagination.total).toBe(0);
    expect(body.data.pagination.totalPages).toBe(0);

    await srv.close();
  });

  it('respects page and limit query parameters', async () => {
    const srv = await createTestServer();

    mockQuery
      .mockResolvedValueOnce([{ total: 50 }])
      .mockResolvedValueOnce([mockProspect]);

    const res = await srv.fetch('/api/prospects?page=2&limit=10');
    const body = await res.json() as any;

    expect(body.data.pagination.page).toBe(2);
    expect(body.data.pagination.limit).toBe(10);
    expect(body.data.pagination.totalPages).toBe(5);

    // SELECT query: LIMIT=10, OFFSET=10 (page 2)
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.arrayContaining([10, 10])
    );

    await srv.close();
  });
});

// ---------------------------------------------------------------------------------
// POST /api/prospects — create
// ---------------------------------------------------------------------------------

describe('POST /api/prospects', () => {
  it('creates a prospect with correct tenant_id', async () => {
    const srv = await createTestServer();

    mockQuery
      .mockResolvedValueOnce([])                    // duplicate check: none found
      .mockResolvedValueOnce({ affectedRows: 1 })   // INSERT prospect
      .mockResolvedValueOnce({ affectedRows: 1 })   // INSERT activity
      .mockResolvedValueOnce([{ ...mockProspect }]); // SELECT created

    const res = await postJSON(srv, '/api/prospects', {
      email: 'john.doe@example.com',
      first_name: 'John',
      last_name: 'Doe',
    });
    const body = await res.json() as any;

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);

    // INSERT must include tenant_id
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('tenant_id'),
      expect.arrayContaining([TENANT_ID])
    );

    await srv.close();
  });

  it('returns 409 when a prospect with the same email already exists in the tenant', async () => {
    const srv = await createTestServer();

    mockQuery.mockResolvedValueOnce([{ id: 'existing-id' }]);

    const res = await postJSON(srv, '/api/prospects', { email: 'john.doe@example.com' });
    const body = await res.json() as any;

    expect(res.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/already exists/i);

    await srv.close();
  });

  it('returns 400 when email is missing', async () => {
    const srv = await createTestServer();

    const res = await postJSON(srv, '/api/prospects', { first_name: 'John' });
    const body = await res.json() as any;

    expect(res.status).toBe(400);
    expect(body.error).toBe('Validation failed');
    expect(body.details).toHaveProperty('email');

    await srv.close();
  });

  it('returns 400 when email format is invalid', async () => {
    const srv = await createTestServer();

    const res = await postJSON(srv, '/api/prospects', { email: 'not-valid-email' });
    const body = await res.json() as any;

    expect(res.status).toBe(400);
    expect(body.details).toHaveProperty('email');

    await srv.close();
  });

  it('uses tenant_id from req.user in the duplicate-email check', async () => {
    const srv = await createTestServer();

    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([mockProspect]);

    await postJSON(srv, '/api/prospects', { email: 'new@example.com' });

    // First query is the duplicate check — must include tenant_id
    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('tenant_id'),
      expect.arrayContaining([TENANT_ID])
    );

    await srv.close();
  });
});

// ---------------------------------------------------------------------------------
// GET /api/prospects/:id — single prospect
// ---------------------------------------------------------------------------------

describe('GET /api/prospects/:id', () => {
  it('returns the prospect when it belongs to the tenant', async () => {
    const srv = await createTestServer();

    mockQuery
      .mockResolvedValueOnce([mockProspect]) // main SELECT
      .mockResolvedValueOnce([])             // activities
      .mockResolvedValueOnce([]);            // tags

    const res = await srv.fetch(`/api/prospects/${mockProspect.id}`);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.email).toBe('john.doe@example.com');

    await srv.close();
  });

  it('returns 404 when prospect does not belong to the tenant (tenant isolation)', async () => {
    const srv = await createTestServer();

    mockQuery.mockResolvedValueOnce([]); // not found in this tenant

    const res = await srv.fetch('/api/prospects/foreign-prospect-id');
    const body = await res.json() as any;

    expect(res.status).toBe(404);
    expect(body.error).toBe('Prospect not found.');

    await srv.close();
  });

  it('queries with both prospect id AND tenant_id — never allows cross-tenant access', async () => {
    const srv = await createTestServer();

    mockQuery.mockResolvedValueOnce([]);

    await srv.fetch(`/api/prospects/${mockProspect.id}`);

    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('tenant_id'),
      expect.arrayContaining([mockProspect.id, TENANT_ID])
    );

    await srv.close();
  });

  it('includes tenant_id in the activities query', async () => {
    const srv = await createTestServer();

    mockQuery
      .mockResolvedValueOnce([mockProspect])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await srv.fetch(`/api/prospects/${mockProspect.id}`);

    // Second query is activities
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('tenant_id'),
      expect.arrayContaining([TENANT_ID])
    );

    await srv.close();
  });
});

// ---------------------------------------------------------------------------------
// DELETE /api/prospects/:id
// ---------------------------------------------------------------------------------

describe('DELETE /api/prospects/:id', () => {
  it('deletes a prospect that belongs to the tenant', async () => {
    const srv = await createTestServer();

    mockQuery
      .mockResolvedValueOnce([{ id: mockProspect.id }])
      .mockResolvedValueOnce({ affectedRows: 1 });

    const res = await srv.fetch(`/api/prospects/${mockProspect.id}`, { method: 'DELETE' });
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    await srv.close();
  });

  it('returns 404 and does NOT execute DELETE when prospect is in another tenant', async () => {
    const srv = await createTestServer();

    mockQuery.mockResolvedValueOnce([]); // existence check fails

    const res = await srv.fetch('/api/prospects/foreign-id', { method: 'DELETE' });
    const body = await res.json() as any;

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    // Only 1 query called (the existence check), no DELETE executed
    expect(mockQuery).toHaveBeenCalledTimes(1);

    await srv.close();
  });

  it('includes tenant_id in the existence check query', async () => {
    const srv = await createTestServer();

    mockQuery.mockResolvedValueOnce([]);

    await srv.fetch(`/api/prospects/${mockProspect.id}`, { method: 'DELETE' });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('tenant_id'),
      expect.arrayContaining([mockProspect.id, TENANT_ID])
    );

    await srv.close();
  });

  it('includes tenant_id in the actual DELETE query', async () => {
    const srv = await createTestServer();

    mockQuery
      .mockResolvedValueOnce([{ id: mockProspect.id }])
      .mockResolvedValueOnce({ affectedRows: 1 });

    await srv.fetch(`/api/prospects/${mockProspect.id}`, { method: 'DELETE' });

    // Second call is the DELETE statement
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('tenant_id'),
      expect.arrayContaining([mockProspect.id, TENANT_ID])
    );

    await srv.close();
  });
});

// ---------------------------------------------------------------------------------
// PUT /api/prospects/:id — update
// ---------------------------------------------------------------------------------

describe('PUT /api/prospects/:id', () => {
  it('updates a prospect that belongs to the tenant', async () => {
    const srv = await createTestServer();
    const updated = { ...mockProspect, title: 'CEO' };

    mockQuery
      .mockResolvedValueOnce([{ id: mockProspect.id }])  // existence check
      .mockResolvedValueOnce({ affectedRows: 1 })          // UPDATE
      .mockResolvedValueOnce({ affectedRows: 1 })          // activity INSERT
      .mockResolvedValueOnce([updated]);                    // SELECT updated

    const res = await putJSON(srv, `/api/prospects/${mockProspect.id}`, { title: 'CEO' });
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.title).toBe('CEO');

    await srv.close();
  });

  it('returns 404 when prospect does not belong to the tenant', async () => {
    const srv = await createTestServer();

    mockQuery.mockResolvedValueOnce([]);

    const res = await putJSON(srv, '/api/prospects/foreign-id', { title: 'CEO' });
    const body = await res.json() as any;

    expect(res.status).toBe(404);
    expect(body.success).toBe(false);

    await srv.close();
  });

  it('returns 400 when no fields are provided', async () => {
    const srv = await createTestServer();

    mockQuery.mockResolvedValueOnce([{ id: mockProspect.id }]);

    const res = await putJSON(srv, `/api/prospects/${mockProspect.id}`, {});
    const body = await res.json() as any;

    expect(res.status).toBe(400);
    expect(body.error).toBe('No fields to update.');

    await srv.close();
  });

  it('UPDATE query includes tenant_id', async () => {
    const srv = await createTestServer();
    const updated = { ...mockProspect, status: 'enriched' };

    mockQuery
      .mockResolvedValueOnce([{ id: mockProspect.id }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([updated]);

    await putJSON(srv, `/api/prospects/${mockProspect.id}`, { status: 'enriched' });

    // 2nd query is UPDATE
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('tenant_id'),
      expect.arrayContaining([TENANT_ID])
    );

    await srv.close();
  });
});

// ---------------------------------------------------------------------------------
// POST /api/prospects/bulk-delete
// ---------------------------------------------------------------------------------

describe('POST /api/prospects/bulk-delete', () => {
  it('deletes multiple prospects and includes tenant_id in query', async () => {
    const srv = await createTestServer();

    const id1 = '11111111-1111-1111-1111-111111111111';
    const id2 = '22222222-2222-2222-2222-222222222222';

    mockQuery.mockResolvedValueOnce({ affectedRows: 2 });

    const res = await postJSON(srv, '/api/prospects/bulk-delete', { ids: [id1, id2] });
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('tenant_id'),
      expect.arrayContaining([id1, id2, TENANT_ID])
    );

    await srv.close();
  });

  it('returns 400 when ids array is empty', async () => {
    const srv = await createTestServer();

    const res = await postJSON(srv, '/api/prospects/bulk-delete', { ids: [] });
    const body = await res.json() as any;

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);

    await srv.close();
  });

  it('returns 400 when ids field is missing', async () => {
    const srv = await createTestServer();

    const res = await postJSON(srv, '/api/prospects/bulk-delete', {});
    const body = await res.json() as any;

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);

    await srv.close();
  });
});
