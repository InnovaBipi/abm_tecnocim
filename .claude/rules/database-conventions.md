---
description: Database schema design and migration conventions
globs: ["database/**/*.sql", "server/src/config/migrate.ts", "server/src/config/database.ts"]
alwaysApply: false
---

# Database Conventions

## Schema Design

- Primary keys: `id CHAR(36)` (UUID v4)
- All tables MUST have `tenant_id CHAR(36) NOT NULL`
- Timestamps: `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`, `updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`
- Use `ENUM` for fixed-set columns (status, role, etc.)
- Use `JSON` for flexible/extensible data (config, metadata, custom_fields)
- Character set: `utf8mb4` with `utf8mb4_unicode_ci` collation

## Naming

- Table names: `snake_case`, plural (`prospects`, `email_sequences`)
- Column names: `snake_case` (`first_name`, `tenant_id`)
- Index names: `idx_<table>_<column>` (`idx_prospect_tenant`)
- Foreign key names: `fk_<table>_<referenced>` (`fk_prospect_company`)
- Unique constraints: `idx_<table>_tenant_<column>` for per-tenant uniqueness

## Migrations

- Files in `database/` directory, numbered: `migration-001-*.sql`, `migration-002-*.sql`
- Each migration is idempotent where possible (use `IF NOT EXISTS`, `IF EXISTS`)
- Always include rollback comments
- New migrations MUST add `tenant_id` to any new tables
- Run via: `npm run db:migrate`

## Foreign Keys

- Use `ON DELETE CASCADE` for child records (e.g., sequence_steps -> email_sequences)
- Use `ON DELETE SET NULL` for optional references (e.g., prospect.company_id)
- Always index foreign key columns

## Query Patterns

```sql
-- Pagination
SELECT * FROM prospects
WHERE tenant_id = ?
ORDER BY created_at DESC
LIMIT ? OFFSET ?;

-- Count for pagination
SELECT COUNT(*) as total FROM prospects WHERE tenant_id = ?;

-- Full-text search
SELECT * FROM prospects
WHERE tenant_id = ? AND MATCH(first_name, last_name, email, title) AGAINST(? IN BOOLEAN MODE);
```
