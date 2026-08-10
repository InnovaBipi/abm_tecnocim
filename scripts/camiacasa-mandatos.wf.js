// TENANT ISOLATION: this workflow contains NO SQL. All data access goes through the ABM REST API
// with a CamiaCasa JWT (Authorization: Bearer); tenant_id scoping is enforced server-side by
// middleware/auth.ts + tenant.ts on every endpoint. The JWT carries tenantId — no cross-tenant access.
//
// SELL-SIDE mirror of camiacasa-eu-prospect.wf.js. Here CamiaCasa offers to COMMERCIALIZE the
// counterparty's OWN assets (naves/solares/hoteles/locales) to its network of qualified buyers,
// in exchange for commission. Dedup merges the buy-side seen-domains so the same inbox is never
// hit from both sides.

export const meta = {
  name: 'camiacasa-mandatos',
  description: 'Sell-side prospecting for CamiaCasa: offer to commercialize the assets of funds/servicers/developers/hotel & restaurant owners to a qualified-buyer network, for commission. 3-step multi-language emails, DRAFT import to campaign 527ae0d1. Cross-dedup with the buy-side campaign. On-demand, no auto-approval.',
  phases: [
    { title: 'Setup', detail: 'Auth CamiaCasa, dedup tenant-wide + merge buy-side seen-domains, read rotation state, select segment' },
    { title: 'Research', detail: 'Discover asset-holders, hunt named asset-management/expansion contacts (fallback generic), MX verify' },
    { title: 'Generate', detail: 'Enrich reason-to-commercialize + 3-step emails per language + QA (7 dims) + native eval, 3-retry' },
    { title: 'Import', detail: 'MCP tools: company_create -> prospect_create -> enroll -> emails_bulk_insert (fail-fast server-side) -> persist state' }
  ]
}

// ============ CONSTANTS ============

const CAMPAIGN_ID = '527ae0d1-431f-4eb4-8b1d-c1f84aeb3d95' // "Comercialización de inmuebles — Mandatos de venta" — NEVER create a campaign
const BASE_URL = 'https://abm.tecnociminnova.com'
const TOKEN_FILE = 'C:/Users/user/tmp_auth_cc.txt'
const STATE_DIR = 'C:/Users/user/proyectos/abm_tecnocim/scripts/output/camiacasa-mandatos'
// Buy-side state — merged into the exclude set so a domain contacted as a BUYER is never re-hit as a SELLER.
const BUYSIDE_SEEN = 'C:/Users/user/proyectos/abm_tecnocim/scripts/output/camiacasa-eu-prospect/seen-domains.json'

// vgpparks.eu = existing CLIENT; despina-im.com = intermediary. Never contact or mention.
const EXCLUDED_DOMAINS = ['vgpparks.eu', 'despina-im.com']
// DE/AT: UWG opt-in regime — no cold email, handled via LinkedIn only.
const EXCLUDED_COUNTRIES = ['Germany', 'Austria', 'Alemania', 'Deutschland', 'Österreich']

const SEGMENT_ORDER = ['divesting-funds', 'developer-stock', 'servicers-npl', 'hotel-owners', 'restaurant-portfolios', 'patrimonial-holders']

