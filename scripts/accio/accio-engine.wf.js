export const meta = {
  name: 'accio-engine',
  description: 'Descobreix i prepara empreses industrials catalanes per a l\'ajut ACCIÓ Noves Oportunitats (1 slice/run, neta ~50, en català)',
  phases: [
    { title: 'Discover' },
    { title: 'Scrape' },
    { title: 'Signal' },
    { title: 'Comply' },
    { title: 'Generate', model: 'opus' },
    { title: 'QA' },
  ],
}

// ---- args: { slice:{provincia,comarca,sector}, seen:[domains], target:50, angles:8 } ----
// args may arrive as a JSON string — parse defensively.
const A = (typeof args === 'string') ? JSON.parse(args) : (args || {})
const slice = (A.slice && A.slice.comarca) ? A.slice : { provincia: 'Barcelona', comarca: 'Valles Occidental', sector: 'metall' }
const TARGET = A.target || 50
const ANGLES = A.angles || 8
const seen = new Set((A.seen || []).map(d => String(d).toLowerCase().replace(/^www\./, '')))

const norm = d => String(d || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/\s+/g, '')
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
const S = (props, req) => ({ type: 'object', additionalProperties: false, properties: props, required: req })

async function tryAgent(prompt, opts, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try { const r = await agent(prompt, opts); if (r) return r } catch (e) { /* transient */ }
  }
  return null
}

// ===================== PHASE 1: DISCOVER =====================
phase('Discover')
const SECTOR_HINTS = {
  metall: 'metal·lúrgia, estampació, mecanitzat, calderería, fosa, tractaments de superfície, perfilería',
  plastic: 'injecció de plàstic, extrusió, motlles, termoconformat, cautxú, compostos',
  quimica: 'química, formulació, adhesius, pintures, resines, additius, cosmètica industrial',
  maquinaria: 'fabricació de maquinària, béns d\'equip, automatització, robòtica industrial',
  automocio: 'components d\'automoció, Tier 1/2, recanvis, mobilitat elèctrica',
  alimentacio: 'alimentació i begudes, processat, ingredients, conserves',
  envasos: 'envàs i embalatge, packaging, etiquetatge, cartró, flexibles',
  electronica: 'electrònica, PCB, components elèctrics, sensòrica',
  textil: 'tèxtil, filatura, teixits tècnics, confecció industrial',
  construccio: 'materials de construcció, prefabricats, fusteria d\'alumini, aïllaments',
  'fusta-mobiliari': 'fusta, mobiliari, fusteria industrial',
  'paper-arts-grafiques': 'paper, arts gràfiques, impressió industrial',
  'ceramica-materials': 'ceràmica, vidre, materials avançats',
  'biotec-farma': 'biotecnologia, farmàcia, dispositius mèdics, salut',
  'energia-mediambient': 'energia, eficiència energètica, reciclatge, economia circular',
}
const hint = SECTOR_HINTS[slice.sector] || slice.sector
const angleTemplates = [
  `polígons industrials i empreses de ${hint} a la comarca ${slice.comarca} (${slice.provincia}), Catalunya`,
  `directori d'empreses industrials de ${hint} a ${slice.comarca}`,
  `pimes fabricants ${hint} ${slice.comarca} ${slice.provincia} amb web pròpia`,
  `clúster / associació sectorial ${hint} Catalunya empreses ${slice.comarca}`,
  `notícies recents de diversificació, nou producte o inversió d'empreses ${hint} a ${slice.comarca}`,
  `empreses ${hint} ${slice.comarca} que han llançat una nova línia o han ampliat fàbrica`,
  `fabricants industrials ${slice.comarca} ${slice.provincia} ${hint} SL SA`,
  `empreses exportadores ${hint} ${slice.comarca} Catalunya`,
]
const DISCO = S({ companies: { type: 'array', items: S({
  name: { type: 'string' }, domain: { type: 'string' }, city: { type: 'string' },
  signal_hint: { type: 'string' }, source_url: { type: 'string' },
}, ['name', 'domain']) } }, ['companies'])

