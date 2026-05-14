---
name: auto-prospect
description: Fully automated prospecting pipeline. Finds companies, scrapes legal emails, enriches with Claude, generates personalized emails, imports to platform, and schedules sending. One command, zero manual steps.
arguments:
  - name: sector
    description: "Sector to prospect, or 'next' to auto-select the next uncovered sector from the plan"
    required: false
  - name: count
    description: "Target number of qualified companies (default: 20)"
    required: false
  - name: campaign
    description: "Campaign name to add prospects to (default: 'Deducciones I+D+i 2026'). Use 'new' to create a fresh campaign."
    required: false
user_facing: true
---

# Auto-Prospect: Fully Automated Pipeline

One command that runs the ENTIRE prospecting pipeline end-to-end via Claude Code agents + curl API calls. No browser, no manual steps.

**Skill reference**: Follow `.claude/skills/api-automation/SKILL.md` for all API calls.

## Architecture

```
DISCOVER → SCRAPE → DEDUP → ENRICH+EMAIL → IMPORT → CAMPAIGN → APPROVE → DONE
```

### Agent Model Optimization
- **Researcher** (WebSearch): `model: sonnet` — fast, good at search synthesis
- **Scraper** (Playwright/Firecrawl): `model: sonnet` — browser automation
- **Enricher + Email Generator** (WebSearch + writing): `model: opus` — highest quality personalization

### Data Flow: File-Based Pipeline
All inter-agent data passes through JSON files in `scripts/output/pipeline-{date}/`:
```
pipeline-{date}/
  01-research.json      # Companies found by researcher
  02-emails.json        # Emails scraped from websites
  03-deduped.json       # After removing existing prospects
  04-enriched-emails.json  # Enrichment data + personalized emails
  05-import-result.json    # Import API response
  06-campaign-result.json  # Campaign + sequence IDs
```
This keeps data out of the token budget and enables retry of individual stages.

## Step 1: Authenticate

```bash
BASE="${ABM_BASE_URL:-https://abm.tecnociminnova.com}"
```
Login via curl following api-automation skill. If ABM_EMAIL/ABM_PASSWORD not set, ask user.

## Step 2: Determine sector

If `$ARGUMENTS.sector` is "next" or empty, auto-select the next uncovered sector:

**Sector rotation order** (covers all Spanish industry):

| Priority | Sector | Keywords |
|----------|--------|----------|
| 1 | metalurgia | fundicion, forja, mecanizado, tratamiento superficies |
| 2 | plasticos | inyeccion plastico, extrusion, moldes, caucho |
| 3 | maquinaria | maquinaria industrial, utillajes, bienes de equipo |
| 4 | alimentacion | alimentacion, conservas, lacteos, bebidas, carnico |
| 5 | quimica | quimica industrial, pinturas, adhesivos, detergentes |
| 6 | manufactura | mueble, joyeria, juguetes, articulos deportivos |
| 7 | automocion | componentes automocion, estampacion, inyeccion, utillajes |
| 8 | farmaceutico | laboratorio farmaceutico, cosmetica, fitosanitarios |
| 9 | electronica | electronica industrial, PCB, sensores, automatizacion |
| 10 | envases | envases plastico, carton ondulado, packaging alimentario |
| 11 | biotech | biotecnologia, biofarmaceutica, diagnostico, agrobiotech |
| 12 | energia | solar, eolica, hidrogeno, almacenamiento energia |
| 13 | textil | textil tecnico, no-tejidos, fibras, confeccion industrial |
| 14 | ceramica | ceramica industrial, refractarios, vidrio tecnico |
| 15 | software | software ERP, MES, IoT industrial, industria 4.0 |
| 16 | construccion | prefabricados, BIM, materiales avanzados |

To determine which sector is "next":
1. Fetch existing prospects: `curl GET /api/prospects?limit=200`
2. Extract unique industries from the response
3. Pick the first sector from the table above that has < 10 prospects

## Step 3: Get existing domains for dedup

```bash
curl GET /api/prospects?limit=500 → extract all domains
```
Build a dedup list of domains already in the database.

## Step 4: Research companies (prospect-researcher agent)

Launch a **prospect-researcher** agent with:
- The selected sector and keywords
- Region: "all" (toda Espana)
- Target count: `$ARGUMENTS.count` or 20
- Existing domains to exclude (dedup list from step 3)

Wait for results: JSON array of companies with name, domain, city, sector, source_url.

## Step 5: Scrape emails (prospect-scraper agent)

Launch a **prospect-scraper** agent with the discovered companies.
- Extract ONLY generic emails: info@, contacto@, comercial@, ventas@, administracion@
- Reject personal emails (nombre@)
- Record source_url for RGPD traceability

Wait for results: JSON array with domain, email, source_url.

## Step 6: Compile and validate

Filter results:
- Remove companies with no email found
- Remove duplicates against existing prospects (step 3 dedup list)
- Verify all emails are generic (no personal names)
- Write CSV to `scripts/output/prospects-{sector}-{date}.csv`

Report: "Found X companies, Y with email, Z after dedup"

## Step 7: Enrich + Generate personalized emails (general-purpose agent)

