---
name: auto-prospect-accio
description: ACCIÓ-specific prospecting pipeline. Finds Catalan industrial SMEs, generates 3-step personalized email sequences for the ACCIÓ Noves Oportunitats program. Hardcoded for campaign 09ff25ad-04e5-4d5e-906d-af3a0795c2f3, deadline 16 July 2026.
arguments:
  - name: count
    description: "Target number of qualified companies (default: 20)"
    required: false
user_facing: true
---

# Auto-Prospect: ACCIÓ Noves Oportunitats Pipeline

Fully automated prospecting pipeline specialized for the **ACCIÓ Noves Oportunitats de Negoci 2026** campaign targeting Catalan industrial SMEs. One command, fully personalized emails.

**Skill reference**: Follow `.claude/skills/api-automation/SKILL.md` for all API calls.

## Campaign Context

| Parameter | Value |
|-----------|-------|
| Campaign ID | `09ff25ad-04e5-4d5e-906d-af3a0795c2f3` (hardcoded) |
| Campaign name | ACCIÓ Noves Oportunitats de Negoci 2026 |
| Offer | €30k–€120k grant from Generalitat de Catalunya to finance business plan + market entry |
| Geography | **Catalunya only** (all provinces: Barcelona, Girona, Tarragona, Lleida) |
| Target sector | **Any industrial SME** eligible for ACCIÓ (manufacturing, food, chemicals, plastics, machinery, electronics, textiles, recycling, etc.) |
| Deadline | **16 July 2026** (must send all emails before this date) |
| Sender identity | Tecnocim Innova — official ACCIÓ consultant |
| Language | Auto-detect Spanish/Catalan per company |

## Architecture

```
DISCOVER → SCRAPE → DEDUP (tenant-wide) → ENRICH+EMAIL → IMPORT → CAMPAIGN → EMAILS DRAFT → DONE
```

**Note:** Steps are identical to `/auto-prospect`, but with ACCIÓ-specific parameters (no approval/warmup — stops at draft).

### Agent Model Optimization
- **Researcher** (WebSearch): `model: sonnet` — fast, good at search synthesis
- **Scraper** (Playwright/Firecrawl): `model: sonnet` — browser automation
- **Email Generator** (WebSearch + writing): `model: opus` — highest quality personalization

### Data Flow: File-Based Pipeline
All inter-agent data passes through JSON files in `scripts/output/pipeline-accio-{date}/`:
```
pipeline-accio-{date}/
  01-research.json      # Companies found by researcher
  02-emails.json        # Emails scraped from websites
  03-deduped.json       # After removing existing prospects (tenant-wide dedup)
  04-enriched-emails.json  # Enrichment data + personalized emails
  05-import-result.json    # Import API response
  06-campaign-result.json  # Campaign + emails added
```

## Step 1: Authenticate

```bash
BASE="${ABM_BASE_URL:-https://abm.tecnociminnova.com}"
```

Login via curl following api-automation skill. If ABM_EMAIL/ABM_PASSWORD not set, ask user.

## Step 2: Fixed sector selection

**ACCIÓ focuses on industrial SMEs in Catalunya, any sector eligible for the grant.**

Do NOT use the sector rotation table from `auto-prospect.md`. Instead:

1. Use a simple open-ended search: **"empresas industriales Catalunya S.L. S.A. contacto email"**
2. The researcher will discover companies across ALL industrial subsectors (metal, plástics, química, alimentación, maquinaria, electrónica, textil, madera, envases, reciclaje, etc.)
3. No sector rotation — each run discovers new companies from different comarcas/sectors

## Step 3: Get existing domains for dedup (tenant-wide)

```bash
curl GET /api/prospects?limit=500 → extract all domains from TENANT
```

Build a dedup list of ALL domains already in the database, not just campaign 09ff25ad-04e5-4d5e-906d-af3a0795c2f3.
This prevents contacting the same company twice with different messages (ACCIÓ vs. I+D+i).

## Step 4: Research companies (prospect-researcher agent)

Launch a **prospect-researcher** agent with:
- Search query: **"empresas industriales manufacturing Catalunya Lleida Girona Tarragona Barcelona 2025 contacto"**
- Alternative queries (if first yields < 20 results):
  - **"poligono industrial Catalunya S.L. S.A. empresa"**
  - **"directorio empresas industriales Catalunya"**
  - **"empresas manufactura innovacion Catalunya ecosistema"**
