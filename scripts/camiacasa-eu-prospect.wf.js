// TENANT ISOLATION: this workflow contains NO SQL. All data access goes through the ABM REST API
// with a CamiaCasa JWT (Authorization: Bearer); tenant_id scoping is enforced server-side by
// middleware/auth.ts + tenant.ts on every endpoint (GET/POST /api/prospects, /api/companies,
// /api/campaigns/*). The JWT itself carries tenantId — no cross-tenant access is possible.

export const meta = {
  name: 'camiacasa-eu-prospect',
  description: 'EU institutional-buyer prospecting for CamiaCasa off-market inventory (naves industriales, solares urbanizados, hoteles). Hybrid named/generic contacts, 3-step multi-language emails, DRAFT import to campaign a8ce08b1. On-demand, no auto-approval.',
  phases: [
    { title: 'Setup', detail: 'Auth CamiaCasa, dedup tenant-wide, read rotation state, select segment' },
    { title: 'Research', detail: 'Discover buyers EU-wide, hunt named acquisition contacts (fallback generic), MX verify' },
    { title: 'Generate', detail: 'Enrich thesis + 3-step emails per language + QA (7 dims) + native eval, 3-retry' },
    { title: 'Import', detail: 'Companies -> prospects -> enroll -> bulk-insert-emails (verified prospect_ids) -> persist state' }
  ]
}

// ============ CONSTANTS ============

const CAMPAIGN_ID = 'a8ce08b1-8677-41fe-a923-bfb201e1d0c2' // existing "Oportunidades de inversión" — NEVER create a campaign
const BASE_URL = 'https://abm.tecnociminnova.com'
const TOKEN_FILE = 'C:/Users/user/tmp_auth_cc.txt'
const STATE_DIR = 'C:/Users/user/proyectos/abm_tecnocim/scripts/output/camiacasa-eu-prospect'

// vgpparks.eu = existing CLIENT (Pablo Valderrama thread) — forbidden to contact or mention.
// despina-im.com = intermediary in the same thread — forbidden to contact.
const EXCLUDED_DOMAINS = ['vgpparks.eu', 'despina-im.com']
// DE/AT: UWG opt-in regime — no cold email, handled via LinkedIn only.
const EXCLUDED_COUNTRIES = ['Germany', 'Austria', 'Alemania', 'Deutschland', 'Österreich']
// Mega-funds already covered by previous batches — skip, they ignore cold origination emails.
const MEGA_FUNDS = ['Blackstone', 'Brookfield', 'GIC', 'Amundi', 'Covivio', 'Ardian', 'Patrizia', 'Prologis', 'Segro', 'Goodman', 'AXA IM', 'Allianz']

const SEGMENT_ORDER = ['industrial-developers', 'logistics-investors', 'land-developers', 'hotel-investors', 'family-offices-eu', 'socimi-funds-es', 'industrial-land-investors', 'restaurant-hospitality-operators']

