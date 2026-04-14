---
name: testing
description: Testing conventions for the ABM platform — Vitest + React Testing Library for unit/component tests, Playwright for E2E. Covers patterns, file naming, multi-tenant isolation, and coverage targets.
triggers: ["test", "testing", "vitest", "playwright", "coverage", "unit test", "e2e", "integration test", "spec"]
---

# Testing Conventions

## Stack

| Layer | Tool | Config |
|-------|------|--------|
| Unit / Component | Vitest + React Testing Library | `vitest.config.ts` |
| E2E | Playwright | `playwright.config.ts` |
| Assertions | Vitest `expect` + `@testing-library/jest-dom` | — |
| Mocking | `vi.mock()` / `vi.fn()` / `vi.spyOn()` | — |

## File Naming & Location

| Type | Pattern | Location |
|------|---------|----------|
| Server unit test | `*.test.ts` | Colocated next to source file |
| Component test | `*.test.tsx` | Colocated next to component |
| E2E test | `*.spec.ts` | `playwright/` directory |

Examples:
- `server/src/services/ai.test.ts` — tests `ai.ts`
- `client/src/components/ui/Badge.test.tsx` — tests `Badge.tsx`
- `playwright/login.spec.ts` — E2E login flow

## Server Test Pattern

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module BEFORE importing the service
vi.mock('../config/database', () => ({
  query: vi.fn(),
}));

// Mock external services
vi.mock('../services/ai', () => ({
  generateEmail: vi.fn(),
}));

import { query } from '../config/database';
import { listProspects } from './prospects';

const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000099';

describe('listProspects', () => {
  const mockReq = {
    user: { tenantId: TEST_TENANT_ID, userId: 'test-user-id', role: 'admin' },
    query: { page: '1', limit: '20' },
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns paginated prospects for the tenant', async () => {
    (query as any).mockResolvedValueOnce([[{ id: 'p1', email: 'test@example.com' }]]);
    (query as any).mockResolvedValueOnce([[{ total: 1 }]]);

    const result = await listProspects(mockReq);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('tenant_id'),
      expect.arrayContaining([TEST_TENANT_ID])
    );
    expect(result.data).toHaveLength(1);
  });

  it('never returns prospects from another tenant', async () => {
    (query as any).mockResolvedValueOnce([[]]);
    (query as any).mockResolvedValueOnce([[{ total: 0 }]]);

    const result = await listProspects(mockReq);

    // Verify the query used the correct tenant_id
    const callArgs = (query as any).mock.calls[0];
    expect(callArgs[1]).toContain(TEST_TENANT_ID);
  });
});
```

**Key rules for server tests:**
- Always mock `../config/database` — never hit a real database
- Always set `req.user.tenantId` to the fixed test UUID
- Verify every SQL query includes `tenant_id` in its parameters
- Mock all external services: Gemini, Perplexity, Firecrawl, Resend
- Test both happy path and error cases (invalid input, DB error, not found)

## Component Test Pattern

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Badge } from './Badge';

// Wrapper for components that need React Query
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('Badge', () => {
  it('renders with the correct text', () => {
    render(<Badge variant="success">Active</Badge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('applies the correct color for status variant', () => {
    render(<Badge variant="danger">Bounced</Badge>);
    const badge = screen.getByText('Bounced');
    expect(badge).toHaveClass('bg-red-100');
  });
});
```

**Selector priority (most to least preferred):**

1. `getByRole('button', { name: 'Save' })` — accessible role + name
2. `getByLabelText('Email address')` — form inputs with labels
3. `getByText('No prospects yet')` — visible text content
4. `getByPlaceholderText('Search...')` — form placeholders
5. `getByTestId('prospect-row')` — last resort only

**Never test:**
- CSS class names directly (test visual behavior instead)
- Internal component state
- Implementation details (function calls within component)

## E2E Test Pattern (Playwright)

```typescript
import { test, expect } from '@playwright/test';

const TEST_USER = {
  email: 'test@tecnocim.com',
  password: 'Test1234!',
};

test.describe('Campaign Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.getByLabel('Email').fill(TEST_USER.email);
    await page.getByLabel('Password').fill(TEST_USER.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForURL('/');
  });

  test('create a new campaign', async ({ page }) => {
    await page.getByRole('link', { name: /campaigns/i }).click();
    await page.getByRole('button', { name: /new campaign/i }).click();

    await page.getByLabel('Campaign name').fill('Test Campaign');
    await page.getByLabel('Service').fill('AI Consulting');
    await page.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByText('Test Campaign')).toBeVisible();
  });
});
```

**E2E conventions:**
- Always use semantic selectors: `getByRole`, `getByLabel`, `getByText`
- Login in `beforeEach` (not `beforeAll` — each test gets a fresh session)
- Use the test tenant credentials only
- Wait for navigation with `waitForURL` or element visibility
- Clean up test data in `afterEach` if the test creates records

## Multi-Tenant Test Isolation

- **Fixed test tenant UUID**: `00000000-0000-0000-0000-000000000099`
- Server tests: set `req.user.tenantId` to this UUID in every mock request
- E2E tests: use dedicated test tenant credentials
- Never share test data between test suites
- Never run tests against production data

## Coverage Targets

| Area | Target | Rationale |
|------|--------|-----------|
| Server services | 60% | Business logic, most value |
| Server middleware | 80% | Critical path (auth, tenant) |
| UI components (`components/ui/`) | 50% | Reusable, stable interfaces |
| Pages | 30% | Integration-heavy, covered by E2E |

## 5 Critical E2E Flows

These flows must always pass before deployment:

1. **Login**: Navigate to `/login`, enter credentials, verify redirect to dashboard
2. **Import CSV**: Upload file, map columns, confirm import, verify prospect count increases
3. **Create Campaign + Generate Emails**: Create campaign, add prospects, trigger AI email generation, verify emails appear
4. **Outbox Approve + Send**: Navigate to outbox, preview email, approve, verify status changes to scheduled/sent
5. **Dashboard**: Verify stat cards load, charts render, recent activity displays

## Running Tests

```bash
npm run test              # All unit tests
npm run test:server       # Server only
npm run test:client       # Client only
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage report
npm run test:e2e          # Playwright headless
npm run test:e2e:ui       # Playwright UI mode
```
