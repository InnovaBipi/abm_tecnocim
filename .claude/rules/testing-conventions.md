---
description: Testing conventions for unit, component, and E2E tests
globs: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"]
alwaysApply: false
---

# Testing Conventions

## File Structure
- Unit/component tests: `<source-file>.test.ts(x)` colocated next to source
- E2E tests: `client/playwright/<flow-name>.spec.ts`
- Test utilities: `<package>/src/__tests__/helpers.ts`

## Server Test Pattern
- Mock database with `vi.mock('../config/database')`
- Mock external services (Gemini, Perplexity, Firecrawl, Resend)
- Always set `req.user = { userId: 'test-user', tenantId: 'test-tenant-id', role: 'admin' }`
- Verify tenant_id is included in all SQL queries

## Component Test Pattern
- Use `@testing-library/react` for rendering
- Use `@testing-library/user-event` for interactions
- Query by role/label/text, NOT by class/id/testid
- Test all states: loading, error, empty, data

## E2E Test Pattern
- Login in `beforeEach` using the tecnocim test tenant
- Use semantic selectors (getByRole, getByLabel, getByText)
- Keep tests independent (no ordering dependencies)

## What NOT to Test
- Third-party library internals (React Query, Zustand, Recharts)
- CSS styling / visual appearance
- Implementation details (internal state values)
