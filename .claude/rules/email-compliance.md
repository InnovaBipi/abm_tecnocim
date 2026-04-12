---
description: Email sending compliance rules (CAN-SPAM, GDPR, deliverability)
globs: ["server/src/services/email.ts", "server/src/services/ai.ts", "server/src/routes/outbox.ts", "server/src/routes/sequences.ts", "server/src/jobs/**"]
alwaysApply: false
---

# Email Compliance Rules

## Before Sending Any Email

1. Check `suppression_list` — never email a suppressed address
2. Check `prospects.do_not_contact` — never email if `true`
3. Check `prospects.status` — never email `unsubscribed` or `bounced`
4. Check warm-up limits — respect `tenant.config.warmup.daily_limit_*`
5. Check send window — only send during configured business hours + timezone

## Required in Every Email

- Unsubscribe link (links to `/api/unsubscribe?token=...`)
- Physical address or company identifier in footer (from `tenant.config.branding.footer_html`)
- Valid sender name and email (from `tenant.config.email`)
- Correct Reply-To address

## Warm-Up Schedule

- Start at `daily_limit_base` emails/day
- Linear ramp over `ramp_up_days` to `daily_limit_max`
- Formula: `currentLimit = base + (maxLimit - base) * (daysSinceStart / rampUpDays)`
- Capped at `daily_limit_max`

## Reply Handling

- IMAP polling detects replies by matching `message_id`
- AI classification: positive, negative, out_of_office, unsubscribe, other
- On `negative` or `unsubscribe`: auto-stop sequence, update prospect status
- On `bounce`: add to suppression list, update prospect status

## Anti-Patterns

- Never send emails without checking suppression list
- Never exceed daily warm-up limits
- Never send outside configured send window
- Never fake "Re:" prefixes in subject lines
- Never send to invalid/catch-all emails without verification
