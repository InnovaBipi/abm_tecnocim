---
name: auto-prospect-ferreteria
description: "M&A blind-note prospecting: find hardware store (ferretería) buyers by segment, generate personalized cold emails, and import to CamiaCasa deal campaign"
---

# /auto-prospect-ferreteria — Ferretería M&A Prospecting

**Comando**: Prospecting multi-segmento para encontrar compradores de ferretería. Busca por segmento (ferreterías, adyacentes, plataformas, asociaciones, inversores), genera emails SDR en formato nota ciega, y los importa al campaign dealm&a.

**Campaña**: `218adfd3-8390-4f2f-889f-7c889db00738` (CamiaCasa tenant)  
**Tenant**: `camiacasa` (token: `C:/Users/user/tmp_auth_cc.txt`)  
**Sender**: Alfons Marques / CamiaCasa  
**Deal**: Ferretería Baix Llobregat — 550.000€, ~400m², 40+ años, >400K€ facturación, subrogable, jubilación

## Usage

```bash
/auto-prospect-ferreteria [--segment <key>] [--count <n>]

--segment: ferreterias | adjacent | platforms | chinese | other-assoc | investors | all
           (default: auto-rotate to first segment with <5 prospects)
--count:   target number of companies (default: 15)
```

## Segments & Messaging

| Segment | Buyer Type | Search Queries | Email Angle | Notes |
|---------|-----------|----------------|-------------|-------|
| `ferreterias` | Hardware/DIY chains in AMB | "ferretería bricolaje AMB Baix Llobregat L'Hospitalet Cornellà empresa S.L. email" | "Integra un punt de venda consolidat a la teva xarxa" | Consolid. with existing stores |
| `adjacent` | Plumbing / electrical / paint dist. | "fontaneria climatizacion electricidad pintura distribucion Catalunya email" | "Diversifica el teu canal amb ferreteria de proximitat" | Upsell to adjacent sectors |
| `platforms` | Online traspaso platforms | "plataforma traspaso negocio mediador empresa cataluña compraventa" | Listing request to share with users | Referral channel — no direct buy |
| `chinese` | Chinese business associations | "asociacion empresarial china Catalunya Barcelona camara comercio email" | "Difusió als vostres membres interessats en negocis ferreteria" | **Share with members** not direct pitch |
| `other-assoc` | Pakistani / Maghrebi associations | "asociacion pakistani marroqui bangladesi comerciantes Catalunya email" | Community diffusion — same as Chinese | **Share** — RGPD safe via association |
| `investors` | SME investors / business angels | "inversor pyme negocio compraventa empresa familiar Barcelona family office" | "Actiu comercial amb immoble propi, rendibilitat demostrada" | Angel network + patrimonial funds |

**Key**: Association segments (chinese, other-assoc) send: *"Would you share this opportunity with members interested in acquiring a consolidat hardware business?"* NOT a direct pitch.

---

## Pipeline (12 Steps)

### STEP 1 — Auth CamiaCasa

```bash
# Reuse token from C:/Users/user/tmp_auth_cc.txt if valid (JWT 7d)
# Otherwise: POST /api/auth/login with email/password/tenant_slug

EMAIL="alfons.marques@camiacasa.cat"
PASSWORD="..." # from env or prompt
TENANT_SLUG="camiacasa"
BASE_URL="https://abm.tecnociminnova.com"

# Extract JWT from response, store in tmp_auth_cc.txt
TOKEN=$(cat C:/Users/user/tmp_auth_cc.txt 2>/dev/null || echo "")

if [ -z "$TOKEN" ]; then
  printf '%s\n' "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"tenant_slug\":\"$TENANT_SLUG\"}" | curl -X POST -H "Content-Type: application/json" -d @- "$BASE_URL/api/auth/login" | node -e "const d = JSON.parse(require('fs').readFileSync(0, 'utf8')); process.stdout.write(d.data?.token || '')" > C:/Users/user/tmp_auth_cc.txt
  TOKEN=$(cat C:/Users/user/tmp_auth_cc.txt)
fi

echo "[Step 1] ✓ Auth: token saved to tmp_auth_cc.txt"
```

### STEP 2 — Load Tenant-wide Dedup Set

```bash
# GET /api/prospects?limit=500 (paginate if needed)
# Extract all domains + emails already in tenant

mkdir -p "pipeline-ferreteria-$(date +%Y%m%d)"

curl -s "$BASE_URL/api/prospects?limit=500" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | {domain: (.email | split("@")[1]), email}' > "pipeline-ferreteria-$(date +%Y%m%d)/00-existing.json"

# Also fetch campaign-specific prospects
curl -s "$BASE_URL/api/campaigns/218adfd3-8390-4f2f-889f-7c889db00738/prospects?limit=500" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | .id' >> "pipeline-ferreteria-$(date +%Y%m%d)/00-campaign-ids.json"

echo "[Step 2] ✓ Dedup: existing prospects cached"
```

