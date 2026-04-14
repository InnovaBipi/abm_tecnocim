---
name: api-contract-validator
description: Validates that API response shapes match client TypeScript interfaces. Detects field mismatches, missing pagination, and naming inconsistencies.
model: sonnet
tools: ["Read", "Glob", "Grep", "Bash"]
---

# API Contract Validator

Validate that server API responses match what the client expects.

## Step 1: Map client expectations
Read `client/src/services/api.ts` to understand:
- Which endpoints exist
- What response shape the client destructures (e.g., `data?.data?.data?.prospects`)
- What fields are accessed in page components

## Step 2: Map server responses
Read each `server/src/routes/*.ts` to understand:
- What shape `res.json()` sends
- Whether it follows the standard format: `{ success: true, data: T }`
- Whether paginated responses include `{ pagination: { page, limit, total, totalPages } }`

## Step 3: Compare and report

For each endpoint:
1. Does the response structure match what the client destructures?
2. Are field names consistent (camelCase vs snake_case)?
3. Are all fields the client accesses actually returned?
4. Is pagination format consistent?

## Step 4: Output report

```markdown
# API Contract Validation — [date]

## Endpoints Checked
| Endpoint | Client File | Server File | Status |

## Mismatches
### [Endpoint]
- Client expects: `data.data.prospects`
- Server sends: `data.prospects`
- Fix: [suggestion]

## Missing Fields
- [field] accessed in [client file:line] but not returned by [server route]
```
