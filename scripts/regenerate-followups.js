/**
 * Regenerate follow-up emails (steps 2-3) for 613 prospects
 * whose original follow-ups were rejected due to "Unknown" bug.
 *
 * Reads each prospect's step 1 content and generates coherent
 * follow-ups based on it. No AI/WebSearch needed.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

// --- API helpers ---
let TOKEN = '';
const post = (urlPath, body) => new Promise((res, rej) => {
  const data = JSON.stringify(body);
  const opts = {
    hostname: 'abm.tecnociminnova.com', path: urlPath, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Authorization': 'Bearer ' + TOKEN },
    rejectUnauthorized: false
  };
  const r = https.request(opts, resp => {
    let d = ''; resp.on('data', c => d += c);
    resp.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.substring(0, 200))); } });
  });
  r.on('error', rej); r.write(data); r.end();
});
const get = (urlPath) => new Promise((res, rej) => {
  const opts = {
    hostname: 'abm.tecnociminnova.com', path: urlPath, method: 'GET',
    headers: { 'Authorization': 'Bearer ' + TOKEN },
    rejectUnauthorized: false
  };
  const r = https.request(opts, resp => {
    let d = ''; resp.on('data', c => d += c);
    resp.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.substring(0, 200))); } });
  });
  r.on('error', rej); r.end();
});

// --- Language detection from step 1 body ---
function isCatalan(body) {
  const catalanWords = /\b(vostre|ajudem|deduccions|innovació|empreses|activitat|tècni[cq]|qualifica|aprofiten|explorar-ho|Hola,\s+[A-Z].*destaca per)\b/i;
  const catalanChars = /[àèòïü]/;
  return catalanWords.test(body) && catalanChars.test(body);
}

// --- Extract company name from step 1 subject ---
function extractCompany(subject, body) {
  // Try subject patterns: "CompanyName e incentivos", "CompanyName: retorno", "CompanyName i deduccions"
  const patterns = [
    /^(.+?)\s+[ei]\s+(incentivos|deduccions|bonificaciones|retorno)/i,
    /^(.+?):\s+/,
    /^(.+?)\s+y\s+(bonificaciones|deducciones)/i,
  ];
  for (const p of patterns) {
    const m = subject.match(p);
    if (m && m[1].length > 3 && m[1].length < 60) return m[1].trim();
  }
  // Fallback: try body for company name after "Hola,"
  const bodyMatch = body.match(/(?:veo que|observando|He visto que|destaca por)\s+(.+?)(?:\s+lleva|\s+destaca|\s+combina|\s+ha )/i);
  if (bodyMatch) return bodyMatch[1].trim();
  return null;
}

// --- Extract subsector hint from step 1 body ---
function extractSubsector(body) {
  const patterns = [
    /sector\s+de\s+(.+?)(?:\s+en\s+|\s+y\s+|\.\s)/i,
    /especializ\w+\s+en\s+(.+?)(?:\.\s|\s+y\s+|\s+para\s)/i,
    /(?:inyección|extrusión|fundición|mecanizado|rotomoldeo|caucho|prefabricad|software|ERP|MES|robótica|aislamiento|estructuras)/i,
  ];
  for (const p of patterns) {
    const m = body.match(p);
    if (m && m[1]) return m[1].trim().substring(0, 40);
  }
  // Generic subsector from keywords
  if (/fundici/i.test(body)) return 'fundición';
  if (/mecanizad/i.test(body)) return 'mecanizado de precisión';
  if (/inyecci/i.test(body)) return 'inyección de plástico';
  if (/rotomolde/i.test(body)) return 'rotomoldeo';
  if (/caucho|elastómer/i.test(body)) return 'caucho técnico';
  if (/extrusi/i.test(body)) return 'extrusión';
  if (/prefabricad|formigó|hormigón/i.test(body)) return 'prefabricados';
  if (/modular/i.test(body)) return 'construcción modular';
  if (/BIM|estructur/i.test(body)) return 'estructuras';
  if (/aislam/i.test(body)) return 'aislamiento técnico';
  if (/ERP|MES|software/i.test(body)) return 'software industrial';
  if (/robótic|robot/i.test(body)) return 'robótica';
  if (/IA|inteligencia artificial|visió/i.test(body)) return 'inteligencia artificial';
  if (/formaci|training/i.test(body)) return 'formación';
  if (/cosmét/i.test(body)) return 'cosmética';
  if (/farmac/i.test(body)) return 'farmacéutico';
  if (/automo/i.test(body)) return 'automoción';
  if (/electrón/i.test(body)) return 'electrónica';
  if (/aliment|conserv/i.test(body)) return 'alimentación';
  if (/energía|solar|eólic/i.test(body)) return 'energía';
  if (/biotech|biotecnol/i.test(body)) return 'biotecnología';
  if (/cerám|vidrio/i.test(body)) return 'cerámica';
  if (/textil|fibra/i.test(body)) return 'textil';
  if (/quím|adhesiv/i.test(body)) return 'química';
  if (/aeronáutic|aeroespac/i.test(body)) return 'aeronáutica';
  return 'su sector';
}

// --- Phrasing rotation ---
const phrasings_es = [
  'deducciones fiscales de I+D+i',
  'incentivos fiscales por innovación de hasta el 42%',
  'bonificaciones del Art. 35 en Sociedades',
  'retorno fiscal del 25-42% sobre inversión en I+D',
  'deducciones por innovación tecnológica',
  'recuperar entre el 25% y el 42% en I+D+i',
  'incentivos del Art. 35 de Sociedades',
  'bonificaciones fiscales por I+D+i de hasta el 42%'
];
const phrasings_ca = [
  "deduccions fiscals d'I+D+i",
  "incentius fiscals per innovació de fins al 42%",
  "bonificacions de l'Art. 35 en Societats",
  "retorn fiscal del 25-42% sobre inversió en I+D",
  "deduccions per innovació tecnològica"
];
const step2CTAs_es = [
  '¿Le gustaría que le enviásemos un análisis preliminar gratuito?',
  '¿Tiene sentido que revisemos juntos el potencial de deducción?',
  '¿Le interesaría conocer el cálculo estimado para su caso?',
  '¿Quiere que le envíe un ejemplo de lo que recuperan empresas similares?',
];
const step2CTAs_ca = [
  "Voldríeu que us enviéssim una anàlisi preliminar gratuïta?",
  "Té sentit que revisem junts el potencial de deducció?",
  "Us interessaria conèixer el càlcul estimat pel vostre cas?",
];
const step3CTAs_es = [
  'Si no es buen momento, sin problema. Quedo a disposición.',
  'Entiendo si no es prioritario ahora. Aquí estamos cuando lo necesite.',
  'Sin compromiso. Si en algún momento le interesa, escriba sin problema.',
  'Si prefiere dejarlo para más adelante, lo entiendo perfectamente.',
];
const step3CTAs_ca = [
  'Si no és bon moment, cap problema. Quedo a disposició.',
  'Entenc si no és prioritari ara. Aquí estem quan ho necessiteu.',
  'Sense compromís. Si us interessa més endavant, escriviu sense problema.',
];

function generateFollowups(prospect, idx) {
  const catalan = isCatalan(prospect.step1Body);
  const company = extractCompany(prospect.step1Subject, prospect.step1Body);
  const subsector = extractSubsector(prospect.step1Body);
  const shortCompany = company ? company.replace(/\s*(S\.L\.U?\.|S\.A\.U?\.|S\.L\.L?\.)$/i, '').trim() : null;

  const p2 = catalan ? phrasings_ca[idx % phrasings_ca.length] : phrasings_es[idx % phrasings_es.length];
  const cta2 = catalan ? step2CTAs_ca[idx % step2CTAs_ca.length] : step2CTAs_es[idx % step2CTAs_es.length];
  const cta3 = catalan ? step3CTAs_ca[idx % step3CTAs_ca.length] : step3CTAs_es[idx % step3CTAs_es.length];

  // Step 2
  let subj2, body2;
  const subsectorLabel = catalan ? subsector.replace(/su sector/, 'el vostre sector') : subsector;
  if (catalan) {
    subj2 = `Recuperació fiscal en ${subsectorLabel}`;
    body2 = `<p>Hola,</p><p>Complementant el meu missatge anterior: empreses del sector de ${subsectorLabel} a Espanya recuperen de mitjana entre 50.000 i 200.000 euros anuals gràcies a les ${p2}.</p><p>El nostre sistema BIPI identifica automàticament quines activitats qualifiquen, sense paperassa addicional per al vostre equip.</p><p>${cta2}</p><p>Alfons Marquès<br>Tecnocim Innova</p>`;
  } else {
    subj2 = `Recuperación fiscal en ${subsectorLabel}`;
    body2 = `<p>Hola,</p><p>Complementando mi mensaje anterior: empresas del sector de ${subsectorLabel} en España recuperan de media entre 50.000 y 200.000 euros anuales gracias a las ${p2}.</p><p>Nuestro sistema BIPI identifica automáticamente qué actividades cualifican, sin papeleo adicional para su equipo.</p><p>${cta2}</p><p>Alfons Marquès<br>Tecnocim Innova</p>`;
  }

  // Step 3
  let subj3, body3;
  if (catalan) {
    subj3 = shortCompany ? `Últim missatge, ${shortCompany}` : `Últim missatge`;
    body3 = `<p>Hola,</p><p>Us vaig contactar fa uns dies sobre les deduccions fiscals d'I+D+i aplicables a ${subsectorLabel}. Entenc que potser no és prioritari ara.</p><p>${cta3}</p><p>Alfons Marquès<br>Tecnocim Innova</p>`;
  } else {
    subj3 = shortCompany ? `Último mensaje, ${shortCompany}` : `Último mensaje`;
    body3 = `<p>Hola,</p><p>Les contacté hace unos días sobre las deducciones fiscales de I+D+i aplicables a ${subsectorLabel}. Entiendo que quizá no sea prioritario ahora.</p><p>${cta3}</p><p>Alfons Marquès<br>Tecnocim Innova</p>`;
  }

  // Trim subjects
  if (subj2.length > 40) subj2 = subj2.substring(0, 37) + '...';
  if (subj3.length > 30) subj3 = subj3.substring(0, 27) + '...';

  return [
    { prospect_id: prospect.prospectId, step_number: 2, delay_days: 3, subject: subj2, body_html: body2 },
    { prospect_id: prospect.prospectId, step_number: 3, delay_days: 7, subject: subj3, body_html: body3 }
  ];
}

// --- Main ---
(async () => {
  // Login
  const login = await post('/api/auth/login', { email: 'alfons.marques@tecnocim.com', password: process.env.ABM_PASSWORD, tenant_slug: 'tecnocim' });
  if (!login.success) { console.log('Login failed:', login.error); return; }
  TOKEN = login.data.token;
  console.log('Login OK');

  // Load prospects
  const prospects = JSON.parse(fs.readFileSync('/tmp/needs_followup_full.json', 'utf8'));
  console.log('Prospects to process:', prospects.length);

  // Generate all follow-ups
  const allEmails = [];
  let qaIssues = 0;

  prospects.forEach((p, idx) => {
    const emails = generateFollowups(p, idx);

    // QA check
    emails.forEach(e => {
      const all = (e.subject + ' ' + e.body_html).toLowerCase();
      if (/unknown/i.test(all)) { console.error('QA FAIL: Unknown in', p.email, 'step', e.step_number); qaIssues++; }
      if (/batch\s*\d/i.test(all)) { console.error('QA FAIL: Batch ref in', p.email); qaIssues++; }
      if (/deducciones i\+d\+i 2026/i.test(all)) { console.error('QA FAIL: Campaign name in', p.email); qaIssues++; }
      if (/\{\{/.test(all)) { console.error('QA FAIL: Template var in', p.email); qaIssues++; }
    });

    allEmails.push(...emails.map(e => ({ ...e, campaignId: p.campaignId })));
  });

  console.log('\nGenerated:', allEmails.length, 'emails');
  console.log('QA issues:', qaIssues);

  if (qaIssues > 0) {
    console.log('ABORTING: QA issues found. Fix before proceeding.');
    return;
  }

  // Group by campaign
  const byCampaign = {};
  allEmails.forEach(e => {
    if (!byCampaign[e.campaignId]) byCampaign[e.campaignId] = [];
    byCampaign[e.campaignId].push({ prospect_id: e.prospect_id, step_number: e.step_number, subject: e.subject, body_html: e.body_html, delay_days: e.delay_days });
  });

  // Bulk insert per campaign
  let totalInserted = 0;
  for (const [campId, emails] of Object.entries(byCampaign)) {
    const campName = prospects.find(p => p.campaignId === campId)?.campaignName || campId.substring(0, 8);

    // Insert in batches of 100
    for (let i = 0; i < emails.length; i += 100) {
      const batch = emails.slice(i, i + 100);
      const r = await post('/api/campaigns/' + campId + '/bulk-insert-emails', { emails: batch });
      if (r.success) {
        totalInserted += r.data?.inserted || 0;
      } else {
        console.error('Insert error for', campName, ':', r.error);
      }
    }
    console.log(campName + ': ' + emails.length + ' emails inserted');
  }

  console.log('\nTotal inserted:', totalInserted);

  // Approve all drafts per campaign
  console.log('\n=== APPROVING ===');
  let totalApproved = 0;
  for (const [campId, _] of Object.entries(byCampaign)) {
    const campName = prospects.find(p => p.campaignId === campId)?.campaignName || campId.substring(0, 8);

    // Fetch drafts
    let page = 1, allDrafts = [];
    while (true) {
      const r = await get('/api/campaigns/' + campId + '/generated-emails?status=draft&limit=200&page=' + page);
      const emails = r.data?.emails || [];
      allDrafts = allDrafts.concat(emails);
      if (!r.pagination || page >= r.pagination.totalPages) break;
      page++;
    }

    if (allDrafts.length === 0) {
      console.log(campName + ': no drafts to approve');
      continue;
    }

    const draftIds = allDrafts.map(e => e.id);
    console.log(campName + ': approving ' + draftIds.length + ' drafts...');

    // Approve in batches of 200
    for (let i = 0; i < draftIds.length; i += 200) {
      const batch = draftIds.slice(i, i + 200);
      const r = await post('/api/campaigns/' + campId + '/approve-emails', { email_ids: batch });
      if (r.success) {
        totalApproved += r.data?.count || 0;
        console.log('  Batch approved:', r.data?.count, '| Distribution:', JSON.stringify(r.data?.distribution || {}));
      } else {
        console.error('  Approve error:', r.error);
      }
    }
  }

  console.log('\nTotal approved:', totalApproved);
  console.log('\nDone! Follow-ups regenerated for', prospects.length, 'prospects.');
})().catch(e => console.error('Fatal:', e.message));
