---
name: audit-emails
description: Run quality assurance on generated emails checking spam triggers, personalization, and compliance. Based on 2026 cold email benchmarks. Auto-fixes subjects, CTAs, and phrase variety.
arguments:
  - name: tenant
    description: "Tenant slug to audit (default: tecnocim)"
    required: false
  - name: campaign
    description: "Campaign ID to audit (default: all draft/scheduled emails)"
    required: false
  - name: autofix
    description: "Auto-fix issues (true/false, default: true)"
    required: false
user_facing: true
---

# Audit Emails Command

Launch the email-qa agent to review and auto-fix emails based on **2026 cold email benchmark data**.

## Steps

1. Spawn the `email-qa` agent with tenant and campaign filters
2. The agent will fetch all draft/scheduled emails via API (curl, not DB)
3. Apply 20-point checklist:

### Quality Checks (2026 benchmarks)
| Check | Target | Auto-fix? |
|-------|--------|-----------|
| Word count | 50-80 words | Flag for regeneration |
| Subject length | 21-40 chars | YES: trim prefixes |
| CTA type | Soft interest question | YES: replace hard CTAs |
| Personalization | Specific company facts | Flag if generic |
| Deduction phrasing | Vary "25-42%" | YES: alternate phrases |
| Spam triggers | None | YES: remove |
| Language match | Catalan for Catalunya | Flag mismatch |

### Compliance Checks
| Check | Target | Auto-fix? |
|-------|--------|-----------|
| Signature | Alfons Marquès / Tecnocim | YES: append |
| Suppression list | Not suppressed | Reject |
| DNC flag | Not do_not_contact | Reject |
| Duplicates | No identical subject+body | Reject duplicate |

4. Auto-fix fixable issues via PUT API
5. Reject failing emails
6. Generate report with:
   - PASS/FIXED/WARN/FAIL counts
   - Batch Quality Score
   - Specific recommendations

## Usage

```
/audit-emails                          # Audit all Tecnocim drafts
/audit-emails tenant=tecnocim          # Explicit tenant
/audit-emails campaign=a16c9f50...     # Specific campaign
/audit-emails autofix=false            # Report only, no changes
```
