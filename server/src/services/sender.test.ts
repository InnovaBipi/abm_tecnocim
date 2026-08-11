/**
 * Tests for server/src/services/sender.ts — per-campaign sender resolution.
 * Cascade: campaign.sender_user_id -> users.sender_email/name -> tenant config.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({
  query: vi.fn(),
}));

vi.mock('../middleware/tenant', () => ({
  getTenantConfig: vi.fn(),
}));

vi.mock('../config/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { query } from '../config/database';
import { getTenantConfig } from '../middleware/tenant';
import { resolveSender, assertSenderDomainAllowed, domainOf, applyCampaignSenderToAIContext } from './sender';

const mockQuery = query as ReturnType<typeof vi.fn>;
const mockGetTenant = getTenantConfig as ReturnType<typeof vi.fn>;

const TENANT = {
  id: 'test-tenant-id',
  name: 'Tecnocim Innova',
  config: {
    email: {
      from_email: 'abm@tecnocim.com',
      from_name: 'Tecnocim Innova',
      reply_to: 'alfons.marques@tecnocim.com',
    },
  },
};

describe('domainOf', () => {
  it('extracts the lowercase domain', () => {
    expect(domainOf('Robert.Belmonte@Tecnocim.COM')).toBe('tecnocim.com');
    expect(domainOf('no-at-sign')).toBe('');
  });
});

describe('resolveSender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTenant.mockResolvedValue(TENANT);
  });

  it('falls back to tenant config when senderUserId is null', async () => {
    const r = await resolveSender('test-tenant-id', null);
    expect(r.source).toBe('tenant');
    expect(r.fromAddress).toBe('Tecnocim Innova <abm@tecnocim.com>');
    expect(r.replyTo).toBe('alfons.marques@tecnocim.com');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('resolves the user sender with Reply-To = sender mailbox', async () => {
    mockQuery.mockResolvedValueOnce([{
      sender_email: 'robert.belmonte@tecnocim.com',
      sender_name: 'Robert Belmonte',
      first_name: 'Robert',
      last_name: 'Belmonte',
    }]);
    const r = await resolveSender('test-tenant-id', 'robert-user-id');
    expect(r.source).toBe('user');
    expect(r.fromAddress).toBe('Robert Belmonte <robert.belmonte@tecnocim.com>');
    expect(r.replyTo).toBe('robert.belmonte@tecnocim.com');
    // Lookup must be tenant-scoped and active-only
    expect(mockQuery.mock.calls[0][0]).toContain('tenant_id = ?');
    expect(mockQuery.mock.calls[0][0]).toContain('is_active = TRUE');
    expect(mockQuery.mock.calls[0][1]).toEqual(['robert-user-id', 'test-tenant-id']);
  });

  it('falls back when the user is missing or inactive (FK SET NULL / deactivated)', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const r = await resolveSender('test-tenant-id', 'deleted-user-id');
    expect(r.source).toBe('tenant');
    expect(r.fromAddress).toBe('Tecnocim Innova <abm@tecnocim.com>');
  });

  it('falls back when the user has no sender_email', async () => {
    mockQuery.mockResolvedValueOnce([{ sender_email: null, sender_name: null, first_name: 'X', last_name: 'Y' }]);
    const r = await resolveSender('test-tenant-id', 'user-no-sender');
    expect(r.source).toBe('tenant');
  });

  it('falls back on sender domain mismatch (never hand Resend an unverified From)', async () => {
    mockQuery.mockResolvedValueOnce([{
      sender_email: 'robert@gmail.com', sender_name: 'Robert', first_name: 'Robert', last_name: 'B',
    }]);
    const r = await resolveSender('test-tenant-id', 'robert-user-id');
    expect(r.source).toBe('tenant');
    expect(r.fromAddress).toBe('Tecnocim Innova <abm@tecnocim.com>');
  });

  it('builds the display name from first/last name when sender_name is empty', async () => {
    mockQuery.mockResolvedValueOnce([{
      sender_email: 'robert.belmonte@tecnocim.com', sender_name: null,
      first_name: 'Robert', last_name: 'Belmonte',
    }]);
    const r = await resolveSender('test-tenant-id', 'robert-user-id');
    expect(r.senderName).toBe('Robert Belmonte');
  });
});

describe('assertSenderDomainAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTenant.mockResolvedValue(TENANT);
  });

  it('accepts a sender on the tenant domain', async () => {
    await expect(assertSenderDomainAllowed('test-tenant-id', 'robert.belmonte@tecnocim.com')).resolves.toBeUndefined();
  });

  it('rejects a foreign domain with a clear message', async () => {
    await expect(assertSenderDomainAllowed('test-tenant-id', 'robert@gmail.com'))
      .rejects.toThrow('dominio verificado @tecnocim.com');
  });

  it('is a no-op when the tenant has no sending config yet', async () => {
    mockGetTenant.mockResolvedValue({ ...TENANT, config: {} });
    await expect(assertSenderDomainAllowed('test-tenant-id', 'anything@anywhere.com')).resolves.toBeUndefined();
  });
});

describe('applyCampaignSenderToAIContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTenant.mockResolvedValue(TENANT);
  });

  const baseCtx = {
    company_name: 'Tecnocim Innova',
    sender_name: 'Alfons Marques',
    company_description: 'desc',
    industry_context: 'ctx',
    contact_email: 'alfons.marques@tecnocim.com',
  };

  it('overrides signature identity when campaign has a resolvable sender', async () => {
    mockQuery.mockResolvedValueOnce([{
      sender_email: 'robert.belmonte@tecnocim.com', sender_name: 'Robert Belmonte',
      first_name: 'Robert', last_name: 'Belmonte',
    }]);
    const ctx = await applyCampaignSenderToAIContext(baseCtx as any, 'test-tenant-id', 'robert-user-id');
    expect(ctx.sender_name).toBe('Robert Belmonte');
    expect(ctx.contact_email).toBe('robert.belmonte@tecnocim.com');
  });

  it('returns the context untouched without sender_user_id or on fallback', async () => {
    expect(await applyCampaignSenderToAIContext(baseCtx as any, 'test-tenant-id', null)).toBe(baseCtx);
    mockQuery.mockResolvedValueOnce([]);
    const same = await applyCampaignSenderToAIContext(baseCtx as any, 'test-tenant-id', 'gone-user');
    expect(same.sender_name).toBe('Alfons Marques');
  });
});
