---
description: Database migration conventions - tenant_id requirements and numbering
globs: ["database/**/*.sql"]
alwaysApply: false
---

# Migration Patterns

## Numbering
- Files named: `migration-NNN-description.sql` (zero-padded 3 digits)
- Check existing files before creating: `ls database/migration-*.sql | sort | tail -1`
- Always increment from the highest existing number

## New Tables
Every new table MUST include:
```sql
CREATE TABLE new_table (
    id          CHAR(36) PRIMARY KEY,
    tenant_id   CHAR(36) NOT NULL,       -- ALWAYS second column
    -- ... other columns ...
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_newtable_tenant (tenant_id),
    CONSTRAINT fk_newtable_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

## New Tenant Provisioning
Follow the pattern in `migration-001-multitenancy.sql`:
1. INSERT into `tenants` with full config JSON
2. INSERT admin `users` row with tenant_id
3. INSERT default `scoring_rules` with tenant_id
4. INSERT `imap_sync_state` row with tenant_id

## Rollback Comments
Include rollback SQL as comments:
```sql
-- ROLLBACK: DROP TABLE IF EXISTS new_table;
-- ROLLBACK: DELETE FROM tenants WHERE slug = 'new_tenant';
```
