// Seed the persistent dedup corpus for the ACCIÓ engine.
// Merges: prior pipeline dedup-domains.json + ALL existing platform prospect domains.
// Writes scripts/output/accio-engine/seen-domains.json (sorted unique bare domains).
'use strict';
const fs = require('fs');
const path = require('path');
const { api } = require('./lib');

const ROOT = path.join(__dirname, '..', 'output', 'accio-engine');
const PRIOR = path.join(__dirname, '..', 'output', 'pipeline-20260622', 'dedup-domains.json');

const norm = (d) => String(d || '').toLowerCase().trim()
  .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/\s+/g, '');
const domOfEmail = (e) => { const m = String(e || '').split('@')[1]; return m ? norm(m) : ''; };

(async () => {
  fs.mkdirSync(path.join(ROOT, 'cache'), { recursive: true });
  const seen = new Set();

  // 1) prior dedup file
  try {
    const prior = JSON.parse(fs.readFileSync(PRIOR, 'utf8'));
    for (const d of prior) { const n = norm(d); if (n) seen.add(n); }
    console.log(`prior dedup-domains: +${prior.length}`);
  } catch (e) { console.warn('no prior dedup file:', e.message); }

  // 2) all existing platform prospects (page-based; endpoint ignores offset, limit cap 100)
  let page = 1; const limit = 100; let fetched = 0;
  while (page <= 500) {
    const r = await api('GET', `/api/prospects?limit=${limit}&page=${page}`);
    if (!r.ok) { console.error('prospects fetch failed', r.status, JSON.stringify(r.body).slice(0, 200)); break; }
    const rows = r.body?.data?.prospects || r.body?.data || [];
    if (!rows.length) break;
    for (const p of rows) {
      if (p.domain) seen.add(norm(p.domain));
      if (p.email) { const d = domOfEmail(p.email); if (d) seen.add(d); }
    }
    fetched += rows.length;
    page++;
  }
  console.log(`platform prospects fetched: ${fetched} across ${page - 1} pages`);

  const arr = [...seen].filter(Boolean).sort();
  fs.writeFileSync(path.join(ROOT, 'seen-domains.json'), JSON.stringify(arr, null, 0));
  console.log(`seen-domains.json written: ${arr.length} unique domains -> ${path.join(ROOT, 'seen-domains.json')}`);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
