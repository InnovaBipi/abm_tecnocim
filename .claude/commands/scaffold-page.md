---
name: scaffold-page
description: Generates a new page with boilerplate including route, sidebar link, and test file
arguments:
  - name: name
    description: PascalCase page name (e.g., Reports)
    required: true
  - name: route
    description: URL route path (e.g., /reports)
  - name: with-api
    description: Also generate a server route file
    default: "false"
user_facing: true
---

Generate a new page for the ABM Tecnocim platform following existing patterns:

1. Read `client/src/pages/Companies.tsx` as the reference template
2. Create `client/src/pages/$ARGUMENTS.tsx` with:
   - Standard page layout (p-6 lg:p-8 space-y-6)
   - Page header with h1 title and description
   - Loading state using SkeletonTable or SkeletonCard
   - Error state with AlertCircle icon
   - Empty state using EmptyState component
   - Data state with table or card grid
3. Add route in `client/src/App.tsx`
4. Add sidebar link in `client/src/components/layout/Sidebar.tsx`
5. Create `client/src/pages/$ARGUMENTS.test.tsx` with baseline render test

If with-api is "true", also create `server/src/routes/<kebab-case-name>.ts` with:
- Standard CRUD endpoints (GET list, GET by id, POST, PUT, DELETE)
- authenticate middleware
- tenant_id in all queries
- Zod validation