- Region: **"Catalunya"** (hardcoded, not "all Spain")
- Target count: `$ARGUMENTS.count` or 20
- Existing domains to exclude (dedup list from step 3 — tenant-wide)

Wait for results: JSON array of companies with name, domain, city, comarca, sector, source_url.

## Step 5: Scrape emails (prospect-scraper agent)

Launch a **prospect-scraper** agent with the discovered companies.
- Extract ONLY generic emails: info@, contacto@, comercial@, ventas@, administracion@
- Reject personal emails (nombre@)
- Record source_url for RGPD traceability

Wait for results: JSON array with domain, email, source_url.

Save results to `scripts/output/pipeline-accio-{date}/02-emails.json`.

## Step 5.5: Verify email domains (email-verifier agent)

Launch the **email-verifier** agent with the scraped companies from Step 5.

- Input: JSON array from `02-emails.json`
- Checks DNS MX records for each unique domain via `nslookup -type=MX` or `dig MX`
- **Removes** companies with invalid domains (NXDOMAIN — domain does not exist)
- **Flags** domains with no MX records but A record exists as "unverified" (include with warning)
- Saves results to `scripts/output/pipeline-accio-{date}/02b-verified.json`
- Only passes `verified` + `unverified` domains to Step 6

This step is **MANDATORY**. Never skip it.

Report: "Verified X domains: Y verified, Z unverified, W invalid (removed)"

## Step 6: Compile and validate

Filter results:
- Remove companies with no email found
- Remove duplicates against **TENANT-WIDE existing prospects** (step 3 dedup list)
- Verify all emails are generic (no personal names)
- Write CSV to `scripts/output/prospects-accio-{date}.csv`

Report: "Found X companies, Y with email, Z after dedup"

## Step 7: Research + Generate personalized emails (email-generator agent)

For EACH company in the deduped list, launch a **email-generator** agent to:

### 7a: Research Phase

1. **WebSearch (2 queries per company):**
   - Query 1: `"{company_name} {city} noticias recientes 2025 2026"` — Find recent news, expansions, investments
   - Query 2: `"{company_name} nuevos mercados diversificacion innovacion 2025"` — Find diversification/growth signals
   
2. **Firecrawl scrape (if domain has website):**
   - Scrape homepage + about page (if accessible)
   - Extract first 3000 characters of content
   - If scrape fails: note error but continue with WebSearch data

3. **Structure research as JSON:**
   ```json
   {
     "research": {
       "websearch_1": "results from news query",
       "websearch_2": "results from diversification query",
       "website_content": "scraped content (if available)",
       "facts_found": [
        "specific fact 1 from research",
        "specific fact 2 from research"
       ]
     }
   }
   ```

### 7b: Generate 3 Personalized Emails (steps 1-3)

Using the research above + email-generator agent rules, create a 3-step sequence following the **EXACT template structure** of the active ACCIÓ campaign:

#### Email 1 (step 1, day 0): Introduction + ACCIÓ opportunity

**Structure:**
```
Buenos días,

Desde Tecnocim, especialistas en gestión de ayudas I+D+i, nos dirigimos a [Company Name].

Hemos identificado la oportunidad del programa ACCIÓ "Noves Oportunitats 2026",
ideal para empresas como la suya en el sector industrial catalán.

[RESEARCH-BASED CONTEXT: specific mention of company's sector, recent news, or capabilities]
Esta ayuda permite financiar el plan de negocio y la implementación de proyectos clave
como [specific example 1 from research] o [specific example 2 from research].

Nuestro equipo multidisciplinar puede guiarles en todo el proceso.

¿Les interesaría explorar su potencial?

Saludos cordiales,
Alfons Marquès
Tecnocim Innova
```

**Requirements:**
- **Length: 50–80 words** (body only)
- **Subject: 21–40 chars**, specific to company + ACCIÓ context (e.g., "ACCIÓ + [Sector]", "€120k grant — [Company type]")
- Reference ONE specific verified fact from research (news, sector trend, capability)
- CTA: soft question ("¿Les interesaría...?")
- Language: Auto-detect Spanish/Catalan based on company web presence
- Framework: Introduce problem → present ACCIÓ solution → offer guidance

#### Email 2 (step 2, +3 days): Second angle + grant details

