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
