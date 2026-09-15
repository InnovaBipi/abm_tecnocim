#!/usr/bin/env node
// Reprocesa respuestas ya detectadas (email_events 'replied') por el reply router:
// reenvío a la bandeja humana + alta en HubSpot, según la config del tenant.
//
// Es idempotente: el router salta cualquier acción que ya tenga una fila 'ok' en
// hubspot_sync_log para ese event_id, así que se puede relanzar sin duplicar
// emails ni leads.
//
// Uso:
//   node scripts/hubspot-backfill-replies.js                 # dry-run, tenant tecnocim, últimos 30 días
//   node scripts/hubspot-backfill-replies.js --apply         # ejecuta
//   node scripts/hubspot-backfill-replies.js --since=2026-06-01 --classification=positive --limit=50
//   node scripts/hubspot-backfill-replies.js --tenant=treemg --all --apply
//
// Flags:
//   --apply                 sin él NO envía nada, solo lista lo que haría
//   --tenant=<slug>         por defecto 'tecnocim'
//   --since=YYYY-MM-DD      por defecto hoy-30d (para no inundar la bandeja con respuestas viejas)
//   --all                   ignora --since
//   --classification=<c>    positive | negative | other | out_of_office (por defecto: todas salvo unsubscribe)
//   --limit=<n>             máximo de eventos (por defecto 200), de más antiguo a más reciente
//
// Requiere .env en la raíz (DB_* y, para el envío, la config Resend del tenant).
// Carga el código TS del server vía tsx (sin build previo).

const path = require('path');

const serverDir = path.join(__dirname, '..', 'server');
const tsxApi = require(require.resolve('tsx/cjs/api', { paths: [serverDir] }));
tsxApi.register();

const { query } = require(path.join(serverDir, 'src', 'config', 'database'));
const { getTenantBySlug } = require(path.join(serverDir, 'src', 'middleware', 'tenant'));
const { routeReply, shouldForward, shouldSyncHubSpot } = require(path.join(serverDir, 'src', 'services', 'replyRouter'));

const args = process.argv.slice(2);
const has = (k) => args.includes(`--${k}`);
const argOf = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };

const APPLY = has('apply');
const TENANT = argOf('tenant', 'tecnocim');
const ALL = has('all');
const SINCE = ALL ? null : argOf('since', new Date(Date.now() - 30 * 86400000).toISOString().substring(0, 10));
const CLASSIFICATION = argOf('classification', null);
const LIMIT = Math.max(1, parseInt(argOf('limit', '200'), 10) || 200);

const VALID = new Set(['positive', 'negative', 'other', 'out_of_office']);