**Structure:**
```
[Greeting per language],

Hace unos días nos dirigimos a ustedes sobre [reference to step 1 angle].

Considerando [DIFFERENT research-based insight from Step 1], el programa ACCIÓ 
permite financiar hasta €120.000 para empresas como la suya.

[SECTOR-SPECIFIC EXAMPLE: "Empresas en el sector de [sector] que se han beneficiado..." 
or "El mercado de [target market] ofrece oportunidades para..."]

Nuestro acompañamiento incluye [process step 1], [process step 2], y [process step 3].

¿Tiene sentido explorar esta línea de financiación juntos?

[Language-appropriate closing]
[Signature]
```

**Requirements:**
- **Length: 50–70 words**
- **Subject: 21–40 chars**, DIFFERENT from step 1 (e.g., "€120k para [sector específico]")
- Reference a SECOND aspect of their business (different research fact than step 1)
- Include concrete grant amount and process overview
- CTA: slightly stronger but still soft ("¿Tiene sentido explorar...?")

#### Email 3 (step 3, +7 days): Final touch + deadline

**Structure:**
```
[Greeting],

Recoremos nuestra propuesta: [ONE-LINE reference to step 1].

El programa ACCIÓ cierra el 16 de julio — aún hay tiempo para preparar una candidatura ganadora.

Sin presión: si no es el momento, lo entendemos. Pero si hay interés, podemos agilizar el proceso.

Saludos,
[Signature]
```

**Requirements:**
- **Length: 40–60 words** (very brief)
- **Subject: max 30 chars** (e.g., "Última oportunidad", "16 de julio")
- Reference step 1 briefly — no new arguments
- MUST include deadline: "16 de julio"
- Leave door open with empathetic language
- CTA: low-pressure

#### Rules for ALL steps

- **Identity**: Alfons Marquès from Tecnocim Innova
- **Topic**: ACCIÓ Noves Oportunitats grant financing
- **Tone**: professional peer-to-peer, no salesy language, no exclamation marks
- **Language**: Auto-detect Spanish/Catalan based on company website, legal name, and location
  - If company website is in Catalan → Catalan email
  - If company website is in Spanish → Spanish email
  - Default: Spanish for companies outside principal Catalan regions
  - **Catalan translations of key phrases**:
    - "Desde Tecnocim..." → "Des de Tecnocim..."
    - "especialistas en gestión de ayudas I+D+i" → "especialistes en gestió d'ajuts I+D+i"
    - "Noves Oportunitats" → (keep exact name, same in both languages)
    - "Saludos cordiales" → "Salutacions cordials" or "Atentament"
    - "¿Les interesaría explorar...?" → "Us agradaria explorar...?"
- **Spanish accents (OBLIGATORIO)**: deducción, innovación, financiación, validación, subvención, gestión, tecnología, especíicos, además, más. **Nombre: Marquès (accent grave è)**
- **Catalan accents**: innovació, gestió, ajuts, especialistes, tecnologia, més
- **Anti-invention rule**: NEVER reference facts not found in research. If research shows no specific details, use sector + city context. Better to be vague than to invent.
- **Greeting**: Always "Buenos días," / "Hola," (depending on language) — NEVER use prospect name
- **Sign as**: Alfons Marquès / Tecnocim Innova
- **NEVER include**: "Unknown", campaign names ("Batch", "Deducciones I+D+i"), template variables ({{...}}), generic sector language
- **Vary ACCIÓ grant phrasing** across the 3 emails (step 1: "up to €120k", step 2: "financing for plan + implementation", step 3: "deadline reminder")

### 7.5: Encoding Validation (MANDATORY before import)

**Check for encoding errors** in generated emails:

```python
# Mojibake patterns: cp1252 bytes decoded as UTF-8
MOJIBAKE_PATTERNS = ['Ã³', 'Ã¡', 'Ã©', 'Ã±', 'Ã¼', 'â€', 'â‚¬', 'Â¿', 'Â¡']

def fix_mojibake(text):
    """Repair cp1252→UTF-8 corruption"""
    try:
        return text.encode('latin-1').decode('utf-8')
    except (UnicodeDecodeError, UnicodeEncodeError):
        return text

errors_found = []
for email in all_emails:
    subject = email.get('subject', '')
    for pattern in MOJIBAKE_PATTERNS:
        if pattern in subject or pattern in email.get('body_html', ''):
            email['subject'] = fix_mojibake(subject)
            email['body_html'] = fix_mojibake(email['body_html'])
            errors_found.append(f"{email['company_name']} step {email['step_number']}")
            break

if errors_found:
    print(f"[WARN] Fixed {len(errors_found)} encoding errors before import")
```

