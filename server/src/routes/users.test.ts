/**
 * Tests for server/src/routes/users.ts — sender domain validation + /senders endpoint.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'node:http';
import express from 'express';

vi.mock('../config/database', () => ({
  query: vi.fn(),
}));

vi.mock('../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth')>();
  return {
    ...actual,
    authenticate: vi.fn((req: any, _res: any, next: () => void) => {
      req.user = { id: 'test-user-id', email: 'admin@tecnocim.com', role: 'admin', tenantId: 'test-tenant-id' };
      next();
    }),
    requireRole: vi.fn(() => (_req: any, _res: any, next: () => void) => next()),
    hashPassword: vi.fn(async () => 'hashed-password'),
  };
});

// Real domainOf logic, deterministic tenant domain
vi.mock('../services/sender', () => ({
  assertSenderDomainAllowed: vi.fn(async (_tenantId: string, senderEmail: string) => {
    if (!senderEmail.toLowerCase().endsWith('@tecnocim.com')) {
      throw new Error('sender_email debe pertenecer al dominio verificado @tecnocim.com');
    }
  }),
}));

import { query } from '../config/database';

const mockQuery = query as ReturnType<typeof vi.fn>;

interface TestServer {
  fetch: (path: string, options?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
}

async function createTestServer(): Promise<TestServer> {
  const { default: usersRouter } = await import('./users');
  const app = express();
  app.use(express.json());
  app.use('/api/users', usersRouter);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const base = `http://127.0.0.1:${port}`;

  return {
    fetch: (path, options) => fetch(`${base}${path}`, options),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const jsonReq = (body: any, method = 'POST'): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/users — sender domain validation', () => {
  const base = {
    email: 'robert.belmonte@tecnocim.com',
    password: 'Tecnocim2026!',
    first_name: 'Robert',
    last_name: 'Belmonte',
  };

  it('400 when sender_email is on a foreign domain', async () => {
    const server = await createTestServer();
    try {
      const res = await server.fetch('/api/users', jsonReq({ ...base, sender_email: 'robert@gmail.com' }));
      const body: any = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toContain('dominio verificado');
      expect(mockQuery).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it('creates the user when sender_email matches the tenant domain', async () => {
    mockQuery
      .mockResolvedValueOnce([]) // duplicate email check
      .mockResolvedValueOnce({} as any); // INSERT

    const server = await createTestServer();
    try {
      const res = await server.fetch('/api/users', jsonReq({
        ...base,
        sender_email: 'robert.belmonte@tecnocim.com',
        sender_name: 'Robert Belmonte',
      }));
      const body: any = await res.json();
      expect(res.status).toBe(201);
      expect(body.data.sender_email).toBe('robert.belmonte@tecnocim.com');
      const insert = mockQuery.mock.calls.find((c) => (c[0] as string).includes('INSERT INTO users'))!;
      expect(insert[0]).toContain('sender_email');
      expect(insert[1]).toContain('test-tenant-id');
    } finally {
      await server.close();
    }
  });
});

describe('PUT /api/users/:id — sender domain validation', () => {
  it('400 on foreign domain; null (clear) is allowed', async () => {
    const server = await createTestServer();
    try {
      const bad = await server.fetch('/api/users/user-1', jsonReq({ sender_email: 'x@gmail.com' }, 'PUT'));
      expect(bad.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();

      mockQuery
        .mockResolvedValueOnce([{ id: 'user-1' }]) // existing check
        .mockResolvedValueOnce({} as any) // UPDATE
        .mockResolvedValueOnce([{ id: 'user-1', sender_email: null }]); // re-fetch
      const clear = await server.fetch('/api/users/user-1', jsonReq({ sender_email: null }, 'PUT'));
      expect(clear.status).toBe(200);
    } finally {
      await server.close();
    }
  });
});

describe('GET /api/users/senders', () => {
  it('lists active users with sender_email, tenant-scoped, minimal projection', async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 'u1', first_name: 'Robert', last_name: 'Belmonte', sender_email: 'robert.belmonte@tecnocim.com', sender_name: 'Robert Belmonte' },
    ]);
    const server = await createTestServer();
    try {
      const res = await server.fetch('/api/users/senders');
      const body: any = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.senders).toHaveLength(1);
      const call = mockQuery.mock.calls[0];
      expect(call[0]).toContain('tenant_id = ?');
      expect(call[0]).toContain('sender_email IS NOT NULL');
      expect(call[0]).toContain('is_active = TRUE');
      expect(call[0]).not.toContain('password');
      expect(call[1]).toEqual(['test-tenant-id']);
    } finally {
      await server.close();
    }
  });
});
