// Post-process an accio-engine workflow result:
//  - cross-run dedup vs seen-domains.json
//  - MX verify (dns.resolveMx) -> drop dead domains
//  - write pipeline-<date>/04-emails.json + prospects CSV
//  - append processed domains to seen-domains.json, update partitions.json
//
// Usage: node post-run.js --result <workflow-result.json> --slice <id> --out <pipelineDir> [--date YYYYMMDD]
'use strict';
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;

const ENGINE = path.join(__dirname, '..', 'output', 'accio-engine');
const SEEN = path.join(ENGINE, 'seen-domains.json');
const PARTS = path.join(ENGINE, 'partitions.json');

function args() { const a = process.argv.slice(2), o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = (a[i + 1] && !a[i + 1].startsWith('--')) ? a[++i] : true; return o; }
const norm = (d) => String(d || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
const readJSON = (p, def) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; } };

async function mxOk(domain) {
  try { const r = await dns.resolveMx(domain); return Array.isArray(r) && r.length > 0; }
  catch { try { await dns.resolve(domain, 'A'); return false; } catch { return false; } }
}
async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

(async () => {
  const o = args();
  const result = readJSON(o.result);
  if (!result || !result.emails) { console.error('bad result file'); process.exit(1); }
  const outDir = o.out; fs.mkdirSync(outDir, { recursive: true });

  // Eligibility safety filter: drop companies the Signal phase placed outside Catalunya
  // or clearly >250 employees (ACCIÓ requires a Catalan industrial PIME).
  // Keys on the signal agent's explicit mismatch phrasing + non-CAT provinces + size flags.
  const OUTSIDE = /\bno al\b|\bno a catalunya\b|fora de catalunya|gipuzkoa|guip[uú]zcoa|[aà]laba|[aà]lava|vit[oò]ria|biscaia|vizcaya|pa[ií]s basc|navarra|la rioja|logro[nñ]o|val[eè]ncia|valencia|paterna|albal|madrid|zaragoza|arag[oó]|andaluc|sevilla|m[aá]laga|murcia|galicia|argentina|portugal/i;
  const BIG = /superar 250|m[eé]s de 250|&gt;\s*250|>\s*250|gran empresa|possible gran/i;
  const dropSet = new Map(); // domain -> reason
  for (const p of (result.prospects || [])) {
    const d = norm(p.domain); const txt = `${p.signal || ''} ${p.employees_estimate || ''}`;
    if (OUTSIDE.test(txt)) dropSet.set(d, 'outside_catalunya');
    else if (BIG.test(txt)) dropSet.set(d, 'size_gt_250');
  }

  const seen = new Set(readJSON(SEEN, []).map(norm));
  let emails = result.emails.map((e) => ({ ...e, domain: norm(e.domain) }));
  const before = emails.length;

  // apply eligibility filter
  const eligDropped = emails.filter((e) => dropSet.has(e.domain)).map((e) => ({ domain: e.domain, reason: dropSet.get(e.domain) }));
  emails = emails.filter((e) => !dropSet.has(e.domain));

  // cross-run dedup
  emails = emails.filter((e) => e.domain && !seen.has(e.domain));
  const afterDedup = emails.length;

  // MX verify
  const mxResults = await mapLimit(emails, 8, async (e) => ({ e, ok: await mxOk(e.domain) }));
  const live = mxResults.filter((x) => x.ok).map((x) => x.e);
  const deadMx = mxResults.filter((x) => !x.ok).map((x) => x.e.domain);

  // write 04-emails.json (canonical)
  fs.writeFileSync(path.join(outDir, '04-emails.json'), JSON.stringify(live, null, 2));

  // write CSV
  const esc = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const header = 'email,first_name,company_name,domain,industry,city,region,country';
  const rows = live.map((c) => [c.email, 'Contacto', c.name, c.domain, c.sector, c.city, 'Catalunya', 'Spain'].map(esc).join(','));
  const csvName = `prospects-accio-${path.basename(outDir)}.csv`;
  fs.writeFileSync(path.join(outDir, csvName), [header, ...rows].join('\n'));

  // update seen-domains (append all processed: shipped + dead + deduped duplicates we saw)
  for (const e of result.emails) seen.add(norm(e.domain));
  for (const p of (result.prospects || [])) seen.add(norm(p.domain));
  fs.writeFileSync(SEEN, JSON.stringify([...seen].sort(), null, 0));

  // update partitions
  if (o.slice) {
    const parts = readJSON(PARTS, []);
    const p = parts.find((x) => x.id === o.slice);
    if (p) { p.status = live.length < 8 ? 'exhausted' : 'done'; p.netted = (p.netted || 0) + live.length; p.last_run = o.date || new Date().toISOString().slice(0, 10); fs.writeFileSync(PARTS, JSON.stringify(parts, null, 2)); }
  }

  console.log(JSON.stringify({
    slice: o.slice, shipped_by_wf: before,
    elig_dropped: eligDropped.length, elig_drops: eligDropped,
    after_cross_dedup: afterDedup,
    mx_live: live.length, mx_dead: deadMx.length, dead_domains: deadMx,
    csv: path.join(outDir, csvName), emails_json: path.join(outDir, '04-emails.json'),
    seen_total: seen.size,
  }, null, 2));
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
