---
name: tenant-management
description: Multi-tenancy architecture patterns, tenant config structure, and tenant provisioning workflows
triggers: ["tenant", "multi-tenant", "tenant_id", "config", "settings", "branding", "new tenant", "add tenant"]
---

# Tenant Management

## Tenant Config Structure

Each tenant has a JSON `config` column with these sections:

```json
{
  "email": {
    "resend_api_key": "",
    "from_email": "noreply@company.com",
    "from_name": "Company Name",
    "reply_to": "reply@company.com",
    "notification_email": "admin@company.com"
  },
  "imap": {
    "host": "imap.server.com",
    "port": 993,
    "user": "inbox@company.com",
    "pass": "password"
  },
  "entity": {
    "type_label": "Servicio",
    "type_label_plural": "Servicios",
    "icon": "Briefcase",
    "fields": [
      { "key": "field_name", "label": "Display Label", "type": "text|number|json" }
    ]
  },
  "ai": {
    "company_description": "Full company description for AI context",
    "sender_name": "Sender Full Name",
    "industry_context": "industry keywords",
    "contact_email": "contact@company.com",
    "contact_phone": "+34 XXX XXX XXX",
    "perplexity_system": "Custom system prompt for research",
    "email_style": "Tone and style instructions",
    "key_differentiators": "Unique selling points",
    "default_language": "spanish|catalan|english"
  },
  "branding": {
    "app_name": "Company ABM",
    "tagline": "Tagline",
    "footer_html": "<p>Footer content</p>"
  },
  "warmup": {
    "daily_limit_base": 10,
    "daily_limit_max": 50,
    "ramp_up_days": 30
  }
}
```

## How Tenant Isolation Works

1. User logs in → JWT generated with `tenantId` claim
2. Every authenticated request → `auth.ts` middleware extracts `tenantId` from JWT → `req.user.tenantId`
3. Every DB query → includes `WHERE tenant_id = req.user.tenantId`
4. Every AI call → loads tenant config via `getTenantConfig(tenantId)` → `buildTenantAIContext(tenant)`

## Key Functions (server/src/middleware/tenant.ts)

- `getTenantConfig(tenantId)` — cached lookup (5min TTL)
- `getAllActiveTenants()` — for scheduled jobs that iterate tenants
- `getTenantBySlug(slug)` — for public endpoints (unsubscribe)
- `clearTenantCache(tenantId?)` — invalidate after settings change
- `buildTenantAIContext(tenant)` — extract AI context for email generation

## Adding a New Tenant

1. Create migration file: `database/migration-00X-tenant-<name>.sql`
2. INSERT into `tenants` with full config JSON
3. INSERT admin user with `tenant_id` = new tenant ID
4. INSERT default scoring rules for the tenant's industry
5. Run migration: `npm run db:migrate`
6. Test: login with admin user, verify data isolation