const SEGMENT_CONFIG = {
  'industrial-developers': {
    buyer_profile: 'Pan-European industrial/logistics developer with land acquisition teams active or expanding in Iberia (Panattoni/P3/CTP/Garbe/Mountpark/Baytree/Verdion/Scannell profile — discover via generic queries, do not limit to these names)',
    asset_focus: 'industrial warehouses (naves industriales) and urbanized industrial land plots in Catalonia',
    target_titles: ['Land Acquisition Director', 'Land Acquisition Manager', 'Development Director', 'Country Head Spain', 'Head of Development Iberia'],
    queries: [
      'industrial logistics developer land acquisition Spain Iberia expansion 2025 2026',
      'logistics real estate developer new site big box Spain Barcelona Catalonia',
      'promotor logistico industrial adquisicion suelo naves Espana Cataluna'
    ]
  },
  'logistics-investors': {
    buyer_profile: 'Fund manager or institutional investor in logistics/industrial real estate with a European or Iberian mandate',
    asset_focus: 'income-producing and value-add industrial warehouses in Catalonia',
    target_titles: ['Head of Acquisitions', 'Investment Director', 'Investment Manager Iberia', 'Head of Transactions'],
    queries: [
      'logistics real estate fund manager acquisitions Iberia Spain portfolio',
      'industrial real estate investment manager Europe last mile Spain',
      'gestora fondo inversion logistica industrial Espana adquisiciones'
    ]
  },
  'land-developers': {
    buyer_profile: 'Residential or mixed-use developer, or construction group with an in-house development/promotion arm (promotora / constructora-promotora), actively buying finalist urbanized land — headquartered in Spain or a European developer active or expanding in Iberia. NOT pure contract-only builders.',
    asset_focus: 'urbanized land plots (solares, suelo finalista) in Catalonia for residential/mixed-use development',
    target_titles: ['Director de Suelo', 'Director de Promocion', 'Land Manager', 'Director de Expansion', 'Head of Land Acquisition', 'Development Director'],
    queries: [
      'promotora constructora compra suelo finalista solares residencial Espana Cataluna 2025',
      'residential developer housebuilder land acquisition Spain Iberia urban plots expansion',
      'director de suelo promotora constructora grupo inmobiliario expansion Espana'
    ]
  },
  'hotel-investors': {
    buyer_profile: 'Hotel investment platform, hospitality private-equity firm or hotel group expanding in Spain/Mediterranean',
    asset_focus: 'hotel assets and hotel-conversion opportunities in Catalonia',
    target_titles: ['Head of Expansion', 'Development Director', 'Investment Director Hospitality', 'Head of Acquisitions'],
    queries: [
      'hotel investment platform acquisitions Spain hospitality private equity 2025',
      'cadena hotelera expansion adquisicion hoteles Espana Cataluna',
      'hotel group development pipeline Spain Mediterranean acquisitions'
    ]
  },
  'family-offices-eu': {
    buyer_profile: 'European family office or patrimonial holding with direct real-estate allocation open to Iberia',
    asset_focus: 'long-hold mix: industrial warehouses, hotels and urbanized land in Catalonia',
    target_titles: ['Head of Real Estate', 'Investment Director', 'Head of Direct Investments'],
    queries: [
      'family office real estate direct investment Spain Iberia allocation',
      'single family office Europe hotel industrial property acquisitions Spain',
      'family office europeo inversion inmobiliaria directa Espana'
    ]
  },
  'socimi-funds-es': {
    buyer_profile: 'Spanish SOCIMI or investment manager (value-add / income) buying commercial assets',
    asset_focus: 'industrial warehouses and hotels in Catalonia',
    target_titles: ['Director de Inversiones', 'Head of Acquisitions', 'Director de Expansion'],
    queries: [
      'SOCIMI logistica industrial hotelera adquisicion activos Espana',
      'gestora inversion inmobiliaria Espana value-add naves hoteles',
      'SOCIMI expansion cartera compra activos 2025'
    ]
  },
  'industrial-land-investors': {
    buyer_profile: 'Institutional investor, land-banking platform or developer-investor that acquires industrial/logistics LAND (plots, development sites, brownfield) in Spain/Iberia to develop or hold',
    asset_focus: 'urbanized industrial land plots (solares industriales, suelo finalista logístico) in Catalonia',
    target_titles: ['Land Acquisition Director', 'Land Acquisition Manager', 'Head of Land', 'Investment Director', 'Development Director Iberia'],
    queries: [
      'industrial land investor land banking logistics development sites Spain Iberia acquisition',
      'inversor suelo industrial logistico compra solares Espana Cataluna 2025',
      'logistics land acquisition investment platform Spain Barcelona industrial plots brownfield'
    ]
  },
  'restaurant-hospitality-operators': {
    buyer_profile: 'Restaurant/F&B group, hospitality operator or franchise chain expanding its footprint in Catalonia/Spain — actively seeking new premises (locales comerciales, restaurantes en traspaso, ground-floor commercial units). Multi-brand groups, dark-kitchen operators, café/bakery chains, franchisors with a real-estate expansion team. Entity must be a real company (S.L./S.A./group), not an individual.',
    asset_focus: 'commercial premises and restaurant units (locales comerciales, restaurantes en traspaso) in Catalonia',
    target_titles: ['Director de Expansión', 'Responsable de Expansión', 'Real Estate Manager', 'Head of Expansion', 'Director de Desarrollo'],
    queries: [
      'grupo restauración expansión nuevos locales aperturas restaurantes Cataluña Barcelona 2025 2026',
      'restaurant group hospitality operator expansion new locations Spain real estate manager',
      'cadena franquicia restauración hostelería busca local traspaso expansión España'
    ]
  }
}

// Per-language writing rules injected into generation prompts.
const LANG_RULES = {
  english: {
    label: 'native business English',
    greeting_named: 'Hi {first_name},',
    greeting_generic: 'Hello,',
    close: 'Best regards,',
    cta: 'Would it make sense to share a teaser under NDA?',
    rules: 'Native business English. No literal translations from Spanish ("we count with", "in base to"). No exclamation marks.'
  },
  spanish: {
    label: 'castellano nativo',
    greeting_named: 'Hola {first_name},',
    greeting_generic: 'Hola,',
    close: 'Saludos cordiales,',
    cta: '¿Tiene sentido que le comparta un teaser bajo NDA?',
    rules: 'Tildes y eñes completas (inversión, adquisición, urbanístico, logística, también, más). Plurales -ciones/-siones sin tilde. Sin exclamaciones.'
  },
  catalan: {
    label: 'català natiu',
    greeting_named: 'Hola {first_name},',
    greeting_generic: 'Hola,',
    close: 'Salutacions,',
    cta: 'Té sentit que li comparteixi un teaser sota NDA?',
    rules: 'Zero castellanismes (també, però, gestió, inversió, sòl). Mai ¿ ni ¡ invertits. Sense exclamacions.'
  }
}

// ============ SCHEMAS ============

const TOKEN_SCHEMA = {
  type: 'object',
  properties: { token: { type: 'string', description: 'JWT auth token' } },
  required: ['token']
}

const SETUP_SCHEMA = {
  type: 'object',
  properties: {
    existing_domains: { type: 'array', items: { type: 'string' }, description: 'company_domain values of ALL tenant prospects (paginated)' },
    existing_emails: { type: 'array', items: { type: 'string' }, description: 'email addresses of ALL tenant prospects' },
    seen_domains: { type: 'array', items: { type: 'string' }, description: 'domains from seen-domains.json state file (empty if missing)' },
    last_segment: { type: ['string', 'null'], description: 'last_segment from search-state.json (null if missing)' },
    campaign_count: { type: 'number', description: 'prospects currently enrolled in the campaign' }
  },
  required: ['existing_domains', 'existing_emails', 'seen_domains', 'last_segment', 'campaign_count']
}

