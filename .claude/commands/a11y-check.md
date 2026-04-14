---
name: a11y-check
description: Run accessibility audit for WCAG 2.2 AA compliance
arguments:
  - name: page
    description: "Page or component to audit (default: all)"
    required: false
user_facing: true
---

Launch the accessibility-auditor agent.

1. If page specified, audit that file
2. Otherwise audit all pages + shared UI components
3. Report WCAG criteria pass/fail with prioritized fix list