### STEP 3 — Segment Selection

```bash
# If --segment provided: use it
# Else auto-rotate: find first segment with <5 existing prospects

SEGMENT="${SEGMENT:-}"

if [ -z "$SEGMENT" ]; then
  # Auto-detect: iterate segments, pick first with <5 prospects
  for seg in ferreterias adjacent platforms chinese other-assoc investors; do
    COUNT=$(grep -c "\"source_segment\": \"$seg\"" "pipeline-ferreteria-$(date +%Y%m%d)/00-existing.json" 2>/dev/null || echo "0")
    if [ "$COUNT" -lt 5 ]; then
      SEGMENT="$seg"
      break
    fi
  done
  SEGMENT="${SEGMENT:-ferreterias}"  # fallback
fi

echo "[Step 3] ✓ Segment selected: $SEGMENT"
```

### STEP 4 — Research (prospect-researcher agent)

Launch `prospect-researcher` agent with segment-specific queries. The agent returns: name, domain, city, tipo_entidad, footprint, segment_tag, source_url.

**Agent call:**
```
Agent: prospect-researcher
Input:
- Query 1: "{segment search query 1}"
- Query 2: "{segment search query 2}"
- Location: Catalunya
- Return fields: name, domain, city, tipo_entidad (ferreteria/distribuidor/asociacion/inversor), footprint_geografico, source_url

Output to: pipeline-ferreteria-{date}/01-raw.json
```

### STEP 5 — Email Scraping (prospect-scraper agent)

On Step 4 results, scrape generic emails: `info@`, `contacto@`, `vendes@`, `comercial@`, `ferreterias@`, `administracion@`.

**Agent call:**
```
Agent: prospect-scraper
Input: companies from 01-raw.json
Output to: pipeline-ferreteria-{date}/02-emails.json
```

### STEP 5.5 — MX Verification (email-verifier agent)

**MANDATORY — never skip**

DNS MX check all domains. Remove `invalid` (NXDOMAIN).

**Agent call:**
```
Agent: email-verifier
Input: domains from 02-emails.json
Output to: pipeline-ferreteria-{date}/02b-verified.json (add `mx_status` field)
```

### STEP 6 — Dedup & Filter

```bash
# Remove any domain/email in 00-existing.json
# Remove entries without email
# Limit to --count (default 15)
# If 0 remain: STOP and report "segment exhausted"

VERIFIED_FILE="pipeline-ferreteria-$(date +%Y%m%d)/02b-verified.json"
DEDUP_FILE="pipeline-ferreteria-$(date +%Y%m%d)/03-deduped.json"
EXISTING_FILE="pipeline-ferreteria-$(date +%Y%m%d)/00-existing.json"

# Dedup logic: keep only entries where domain NOT in EXISTING_FILE and status=verified
jq --slurpfile existing "$EXISTING_FILE" \
  '.[] | select(.mx_status == "verified" and (.email | split("@")[1] as $d | ($existing[] | .domain) | index($d) | not))' \
  "$VERIFIED_FILE" | head -n "$((${COUNT:-15} * 1))" > "$DEDUP_FILE"

N_DEDUP=$(wc -l < "$DEDUP_FILE")
if [ "$N_DEDUP" -eq 0 ]; then
  echo "[Step 6] ✗ STOP: Segment '$SEGMENT' exhausted — no new prospects"
  exit 1
fi

echo "[Step 6] ✓ Deduped: $N_DEDUP prospects → $DEDUP_FILE"
```

### STEP 7a — Enrichment (per company, sequential)

For each company: 2 WebSearch queries + Firecrawl homepage scrape. Extract growth_signals, financial_capacity, geographic_reach, acquisition_appetite.

**Queries** (override defaults in email-generator):
- **Query 1**: `"{company_name} {city} crecimiento expansión apertura establecimiento adquisición 2024 2025 2026"`
- **Query 2**: `"{company_name} {sector} facturación empleados patrimonio empresa familiar traspaso"`

Store results in `enrichment_data` field per prospect.

### STEP 7b — Email Generation (email-generator agent)

For each company, launch `email-generator` agent with:

