# Architecture Decisions

## MySQL over PostgreSQL
- **Decision**: MySQL 8 with multi-tenant tenant_id column
- **Context**: Forked from camiacasa_abm which already used MySQL. Simple multi-tenancy via shared schema.
- **Alternatives**: PostgreSQL (more features but migration cost), separate schemas per tenant (more isolation but operational complexity)

## JWT in localStorage
- **Decision**: JWT stored in localStorage (known XSS risk, tracked in bugs.md)
- **Context**: Simple implementation for MVP. Migration to HttpOnly cookies planned (tech-debt.md).
- **Impact**: Do not store sensitive data in JWT payload beyond userId, email, role, tenantId.

## Gemini 2.5 Flash for email generation
- **Decision**: Google Gemini over GPT-4 for AI email generation
- **Context**: Cost-effective, fast responses, good at structured output (subject + body_html). Spanish/Catalan language support.
- **Alternatives**: GPT-4 (higher quality but 10x cost), Claude (would create circular dependency)

## Zustand over Redux
- **Decision**: Zustand for global client state (auth only)
- **Context**: Minimal global state needed (just auth). React Query handles all server state. Zustand is simpler, smaller bundle.

## React Query for server state
- **Decision**: TanStack React Query v5 for all API data
- **Context**: Automatic caching (staleTime 30s), refetch on mutation, pagination support. Eliminates need for custom fetch hooks.

## Resend for email delivery
- **Decision**: Resend API over SendGrid/Mailgun
- **Context**: Modern API, webhook support for delivery tracking, good developer experience. Per-tenant API keys stored in tenant config.
