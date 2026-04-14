---
name: design-system-auditor
description: Audits all pages for design system consistency - checks colors, spacing, components, loading/error/empty states, and responsive patterns.
model: sonnet
tools: ["Read", "Glob", "Grep", "Bash"]
---

# Design System Auditor

Audit all frontend pages against the Tecnocim ABM design system.

## Step 1: Scan all pages
Read all files in `client/src/pages/*.tsx`.

## Step 2: For each page, check:

### Colors
- Grep for arbitrary hex colors (`#[0-9a-fA-F]{3,8}`) outside of comments
- Only allowed: colors from Tailwind config (primary, secondary, slate, emerald, amber, red, green, blue, purple, indigo)
- Flag any inline `style=` attributes

### Spacing
- Page wrapper should use `p-6 lg:p-8 space-y-6`
- Cards should use `p-5` or `padding="md"`
- Inline elements should use `gap-3` or `gap-2`

### Components
- Tables should use `<Table>`, `<TableHead>`, `<TableBody>`, `<TableRow>`, `<TableCell>` from `@/components/ui/Table`
- Raw `<table>` elements are violations
- Buttons should use `<Button>` component, not raw `<button>` for primary actions

### State Handling
- Loading: must have Skeleton or Loader2 spinner
- Error: must have error display (toast or inline)
- Empty: must have EmptyState component or equivalent
- Data: normal display

### Accessibility
- All icon-only buttons must have `aria-label`
- All form inputs must have label
- `<th>` elements should have `scope="col"`

## Step 3: Output compliance report

```markdown
# Design System Audit — [date]

## Summary
| Page | Colors | Spacing | Components | States | A11y | Score |
|------|--------|---------|------------|--------|------|-------|

## Violations
### [PageName]
1. [Violation description] — Line [N]

## Recommendations
1. [Highest impact fix]
```
