# /auto-prospect-camiacasa

**Tenant**: CamiaCasa
**Campaign**: `a8ce08b1-8677-41fe-a923-bfb201e1d0c2` ("Oportunidades de inversión" — existing, never recreate)
**Inventory**: Off-market Catalonia — naves industriales, solares urbanizados (suelo finalista), hoteles. Direct owner mandates, NDA-first.

On-demand workflow: discover institutional BUYERS across Europe, hunt named acquisition contacts (generic fallback), generate 3-step multi-language sequences, import to DRAFT.

## Usage

```bash
/auto-prospect-camiacasa [--segment key] [--count N]
```

| Parameter | Options | Default |
|-----------|---------|---------|
| `--segment` | `industrial-developers`, `logistics-investors`, `land-developers`, `hotel-investors`, `family-offices-eu`, `socimi-funds-es`, `industrial-land-investors`, `restaurant-hospitality-operators` | round-robin (persisted in `scripts/output/camiacasa-eu-prospect/search-state.json`) |
| `--count` | 1–50 | 12 |

## Segments

| Segment | Target | Asset focus | Titles hunted |
|---------|--------|-------------|---------------|
| `industrial-developers` | Pan-EU industrial/logistics developers active in Iberia | naves + solares industriales | Land Acquisition Director/Manager, Development Director, Country Head Spain |
| `logistics-investors` | Logistics RE fund managers with Iberian mandate | naves (income + value-add) | Head of Acquisitions, Investment Director Iberia |
| `land-developers` | Residential/mixed developers buying finalist land | solares urbanizados | Director de Suelo, Head of Land Acquisition |
| `hotel-investors` | Hotel investment platforms, hospitality PE, expanding chains | hoteles | Head of Expansion, Investment Director Hospitality |
| `family-offices-eu` | EU family offices with direct RE allocation open to Iberia | mixto, long hold | Head of Real Estate, Head of Direct Investments |
| `socimi-funds-es` | Spanish SOCIMIs and gestoras (value-add/income) | mixto | Director de Inversiones, Head of Acquisitions |
| `industrial-land-investors` | Land-banking platforms and investors buying industrial/logistics land in Iberia | solares industriales / suelo finalista logístico | Land Acquisition Director, Head of Land, Investment Director |
| `restaurant-hospitality-operators` | Restaurant/F&B groups, hospitality operators and franchise chains expanding in Catalonia/Spain | locales comerciales, restaurantes en traspaso | Director de Expansión, Real Estate Manager, Head of Expansion |

## Hard Exclusions

- **`vgpparks.eu` — existing CLIENT** (Pablo Valderrama thread). Never contact, never mention in emails.
- **`despina-im.com`** — intermediary in the same thread. Never contact.
- **Germany + Austria** — UWG opt-in regime; no cold email (LinkedIn only).
- Mega-funds already covered (Blackstone, Brookfield, Patrizia, Prologis, etc.).
- All tenant prospects (dedup by domain AND email) + `seen-domains.json` state.

## Hybrid Contact Rule (LOPDGDD art. 19)

1. **Tier 1 — named**: person with an acquisitions title, email only if published OR domain pattern verified from another published named email. `source_detail` records the evidence URL.
2. **Tier 2 — generic fallback**: info@, acquisitions@, investments@, ir@ (no free providers).
3. MX verified always. Greeting: "Hi/Hola {FirstName}," only for named; "Hello,"/"Hola," for generic.

**Compliance**: nominal B2B contact data of executives limited to their professional function is covered by LOPDGDD art. 19 + RGPD 6.1.f, but run `/generate-lia` for the named-contacts annex before the first named batch (see `scripts/output/camiacasa-invest-20260601/` for the generic-only LIA).

## Language Rule

- **Catalan**: entity based in Catalonia, Valencia or Balearic Islands
- **Spanish**: rest of Spain
- **English**: everywhere else in Europe

## What It Does

1. **Setup**: Auth CamiaCasa (token cache) + paginated tenant dedup + rotation state → select segment
2. **Research**: WebSearch discovery EU-wide → named-contact hunt per company (parallel chunks) → MX verify
3. **Generate**: Enrich durable investment thesis → 3-step emails (NDA-first, teaser → location/layout/buildable-area/urban-certificate pack) → QA 7 dimensions + native-language eval (3-retry, circuit breaker <70%)
4. **Import**: `POST /api/companies` → `POST /api/prospects` (with company_id) → enroll in campaign → `bulk-insert-emails` with **verified prospect_ids** → verify drafts in API → persist rotation state

**Status**: DRAFT (no auto-approval, no auto-send)
**Next step**: Review in campaign UI → approve → scheduler distributes Mon-Fri respecting 20/day warmup

## Examples

```bash
# Round-robin next segment, 12 companies
/auto-prospect-camiacasa

# Specific segment
/auto-prospect-camiacasa --segment industrial-developers --count 15
/auto-prospect-camiacasa --segment hotel-investors --count 8
```

## How It Works

Launches `scripts/camiacasa-eu-prospect.wf.js` — a Dynamic Workflow (on-demand, background):

- **No cron**: you decide when it runs; each run rotates to the next segment automatically
- **No auto-approval**: emails stay DRAFT for your review
- **Resumable**: re-run the same command to retry; dedup + delete-and-insert semantics prevent duplicates

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Auth failed | Delete `C:/Users/user/tmp_auth_cc.txt` and re-run (prompts for password) |
| `inserted` < prospects×3 | Some prospect_ids were invalid — the endpoint skips them silently. Check `missing_prospect_ids` in the summary; the import agent only uses ids from 201 responses, so this signals a partial prospect-creation failure |
| Emails don't appear in UI | `GET /api/campaigns/a8ce08b1-8677-41fe-a923-bfb201e1d0c2/generated-emails?status=draft` — count `d.data.emails` (NOT `d.data.length`) |
| Company name missing in UI | The prospect was created without `company_id` — POST /api/prospects ignores `company_name`; companies must be created first |
| No companies found | Segment may be exhausted; try another `--segment` |
| Circuit breaker | <70% passed QA on blocking dimensions; retry with smaller `--count` or another segment |
| Wrong segment selected | Round-robin reads `last_segment` from `scripts/output/camiacasa-eu-prospect/search-state.json`; pass `--segment` to override |

## Next Steps After Import

1. **Review**: `https://abm.tecnociminnova.com/campaigns/a8ce08b1-8677-41fe-a923-bfb201e1d0c2`
2. **Verify**: greeting matches contact type, language matches country, signature "Alfons Marques / CamiaCasa" (no accent), zero VGP mentions
3. **Approve batch** → scheduler distributes Mon-Fri 9-11h Madrid (20/day warmup)
4. **Scale**: re-run with next segment or higher `--count`