```json
{
  "prospect": {
    "company": "{name}",
    "email": "{email}",
    "city": "{city}",
    "sector": "{sector}",
    "enrichment_data": "{Step 7a results}"
  },
  "campaign_context": {
    "offer": "Intermediem el traspàs d'una ferreteria de proximitat al Baix Llobregat: 40+ anys, local 400m² en propietat, estoc i clientela consolidats, plantilla subrogable. Preu orientatiu 550.000€. Facturació >400K€. EBITDA ~50K€. Motiu: jubilació.",
    "target_audience": "{segment-specific description}",
    "value_proposition": "{segment-specific angle}",
    "blind_note_rules": "NEVER mention store name. NEVER give exact address or municipality. Only 'Baix Llobregat' as geography. ALWAYS include at least one key figure (550.000€ or >400K€ revenue or 400m² or 40+ years).",
    "research_focus": [
      "{company_name} {city} expansió adquisició obertura establiment 2024 2025 2026",
      "{company_name} facturació empleats patrimoni capacitat financera negoci familiar"
    ],
    "brand_signature": "Alfons Marques\nCamiaCasa\nalfons.marques@camiacasa.cat",
    "cta_type": "dossier",
    "sequence_type": "linear",
    "steps": 3,
    "delay_days": [0, 3, 7]
  },
  "tenant_context": {
    "sender_company": "CamiaCasa",
    "sender_name": "Alfons Marques",
    "industry": "intermediació immobiliària i d'actius comercials",
    "style": "professional, directe, breu, com un SDR experimentat",
    "default_language": "catalan"
  }
}
```

**Output per company**: array of 3 emails (step_number, step_type, subject, body_html, delay_days).

**CRITICAL**: Do NOT edit generated `body_html`. Copy verbatim.

### STEP 7.5 — QA Judge (5 Blocking Dimensions)

For each company's email pack, validate inline with Claude:

| Dimension | Blocking | Criteria |
|-----------|----------|----------|
| `blind_note` | YES | Email never mentions store name, never gives exact address/municipality — only "Baix Llobregat" |
| `key_figures` | YES | At least one key figure present (550.000€ / >400K€ / 400m² / 40 years) |
| `sender_camiacasa` | YES | Signature EXACTLY "Alfons Marques / CamiaCasa" — no accent, no Tecnocim |
| `word_count` | YES | step1: 50-80 words; step2: 50-70; step3: 40-60 |
| `no_unknowns` | YES | No "Unknown", "Batch", `{{var}}`, `%%VAR%%` |

- **Pass**: all OK → next company
- **Fail**: regenerate (max 2 retries with specific feedback)
- **Circuit breaker**: if >30% fail `blind_note` or `sender_camiacasa` → STOP, review template

### STEP 8 — Post-Process: Fix Accent in Signature

Even though email-generator uses `brand_signature` without accents, do a final sweep:

```python
import json

for prospect_id, emails in email_packs.items():
    for email in emails:
        html = email['body_html']
        html = html.replace("Alfons Marquès", "Alfons Marques")
        html = html.replace("Alfons Marqués", "Alfons Marques")
        html = html.replace("Tecnocim Innova", "CamiaCasa")
        email['body_html'] = html
        
        # Add source_segment to enrichment_data
        if 'enrichment_data' not in prospect_data[prospect_id]:
            prospect_data[prospect_id]['enrichment_data'] = {}
        prospect_data[prospect_id]['enrichment_data']['source_segment'] = SEGMENT
```

### STEP 9 — Bulk Import (File-based, UTF-8 Safe)

1. **Create prospects first** (so we get IDs):
   ```bash
   for company in $(jq -r '.[] | @base64' "pipeline-ferreteria-$(date +%Y%m%d)/03-deduped.json"); do
     _jq() {
       echo ${company} | base64 --decode | jq -r ${1}
     }
     
     curl -s -X POST "$BASE_URL/api/prospects" \
       -H "Authorization: Bearer $TOKEN" \
       -H "Content-Type: application/json" \
       -d "{\"company\": \"$(_jq '.company')\", \"email\": \"$(_jq '.email')\", \"city\": \"$(_jq '.city')\", \"sector\": \"$(_jq '.sector')\", \"enrichment_data\": $(_jq '.enrichment_data')}" \
       | jq '.data.id' >> "pipeline-ferreteria-$(date +%Y%m%d)/prospect-ids.txt"
   done
   ```

2. **Construct payload** with returned IDs:
   ```python
   # payload = {
   #   "emails": [
   #     {"prospect_id": "...", "step_number": 1, "subject": "...", "body_html": "..."},
   #     ...
   #   ]
   # }
   
   with open('/tmp/ferreteria_bulk_payload.json', 'w', encoding='utf-8') as f:
     json.dump(payload, f, ensure_ascii=False)
   ```

3. **Upload via curl**:
   ```bash
   curl -s -X POST "$BASE_URL/api/campaigns/218adfd3-8390-4f2f-889f-7c889db00738/bulk-insert-emails" \
     -H "Authorization: Bearer $TOKEN" \
     --data-binary @/tmp/ferreteria_bulk_payload.json \
     -H "Content-Type: application/json" > "pipeline-ferreteria-$(date +%Y%m%d)/import-response.json"
   ```

