---
description: TypeScript coding conventions for backend and frontend
globs: ["**/*.ts", "**/*.tsx"]
alwaysApply: false
paths:
  - "server/src/**/*.ts"
  - "client/src/**/*.ts"
  - "client/src/**/*.tsx"
---

# TypeScript Patterns

## General

- Strict mode enabled (no implicit `any`)
- Avoid `any` type — use `unknown` with type guards when needed
- Exception: MySQL query results can use `any` for row mapping only
- Use `interface` for object shapes, `type` for unions/intersections
- Use `const` by default, `let` only when reassignment needed

## Backend Patterns

### Route Handlers

```typescript
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    // ... business logic
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});
```

### Database Queries

```typescript
// Always use parameterized queries
const rows = await query<RowType[]>(
  'SELECT * FROM prospects WHERE tenant_id = ? AND status = ?',
  [tenantId, status]
);
```

### UUID Generation

```typescript
import { v4 as uuid } from 'uuid';
const id = uuid(); // For all primary keys
```

## Frontend Patterns

### State Management (Zustand)

```typescript
interface AuthState {
  token: string | null;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}
```

### API Calls (React Query + Axios)

```typescript
const { data, isLoading } = useQuery({
  queryKey: ['prospects', page, search],
  queryFn: () => api.get('/prospects', { params: { page, search } }),
});
```

### Component Structure

- Functional components only (no class components)
- Props interface defined inline or in same file
- Use `clsx` + `tailwind-merge` for conditional classes
- Lucide React for icons

## Error Handling

- Backend: try/catch in route handlers, log with `console.error`
- Frontend: React Query error boundaries + react-hot-toast for user feedback
- Never swallow errors silently
