# Known Gotchas by Page

## Dashboard
- DateRangePicker state exists but was NOT connected to queries (fixed in Sprint 1)
- Chart colors must use exact design system hex values
- 8 parallel queries on mount - monitor for performance

## Prospects
- Full-text search uses MySQL MATCH/AGAINST (requires FULLTEXT index)
- Score badges: red <40, amber 40-69, green 70+
- "Agregar a campana" bulk action was placeholder - needs implementation

## ProspectDetail
- Enrichment tab falls back to raw JSON when AI analysis is missing
- Score recalculation triggers a background job, not instant

## Companies
- Favicon loaded from Google S2 (external dependency, may fail)
- No debounce on search (fixed in Sprint 1)

## CompanyDetail
- Engagement tab shows "Proximamente" EmptyState - not implemented yet
- Company enrichment is indirect (via prospect enrichment only)

## Campaigns
- Asset type options come from tenant config, fall back to defaults
- No debounce on search (fixed in Sprint 1)

## CampaignDetail
- Email generation calls Gemini API (may timeout for large batches)
- No way to change campaign status from detail page (added in Sprint 1)
- Email editing uses raw HTML textarea (not user-friendly)

## Outbox
- Email send loop blocks event loop with 600ms delay per email (bugs.md)
- Double-send possible - no idempotency check (bugs.md)
- No pagination - fetches limit:100 (needs fix)

## Settings
- Tabs component was imported but not used (fixed in Sprint 1)
- Scoring rule "field" input is free-text (error-prone)
- IMAP password stored unencrypted in DB JSON (tech-debt)

## Imports
- Only CSV and Excel accepted (50MB limit)
- Column mapping is case-sensitive
- Duplicate check is per-tenant by email
