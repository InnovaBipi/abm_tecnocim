import { randomUUID } from 'crypto';
import { Response } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import { config } from '../config/env';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { renderLoginPage } from './oauth-login';

const ACCESS_TTL_SECONDS = 60 * 60 * 24 * 7; // 7d, matches the platform JWT
const CODE_TTL_MS = 10 * 60 * 1000; // 10 min

/** JSON columns come back already-parsed from mysql2; only JSON.parse strings. */
export function parseJsonCol<T>(v: any, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

/** Persist DCR clients in `oauth_clients` (global — a client is the Claude/ChatGPT app). */
class AbmClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const rows = await query<any[]>('SELECT * FROM oauth_clients WHERE client_id = ?', [clientId]);
    if (!rows.length) return undefined;
    const r = rows[0];
    return {
      client_id: r.client_id,
      client_secret: r.client_secret || undefined,
      client_name: r.client_name || undefined,
      redirect_uris: parseJsonCol<string[]>(r.redirect_uris, []),
      grant_types: parseJsonCol<string[]>(r.grant_types, ['authorization_code', 'refresh_token']),
      response_types: ['code'],
      scope: r.scope || 'mcp',
      token_endpoint_auth_method: r.token_endpoint_auth_method || 'none',
    } as OAuthClientInformationFull;
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
  ): Promise<OAuthClientInformationFull> {
    const clientId = randomUUID();
    await query(
      `INSERT INTO oauth_clients
        (client_id, client_secret, client_name, redirect_uris, grant_types, scope, token_endpoint_auth_method)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        clientId,
        (client as any).client_secret || null,
        client.client_name || null,
        JSON.stringify(client.redirect_uris || []),
        JSON.stringify(client.grant_types || ['authorization_code', 'refresh_token']),
        client.scope || 'mcp',
        client.token_endpoint_auth_method || 'none',
      ]
    );
    return {
      ...client,
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    } as OAuthClientInformationFull;
  }
}

export class AbmOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new AbmClientsStore();

  /**
   * GET /authorize handler (via the SDK): render a login+consent page. The form POSTs to
   * /oauth/login, which validates credentials, stores an authorization code and redirects back.
   */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    res.set('Content-Type', 'text/html; charset=utf-8').send(renderLoginPage(client, params));
  }

  /** Return the PKCE challenge stored for a code (the SDK verifies the code_verifier against it). */
  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const rows = await query<any[]>(
      'SELECT code_challenge FROM oauth_authorization_codes WHERE code = ? AND client_id = ?',
      [authorizationCode, client.client_id]
    );
    if (!rows.length) throw new Error('invalid_grant');
    return rows[0].code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string
  ): Promise<OAuthTokens> {
    const rows = await query<any[]>(
      'SELECT * FROM oauth_authorization_codes WHERE code = ? AND client_id = ?',
      [authorizationCode, client.client_id]
    );
    if (!rows.length) throw new Error('invalid_grant');
    const c = rows[0];
    await this.deleteCode(authorizationCode); // single-use
    if (new Date(c.expires_at).getTime() < Date.now()) throw new Error('invalid_grant');
    if (redirectUri && redirectUri !== c.redirect_uri) throw new Error('invalid_grant');
    // PKCE already verified by the SDK against challengeForAuthorizationCode.
    return this.issueTokens(c.user_id, c.tenant_id, c.scope || 'mcp', client.client_id);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string
  ): Promise<OAuthTokens> {
    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, config.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      throw new Error('invalid_grant');
    }
    if (decoded.typ !== 'refresh' || !decoded.userId || !decoded.tenantId) throw new Error('invalid_grant');
    return this.issueTokens(decoded.userId, decoded.tenantId, 'mcp', client.client_id, decoded.email, decoded.role);
  }

  /** Validate an access token (= platform JWT) and return tenant-scoped auth info. */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    let decoded: any;
    try {
      decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      throw new Error('invalid_token');
    }
    if (!decoded.tenantId || !decoded.userId) throw new Error('invalid_token');
    // A refresh token (30d, typ:'refresh') must never be accepted as an access token.
    if (decoded.typ === 'refresh') throw new Error('invalid_token');
    return {
      token,
      clientId: decoded.clientId || 'mcp',
      scopes: ['mcp'],
      expiresAt: decoded.exp,
      extra: {
        tenantId: decoded.tenantId,
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role,
      },
    };
  }

  private async issueTokens(
    userId: string,
    tenantId: string,
    scope: string,
    clientId: string,
    email?: string,
    role?: string
  ): Promise<OAuthTokens> {
    if (!email || !role) {
      const u = await query<any[]>('SELECT email, role FROM users WHERE id = ? AND tenant_id = ?', [userId, tenantId]);
      if (u.length) {
        email = u[0].email;
        role = u[0].role;
      }
    }
    // aud:'mcp' binds this token to the MCP surface. The REST authenticate() middleware
    // rejects aud:'mcp', so a leaked OAuth/connector token cannot be replayed against the REST API.
    const accessToken = jwt.sign({ userId, email, role, tenantId, clientId, scope, aud: 'mcp' }, config.JWT_SECRET, {
      expiresIn: '7d',
      algorithm: 'HS256',
    });
    const refreshToken = jwt.sign({ userId, tenantId, email, role, typ: 'refresh' }, config.JWT_SECRET, {
      expiresIn: '30d',
      algorithm: 'HS256',
    });
    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: ACCESS_TTL_SECONDS,
      scope,
      refresh_token: refreshToken,
    };
  }

  private async deleteCode(code: string): Promise<void> {
    await query('DELETE FROM oauth_authorization_codes WHERE code = ?', [code]);
  }
}

/**
 * Create + store a fresh authorization code (called by the /oauth/login handler after auth).
 * PKCE is S256-only end to end: the SDK's /authorize handler requires code_challenge_method=S256
 * and the /token handler verifies the code_verifier with verifyChallenge (S256), so a stored
 * challenge can only be redeemed by a matching S256 verifier — 'plain' downgrade cannot succeed.
 */
export async function createAuthorizationCode(input: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  userId: string;
  tenantId: string;
  scope?: string;
  resource?: string;
}): Promise<string> {
  const code = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString().replace('T', ' ').substring(0, 19);
  await query(
    `INSERT INTO oauth_authorization_codes
      (code, client_id, redirect_uri, code_challenge, user_id, tenant_id, scope, resource, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, input.clientId, input.redirectUri, input.codeChallenge, input.userId, input.tenantId, input.scope || 'mcp', input.resource || null, expiresAt]
  );
  return code;
}