const CANDIDATES_SCHEMA = {
  type: 'object',
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          domain: { type: 'string', description: 'bare domain, no http/www' },
          city: { type: 'string' },
          country: { type: 'string' },
          entity_type: { type: 'string' },
          source_url: { type: 'string', description: 'page proving buyer activity / acquisitions mandate' }
        },
        required: ['name', 'domain', 'country']
      }
    }
  },
  required: ['companies']
}

const CONTACTS_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          contact_type: { type: 'string', enum: ['named', 'generic', 'none'] },
          first_name: { type: 'string', description: 'only for named' },
          last_name: { type: 'string', description: 'only for named' },
          title: { type: 'string', description: 'only for named — the acquisitions role found' },
          email: { type: 'string' },
          email_source: { type: 'string', description: 'URL or evidence where the email/pattern was verified' },
          mx_ok: { type: 'boolean' },
          language: { type: 'string', enum: ['english', 'spanish', 'catalan'] }
        },
        required: ['domain', 'contact_type', 'mx_ok', 'language']
      }
    }
  },
  required: ['results']
}

const ENRICHMENT_SCHEMA = {
  type: 'object',
  properties: {
    investment_thesis: { type: 'string', description: 'durable asset focus and strategy (no dated news)' },
    asset_focus_evidence: { type: 'string', description: 'evidence they buy the asset class we offer' },
    iberia_activity: { type: 'string', description: 'signs of Iberia/Spain/Catalonia appetite or presence' },
    buyer_signals: { type: 'string', description: 'capital availability, recent acquisitions as evidence (not to be quoted with dates)' }
  }
}

const EMAILS_SCHEMA = {
  type: 'object',
  properties: {
    emails: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          step_number: { type: 'number' },
          step_type: { type: 'string', enum: ['email', 'condition'] },
          subject: { type: 'string' },
          body_html: { type: 'string' },
          delay_days: { type: 'number' }
        }
      }
    }
  },
  required: ['emails']
}

const QA_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
    corrected_emails: { type: ['array', 'null'] }
  },
  required: ['pass', 'failures']
}

const LANG_EVAL_SCHEMA = {
  type: 'object',
  properties: {
    natural_score: { type: 'number', description: '0-10 naturalness, 7+ required' },
    register_score: { type: 'number', description: '0-10 peer-to-peer professional register, 6+ required' },
    issues: { type: 'array', items: { type: 'string' } },
    pass: { type: 'boolean' }
  },
  required: ['natural_score', 'register_score', 'issues', 'pass']
}

const IMPORT_SCHEMA = {
  type: 'object',
  properties: {
    companies_created: { type: 'number' },
    prospects_created: { type: 'number' },
    prospects_skipped: { type: 'number', description: '409 duplicates skipped' },
    enrolled: { type: 'number' },
    inserted: { type: 'number', description: 'data.inserted from bulk-insert-emails' },
    expected: { type: 'number', description: 'prospects_created * 3' },
    verified_in_api: { type: 'boolean' },
    missing_prospect_ids: { type: 'array', items: { type: 'string' } },
    error: { type: 'string' }
  },
  required: ['prospects_created', 'inserted', 'verified_in_api']
}

const PERSIST_SCHEMA = {
  type: 'object',
  properties: { persisted: { type: 'boolean' } },
  required: ['persisted']
}

// ============ HELPERS ============

const norm = d => String(d || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }
const isExcludedCountry = c => EXCLUDED_COUNTRIES.some(x => String(c || '').toLowerCase().includes(x.toLowerCase()))
const isMegaFund = name => MEGA_FUNDS.some(m => String(name || '').toLowerCase().includes(m.toLowerCase()))

// ============ SETUP ============

phase('Setup')

// args may arrive as a JSON string depending on how the workflow is invoked
const parsedArgs = typeof args === 'string' ? JSON.parse(args) : (args || {})
const { segment = null, count = 12 } = parsedArgs

const authAgent = await agent(
  `Login to the CamiaCasa tenant of the ABM platform using curl (add --ssl-no-revoke on Windows).

  1. If ${TOKEN_FILE} exists, read it and validate the token with: GET ${BASE_URL}/api/auth/me with header "Authorization: Bearer <token>". If it returns 200, reuse it.
  2. Otherwise login: curl --ssl-no-revoke -X POST ${BASE_URL}/api/auth/login -H "Content-Type: application/json" -d '{"email":"alfons.marques@camiacasa.cat","password":"<ask the user>"}' — use printf | curl -d @- if the password contains "!".
  3. Save the fresh token to ${TOKEN_FILE} (overwrite).

  Return: { token: "<jwt>" }`,
  { label: 'CamiaCasa Login', phase: 'Setup', schema: TOKEN_SCHEMA }
)

if (!authAgent || !authAgent.token) {
  log('Auth failed — user canceled or credential error')
  return { status: 'failed', reason: 'auth_failed' }
}

const setupAgent = await agent(
  `Read the JWT from ${TOKEN_FILE} and use it as "Authorization: Bearer <token>" for curl calls (add --ssl-no-revoke). The API scopes everything to the CamiaCasa tenant via the JWT.

  1. DEDUP DATA — fetch ALL tenant prospects with PAGINATION (the server caps limit at 100):
     GET ${BASE_URL}/api/prospects?limit=100&page=N for N=1,2,3... until the page returns fewer than 100 items.
     RESPONSE SHAPE: the rows are at response.data.prospects (an object { prospects, pagination } — NOT a flat array).
     Collect every distinct "company_domain" (lowercase, strip www) and every "email". The tenant has hundreds of prospects — if you end up with 0, your parsing is wrong; re-check the shape before returning.
  2. CAMPAIGN COUNT: GET ${BASE_URL}/api/campaigns/${CAMPAIGN_ID} — read prospect/enrollment count if present (0 if unavailable).
  3. STATE FILES (local, may not exist):
     - ${STATE_DIR}/seen-domains.json -> JSON array of domains (return [] if missing)
     - ${STATE_DIR}/search-state.json -> read "last_segment" (return null if missing)

  Return: { existing_domains: [...], existing_emails: [...], seen_domains: [...], last_segment: "..."|null, campaign_count: N }`,
  { label: 'Dedup + rotation state', phase: 'Setup', schema: SETUP_SCHEMA }
)

