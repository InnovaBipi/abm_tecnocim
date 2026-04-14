---
name: review-pr
description: Generates a comprehensive PR description from git diff with code review checklist
arguments:
  - name: base
    description: Base branch to compare against
    default: main
user_facing: true
---

Generate a comprehensive pull request description by analyzing changes:

1. Run `git log $ARGUMENTS...HEAD --oneline` to get commit history
2. Run `git diff $ARGUMENTS...HEAD --stat` to get changed files summary
3. Run `git diff $ARGUMENTS...HEAD` to analyze the actual changes

Generate output in this format:

## Summary
[2-3 sentences describing what changed and why]

## Changes
### Frontend
- [List frontend changes]

### Backend
- [List backend changes]

### Database
- [List migration/schema changes if any]

### Infrastructure
- [List .claude/ or config changes if any]

## Code Review Checklist
- [ ] All SQL queries include tenant_id
- [ ] No secrets in code
- [ ] All 4 UI states handled (loading, error, empty, data)
- [ ] Tests added/updated
- [ ] Accessibility verified (aria-labels, semantic HTML)

## Test Plan
- [Steps to verify the changes]