4. **Verify response**:
   ```bash
   SUCCESS=$(jq '.success' "pipeline-ferreteria-$(date +%Y%m%d)/import-response.json")
   INSERTED=$(jq '.data.total_inserted' "pipeline-ferreteria-$(date +%Y%m%d)/import-response.json")
   
   if [ "$SUCCESS" != "true" ]; then
     echo "[Step 9] ✗ STOP: Bulk insert failed"
     exit 1
   fi
   
   if [ "$INSERTED" != "$((N_DEDUP * 3))" ]; then
     echo "[Step 9] ✗ STOP: Inserted count mismatch (expected $((N_DEDUP * 3)), got $INSERTED)"
     exit 1
   fi
   ```

### STEP 10 — Verify prospect_ids (CRITICAL)

```bash
# GET /api/campaigns/218adfd3.../generated-emails?status=draft&limit=200
# Confirm the newly created prospect_ids appear

curl -s "$BASE_URL/api/campaigns/218adfd3-8390-4f2f-889f-7c889db00738/generated-emails?status=draft&limit=200" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | .prospect_id' > "pipeline-ferreteria-$(date +%Y%m%d)/generated-prospect-ids.txt"

# Cross-check against prospect-ids.txt
MISSING=$(comm -23 <(sort "pipeline-ferreteria-$(date +%Y%m%d)/prospect-ids.txt") <(sort "pipeline-ferreteria-$(date +%Y%m%d)/generated-prospect-ids.txt"))

if [ -n "$MISSING" ]; then
  echo "[Step 10] ✗ STOP: Missing prospect_ids in generated-emails: $MISSING"
  echo "This is a known platform bug: API returns success=true with mismatched IDs."
  exit 1
fi

echo "[Step 10] ✓ Verified: all prospect_ids appear in generated-emails"
```

### STEP 11 — Leave in DRAFT (No Auto-Approve)

**Do NOT auto-approve.** Emails remain in `draft` status.

- **Reason**: M&A blind-note requires manual review before sending (sensitive outreach)
- **User action**: Review in UI at `https://abm.tecnociminnova.com/campaigns/218adfd3-8390-4f2f-889f-7c889db00738`
- **To approve manually**: `POST /api/campaigns/218adfd3-8390-4f2f-889f-7c889db00738/approve-emails` with email_ids from Step 10
- **Warmup when approved**: 20 emails/day ferretería (within 35/day CamiaCasa limit shared with investors), Mon-Fri 9-11h Madrid

### STEP 12 — Report

```
=== /auto-prospect-ferreteria — Result ===

Segment: {segment}
Companies found: {n_found}
Companies deduplicated: {n_dedup}
Emails generated (3 steps × company): {n_emails}
QA pass rate: {n_pass}/{n_total} ({pct}%)
Emails imported (draft): {n_inserted}

Timeline:
- First send (estimated): {date_start}
- Last send (estimated): {date_end}

📧 Campaign link: https://abm.tecnociminnova.com/campaigns/218adfd3-8390-4f2f-889f-7c889db00738
✓ Emails in DRAFT — review + approve from UI above

Next segment to work: {next_segment}

Files saved to: pipeline-ferreteria-{date}/
```

---

## Critical Lessons Applied

| Lesson | Applied in |
|--------|-----------|
| `POST /outbox/bulk-approve` doesn't activate campaign | Never used; emails stay DRAFT for review |
| Verify prospect_ids BEFORE approve | Step 10 explicit verification |
| API returns `success=true` with wrong IDs | Step 10 checks `total_inserted == expected` |
| Windows curl re-encodes UTF-8 | Step 9 uses `--data-binary @file.json` (never `-d "$variable"`) |
| "Alfons Marquès" corrupts in email clients | Step 8 post-process, brand_signature has no accent |
| Brand mismatch (Tecnocim vs CamiaCasa) | Auth always `camiacasa` slug, Step 8 replaces leftover "Tecnocim" |
| Token mismanagement | Separate token file `tmp_auth_cc.txt` (not `tmp_token.txt`) |
| Segment exhaustion | Step 6 stops with clear message if 0 new prospects |
| Rate limiting in enrichment | Step 7a processes sequentially, 1 company at a time |

---

## Testing Checklist

Run: `/auto-prospect-ferreteria --segment ferreterias --count 3` (small test batch)

Verify in UI (`https://abm.tecnociminnova.com/campaigns/218adfd3-8390-4f2f-889f-7c889db00738`):

- [ ] 3 new prospects appear (not duplicates of the 11 existing)
- [ ] 9 emails appear in `draft` status (3 steps × 3 companies)
- [ ] Signature: "Alfons Marques / CamiaCasa" (no accent, no Tecnocim)
- [ ] First email contains key figure (550K€ or equivalent)
- [ ] No email mentions store name, exact address, or municipality
- [ ] All 9 emails have word counts within spec (50-80 / 50-70 / 40-60)
- [ ] No "Unknown", "Batch", template variables, or other blockers in body
