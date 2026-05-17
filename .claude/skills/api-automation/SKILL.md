---
name: api-automation
description: Patterns for calling the ABM platform API via curl from Claude Code commands. Authentication, token caching, error handling, and curl templates for every endpoint.
triggers: ["api call", "curl", "login", "token", "authenticate", "import csv", "create campaign", "bulk insert", "approve emails", "send emails", "api automation"]
---

# API Automation Skill

All ABM platform operations MUST use curl via Bash, NOT browser automation. This skill documents every pattern needed.

## Authentication

### Login and get JWT token

```bash
# Determine base URL
BASE="${ABM_BASE_URL:-https://abm.tecnociminnova.com}"
SLUG="${ABM_TENANT_SLUG:-tecnocim}"

# Get credentials — if ABM_EMAIL or ABM_PASSWORD not set, ask the user via AskUserQuestion
EMAIL="${ABM_EMAIL}"
PASS="${ABM_PASSWORD}"

# Login — IMPORTANT: use printf to pipe JSON body to curl, NEVER use -d with passwords
# containing special chars like ! (bash history expansion corrupts them)
TOKEN=$(printf '{"email":"%s","password":"%s","tenant_slug":"%s"}' "$EMAIL" "$PASS" "$SLUG" \
  | curl -s -X POST "${BASE}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d @- \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);process.stdout.write(r.data?.token||'')}catch(e){}})")

# Validate
if [ -z "$TOKEN" ]; then
  echo "ERROR: Login failed. Check credentials."
  exit 1
fi
echo "Authenticated OK"
```

### JSON parsing helper (Windows-compatible, no jq needed)

```bash
# Extract a field from JSON response
parse_json_field() {
  local field="$1"
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);const v=field.split('.').reduce((o,k)=>o?.[k],r);process.stdout.write(String(v??''))}catch(e){}})" -- "$field"
}

# Usage: echo '{"data":{"id":"abc"}}' | parse_json_field "data.id"
# For nested: echo '{"data":{"token":"xyz"}}' | parse_json_field "data.token"
```

**Note**: Use `node -e` for ALL JSON parsing. `jq` is not reliably available on Windows Git Bash.

## Standard Headers

```bash
AUTH="-H \"Authorization: Bearer ${TOKEN}\""
JSON="-H \"Content-Type: application/json\""
```

For readability in commands, use this pattern:

```bash
curl -s -X GET "${BASE}/api/prospects" \
  -H "Authorization: Bearer ${TOKEN}"
```

## Error Handling

### Check HTTP status code

```bash
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${BASE}/api/endpoint" \
  -H "Authorization: Bearer ${TOKEN}")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

case $HTTP_CODE in
  200|201) echo "OK" ;;
  401) echo "Token expired, re-login needed" ;;
  404) echo "Resource not found" ;;
  429) echo "Rate limited, wait and retry" ;;
  5*) echo "Server error, retry" ;;
  *) echo "Error: HTTP $HTTP_CODE" ;;
esac
```

### Retry logic (transient errors only)

Retry on 429 (rate limit) and 5xx (server error). Do NOT retry on 400/401/404.

```bash
# Retry pattern: max 3 attempts, exponential backoff
for attempt in 1 2 3; do
  RESPONSE=$(curl -s -w "\n%{http_code}" ...)
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  if [[ "$HTTP_CODE" =~ ^(200|201)$ ]]; then break; fi
  if [[ "$HTTP_CODE" =~ ^(429|5[0-9][0-9])$ ]]; then
    sleep $((attempt * 2))
  else
    break  # Don't retry client errors
  fi
done
```

## Idempotency

Before creating resources, check if they already exist:

```bash
# Check if campaign exists by name
EXISTING=$(curl -s "${BASE}/api/campaigns?search=MyCampaign" \
  -H "Authorization: Bearer ${TOKEN}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);const c=r.data?.campaigns?.find(c=>c.name==='MyCampaign');process.stdout.write(c?.id||'')})")

if [ -n "$EXISTING" ]; then
  CAMPAIGN_ID="$EXISTING"
  echo "Campaign already exists: $CAMPAIGN_ID"
else
  # Create new
fi
```

## Endpoint Templates

### Imports (CSV Upload)

