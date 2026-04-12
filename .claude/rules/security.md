---
description: Security practices for authentication, authorization, and data protection
globs: ["server/**/*.ts"]
alwaysApply: false
---

# Security Rules

## Authentication

- JWT_SECRET must be strong (64+ characters) — never contain "change" in production
- Tokens expire via `JWT_EXPIRES_IN` (default 7d)
- JWT payload: `{ userId, email, role, tenantId }`
- bcrypt with salt rounds >= 10 for password hashing
- Rate limit auth routes: 10 attempts per 15 minutes

## Authorization

- Use `authenticate` middleware on all protected routes
- Use `requireRole(...roles)` for role-based access control
- Roles: `admin`, `manager`, `member`, `viewer`
- Never trust client-side role claims

## Input Validation

- Use Zod schemas for ALL request body/query validation
- Validate BEFORE processing any business logic
- Reject unknown fields (strict schemas)

## SQL Injection Prevention

- ALWAYS use parameterized queries: `query('SELECT * FROM x WHERE id = ?', [id])`
- NEVER concatenate user input into SQL strings
- NEVER use template literals for SQL queries with user data

## HTTP Security

- Helmet middleware always active (security headers)
- CORS restricted to `FRONTEND_URL` only
- Body size limit: 10MB
- File upload limit: 50MB, only CSV/Excel
- No sensitive data in error responses in production

## Secrets Management

- Never commit `.env` files (must be in `.gitignore`)
- API keys (Gemini, Perplexity, Firecrawl, Resend) stored as env vars
- Per-tenant secrets (IMAP passwords, Resend keys) stored encrypted in DB
- Never log secrets or tokens
