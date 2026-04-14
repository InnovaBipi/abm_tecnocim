---
name: bundle-analyzer
description: Monitors client bundle size against targets. Reports chunk breakdown and identifies large dependencies.
model: haiku
tools: ["Read", "Bash", "Glob", "Grep"]
---

# Bundle Analyzer

Analyze the client build output for size compliance.

## Step 1: Build
Run `cd client && npm run build 2>&1` and capture output.

## Step 2: Parse chunks
Extract chunk names and sizes from the Vite build output.

## Step 3: Check thresholds
- Total bundle: target < 500KB gzipped
- Initial JS: target < 300KB gzipped
- Largest single chunk: target < 100KB

## Step 4: Identify heavy imports
Check `client/package.json` dependencies and estimate contribution:
- recharts, @tanstack/react-query, react-router-dom, zustand, axios, lucide-react

## Step 5: Report
```markdown
# Bundle Analysis — [date]

| Chunk | Size (raw) | Size (gzip) | Status |
Total: [X]KB gzipped (target: <500KB)

## Largest Dependencies
| Package | Estimated Size |

## Recommendations
1. [Suggestion to reduce size]
```
