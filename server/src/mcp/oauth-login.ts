import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/database';
import { createAuthorizationCode, parseJsonCol } from './oauth-provider';
import type { OAuthClientInformationFull, OAuthClientInformationFull as Client } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Login + consent page rendered by the /authorize handler. Carries the OAuth params as hidden fields. */
export function renderLoginPage(client: Client, params: AuthorizationParams, errorMsg?: string): string {
  const appName = esc(client.client_name || 'una aplicación');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conectar con ABM · Tecnocim Innova</title>
<style>
  :root{--o:#ff7f00}
  body{font-family:Poppins,system-ui,Arial,sans-serif;background:#f7f7f8;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
  .card{background:#fff;border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.08);padding:32px;width:min(92vw,380px)}
  h1{font-size:19px;margin:0 0 4px}p.sub{color:#666;font-size:14px;margin:0 0 20px}
  b{color:var(--o)}
  label{display:block;font-size:13px;color:#444;margin:14px 0 6px}
  input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #ddd;border-radius:9px;font-size:14px}
  button{margin-top:22px;width:100%;padding:12px;background:var(--o);color:#fff;border:0;border-radius:9px;font-size:15px;font-weight:600;cursor:pointer}
  .err{background:#fde8e8;color:#a11;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:8px}
  .foot{margin-top:16px;font-size:12px;color:#999;text-align:center}
</style></head><body>
<form class="card" method="POST" action="/oauth/login">
  <h1>Conectar con ABM Tecnocim Innova</h1>
  <p class="sub"><b>${appName}</b> quiere acceder a tu cuenta para operar la plataforma en tu nombre.</p>
  ${errorMsg ? `<div class="err">${esc(errorMsg)}</div>` : ''}
  <label>Email</label>
  <input name="email" type="email" autocomplete="username" required autofocus>
  <label>Contraseña</label>
  <input name="password" type="password" autocomplete="current-password" required>
  <input type="hidden" name="client_id" value="${esc(client.client_id)}">
  <input type="hidden" name="redirect_uri" value="${esc(params.redirectUri)}">
  <input type="hidden" name="code_challenge" value="${esc(params.codeChallenge)}">
  <input type="hidden" name="state" value="${esc(params.state ?? '')}">
  <input type="hidden" name="scope" value="${esc((params.scopes || []).join(' '))}">
  <input type="hidden" name="resource" value="${esc(params.resource?.toString() ?? '')}">
  <button type="submit">Autorizar</button>
  <div class="foot">Autorizas acceso limitado a tu tenant. Puedes revocarlo en Ajustes.</div>
</form></body></html>`;
}

function redirectWithError(res: Response, redirectUri: string, state: string, error: string, desc?: string) {
  try {
    const u = new URL(redirectUri);
    u.searchParams.set('error', error);
    if (desc) u.searchParams.set('error_description', desc);
    if (state) u.searchParams.set('state', state);
    res.redirect(u.toString());
  } catch {
    res.status(400).send(`OAuth error: ${error}`);
  }
}

/** POST /oauth/login — validate credentials, mint an authorization code, redirect back to the client. */
export async function handleOAuthLogin(req: Request, res: Response): Promise<void> {
  const { email, password, client_id, redirect_uri, code_challenge, state, scope, resource } = req.body || {};
  const st = String(state || '');

  if (!client_id || !redirect_uri || !code_challenge) {
    res.status(400).send('Missing OAuth parameters.');
    return;
  }

  // Validate client + redirect_uri.
  const clients = await query<any[]>('SELECT * FROM oauth_clients WHERE client_id = ?', [client_id]);
  if (!clients.length) {
    res.status(400).send('Unknown client.');
    return;
  }
  const redirects: string[] = parseJsonCol<string[]>(clients[0].redirect_uris, []);
  if (!redirects.includes(redirect_uri)) {
    res.status(400).send('Invalid redirect_uri.');
    return;
  }

  const client: OAuthClientInformationFull = {
    client_id,
    redirect_uris: redirects,
    client_name: clients[0].client_name || undefined,
  } as OAuthClientInformationFull;

  // Validate credentials against users. Resolve tenant via unique email match.
  if (!email || !password) {
    res.status(400).send(renderLoginPage(client, mkParams(redirect_uri, code_challenge, st, scope, resource), 'Introduce email y contraseña.'));
    return;
  }
  const users = await query<any[]>(
    'SELECT id, tenant_id, password, is_active FROM users WHERE email = ?',
    [String(email).toLowerCase().trim()]
  );
  const matches: any[] = [];
  for (const u of users) {
    if (u.is_active === 0) continue;
    if (u.password && (await bcrypt.compare(String(password), u.password))) matches.push(u);
  }
  if (matches.length === 0) {
    res.status(401).send(renderLoginPage(client, mkParams(redirect_uri, code_challenge, st, scope, resource), 'Credenciales incorrectas.'));
    return;
  }
  if (matches.length > 1) {
    res.status(409).send(renderLoginPage(client, mkParams(redirect_uri, code_challenge, st, scope, resource), 'Tu email existe en varios tenants; contacta con soporte para desambiguar.'));
    return;
  }

  const user = matches[0];
  const code = await createAuthorizationCode({
    clientId: client_id,
    redirectUri: redirect_uri,
    codeChallenge: code_challenge,
    userId: user.id,
    tenantId: user.tenant_id,
    scope: scope || 'mcp',
    resource: resource || undefined,
  });

  try {
    const u = new URL(redirect_uri);
    u.searchParams.set('code', code);
    if (st) u.searchParams.set('state', st);
    res.redirect(u.toString());
  } catch {
    redirectWithError(res, redirect_uri, st, 'server_error');
  }
}

function mkParams(redirectUri: string, codeChallenge: string, state: string, scope?: string, resource?: string): AuthorizationParams {
  return {
    redirectUri,
    codeChallenge,
    state,
    scopes: scope ? String(scope).split(' ').filter(Boolean) : undefined,
    resource: resource ? new URL(resource) : undefined,
  };
}
