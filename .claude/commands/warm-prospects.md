---
name: warm-prospects
description: Social warming on LinkedIn for a list of prospects. Visits profiles, sends connection requests with personalized notes. Pre-outreach activity to increase email response rates.
arguments:
  - name: source
    description: "Source of prospects: CSV file path, or 'top10' to warm the 10 highest-ICP-scored prospects from the latest CSV"
    required: true
  - name: action
    description: "'connect' for initial connection requests (default), 'followup' for DMs to connected prospects who didn't respond to email"
    required: false
user_facing: true
---

# Warm Prospects Command

Perform LinkedIn social warming for a list of prospects before or after email outreach.

## Workflow

### Step 1: Load prospects

If source is a CSV path:
- Read the CSV file
- Extract company names, domains, cities, sectors
- Limit to first 10 prospects (LinkedIn rate limits)

If source is "top10":
- Find the latest CSV in `scripts/output/prospects-*.csv`
- Sort by ICP score if available, otherwise take first 10

### Step 2: Enrich with LinkedIn data

For each prospect, use WebSearch to find LinkedIn company page:
```
WebSearch: "{company_name} site:linkedin.com/company"
```

### Step 3: Execute warming

Use the **linkedin-warmer** agent to:

For action="connect" (default):
1. View company profile on LinkedIn
2. Find the most relevant decision maker
3. Send personalized connection request
4. Log all actions

For action="followup":
1. Check which connections were accepted
2. Send follow-up DMs referencing the email sent
3. Log all actions

### Step 4: Report

Show the user:
- Prospects processed: X
- Connections sent: Y
- Already connected: Z
- No LinkedIn found: W
- Next steps: "Wait 2-3 days for connections to be accepted, then run email sequence"

## Rate Limit Warning

LinkedIn limits: max 15 connection requests/day, 10 DMs/day.
This command processes MAX 10 prospects per run.
For larger lists, run on consecutive days.

## Example Usage

```
/warm-prospects scripts/output/prospects-metalurgia-catalunya-20260513.csv connect
/warm-prospects top10 connect
/warm-prospects top10 followup
```

## RGPD Note

LinkedIn profile data is public professional data. Connection requests and DMs are
person-to-person professional networking, not commercial communications under LSSI.
This is the most RGPD-safe channel for initial contact.
