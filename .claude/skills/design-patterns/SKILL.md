---
name: design-patterns
description: Common UI patterns for ABM platform pages - data tables, filter bars, wizards, dashboards, detail pages, and forms with code examples
triggers: ["pattern", "data table", "wizard", "dashboard", "filter", "form pattern", "page layout"]
---

# ABM UI Design Patterns

## 1. Data Table Page
Use for: Prospects, Companies, Scoring Rules — any list of records.

```tsx
// Structure: Header → Filters → Bulk Actions → Table → Pagination
<div className="p-6 lg:p-8 space-y-6">
  <div className="flex items-center justify-between">
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Title</h1>
      <p className="text-slate-500 mt-1">Description</p>
    </div>
    <Button icon={<Plus />}>Create</Button>
  </div>

  <Card padding="md">
    <div className="flex flex-wrap items-end gap-4">
      <Input icon={<Search />} /> {/* Always debounced */}
      <Select /> {/* Filters */}
    </div>
  </Card>

  {isLoading ? <SkeletonTable /> : error ? <ErrorState /> : data.length === 0 ? <EmptyState /> : (
    <>
      <Table>
        <TableHead>
          <TableRow hoverable={false}>
            <SortableHeader /> {/* For sortable columns */}
            <TableCell isHeader /> {/* For non-sortable */}
          </TableRow>
        </TableHead>
        <TableBody>{/* rows */}</TableBody>
      </Table>
      <Pagination />
    </>
  )}
</div>
```

## 2. Filter Bar
Always include:
- Search input with `useDebouncedValue(search, 300)` hook
- Dropdown filters with "Todos/Todas" as first option
- Reset page to 1 on filter change: `setPage(1)`

## 3. Multi-Step Wizard
Use for: Imports, Campaign creation — multi-step processes.
- Stepper component showing current step
- Back/Next buttons
- Validation per step before advancing
- Final confirmation step with summary

## 4. Dashboard
Use for: Overview pages with KPIs and charts.
- KPI stat cards in responsive grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`
- Charts using Recharts with design system colors
- Activity feeds with Timeline or list
- Quick action buttons linking to key workflows

## 5. Detail Page
Use for: ProspectDetail, CompanyDetail, CampaignDetail — single record views.
- Back button/breadcrumb for navigation
- Header with key info (name, status badge, score)
- Tabs for organizing related data
- Edit mode toggle for inline editing
- Related records section (campaigns, activities, emails)

## 6. Form Patterns
- Always use `<Input>`, `<Select>`, `<Textarea>` components (not raw HTML)
- Group related fields with `grid grid-cols-2 gap-4`
- Action buttons in footer: `flex justify-end gap-3 pt-4 border-t border-slate-200`
- Loading state on submit button: `loading={mutation.isPending}`
- Use ConfirmDialog for destructive actions (never window.confirm)
