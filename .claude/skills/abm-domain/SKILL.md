---
name: abm-domain
description: Account-Based Marketing domain knowledge including entities, workflows, scoring, and campaign lifecycle
triggers: ["prospects", "campaigns", "sequences", "outbox", "scoring", "ABM", "account-based", "lead", "pipeline", "enrichment", "warm-up"]
---

# ABM Domain Knowledge

## What is ABM?

Account-Based Marketing (ABM) is a B2B strategy that focuses marketing and sales resources on a targeted set of accounts (companies), using personalized campaigns to engage specific prospects within those accounts.

## Entity Model

```
Tenants (config holder)
  └── Companies (target accounts)
        ├── Tier: A/B/C/D (priority ranking)
        ├── account_score (0-100)
        └── Prospects (contacts within companies)
              ├── lead_score (0-100)
              ├── status lifecycle (see below)
              └── Tags (flexible categorization)

Campaigns (one per asset/program/service)
  ├── campaign_type: outbound | nurture | reactivation
  ├── status: draft | active | paused | completed | archived
  └── Email Sequences
        ├── Sequence Steps (individual email templates)
        └── Enrollments (prospect in sequence)
              └── Email Events (sent, opened, clicked, replied, bounced)

Generated Emails (per-prospect personalized versions)
  └── status: draft | approved | scheduled | sent | opened | replied | bounced
```

## Prospect Lifecycle

```
new → enriched → qualified → contacted → replied → interested → meeting → converted
                                                  → unsubscribed
                                                  → bounced
```

## Scoring Model

Four categories of scoring rules:
1. **Demographic**: prospect attributes (seniority, title)
2. **Firmographic**: company attributes (industry, size, revenue)
3. **Behavioral**: actions taken (website visits, content downloads)
4. **Engagement**: email interactions (opens +5, clicks +15, replies +30, negative reply -50)

## Campaign Workflow

1. **Create Campaign** — define asset/program, target criteria
2. **Import/Add Prospects** — CSV import or manual add, assign to campaign
3. **Enrich Prospects** — Perplexity research + Firecrawl scraping + Gemini analysis
4. **Generate Sequence** — AI creates personalized multi-step email sequence
5. **Review & Approve** — human reviews generated emails in Outbox
6. **Send** — scheduled sending with warm-up limits and send windows
7. **Monitor** — IMAP reply detection, AI classification, dashboard metrics
8. **Optimize** — adjust sequence based on open/click/reply rates

## Email Generation Pipeline

1. Gather prospect + company data + enrichment
2. Load tenant AI context (company_description, email_style, key_differentiators)
3. Resolve language (based on prospect region: catalan/spanish/english)
4. Call Gemini with structured prompt
5. Parse JSON response (subject + body)
6. Store as generated_email with status=draft
