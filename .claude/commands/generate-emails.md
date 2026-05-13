---
name: generate-emails
description: Generate campaign emails using Claude instead of Gemini. Bypasses Gemini rate limits. Uses curl API calls (no browser needed).
arguments:
  - name: campaign
    description: "Campaign ID or name (default: first active campaign)"
    required: false
user_facing: true
---

# Generate Campaign Emails with Claude

You are a world-class B2B email strategist. Generate personalized outreach emails for an ABM campaign using curl API calls.

**Skill reference**: Follow `.claude/skills/api-automation/SKILL.md` for all API calls.

## Step 1: Authenticate via curl

```bash
BASE="${ABM_BASE_URL:-https://abm.tecnociminnova.com}"
SLUG="${ABM_TENANT_SLUG:-tecnocim}"
```

If `ABM_EMAIL` or `ABM_PASSWORD` are not set, ask the user via AskUserQuestion for their email and password.

```bash
TOKEN=$(curl -s -X POST "${BASE}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ABM_EMAIL}\",\"password\":\"${ABM_PASSWORD}\",\"tenant_slug\":\"${SLUG}\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);process.stdout.write(r.data?.token||'')}catch(e){}})")
```

If TOKEN is empty, tell the user login failed and stop.

## Step 2: Fetch campaign and prospect data via curl

```bash
# List campaigns
CAMPAIGNS=$(curl -s "${BASE}/api/campaigns?limit=100" \
  -H "Authorization: Bearer ${TOKEN}")
```

Parse the response to find the campaign (match by ID or name using `$ARGUMENTS.campaign`, or use the first active one).

```bash
# Fetch generated emails for the campaign
EMAILS=$(curl -s "${BASE}/api/campaigns/${CAMPAIGN_ID}/generated-emails" \
  -H "Authorization: Bearer ${TOKEN}")
```

For each unique prospect_id in the emails, fetch full prospect data:

```bash
# Fetch prospect with enrichment_data, company, tags
PROSPECT=$(curl -s "${BASE}/api/prospects/${PROSPECT_ID}" \
  -H "Authorization: Bearer ${TOKEN}")
```

Parse and collect: campaign details, existing emails (with IDs), prospect data (enrichment_data, company info, city/region/country).

## Step 3: Resolve language per prospect

Apply these rules for each prospect:

**CATALAN** if any of these match (case-insensitive):
- city: Barcelona, Girona, Lleida, Tarragona, Sabadell, Terrassa, Badalona, Sant Cugat, Manresa, Vic, Reus, Mataro, Figueres, Granollers, Igualada, Vilafranca, Hospitalet, Cornella, Sant Boi, Vilanova, Sitges, Calella, Blanes, Olot, Berga, Ripoll, Solsona, Seu d'Urgell, Valls, Tortosa, Amposta, Cervera
- region contains: Catalunya, Cataluna, Catalonia, Illes Balears, Pais Valencia, Comunitat Valenciana

**SPANISH** otherwise (default for Tecnocim tenant).

## Step 4: Generate emails

For EACH prospect that has an existing generated_email, generate a replacement email.

### Email generation rules

You ARE the LLM generating these emails. Follow these rules exactly:

**IDENTITY**: You write as the tenant's sender (typically found in campaign/tenant data — for Tecnocim: Alfons Marques from Tecnocim).

**LANGUAGE**: Write the ENTIRE email (subject AND body) in the resolved language:
- Catalan: Use "Hola", "Bon dia", "Salutacions", "Atentament". Natural Catalan grammar.
- Spanish: Use "Hola", "Buenos dias", "Saludos cordiales". Natural Spanish grammar.

**CONTENT RULES**:
1. DO NOT write generic emails. Use enrichment data (suggested_use_cases, pain_points, key_insights) for SPECIFIC connections.
2. Reference the prospect's actual company, activities, industry, market position.
3. Tone: professional, concise, knowledgeable. No salesy language. No exclamation marks. Sound like a peer.
4. BREVITY: 60-100 words MAX per email body.
5. SUBJECT: 5-7 words max, under 40 characters. Short, intriguing, specific.
6. Include a clear CTA (call, meeting, question).
7. Never use "Re:" fake prefixes. Never include "P.S." sections.
8. Sender signs as [sender_name] from [company_name] with website domain.

**STRUCTURE per prospect**:
- If generating 1 email (step 1): Personal connection + specific use case relevant to their business.
- If generating 4 emails: (1) Personal + use case, (2) Value/data deep dive, (3) Social proof/urgency, (4) Soft close.

## Step 5: Save emails via curl

For each generated email, update via PUT or bulk insert:

**Option A: Update existing emails**
```bash
curl -s -X PUT "${BASE}/api/campaigns/${CAMPAIGN_ID}/generated-emails/${EMAIL_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"subject":"...","body_html":"..."}'
```

**Option B: Bulk insert new emails (if no existing drafts)**
```bash
curl -s -X POST "${BASE}/api/campaigns/${CAMPAIGN_ID}/bulk-insert-emails" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"emails":[{"prospect_id":"...","step_number":1,"subject":"...","body_html":"...","delay_days":0}]}'
```

Process in batches of 20-30 emails per curl call to avoid timeouts.

## Step 6: Auto-approve (optional)

Ask the user: "Approve all generated emails for sending?"

If yes:
```bash
# Get all draft email IDs
DRAFTS=$(curl -s "${BASE}/api/campaigns/${CAMPAIGN_ID}/generated-emails?status=draft" \
  -H "Authorization: Bearer ${TOKEN}")
# Extract IDs, then approve
curl -s -X POST "${BASE}/api/campaigns/${CAMPAIGN_ID}/approve-emails" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"email_ids":["id1","id2",...]}'
```

## Step 7: Report

Show a summary table:

| Prospect | Company | Language | Subject | Status |
|----------|---------|----------|---------|--------|
| Name     | Company | ca/es    | Subject | Saved/Error |

Report totals: X emails generated, Y saved, Z errors.
Note: If not auto-approved, emails are in 'draft' status. Run `/audit-emails` or approve manually.
