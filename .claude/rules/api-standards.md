---
description: REST API design conventions and endpoint standards
globs: ["server/src/routes/**/*.ts", "server/src/index.ts"]
alwaysApply: false
---

# API Standards

## URL Conventions

- All routes under `/api/` prefix
- Plural nouns for resources: `/api/prospects`, `/api/companies`, `/api/campaigns`
- Nested resources: `/api/campaigns/:id/sequences`
- kebab-case for multi-word: `/api/email-events`

## Response Format

```typescript
// Success
{ success: true, data: T }

// Error
{ success: false, error: string }

// Paginated list
{
  success: true,
  data: T[],
  pagination: { page: number, limit: number, total: number, totalPages: number }
}
```

## Query Parameters

- Pagination: `?page=1&limit=20` (defaults: page=1, limit=20, max limit=100)
- Search: `?search=term` (full-text search)
- Filtering: `?status=active&tier=A`
- Sorting: `?sort=created_at&order=desc`

## HTTP Methods

| Method | Usage | Returns |
|--------|-------|---------|
| GET | List/Read | 200 with data |
| POST | Create | 201 with created entity |
| PUT | Full update | 200 with updated entity |
| PATCH | Partial update | 200 with updated entity |
| DELETE | Remove | 200 with `{ success: true }` |

## Error Codes

- 400: Validation error (Zod)
- 401: Not authenticated
- 403: Insufficient permissions
- 404: Resource not found
- 409: Conflict (duplicate)
- 413: File too large
- 429: Rate limited
- 500: Internal error (hide details in production)

## Rate Limiting

- Auth routes: 10 requests / 15 minutes
- Email sending: 200 / hour
- File uploads: 10 / hour
- General API: no limit (default)

## Route Registration Pattern

```typescript
// In server/src/routes/<resource>.ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth';

const router = Router();
router.use(authenticate); // All routes require auth

router.get('/', listHandler);
router.get('/:id', getHandler);
router.post('/', createHandler);
router.put('/:id', updateHandler);
router.delete('/:id', deleteHandler);

export default router;
```