const SEGMENT_CONFIG = {
  'divesting-funds': {
    holder_profile: 'Real-estate fund, SOCIMI or gestora in a divestment / portfolio-rotation phase, holding assets in Spain it may want to sell or accelerate the sale of',
    asset_focus: 'offices, retail, industrial or land assets in Catalonia/Spain they hold and could rotate out',
    target_titles: ['Head of Asset Management', 'Director de Inversiones', 'Portfolio Manager', 'Director de Desinversiones', 'Head of Transactions'],
    queries: [
      'SOCIMI fondo inmobiliario desinversión rotación cartera venta activos España 2025 2026',
      'real estate fund portfolio disposal asset rotation Spain Iberia divestment',
      'gestora inmobiliaria venta activos cartera oficinas retail industrial España'
    ]
  },
  'developer-stock': {
    holder_profile: 'Promotora / constructora-promotora with finished or half-sold stock (obra nueva) or unsold plots it needs to place — headquartered in Spain or a European developer with Iberian projects',
    asset_focus: 'new-build units, commercial ground-floor premises and unsold urbanized plots in Catalonia/Spain',
    target_titles: ['Director Comercial', 'Director de Ventas', 'Director de Suelo', 'Sales Director', 'Director de Expansión'],
    queries: [
      'promotora constructora stock obra nueva viviendas locales venta Cataluña España 2025',
      'residential developer unsold units commercial premises sales Spain Barcelona',
      'promotora solares suelo sin edificar venta cartera España'
    ]
  },
  'servicers-npl': {
    holder_profile: 'Servicer / asset manager holding REO or NPL real-estate books in Spain (Solvia, doValue/Altamira, Hipoges, Diglo, Aliseda/Anticipa, Servihabitat profile — discover via generic queries, do not limit to these names)',
    asset_focus: 'REO/NPL residential, commercial and land assets in Catalonia/Spain in their disposal pipeline',
    target_titles: ['Head of Sales', 'Real Estate Sales Director', 'Channel Manager', 'Director de Canal', 'Director Comercial REO'],
    queries: [
      'servicer inmobiliario venta activos REO adjudicados canal prescriptores España 2025',
      'real estate servicer asset manager REO NPL disposal Spain broker channel',
      'gestor activos inmobiliarios venta cartera adjudicados colaboradores España'
    ]
  },
  'hotel-owners': {
    holder_profile: 'Hotel group, hotel owner or hospitality investor rotating or selling hotel assets in Spain',
    asset_focus: 'hotels and hotel-conversion buildings in Catalonia/Spain they own and could sell',
    target_titles: ['Asset Manager', 'Director de Expansión', 'Head of Real Estate', 'Director de Inversiones Hotelera'],
    queries: [
      'grupo hotelero venta activos rotación cartera hoteles España 2025',
      'hotel owner asset disposal sale Spain hospitality real estate rotation',
      'cadena hotelera venta hoteles desinversión activos España Cataluña'
    ]
  },
  'restaurant-portfolios': {
    holder_profile: 'Restaurant / retail group closing, relocating or subletting premises, or a franchisor with premises to place',
    asset_focus: 'commercial premises and restaurant units (locales comerciales, restaurantes en traspaso) in Catalonia/Spain',
    target_titles: ['Real Estate Manager', 'Director de Expansión', 'Director de Operaciones', 'Facilities Director'],
    queries: [
      'grupo restauración retail cierre traspaso locales reubicación España Cataluña 2025',
      'restaurant retail group premises sublease relocation closure Spain',
      'cadena restauración franquicia locales traspaso venta España Barcelona'
    ]
  },
  'patrimonial-holders': {
    holder_profile: 'Patrimonial company or family office holding idle or underused real estate in Spain it could monetize',
    asset_focus: 'idle buildings, land and mixed assets in Catalonia/Spain',
    target_titles: ['Head of Real Estate', 'Gerente', 'Director General', 'Director de Patrimonio'],
    queries: [
      'sociedad patrimonial family office venta activos inmobiliarios patrimonio España 2025',
      'patrimonial company family office idle real estate monetization Spain',
      'grupo patrimonial venta edificios suelo activos inmobiliarios España Cataluña'
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
    cta: 'Would it make sense to look at a couple of your Catalonia assets and bring you concrete demand?',
    rules: 'Native business English. No literal translations from Spanish ("we count with", "in base to"). No exclamation marks.'
  },
  spanish: {
    label: 'castellano nativo',
    greeting_named: 'Hola {first_name},',
    greeting_generic: 'Hola,',
    close: 'Saludos cordiales,',
    cta: '¿Tiene sentido que valoremos un par de sus activos en Cataluña y le llevemos demanda concreta?',
    rules: 'Tildes y eñes completas (comercialización, inversión, adquisición, cartera, también, más). Plurales -ciones/-siones sin tilde. Sin exclamaciones.'
  },
  catalan: {
    label: 'català natiu',
    greeting_named: 'Hola {first_name},',
    greeting_generic: 'Hola,',
    close: 'Salutacions,',
    cta: 'Té sentit que valorem un parell dels seus actius a Catalunya i li portem demanda concreta?',
    rules: 'Zero castellanismes (també, però, gestió, comercialització, cartera, sòl). Mai ¿ ni ¡ invertits. Sense exclamacions.'
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
    seen_domains: { type: 'array', items: { type: 'string' }, description: 'domains from BOTH mandatos seen-domains.json AND the buy-side seen-domains.json (merged, [] if missing)' },
    last_segment: { type: ['string', 'null'], description: 'last_segment from the mandatos search-state.json (null if missing)' },
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
          source_url: { type: 'string', description: 'page proving they HOLD sellable assets in Spain' }
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
          title: { type: 'string', description: 'only for named — the asset-management/sales/expansion role found' },
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
    asset_holdings: { type: 'string', description: 'what sellable/lettable assets they hold in Spain (durable, no dated news)' },
    disposal_signals: { type: 'string', description: 'evidence they rotate/sell/place assets (as evidence, not to be quoted with dates)' },
    catalonia_presence: { type: 'string', description: 'signs of Catalonia/Spain asset presence' },
    reason_to_commercialize: { type: 'string', description: 'why a qualified-buyer channel would help them (durable)' }
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
  3. STATE FILES (local, may not exist) — MERGE both domain lists into seen_domains:
     - ${STATE_DIR}/seen-domains.json -> JSON array of domains (this campaign's own state; [] if missing)
     - ${BUYSIDE_SEEN} -> JSON array of domains contacted by the BUY-SIDE campaign (merge these too — same inbox must not be hit from both sides; [] if missing)
     - ${STATE_DIR}/search-state.json -> read "last_segment" (return null if missing)

  Return: { existing_domains: [...], existing_emails: [...], seen_domains: [...merged...], last_segment: "..."|null, campaign_count: N }`,
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

log(`Segment: ${selectedSegment} | target ${count} | dedup against ${excludedSet.size} domains (incl. buy-side)`)

// ============ RESEARCH ============

phase('Research')

// Geo-sliced discovery: one agent per cluster so large counts get real depth instead of
// one agent scraping the same top search results. Small counts use fewer clusters.
// Sell-side skews to Spain (that's where the assets are), but pan-EU holders of Spanish assets count too.
const GEO_CLUSTERS = [
  { key: 'ES-CAT', geo: 'Catalonia and eastern Spain (Barcelona, Girona, Tarragona, Valencia)' },
  { key: 'ES-REST', geo: 'the rest of Spain (Madrid, Andalusia, Basque Country, etc.)' },
  { key: 'UK-IE', geo: 'United Kingdom and Ireland (holders of Spanish assets)' },
  { key: 'FR-BENELUX', geo: 'France, Belgium, Netherlands, Luxembourg (holders of Spanish assets)' },
  { key: 'NORDICS-IT-CH', geo: 'Nordics, Italy and Switzerland (holders of Spanish assets, never Germany or Austria)' }
]
const clustersToUse = count <= 15 ? GEO_CLUSTERS.slice(0, 2) : GEO_CLUSTERS
const perCluster = Math.ceil((count * 2) / clustersToUse.length)

const discoverPrompt = c => `You are a real-estate capital-markets analyst building a list of ASSET HOLDERS who might want a commercialization channel. Find ~${perCluster} REAL LEGAL ENTITIES based in or active in ${c.geo}, matching this profile:

  PROFILE: ${segConfig.holder_profile}
  THEY HOLD (assets we could help sell/place): ${segConfig.asset_focus}

  WebSearch queries to adapt to ${c.geo} (plus reasonable variations):
  1. ${segConfig.queries[0]}
  2. ${segConfig.queries[1]}
  3. ${segConfig.queries[2]}

  STRICT RULES:
  - Only LEGAL ENTITIES (companies/funds/groups), never natural persons or individual brokers, never listing portals.
  - NEVER Germany or Austria (UWG opt-in — hard exclusion).
  - Each must have its OWN corporate website (real domain) and evidence it HOLDS sellable/lettable assets in Spain.
  - HARD EXCLUSION (existing client / partners — never include): vgpparks.eu, despina-im.com.
  - Skip domains already known: ${JSON.stringify(Array.from(excludedSet).slice(0, 80))}${excludedSet.size > 80 ? ` ... (+${excludedSet.size - 80} more; a local filter re-checks all)` : ''}

  For each: name, domain (bare), city, country, entity_type, source_url (page proving they hold assets / disposal activity).

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
  if (isExcludedCountry(c.country)) continue
  seenDisc.add(d)
  candidates.push({ ...c, domain: d })
}
log(`Discover: ${discovery.companies.length} raw -> ${candidates.length} unique new candidates`)

if (candidates.length === 0) {
  return { status: 'all_duplicates', segment: selectedSegment }
}

// Hybrid contact hunt: named asset-management/sales/expansion contact first, generic fallback. Chunks of 4.
const contactChunks = chunk(candidates, 4)
const contactRes = []
// Throttle contact-hunt to waves of 4 chunks (<=4 concurrent agents). At count 50 this phase
// would otherwise fire ~13 concurrent agents and trip the transient API rate limit.
for (const cwave of chunk(contactChunks, 4)) {
  contactRes.push(...await parallel(cwave.map((ch) => () => agent(
  `For EACH company below, find the best outreach contact. Two-tier strategy:

  TIER 1 — NAMED CONTACT (preferred). Find a person holding a role that decides on selling/placing real estate:
  ${segConfig.target_titles.join(', ')} (or close equivalent).
  How: WebSearch '"<company>" ("Asset Management" OR "Director Comercial" OR "Director de Ventas" OR "Director de Expansión") Spain OR España'; scrape the company website team/about/people page (load firecrawl via ToolSearch "select:mcp__firecrawl__firecrawl_scrape" and try /team, /about, /people, /equipo, /contact); public LinkedIn results are acceptable to identify the PERSON and TITLE.
  Their EMAIL may only be used if (a) it is published somewhere citable, or (b) you can verify the company's email pattern from ANOTHER published named email on the same domain. If neither: do NOT invent an address — fall to Tier 2.

  TIER 2 — GENERIC fallback: scrape a role-based email from the site (info@, contacto@, comercial@, expansion@, activos@, ventas@, office@, hello@). REJECT free providers (gmail/hotmail/yahoo/outlook) and unverified personal addresses.

  ALWAYS: verify MX via Bash: dig MX <domain> +short (or nslookup -type=MX <domain>). mx_ok=true only if at least one MX record exists.

  LANGUAGE assignment per company: 'catalan' if based in Catalonia, Valencia or Balearic Islands; 'spanish' for the rest of Spain; 'english' for everywhere else in Europe.

  Return one result per company: { domain, contact_type: 'named'|'generic'|'none', first_name?, last_name?, title?, email?, email_source?, mx_ok, language }. Use contact_type 'none' when no usable email exists (still return the row).

  Companies: ${JSON.stringify(ch.map(c => ({ name: c.name, domain: c.domain, city: c.city, country: c.country, entity_type: c.entity_type, source_url: c.source_url })))}`,
  { label: `Contacts (${ch.length})`, phase: 'Research', schema: CONTACTS_SCHEMA }
  ))))
}

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

// Stage 1: Enrichment — durable holdings + reason-to-commercialize only.
const enrichStage = async (company) => {
    let enrichment = null
    for (let ea = 0; ea < 3 && !enrichment; ea++) {
      enrichment = await agent(
        `Research the real-estate holdings of: ${company.name} (${company.city || ''}, ${company.country}) — ${company.entity_type || segConfig.holder_profile}

        WebSearch query 1: "${company.name} activos inmobiliarios cartera venta España"
        WebSearch query 2: "${company.name} ${company.country} real estate portfolio disposal Spain"

        Extract ONLY verified facts (anti-invention: if research is thin, keep fields generic at sector level — never fabricate deals or numbers):
        1. asset_holdings — the DURABLE sellable/lettable assets they hold in Spain (no dated news; these emails may send weeks later)
        2. disposal_signals — evidence they rotate/sell/place assets (as evidence, not to be quoted with dates)
        3. catalonia_presence — signs of Catalonia/Spain asset presence
        4. reason_to_commercialize — why a qualified-buyer channel would help them move assets (durable)

        Return: { asset_holdings, disposal_signals, catalonia_presence, reason_to_commercialize }`,
        { label: `Enrich: ${company.name}${ea ? ` (retry ${ea})` : ''}`, phase: 'Generate', schema: ENRICHMENT_SCHEMA }
      )
    }
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
        `Write a 3-step cold outreach sequence in ${L.label} to an ASSET HOLDER, offering to COMMERCIALIZE their assets.

        SENDER: CamiaCasa — Catalan real-estate firm (agente AICAT) with a network of QUALIFIED BUYERS with financing in place, active in Catalonia/Spain. Web: camiacasa.cat.
        TARGET: ${company.name} (${company.city || ''}, ${company.country}) — ${company.entity_type || segConfig.holder_profile}
        RECIPIENT: ${company.contact_type === 'named' ? `${company.first_name} ${company.last_name}, ${company.title}` : 'generic mailbox (no person known)'}
        HOLDER PROFILE: ${segConfig.holder_profile}
        THEY HOLD: ${segConfig.asset_focus}

        ENRICHMENT (the ONLY facts you may reference about the target — never invent others):
        ${JSON.stringify(enrichment, null, 2)}

        WHAT CAMIACASA OFFERS (the value proposition — all true, use naturally, not as a list):
        - A channel of qualified buyers with financing in place, actively looking in Catalonia/Spain.
        - Commercialization / co-broking of the counterparty's own assets, discreetly and off-market if preferred, for a success-based commission.
        - No exclusivity required to start; we can begin by valuing a couple of assets and bringing concrete demand.
        - Agente AICAT with professional liability cover; real closings in Catalonia.

        MANDATORY RULES:
        1. GREETING: exactly "${greeting}" — never any other name, never a template variable.
        2. Language quality: ${L.rules}
        3. Lead with THEIR situation (from enrichment — assets they hold, disposal appetite), not with the agency. No marketing hype, no exclamation marks, no fabricated numbers about them or about our track record.
        4. Do NOT invent specific buyer names or figures. Keep buyer demand qualitative ("qualified buyers with financing").
        5. NEVER mention VGP, vgpparks, Despina, other clients, campaign names, "Unknown", or placeholders like [Name]/{{name}}.
        6. CTA style (soft, yes/no): step 1 or 2 must include the soft valuation CTA, e.g. "${L.cta}". Never "15-minute call?".
        7. SIGNATURE (copy literally, each email): closing line "${L.close}" then:
        Alfons Marques
        CamiaCasa
        camiacasa.cat
        8. body_html: simple <p> paragraphs only. No images, no links except camiacasa.cat in the signature.

        STRUCTURE:
        - Step 1 (delay_days 0): 50-80 words. Hook on their holdings/disposal need -> CamiaCasa as a qualified-buyer channel -> soft valuation CTA.
        - Step 2 (delay_days 3): 50-70 words. DIFFERENT angle: how it works (discreet, off-market, commission-based, no exclusivity) with zero commitment. Soft CTA.
        - Step 3 (delay_days 7): 40-60 words. Brief, graceful re-open and soft close ("if now is not the moment, no problem").
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
        `QA check on a 3-step SELL-SIDE (commercialization) outreach sequence for: ${company.name} (language: ${company.language}, contact_type: ${company.contact_type})

        Emails: ${JSON.stringify(emailGen.emails)}
        Enrichment facts available: ${JSON.stringify(enrichment)}

        FAIL dimensions (ANY fail = reject):
        1. no_placeholders: NO "Unknown", NO [Name]/{{name}}, NO batch/campaign names.
        2. signature: each email ends with exactly "Alfons Marques" then "CamiaCasa" then "camiacasa.cat" (NO "Marquès" accent, NO "Tecnocim").
        3. word_count: Step 1 ≤80, Step 2 ≤70, Step 3 ≤60 words (body, excluding signature).
        4. no_excluded: ZERO mentions of VGP/vgpparks/Despina or any client name.
        5. no_fabrication: every claim about the TARGET comes from the enrichment facts; no invented deals, funds or numbers. Claims about CamiaCasa limited to: network of qualified buyers with financing, commercialization/co-broking for commission, discreet/off-market option, no exclusivity to start, agente AICAT with professional liability cover, real closings in Catalonia. NO invented buyer names or figures.
        6. soft_cta: step 1 or 2 contains a soft valuation CTA (yes/no question); no hard "call me" CTAs anywhere.
        7. greeting_rule: greeting is exactly "${greeting}" in all 3 emails.

        Return: { pass: bool, failures: [...], corrected_emails: [...] or null }`,
        { label: `QA: ${company.name}`, phase: 'Generate', schema: QA_SCHEMA }
      )

      let acceptedEmails = null
      if (qa && qa.pass) {
        acceptedEmails = emailGen.emails
      } else if (qa && Array.isArray(qa.corrected_emails) && qa.corrected_emails.length >= 3) {
        log(`QA auto-fix adopted for ${company.name}: ${(qa.failures || []).join(', ')}`)
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
        english: `You are a native British/international business-English editor reviewing cold emails to real-estate asset holders. Evaluate whether these read like a fluent professional wrote them: no Spanish calques ("we count with", "in base to", "realize a visit"), natural idiom, concise sentences, discreet peer-to-peer register (not salesy, not stiff).`,
        spanish: `Eres un revisor nativo de castellano profesional. Evalúa si estos emails suenan naturales para un directivo español: tildes correctas (comercialización, inversión, adquisición), frases cortas, registro par-a-par discreto (ni comercial agresivo ni notarial).`,
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
    description: r.company.entity_type || segConfig.holder_profile,
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
        source: 'camiacasa-mandatos',
        source_detail: `${selectedSegment}|named|${r.company.email_source}`.slice(0, 250)
      }
    : {
        first_name: r.company.name,
        last_name: `(${r.company.entity_type || 'entity'})`.slice(0, 90),
        email: r.company.email,
        title: 'Asset Management',
        city: r.company.city || '',
        country: r.company.country,
        source: 'camiacasa-mandatos',
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
  `Import ${importPayload.length} prospects (+${importPayload.length * 3} emails) into campaign ${CAMPAIGN_ID} as DRAFT using the NATIVE MCP TOOLS of the abm-camiacasa connector (NOT curl — the MCP server scopes every write to the CamiaCasa tenant via the connector's token).

  FIRST: load the tools in ONE ToolSearch call:
  ToolSearch query "select:mcp__abm-camiacasa__company_create,mcp__abm-camiacasa__prospect_create,mcp__abm-camiacasa__prospects_add_to_campaign,mcp__abm-camiacasa__emails_bulk_insert,mcp__abm-camiacasa__generated_emails_list"
  If the tools are NOT available, STOP immediately and return { error: "mcp_tools_unavailable" } — do NOT fall back to curl.

  COMPLETE DATA (full structure, no truncation):
  ${JSON.stringify(importPayload, null, 2)}

  STEPS — follow the ORDER exactly:

  1. For EACH item, create the company: company_create with the "company" object fields.
     - Dedup is server-side: if the domain exists the tool returns { id, deduped: true } — use that id, no 409 handling needed.

  2. Create the prospect: prospect_create with the "prospect" object fields PLUS company_id from step 1.
     - If it returns { deduped: true } (email exists = already contacted): SKIP this prospect entirely and log it. Do NOT reuse the old id.

  3. Build prospect_ids ONLY from { created: true } responses of step 2. Count = prospects_created.

  4. Enroll them: prospects_add_to_campaign with { campaign_id: "${CAMPAIGN_ID}", prospect_ids: [...] }. Check added+skipped covers all ids; any "invalid" count is a hard error.

  5. Insert the emails: emails_bulk_insert with { campaign_id: "${CAMPAIGN_ID}", emails: [ { prospect_id, step_number, subject, body_html, delay_days }, ... ] } — one entry per email of each successfully created prospect (3 per prospect).
     Validation is fail-fast server-side: on any invalid prospect_id it inserts NOTHING and returns invalid_prospect_ids — if that happens, report it as an error (it means step 2/3 bookkeeping is broken). On success verify inserted === prospects_created*3 and mismatch === false; report failed_prospect_ids otherwise.

  6. Verify: generated_emails_list with { campaign_id: "${CAMPAIGN_ID}", status: "draft", limit: "100" } — confirm the NEW drafts appear (match by prospect_email) and the total grew by the inserted count.

  Return: { companies_created, prospects_created, prospects_skipped, enrolled, inserted, expected, verified_in_api, missing_prospect_ids, error? }`,
  { label: 'Import via MCP: companies -> prospects -> enroll -> emails', phase: 'Import', schema: IMPORT_SCHEMA }
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
  side: 'sell',
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
  campaign_url: `${BASE_URL}/campaigns/${CAMPAIGN_ID}`
}
