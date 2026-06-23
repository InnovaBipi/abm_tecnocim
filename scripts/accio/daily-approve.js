// Daily bounce-gated approval of ACCIÓ step-1 drafts.
// - Checks deliverability (last 2 days). Pauses if bounce_rate>=THRESH or complaint_rate>=0.1%.
// - Approves up to TRANCHE step-1 drafts (distributeEmailsAcrossBusinessDays spreads them at the cap).
// - Leaves step-2/step-3 as drafts (deferred until after the 10-jul first-touch push).
//
// Usage: node daily-approve.js [--campaign <id>] [--tranche 400] [--bounce-thresh 4] [--dry]
'use strict';
const { api } = require('./lib');

const CAMPAIGN = process.env.ACCIO_CAMPAIGN || '09ff25ad-04e5-4d5e-906d-af3a0795c2f3';
function args() { const a = process.argv.slice(2), o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = (a[i + 1] && !a[i + 1].startsWith('--')) ? a[++i] : true; return o; }
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
function madridDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' }); // YYYY-MM-DD
}

(async () => {
  const o = args();
  const campaign = o.campaign || CAMPAIGN;
  const tranche = Number(o.tranche || 400);
  const bounceThresh = Number(o['bounce-thresh'] || 4);

  // 1) deliverability gate (last 2 days)
  const from = madridDate(-2), to = madridDate(0);
  const dr = await api('GET', `/api/dashboard/deliverability?date_from=${from}&date_to=${to}`);
  const m = dr.body?.data || {};
  const bounce = Number(m.bounce_rate || 0), complaint = Number(m.complaint_rate || 0);
  console.log(`[gate] ${from}..${to} sent=${m.sent} bounced=${m.bounced} bounce_rate=${bounce}% complaint_rate=${complaint}%`);
  if (bounce >= bounceThresh || complaint >= 0.1) {
    console.log(`[PAUSE] bounce_rate ${bounce}% (>=${bounceThresh}) or complaint ${complaint}% (>=0.1) — NOT approving. Investigate.`);
    return;
  }

  // 2) fetch step-1 drafts
  const r = await api('GET', `/api/campaigns/${campaign}/generated-emails?status=draft&limit=5000`);
  const drafts = r.body?.data?.emails || [];
  let ids = drafts.filter((e) => e.step_number === 1).map((e) => e.id);
  console.log(`step-1 drafts available: ${ids.length}`);
  ids = ids.slice(0, tranche);
  if (!ids.length) { console.log('nothing to approve.'); return; }
  if (o.dry) { console.log(`[dry] would approve ${ids.length} step-1 ids`); return; }

  // 3) approve (chunks of 500)
  let approved = 0;
  for (const part of chunk(ids, 500)) {
    const ar = await api('POST', `/api/campaigns/${campaign}/approve-emails`, { email_ids: part });
    if (ar.ok) { approved += ar.body?.data?.count ?? part.length; console.log(`  +${part.length} approved, daily_limit ${ar.body?.data?.daily_limit}, dist`, JSON.stringify(ar.body?.data?.distribution || {})); }
    else console.error('approve failed', ar.status, JSON.stringify(ar.body).slice(0, 200));
  }
  console.log(`TOTAL approved step-1: ${approved}`);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
