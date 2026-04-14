---
name: benchmark
description: Runs performance benchmarks and compares against baselines
arguments:
  - name: scope
    description: What to benchmark (bundle|build|tests|all)
    default: all
user_facing: true
---

Run performance benchmarks for the ABM Tecnocim platform:

1. If scope includes "bundle" or "all":
   - Run `cd client && npm run build 2>&1`
   - Parse output for chunk sizes
   - Compare against target: <500KB gzipped total, <300KB initial JS
   - Report: current size, target, status (OK/WARN/FAIL)

2. If scope includes "build" or "all":
   - Time `cd client && npm run build`
   - Time `cd server && npx tsc --noEmit`
   - Report build durations

3. If scope includes "tests" or "all":
   - Run `npm run test 2>&1`
   - Report: test count, pass/fail, duration
   - Identify slowest test files

4. Output a summary table:
| Metric | Current | Target | Status |
