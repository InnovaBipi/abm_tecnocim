---
name: ux-review
description: UX review checklist for ABM platform pages — design system compliance, state handling, interaction patterns, responsive behavior, and data display conventions.
triggers: ["ux", "review", "design review", "UI review", "checklist", "quality", "polish", "look and feel"]
---

# UX Review Checklist

Use this checklist when reviewing any page or component for UX quality. Every item must pass before a page is considered production-ready.

## 1. Design System Compliance

### Colors
- [ ] Only brand colors are used — no arbitrary hex values
  - Primary orange: `#ff7f00` (Tailwind: `primary-500`, `primary-600`, etc.)
  - Secondary blue: `#1863dc` (Tailwind: `secondary-500`, `secondary-600`)
  - Neutrals: `slate-*` and `navy` tokens only
  - Semantic: green for success, amber for warning, red for danger, blue for info
- [ ] No raw color values like `text-[#abc123]` or inline `style={{ color: '...' }}`
- [ ] Status badges use the correct color mapping (see `abm-ux-design` skill)

### Typography
- [ ] Font family is Poppins everywhere (set globally, no overrides)
- [ ] Page title: `text-[28px] font-bold`
- [ ] Section title: `text-[22px] font-semibold`
- [ ] Card title: `text-lg font-semibold`
- [ ] Body text: `text-sm` (14px)
- [ ] Labels/small: `text-xs font-medium`
- [ ] Stat numbers: `text-[32px] font-bold`

### Icons
- [ ] All icons from `lucide-react` — no other icon library
- [ ] Consistent sizing: `h-4 w-4` inline, `h-5 w-5` in buttons, `h-6 w-6` in empty states
- [ ] Decorative icons have `aria-hidden="true"`
- [ ] Functional (icon-only) buttons have `aria-label`

### Spacing
- [ ] Page padding: `p-6`
- [ ] Section gap: `space-y-6`
- [ ] Card padding: `p-5`
- [ ] Inline gap: `gap-3`
- [ ] Compact gap: `gap-2`

## 2. State Handling

Every page and data-fetching component must handle all four states:

### Loading State
- [ ] Shows skeleton placeholders (not a spinner for initial load)
- [ ] Skeleton matches the shape of the real content
- [ ] Uses `animate-pulse` with `bg-slate-200 rounded`

### Error State
- [ ] Displays a toast notification via `react-hot-toast`
- [ ] Does not crash or show a blank page
- [ ] Provides a retry action when appropriate

### Empty State
- [ ] Shows an `EmptyState` component with:
  - Relevant icon in a `rounded-xl bg-slate-100` container
  - Clear title ("No prospects yet")
  - Helpful description
  - Call-to-action button (e.g., "Import CSV", "Create Campaign")
- [ ] Empty state CTA links to the logical next action

### Data State
- [ ] Data renders correctly with proper formatting
- [ ] Pagination works if more than 20 items
- [ ] Sorting works on table columns (where applicable)

## 3. Interaction Patterns

### Async Buttons
- [ ] Buttons that trigger API calls show a loading spinner while pending
- [ ] Button is disabled during the async operation (prevents double-submit)
- [ ] Pattern: `<Button disabled={isPending}>{isPending ? <Loader2 className="animate-spin" /> : 'Save'}</Button>`

### Destructive Actions
- [ ] All destructive actions (delete, remove, reject) require `ConfirmDialog`
- [ ] Confirm dialog uses danger variant (red button)
- [ ] Dialog clearly states what will happen ("Delete 5 prospects permanently?")

### Feedback
- [ ] Success actions show a toast: `toast.success('Prospect created')`
- [ ] Error actions show a toast: `toast.error('Failed to save')`
- [ ] Toasts are concise (1 sentence) and actionable

### Forms
- [ ] All inputs have visible labels (not just placeholder)
- [ ] Validation errors appear below the input
- [ ] Submit button is in the bottom-right of the form/modal
- [ ] Cancel button is to the left of the submit button

## 4. Responsive Design

### Mobile (< 640px)
- [ ] Single column layout
- [ ] Sidebar collapses to hamburger menu
- [ ] Tables switch to card layout or horizontal scroll
- [ ] Touch targets minimum 44x44px

### Tablet (640px - 1023px)
- [ ] 2-column grid for cards: `sm:grid-cols-2`
- [ ] Sidebar may collapse with toggle

### Desktop (1024px+)
- [ ] Full sidebar visible
- [ ] Multi-column grids: `lg:grid-cols-3 xl:grid-cols-4`
- [ ] Tables display all columns

### Responsive Classes Checklist
- [ ] Stat cards: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`
- [ ] Content grids use responsive breakpoints
- [ ] No horizontal overflow on any viewport width

## 5. Data Display

### Numbers
- [ ] Use `es-AR` locale formatting: `1.234` (dot as thousand separator)
- [ ] Percentages show one decimal: `23,5%`
- [ ] Currency with symbol: `$1.234,56`
- [ ] Large numbers abbreviated in stat cards: `1.2K`, `34.5K`

### Dates
- [ ] Relative dates for recent: "hace 2 horas", "ayer"
- [ ] Absolute dates for older: "15 mar 2025"
- [ ] Full datetime on hover (tooltip)

### Score Badges
- [ ] Score 0-39: red (`text-red-700 bg-red-100`)
- [ ] Score 40-69: amber (`text-amber-700 bg-amber-100`)
- [ ] Score 70-100: green (`text-green-700 bg-green-100`)
- [ ] Rounded pill shape: `rounded-full px-2 py-0.5 text-xs font-bold`

### Status Badges
- [ ] Follow the color mapping from `abm-ux-design` skill
- [ ] Consistent badge component used everywhere (not ad-hoc spans)
- [ ] Badge text is capitalized or sentence-case (not ALL CAPS)

## Quick Review Flow

When reviewing a page:

1. **Open the page** — does it load without errors?
2. **Check loading** — disconnect network, does skeleton appear?
3. **Check empty** — with no data, is there a helpful empty state?
4. **Check error** — force an API error, does a toast appear?
5. **Check colors** — any non-brand colors visible?
6. **Check icons** — any non-Lucide icons?
7. **Check spacing** — consistent with design system?
8. **Resize viewport** — does it work at 375px, 768px, 1280px?
9. **Check interactions** — buttons show loading? Destructive actions confirm?
10. **Check data format** — numbers, dates, scores formatted correctly?
