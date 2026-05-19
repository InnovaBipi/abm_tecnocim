---
name: prospect
description: Find manufacturing SMEs with generic emails for RGPD-compliant B2B prospecting. Uses multi-agent system with WebSearch + browser automation.
arguments:
  - name: sector
    description: "Industry sector (metalurgia, plasticos, maquinaria, alimentacion, quimica, manufactura, or 'all' for all sectors)"
    required: true
  - name: region
    description: "Spanish region (catalunya, pais-vasco, valencia, madrid, aragon, navarra, or 'all' for all regions)"
    required: true
  - name: count
    description: "Target number of companies to find (default: 20)"
    required: false
user_facing: true
---

# Prospect Command

Find manufacturing SMEs in Spain with generic contact emails (info@, contacto@, comercial@) for RGPD-compliant B2B prospecting.

## Workflow

### Step 1: Research companies

Use the **prospect-researcher** agent to search the web for manufacturing SMEs in the specified sector and region.

- If sector is "all", search across: metalurgia, plasticos, maquinaria, alimentacion, quimica, manufactura
- If region is "all", search across: Catalunya, Pais Vasco, Comunidad Valenciana, Madrid, Aragon, Navarra
- Target finding 2x the requested count (to account for companies without generic emails)

Launch multiple researcher agents in parallel when searching multiple sectors or regions.

### Step 2: Extract emails

Use the **prospect-scraper** agent to visit each company's website and extract generic contact emails.

- Process in batches of 10-15 companies per agent
- Launch multiple scraper agents in parallel for different batches
- Only accept generic emails (info@, contacto@, comercial@, ventas@, administracion@)
- Reject personal emails (any with a person's name)

### Step 2.5: Verify email domains

Launch the **email-verifier** agent to check DNS MX records for all scraped domains.

- **Remove** companies with invalid domains (NXDOMAIN)
- **Flag** domains with no MX but A record as "unverified" (include with warning)
- This prevents hard bounces that damage sender domain reputation

This step is **MANDATORY**. Never skip it.

### Step 3: Compile CSV

Use the **prospect-compiler** agent to:

- Validate all results (generic emails only, correct domains)
- Deduplicate by domain (check against existing CSVs in scripts/output/)
- Generate CSV file compatible with ABM import wizard
- Generate RGPD source log with URL + timestamp for each contact
- Report summary statistics

### Step 4: Report results

Show the user:
- Number of companies found per sector/region
- Number with valid generic emails
- CSV file path
- Next steps: import via `/imports` page in ABM platform

## Sector mappings

| Argument | Full name | CNAE |
|----------|-----------|------|
| metalurgia | Metalurgia y productos metalicos | 24-25 |
| plasticos | Caucho y plasticos | 22 |
| maquinaria | Maquinaria y equipo | 28 |
| alimentacion | Alimentacion y bebidas | 10-11 |
| quimica | Industria quimica | 20 |
| manufactura | Manufactura diversa | 31-32 |

## Region mappings

| Argument | Full name |
|----------|-----------|
| catalunya | Catalunya |
| pais-vasco | Pais Vasco |
| valencia | Comunidad Valenciana |
| madrid | Comunidad de Madrid |
| aragon | Aragon |
| navarra | Navarra |

## Output files

- CSV: `scripts/output/prospects-{sector}-{region}-{YYYYMMDD}.csv`
- Source log: `scripts/output/source-log-{YYYYMMDD}.json`

## Example usage

```
/prospect metalurgia catalunya 20
/prospect all pais-vasco 30
/prospect alimentacion all 50
```
