---
name: frontend-dev
description: Frontend development guide for the ABM platform — React 19 + Vite 6 + TypeScript + Tailwind CSS 3 stack, patterns for creating pages, components, and API integrations.
triggers: ["frontend", "react", "component", "page", "route", "vite", "tailwind", "zustand", "react query", "client"]
---

# Frontend Development Guide

## Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 19 | UI framework |
| Vite | 6 | Build tool + dev server |
| TypeScript | strict mode | Type safety |
| Tailwind CSS | 3 | Utility-first styling |
| Zustand | latest | Global state (auth) |
| React Query | @tanstack/react-query | Server state + caching |
| Recharts | latest | Charts and data visualization |
| React Hot Toast | latest | Toast notifications |
| Lucide React | latest | Icon library |
| React Router | v6 | Client-side routing |

## Key Files

| File | Purpose |
|------|---------|
| `client/src/App.tsx` | Root component with React Router routes, Suspense boundary, QueryClientProvider |
| `client/src/services/api.ts` | Axios instance with auth interceptors, all typed API functions |
| `client/src/stores/authStore.ts` | Zustand store for auth state (user, token, login/logout) |
| `client/src/lib/utils.ts` | Utility functions: `cn()` for class merging, formatters, date helpers |
| `client/src/components/layout/Layout.tsx` | Main layout wrapper with sidebar + content area |
| `client/src/components/layout/Sidebar.tsx` | Navigation sidebar with route links and active states |


## Creating a New Page

### Step 1: Create the page file

```typescript
// client/src/pages/NewPage.tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { FileText } from 'lucide-react';
import toast from 'react-hot-toast';

export default function NewPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['new-resource'],
    queryFn: api.getNewResource,
    staleTime: 30_000,
  });

  if (isLoading) return <PageSkeleton />;
  if (error) {
    toast.error('Failed to load data');
    return null;
  }
  if (!data?.length) {
    return (
      <EmptyState
        icon={FileText}
        title="No items yet"
        description="Get started by creating your first item."
        actionLabel="Create Item"
        onAction={() => {/* navigate or open modal */}}
      />
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-bold text-slate-900">Page Title</h1>
          <p className="text-sm text-slate-500 mt-1">Brief description</p>
        </div>
      </div>
      {/* Page content */}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      <div className="h-8 bg-slate-200 rounded w-1/3" />
      <div className="h-4 bg-slate-200 rounded w-1/2" />
      <div className="h-64 bg-slate-200 rounded" />
    </div>
  );
}
```

### Step 2: Add route in App.tsx

```typescript
const NewPage = React.lazy(() => import('./pages/NewPage'));

// Inside <Routes>:
<Route path="/new-page" element={
  <ProtectedRoute>
    <NewPage />
  </ProtectedRoute>
} />
```

### Step 3: Add sidebar link in Sidebar.tsx

```typescript
{ name: 'New Page', href: '/new-page', icon: FileText },
```


## Creating a UI Component

### Step 1: Create the component file

```typescript
// client/src/components/ui/StatusIndicator.tsx
import { cn } from '@/lib/utils';

interface StatusIndicatorProps {
  status: 'active' | 'paused' | 'completed';
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusIndicator({ status, size = 'md', className }: StatusIndicatorProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
        status === 'active' && 'bg-green-100 text-green-700',
        status === 'paused' && 'bg-slate-100 text-slate-600',
        status === 'completed' && 'bg-blue-100 text-blue-700',
        className
      )}
    >
      {status}
    </span>
  );
}
```

**Rules for UI components:**
- File in `client/src/components/ui/`
- `Props` interface defined above the component
- Use `cn()` from `@/lib/utils` for conditional class merging
- Accept `className` prop for external customization
- Named export (not default)
- No business logic — pure presentation


## API Integration

### Defining API Functions

```typescript
// client/src/services/api.ts

interface Prospect {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  score: number;
  status: string;
}

interface PaginatedResponse<T> {
  success: true;
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export const api = {
  getProspects: async (params: { page?: number; limit?: number; search?: string }) => {
    const { data } = await axiosInstance.get<PaginatedResponse<Prospect>>('/api/prospects', { params });
    return data;
  },

  createProspect: async (prospect: Partial<Prospect>) => {
    const { data } = await axiosInstance.post('/api/prospects', prospect);
    return data;
  },
};
```

### Using Queries in Components

```typescript
// Read data
const { data, isLoading, error } = useQuery({
  queryKey: ['prospects', { page, search }],
  queryFn: () => api.getProspects({ page, search }),
  staleTime: 30_000,
  placeholderData: keepPreviousData,
});

// Write data
const createMutation = useMutation({
  mutationFn: api.createProspect,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['prospects'] });
    toast.success('Prospect created');
    setIsModalOpen(false);
  },
  onError: () => {
    toast.error('Failed to create prospect');
  },
});
```

## State Management

| What | Where | Why |
|------|-------|-----|
| Auth (user, token) | Zustand (`authStore`) | Persisted, global, not server data |
| Server data (prospects, campaigns) | React Query | Cached, auto-refetch, loading states |
| UI state (modal open, selected tab) | `useState` | Component-local, no sharing needed |
| Form state | `useState` or React Hook Form | Per-form, ephemeral |
| URL state (page, filters) | URL search params | Shareable, browser back/forward |

### Auth Store Pattern

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuthState {
  token: string | null;
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      login: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'auth-storage' }
  )
);
```


## Directory Structure

```
client/src/
├── pages/                    # Route pages (one file per route)
│   ├── Dashboard.tsx
│   ├── Prospects.tsx
│   ├── ProspectDetail.tsx
│   ├── Companies.tsx
│   ├── Campaigns.tsx
│   ├── CampaignDetail.tsx
│   ├── Outbox.tsx
│   ├── Imports.tsx
│   ├── Settings.tsx
│   └── Login.tsx
├── components/
│   ├── layout/               # Layout components
│   │   ├── Layout.tsx        # Main layout wrapper
│   │   ├── Sidebar.tsx       # Navigation sidebar
│   │   └── ProtectedRoute.tsx
│   └── ui/                   # Reusable UI components
│       ├── Badge.tsx
│       ├── Button.tsx
│       ├── Card.tsx
│       ├── ConfirmDialog.tsx
│       ├── DateRangePicker.tsx
│       ├── Drawer.tsx
│       ├── EmptyState.tsx
│       ├── Input.tsx
│       ├── Modal.tsx
│       ├── Pagination.tsx
│       ├── ProgressBar.tsx
│       ├── Select.tsx
│       ├── Skeleton.tsx
│       ├── SortableHeader.tsx
│       ├── Table.tsx
│       ├── Tabs.tsx
│       ├── Textarea.tsx
│       ├── Timeline.tsx
│       ├── Toggle.tsx
│       └── Tooltip.tsx
├── services/
│   └── api.ts                # Axios client + all API functions
├── stores/
│   └── authStore.ts          # Zustand auth state
└── lib/
    └── utils.ts               # cn(), formatters, helpers
```
