import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../config/database', () => ({ query: vi.fn() }));

import { query } from '../config/database';
import { config } from '../config/env';
import { AbmOAuthProvider, parseJsonCol } from './oauth-provider';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;

const sign = (payload: object, opts: jwt.SignOptions = {}) =>
  jwt.sign(payload, config.JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d', ...opts });

describe('parseJsonCol', () => {
  it('parses a JSON string', () => {
    expect(parseJsonCol('["a","b"]', [])).toEqual(['a', 'b']);
  });
  it('passes through an already-parsed object (mysql2 JSON column)', () => {
    expect(parseJsonCol(['a'], [])).toEqual(['a']);
  });
  it('returns the fallback on null', () => {
    expect(parseJsonCol(null, ['x'])).toEqual(['x']);
  });
  it('returns the fallback on invalid JSON', () => {
    expect(parseJsonCol('{not json', [])).toEqual([]);
  });
});

describe('AbmOAuthProvider.verifyAccessToken', () => {
  const provider = new AbmOAuthProvider();

  it('accepts a valid access token and returns tenant-scoped auth info', async () => {
    const token = sign({ userId: 'u1', tenantId: 't1', email: 'a@b.c', role: 'admin', aud: 'mcp' });
    const info = await provider.verifyAccessToken(token);
    expect(info.extra?.tenantId).toBe('t1');
    expect(info.extra?.userId).toBe('u1');
  });

  it('rejects a refresh token used as an access token', async () => {
    const refresh = sign({ userId: 'u1', tenantId: 't1', typ: 'refresh' }, { expiresIn: '30d' });
    await expect(provider.verifyAccessToken(refresh)).rejects.toThrow('invalid_token');
  });

  it('rejects a token missing tenantId', async () => {
    const token = sign({ userId: 'u1' });
    await expect(provider.verifyAccessToken(token)).rejects.toThrow('invalid_token');
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = jwt.sign({ userId: 'u1', tenantId: 't1' }, 'wrong-secret', { algorithm: 'HS256', expiresIn: '7d' });
    await expect(provider.verifyAccessToken(token)).rejects.toThrow('invalid_token');
  });
});

describe('AbmOAuthProvider.exchangeAuthorizationCode', () => {
  const provider = new AbmOAuthProvider();
  const client = { client_id: 'client-1', redirect_uris: ['https://cb'] } as any;

  beforeEach(() => mockQuery.mockReset());

  it('issues an access token bound to aud:mcp and a refresh token typed refresh', async () => {
    const future = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    mockQuery
      .mockResolvedValueOnce([{ code: 'abc', client_id: 'client-1', redirect_uri: 'https://cb', user_id: 'u1', tenant_id: 't1', scope: 'mcp', expires_at: future }]) // SELECT code
      .mockResolvedValueOnce({}) // deleteCode
      .mockResolvedValueOnce([{ email: 'a@b.c', role: 'admin' }]); // issueTokens users lookup
    const tokens = await provider.exchangeAuthorizationCode(client, 'abc', 'verifier', 'https://cb');
    const access: any = jwt.verify(tokens.access_token, config.JWT_SECRET);
    const refresh: any = jwt.verify(tokens.refresh_token!, config.JWT_SECRET);
    expect(access.aud).toBe('mcp');
    expect(access.tenantId).toBe('t1');
    expect(refresh.typ).toBe('refresh');
    // The freshly-minted access token must NOT be usable against the REST API — proven by aud.
    expect(access.aud).toBe('mcp');
  });

  it('rejects an expired authorization code', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    mockQuery
      .mockResolvedValueOnce([{ code: 'abc', client_id: 'client-1', redirect_uri: 'https://cb', user_id: 'u1', tenant_id: 't1', scope: 'mcp', expires_at: past }])
      .mockResolvedValueOnce({}); // deleteCode (single-use, runs before expiry check)
    await expect(provider.exchangeAuthorizationCode(client, 'abc', 'verifier', 'https://cb')).rejects.toThrow('invalid_grant');
  });

  it('rejects an unknown code', async () => {
    mockQuery.mockResolvedValueOnce([]);
    await expect(provider.exchangeAuthorizationCode(client, 'nope', 'v', 'https://cb')).rejects.toThrow('invalid_grant');
  });
});
