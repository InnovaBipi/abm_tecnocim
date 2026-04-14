---
description: React/TypeScript frontend conventions for the ABM client app
globs: ["client/src/**/*.ts", "client/src/**/*.tsx"]
alwaysApply: false
---

# Frontend Patterns

## Component Structure
- Functional components only (no class components)
- Props interface defined in same file, above the component
- Use `clsx` + `tailwind-merge` for conditional classes
- Lucide React for icons (import from `lucide-react`)

## State Management
- **Global state**: Zustand stores in `client/src/stores/`
- **Server state**: React Query (`@tanstack/react-query`) for API data
- **Local state**: `useState` for UI-only state (modals, form inputs)

## API Calls
- Always use the typed API functions from `client/src/services/api.ts`
- Never call `axios` directly — use the pre-configured `api` instance
- The API client auto-adds Bearer token and handles 401 redirects

## Error Handling
- Use `react-hot-toast` for user-facing error messages
- React Query handles loading/error states — use `isLoading`, `error`
- Never swallow errors silently

## Route Structure
- Pages in `client/src/pages/` map 1:1 to routes in `App.tsx`
- Layout wrapper provides Sidebar + navigation
- ProtectedRoute handles auth redirect

## Testing Patterns

- Every new UI component in `components/ui/` must have a `.test.tsx` file
- Use React Testing Library with semantic queries (getByRole, getByLabelText)
- Test all 4 states: loading, error, empty, data
- Mock API calls with `vi.mock('@/services/api')`
- Never test implementation details (internal state, CSS classes)

## Accessibility Requirements

- All `<button>` elements must have accessible text (visible text or aria-label)
- All icon-only buttons MUST have `aria-label`
- All `<img>` elements must have `alt`
- All form inputs must have associated `<label htmlFor>` or `aria-label`
- Use semantic HTML elements (button, a, nav, main, section, header, footer)
- Never use `onClick` on non-interactive elements without `role="button"` + `tabIndex={0}` + `onKeyDown`
- Color must never be the sole indicator (pair with text/icon)

## Performance Patterns

- Use `keepPreviousData` / `placeholderData` for paginated queries (prevents flash)
- Use `React.memo()` on list item renderers (ProspectRow, CampaignCard)
- Use `useMemo` for derived/computed data from query results
- Use `useCallback` for handlers passed to memoized child components
- Avoid creating new objects/arrays in JSX (extract to const or useMemo)
