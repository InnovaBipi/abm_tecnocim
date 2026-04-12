---
name: ai-integration
description: AI service integration patterns for Gemini, Perplexity, and Firecrawl including email generation and enrichment
triggers: ["Gemini", "Perplexity", "generate email", "AI email", "enrichment", "research", "Firecrawl", "scraping", "classify"]
---

# AI Integration Patterns

## Services Overview

| Service | Purpose | API | Config |
|---------|---------|-----|--------|
| Gemini 2.5 Flash | Email generation, reply classification | REST | `GEMINI_API_KEY` (global) |
| Perplexity (Sonar) | Company/prospect research | REST | `PERPLEXITY_API_KEY` (global) |
| Firecrawl | Website scraping for intelligence | REST | `FIRECRAWL_API_KEY` (global) |

## Gemini Usage (server/src/services/ai.ts)

### Email Generation
```typescript
enrichWithGemini(prompt, { temperature: 0.7, maxOutputTokens: 2048 })
```
- Temperature 0.7 for creative email writing
- Temperature 0.8 for full sequence generation (more variety)
- Always request JSON output format
- Parse with regex `result.match(/\{[\s\S]*\}/)` for single email
- Parse with regex `result.match(/\[[\s\S]*\]/)` for sequence array

### Reply Classification
```typescript
classifyReply(bodyText, subject)
```
- Temperature 0.1 (deterministic)
- MaxOutputTokens 20 (single word response)
- Categories: positive, negative, out_of_office, unsubscribe, other
- Bias toward "negative" when uncertain (protect prospect)

## Perplexity Usage

```typescript
searchWithPerplexity(queryText, systemPrompt?)
```
- Model: `sonar`
- Temperature 0.2 (factual)
- System prompt customizable per tenant via `tenant.config.ai.perplexity_system`
- Use for: company research, market intelligence, prospect background

## Tenant AI Context

Every AI call must use tenant-specific context:

```typescript
const tenant = await getTenantConfig(tenantId);
const aiContext = buildTenantAIContext(tenant);
// aiContext includes: company_name, sender_name, company_description,
//   industry_context, email_style, key_differentiators, entity_label, etc.
```

## Language Resolution

Language is determined per-prospect based on location:
- Catalonia regions → Catalan
- Spain (non-Catalonia) → Spanish
- International → English
- Override: `tenant.config.ai.default_language`

## Enrichment Pipeline

1. **Perplexity Research**: Query company name + domain for intelligence
2. **Firecrawl Scrape**: Extract structured data from company website
3. **Gemini Analysis**: Synthesize research into actionable insights
4. Store results in `prospects.enrichment_data` and `companies.enrichment_data` JSON fields
