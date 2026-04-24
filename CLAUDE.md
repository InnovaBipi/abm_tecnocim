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

## Production

| Component | URL | Platform |
|-----------|-----|----------|
| App (frontend + API) | `https://abm.tecnociminnova.com` | DigitalOcean App Platform |
| Database | Private networking | DO Managed MySQL |

- GitHub deploy repo: `InnovaBipi/abm_tecnocim` (auto-deploy on push to `main`)
- Frontend and backend share the same DO app domain (`/` for SPA, `/api/*` for Express)
- No `VITE_API_URL` needed in production — the default `/api` fallback works

**Note:** `tecnocim.com` is the tenant's business domain (for email config). `tecnociminnova.com` is the platform hosting domain. Landing page is at `tecnociminnova.com` (Vercel, separate project).

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

## Testing Commands

```bash
npm run test              # Run all unit tests (server + client)
npm run test:server       # Server unit tests only
npm run test:client       # Client component/unit tests only
npm run test:watch        # Watch mode during development
npm run test:coverage     # Generate coverage report
npm run test:e2e          # Run full E2E suite (headless)
npm run test:e2e:ui       # Run E2E with Playwright UI mode
```

## Testing Conventions

- **Unit tests**: Vitest + React Testing Library for components, Vitest for server services
- **E2E tests**: Playwright for critical user flows
- **File naming**: `*.test.ts` / `*.test.tsx` colocated next to source files
- **Coverage target**: 60% for services, 40% for components
- **Semantic selectors**: Prefer `getByRole`, `getByLabelText`, `getByText` over `data-testid`

## Design System

- **Skill reference**: `.claude/skills/abm-ux-design/SKILL.md`
- **Brand font**: Poppins (Google Fonts)
- **Primary color**: Tecnocim Orange #ff7f00 (`primary-500`)
- **Component library**: `client/src/components/ui/` (21 components)
- **Icons**: Lucide React (`lucide-react`)
- **CSS framework**: Tailwind CSS 3 with custom primary/secondary color tokens

## Accessibility (WCAG 2.2 AA)

- All interactive elements must be keyboard-navigable
- All images/icons must have `alt` text or `aria-label`
- Color contrast ratio: minimum 4.5:1 for text, 3:1 for large text
- Form inputs must have associated `<label>` elements
- Focus indicators must be visible (never `outline-none` without replacement)

## Performance Guidelines

- **React Query caching**: default `staleTime: 30_000` for lists, `60_000` for details
- **Memoization**: `React.memo()` for list renderers, `useMemo` for computed data
- **Bundle size**: Keep client build under 500KB gzipped (currently 268KB)
- **API pagination**: Default 20 items, max 100 per request

## Common Workflows

### Add a New Page
1. Create `client/src/pages/PageName.tsx` following the standard layout pattern
2. Add lazy route in `client/src/App.tsx`: `const PageName = lazy(() => import('./pages/PageName'))`
3. Add sidebar link in `client/src/components/layout/Sidebar.tsx`
4. Create `client/src/pages/PageName.test.tsx` with baseline render test

### Add a New API Endpoint
1. Create or extend route in `server/src/routes/<resource>.ts`
2. Add `router.use(authenticate)` at top if new file
3. Register route in `server/src/index.ts`: `app.use('/api/<resource>', resourceRouter)`
4. Add Zod validation schemas for request body
5. Ensure ALL queries include `WHERE tenant_id = ?`
6. Add types to `client/src/services/api.ts`

### Add a New Tenant
1. Create migration: `database/migration-NNN-tenant-<slug>.sql`
2. INSERT into `tenants` with full config JSON (email, IMAP, AI, branding, warmup, entity)
3. INSERT admin user with tenant_id
4. INSERT default scoring rules with tenant_id
5. INSERT imap_sync_state row
6. Run: `npm run db:migrate`

### Debug a Failing Test
1. Run single test: `cd client && npx vitest run src/path/to/file.test.tsx`
2. Watch mode: `cd client && npx vitest src/path/to/file.test.tsx`
3. E2E debug: `cd client && npx playwright test --debug`
4. Server test: `cd server && npx vitest run src/path/to/file.test.ts`

### Pre-Deploy Checklist
1. `git status` - working tree clean
2. `npm run test` - all tests pass
3. `cd server && npx tsc --noEmit` - no TypeScript errors
4. `cd client && npm run build` - builds without errors
5. Check `database/` for pending migrations

## Environment Setup

### Prerequisites
- Node.js 20+ and npm 10+
- MySQL 8.0+ (local or Docker)
- Git

