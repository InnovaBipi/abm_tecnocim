---
name: accessibility
description: WCAG 2.2 AA accessibility standards for the ABM platform - semantic HTML, keyboard navigation, ARIA, forms, color contrast, tables, dynamic content, and platform-specific rules.
triggers: ["a11y", "accessibility", "WCAG", "aria", "screen reader", "keyboard", "focus", "alt text", "label", "contrast"]
---

# Accessibility Standards (WCAG 2.2 AA)

## 1. Semantic HTML

### Use the Right Elements

| Instead of... | Use... | Why |
|---------------|--------|-----|
| `<div onClick={...}>` | `<button>` | Buttons are keyboard-accessible by default |
| `<div>` for navigation | `<nav>` | Landmark for screen readers |
| `<div>` for page content | `<main>` | Landmark for skip-to-content |
| `<div>` for list items | `<ul>` + `<li>` | Announces list and item count |
| `<span>` for links | `<a href="...">` | Focusable, right-click context menu |
| `<div>` for sections | `<section>` with heading | Document outline |

### Page Structure

```tsx
<header>       {/* Top bar / branding */}
  <nav>        {/* Main navigation / sidebar */}
</header>
<main>         {/* Page content (one per page) */}
  <h1>         {/* Page title (one per page) */}
  <section>    {/* Logical sections */}
    <h2>       {/* Section headings */}
</main>
<footer>       {/* Optional footer */}
```

## 2. Keyboard Navigation

### Requirements

- All interactive elements must be reachable via `Tab`
- `Escape` closes modals, drawers, and dropdowns
- `Enter` or `Space` activates buttons and links
- Visible focus rings on all focused elements
- Focus is trapped inside open modals

### Focus Indicators

```tsx
// GOOD: visible focus ring
<button className="focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2">

// BAD: removes focus indicator with no replacement
<button className="outline-none">
```

**Rule**: Never use `outline-none` without also adding a `ring` or `border` focus indicator.

### Non-Semantic Interactive Elements

If you must use a non-button element as interactive (strongly discouraged):

```tsx
// Must include ALL three attributes
<div
  role="button"
  tabIndex={0}
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }}
>
```

## 3. Forms

### Labels

Every input must have an associated label:

```tsx
// GOOD: htmlFor links label to input
<label htmlFor="email">Email address</label>
<input id="email" type="email" />

// GOOD: aria-label for visually hidden label
<input aria-label="Search prospects" type="search" placeholder="Search..." />

// BAD: placeholder only, no label
<input type="email" placeholder="Email" />
```

### Error Messages

```tsx
<label htmlFor="email">Email address</label>
<input
  id="email"
  type="email"
  aria-required="true"
  aria-invalid={!!errors.email}
  aria-describedby={errors.email ? 'email-error' : undefined}
/>
{errors.email && (
  <p id="email-error" role="alert" className="text-sm text-red-600 mt-1">
    {errors.email}
  </p>
)}
```

### Required Fields

```tsx
<label htmlFor="name">
  Company name <span aria-hidden="true" className="text-red-500">*</span>
</label>
<input id="name" aria-required="true" />
```

## 4. Color Contrast

### Minimum Ratios (WCAG AA)

| Element | Minimum Ratio | Notes |
|---------|---------------|-------|
| Normal text (< 18px) | 4.5:1 | Body text, labels |
| Large text (>= 18px bold or >= 24px) | 3:1 | Headings |
| UI components and graphics | 3:1 | Borders, icons, focus rings |

### Safe Combinations

