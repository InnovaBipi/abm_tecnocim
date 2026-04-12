---
name: email-deliverability
description: Email deliverability best practices including warm-up, reputation management, SPF/DKIM, and bounce handling
triggers: ["deliverability", "warm-up", "warmup", "SPF", "DKIM", "bounce", "reputation", "spam", "unsubscribe", "suppression"]
---

# Email Deliverability

## Warm-Up Schedule

New sending domains/IPs must be warmed up gradually:

- `daily_limit_base`: starting daily volume (e.g., 10-20)
- `daily_limit_max`: target daily volume (e.g., 50-100)
- `ramp_up_days`: days to reach max (e.g., 30)
- Linear ramp: `currentLimit = base + (max - base) * min(1, daysSinceStart / rampUpDays)`

## Reputation Metrics

Keep these under control:
- **Bounce rate**: < 2% (hard bounces)
- **Complaint rate**: < 0.1%
- **Unsubscribe rate**: < 0.5%
- **Open rate**: target > 20% (indicates good deliverability)

## DNS Requirements

For each sending domain, configure:
- **SPF**: `v=spf1 include:_spf.resend.com ~all`
- **DKIM**: Resend provides the DKIM record to add
- **DMARC**: `v=DMARC1; p=none; rua=mailto:dmarc@domain.com`

## Send Window

- Only send during business hours in the prospect's timezone
- Default: Monday-Friday, 9:00-17:00
- Configured per-sequence in `email_sequences.send_window` JSON

## IMAP Reply Detection Flow

1. Scheduler runs `imapSync()` periodically (every 5 minutes)
2. Connect to tenant's IMAP server
3. Fetch new emails since last `imap_sync_state.last_uid`
4. Match `In-Reply-To` / `References` headers against sent `message_id`
5. Classify reply with Gemini AI: positive, negative, out_of_office, unsubscribe, other
6. Update prospect status and enrollment accordingly
7. Update `imap_sync_state.last_uid`

## Suppression List

Automatically add to suppression:
- Hard bounces
- Unsubscribe requests (both via link and email classification)
- Spam complaints
- Manual additions by admin

Always check suppression list BEFORE sending any email.
