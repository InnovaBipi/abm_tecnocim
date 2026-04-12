# ABM Platform - Multi-tenant Account-Based Marketing

## Project Overview

Plataforma ABM (Account-Based Marketing) multi-tenant para gestionar campanas de prospección B2B con generación de emails personalizados mediante IA.

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 + Vite 6 + TypeScript + Tailwind CSS 3 + Zustand + React Query + Recharts |
| Backend | Node.js + Express 4 + TypeScript |
| Database | MySQL 8 (multi-tenant: `tenant_id` en todas las tablas) |
| AI | Gemini 2.5 Flash (email generation) + Perplexity (company research) |
| Email | Resend (sending) + IMAP (reply detection) |
| Scraping | Firecrawl (website intelligence) |
| Auth | JWT (HS256) + bcrypt + role-based access |
| Deploy | DigitalOcean App Platform |

## Development Commands

```bash
npm run install:all    # Install all dependencies (root + server + client)
npm run dev            # Start both server (3001) and client (5173)
npm run dev:server     # Start backend only
npm run dev:client     # Start frontend only
npm run build          # Build client for production
npm run start          # Start production server
npm run db:migrate     # Run database migrations
npm run db:seed        # Seed database with sample data
```

## Multi-Tenancy Model

- Table `tenants` stores all tenant config as JSON (email, IMAP, AI context, branding, warmup)
- `tenant_id CHAR(36)` column exists on ALL data tables
- JWT tokens include `tenantId` claim
- Auth middleware (`server/src/middleware/auth.ts`) extracts `tenantId` from JWT -> `req.user.tenantId`
- Tenant config cached in-memory with 5-minute TTL (`server/src/middleware/tenant.ts`)
- Unique constraints are per-tenant (email, domain, tag names)

**CRITICAL: Every database query MUST filter by `tenant_id`. Never allow cross-tenant data access.**

## Active Tenants

| Tenant | Slug | Domain | Business |
|--------|------|--------|----------|
| CamiaCasa | camiacasa | camiacasa.cat | Real estate agency |
| Technova Partners | technova | technovapartners.com | AI training consulting |
| Tecnocim | tecnocim | tecnocim.com | Innovation consulting + I+D+i |

## Project Structure

```
abm_tecnocim/
├── client/                    # React 19 SPA (Vite)
│   ├── src/
│   │   ├── pages/            # Route pages (Dashboard, Prospects, Campaigns, etc.)
│   │   ├── components/       # UI components (layout, ui)
│   │   ├── services/api.ts   # Axios API client
│   │   ├── stores/           # Zustand stores (auth)
│   │   └── lib/utils.ts      # Utility functions
│   └── vite.config.ts
├── server/                    # Express API
│   ├── src/
│   │   ├── routes/           # Express routers (auth, prospects, campaigns, etc.)
│   │   ├── services/         # Business logic (ai, email, enrichment, scoring, etc.)
│   │   ├── middleware/       # auth.ts (JWT), tenant.ts (multi-tenancy)
│   │   ├── config/           # database.ts, env.ts, migrate.ts
│   │   └── jobs/             # Background jobs (queue, scheduler)
│   └── tsconfig.json
├── database/
│   ├── schema.sql            # Base schema
│   ├── migration-001-multitenancy.sql
│   ├── migration-002-tenant-tecnocim.sql
│   └── seed.sql
└── .claude/                   # Claude Code infrastructure
```

## Key Files

| File | Purpose |
|------|---------|
| `server/src/middleware/tenant.ts` | TenantConfig interface, getTenantConfig(), buildTenantAIContext() |
| `server/src/middleware/auth.ts` | JWT verification, tenantId extraction, role-based access |
| `server/src/services/ai.ts` | Gemini + Perplexity integration, generateEmail(), classifyReply() |
| `server/src/config/env.ts` | Environment variable configuration |
| `server/src/index.ts` | Express app entry point, all routes, rate limiters |
| `client/src/services/api.ts` | Axios client with auth interceptors |

## API Response Format

```typescript
// Success
{ success: true, data: { ... } }

// Error
{ success: false, error: "Error message" }

// Paginated
{ success: true, data: [...], pagination: { page, limit, total, totalPages } }
```

## Conventions

- REST: plural nouns, `/api/` prefix
- TypeScript strict mode, avoid `any`
- UUID v4 for all primary keys
- Zod for input validation
- Parameterized queries (never string concatenation in SQL)
- Rate limiting: auth (10/15min), email send (200/hour), uploads (10/hour)
