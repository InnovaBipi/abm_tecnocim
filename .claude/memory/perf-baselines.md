# Performance Baselines

## 2026-04-13 — Post-fork baseline

### Bundle Size
- Client build: ~268KB gzipped
- Target: <500KB gzipped
- Status: OK (54% of target)

### Key Dependencies
- React 19 + ReactDOM
- Recharts (charts)
- @tanstack/react-query (server state)
- react-router-dom (routing)
- zustand (auth state)
- axios (HTTP)
- lucide-react (icons)
- date-fns (date formatting)

### Pages
- 11 routes, NO lazy loading (all direct imports in App.tsx)
- Recommendation: add React.lazy() for non-critical pages

### Components
- 21 UI components in client/src/components/ui/
- 1/21 has tests (Button.test.tsx)

### Server
- Express 4 + TypeScript
- MySQL connection pool: connectionLimit 10
- 7 cron jobs running in-process
