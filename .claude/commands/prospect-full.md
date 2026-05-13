---
name: prospect-full
description: Full prospecting pipeline with enrichment, ICP scoring, RGPD compliance, and email generation. Orchestrates 8 agents for end-to-end lead generation via Claude Code.
arguments:
  - name: sector
    description: "Industry sector (metalurgia, plasticos, maquinaria, alimentacion, quimica, manufactura, or 'all')"
    required: true
  - name: region
    description: "Spanish region (catalunya, pais-vasco, valencia, madrid, aragon, navarra, or 'all')"
    required: true
  - name: count
    description: "Target number of qualified companies (default: 15). Pipeline finds 3x this to account for filtering."
    required: false
  - name: campaign
    description: "Campaign context for email generation (e.g., 'AI training for manufacturing'). If provided, generates email sequences."
    required: false
user_facing: true
---

# Prospect Full Pipeline

End-to-end prospecting pipeline that orchestrates multiple agents for maximum quality lead generation.

## Pipeline Overview

```
DISCOVERY -> EXTRACTION -> ENRICHMENT -> SCORING -> COMPLIANCE -> COMPILATION -> [OUTREACH]
```

## Workflow

### Phase 1: Discovery (parallel)

Launch **prospect-researcher** agents to find companies.

- If sector is "all", search 6 sectors in parallel
- If region is "all", search 6 regions in parallel
- Target: find 3x the requested count (to account for filtering)
- Each researcher runs 4-6 WebSearch queries

### Phase 2: Extraction (parallel batches)

Launch **prospect-scraper** agents to visit websites and extract generic emails.

- Process in batches of 10-15 companies per agent
- Launch up to 3 scraper agents in parallel
- Only accept generic emails (info@, contacto@, comercial@, ventas@)
- Record source URL for RGPD traceability

### Phase 3: Enrichment (parallel batches)

Launch **prospect-enricher** agents to research each company.

- Process in batches of 5-10 companies per agent
- Waterfall: WebSearch overview -> WebSearch news -> WebSearch LinkedIn
- Output: employee range, revenue estimate, recent news, pain points, tech signals

### Phase 4: ICP Scoring

Launch **prospect-icp-scorer** agent to score all enriched companies.

- Score 0-100 based on: company size, sector match, digital maturity, intent signals, location
- Classify into tiers: A (75+), B (50-74), C (30-49), Filter (<30)
- Remove companies scoring below 30

### Phase 5: Compliance

Launch **prospect-compliance-checker** agent to validate RGPD/LSSI compliance.

- Verify legal entity type (S.L., S.A. vs autonomo)
- Separate autonomos into review CSV
- Flag any compliance issues
- Generate compliance summary

### Phase 6: Compilation

Launch **prospect-compiler** agent to generate final outputs.

- Deduplicate against existing CSVs in scripts/output/
- Generate main CSV (confirmed legal entities with ICP score >= 30)
- Generate review CSV (possible autonomos)
- Generate RGPD source log (JSON with source URLs + timestamps)
- Include ICP scores and enrichment summary in CSV

### Phase 7: LIA Generation

Generate a Legitimate Interest Assessment document for this prospecting campaign.

- Use the campaign description, sector, and region
- Save to scripts/output/lia-{sector}-{region}-{date}.md
- This is LEGALLY REQUIRED before any email sending

### Phase 7.5: Auto-Import to Platform (optional)

**Skill reference**: Follow `.claude/skills/api-automation/SKILL.md` for all API calls.

Ask the user: "Import prospects to the ABM platform now?"

If yes:

1. **Authenticate via curl**:
```bash
BASE="${ABM_BASE_URL:-https://abm.tecnociminnova.com}"
SLUG="${ABM_TENANT_SLUG:-tecnocim}"
TOKEN=$(curl -s -X POST "${BASE}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ABM_EMAIL}\",\"password\":\"${ABM_PASSWORD}\",\"tenant_slug\":\"${SLUG}\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);process.stdout.write(r.data?.token||'')}catch(e){}})")
```
If `ABM_EMAIL` or `ABM_PASSWORD` not set, ask the user via AskUserQuestion.

2. **Upload CSV**:
```bash
UPLOAD_RESULT=$(curl -s -X POST "${BASE}/api/imports/upload" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F "file=@scripts/output/prospects-{sector}-{region}-{date}.csv")
IMPORT_ID=$(echo "$UPLOAD_RESULT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);process.stdout.write(r.data?.import_id||'')})")
```

3. **Map columns and import**:
```bash
MAP_RESULT=$(curl -s -X POST "${BASE}/api/imports/${IMPORT_ID}/map" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "column_mapping": {
      "email":"email","first_name":"first_name","company_name":"company_name",
      "domain":"domain","industry":"industry","city":"city",
      "region":"region","country":"country"
    },
    "default_tags": ["prospecting-SECTOR-REGION-DATE"]
  }')
```

4. **Report**: Show imported/skipped/errors counts.

### Phase 8: Report

Show the user a complete summary:

