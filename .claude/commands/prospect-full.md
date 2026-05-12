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

Output Files:
  Main CSV:     scripts/output/prospects-metalurgia-catalunya-20260513.csv (20 rows)
  Review CSV:   scripts/output/prospects-review-20260513.csv (2 rows)
  Source log:   scripts/output/source-log-20260513.json
  LIA document: scripts/output/lia-metalurgia-catalunya-20260513.md

Next Steps:
  1. Review LIA document (have legal counsel review before first send)
  2. Check Lista Robinson at listarobinson.es for all emails
  3. Import main CSV via /imports page in ABM platform
  4. Run /generate-sequence for Tier A prospects
  5. Run /warm-prospects for LinkedIn social warming
```

### Phase 9: Outreach (optional, if campaign context provided)

If the user provided a campaign context:

1. For each Tier A prospect:
   - Launch **email-generator** agent to create branched sequence
   - Show preview to user
2. Ask: "Import and enroll these prospects? (y/n)"
3. If yes:
   - Import CSV via platform API
   - Create sequences via API
   - Enroll prospects
4. Ask: "Run LinkedIn warming for top 10? (y/n)"
5. If yes:
   - Launch **linkedin-warmer** agent for top 10 prospects

## Sector Mappings

| Argument | Full Name | CNAE |
|---|---|---|
| metalurgia | Metalurgia y productos metalicos | 24-25 |
| plasticos | Caucho y plasticos | 22 |
| maquinaria | Maquinaria y equipo | 28 |
| alimentacion | Alimentacion y bebidas | 10-11 |
| quimica | Industria quimica | 20 |
| manufactura | Manufactura diversa | 31-32 |

## Region Mappings

| Argument | Full Name |
|---|---|
| catalunya | Catalunya |
| pais-vasco | Pais Vasco |
| valencia | Comunidad Valenciana |
| madrid | Comunidad de Madrid |
| aragon | Aragon |
| navarra | Navarra |

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
