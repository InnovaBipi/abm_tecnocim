---
name: api-debugging
description: Guide for debugging API issues - common errors, request tracing, MySQL debugging, and curl examples
triggers: ["debug", "500 error", "API fail", "trace", "not working", "broken endpoint"]
---

# API Debugging Guide

## Error Code Quick Reference

| Code | Meaning | Common Cause | Fix |
|------|---------|-------------|-----|
| 400 | Validation | Missing/invalid field | Check Zod schema, verify request body |
| 401 | Not authenticated | Expired/missing JWT | Re-login, check token in localStorage |
| 403 | Forbidden | Wrong role | Check `requireRole()` middleware |
| 404 | Not found | Wrong ID or tenant_id | Verify resource exists for this tenant |
| 409 | Conflict | Duplicate email/domain | Check unique constraints (per-tenant) |
| 429 | Rate limited | Too many requests | Auth: 10/15min, Email: 200/hr, Upload: 10/hr |
| 500 | Server error | Uncaught exception | Check server console, look at SQL query |

## Request Tracing Flow

```
Client (React) → Axios interceptor → Express route → Middleware → Handler → MySQL → Response
```

1. **Client**: Check React Query devtools or Network tab
2. **Axios**: Check `client/src/services/api.ts` interceptors (401 = auto-redirect)
3. **Express**: Check `server/src/index.ts` for route registration
4. **Auth middleware**: `server/src/middleware/auth.ts` - JWT decoded, tenantId set
5. **Tenant middleware**: `server/src/middleware/tenant.ts` - tenant config cached
6. **Route handler**: `server/src/routes/<resource>.ts` - business logic
7. **Database**: Check SQL query has tenant_id, check connection pool

## Testing Endpoints with curl

```bash
# Login and get token
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@tecnocim.com","password":"admin123"}' | jq -r '.data.token')

# Use token for authenticated requests
curl -s http://localhost:3001/api/prospects \
  -H "Authorization: Bearer $TOKEN" | jq .

# POST with body
curl -s -X POST http://localhost:3001/api/prospects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","first_name":"Test"}' | jq .
```

## MySQL Debugging

```sql
-- Check slow queries
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;

-- Analyze query performance
EXPLAIN SELECT * FROM prospects WHERE tenant_id = 'xxx' AND status = 'new';

-- Check connection pool
SHOW STATUS LIKE 'Threads_connected';
SHOW PROCESSLIST;
```

## Common Gotchas
1. **Missing tenant_id**: Every query MUST filter by tenant_id. The PreToolUse hook checks this.
2. **camelCase vs snake_case**: Client uses camelCase, DB uses snake_case. API should return snake_case.
3. **JSON fields**: Use `JSON_EXTRACT()` for querying JSON columns (config, enrichment_data)
4. **Connection pool**: Default connectionLimit is 10. Check for pool exhaustion under load.