if (!setupAgent) {
  return { status: 'failed', reason: 'setup_failed' }
}

// Fail-safe: the CamiaCasa tenant always has prospects. An empty dedup list means the
// setup agent mis-parsed the API (rows live at data.prospects) — importing without it
// risks re-contacting existing prospects. Abort instead of running blind.
if ((setupAgent.existing_emails || []).length === 0) {
  log('Dedup guard: setup returned 0 existing emails — parsing failure, aborting to avoid duplicate outreach.')
  return { status: 'dedup_failed', reason: 'existing_emails empty; check GET /api/prospects parsing (data.prospects)' }
}

const excludedSet = new Set([
  ...EXCLUDED_DOMAINS,
  ...(setupAgent.existing_domains || []).map(norm),
  ...(setupAgent.seen_domains || []).map(norm)
].filter(Boolean))
const existingEmails = new Set((setupAgent.existing_emails || []).map(e => String(e).toLowerCase()))

// Segment: explicit --segment wins; otherwise round-robin after last_segment from state.
let selectedSegment = segment
if (!selectedSegment) {
  const lastIdx = SEGMENT_ORDER.indexOf(setupAgent.last_segment)
  selectedSegment = SEGMENT_ORDER[(lastIdx + 1) % SEGMENT_ORDER.length]
}
const segConfig = SEGMENT_CONFIG[selectedSegment]
if (!segConfig) {
  return { status: 'invalid_segment', available: SEGMENT_ORDER }
}

log(`Segment: ${selectedSegment} | target ${count} | dedup against ${excludedSet.size} domains`)

// ============ RESEARCH ============

phase('Research')

// Geo-sliced discovery: one agent per cluster so large counts get real depth instead of
// one agent scraping the same top search results. Small counts use fewer clusters.
const GEO_CLUSTERS = [
  { key: 'ES-PT', geo: 'Spain and Portugal' },
  { key: 'UK-IE', geo: 'United Kingdom and Ireland' },
  { key: 'FR-BENELUX', geo: 'France, Belgium, Netherlands, Luxembourg' },
  { key: 'NORDICS-CEE', geo: 'Sweden, Norway, Denmark, Finland, Poland, Czechia' },
  { key: 'IT-CH-OTHER', geo: 'Italy, Switzerland and other European countries (never Germany or Austria)' }
]
const clustersToUse = count <= 15 ? GEO_CLUSTERS.slice(0, 2) : GEO_CLUSTERS
const perCluster = Math.ceil((count * 2) / clustersToUse.length)

const discoverPrompt = c => `You are a real-estate capital-markets analyst building a buyer list. Find ~${perCluster} REAL institutional buyer LEGAL ENTITIES headquartered or with an acquisitions team in ${c.geo}, matching this profile:

  PROFILE: ${segConfig.buyer_profile}
  THEY SHOULD BUY: ${segConfig.asset_focus}

  WebSearch queries to adapt to ${c.geo} (plus reasonable variations):
  1. ${segConfig.queries[0]}
  2. ${segConfig.queries[1]}
  3. ${segConfig.queries[2]}

  STRICT RULES:
  - Only LEGAL ENTITIES (companies/funds), never natural persons or individual brokers, never listing portals.
  - NEVER Germany or Austria (UWG opt-in — hard exclusion).
  - Each must have its OWN corporate website (real domain).
  - AVOID mega-funds already covered: ${MEGA_FUNDS.join(', ')}.
  - HARD EXCLUSION (existing client / partners — never include): vgpparks.eu, despina-im.com.
  - Skip domains already known: ${JSON.stringify(Array.from(excludedSet).slice(0, 80))}${excludedSet.size > 80 ? ` ... (+${excludedSet.size - 80} more; a local filter re-checks all)` : ''}

  For each: name, domain (bare), city, country, entity_type, source_url (page proving buyer/acquisitions activity).

  Return: { companies: [...] }`

const discRes = await parallel(clustersToUse.map(c => () => agent(
  discoverPrompt(c),
  { label: `Discover ${selectedSegment}: ${c.key}`, phase: 'Research', schema: CANDIDATES_SCHEMA }
)))
const discovery = { companies: discRes.filter(Boolean).flatMap(r => r.companies || []) }

if (discovery.companies.length === 0) {
  return {
    status: 'exhausted',
    segment: selectedSegment,
    next_segment_to_try: SEGMENT_ORDER[(SEGMENT_ORDER.indexOf(selectedSegment) + 1) % SEGMENT_ORDER.length]
  }
}

const seenDisc = new Set()
const candidates = []
for (const c of discovery.companies) {
  const d = norm(c.domain)
  if (!d || excludedSet.has(d) || seenDisc.has(d)) continue
  if (isExcludedCountry(c.country) || isMegaFund(c.name)) continue
  seenDisc.add(d)
  candidates.push({ ...c, domain: d })
}
log(`Discover: ${discovery.companies.length} raw -> ${candidates.length} unique new candidates`)

