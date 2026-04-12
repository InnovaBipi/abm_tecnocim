---
description: Enforce multi-tenant data isolation in all database operations
globs: ["server/**/*.ts", "database/**/*.sql"]
alwaysApply: true
---

# Tenant Isolation Rules

## Critical: Every Query Must Filter by tenant_id

1. **ALL SQL queries** (SELECT, UPDATE, DELETE) MUST include `WHERE tenant_id = ?`
2. **ALL INSERT statements** MUST include the `tenant_id` column
3. The `tenant_id` value MUST come from `req.user.tenantId` (JWT), NEVER from the request body
4. Never allow a user to specify or override their `tenant_id`

## New Tables

When creating a new table:
1. MUST include `tenant_id CHAR(36) NOT NULL` column (after `id`)
2. MUST add `KEY idx_<table>_tenant (tenant_id)`
3. MUST add `CONSTRAINT fk_<table>_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)`
4. Unique constraints MUST be per-tenant: `UNIQUE KEY idx_<table>_tenant_<field> (tenant_id, <field>)`

## Tenant Config

- Tenant configuration lives in `tenants.config` JSON column
- Use `getTenantConfig(tenantId)` from `server/src/middleware/tenant.ts`
- Config is cached for 5 minutes — call `clearTenantCache(tenantId)` after settings changes
- Use `buildTenantAIContext(tenant)` to get AI context for email generation

## Anti-Patterns (NEVER do these)

```typescript
// BAD: No tenant filter
const rows = await query('SELECT * FROM prospects');

// BAD: tenant_id from request body
const { tenant_id } = req.body;

// BAD: Global unique constraint
ALTER TABLE prospects ADD UNIQUE KEY (email);
```

## Correct Patterns

```typescript
// GOOD: Always filter by tenant
const rows = await query(
  'SELECT * FROM prospects WHERE tenant_id = ?',
  [req.user!.tenantId]
);

// GOOD: Include tenant_id in INSERT
await query(
  'INSERT INTO prospects (id, tenant_id, email, ...) VALUES (?, ?, ?, ...)',
  [uuid(), req.user!.tenantId, email, ...]
);

// GOOD: Per-tenant unique constraint
ALTER TABLE prospects ADD UNIQUE KEY idx_prospect_tenant_email (tenant_id, email);
```