const discoveries = await parallel(
  Array.from({ length: ANGLES }, (_, i) => () => tryAgent(
    `Ets un investigador B2B. Cerca al web (usa firecrawl_search o WebSearch) empreses INDUSTRIALS REALS d'aquest perfil:\n` +
    `- Sector: ${slice.sector} (${hint})\n- Zona: comarca ${slice.comarca}, província ${slice.provincia}, Catalunya\n` +
    `Angle d'aquesta cerca: "${angleTemplates[i % angleTemplates.length]}"\n\n` +
    `REGLES:\n- Només empreses amb forma jurídica (SL, SA, SLU, SCCL...) i web pròpia (domini propi, NO directoris, NO marketplaces).\n` +
    `- SEU FÍSICA a la comarca ${slice.comarca} (${slice.provincia}), Catalunya. Verifica que el domini correspon a l'empresa LOCAL i no a una homònima d'una altra província/CCAA. Si dubtes de la localització, NO la incloguis.\n` +
    `- Pime industrial fabricant (evita grans multinacionals i autònoms).\n- Retorna el domini NET (sense https, sense www, sense path).\n` +
    `- Si veus un senyal de diversificació/nou producte/inversió, posa'l a signal_hint (curt). Si no, deixa'l buit.\n` +
    `- Objectiu: 30-45 empreses úniques REALS. No inventis dominis.`,
    { label: `disco:${slice.sector}:${i + 1}`, phase: 'Discover', schema: DISCO }
  ))
)
const seenInRun = new Set()
let candidates = []
for (const d of discoveries.filter(Boolean)) {
  for (const c of (d.companies || [])) {
    const dom = norm(c.domain)
    if (!dom || dom.length < 4 || !dom.includes('.')) continue
    if (seen.has(dom) || seenInRun.has(dom)) continue
    seenInRun.add(dom)
    candidates.push({ name: c.name, domain: dom, city: c.city || '', sector: slice.sector, signal_hint: c.signal_hint || '', source_url: c.source_url || '' })
  }
}
log(`Discover: ${discoveries.filter(Boolean).length}/${ANGLES} agents -> ${candidates.length} úniques noves`)

// ===================== PHASE 2: SCRAPE =====================
phase('Scrape')
const SCRAPE = S({ results: { type: 'array', items: S({
  domain: { type: 'string' }, email: { type: 'string' }, email_type: { type: 'string' },
  found: { type: 'boolean' }, source_url: { type: 'string' },
}, ['domain', 'found']) } }, ['results'])

const scraped = await parallel(
  chunk(candidates, 10).map((ch, i) => () => tryAgent(
    `Per a cada empresa, visita el seu web (firecrawl_scrape o WebFetch a la home i a /contacte /contacto /contact /avis-legal) i extreu UN email de contacte GENÈRIC del seu propi domini.\n` +
    `ACCEPTA només bústies genèriques: info@ contacte@ contacto@ comercial@ ventas@ vendes@ administracio@ administracion@ general@ hola@ oficina@ recepcio@ rrhh@ . REBUTJA emails personals (nom.cognom@), gratuïts (gmail/hotmail) i noreply@.\n` +
    `El host de l'email ha de coincidir amb el domini de l'empresa.\n\n` +
    `EMPRESES:\n${ch.map(c => `- ${c.name} | ${c.domain}`).join('\n')}\n\n` +
    `Retorna found=true només si has trobat un email genèric vàlid. No inventis emails.`,
    { label: `scrape:${i + 1}`, phase: 'Scrape', schema: SCRAPE }
  ))
)
const byDomain = new Map(candidates.map(c => [c.domain, c]))
let withEmail = []
for (const r of scraped.filter(Boolean)) {
  for (const e of (r.results || [])) {
    const dom = norm(e.domain)
    const base = byDomain.get(dom)
    if (!base || !e.found || !e.email) continue
    const host = String(e.email).split('@')[1] || ''
    if (norm(host) !== dom) continue
    base.email = e.email.toLowerCase().trim()
    base.email_type = e.email_type || ''
    if (e.source_url) base.source_url = e.source_url
    withEmail.push(base)
  }
}
log(`Scrape: ${withEmail.length}/${candidates.length} amb email genèric`)