if (candidates.length === 0) {
  return { status: 'all_duplicates', segment: selectedSegment }
}

// Hybrid contact hunt: named acquisitions contact first, generic fallback. Chunks of 4 in parallel.
const contactChunks = chunk(candidates, 4)
const contactRes = await parallel(contactChunks.map((ch, i) => () => agent(
  `For EACH company below, find the best outreach contact. Two-tier strategy:

  TIER 1 — NAMED CONTACT (preferred). Find a person holding an acquisitions role:
  ${segConfig.target_titles.join(', ')} (or close equivalent).
  How: WebSearch '"<company>" ("Head of Acquisitions" OR "Land Acquisition" OR "Investment Director" OR "Development Director") Spain OR Iberia'; scrape the company website team/about/people page (load firecrawl via ToolSearch "select:mcp__firecrawl__firecrawl_scrape" and try /team, /about, /people, /equipo, /contact); public LinkedIn results are acceptable to identify the PERSON and TITLE.
  Their EMAIL may only be used if (a) it is published somewhere citable, or (b) you can verify the company's email pattern from ANOTHER published named email on the same domain (e.g. finding jane.doe@x.com published proves first.last@x.com). If neither: do NOT invent an address — fall to Tier 2.

  TIER 2 — GENERIC fallback: scrape a role-based email from the site (info@, contact@, contacto@, acquisitions@, investments@, investor@, ir@, office@, hello@). REJECT free providers (gmail/hotmail/yahoo/outlook) and unverified personal addresses.

  ALWAYS: verify MX via Bash: dig MX <domain> +short (or nslookup -type=MX <domain>). mx_ok=true only if at least one MX record exists.

  LANGUAGE assignment per company: 'catalan' if based in Catalonia, Valencia or Balearic Islands; 'spanish' for the rest of Spain; 'english' for everywhere else in Europe.

  Return one result per company: { domain, contact_type: 'named'|'generic'|'none', first_name?, last_name?, title?, email?, email_source?, mx_ok, language }. Use contact_type 'none' when no usable email exists (still return the row).

  Companies: ${JSON.stringify(ch.map(c => ({ name: c.name, domain: c.domain, city: c.city, country: c.country, entity_type: c.entity_type, source_url: c.source_url })))}`,
  { label: `Contacts ${i + 1}/${contactChunks.length}`, phase: 'Research', schema: CONTACTS_SCHEMA }
)))

const contactByDomain = new Map()
for (const r of contactRes.filter(Boolean)) {
  for (const x of (r.results || [])) contactByDomain.set(norm(x.domain), x)
}

const targets = []
for (const c of candidates) {
  const ct = contactByDomain.get(c.domain)
  if (!ct || ct.contact_type === 'none' || !ct.email || !ct.mx_ok) continue
  const email = String(ct.email).toLowerCase()
  if (existingEmails.has(email)) continue
  targets.push({
    ...c,
    contact_type: ct.contact_type,
    first_name: ct.first_name || '',
    last_name: ct.last_name || '',
    title: ct.title || '',
    email,
    email_source: ct.email_source || c.source_url || '',
    language: LANG_RULES[ct.language] ? ct.language : 'english'
  })
  if (targets.length >= count) break
}

if (targets.length === 0) {
  return { status: 'no_contacts_found', segment: selectedSegment, candidates_tried: candidates.length }
}

const namedCount = targets.filter(t => t.contact_type === 'named').length
log(`Contacts: ${targets.length} targets (${namedCount} named, ${targets.length - namedCount} generic). Starting enrichment + generation...`)

// ============ GENERATE ============

phase('Generate')

// Stage 1: Enrichment — durable investment thesis only.
// Retry up to 3x: a transient server-side rate limit (429, not the usage cap) must not
// permanently drop a company — later attempts land once the burst clears.
const enrichStage = async (company) => {
    let enrichment = null
    for (let ea = 0; ea < 3 && !enrichment; ea++) {
      enrichment = await agent(
        `Research the investment profile of: ${company.name} (${company.city || ''}, ${company.country}) — ${company.entity_type || segConfig.buyer_profile}

        WebSearch query 1: "${company.name} acquisitions real estate Spain Iberia strategy"
        WebSearch query 2: "${company.name} ${company.country} portfolio investment assets"

        Extract ONLY verified facts (anti-invention: if research is thin, keep fields generic at sector level — never fabricate deals or numbers):
        1. investment_thesis — their DURABLE asset focus and strategy (no dated news; these emails may send weeks later)
        2. asset_focus_evidence — evidence they buy: ${segConfig.asset_focus}
        3. iberia_activity — signs of Spain/Iberia/Catalonia presence or appetite
        4. buyer_signals — capital availability, acquisition track record (as evidence, not to be quoted with dates)

        Return: { investment_thesis, asset_focus_evidence, iberia_activity, buyer_signals }`,
        { label: `Enrich: ${company.name}${ea ? ` (retry ${ea})` : ''}`, phase: 'Generate', schema: ENRICHMENT_SCHEMA }
      )
    }
    // Skip the company rather than generating without facts; no_fabrication QA would reject it anyway.
    if (!enrichment) {
      log(`Enrich failed 3x for ${company.name} — skipping company`)
      return null
    }
    return { company, enrichment }
  }