| Text Color | Background | Ratio | Pass? |
|-----------|-----------|-------|-------|
| `text-slate-900` (#0f172a) | white | 18.4:1 | Yes |
| `text-slate-700` (#334155) | white | 10.2:1 | Yes |
| `text-slate-500` (#64748b) | white | 4.6:1 | Yes (barely) |
| `text-slate-400` (#94a3b8) | white | 3.2:1 | NO for normal text |
| `text-primary-500` (#ff7f00) | white | 3.1:1 | NO for normal text |

**Rule**: `text-slate-400` is too light for normal text. Use `text-slate-500` minimum.
**Rule**: Orange `primary-500` fails on white for text. Use it for buttons (white text on orange) or large text only.

### Color Must Not Be the Only Indicator

```tsx
// BAD: color only
<span className="text-green-600">{score}</span>

// GOOD: color + icon
<span className="text-green-600 flex items-center gap-1">
  <TrendingUp className="h-3 w-3" aria-hidden="true" />
  {score}
</span>

// GOOD: color + text label
<Badge variant="success">Active</Badge>
```

## 5. Icons

### Decorative Icons (next to text)

```tsx
// Hide from screen readers - the text provides meaning
<button>
  <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
  Add Prospect
</button>
```

### Functional Icons (icon-only buttons)

```tsx
// Must have aria-label - icon is the only content
<button aria-label="Remove prospect">
  <Trash2 className="h-4 w-4" />
</button>

// Or use sr-only text
<button>
  <Trash2 className="h-4 w-4" aria-hidden="true" />
  <span className="sr-only">Remove prospect</span>
</button>
```

## 6. Tables

### Required Markup

```tsx
<table>
  <caption className="sr-only">Prospect list with scores and status</caption>
  <thead>
    <tr>
      <th scope="col">Name</th>
      <th scope="col">Score</th>
      <th scope="col">Status</th>
      <th scope="col">Actions</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>John Doe</td>
      <td><ScoreBadge score={85} /></td>
      <td><StatusBadge status="enriched" /></td>
      <td>
        <button aria-label="Edit John Doe">
          <Pencil className="h-4 w-4" />
        </button>
      </td>
    </tr>
  </tbody>
</table>
```

**Rules:**
- `<th>` must have `scope="col"` or `scope="row"`
- Add `<caption>` (can be `sr-only`) for table purpose
- Action buttons in table rows should include the row subject in `aria-label`

## 7. Dynamic Content

### Toast Notifications

```tsx
// react-hot-toast already uses aria-live regions
// But for custom notifications:
<div role="alert" aria-live="assertive">
  Email sent successfully
</div>
```

### Loading States

```tsx
// Announce loading to screen readers
<div aria-live="polite" aria-busy={isLoading}>
  {isLoading ? <Skeleton /> : <DataContent />}
</div>
```

### Live Regions

| `aria-live` value | Use |
|-------------------|-----|
| `assertive` | Errors, important alerts |
| `polite` | Status updates, loading completion |

## 8. Platform-Specific Rules

### Charts (Recharts)

```tsx
// Every chart needs an accessible description
<div role="img" aria-label="Email open rate trend: 23% this week, up from 18% last week">
  <ResponsiveContainer>
    <LineChart data={data}>
      {/* chart content */}
    </LineChart>
  </ResponsiveContainer>
</div>
```

### Sortable Table Columns

```tsx
<th scope="col" aria-sort={sortBy === 'score' ? sortOrder : 'none'}>
  <button onClick={() => toggleSort('score')}>
    Score
    <ArrowUpDown className="h-3 w-3 ml-1" aria-hidden="true" />
  </button>
</th>
```

Valid `aria-sort` values: `ascending`, `descending`, `none`

### Import Wizard (Multi-Step)

```tsx
<nav aria-label="Import progress">
  <ol>
    <li aria-current={step === 1 ? 'step' : undefined}>
      <span className={step === 1 ? 'font-bold' : ''}>1. Upload</span>
    </li>
    <li aria-current={step === 2 ? 'step' : undefined}>
      <span className={step === 2 ? 'font-bold' : ''}>2. Map Columns</span>
    </li>
    <li aria-current={step === 3 ? 'step' : undefined}>
      <span className={step === 3 ? 'font-bold' : ''}>3. Review</span>
    </li>
  </ol>
</nav>
```

### Modals

```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="modal-title"
>
  <h2 id="modal-title">Confirm Action</h2>
  {/* Focus trap: Tab cycles within modal */}
  {/* Escape closes modal */}
  {/* Focus returns to trigger button on close */}
</div>
```

## Severity Guide for Audits

| Finding | Severity |
|---------|----------|
| Missing form labels | CRITICAL |
| Clickable `<div>` without role/keyboard | HIGH |
| Missing `alt` on images | HIGH |
| Icon-only button without `aria-label` | HIGH |
| `outline-none` without focus replacement | HIGH |
| Missing `scope` on `<th>` | MEDIUM |
| Missing `aria-sort` on sortable columns | MEDIUM |
| Missing `aria-live` on dynamic content | MEDIUM |
| Missing `<caption>` on table | LOW |
| Decorative icon without `aria-hidden` | LOW |
