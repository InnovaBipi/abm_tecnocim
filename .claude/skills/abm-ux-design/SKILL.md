---
name: abm-ux-design
description: Tecnocim ABM design system with colors, typography, component specs, and page layout patterns. Use when building or modifying any frontend component.
triggers: ["design", "UI", "UX", "component", "color", "style", "layout", "button", "card", "table", "modal", "form", "badge"]
---

# Tecnocim ABM Design System

## Brand Colors

### Primary (Naranja Tecnocim)
| Token | Hex | Tailwind | Use |
|-------|-----|----------|-----|
| primary-50 | #fff7ed | bg-primary-50 | Hover backgrounds |
| primary-100 | #fff3e6 | bg-primary-100 | Selected states, light fills |
| primary-500 | #ff7f00 | text-primary-500 | Primary buttons, links, accents |
| primary-600 | #e56d00 | bg-primary-600 | Button hover |
| primary-700 | #cc5f00 | bg-primary-700 | Active/pressed states |

### Secondary (Azul)
| Token | Hex | Use |
|-------|-----|-----|
| secondary-500 | #1863dc | Secondary actions, links, info badges |
| secondary-600 | #1452b8 | Hover |

### Neutrals
| Token | Hex | Use |
|-------|-----|-----|
| navy | #181b31 | Headings, primary text |
| navy-light | #293c5b | Secondary text |
| slate-500 | #64748b | Muted text, placeholders |
| slate-200 | #e2e8f0 | Borders |
| slate-100 | #f1f5f9 | Table headers, alternating rows |
| slate-50 | #f8fafc | Page background |

### Semantic
| Color | Hex | Use |
|-------|-----|-----|
| Success | #16a34a | Positive states, sent, active |
| Warning | #f59e0b | Pending, draft, warm-up |
| Danger | #dc2626 | Errors, rejected, bounced |
| Info | #1863dc | Information, tips |

## Typography (Poppins)

```css
font-family: 'Poppins', system-ui, -apple-system, sans-serif;
```

| Element | Size | Weight | Tailwind |
|---------|------|--------|----------|
| Page title (H1) | 28px | 700 bold | text-[28px] font-bold |
| Section title (H2) | 22px | 600 semibold | text-[22px] font-semibold |
| Card title (H3) | 18px | 600 semibold | text-lg font-semibold |
| Body | 14px | 400 regular | text-sm |
| Small/Label | 12px | 500 medium | text-xs font-medium |
| Stat number | 32px | 700 bold | text-[32px] font-bold |

## Component Specifications

### Page Layout Pattern
```tsx
<div className="p-6 space-y-6">
  {/* Page Header */}
  <div className="flex items-center justify-between">
    <div>
      <h1 className="text-[28px] font-bold text-slate-900">Page Title</h1>
      <p className="text-sm text-slate-500 mt-1">Brief description</p>
    </div>
    <div className="flex gap-3">
      {/* Action buttons */}
    </div>
  </div>

  {/* Filter bar */}
  <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 p-4">
    {/* Search + filters */}
  </div>

  {/* Content */}
  <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
    {/* Table or cards */}
  </div>
</div>
```

### Stat Card
```tsx
<div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
  <div className="flex items-center justify-between">
    <div className="p-2 rounded-lg bg-primary-100">
      <Icon className="h-5 w-5 text-primary-600" />
    </div>
    <Sparkline data={[...]} />
  </div>
  <p className="text-[32px] font-bold text-slate-900 mt-3">1,234</p>
  <p className="text-xs text-slate-500 mt-1">Total Prospects</p>
</div>
```

### Empty State
```tsx
<div className="text-center py-12">
  <div className="mx-auto w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mb-4">
    <Icon className="h-6 w-6 text-slate-400" />
  </div>
  <h3 className="text-lg font-semibold text-slate-900">No items yet</h3>
  <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">Description text</p>
  <Button className="mt-4">Call to Action</Button>
</div>
```

### Loading Skeleton
```tsx
<div className="animate-pulse space-y-4">
  <div className="h-4 bg-slate-200 rounded w-3/4" />
  <div className="h-4 bg-slate-200 rounded w-1/2" />
  <div className="h-32 bg-slate-200 rounded" />
</div>
```

### Score Badge
```tsx
// Score 0-100: red <40, amber 40-69, green 70+
const color = score >= 70 ? 'text-green-700 bg-green-100'
            : score >= 40 ? 'text-amber-700 bg-amber-100'
            : 'text-red-700 bg-red-100';
<span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>
  {score}
</span>
```

### Status Badge Colors
| Status | Color | Tailwind |
|--------|-------|----------|
| new | slate | bg-slate-100 text-slate-700 |
| enriched | blue | bg-blue-100 text-blue-700 |
| qualified | purple | bg-purple-100 text-purple-700 |
| contacted | amber | bg-amber-100 text-amber-700 |
| replied | green | bg-green-100 text-green-700 |
| interested | emerald | bg-emerald-100 text-emerald-700 |
| meeting | indigo | bg-indigo-100 text-indigo-700 |
| converted | primary | bg-primary-100 text-primary-700 |
| bounced | red | bg-red-100 text-red-700 |
| unsubscribed | slate | bg-slate-200 text-slate-600 |
| draft | amber | bg-amber-100 text-amber-700 |
| active | green | bg-green-100 text-green-700 |
| paused | slate | bg-slate-100 text-slate-600 |
| completed | blue | bg-blue-100 text-blue-700 |
| sent | green | bg-green-100 text-green-700 |
| opened | blue | bg-blue-100 text-blue-700 |

## Spacing System

| Name | Size | Use |
|------|------|-----|
| page-padding | 24px (p-6) | Outer page padding |
| section-gap | 24px (space-y-6) | Between page sections |
| card-padding | 20px (p-5) | Inside cards |
| inline-gap | 12px (gap-3) | Between inline elements |
| compact-gap | 8px (gap-2) | Tight spacing |

## Responsive Breakpoints

| Breakpoint | Width | Columns |
|------------|-------|---------|
| Mobile | <640px | 1 column |
| Tablet | 640-1023px | 2 columns |
| Desktop | 1024-1279px | 3 columns |
| Wide | 1280px+ | 4 columns |

Grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4`