// ===================== PHASE 3: SIGNAL + ELIGIBILITY =====================
phase('Signal')
const SIGNAL = S({ results: { type: 'array', items: S({
  domain: { type: 'string' }, signal: { type: 'string' }, signal_type: { type: 'string' },
  employees_estimate: { type: 'string' }, eligibility: { type: 'string' }, drop_reason: { type: 'string' },
}, ['domain', 'signal', 'eligibility']) } }, ['results'])

const signals = await parallel(
  chunk(withEmail, 6).map((ch, i) => () => tryAgent(
    `Per a cada empresa, cerca al web (WebSearch/firecrawl_search, 1-2 cerques) UN senyal CONCRET i REAL que demostri que DIVERSIFICA o llança una nova activitat (nou producte, nova línia, inversió en planta/maquinària, projecte R+D, expansió a nou mercat, adquisició, internacionalització). Aquest senyal és el requisit de l'ajut ACCIÓ "Noves Oportunitats de Negoci".\n` +
    `També avalua l'elegibilitat (ACCIÓ és de la Generalitat: NOMÉS empreses amb seu a Catalunya i pimes):\n` +
    `- "eligible": pime industrial (10-249 treballadors aprox.) amb seu a ${slice.provincia}/Catalunya que diversifica.\n` +
    `- "unsure": és industrial i catalana però amb senyal feble o mida no confirmada (dins 10-249).\n` +
    `- "ineligible" (OBLIGATORI): si la seu NO és a Catalunya (verifica al web: si l'empresa real del domini està a una altra província/CCAA com València, Madrid, País Basc, La Rioja, Aragó..., marca ineligible i explica-ho a drop_reason), o si clarament té MÉS de 250 treballadors (gran empresa), o no és industrial/és autònom/sector públic.\n` +
    `Comprova que el domini correspon REALMENT a una empresa amb seu a ${slice.comarca} (${slice.provincia}); si trobes discrepància de localització, és INELIGIBLE.\n` +
    `signal_type ∈ {diversificacio, nou_producte, inversio, expansio, adquisicio, rnd, export, cap}.\n` +
    `Si no trobes senyal, signal_type="cap" i descriu breument l'activitat principal com a senyal de context.\n\n` +
    `EMPRESES:\n${ch.map(c => `- ${c.name} | ${c.domain} | ${c.city} | ${c.signal_hint || ''}`).join('\n')}\n\n` +
    `Sigues concret i veraç. No inventis fets. Retorna el senyal en català.`,
    { label: `signal:${i + 1}`, phase: 'Signal', schema: SIGNAL }
  ))
)
for (const r of signals.filter(Boolean)) {
  for (const s of (r.results || [])) {
    const base = byDomain.get(norm(s.domain))
    if (!base) continue
    base.signal = s.signal || ''
    base.signal_type = s.signal_type || 'cap'
    base.employees_estimate = s.employees_estimate || ''
    base.eligibility = s.eligibility || 'unsure'
    base.drop_reason = s.drop_reason || ''
  }
}
let eligible = withEmail.filter(c => c.eligibility && c.eligibility !== 'ineligible' && c.signal)
log(`Signal: ${eligible.length} elegibles (eligible+unsure) amb senyal`)

// ===================== PHASE 4: COMPLY + DEDUP =====================
phase('Comply')
const COMPLY = S({ results: { type: 'array', items: S({
  domain: { type: 'string' }, legal_ok: { type: 'boolean' }, company_name: { type: 'string' }, reason: { type: 'string' },
}, ['domain', 'legal_ok']) } }, ['results'])
const complied = await parallel(
  chunk(eligible, 12).map((ch, i) => () => tryAgent(
    `Validació RGPD/LSSI per a prospecció B2B a Espanya. Per a cada empresa marca legal_ok=true NOMÉS si és una persona jurídica (SL, SA, SLU, SCCL, SCoop, SLL, SAL) — NO autònoms ni persones físiques. Normalitza el nom legal a company_name.\n\n` +
    `EMPRESES:\n${ch.map(c => `- ${c.name} | ${c.domain} | ${c.email}`).join('\n')}\n\nRetorna legal_ok i el motiu si és false.`,
    { label: `comply:${i + 1}`, phase: 'Comply', schema: COMPLY }
  ))
)
const okDomains = new Set()
for (const r of complied.filter(Boolean)) {
  for (const x of (r.results || [])) {
    const base = byDomain.get(norm(x.domain))
    if (!base) continue
    if (x.legal_ok) { okDomains.add(norm(x.domain)); if (x.company_name) base.company_name = x.company_name }
  }
}
let approved = eligible.filter(c => okDomains.has(c.domain)).map(c => ({ ...c, company_name: c.company_name || c.name, language: 'catalan' }))
// cap with buffer so QA losses still net ~TARGET
approved = approved.slice(0, Math.ceil(TARGET * 1.4))
// IMPORTANT: approved are CLONES — downstream merges must target these objects, not byDomain originals.
const aMap = new Map(approved.map(c => [c.domain, c]))
log(`Comply: ${approved.length} aprovades (entitat legal), cap ${Math.ceil(TARGET * 1.4)}`)