Launch a **general-purpose** agent that for each company:
1. Does 1-2 WebSearch queries to find specific products, news, I+D projects
2. Generates a personalized email step 1 following **2026 cold email benchmarks**:
   - Identity: Alfons Marquès from Tecnocim
   - Topic: Deducciones fiscales I+D+i
   - Tone: professional peer-to-peer, NO salesy, NO exclamation marks
   - **Length: 50-80 words** (2026 optimal range for highest reply rates)
   - **Subject: 21-40 chars** (49% open rate sweet spot), specific to company
   - Language: Catalan for Catalunya companies, Spanish otherwise
   - **Reference ONE specific verified fact** (product name, investment, patent, award, employee count)
   - **CTA: soft interest question** ("¿Tiene sentido explorarlo?", NOT "¿Tendríais 15 minutos?")
   - **Vary deduction phrasing**: don't always say "25-42%", use alternatives like "hasta el 42%", "incentivos fiscales por innovación", etc.
   - **Framework**: Use PAS (Problem-Agitate-Solve) for companies unaware of deductions, BAB (Before-After-Bridge) for visibly innovative ones
   - Sign as: Alfons Marquès / Tecnocim

Returns JSON array: [{company_name, domain, email, language, subject, body_html}]

## Step 8: Import to platform via curl

```bash
# Upload CSV
curl POST /api/imports/upload -F "file=@scripts/output/prospects-{sector}-{date}.csv"
# Map columns
curl POST /api/imports/{id}/map with standard column mapping + tags ["deducciones-idi-2026", "batch-{sector}"]
```

## Step 9: Add to campaign

If `$ARGUMENTS.campaign` is "new", create a new campaign:
```bash
curl POST /api/campaigns with {name, description, campaign_type: "outbound", status: "active"}
```

Otherwise, find existing campaign by name:
```bash
curl GET /api/campaigns?search={campaign_name} → extract campaign_id
```

Then add imported prospects:
```bash
# Search for newly imported prospects by sector tag
curl GET /api/prospects?search=batch-{sector}&limit=100
# Add to campaign
curl POST /api/campaigns/{id}/prospects with {prospect_ids: [...]}
```

## Step 10: Create branched sequence + enroll

```bash
# Create sequence
curl POST /api/sequences with standard config (from_email, send_window, daily_limit:40)
# Add 7 branched steps from template
curl POST /api/sequences/{id}/steps with steps from sequence-deducciones-idi-branched.json
# Wire branching conditions
curl POST /api/sequences/{id}/wire-steps
# Enroll all prospects
curl POST /api/sequences/{id}/enroll with {prospect_ids: [...]}
```

## Step 11: Bulk insert personalized emails

```bash
# Map each email to its prospect_id
# Bulk insert step 1 personalized emails (as drafts)
curl POST /api/campaigns/{id}/bulk-insert-emails with {emails: [...]}
```

**DO NOT approve yet** — Step 11.5 QA must pass first.

## Step 11.5: Email QA (mandatory before approval)

Launch the **email-qa** agent to validate all draft emails against the 20-point checklist:
- Word count 50-80 (2026 optimal range)
- Subject 21-40 chars
- Soft interest CTAs (not time-request)
- Personalization (specific facts, not generic)
- Deduction phrasing variety (not all "25-42%")
- No spam triggers, no unresolved variables
- Language match (Catalan for Catalunya, Spanish otherwise)

The QA agent will:
1. **Auto-fix** what it can (subject length, CTA type, phrase variation)
2. **Reject** emails that fail hard checks (spam, duplicates, suppression list)
3. **Flag** emails needing manual review (too short, generic, language mismatch)

Wait for QA report before proceeding. If FAIL rate > 10%, investigate and fix before approving.

## Step 12: Approve (warmup-aware)

```bash
# Get all draft email IDs (post-QA)
curl GET /api/campaigns/{id}/generated-emails?status=draft&limit=200
# Approve all — the server automatically distributes across business days
# respecting the warmup daily limit (e.g., 40/day for Tecnocim)
curl POST /api/campaigns/{id}/approve-emails with {email_ids: [...]}
```

The response includes the distribution breakdown:
```json
{"distribution": {"2026-05-14": 40, "2026-05-15": 40, ...}, "daily_limit": 41}
```

## Step 13: Report

```
Auto-Prospect Complete
======================
Sector:          {sector}
Discovered:      X companies
With email:      Y companies (Z% hit rate)
After dedup:     W companies (new)
Enriched:        W companies (WebSearch)
Emails generated: W personalized
Imported:        W/W to platform
Campaign:        {campaign_name} ({campaign_id})
Sequence:        branched 7 steps ({sequence_id})
Enrolled:        W prospects
Emails approved: W scheduled for sending
Send rate:       40/day (Mon-Fri 9-11h Madrid)
Est. completion: ~{days} business days

RGPD Compliance:
  - Generic emails only: OK
  - LIA document: scripts/output/lia-deducciones-idi-all-20260513.md
  - Unsubscribe link: OK (RGPD Art. 14 footer)
  - Source traceability: OK (source_url per company)
```

## RGPD Compliance (automatic)

This command ONLY contacts:
- **Legal entities** (S.L., S.A., S.L.U., S.A.U.) — never autonomos
- **Generic emails** (info@, contacto@, comercial@) — never personal
- **With unsubscribe link** — RGPD Art. 14 footer in every email
- **Under legitimate interest** — Art. 6.1.f, documented in LIA
- **With source traceability** — source_url for every company

## Example Usage

```
/auto-prospect                    # Auto-picks next sector, 20 companies
/auto-prospect energia 25         # 25 energy companies
/auto-prospect next 30            # 30 companies from next uncovered sector
/auto-prospect biotech 15 new     # 15 biotech, creates new campaign
```

## Continuous Prospecting

To run continuously (1 batch per day):
```
/loop 24h /auto-prospect next 20
```

Or manually trigger each morning:
```
/auto-prospect next 25
```

The system deduplicates automatically — running it multiple times is safe.