```bash
# 1. Upload CSV file
UPLOAD_RESULT=$(curl -s -X POST "${BASE}/api/imports/upload" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F "file=@scripts/output/prospects.csv")
IMPORT_ID=$(echo "$UPLOAD_RESULT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);process.stdout.write(r.data?.import_id||'')})")

# 2. Map columns and execute import
MAP_RESULT=$(curl -s -X POST "${BASE}/api/imports/${IMPORT_ID}/map" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "column_mapping": {
      "email": "email",
      "first_name": "first_name",
      "company_name": "company_name",
      "domain": "domain",
      "industry": "industry",
      "city": "city",
      "region": "region",
      "country": "country"
    },
    "default_tags": ["tag1", "tag2"]
  }')
echo "$MAP_RESULT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);console.log('Imported:',r.data?.imported,'Skipped:',r.data?.skipped,'Errors:',r.data?.errors)})"
```

### Campaigns

```bash
# Create campaign
CAMPAIGN_RESULT=$(curl -s -X POST "${BASE}/api/campaigns" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Campaign Name",
    "description": "Description",
    "campaign_type": "outbound",
    "status": "draft"
  }')
CAMPAIGN_ID=$(echo "$CAMPAIGN_RESULT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);process.stdout.write(r.data?.id||r.data?.campaign?.id||'')})")

# Add prospects to campaign
curl -s -X POST "${BASE}/api/campaigns/${CAMPAIGN_ID}/prospects" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"prospect_ids": ["uuid1", "uuid2"]}'

# List generated emails
curl -s "${BASE}/api/campaigns/${CAMPAIGN_ID}/generated-emails?status=draft" \
  -H "Authorization: Bearer ${TOKEN}"

# Bulk insert Claude-generated emails (bypasses Gemini)
curl -s -X POST "${BASE}/api/campaigns/${CAMPAIGN_ID}/bulk-insert-emails" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "emails": [
      {
        "prospect_id": "uuid",
        "step_number": 1,
        "subject": "Subject line",
        "body_html": "<p>Email body</p>",
        "delay_days": 0
      }
    ]
  }'

# Approve emails (draft -> scheduled)
curl -s -X POST "${BASE}/api/campaigns/${CAMPAIGN_ID}/approve-emails" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"email_ids": ["email-uuid1", "email-uuid2"]}'

# Campaign metrics
curl -s "${BASE}/api/campaigns/${CAMPAIGN_ID}/metrics" \
  -H "Authorization: Bearer ${TOKEN}"
```

### Prospects

```bash
# Search prospects (by tag, name, email, etc.)
curl -s "${BASE}/api/prospects?search=deducciones-idi&limit=100" \
  -H "Authorization: Bearer ${TOKEN}"

# Get single prospect (with enrichment_data, company, tags)
curl -s "${BASE}/api/prospects/${PROSPECT_ID}" \
  -H "Authorization: Bearer ${TOKEN}"

# Create prospect
curl -s -X POST "${BASE}/api/prospects" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "info@company.es",
    "first_name": "Contacto",
    "company_name": "Company SL",
    "source": "web_prospecting",
    "city": "Barcelona",
    "region": "Catalunya",
    "country": "Spain"
  }'

# Update prospect (enrichment_data, notes, company_name)
curl -s -X PUT "${BASE}/api/prospects/${PROSPECT_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"enrichment_data": {"employees": 50, "revenue": "5M"}, "notes": "Tier A"}'

# Trigger enrichment (Gemini/Perplexity/Firecrawl)
curl -s -X POST "${BASE}/api/prospects/${PROSPECT_ID}/enrich" \
  -H "Authorization: Bearer ${TOKEN}"

# Recalculate lead score
curl -s -X POST "${BASE}/api/prospects/${PROSPECT_ID}/recalculate-score" \
  -H "Authorization: Bearer ${TOKEN}"
```

### Sequences