// ===================== PHASE 5: GENERATE =====================
phase('Generate')
const GEN = S({ results: { type: 'array', items: S({
  domain: { type: 'string' },
  emails: { type: 'array', items: S({ step_number: { type: 'number' }, subject: { type: 'string' }, body_html: { type: 'string' } }, ['step_number', 'subject', 'body_html']) },
}, ['domain', 'emails']) } }, ['results'])

const BRIEF = (c) =>
  `Empresa: ${c.company_name} (${c.domain}) — ${c.city}, ${slice.comarca}. Sector: ${slice.sector}.\n` +
  `Senyal real (${c.signal_type}): ${c.signal}\nElegibilitat: ${c.eligibility}\n`

const generated = await parallel(
  chunk(approved, 3).map((ch, i) => () => tryAgent(
    `Ets l'Alfons Marques, de Tecnocim Innova (consultor acreditat ACCIÓ). Escriu una seqüència de 3 correus EN CATALÀ per a cada empresa, sobre l'ajut ACCIÓ "Noves Oportunitats de Negoci 2026".\n\n` +
    `PRODUCTE (no inventis imports ni terminis):\n- L1.1: pla de negoci de la nova activitat amb consultor acreditat — 75% a fons perdut, fins a 30.000 EUR.\n- L1.2: implementació (maquinària, formació, personal, despeses externes) — fins a 90.000 EUR.\n- Termini de sol·licitud: 16 de juliol de 2026. Tecnocim Innova és consultor acreditat ACCIÓ.\n\n` +
    `REGLES DURES:\n- Idioma: CATALÀ. Res de ¿ ni ¡. Res de castellanismes (usa: equip, servei, gestió, inversió, també, però, projecte, resultats).\n` +
    `- Salutació SEMPRE "Hola," (bústia genèrica, mai un nom de persona). Tancament "Salutacions,".\n` +
    `- Firma EXACTA en dues línies: "Alfons Marques" i "Tecnocim Innova". "Marques" SENSE accent. Sense URL.\n` +
    `- body_html amb <p>...</p>. 0 enllaços, 0 imatges. Res de "Unknown", variables {{}}, ni el nom de la campanya.\n\n` +
    `ESTRUCTURA:\n- Step 1 (50-80 paraules): OBRE amb el senyal REAL i concret d'AQUESTA empresa (no amb el pitch). Pont: aquesta diversificació encaixa amb Noves Oportunitats de Negoci. Esmenta que Tecnocim és consultor acreditat ACCIÓ. CTA suau (p.ex. "Té sentit que ho explorem?"). Subject 21-40 car., lligat al senyal.\n` +
    `- Step 2 (50-70 paraules): valor concret. Mapa el senyal a L1.1 (75%/30k) i L1.2 (fins 90k). "Preparem tot el dossier." CTA suau ("Us faig una valoració preliminar sense compromís"). Subject NOU.\n` +
    `- Step 3 (40-60 paraules): tancament suau referenciant el senyal del step 1 + recordatori "el termini és el 16 de juliol". Sense pressió. Subject curt.\n` +
    `- Si eligibility="unsure": to de "valorar si hi encaixa", sense afirmar encaix segur.\n\n` +
    `EMPRESES:\n${ch.map(BRIEF).join('\n')}\n\nRetorna 3 emails per empresa, amb el domini exacte.`,
    { label: `gen:${i + 1}`, phase: 'Generate', model: 'opus', schema: GEN }
  ))
)
for (const r of generated.filter(Boolean)) {
  for (const g of (r.results || [])) {
    const base = aMap.get(norm(g.domain))
    if (base && Array.isArray(g.emails) && g.emails.length === 3) base.emails = g.emails.sort((a, b) => a.step_number - b.step_number)
  }
}
let drafted = approved.filter(c => Array.isArray(c.emails) && c.emails.length === 3)
log(`Generate: ${drafted.length} amb seqüència completa de 3`)

