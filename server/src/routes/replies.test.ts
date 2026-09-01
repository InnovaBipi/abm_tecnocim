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

vi.mock('../services/replies', () => ({
  recordReply: vi.fn(),
}));

import { query } from '../config/database';
import { recordReply } from '../services/replies';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockRecordReply = recordReply as ReturnType<typeof vi.fn>;

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

describe('POST /api/replies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordReply.mockResolvedValue({
      eventId: 'event-new',
      prospectStatus: 'unsubscribed',
      doNotContact: true,
      enrollmentsStopped: 1,
      scheduledCancelled: 2,
    });
  });

  const post = (server: TestServer, body: any) =>
    server.fetch('/api/replies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('records a manual reply and returns the pipeline actions', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 'prospect-1', email: 'ceo@acme.com' }]) // prospect lookup
      .mockResolvedValueOnce([]); // dedupe check: none in 24h

    const server = await createTestServer();
    try {
      const res = await post(server, {
        prospect_email: 'CEO@acme.com',
        classification: 'negative',
        subject: 'RE: baja',
        received_by: 'robert.belmonte@tecnocim.com',
      });
      const body: any = await res.json();

      expect(res.status).toBe(201);
      expect(body.data.actions).toEqual({
        prospect_status: 'unsubscribed',
        do_not_contact: true,
        enrollments_stopped: 1,
        scheduled_emails_cancelled: 2,
      });
      // Email lookup lowercased and tenant-scoped
      expect(mockQuery.mock.calls[0][1]).toEqual(['ceo@acme.com', 'test-tenant-id']);
      expect(mockRecordReply).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 'test-tenant-id',
        prospectId: 'prospect-1',
        classification: 'negative',
        source: 'manual',
        receivedBy: 'robert.belmonte@tecnocim.com',
        recordedBy: 'test-user-id',
      }));
    } finally {
      await server.close();
    }
  });

  it('404 when the prospect does not exist in the tenant', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const server = await createTestServer();
    try {
      const res = await post(server, { prospect_email: 'ghost@nowhere.com', classification: 'positive' });
      expect(res.status).toBe(404);
      expect(mockRecordReply).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it('400 without prospect_id/prospect_email or with bad classification', async () => {
    const server = await createTestServer();
    try {
      const noProspect = await post(server, { classification: 'positive' });
      expect(noProspect.status).toBe(400);
      const badClass = await post(server, { prospect_email: 'a@b.com', classification: 'spam' });
      expect(badClass.status).toBe(400);
      expect(mockRecordReply).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it('409 on duplicate within 24h; force:true bypasses the dedupe', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 'prospect-1', email: 'ceo@acme.com' }])
      .mockResolvedValueOnce([{ id: 'event-old' }]); // existing reply in 24h

    const server = await createTestServer();
    try {
      const dup = await post(server, { prospect_email: 'ceo@acme.com', classification: 'positive' });
      const dupBody: any = await dup.json();
      expect(dup.status).toBe(409);
      expect(dupBody.data.existing_event_id).toBe('event-old');
      expect(mockRecordReply).not.toHaveBeenCalled();

      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce([{ id: 'prospect-1', email: 'ceo@acme.com' }]);
      const forced = await post(server, { prospect_email: 'ceo@acme.com', classification: 'positive', force: true });
      expect(forced.status).toBe(201);
      expect(mockRecordReply).toHaveBeenCalledTimes(1);
      // With force, the dedupe SELECT is skipped entirely
      expect(mockQuery).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  });
});

describe('PATCH /api/replies/:eventId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const patch = (server: TestServer, id: string, body: any) =>
    server.fetch(`/api/replies/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('rewrites the classification, tenant-scoped, on replied events only', async () => {
    mockQuery.mockResolvedValueOnce({ affectedRows: 1 });

    const server = await createTestServer();
    try {
      const res = await patch(server, 'event-1', { classification: 'positive' });
      const body: any = await res.json();

      expect(res.status).toBe(200);
      expect(body.data).toEqual({ event_id: 'event-1', classification: 'positive' });

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('$.reply_classification');
      expect(sql).toContain('tenant_id = ?');
      expect(sql).toContain("event_type = 'replied'");
      expect(params).toEqual(['positive', 'event-1', 'test-tenant-id']);
    } finally {
      await server.close();
    }
  });

  it('404s when the event belongs to another tenant or does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ affectedRows: 0 });

    const server = await createTestServer();
    try {
      const res = await patch(server, 'event-other-tenant', { classification: 'other' });
      expect(res.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('rejects an unknown classification without touching the database', async () => {
    const server = await createTestServer();
    try {
      const res = await patch(server, 'event-1', { classification: 'interested' });
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});
