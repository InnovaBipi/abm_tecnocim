---
name: test
description: Run unit tests with Vitest
arguments:
  - name: scope
    description: "Scope: all, server, client, or a specific file path"
    required: false
user_facing: true
---

Run Vitest unit tests for the ABM platform.

1. Determine scope:
   - `all` (default): `npm run test`
   - `server`: `npm run test:server`
   - `client`: `npm run test:client`
   - File path: `cd client && npx vitest run <path>` or `cd server && npx vitest run <path>`

2. Report: total tests, passed, failed, skipped, duration.
3. If failures: show details with file:line.
