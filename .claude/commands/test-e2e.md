---
name: test-e2e
description: Run Playwright E2E tests
arguments:
  - name: flow
    description: "Flow: login, import, campaign, outbox, dashboard, or all"
    required: false
user_facing: true
---

Run Playwright end-to-end tests for the ABM platform.

Prerequisites: dev server running (`npm run dev`).

1. Verify server: `curl -s http://localhost:3001/api/health`
2. Run Playwright:
   - `all`: `cd client && npx playwright test`
   - Specific: `cd client && npx playwright test playwright/<flow>.spec.ts`
3. On failure: show HTML report path.
