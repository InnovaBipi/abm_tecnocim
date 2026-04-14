---
name: perf-check
description: Analyze performance (bundle size, React patterns, API queries)
arguments:
  - name: scope
    description: "Scope: bundle, react, api, or all"
    required: false
user_facing: true
---

Spawn the performance-analyzer agent.

1. Based on scope:
   - `bundle`: Vite build output chunk analysis
   - `react`: Scan for re-render patterns, missing memoization
   - `api`: Scan for unbounded queries, N+1 patterns
   - `all` (default): Run all checks
2. Report findings sorted by impact.
