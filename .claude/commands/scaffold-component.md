---
name: scaffold-component
description: Generates a new UI component with Props interface and test file
arguments:
  - name: name
    description: PascalCase component name (e.g., Breadcrumb)
    required: true
user_facing: true
---

Generate a new UI component for the ABM Tecnocim design system:

1. Read `client/src/components/ui/Button.tsx` as the reference for component structure
2. Create `client/src/components/ui/$ARGUMENTS.tsx` with:
   - Props interface defined above the component
   - Named export (not default)
   - `className` prop using `cn()` from `@/lib/utils`
   - Semantic HTML elements
   - Accessible: aria attributes where needed
3. Create `client/src/components/ui/$ARGUMENTS.test.tsx` following Button.test.tsx patterns:
   - Renders without error
   - Applies custom className
   - Tests key prop variants
   - Uses getByRole/getByText semantic queries
