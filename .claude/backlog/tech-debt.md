# Technical Debt

## High Priority
- [ ] Add Zod validation to ALL route handlers (some endpoints accept raw req.body)
- [ ] Migrate email send to background jobs (currently blocking event loop with 600ms delays)
- [ ] Add structured logging with pino (replace console.log/error, include tenant_id)
- [ ] Implement proper database migration runner (scan directory, track in _migrations table)
- [ ] Add comprehensive error context in logs (request ID, tenant, user, action)

## Medium Priority
- [ ] Migrate auth to HttpOnly cookies (from localStorage JWT)
- [ ] Add audit logging for admin actions (user CRUD, settings changes, tenant config)
- [ ] Encrypt tenant secrets at rest (IMAP passwords, API keys in tenants.config)
- [ ] Add request ID middleware (X-Request-ID header for tracing)
- [ ] Implement JWT refresh token flow (currently 7-day access tokens only)

## Low Priority
- [ ] Add CSP headers to Helmet configuration
- [ ] Remove PATCH from CORS allowed methods (not used)
- [ ] Add password complexity policy via Zod
- [ ] Add transaction timeout handling (currently unbounded)
- [ ] Add connection error handler to prevent pool leaks
