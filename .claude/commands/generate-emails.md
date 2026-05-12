---
name: generate-emails
description: Generate campaign emails using Claude instead of Gemini. Bypasses Gemini rate limits.
arguments:
  - name: campaign
    description: "Campaign ID or name (default: first active campaign)"
    required: false
user_facing: true
---

# Generate Campaign Emails with Claude

You are a world-class B2B email strategist. Generate personalized outreach emails for an ABM campaign, bypassing Gemini entirely.

## Step 1: Load browser tools and get tab context

Use `mcp__claude-in-chrome__tabs_context_mcp` to find the ABM platform tab (abm.tecnociminnova.com or localhost). If no tab is open, ask the user to open the platform first.

## Step 2: Fetch all data via browser JS

Execute JavaScript on the ABM tab to fetch campaign, prospects, and existing emails in one call:

```javascript
(async () => {
  const token = localStorage.getItem('token');
  const h = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Find campaign
  const campsRes = await fetch('/api/campaigns?limit=100', { headers: h }).then(r => r.json());
  const campaigns = campsRes.data?.campaigns || [];
  // Use argument $ARGUMENTS.campaign if provided (match by ID or name), otherwise first active
  const camp = campaigns.find(c => c.id === '$ARGUMENTS.campaign' || c.name?.includes('$ARGUMENTS.campaign')) || campaigns[0];
  if (!camp) return JSON.stringify({ error: 'No campaigns found' });

  // Fetch campaign emails
  const emailsRes = await fetch(`/api/campaigns/${camp.id}/generated-emails`, { headers: h }).then(r => r.json());
  const emails = emailsRes.data?.emails || [];

  // Fetch each prospect's full data
  const prospectIds = [...new Set(emails.map(e => e.prospect_id))];
  const prospects = [];
  for (const pid of prospectIds) {
    const pRes = await fetch(`/api/prospects/${pid}`, { headers: h }).then(r => r.json());
    prospects.push(pRes.data);
  }

  return JSON.stringify({ campaign: camp, emails, prospects }, null, 2);
})();
```

Parse the result and extract: campaign details, existing emails (with their IDs), and prospect data (including enrichment_data, company info, city/region/country).

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

**OUTPUT FORMAT**: For each prospect, produce:
```json
{
  "emailId": "<existing generated_email ID>",
  "subject": "...",
  "body_html": "<p>...</p>"
}
```

## Step 5: Save each email via browser JS

For each generated email, execute:

```javascript
(async () => {
  const token = localStorage.getItem('token');
  const h = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  const campId = '<CAMPAIGN_ID>';

  const res = await fetch(`/api/campaigns/${campId}/generated-emails/<EMAIL_ID>`, {
    method: 'PUT',
    headers: h,
    body: JSON.stringify({ subject: '<SUBJECT>', body_html: '<BODY_HTML>' })
  }).then(r => r.json());

  return JSON.stringify(res);
})();
```

## Step 6: Report

After saving all emails, show a summary table:

| Prospect | Language | Subject | Status |
|----------|----------|---------|--------|
| Name     | ca/es    | Subject | Saved/Error |

Note: Emails are saved as 'draft'. The user must approve them from the campaign UI or via `/audit-emails` before sending.