**Why:** Windows subprocess can re-encode UTF-8 strings to cp1252 before passing to curl. This check catches it before sending to API.

### 7c: Persist Research to Database

After email generation, for EACH prospect, call:

```bash
curl -s -X PUT "${BASE}/api/prospects/${PROSPECT_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "enrichment_data": {
      "enriched_at": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
      "sources": ["websearch", "firecrawl"],
      "perplexity_research": "combined text from both WebSearch queries + firecrawl (truncated to 2000 chars)",
      "website_content": "firecrawl content (if available, up to 3000 chars)",
      "ai_analysis": {
        "key_insights": [
          "insight from research 1",
          "insight from research 2"
        ],
        "suggested_use_cases": [
          "specific use case 1 based on research",
          "specific use case 2 based on research"
        ],
        "pain_points": [
          "identified challenge 1",
          "identified challenge 2"
        ],
        "company_description": "1-2 sentence summary from research",
        "company_industry": "industry from research or classification"
      }
    }
  }'
```

**Processing note:** Process companies sequentially (one at a time), not in batch.

## Step 8: Bulk import emails to campaign 9f6822a5 (FILE-BASED, UTF-8 SAFE)

**CRITICAL: Always use file-based curl (`--data-binary @file.json`) to avoid Windows encoding corruption.**

```bash
# Step 8a: Write payload to file with explicit UTF-8 encoding
python3 -c "
import json
emails = [
  {'prospect_id': 'ID1', 'step_number': 1, 'subject': '...', 'body_html': '...', 'delay_days': 0},
  # ... all 45+ emails ...
]
with open('/tmp/accio_bulk_payload.json', 'w', encoding='utf-8') as f:
    json.dump({'emails': emails}, f, ensure_ascii=False)
"

# Step 8b: Import using file-based curl (zero shell encoding conversion)
curl -s -X POST "$BASE_URL/campaigns/09ff25ad-04e5-4d5e-906d-af3a0795c2f3/bulk-insert-emails" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json; charset=utf-8" \
  --ssl-no-revoke \
  --data-binary @/tmp/accio_bulk_payload.json
```

**WHY file-based?**
- **WRONG**: `curl -d "$variable"` on Windows: variable gets re-encoded to cp1252 before reaching curl
- **RIGHT**: `curl --data-binary @file.json`: file is read as raw bytes, zero conversion

**DO NOT approve yet** — emails remain in DRAFT status for user review.

## Step 9: Report

```
Auto-Prospect ACCIÓ Complete
============================
Discovered:      X companies
With email:      Y companies (Z% hit rate)
After dedup:     W companies (new, not in any campaign)
Enriched:        W companies (WebSearch + Firecrawl)
Emails generated: W personalized (W × 3 steps)
Imported:        W/W to campaign 09ff25ad-04e5-4d5e-906d-af3a0795c2f3
Status:          DRAFT (awaiting user review + approval)

Campaign: ACCIÓ Noves Oportunitats 2026 (09ff25ad-04e5-4d5e-906d-af3a0795c2f3...)
Deadline: 16 July 2026 (~14 business days remaining)
Warmup capacity: ~560 emails (40/day × 14 days)
Current draft batch: W emails

Next steps:
1. Review emails in campaign Bandeja tab
2. Edit if needed (language, personalization, facts)
3. Approve when ready — system will auto-distribute across business days
```

## RGPD Compliance (automatic)

This command ONLY contacts:
- **Legal entities** (S.L., S.A., S.L.U., S.A.U.) — never autonomos
- **Generic emails** (info@, contacto@, comercial@) — never personal
- **With unsubscribe link** — RGPD Art. 14 footer in every email
- **Under legitimate interest** — Art. 6.1.f for business development
- **With source traceability** — source_url for every company
- **Catalan data subjects** — no cross-border transfers outside EU

## Example Usage

```
/auto-prospect-accio              # Discovers ~20 Catalan companies, generates 60 emails
/auto-prospect-accio 30           # Discovers ~30 companies, generates 90 emails
```

## Continuous Prospecting

To run multiple times before the deadline:
```
/auto-prospect-accio 20           # Run 1: 20 companies + 60 emails
/auto-prospect-accio 20           # Run 2: 20 MORE companies + 60 emails (auto-dedups)
/auto-prospect-accio 20           # Run 3: 20 MORE companies + 60 emails
```

Each run deduplicates against existing prospects in the tenant. Safe to run multiple times.

**Max capacity until 16 July:** ~560 emails (40/day warmup × 14 business days).
