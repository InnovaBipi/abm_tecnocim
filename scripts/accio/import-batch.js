// Import a batch CSV, link prospects to the campaign, and emit byemail.json (email -> prospect_id).
// Usage: node import-batch.js --csv <path> --campaign <id> --out <byemail.json> [--tags accio-2026,catalunya]
'use strict';
const fs = require('fs');
const { BASE, api, token, chunk, sleep } = require('./lib');

function args() { const a = process.argv.slice(2), o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = (a[i + 1] && !a[i + 1].startsWith('--')) ? a[++i] : true; return o; }

async function uploadCsv(csvPath) {
  const buf = fs.readFileSync(csvPath);
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'text/csv' }), csvPath.split(/[\\/]/).pop());
  const res = await fetch(BASE + '/api/imports/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token() }, body: fd });
  const j = await res.json();
  if (!res.ok) throw new Error('upload failed ' + res.status + ' ' + JSON.stringify(j).slice(0, 200));
  return j.data;
}

(async () => {
  const o = args();
  const tags = (o.tags ? String(o.tags).split(',') : ['accio-2026', 'catalunya']);

  // emails present in this CSV (for filtering the prospect lookup)
  const csv = fs.readFileSync(o.csv, 'utf8').trim().split('\n').slice(1);
  const batchEmails = new Set(csv.map((l) => l.split(',')[0].replace(/^"|"$/g, '').toLowerCase()));
  console.log(`CSV emails: ${batchEmails.size}`);

  // 1) upload + map
  const up = await uploadCsv(o.csv);
  console.log(`uploaded import_id=${up.import_id}, rows=${up.total_rows}`);
  const mapping = up.suggested_mappings || { email: 'email', first_name: 'first_name', company_name: 'company_name', domain: 'domain', industry: 'industry', city: 'city', region: 'region', country: 'country' };
  const mr = await api('POST', `/api/imports/${up.import_id}/map`, { column_mapping: mapping, default_tags: tags });
  if (!mr.ok) throw new Error('map failed ' + mr.status + ' ' + JSON.stringify(mr.body).slice(0, 200));
  console.log('import result:', JSON.stringify(mr.body.data));

  // 2) resolve prospect_ids by scanning recent prospects (page-based; newest first)
  const byemail = {};
  for (let page = 1; page <= 60 && Object.keys(byemail).length < batchEmails.size; page++) {
    const r = await api('GET', `/api/prospects?limit=100&page=${page}`);
    const rows = r.body?.data?.prospects || r.body?.data || [];
    if (!rows.length) break;
    for (const p of rows) { const em = String(p.email || '').toLowerCase(); if (batchEmails.has(em) && !byemail[em]) byemail[em] = p.id; }
    await sleep(120);
  }
  console.log(`resolved prospect_ids: ${Object.keys(byemail).length}/${batchEmails.size}`);
  const missing = [...batchEmails].filter((e) => !byemail[e]);
  if (missing.length) console.warn('UNRESOLVED:', missing.slice(0, 20));
  fs.writeFileSync(o.out, JSON.stringify(byemail, null, 2));

  // 3) link to campaign
  const pids = Object.values(byemail);
  let added = 0;
  for (const part of chunk(pids, 200)) {
    const r = await api('POST', `/api/campaigns/${o.campaign}/prospects`, { prospect_ids: part });
    if (r.ok) added += r.body?.data?.addedCount ?? 0;
    else console.error('add-prospects failed', r.status, JSON.stringify(r.body).slice(0, 200));
    await sleep(200);
  }
  console.log(`linked to campaign: addedCount=${added} (skipped existing = ${pids.length - added})`);
  console.log(`byemail written -> ${o.out}`);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
