---
name: performance
description: Performance guidelines for the ABM platform — React Query caching, memoization, code splitting, bundle targets, server query optimization, and API response time targets.
triggers: ["performance", "perf", "slow", "optimize", "bundle", "cache", "memo", "lazy", "N+1", "query time", "staleTime"]
---

# Performance Guidelines

## React Query Caching

| Query Type | `staleTime` | `gcTime` | Notes |
|------------|-------------|----------|-------|
| List queries (prospects, campaigns) | `30_000` (30s) | `300_000` (5m) | User expects near-real-time lists |
| Detail queries (single prospect) | `60_000` (60s) | `600_000` (10m) | Less frequently changing |
| Config / settings | `300_000` (5m) | `Infinity` | Rarely changes |
| Dashboard stats | `15_000` (15s) | `60_000` (1m) | Should feel live |

### Pagination

Use `keepPreviousData` (React Query v4) or `placeholderData: keepPreviousData` (v5) for paginated queries to prevent content flash when changing pages:

```typescript
const { data, isLoading } = useQuery({
  queryKey: ['prospects', { page, limit, search }],
  queryFn: () => api.getProspects({ page, limit, search }),
  staleTime: 30_000,
  placeholderData: keepPreviousData, // Keeps old data visible while fetching new page
});
```

### Invalidation Strategy

```typescript
// After create/update, invalidate the list query
const mutation = useMutation({
  mutationFn: api.createProspect,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['prospects'] });
    toast.success('Prospect created');
  },
});
```

## Memoization

### React.memo for List Renderers

Wrap components rendered inside `.map()` loops to prevent re-renders when sibling items change:

```typescript
// ProspectRow.tsx
export const ProspectRow = React.memo(function ProspectRow({ prospect, onSelect }: Props) {
  return (
    <tr>
      <td>{prospect.name}</td>
      <td><ScoreBadge score={prospect.score} /></td>
      <td><StatusBadge status={prospect.status} /></td>
    </tr>
  );
});
```

**When to use `React.memo`:**
- List item renderers (ProspectRow, CampaignCard, EmailRow)
- Components receiving stable but complex props
- Components that are expensive to render (charts, tables)

**When NOT to use:**
- Components that always receive new props
- Simple leaf components (Badge, Button)
- Components rendered only once

### useMemo for Computed Data

```typescript
// Compute derived data from query results
const enrichedCount = useMemo(
  () => prospects?.filter(p => p.status === 'enriched').length ?? 0,
  [prospects]
);

const sortedProspects = useMemo(
  () => [...(prospects ?? [])].sort((a, b) => b.score - a.score),
  [prospects]
);
```

### useCallback for Handlers to Memoized Children

```typescript
const handleSelect = useCallback((id: string) => {
  setSelectedIds(prev => prev.includes(id)
    ? prev.filter(x => x !== id)
    : [...prev, id]
  );
}, []);

// Pass to memoized child
<ProspectRow key={p.id} prospect={p} onSelect={handleSelect} />
```

### Avoid Inline Object/Array Creation in JSX

```typescript
// BAD: creates a new object every render, breaks memo
<ProspectRow style={{ marginTop: 8 }} data={prospect} />

// GOOD: extract to const or useMemo
const rowStyle = useMemo(() => ({ marginTop: 8 }), []);
<ProspectRow style={rowStyle} data={prospect} />
```

## Code Splitting

### Lazy-load Pages

```typescript
// App.tsx
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const Prospects = React.lazy(() => import('./pages/Prospects'));
const Campaigns = React.lazy(() => import('./pages/Campaigns'));

function App() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/prospects" element={<Prospects />} />
        <Route path="/campaigns" element={<Campaigns />} />
      </Routes>
    </Suspense>
  );
}
```

**Rules:**
- Every page component should be lazy-loaded
- Use `<Suspense>` with a skeleton fallback (not a spinner)
- Heavy libraries (Recharts, date-fns) are tree-shaken by Vite automatically
- Named exports need: `React.lazy(() => import('./Page').then(m => ({ default: m.Page })))`

## Bundle Size Targets

| Metric | Target | Action if Exceeded |
|--------|--------|--------------------|
| Initial JS (gzipped) | < 300KB | Audit imports, lazy-load more pages |
| Total JS (gzipped) | < 500KB | Check for duplicate dependencies |
| Largest chunk | < 80KB | Split the chunk or lazy-load |
| CSS (gzipped) | < 30KB | Purge unused Tailwind classes |

### Checking Bundle Size

```bash
# Build and analyze
cd client && npm run build
# Vite outputs chunk sizes after build

# Detailed analysis (if vite-plugin-visualizer installed)
npx vite-bundle-visualizer
```

## Server Performance

### Database Query Rules

1. **LIMIT on every SELECT** — never return unbounded result sets
   ```sql
   -- GOOD
   SELECT * FROM prospects WHERE tenant_id = ? LIMIT 20 OFFSET 0;

   -- BAD: returns all rows
   SELECT * FROM prospects WHERE tenant_id = ?;
   ```

2. **No N+1 queries** — use JOINs or batch queries
   ```typescript
   // BAD: N+1 — one query per prospect to get company
   for (const prospect of prospects) {
     const company = await query('SELECT * FROM companies WHERE id = ?', [prospect.company_id]);
   }

   // GOOD: single JOIN
   const results = await query(`
     SELECT p.*, c.name as company_name, c.domain as company_domain
     FROM prospects p
     LEFT JOIN companies c ON p.company_id = c.id
     WHERE p.tenant_id = ?
     LIMIT ? OFFSET ?
   `, [tenantId, limit, offset]);
   ```

3. **Compound indexes** for common query patterns
   ```sql
   -- For prospect listing with search
   CREATE INDEX idx_prospects_tenant_status ON prospects(tenant_id, status);
   CREATE INDEX idx_prospects_tenant_score ON prospects(tenant_id, score DESC);
   CREATE INDEX idx_email_events_tenant_date ON email_events(tenant_id, created_at DESC);
   ```

4. **Connection pool** — max 10 connections per pool
   ```typescript
   const pool = mysql.createPool({
     connectionLimit: 10,
     waitForConnections: true,
     queueLimit: 0,
   });
   ```

## API Response Time Targets

| Endpoint Type | Target | Example |
|---------------|--------|---------|
| List queries | < 200ms | `GET /api/prospects?page=1` |
| Detail queries | < 100ms | `GET /api/prospects/:id` |
| Create / Update | < 300ms | `POST /api/prospects` |
| AI generation | < 15s | `POST /api/campaigns/:id/generate` |
| File upload + parse | < 5s | `POST /api/imports/upload` |

### Measuring Performance

```typescript
// Add timing middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 500) {
      console.warn(`Slow request: ${req.method} ${req.path} — ${duration}ms`);
    }
  });
  next();
});
```

## Performance Anti-Patterns

| Anti-Pattern | Fix |
|-------------|-----|
| `useQuery` without `staleTime` | Add `staleTime: 30_000` minimum |
| Paginated query without `placeholderData` | Add `placeholderData: keepPreviousData` |
| `.map()` without `React.memo` on children | Wrap list item component in `React.memo` |
| Inline `{{ }}` objects in JSX | Extract to `const` or `useMemo` |
| `SELECT *` without LIMIT | Always add `LIMIT ? OFFSET ?` |
| Loop with individual queries | Use JOIN or `WHERE id IN (?)` |
| Importing full library | Import specific functions: `import { format } from 'date-fns'` |
| Large component not lazy-loaded | Use `React.lazy()` for pages |
