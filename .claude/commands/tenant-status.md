---
name: tenant-status
description: Show comprehensive status of a tenant including config, data counts, and email stats
arguments:
  - name: slug
    description: "Tenant slug (e.g., tecnocim, camiacasa, technova)"
    required: true
user_facing: true
---

# Tenant Status Command

Show comprehensive status of a specific tenant.

## Information Displayed

1. **Tenant Config**: name, slug, domain, colors, active status
2. **Data Counts**:
   - Total companies
   - Total prospects
   - Active campaigns
   - Active sequences
   - Pending/draft emails in outbox
3. **Email Stats**:
   - Emails sent today / this week / this month
   - Open rate, click rate, reply rate
   - Bounce rate, complaint rate
   - Current warm-up progress (day X of ramp_up_days, current limit)
4. **IMAP Status**:
   - Last sync time
   - Last UID processed
   - Connection status
5. **Recent Activity**:
   - Last 5 prospect activities
   - Last 5 email events