```
Pipeline Results
================
Companies discovered:    45
With generic email:      32
Enrichment complete:     30
ICP Score >= 30:         22
  Tier A (75+):          5
  Tier B (50-74):        10
  Tier C (30-49):        7
Compliance approved:     20
  Possible autonomos:    2 (review CSV)
Platform import:         20 imported, 0 skipped (if auto-import ran)

Output Files:
  Main CSV:     scripts/output/prospects-metalurgia-catalunya-20260513.csv (20 rows)
  Review CSV:   scripts/output/prospects-review-20260513.csv (2 rows)
  Source log:   scripts/output/source-log-20260513.json
  LIA document: scripts/output/lia-metalurgia-catalunya-20260513.md

Next Steps:
  1. Review LIA document (have legal counsel review before first send)
  2. Check Lista Robinson at listarobinson.es for all emails
  3. Run /launch-campaign to create campaign + generate emails
  4. Run /generate-sequence for Tier A prospects
  5. Run /warm-prospects for LinkedIn social warming
```

### Phase 9: Outreach (optional, if campaign context provided)

If the user provided a campaign context:

1. For each Tier A prospect:
   - Launch **email-generator** agent to create branched sequence
   - Show preview to user

2. Ask: "Create campaign and generate emails? (y/n)"

3. If yes, execute via curl (authenticate if not already done):
   ```bash
   # Create campaign
   CAMPAIGN_RESULT=$(curl -s -X POST "${BASE}/api/campaigns" \
     -H "Authorization: Bearer ${TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"name":"CAMPAIGN_NAME","description":"CAMPAIGN_CONTEXT","campaign_type":"outbound","status":"draft"}')
   CAMPAIGN_ID=$(echo "$CAMPAIGN_RESULT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);process.stdout.write(r.data?.id||r.data?.campaign?.id||'')})")

   # Find imported prospects and add to campaign
   PROSPECTS=$(curl -s "${BASE}/api/prospects?search=IMPORT_TAG&limit=100" \
     -H "Authorization: Bearer ${TOKEN}")
   # Extract prospect IDs, then:
   curl -s -X POST "${BASE}/api/campaigns/${CAMPAIGN_ID}/prospects" \
     -H "Authorization: Bearer ${TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"prospect_ids":["id1","id2",...]}'

   # Bulk insert Claude-generated emails
   curl -s -X POST "${BASE}/api/campaigns/${CAMPAIGN_ID}/bulk-insert-emails" \
     -H "Authorization: Bearer ${TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"emails":[...]}'

   # Ask user to approve
   curl -s -X POST "${BASE}/api/campaigns/${CAMPAIGN_ID}/approve-emails" \
     -H "Authorization: Bearer ${TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"email_ids":[...]}'
   ```

4. Ask: "Run LinkedIn warming for top 10? (y/n)"
5. If yes:
   - Launch **linkedin-warmer** agent for top 10 prospects

## Sector Mappings

| Argument | Full Name | CNAE | Keywords busqueda |
|---|---|---|---|
| metalurgia | Metalurgia y productos metalicos | 24-25 | fundicion, forja, mecanizado, tratamiento superficies |
| plasticos | Caucho y plasticos | 22 | inyeccion plastico, extrusion, moldes, caucho |
| maquinaria | Maquinaria y equipo | 28 | maquinaria industrial, utillajes, bienes de equipo |
| alimentacion | Alimentacion y bebidas | 10-11 | alimentacion, conservas, lacteos, bebidas, carnico |
| quimica | Industria quimica | 20 | quimica industrial, pinturas, adhesivos, detergentes |
| manufactura | Manufactura diversa | 31-32 | mueble, joyeria, juguetes, articulos deportivos |
| automocion | Componentes de automocion | 29 | componentes automocion, estampacion, inyeccion, utillajes |
| farmaceutico | Farmaceutico y cosmetica | 21 | laboratorio farmaceutico, cosmetica, fitosanitarios |
| electronica | Electronica industrial | 26-27 | electronica industrial, PCB, sensores, automatizacion |
| envases | Envases y packaging | 17-22 | envases plastico, carton ondulado, packaging alimentario |
| textil | Textil tecnico | 13-14 | textil tecnico, no-tejidos, fibras, confeccion industrial |
| ceramica | Ceramica y vidrio | 23 | ceramica industrial, refractarios, vidrio tecnico |
| software | Software industrial | 62 | software ERP, MES, IoT industrial, industria 4.0 |
| biotech | Biotecnologia | 72 | biotech, biofarmaceutica, diagnostico, agrobiotech |
| energia | Energia y renovables | 35 | solar, eolica, hidrogeno, almacenamiento energia |
| construccion | Construccion avanzada | 41-43 | prefabricados, BIM, materiales avanzados |

## Region Mappings

| Argument | Full Name |
|---|---|
| catalunya | Catalunya |
| pais-vasco | Pais Vasco |
| valencia | Comunidad Valenciana |
| madrid | Comunidad de Madrid |
| aragon | Aragon |
| navarra | Navarra |
| andalucia | Andalucia |
| castilla-leon | Castilla y Leon |
| castilla-mancha | Castilla-La Mancha |
| galicia | Galicia |
| asturias | Principado de Asturias |
| murcia | Region de Murcia |
| cantabria | Cantabria |
| extremadura | Extremadura |
| rioja | La Rioja |

## Example Usage

```
/prospect-full metalurgia catalunya 15
/prospect-full metalurgia catalunya 15 "Formacion IA para industria metalurgica"
/prospect-full all pais-vasco 20 "Consultoria innovacion industrial"
/prospect-full alimentacion all 30
```

## Timing Estimate

The full pipeline processes prospects through 8 phases. Each phase uses specialized agents.
Typical run for 15 target companies: Discovery and extraction are the longest phases due to web scraping.
