// Saneo de la cola: emails 'scheduled' con fecha pasada.
//
// Tres conjuntos disjuntos, cada uno con su destino:
//   A) secuencias que nunca arrancaron (s1 aun 'scheduled') -> reprogramar enteras
//   B) cierres rancios: predecesor 'sent' hace >UMBRAL dias  -> rejected (stale_cadence)
//   C) huerfanos: predecesor en estado TERMINAL != sent      -> rejected (orphaned...)
//
// El predecesor 'scheduled'/'draft' NO es terminal: esta esperando. Confundirlo mata
// colas de secuencia legitimas (paso a un paso de hacerlo con 38 emails).
//
// Uso: node sanitize-stale-queue.js [--apply]
const fs = require('fs');
const https = require('https');
const TOKEN = fs.readFileSync('C:/Users/user/tmp_token.txt', 'utf8').trim();
const API = 'abm.tecnociminnova.com';
const APPLY = process.argv.includes('--apply');
const TODAY = '2026-08-25';
const STALE_DAYS = 7;            // D3: p99 del retraso legitimo = 1,65 d
const TERMINAL = new Set(['rejected', 'bounced', 'replied']);

function api(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
    const req = https.request({ hostname: API, path: p, method,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json; charset=utf-8',
        ...(data ? { 'Content-Length': data.length } : {}) } },
      (res) => { let d=''; res.on('data',c=>d+=c);
        res.on('end',()=>{ try{resolve({status:res.statusCode,body:JSON.parse(d)});}catch{resolve({status:res.statusCode,body:{raw:d.slice(0,200)}});} }); });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

(async () => {
  const all = new Map();
  for (const st of ['draft', 'scheduled', 'sent', 'rejected', 'bounced']) {
    let page = 1;
    while (page <= 80) {
      const r = await api('GET', `/api/outbox?status=${st}&limit=100&page=${page}`);
      const em = r.body?.data?.emails || [];
      for (const e of em) all.set(e.id, { ...e, _st: st });
      const tp = r.body?.data?.pagination?.totalPages || 1;
      if (page >= tp || !em.length) break; page++;
    }
  }
  const rows = [...all.values()];
  const key = (e) => `${e.campaign_id}::${e.prospect_id}`;
  const byPC = {};
  for (const e of rows) (byPC[key(e)] = byPC[key(e)] || []).push(e);

  const past = rows.filter((e) => e._st === 'scheduled' && (e.scheduled_for || '') < TODAY);
  const A = [], B = [], C = [];
  const seqNeverStarted = new Set();
  for (const e of past) {
    if (e.step_number === 1) seqNeverStarted.add(key(e));
  }
  for (const e of past) {
    if (seqNeverStarted.has(key(e))) { A.push(e); continue; }
    const prev = (byPC[key(e)] || []).find((x) => x.step_number === e.step_number - 1);
    if (!prev) { C.push(e); continue; }
    if (prev._st === 'sent') {
      const lateDays = (new Date(TODAY) - new Date(prev.sent_at || prev.updated_at)) / 86400000;
      (lateDays > STALE_DAYS ? B : A).push(e);
    } else if (TERMINAL.has(prev._st)) C.push(e);
    else A.push(e); // predecesor esperando -> se reprograma con su secuencia
  }

  const fmt = (label, set) => {
    const byC = {};
    for (const e of set) byC[e.campaign_id.slice(0, 8)] = (byC[e.campaign_id.slice(0, 8)] || 0) + 1;
    console.log(`${label.padEnd(38)} ${String(set.length).padStart(3)}  ${JSON.stringify(byC)}`);
  };
  console.log(`scheduled con fecha < ${TODAY}: ${past.length}`);
  fmt('A) reprogramar (secuencia entera)', A);
  fmt('B) rechazar: cierre rancio', B);
  fmt('C) rechazar: huerfano (prev terminal)', C);
  console.log('suma:', A.length + B.length + C.length, '| disjuntos:',
    new Set([...A, ...B, ...C].map((e) => e.id)).size === past.length);

  fs.writeFileSync('sanitize-plan.json', JSON.stringify({
    reschedule: A.map((e) => e.id),
    reject_stale: B.map((e) => e.id),
    reject_orphan: C.map((e) => e.id),
  }, null, 1));
  console.log('plan escrito en scripts/sanitize-plan.json');

  if (!APPLY) { console.log('\n[simulacro] Nada modificado. Relanzar con --apply.'); return; }

  // OJO: PUT generated-emails acepta {subject, body_html, status, sent_at, scheduled_for}
  // pero NO metadata, asi que el skip_reason NO se puede escribir en la fila desde aqui.
  // La traza queda en sanitize-audit.json. El reaper (server-side, SQL directo) si lo escribe.
  let ok = 0, ko = 0;
  const audit = [];
  for (const [set, reason] of [[B, 'stale_cadence'], [C, 'orphaned_predecessor_not_sent']]) {
    for (const e of set) {
      const r = await api('PUT', `/api/campaigns/${e.campaign_id}/generated-emails/${e.id}`,
        { status: 'rejected' });
      const okOne = !!r.body?.success;
      audit.push({ id: e.id, campaign_id: e.campaign_id, prospect_id: e.prospect_id,
        step: e.step_number, was_scheduled_for: e.scheduled_for, reason, applied: okOne, at: new Date().toISOString() });
      if (okOne) ok++; else { ko++; if (ko <= 3) console.log('FALLO', e.id, r.status, JSON.stringify(r.body).slice(0, 140)); }
    }
  }
  fs.writeFileSync('sanitize-audit.json', JSON.stringify(audit, null, 1));
  console.log(`rechazados OK ${ok}, fallos ${ko} (traza en scripts/sanitize-audit.json)`);
  const red = await api('POST', '/api/outbox/redistribute', { email_ids: A.map((e) => e.id), start_date: '2026-09-01' });
  console.log('redistribute ->', JSON.stringify(red.body?.data || red.body).slice(0, 300));
})();