// ===================== PHASE 6: QA =====================
phase('QA')
const QA = S({ results: { type: 'array', items: S({
  domain: { type: 'string' }, qa_status: { type: 'string' }, issues: { type: 'array', items: { type: 'string' } },
  emails: { type: 'array', items: S({ step_number: { type: 'number' }, subject: { type: 'string' }, body_html: { type: 'string' } }, ['step_number', 'subject', 'body_html']) },
}, ['domain', 'qa_status', 'emails']) } }, ['results'])

const qad = await parallel(
  chunk(drafted, 9).map((ch, i) => () => tryAgent(
    `Ets un QA d'emails en CATALÀ. Per a cada email revisa i CORREGEIX (retorna la versió corregida a emails):\n` +
    `- Català natiu: elimina ¿ ¡ i tot castellanisme (saludos, atentamente, también, además, pero, equipo, proyecto, servicio, gestión).\n` +
    `- Accents catalans correctes (innovació, inversió, diversificació, gestió, també, però, més, experiència).\n` +
    `- Salutació "Hola," (sense nom). Tancament "Salutacions,". Firma EXACTA "Alfons Marques" (SENSE accent) + "Tecnocim Innova".\n` +
    `- Paraules: step1 50-80, step2 50-70, step3 40-60. Subject 21-40 car. (step3 pot ser més curt). Sense "Unknown", {{}}, ni nom de campanya. 0 enllaços/imatges.\n` +
    `qa_status: "pass" si ja estava bé, "fixed" si has corregit, "fail" si no es pot salvar (massa curt, genèric o buit).\n\n` +
    `EMAILS (per domini):\n${ch.map(c => `### ${c.domain}\n${c.emails.map(e => `[step ${e.step_number}] ${e.subject}\n${e.body_html}`).join('\n')}`).join('\n\n')}\n\n` +
    `Retorna per cada domini el qa_status, els issues i els 3 emails (corregits si cal).`,
    { label: `qa:${i + 1}`, phase: 'QA', schema: QA }
  ))
)
const qaFailures = []
for (const r of qad.filter(Boolean)) {
  for (const q of (r.results || [])) {
    const base = aMap.get(norm(q.domain))
    if (!base) continue
    base.qa_status = q.qa_status
    base.qa_issues = q.issues || []
    if (q.qa_status === 'fail') { qaFailures.push({ domain: q.domain, issues: q.issues }); continue }
    if (Array.isArray(q.emails) && q.emails.length === 3) base.emails = q.emails.sort((a, b) => a.step_number - b.step_number)
  }
}
const shipped = drafted.filter(c => c.qa_status && c.qa_status !== 'fail' && Array.isArray(c.emails) && c.emails.length === 3)

const stats = {
  slice: `${slice.comarca} × ${slice.sector}`,
  discovered: candidates.length, with_email: withEmail.length, eligible: eligible.length,
  approved: approved.length, drafted: drafted.length, shipped: shipped.length, qa_failed: qaFailures.length,
}
log(`QA: ${shipped.length} ship-ready | FUNNEL ${JSON.stringify(stats)}`)

return {
  stats,
  prospects: shipped.map(c => ({
    name: c.company_name, domain: c.domain, email: c.email, city: c.city, sector: slice.sector,
    region: 'Catalunya', country: 'Spain', signal: c.signal, signal_type: c.signal_type,
    employees_estimate: c.employees_estimate, eligibility: c.eligibility, language: 'catalan',
  })),
  emails: shipped.map(c => ({ name: c.company_name, domain: c.domain, city: c.city, sector: slice.sector, signal: c.signal, email: c.email, emails: c.emails })),
  qa_failures: qaFailures,
}
