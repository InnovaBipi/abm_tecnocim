# /camiacasa-mandatos

**Tenant**: CamiaCasa
**Campaign**: `527ae0d1-431f-4eb4-8b1d-c1f84aeb3d95` ("Comercialización de inmuebles — Mandatos de venta" — existing, never recreate)
**Angle**: SELL-SIDE. CamiaCasa (agente AICAT 14029, red de compradores cualificados con financiación) offers to **commercialize / sell the counterparty's own assets** in Catalonia/Spain in exchange for commission. This is the mirror image of `/auto-prospect-camiacasa` (buy-side): there we hunt buyers for our mandates; here we hunt **owners of assets** who need a commercialization channel.

On-demand workflow: discover asset-holders with property to move, hunt named expansion/asset-management contacts (generic fallback), generate 3-step multi-language sequences, import to DRAFT.

## Usage

```bash
/camiacasa-mandatos [--segment key] [--count N]
```

| Parameter | Options | Default |
|-----------|---------|---------|
| `--segment` | `divesting-funds`, `developer-stock`, `servicers-npl`, `hotel-owners`, `restaurant-portfolios`, `patrimonial-holders` | round-robin (persisted in `scripts/output/camiacasa-mandatos/search-state.json`) |
| `--count` | 1–50 | 12 |

## Segments (sell-side — who holds sellable/lettable assets)

| Segment | Target | Assets they hold | Titles hunted |
|---------|--------|------------------|---------------|
| `divesting-funds` | Funds/SOCIMIs/gestoras in a divestment/rotation phase | offices, retail, industrial, land portfolios | Head of Asset Management, Director de Inversiones, Portfolio Manager |
| `developer-stock` | Promotoras/constructoras with finished or half-sold stock | new-build units, commercial ground floors, unsold plots | Director Comercial, Director de Ventas, Director de Suelo |
| `servicers-npl` | Servicers / asset managers (Solvia, doValue/Altamira, Hipoges, Diglo, Anticipa…) | REO/NPL real-estate books | Head of Sales, Real Estate Sales Director, Channel Manager |
| `hotel-owners` | Hotel groups / owners rotating or selling assets | hotels, hotel-conversion buildings | Asset Manager, Director de Expansión, Head of Real Estate |
| `restaurant-portfolios` | Restaurant/retail groups closing or subletting premises | commercial premises, restaurantes en traspaso | Real Estate Manager, Director de Expansión |
| `patrimonial-holders` | Patrimonial companies / family offices with idle RE | mixed idle assets, land, buildings | Head of Real Estate, Gerente, Director General |

## The Pitch (sell-side value proposition)

- **Hook**: CamiaCasa channels a demonstrated pool of **qualified buyers with financing in place** (institutional + private) actively looking in Catalonia/Spain.
- **Offer**: commercialize / co-broke the counterparty's asset(s) — off-market or discreet listing — for a success-based commission. No exclusivity required to start.
- **Proof**: real closings/mandates in Catalonia; agente AICAT 14029, RC profesional. (Never fabricate specific figures — keep it qualitative unless a real reference is available.)
- **Ask (soft CTA)**: "¿Tiene sentido que valoremos un par de sus activos en Cataluña y le llevemos demanda concreta?" — no hard meeting push.
- **Never** mention the buy-side mandates, VGP, or any client name from the buy-side thread.

## Hard Exclusions

- Any domain already contacted **buy-side** (dedup against tenant prospects AND `scripts/output/camiacasa-eu-prospect/seen-domains.json`) — same inbox, do not double-hit.
- `vgpparks.eu`, `despina-im.com` (buy-side client + intermediary).
- **Germany + Austria** — UWG opt-in; no cold email (LinkedIn only).
- Individuals / autónomos — RGPD: legal entities only, generic or published-named professional emails.
- All tenant prospects + this segment's own `seen-domains` state.

## Hybrid Contact Rule (LOPDGDD art. 19)

Identical to buy-side: Tier 1 named (acquisitions/asset-management/expansion title, email only if published or domain-pattern verified) → Tier 2 generic (info@, comercial@, expansion@, activos@ — no free providers). MX verified always. Greeting "Hola/Hi {FirstName}," only when named; "Hola,"/"Hello," for generic.

**Compliance**: B2B legitimate interest (RGPD 6.1.f) to professional addresses; run `/generate-lia` for the sell-side named-contacts annex before the first named batch.

## Language Rule

- **Catalan**: entity based in Catalonia, Valencia or Balearic Islands
- **Spanish**: rest of Spain
- **English**: everywhere else in Europe

## What It Does

Launches `scripts/camiacasa-mandatos.wf.js` — the sell-side mirror of `camiacasa-eu-prospect.wf.js` (own CAMPAIGN_ID `527ae0d1`, own STATE_DIR `scripts/output/camiacasa-mandatos`, 6 sell-side segments, commercialization pitch, and setup that **merges the buy-side `seen-domains.json`** into the exclude set). Same 4-phase structure:

1. **Setup**: Auth CamiaCasa (`C:/Users/user/tmp_auth_cc.txt`) + paginated tenant dedup (`GET /api/prospects` → `data.prospects`) + merge buy-side `seen-domains.json` into the exclude set + rotation state → select segment
2. **Research**: WebSearch discovery of asset-holders per segment → named-contact hunt (parallel chunks ≤4-5) → MX verify
3. **Generate**: Enrich a concrete reason-to-commercialize per target → 3-step emails (hook → qualified-demand proof + soft valuation ask → gentle close) → QA 7 dimensions + native-language eval (3-retry, circuit breaker <70%). QA claim whitelist MUST match the pitch verbatim; adopt `corrected_emails` if returned.
4. **Import**: `POST /api/companies` → `POST /api/prospects` (with company_id) → enroll in campaign `527ae0d1-431f-4eb4-8b1d-c1f84aeb3d95` → `bulk-insert-emails` with **verified prospect_ids** (assert `inserted === N×3`) → persist rotation state

**Status**: DRAFT (no auto-approval, no auto-send)
**Signature**: "Alfons Marques / CamiaCasa" (no accent). Footer uses CamiaCasa `config.legal`.

## Examples

```bash
/camiacasa-mandatos                                  # round-robin next segment, 12 companies
/camiacasa-mandatos --segment servicers-npl --count 15
/camiacasa-mandatos --segment developer-stock --count 20
```

## Notes

- **Dedup is the #1 risk**: the buy-side campaign already touched ~180 domains. A fund contacted as a *buyer* must NOT be re-hit as a *seller* from the same inbox. Always merge `camiacasa-eu-prospect/seen-domains.json` into the exclude set at setup.
- **Servicers overlap** with `/camiacasa-colab` (that command registers CamiaCasa AS a collaborator with servicers). Sell-side mandate outreach is a different ask (list *their* assets), but avoid emailing the same servicer contact twice — check `scripts/output/camiacasa-colab/` state.
- Gotchas inherited from buy-side: `args` embedded as literal (not passed), Windows path `C:/Users/user/tmp_cc/`, QA as a `.js` file (not `node -e`), import via fetch (Node 22 global fetch).