// Stage 2: Generate + QA + native-language eval (retry 3x)
const generateStage = async (enrichData) => {
    if (!enrichData) return null
    const { company, enrichment } = enrichData
    const L = LANG_RULES[company.language]
    const greeting = company.contact_type === 'named'
      ? L.greeting_named.replace('{first_name}', company.first_name)
      : L.greeting_generic

    for (let attempt = 0; attempt < 3; attempt++) {
      const emailGen = await agent(
        `Write a 3-step cold outreach sequence in ${L.label} for an institutional real-estate BUYER.

        SENDER: CamiaCasa — Catalan real-estate firm that ORIGINATES off-market opportunities in Catalonia and holds DIRECT MANDATES from owners. Web: camiacasa.cat.
        TARGET: ${company.name} (${company.city || ''}, ${company.country}) — ${company.entity_type || segConfig.buyer_profile}
        RECIPIENT: ${company.contact_type === 'named' ? `${company.first_name} ${company.last_name}, ${company.title}` : 'generic mailbox (no person known)'}
        BUYER PROFILE: ${segConfig.buyer_profile}
        THEY BUY: ${segConfig.asset_focus}

        ENRICHMENT (the ONLY facts you may reference about the target — never invent others):
        ${JSON.stringify(enrichment, null, 2)}

        WHAT CAMIACASA OFFERS (the value proposition — all true, use naturally, not as a list):
        - Off-market opportunities in Catalonia: industrial warehouses (naves), urbanized land plots (solares/suelo finalista) and hotels, under direct owner mandate.
        - NDA-first process: a teaser first; after NDA, the full pack a buyer needs for an initial financial evaluation — exact location, site layout, surface/buildable area, urban-planning certificate (certificado urbanístico), tenancy situation where applicable.
        - Discreet, peer-to-peer: no listings, no portals.

        MANDATORY RULES:
        1. GREETING: exactly "${greeting}" — never any other name, never a template variable.
        2. Language quality: ${L.rules}
        3. Lead with THEIR acquisition need (from enrichment), not with the agency. No marketing hype, no exclamation marks, no fabricated numbers about them or about the assets.
        4. Do NOT name or describe any specific asset/address (blind until NDA). Region-level only: "Catalonia", "Barcelona area".
        5. NEVER mention VGP, vgpparks, Despina, other clients, campaign names, "Unknown", or placeholders like [Name]/{{name}}.
        6. CTA style (soft, yes/no): step 1 or 2 must include the NDA-first CTA, e.g. "${L.cta}". Never "15-minute call?".
        7. SIGNATURE (copy literally, each email): closing line "${L.close}" then:
        Alfons Marques
        CamiaCasa
        camiacasa.cat
        8. body_html: simple <p> paragraphs only. No images, no links except camiacasa.cat in the signature.

        STRUCTURE:
        - Step 1 (delay_days 0): 50-80 words. Hook on their acquisition focus -> CamiaCasa as off-market originator with direct mandates -> NDA-first soft CTA.
        - Step 2 (delay_days 3): 50-70 words. DIFFERENT angle: what they receive to evaluate (location, layout, buildable area, urban certificate) with zero commitment. Soft CTA.
        - Step 3 (delay_days 7): 40-60 words. Brief, graceful re-open and soft close ("if the timing is not right, no problem").
        - Subjects: 21-40 chars (step 3 up to 30), different angle per step, never fake "Re:".

        Output: { emails: [ { step_number, step_type: "email", subject, body_html, delay_days } ] }`,
        { label: `Generate: ${company.name}`, phase: 'Generate', schema: EMAILS_SCHEMA }
      )

      if (!emailGen || !emailGen.emails || emailGen.emails.length < 3) {
        if (attempt < 2) { log(`Generate failed for ${company.name}, retrying... (${attempt + 1}/3)`); continue }
        return null
      }

      // Deterministic pre-checks: placeholders + excluded mentions
      const allText = emailGen.emails.map(e => `${e.subject || ''} ${e.body_html || ''}`).join(' ')
      if (/\[\w+\]|\{\{\w+\}\}|Unknown/i.test(allText) || /vgp|despina/i.test(allText)) {
        if (attempt < 2) { log(`Placeholder/excluded-mention found for ${company.name}, retrying... (${attempt + 1}/3)`); continue }
        return null
      }

      const qa = await agent(
        `QA check on a 3-step buyer-outreach sequence for: ${company.name} (language: ${company.language}, contact_type: ${company.contact_type})

        Emails: ${JSON.stringify(emailGen.emails)}
        Enrichment facts available: ${JSON.stringify(enrichment)}

        FAIL dimensions (ANY fail = reject):
        1. no_placeholders: NO "Unknown", NO [Name]/{{name}}, NO batch/campaign names.
        2. signature: each email ends with exactly "Alfons Marques" then "CamiaCasa" then "camiacasa.cat" (NO "Marquès" accent, NO "Tecnocim").
        3. word_count: Step 1 ≤80, Step 2 ≤70, Step 3 ≤60 words (body, excluding signature).
        4. no_excluded: ZERO mentions of VGP/vgpparks/Despina or any client name.
        5. no_fabrication: every claim about the TARGET comes from the enrichment facts; no invented deals, funds or numbers. Claims about CamiaCasa limited to: off-market originator, direct mandates, Catalonia inventory (naves/solares/hoteles), NDA-first teaser + post-NDA pack (location, layout, surface/buildable area, urban-planning certificate, tenancy situation where applicable).
        6. soft_cta_nda: step 1 or 2 contains a soft NDA-first CTA (yes/no question); no hard "call me" CTAs anywhere.
        7. greeting_rule: greeting is exactly "${greeting}" in all 3 emails.

        Return: { pass: bool, failures: [...], corrected_emails: [...] or null }`,
        { label: `QA: ${company.name}`, phase: 'Generate', schema: QA_SCHEMA }
      )

      // If QA failed but returned a fixed version (>=3 emails), adopt the fix instead of burning a retry —
      // the QA agent is the verifier and only emits corrected_emails when the rest of the dimensions pass.
      let acceptedEmails = null
      if (qa && qa.pass) {
        acceptedEmails = emailGen.emails
      } else if (qa && Array.isArray(qa.corrected_emails) && qa.corrected_emails.length >= 3) {
        log(`QA auto-fix adopted for ${company.name}: ${(qa.failures || []).join(', ')}`)
        // Merge fixes over the originals so delay_days/step_type survive even if QA omits them
        acceptedEmails = emailGen.emails.map((orig, i) => {
          const fix = qa.corrected_emails.find(ce => ce.step_number === orig.step_number) || qa.corrected_emails[i]
          return fix ? { ...orig, ...fix } : orig
        })
      }

      if (!acceptedEmails) {
        if (attempt < 2) { log(`QA failed for ${company.name}: ${(qa?.failures || ['no result']).join(', ')}, retrying... (${attempt + 1}/3)`); continue }
        log(`QA failed 3x for ${company.name} — skipping`)
        return null
      }

      // Post-process residual brand/accent slips
      const corrected = acceptedEmails.map(e => ({
        ...e,
        body_html: (e.body_html || '').replace(/Marquès/g, 'Marques').replace(/Tecnocim([^a-zA-Z]|$)/g, 'CamiaCasa$1'),
        subject: (e.subject || '').replace(/Marquès/g, 'Marques').replace(/Tecnocim([^a-zA-Z]|$)/g, 'CamiaCasa$1')
      }))

      const evalPrompts = {
        english: `You are a native British/international business-English editor reviewing cold emails to institutional real-estate investors. Evaluate whether these read like a fluent professional wrote them: no Spanish calques ("we count with", "in base to", "realize a visit"), natural idiom, concise sentences, discreet peer-to-peer register (not salesy, not stiff).`,
        spanish: `Eres un revisor nativo de castellano profesional. Evalúa si estos emails suenan naturales para un directivo español: tildes correctas (inversión, adquisición, urbanístico), frases cortas, registro par-a-par discreto (ni comercial agresivo ni notarial).`,
        catalan: `Ets un revisor lingüístic de català expert. Avalua si aquests emails sonen NATURALS per a un directiu catalanoparlant: zero castellanismes, mai ¿ ni ¡, frases curtes, registre professional proper (ni comercial ni notarial).`
      }

      const langEval = await agent(
        `${evalPrompts[company.language]}

        Emails: ${JSON.stringify(corrected)}

        Pass criteria:
        - natural_score >= 7 (0-10)
        - register_score >= 6 (peer-to-peer professional, discreet)
        - No mixed-language words, no bureaucratic or salesy openings.

        Return: { natural_score: N, register_score: N, issues: [...], pass: bool }`,
        { label: `Lang eval (${company.language}): ${company.name}`, phase: 'Generate', schema: LANG_EVAL_SCHEMA }
      )

      if (langEval && langEval.pass) {
        return { company, emails: corrected }
      }
      if (attempt < 2) {
        log(`Lang eval failed for ${company.name}: ${(langEval?.issues || ['no result']).join(', ')}, retrying... (${attempt + 1}/3)`)
        continue
      }
      log(`Lang eval failed 3x for ${company.name} — skipping`)
      return null
    }
    return null
  }

