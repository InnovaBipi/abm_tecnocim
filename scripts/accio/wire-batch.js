// Reusable wiring for ACCIÓ batches: bulk-insert emails, verify drafts, approve step-1.
// Works for BOTH the in-flight 24 and new engine batches.
//
// Usage:
//   node wire-batch.js insert       --emails <04-emails.json> --map <byemail.json> --campaign <id>
//   node wire-batch.js verify       --emails <04-emails.json> --map <byemail.json> --campaign <id>
//   node wire-batch.js approve-step1 --map <byemail.json> --campaign <id> [--limit N] [--dry]
//
// --emails: array of { email, emails:[{step_number,subject,body_html}] }
// --map:    object email -> prospect_id  (the batch's prospects)
'use strict';
const fs = require('fs');
const { api, STEP_DELAY, chunk, sleep } = require('./lib');

function args() {
  const a = process.argv.slice(3);
  const o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      if (a[i + 1] && !a[i + 1].startsWith('--')) { o[k] = a[++i]; } else { o[k] = true; }
    }
  }
  return o;
}
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

async function cmdInsert(o) {
  const emails = readJSON(o.emails);
  const map = readJSON(o.map);
  const payload = [];
  const miss = [];
  for (const c of emails) {
    const pid = map[c.email];
    if (!pid) { miss.push(c.email); continue; }
    for (const e of (c.emails || [])) {
      if (!e.subject || !e.body_html) { console.warn('skip empty', c.email, e.step_number); continue; }
      payload.push({
        prospect_id: pid,
        step_number: e.step_number,
        subject: e.subject,
        body_html: e.body_html,
        delay_days: STEP_DELAY[e.step_number] ?? 0,
      });
    }
  }
  if (miss.length) console.warn('UNRESOLVED emails (skipped):', miss);
  console.log(`Companies: ${emails.length}  Resolved: ${emails.length - miss.length}  Emails to insert: ${payload.length}`);
  let inserted = 0;
  for (const part of chunk(payload, 1000)) {
    const r = await api('POST', `/api/campaigns/${o.campaign}/bulk-insert-emails`, { emails: part });
    if (!r.ok) { console.error('bulk-insert FAILED', r.status, JSON.stringify(r.body).slice(0, 300)); process.exit(1); }
    const n = r.body?.data?.inserted ?? r.body?.data?.count ?? 0;
    inserted += n;
    console.log(`  chunk ${part.length} -> inserted ${n}`);
    await sleep(300);
  }
  console.log(`TOTAL inserted: ${inserted} (expected ${payload.length})`);
  if (inserted !== payload.length) console.warn('WARNING: inserted != expected — check for skips/dupes');
}

async function fetchDrafts(campaign) {
  const r = await api('GET', `/api/campaigns/${campaign}/generated-emails?status=draft&limit=2000`);
  if (!r.ok) throw new Error('fetch drafts failed ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  return r.body?.data?.emails || [];
}

async function cmdVerify(o) {
  const map = readJSON(o.map);
  const pids = new Set(Object.values(map));
  const drafts = (await fetchDrafts(o.campaign)).filter((e) => pids.has(e.prospect_id));
  const byProspect = {};
  for (const e of drafts) (byProspect[e.prospect_id] ||= []).push(e.step_number);
  const counts = Object.values(byProspect).map((s) => s.length);
  const full = counts.filter((c) => c === 3).length;
  console.log(`Batch prospects: ${pids.size}  with drafts: ${Object.keys(byProspect).length}  full 3-seq: ${full}`);
  const partial = Object.entries(byProspect).filter(([, s]) => s.length !== 3);
  if (partial.length) console.log('PARTIAL:', JSON.stringify(partial.slice(0, 20)));
  console.log(`Total draft emails for batch: ${drafts.length}`);
}

async function cmdApproveStep1(o) {
  const map = readJSON(o.map);
  const pids = new Set(Object.values(map));
  const drafts = await fetchDrafts(o.campaign);
  let ids = drafts.filter((e) => e.step_number === 1 && pids.has(e.prospect_id)).map((e) => e.id);
  console.log(`Step-1 drafts in batch: ${ids.length}`);
  if (o.limit) ids = ids.slice(0, Number(o.limit));
  if (o.dry) { console.log(`[dry] would approve ${ids.length} step-1 ids`); return; }
  let approved = 0;
  for (const part of chunk(ids, 500)) {
    const r = await api('POST', `/api/campaigns/${o.campaign}/approve-emails`, { email_ids: part });
    if (!r.ok) { console.error('approve FAILED', r.status, JSON.stringify(r.body).slice(0, 300)); process.exit(1); }
    approved += r.body?.data?.count ?? part.length;
    console.log(`  approved ${part.length} -> daily_limit ${r.body?.data?.daily_limit}, distribution`, JSON.stringify(r.body?.data?.distribution || {}));
    await sleep(400);
  }
  console.log(`TOTAL approved (step-1 only): ${approved}`);
}

(async () => {
  const cmd = process.argv[2];
  const o = args();
  if (cmd === 'insert') await cmdInsert(o);
  else if (cmd === 'verify') await cmdVerify(o);
  else if (cmd === 'approve-step1') await cmdApproveStep1(o);
  else { console.error('Unknown command. Use: insert | verify | approve-step1'); process.exit(1); }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