```bash
# Create sequence
SEQ_RESULT=$(curl -s -X POST "${BASE}/api/sequences" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sequence Name",
    "campaign_id": "'${CAMPAIGN_ID}'",
    "from_email": "alfons@tecnocim.com",
    "from_name": "Alfons Marques",
    "reply_to": "alfons@tecnocim.com",
    "send_window": {"days":[1,2,3,4,5],"start_hour":9,"end_hour":17,"timezone":"Europe/Madrid"},
    "settings": {"stop_on_reply":true,"stop_on_bounce":true,"daily_limit":25}
  }')
SEQ_ID=$(echo "$SEQ_RESULT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);process.stdout.write(r.data?.id||r.data?.sequence?.id||'')})")

# Add steps
curl -s -X POST "${BASE}/api/sequences/${SEQ_ID}/steps" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "steps": [
      {"step_number":1,"step_type":"email","subject":"Subject","body_html":"<p>Body</p>","delay_days":0},
      {"step_number":2,"step_type":"condition","condition_config":{"type":"opened","threshold_hours":72},"delay_days":3},
      {"step_number":3,"step_type":"email","subject":"Follow-up","body_html":"<p>Follow</p>","delay_days":2}
    ]
  }'

# Wire branching (condition -> yes/no targets)
curl -s -X POST "${BASE}/api/sequences/${SEQ_ID}/wire-steps" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "wiring": [
      {"step_id":"CONDITION_STEP_UUID","yes_next_step_id":"YES_STEP_UUID","no_next_step_id":"NO_STEP_UUID"}
    ]
  }'

# Enroll prospects
curl -s -X POST "${BASE}/api/sequences/${SEQ_ID}/enroll" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"prospect_ids": ["uuid1", "uuid2"]}'

# View graph structure
curl -s "${BASE}/api/sequences/${SEQ_ID}/graph" \
  -H "Authorization: Bearer ${TOKEN}"
```

### Outbox (Email Sending)

```bash
# List scheduled emails
curl -s "${BASE}/api/outbox?status=scheduled&limit=100" \
  -H "Authorization: Bearer ${TOKEN}"

# Outbox stats
curl -s "${BASE}/api/outbox/stats" \
  -H "Authorization: Bearer ${TOKEN}"

# Redistribute emails across business days (warmup-aware, Mon-Fri only)
# By campaign:
curl -s -X POST "${BASE}/api/outbox/redistribute" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"campaign_id": "'${CAMPAIGN_ID}'"}'
# All scheduled emails:
curl -s -X POST "${BASE}/api/outbox/redistribute" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

> **IMPORTANT**: Do NOT use `POST /api/outbox/send` for batch sending.
> It is blocked on weekends and bypasses warmup scheduling.
> Use the approve flow instead — the scheduler sends automatically every 2 min.

### Campaign Launch (Weekend-Safe Workflow)

The correct flow for creating and launching a campaign via Claude Code:

```bash
# 1. Approve emails (auto-distributes across Mon-Fri, respects warmup)
curl -s -X POST "${BASE}/api/campaigns/${CAMPAIGN_ID}/approve-emails" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"email_ids\": ${EMAIL_IDS_JSON}}"
# This automatically:
# - Distributes across business days only (never weekends)
# - Respects tenant warmup daily limit
# - Sets optimal send time per prospect timezone (9-11h local)
# - Activates the campaign if still in draft
# - The scheduler sends at the scheduled times (every 2 min, Mon-Fri)
```

### Users

```bash
# Create user
curl -s -X POST "${BASE}/api/users" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@tecnocim.com",
    "password": "SecurePass123!",
    "first_name": "Maria",
    "last_name": "Garcia",
    "role": "member",
    "sender_email": "maria@tecnocim.com",
    "sender_name": "Maria Garcia"
  }'

# List users
curl -s "${BASE}/api/users" \
  -H "Authorization: Bearer ${TOKEN}"
```

### Dashboard

```bash
# Key metrics
curl -s "${BASE}/api/dashboard/stats?date_from=2026-01-01&date_to=2026-12-31" \
  -H "Authorization: Bearer ${TOKEN}"
```

## IMPORTANT: Never Use Browser for API Operations

All operations above MUST use curl via Bash. Do NOT use:
- `mcp__claude-in-chrome__javascript_tool` for API calls
- `localStorage.getItem('token')` for authentication
- `fetch()` in browser context for CRUD operations

Browser automation is ONLY appropriate for:
- Website scraping during prospecting (Playwright)
- LinkedIn automation (`/warm-prospects`)
- Visual testing and debugging
