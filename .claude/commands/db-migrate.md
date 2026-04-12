---
name: db-migrate
description: List, apply, or check status of database migrations
arguments:
  - name: action
    description: "Action: up (apply pending), status (show status), or down (rollback last)"
    required: false
user_facing: true
---

# Database Migrate Command

Manage database migrations for the ABM platform.

## Steps

### status (default)
1. List all migration files in `database/` matching `migration-*.sql`
2. Check which have been applied (via `_migrations` table or by checking schema state)
3. Report pending vs applied migrations

### up
1. List pending migrations
2. Apply each in order (by number)
3. Report success/failure for each
4. Verify schema state after migration

### down
1. Identify the last applied migration
2. Show what it would rollback
3. Ask for confirmation before proceeding
4. Execute rollback SQL (if migration includes rollback comments)
