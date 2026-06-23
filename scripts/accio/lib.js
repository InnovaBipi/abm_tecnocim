// Shared API helper for the ACCIÓ Catalunya high-volume pipeline.
// Reads JWT from $ABM_TOKEN or C:/Users/user/tmp_token.txt (cached, 7d).
// Node 20+ (global fetch). No external deps.
'use strict';
const fs = require('fs');

const BASE = process.env.ABM_BASE_URL || 'https://abm.tecnociminnova.com';
const TENANT_SLUG = process.env.ABM_TENANT_SLUG || 'tecnocim';
const TOKEN_FILE = process.env.ABM_TOKEN_FILE || 'C:/Users/user/tmp_token.txt';

function loadToken() {
  if (process.env.ABM_TOKEN) return process.env.ABM_TOKEN.trim();
  try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim(); }
  catch { throw new Error('No token: set $ABM_TOKEN or create ' + TOKEN_FILE); }
}

let TOKEN = null;
function token() { if (!TOKEN) TOKEN = loadToken(); return TOKEN; }

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + token(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 500) }; }
  return { status: res.status, ok: res.ok, body: json };
}

// Re-login if token is stale (rate limit: 10/15min — use sparingly).
async function login() {
  const email = process.env.ABM_EMAIL;
  const password = process.env.ABM_PASSWORD;
  if (!email || !password) throw new Error('Set ABM_EMAIL and ABM_PASSWORD to re-login');
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, tenant_slug: TENANT_SLUG }),
  });
  const j = await res.json();
  const t = j?.data?.token;
  if (!t) throw new Error('Login failed: ' + JSON.stringify(j).slice(0, 200));
  fs.writeFileSync(TOKEN_FILE, t);
  TOKEN = t;
  return t;
}

const STEP_DELAY = { 1: 0, 2: 3, 3: 7 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

module.exports = { BASE, TENANT_SLUG, api, login, token, STEP_DELAY, sleep, chunk };
