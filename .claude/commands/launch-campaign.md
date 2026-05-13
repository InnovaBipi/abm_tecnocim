---
name: launch-campaign
description: End-to-end campaign orchestrator. Imports CSV, creates campaign, generates personalized emails with Claude, approves, and optionally sends. All via curl API calls.
arguments:
  - name: csv_path
    description: "Path to CSV file with prospects, or 'latest' for most recent in scripts/output/"
    required: true
  - name: campaign_name
    description: "Campaign name (e.g., 'Deducciones I+D+i Q2 2026')"
    required: true
  - name: campaign_context
    description: "What the campaign offers, for email personalization (e.g., 'Consultoria deducciones fiscales I+D+i para PYMES industriales')"
    required: true
user_facing: true
---

# Launch Campaign

End-to-end campaign lifecycle: CSV -> Import -> Campaign -> Emails -> Approve.

**Skill reference**: Follow `.claude/skills/api-automation/SKILL.md` for ALL API calls. Never use browser automation.

## Step 1: Authenticate via curl

```bash
BASE="${ABM_BASE_URL:-https://abm.tecnociminnova.com}"
SLUG="${ABM_TENANT_SLUG:-tecnocim}"
```

If `ABM_EMAIL` or `ABM_PASSWORD` are not set, ask the user via AskUserQuestion.

```bash
TOKEN=$(curl -s -X POST "${BASE}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ABM_EMAIL}\",\"password\":\"${ABM_PASSWORD}\",\"tenant_slug\":\"${SLUG}\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);process.stdout.write(r.data?.token||'')}catch(e){}})")
```

Validate token is not empty.

## Step 2: Resolve CSV path

If `csv_path` is "latest", find the most recent CSV in `scripts/output/`:
```bash
CSV_FILE=$(ls -t scripts/output/prospects-*.csv 2>/dev/null | head -1)
```

Read the CSV to count rows and verify headers.

## Step 3: Import CSV

```bash
# Upload
UPLOAD_RESULT=$(curl -s -X POST "${BASE}/api/imports/upload" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F "file=@${CSV_FILE}")
IMPORT_ID=$(echo "$UPLOAD_RESULT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);process.stdout.write(r.data?.import_id||'')})")

# Map columns (standard names from prospect-compiler output)
MAP_RESULT=$(curl -s -X POST "${BASE}/api/imports/${IMPORT_ID}/map" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "column_mapping": {
      "email":"email","first_name":"first_name","company_name":"company_name",
      "domain":"domain","industry":"industry","city":"city",
      "region":"region","country":"country"
    },
    "default_tags": ["campaign-TAG"]
  }')
```

Report: X imported, Y skipped, Z errors.

## Step 4: Create campaign

Check if campaign already exists (idempotency):
```bash
EXISTING=$(curl -s "${BASE}/api/campaigns?search=${CAMPAIGN_NAME}" \
  -H "Authorization: Bearer ${TOKEN}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);const c=(r.data?.campaigns||[]).find(c=>c.name===process.argv[1]);process.stdout.write(c?.id||'')})" -- "${CAMPAIGN_NAME}")
```

If not found, create:
```bash
CAMPAIGN_RESULT=$(curl -s -X POST "${BASE}/api/campaigns" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${CAMPAIGN_NAME}\",\"description\":\"${CAMPAIGN_CONTEXT}\",\"campaign_type\":\"outbound\",\"status\":\"draft\"}")
CAMPAIGN_ID=$(echo "$CAMPAIGN_RESULT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);process.stdout.write(r.data?.id||r.data?.campaign?.id||'')})")
```

## Step 5: Add prospects to campaign

Search for recently imported prospects:
```bash
PROSPECTS=$(curl -s "${BASE}/api/prospects?search=campaign-TAG&limit=200" \
  -H "Authorization: Bearer ${TOKEN}")
```

Extract prospect IDs, then add to campaign:
```bash
curl -s -X POST "${BASE}/api/campaigns/${CAMPAIGN_ID}/prospects" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"prospect_ids":["id1","id2",...]}'
```

## Step 6: Generate emails with Claude

For each prospect:
1. Fetch full prospect data: `curl GET /api/prospects/:id`
2. Use WebSearch to find recent news/projects about the company
3. Generate a personalized email following the email-generator agent rules:
   - 60-100 words, professional tone, no salesy language
   - Specific references to company activities/projects
   - Clear CTA (call, meeting, question)
   - Correct language (Catalan for Catalunya, Spanish otherwise)
   - Subject: 5-7 words, under 40 chars

Process in batches: launch up to 3 email-generator agents in parallel (30 companies per agent).

## Step 7: Bulk insert emails

Collect all generated emails and insert via curl in batches of 25:
```bash
curl -s -X POST "${BASE}/api/campaigns/${CAMPAIGN_ID}/bulk-insert-emails" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"emails":[
    {"prospect_id":"...","step_number":1,"subject":"...","body_html":"...","delay_days":0},
    ...
  ]}'
```

## Step 8: QA check

List all draft emails:
```bash
DRAFTS=$(curl -s "${BASE}/api/campaigns/${CAMPAIGN_ID}/generated-emails?status=draft" \
  -H "Authorization: Bearer ${TOKEN}")
```

Show summary table to the user:

| # | Prospect | Company | Language | Subject | Words |
|---|----------|---------|----------|---------|-------|
| 1 | Contact  | Company | es/ca    | Subject | 85    |

Report totals and any issues found (subject too long, body too short, etc.).

## Step 9: Approve

Ask the user: "Approve all X emails for scheduling?"

If yes:
```bash
# Collect all draft email IDs
curl -s -X POST "${BASE}/api/campaigns/${CAMPAIGN_ID}/approve-emails" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"email_ids":["id1","id2",...]}'
```

Report: X emails scheduled. The platform scheduler will send them during the configured send window (Mon-Fri 9-17h Madrid), respecting warm-up limits.

## Step 10: Report

```
Campaign Launched
=================
Campaign:        CAMPAIGN_NAME (CAMPAIGN_ID)
Prospects:       X imported, Y added to campaign
Emails:          Z generated, W approved (scheduled)
Send window:     Mon-Fri 9-17h Europe/Madrid
Daily limit:     25 (warm-up)
First sends:     Next business day

Platform URL:    https://abm.tecnociminnova.com/campaigns/CAMPAIGN_ID

Next Steps:
  1. Monitor open/click rates in Dashboard
  2. Run /warm-prospects for LinkedIn social warming
  3. Check replies in Outbox > Replies
```

## Notes

- ALL operations use curl via Bash. NO browser automation required.
- Emails are generated by Claude (not Gemini) with company-specific web research.
- The platform scheduler handles actual sending (warm-up limits, send window, suppression checks).
- Re-running this command is safe: it checks for existing campaigns/prospects before creating duplicates.
