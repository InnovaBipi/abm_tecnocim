---
name: add-tenant
description: Generate migration SQL to add a new tenant to the ABM platform
arguments:
  - name: name
    description: Company name (e.g., "Tecnocim")
    required: true
  - name: slug
    description: URL-safe slug (e.g., "tecnocim")
    required: true
  - name: domain
    description: Company domain (e.g., "tecnocim.com")
    required: true
user_facing: true
---

# Add Tenant Command

Generate a complete migration SQL file to provision a new tenant for the ABM platform.

## Steps

1. Read `database/migration-001-multitenancy.sql` to understand the tenant config JSON structure
2. Read `server/src/middleware/tenant.ts` for the TenantConfig interface
3. Determine the next migration number by checking existing migration files in `database/`
4. Ask the user for:
   - Business type (real estate, consulting, training, etc.)
   - Admin email
   - Entity label (what their campaigns represent: properties, programs, services)
   - Brief company description for AI context
   - Primary/secondary brand colors
5. Generate `database/migration-00X-tenant-<slug>.sql` with:
   - INSERT into `tenants` with full config JSON
   - INSERT admin user
   - INSERT default scoring rules for their industry
6. Update the Active Tenants table in `CLAUDE.md`
7. Report the next steps (run migration, set admin password)