### First-Time Setup
```bash
git clone git@github.com:DATANINJA-dev/abm_tecnocim.git
cd abm_tecnocim
cp .env.example .env          # Configure your environment variables
npm run install:all            # Install root + server + client deps
npm run db:migrate             # Run all database migrations
npm run db:seed                # Optional: seed with sample data
npm run dev                    # Start server (3001) + client (5173)
```

### Required Environment Variables
| Variable | Description |
|----------|-------------|
| `DB_HOST` | MySQL host (default: localhost) |
| `DB_PORT` | MySQL port (default: 3306) |
| `DB_USER` | MySQL username |
| `DB_PASSWORD` | MySQL password |
| `DB_NAME` | Database name |
| `JWT_SECRET` | JWT signing secret (64+ chars) |
| `GEMINI_API_KEY` | Google Gemini API key |
| `PERPLEXITY_API_KEY` | Perplexity API key |
| `FIRECRAWL_API_KEY` | Firecrawl API key |
| `RESEND_API_KEY` | Resend email API key (fallback, per-tenant preferred) |
| `FRONTEND_URL` | Frontend URL for CORS (default: http://localhost:5173) |

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ECONNREFUSED 3306` | MySQL not running | Start MySQL: `docker compose up -d` or `mysql.server start` |
| `jwt expired` during dev | Token expired (7d default) | Clear localStorage and re-login |
| `CORS error` in browser | `FRONTEND_URL` env var mismatch | Set `FRONTEND_URL=http://localhost:5173` in `.env` |
| Vite proxy 504 | Server not running on port 3001 | Run `npm run dev:server` first |
| `Migration already applied` | Re-running existing migration | Check `_migrations` table or skip |
| `tenant_id missing` error | Query missing tenant filter | Add `WHERE tenant_id = ?` to the SQL query |
| `IMAP timeout` | Wrong IMAP credentials or port | Verify host, port (993 for SSL), user, pass in Settings |
| Playwright `browser not found` | Browsers not installed | Run `cd client && npx playwright install chromium` |

## Multi-Tenant Testing Strategy

### Test Tenant
Use a fixed test tenant UUID for all tests: create a test tenant in your test setup with a known ID.

### Tenant Isolation Tests
For every new endpoint, verify:
1. **Data creation**: Created records have the correct `tenant_id`
2. **Data retrieval**: Only returns records matching `req.user.tenantId`
3. **Cross-tenant access**: Attempting to access another tenant's data returns 404 (not 403, to avoid leaking existence)
4. **Bulk operations**: Bulk delete/update only affects current tenant's records

### Test Pattern
```typescript
// Always set tenant context in tests
req.user = { userId: 'test-user', tenantId: 'test-tenant-id', role: 'admin' };

// Verify tenant_id in SQL - the PreToolUse hook checks this automatically
expect(mockQuery).toHaveBeenCalledWith(
  expect.stringContaining('tenant_id'),
  expect.arrayContaining(['test-tenant-id'])
);
```

## Code Review Checklist

### Security
- [ ] All SQL queries include `tenant_id` filter
- [ ] All queries use parameterized statements (no string concatenation)
- [ ] No secrets/tokens in code or logs
- [ ] Input validated with Zod before processing

### Quality
- [ ] TypeScript strict mode, no `any` types
- [ ] Error handling with meaningful messages
- [ ] No `console.log` in production code (use structured logging)
- [ ] API responses follow standard format `{ success, data, pagination?, error? }`

### Frontend
- [ ] All 4 states handled: loading (Skeleton), error (toast), empty (EmptyState), data
- [ ] Accessible: semantic HTML, aria-labels on icon buttons, focus indicators
- [ ] Design system compliant: no arbitrary colors, correct spacing (p-6, p-5, gap-3)
- [ ] Responsive: tested at 375px, 768px, 1280px

### Testing
- [ ] Test file exists for new code
- [ ] Tests cover happy path + error cases
- [ ] Coverage not decreased from baseline

## Deployment Checklist

1. [ ] All tests pass (`npm run test`)
2. [ ] TypeScript compiles without errors
3. [ ] Client builds successfully (`cd client && npm run build`)
4. [ ] Database migrations applied if needed (`npm run db:migrate`)
5. [ ] Tenant config updated if needed (new tenant, changed settings)
6. [ ] Environment variables set in production
7. [ ] Rollback plan identified (previous commit hash)
8. [ ] Monitor error logs after deploy for 15 minutes