(async () => {
  if (CLASSIFICATION && !VALID.has(CLASSIFICATION)) {
    console.error(`--classification inválida: ${CLASSIFICATION} (${[...VALID].join(' | ')})`);
    process.exit(2);
  }

  const tenant = await getTenantBySlug(TENANT);
  if (!tenant) { console.error(`Tenant '${TENANT}' no encontrado o inactivo`); process.exit(2); }

  const hs = tenant.config.hubspot;
  const rf = tenant.config.reply_forward;
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);
  console.log(`  hubspot:       ${hs ? `${hs.mode}${hs.enabled === false ? ' (pausado)' : ''}` : 'NO configurado'}`);
  console.log(`  reply_forward: ${rf && rf.to && rf.to.length ? rf.to.join(', ') + (rf.only_positive ? ' (solo positivas)' : '') : 'NO configurado'}`);
  if (!hs && !rf) {
    console.log('\nNada que hacer: el tenant no tiene ni hubspot ni reply_forward en config. Ver docs/hubspot-integration.md');
    process.exit(0);
  }

  const where = ["ee.tenant_id = ?", "ee.event_type = 'replied'"];
  const params = [tenant.id];
  if (SINCE) { where.push('ee.occurred_at >= ?'); params.push(SINCE); }
  where.push("COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ee.metadata, '$.reply_classification')), 'other') <> 'unsubscribe'");
  if (CLASSIFICATION) {
    where.push("COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ee.metadata, '$.reply_classification')), 'other') = ?");
    params.push(CLASSIFICATION);
  }

  const rows = await query(
    `SELECT ee.id, ee.prospect_id, ee.subject, ee.occurred_at,
            COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ee.metadata, '$.reply_classification')), 'other') AS classification,
            JSON_UNQUOTE(JSON_EXTRACT(ee.metadata, '$.reply_snippet')) AS snippet,
            JSON_UNQUOTE(JSON_EXTRACT(ee.metadata, '$.source')) AS source,
            ee.from_email,
            p.email AS prospect_email, p.full_name, c.name AS company_name,
            (SELECT COUNT(*) FROM hubspot_sync_log l WHERE l.event_id = ee.id AND l.status = 'ok') AS done_actions
     FROM email_events ee
     JOIN prospects p ON p.id = ee.prospect_id AND p.tenant_id = ee.tenant_id
     LEFT JOIN companies c ON c.id = p.company_id AND c.tenant_id = ee.tenant_id
     WHERE ${where.join(' AND ')}
     ORDER BY ee.occurred_at ASC
     LIMIT ${LIMIT}`,
    params
  );

  console.log(`\n${rows.length} respuesta(s) ${SINCE ? `desde ${SINCE}` : '(todas)'}${CLASSIFICATION ? ` · ${CLASSIFICATION}` : ''} — modo ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  const stats = { forward_ok: 0, forward_skip: 0, forward_err: 0, hs_ok: 0, hs_skip: 0, hs_err: 0 };
  for (const r of rows) {
    const cls = r.classification;
    const wouldForward = shouldForward(cls, rf);
    const wouldSync = shouldSyncHubSpot(cls, hs);
    const who = `${r.full_name || r.prospect_email}${r.company_name ? ` (${r.company_name})` : ''}`;
    const when = new Date(r.occurred_at).toISOString().substring(0, 16).replace('T', ' ');

    if (!APPLY) {
      const plan = [wouldForward ? 'forward' : '-', wouldSync ? `hubspot:${hs.mode}` : '-'].join(' · ');
      console.log(`  ${when}  ${cls.padEnd(13)} ${who.substring(0, 48).padEnd(50)} → ${plan}${r.done_actions > 0 ? `  (ya tiene ${r.done_actions} acción/es ok)` : ''}`);
      continue;
    }

    const res = await routeReply({
      tenantId: tenant.id,
      prospectId: r.prospect_id,
      eventId: r.id,
      classification: cls,
      subject: r.subject,
      snippet: r.snippet,
      from: r.from_email || r.prospect_email,
      source: r.source === 'manual' ? 'manual' : 'imap',
    });
    stats[`forward_${res.forward.status === 'ok' ? 'ok' : res.forward.status === 'error' ? 'err' : 'skip'}`]++;
    stats[`hs_${res.hubspot.status === 'ok' ? 'ok' : res.hubspot.status === 'error' ? 'err' : 'skip'}`]++;
    console.log(`  ${when}  ${cls.padEnd(13)} ${who.substring(0, 48).padEnd(50)} → forward:${res.forward.status}${res.forward.detail ? ` (${res.forward.detail})` : ''} · hubspot:${res.hubspot.status}${res.hubspot.detail ? ` (${res.hubspot.detail})` : ''}`);
  }

  if (APPLY) {
    console.log(`\nForward: ${stats.forward_ok} ok · ${stats.forward_skip} skip · ${stats.forward_err} error`);
    console.log(`HubSpot: ${stats.hs_ok} ok · ${stats.hs_skip} skip · ${stats.hs_err} error`);
    console.log('Detalle por acción en la tabla hubspot_sync_log.');
  } else {
    console.log('\nDry-run: no se ha enviado nada. Añade --apply para ejecutar.');
  }
  process.exit(0);
})().catch((err) => {
  console.error('Backfill falló:', err && (err.stack || err.message || err.code || err));
  if (err && (!err.message || /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ACCESS_DENIED/i.test(err.message + err.code))) {
    console.error('Pista: parece un fallo de conexión a MySQL. Revisa DB_HOST/DB_PORT/DB_USER/DB_PASS/DB_NAME/DB_SSL en .env (raíz).');
  }
  process.exit(1);
});