// Throttle to sequential waves of 4: enrich fires WebSearch per company; ~16 concurrent
// trips the transient API rate limit (429 burst, "not your usage limit"). Waves keep it low.
const emailResults = []
for (const wave of chunk(targets, 4)) {
  emailResults.push(...await pipeline(wave, enrichStage, generateStage))
}

const validResults = emailResults.filter(Boolean)
const qaPassRate = emailResults.length > 0
  ? ((validResults.length / emailResults.length) * 100).toFixed(0) + '%'
  : '0%'

if (validResults.length === 0) {
  log('All emails failed QA. Aborting import.')
  return { status: 'qa_failed', total_attempted: emailResults.length }
}

if (validResults.length / emailResults.length < 0.7) {
  log(`Circuit breaker: only ${qaPassRate} pass rate. Aborting import.`)
  return { status: 'circuit_breaker', qa_pass_rate: qaPassRate, total_attempted: emailResults.length }
}

log(`${validResults.length}/${emailResults.length} passed QA (${qaPassRate})`)

// ============ IMPORT ============

phase('Import')

const importPayload = validResults.map(r => ({
  company: {
    name: r.company.name,
    domain: r.company.domain,
    city: r.company.city || '',
    country: r.company.country,
    website_url: `https://${r.company.domain}`,
    description: r.company.entity_type || segConfig.buyer_profile,
    is_target: true
  },
  prospect: r.company.contact_type === 'named'
    ? {
        first_name: r.company.first_name,
        last_name: r.company.last_name,
        email: r.company.email,
        title: r.company.title,
        city: r.company.city || '',
        country: r.company.country,
        source: 'camiacasa-eu-prospect',
        source_detail: `${selectedSegment}|named|${r.company.email_source}`.slice(0, 250)
      }
    : {
        first_name: r.company.name,
        last_name: `(${r.company.entity_type || 'entity'})`.slice(0, 90),
        email: r.company.email,
        title: 'Acquisitions',
        city: r.company.city || '',
        country: r.company.country,
        source: 'camiacasa-eu-prospect',
        source_detail: `${selectedSegment}|generic|${r.company.email_source}`.slice(0, 250)
      },
  emails: r.emails.map(e => ({
    step_number: e.step_number,
    subject: e.subject,
    body_html: e.body_html,
    delay_days: e.delay_days
  }))
}))

