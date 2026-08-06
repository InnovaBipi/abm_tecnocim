/**
 * Tests for server/src/routes/replies.ts
 *
 * Same strategy as prospects.test.ts: mount the router in a minimal Express
 * app and call it via http.createServer + native fetch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'node:http';
import express from 'express';

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

import { query } from '../config/database';

const mockQuery = query as ReturnType<typeof vi.fn>;

interface TestServer {
  fetch: (path: string, options?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
}

async function createTestServer(): Promise<TestServer> {
  const { default: repliesRouter } = await import('./replies');
  const app = express();
  app.use(express.json());
  app.use('/api/replies', repliesRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;

  return {
    fetch: (path, options) => fetch(`${base}${path}`, options),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const sampleRow = {
  id: 'event-1',
  prospect_id: 'prospect-1',
  subject: 'RE: Oportunidad',
  metadata: JSON.stringify({
    source: 'imap',
    from: 'oriol@lallavedeoro.com',
    reply_classification: 'positive',
    reply_snippet: 'Nos interesa, envíame más información.',
    match_type: 'domain',
  }),
  occurred_at: '2026-08-03 10:00:00',
  prospect_email: 'comercial@lallavedeoro.com',
  first_name: null,
  last_name: null,
  full_name: 'La Llave de Oro',
  prospect_status: 'replied',
  do_not_contact: 0,
  company_name: 'La Llave de Oro',
};

describe('GET /api/replies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists replies with tenant filter and parsed metadata', async () => {
    mockQuery
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([sampleRow]);

    const server = await createTestServer();
    try {
      const res = await server.fetch('/api/replies');
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.pagination.total).toBe(1);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        prospect_email: 'comercial@lallavedeoro.com',
        reply_from: 'oriol@lallavedeoro.com',
        reply_classification: 'positive',
        reply_snippet: 'Nos interesa, envíame más información.',
        match_type: 'domain',
      });

      // Both queries must be tenant-scoped
      for (const call of mockQuery.mock.calls) {
        expect(call[0]).toContain('tenant_id');
        expect(call[1]).toContain('test-tenant-id');
      }
    } finally {
      await server.close();
    }
  });

  it('applies since filter and rejects malformed dates', async () => {
    mockQuery.mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);

    const server = await createTestServer();
    try {
      const ok = await server.fetch('/api/replies?since=2026-07-01');
      expect(ok.status).toBe(200);
      expect(mockQuery.mock.calls[0][0]).toContain('occurred_at >=');
      expect(mockQuery.mock.calls[0][1]).toContain('2026-07-01');

      const bad = await server.fetch('/api/replies?since=julio');
      expect(bad.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it('rejects unknown classification values', async () => {
    const server = await createTestServer();
    try {
      const res = await server.fetch('/api/replies?classification=spam');
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});
