/**
 * Tests for server/src/routes/auth.ts
 *
 * Strategy: mount the router in a minimal Express app and call it via Node's
 * built-in http.createServer + fetch (available natively in Node 18+).
 * No supertest dependency required.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';

// --- Mocks declared before any import that triggers them ---

vi.mock('../config/database', () => ({
  query: vi.fn(),
}));

vi.mock('../middleware/tenant', () => ({
  getTenantBySlug: vi.fn(),
  getTenantConfig: vi.fn(),
}));

// Partial mock: keep real hashPassword/comparePassword/generateToken
// but allow authenticate to be overridden per test
vi.mock('../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/auth')>();
  return {
    ...actual,
    // Default: authenticate sets req.user and calls next
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

// --- Imports after mock declarations ---
import { query } from '../config/database';
import { getTenantConfig } from '../middleware/tenant';
import * as authMiddleware from '../middleware/auth';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockGetTenantConfig = getTenantConfig as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------------
// Minimal HTTP test server helper
// ---------------------------------------------------------------------------------

interface TestServer {
  fetch: (path: string, options?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
}

async function createTestServer(): Promise<TestServer> {
  const { default: authRouter } = await import('./auth');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);

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

// ---------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------

const TEST_TENANT = {
  id: 'tenant-uuid-1234',
  name: 'Tecnocim',
  slug: 'tecnocim',
  domain: 'tecnocim.com',
  logo_url: null,
  primary_color: '#ff7f00',
  secondary_color: '#333333',
  config: {},
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

let HASHED_PASSWORD: string;

beforeEach(async () => {
  vi.clearAllMocks();
  HASHED_PASSWORD = await authMiddleware.hashPassword('Password123');
});

// ---------------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  it('returns 200 with token and user data on valid credentials', async () => {
    const srv = await createTestServer();

    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM users u')) {
        return Promise.resolve([
          {
            id: 'user-uuid-abc',
            email: 'admin@tecnocim.com',
            password: HASHED_PASSWORD,
            first_name: 'Alfons',
            last_name: 'Marques',
            role: 'admin',
            is_active: true,
            tenant_id: TEST_TENANT.id,
            tenant_name: TEST_TENANT.name,
            tenant_slug: TEST_TENANT.slug,
            tenant_logo_url: null,
            tenant_primary_color: TEST_TENANT.primary_color,
            tenant_secondary_color: TEST_TENANT.secondary_color,
            tenant_config: JSON.stringify(TEST_TENANT.config),
            tenant_is_active: true,
          },
        ]);
      }
      return Promise.resolve({ affectedRows: 1 });
    });

    const res = await srv.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@tecnocim.com', password: 'Password123' }),
    });
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.data.token).toBe('string');
    expect(body.data.user.email).toBe('admin@tecnocim.com');
    expect(body.data.user.role).toBe('admin');
    expect(body.data.tenant.slug).toBe('tecnocim');
    expect(body.data.user).not.toHaveProperty('password');

    await srv.close();
  });

  it('returns 401 when password is wrong', async () => {
    const srv = await createTestServer();

    mockQuery.mockResolvedValue([
      {
        id: 'user-uuid-abc',
        email: 'admin@tecnocim.com',
        password: HASHED_PASSWORD,
        first_name: 'Alfons',
        last_name: 'Marques',
        role: 'admin',
        is_active: true,
        tenant_id: TEST_TENANT.id,
        tenant_name: TEST_TENANT.name,
        tenant_slug: TEST_TENANT.slug,
        tenant_logo_url: null,
        tenant_primary_color: '#ff7f00',
        tenant_secondary_color: '#333',
        tenant_config: '{}',
        tenant_is_active: true,
      },
    ]);

    const res = await srv.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@tecnocim.com', password: 'WrongPassword' }),
    });
    const body = await res.json() as any;

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Invalid email or password.');

    await srv.close();
  });

  it('returns 400 when email is missing', async () => {
    const srv = await createTestServer();

    const res = await srv.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'Password123' }),
    });
    const body = await res.json() as any;

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Validation failed');
    expect(body.details).toHaveProperty('email');

    await srv.close();
  });

  it('returns 400 when email format is invalid', async () => {
    const srv = await createTestServer();

    const res = await srv.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'Password123' }),
    });
    const body = await res.json() as any;

    expect(res.status).toBe(400);
    expect(body.details).toHaveProperty('email');

    await srv.close();
  });

  it('returns 401 when user does not exist', async () => {
    const srv = await createTestServer();

    // Empty result — no user found
    mockQuery.mockResolvedValue([]);

    const res = await srv.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ghost@nowhere.com', password: 'Password123' }),
    });
    const body = await res.json() as any;

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Invalid email or password.');

    await srv.close();
  });

  it('returns 403 when user account is deactivated', async () => {
    const srv = await createTestServer();

    mockQuery.mockResolvedValue([
      {
        id: 'user-uuid-abc',
        email: 'inactive@tecnocim.com',
        password: HASHED_PASSWORD,
        first_name: 'Old',
        last_name: 'User',
        role: 'member',
        is_active: false,
        tenant_id: TEST_TENANT.id,
        tenant_name: TEST_TENANT.name,
        tenant_slug: TEST_TENANT.slug,
        tenant_logo_url: null,
        tenant_primary_color: '#ff7f00',
        tenant_secondary_color: '#333',
        tenant_config: '{}',
        tenant_is_active: true,
      },
    ]);

    const res = await srv.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'inactive@tecnocim.com', password: 'Password123' }),
    });
    const body = await res.json() as any;

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/deactivated/i);

    await srv.close();
  });

  it('queries the database with the provided email', async () => {
    const srv = await createTestServer();

    mockQuery.mockResolvedValue([]);

    await srv.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'check@querytest.com', password: 'Password123' }),
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM users u'),
      expect.arrayContaining(['check@querytest.com'])
    );

    await srv.close();
  });
});

// ---------------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------------

describe('GET /api/auth/me', () => {
  it('returns current user and tenant when authenticated', async () => {
    // Inject req.user via the authenticate mock
    vi.spyOn(authMiddleware, 'authenticate').mockImplementation(
      (req: any, _res: any, next: () => void) => {
        req.user = {
          id: 'user-uuid-abc',
          email: 'alfons@tecnocim.com',
          role: 'admin',
          tenantId: TEST_TENANT.id,
        };
        next();
      }
    );

    const srv = await createTestServer();

    mockQuery.mockResolvedValueOnce([
      {
        id: 'user-uuid-abc',
        email: 'alfons@tecnocim.com',
        first_name: 'Alfons',
        last_name: 'Marques',
        role: 'admin',
        tenant_id: TEST_TENANT.id,
      },
    ]);
    mockGetTenantConfig.mockResolvedValueOnce(TEST_TENANT);

    const token = authMiddleware.generateToken(
      'user-uuid-abc', 'alfons@tecnocim.com', 'admin', TEST_TENANT.id
    );

    const res = await srv.fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe('alfons@tecnocim.com');
    expect(body.data.tenant.slug).toBe('tecnocim');

    // Verify the query uses tenant_id
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('tenant_id'),
      expect.arrayContaining([TEST_TENANT.id])
    );

    await srv.close();
  });
});