const importResult = await agent(
  `Import ${importPayload.length} prospects (+${importPayload.length * 3} emails) into campaign ${CAMPAIGN_ID} as DRAFT. Read the JWT from ${TOKEN_FILE} and use "Authorization: Bearer <token>" (curl --ssl-no-revoke); the API scopes all writes to the CamiaCasa tenant via the JWT. For any POST with a JSON body, write the body to a temp file and use curl --data-binary @file with -H "Content-Type: application/json" (UTF-8 safety).

  COMPLETE DATA (full structure, no truncation):
  ${JSON.stringify(importPayload, null, 2)}

  STEPS — follow the ORDER exactly:

  1. For EACH item, create the company: POST ${BASE_URL}/api/companies with the "company" object.
     - On 201: take company_id = response.data.id
     - On 409 (domain exists): GET ${BASE_URL}/api/companies?search=<domain> and take the matching company's id.

  2. Create the prospect: POST ${BASE_URL}/api/prospects with the "prospect" object PLUS "company_id" from step 1.
     - On 201: record prospect_id = response.data.id
     - On 409 (email exists): SKIP this prospect entirely (already contacted) and log it. Do NOT reuse the old id.

  3. Build prospect_ids ONLY from 201 responses of step 2. Count = prospects_created.

  4. Enroll them in the campaign: POST ${BASE_URL}/api/campaigns/${CAMPAIGN_ID}/prospects with { "prospect_ids": [...] }.

  5. Bulk insert emails: POST ${BASE_URL}/api/campaigns/${CAMPAIGN_ID}/bulk-insert-emails with
     { "emails": [ { "prospect_id": "<id from step 2>", "step_number": N, "subject": "...", "body_html": "...", "delay_days": N }, ... ] }
     — one entry per email of each successfully created prospect (3 per prospect).
     CRITICAL: the endpoint SILENTLY SKIPS emails whose prospect_id does not exist; the response field is data.inserted (NOT data.total_inserted). Compare data.inserted against prospects_created*3 and report any shortfall with the affected prospect_ids.

  6. Verify: GET ${BASE_URL}/api/campaigns/${CAMPAIGN_ID}/generated-emails?status=draft — the response is { emails, byProspect, stats }: count NEW drafts in d.data.emails (NOT d.data.length) and cross-check d.data.stats.

  Return: { companies_created, prospects_created, prospects_skipped, enrolled, inserted, expected, verified_in_api, missing_prospect_ids, error? }`,
  { label: 'Import: companies -> prospects -> enroll -> emails', phase: 'Import', schema: IMPORT_SCHEMA }
)

if (!importResult || importResult.inserted === 0) {
  return {
    status: 'import_failed',
    error: importResult?.error || 'unknown',
    attempted: validResults.length
  }
}

if (importResult.expected && importResult.inserted < importResult.expected) {
  log(`WARNING: inserted ${importResult.inserted}/${importResult.expected} emails — missing prospect_ids: ${JSON.stringify(importResult.missing_prospect_ids || [])}`)
}

// Persist rotation + seen-domains state for the next run
const importedDomains = validResults.map(r => r.company.domain)
await agent(
  `Persist workflow state files (create ${STATE_DIR} if missing):

  1. ${STATE_DIR}/seen-domains.json — read existing JSON array (or start []), merge these domains, dedupe, write back:
     ${JSON.stringify(importedDomains)}

  2. ${STATE_DIR}/search-state.json — read existing (or start fresh) and update:
     - last_segment: "${selectedSegment}"
     - append to sessions[]: { segment: "${selectedSegment}", named: ${validResults.filter(r => r.company.contact_type === 'named').length}, generic: ${validResults.filter(r => r.company.contact_type === 'generic').length}, emails_imported: ${importResult.inserted} } plus the current date from Bash (date +%Y-%m-%d)
     - per_segment_counts: increment "${selectedSegment}" by ${validResults.length}

  Return: { persisted: true }`,
  { label: 'Persist rotation state', phase: 'Import', schema: PERSIST_SCHEMA }
)

log(`Imported ${importResult.inserted} draft emails for ${importResult.prospects_created} prospects`)

// ============ SUMMARY ============

return {
  status: 'success',
  segment: selectedSegment,
  next_segment: SEGMENT_ORDER[(SEGMENT_ORDER.indexOf(selectedSegment) + 1) % SEGMENT_ORDER.length],
  targets_found: targets.length,
  named_count: validResults.filter(r => r.company.contact_type === 'named').length,
  generic_count: validResults.filter(r => r.company.contact_type === 'generic').length,
  sequences_generated: validResults.length,
  emails_imported: importResult.inserted,
  prospects_skipped_409: importResult.prospects_skipped || 0,
  qa_pass_rate: qaPassRate,
  campaign_status: 'draft',
  campaign_url: `${BASE_URL}/campaigns/${CAMPAIGN_ID}`,
  next_action: 'Review + approve emails in campaign UI; scheduler distributes Mon-Fri respecting 20/day warmup'
}
