# ACCIÓ Pipeline Status — 26 June 2026

## Campaign
- **Campaign ID:** `09ff25ad-04e5-4d5e-906d-af3a0795c2f3` (updated in command file)
- **Campaign name:** ACCIÓ Noves Oportunitats de Negoci 2026
- **Deadline:** 16 July 2026 (20 days remaining)

## Progress

### ✅ Step 1-2: Auth + Dedup
- Authenticated as alfons.marques@tecnocim.com
- Tenant: tecnocim
- Dedup list: ~1,400 existing prospects in tenant

### ✅ Step 3-4: Research
- Agent: prospect-researcher (sonnet model)
- Query: "empresas industriales manufacturing Catalunya..."
- **Result:** 26 verified Catalan industrial SMEs discovered
- Sectors: textiles, packaging, metalworking, chemicals, machinery, plastics, electronics, recycling
- Coverage: all 4 provinces (Barcelona, Girona, Tarragona, Lleida)

### ✅ Step 5: Scrape Emails
- Agent: prospect-scraper (sonnet model)
- Method: visit each website, extract generic emails only
- **Result:** 20 companies with verified generic emails (info@, contacto@, comercial@, etc.)
- **Rejected:** 4 companies (personal emails, domain mismatches)
- Hit rate: 20/26 = 77%

### ✅ Step 5.5: Verify MX
- Agent: email-verifier
- Method: DNS MX lookup for each domain
- **Result:** 22 domains verified with valid MX records
- **Invalid:** 0
- **Delivery risk:** 0% expected bounces from invalid MX

### ✅ Step 7: Import Prospects
- CSV created: 22 prospect rows
- File uploaded to /api/imports/upload
- Column mapping applied
- **Result:** 19 prospects successfully imported
- **Skipped:** 3 (probable duplicates)
- Status: Prospects now in database with full data

### ⏳ Step 8 (IN PROGRESS): Generate Emails
- Agent: email-generator (opus model)
- Target: 19 prospects × 3 steps each = 57 personalized emails
- Each step includes:
  - Step 1 (day 0): Introduction + ACCIÓ opportunity + research-based personalization
  - Step 2 (day +3): Second angle + grant details
  - Step 3 (day +7): Final touch + deadline reminder
- Encoding: UTF-8 validation + mojibake fixes
- Research: 2x WebSearch + Firecrawl homepage scrape per company

### ⏳ Step 8c (PENDING): Persist Enrichment
- For each prospect: save research data via PUT /api/prospects/:id
- Fields: enrichment_data.perplexity_research, website_content, ai_analysis

### ⏳ Step 9 (PENDING): Bulk Import Emails
- Endpoint: POST /api/campaigns/09ff25ad-04e5-4d5e-906d-af3a0795c2f3/bulk-insert-emails
- Method: Python JSON write (UTF-8) + curl --data-binary @file.json
- Status on insert: draft
- Max per request: 1000 (we'll have 57, single call)

### ⏳ Step 10 (PENDING): Report
- Summary stats
- Next steps for user (review + approve)

## Technical Notes

- **Base URL:** https://abm.tecnociminnova.com
- **Tenant:** tecnocim (tenant-tecnocim-0003)
- **Auth:** JWT Bearer token, 7-day expiry
- **Rate limits:** None mentioned for prospects/campaigns
- **Email status:** All emails import as `draft` (= pending in UI)
- **CSV columns mapped:** email, first_name, company_name, domain, city, region, industry

## Next Actions

1. **Email generation:** Launch email-generator agent for 19 prospects
   - Total output: 57 emails (3 per prospect)
   - Quality checks: 25-point QA checklist for Spanish/Catalan
   - Encoding validation: mojibake detection + fix

2. **Bulk import:** Push 57 emails to campaign via /bulk-insert-emails
   - File-based curl for Windows encoding safety
   - Dedup per (prospect_id, campaign_id, step_number)

3. **User review:** Emails visible in campaign Bandeja as draft
   - User can edit, approve, or reject
   - On approve: auto-distribution across business days (warmup-aware)

4. **Warmup schedule:** ~40 emails/day ramping to 100/day
   - 57 emails ≈ 2-3 days at base rate or 1-2 days at max
   - Weekend defense: scheduler blocks Sat/Sun

## Files

- `/tmp/accio_prospects.csv` — Input CSV (22 rows)
- `/tmp/accio_imported_prospects.json` — Imported prospect data
- `/tmp/abm_token.txt` — Current JWT token (7-day TTL)
- `C:\Users\user\proyectos\abm_tecnocim\.claude\commands\auto-prospect-accio.md` — Updated with correct campaign UUID
