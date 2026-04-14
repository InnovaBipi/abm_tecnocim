---
description: Accessibility (WCAG 2.2 AA) standards for all frontend code
globs: ["client/**/*.tsx"]
alwaysApply: true
---

# Accessibility Standards

## Required for ALL Components

1. Interactive elements MUST be semantic (`<button>`, `<a>`, not clickable `<div>`)
2. Icon-only buttons MUST have `aria-label`
3. Form inputs MUST have `<label htmlFor>` or `aria-label`
4. Error messages MUST use `aria-describedby` linking to the input
5. Color MUST NOT be the sole indicator of state (pair with text/icon)
6. Focus indicators MUST be visible (never `outline-none` without ring replacement)
7. `<th>` elements MUST have `scope="col"` or `scope="row"`

## Required for Page Components

1. Page MUST have a descriptive `<h1>` (only one per page)
2. Heading hierarchy MUST be logical (h1 > h2 > h3, no skipping)
3. Modals MUST trap focus and close on Escape
4. Dynamic content updates MUST use `aria-live` or `role="alert"`
