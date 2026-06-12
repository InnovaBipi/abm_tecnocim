#!/usr/bin/env node
// Redistribute scheduled emails across business days using the server-side
// warmup-aware distribution logic. Uses POST /api/outbox/redistribute.
//
// Usage:
//   node scripts/distribute-scheduled.js                   # All scheduled emails
//   node scripts/distribute-scheduled.js <campaign_id>     # Specific campaign
//
// Environment variables (optional):
//   ABM_BASE_URL   - API base URL (default: https://abm.tecnociminnova.com)
//   ABM_EMAIL      - Login email (default: alfons.marques@tecnocim.com)
//   ABM_PASSWORD   - Login password

const https = require('https');

const BASE = process.env.ABM_BASE_URL || 'https://abm.tecnociminnova.com';
const EMAIL = process.env.ABM_EMAIL || 'alfons.marques@tecnocim.com';
const PASSWORD = process.env.ABM_PASSWORD;
const CAMPAIGN_ID = process.argv[2] || null;

function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      rejectUnauthorized: false,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // Login
  const loginRes = await api('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
  const token = loginRes.data?.token;
  if (!token) { console.error('Login failed:', loginRes.error || 'unknown'); process.exit(1); }
  console.log('Login OK');

  // Call redistribute endpoint
  const body = CAMPAIGN_ID ? { campaign_id: CAMPAIGN_ID } : {};
  console.log(CAMPAIGN_ID
    ? `Redistributing campaign: ${CAMPAIGN_ID}`
    : 'Redistributing ALL scheduled emails...');

  const result = await api('POST', '/api/outbox/redistribute', body, token);

  if (!result.success) {
    console.error('Error:', result.error);
    process.exit(1);
  }

  const { count, distribution, daily_limit } = result.data;
  console.log(`\nRedistributed ${count} emails (warmup limit: ${daily_limit}/day)`);

  if (distribution && Object.keys(distribution).length > 0) {
    console.log('\nDistribution by day:');
    for (const [date, n] of Object.entries(distribution).sort()) {
      const dow = new Date(date).toLocaleDateString('es-ES', { weekday: 'short' });
      console.log(`  ${date} (${dow}): ${n} emails`);
    }
  } else {
    console.log(result.data.message);
  }
}

main().catch(console.error);
