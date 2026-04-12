---
name: project-status
description: Show current project status including git state, tenant counts, pending migrations, and code TODOs
user-invocable: true
---

# Project Status

## Git State
!`git branch --show-current`
!`git log --oneline -5`
!`git status --short`

## Pending Migrations
!`ls database/migration-*.sql 2>/dev/null | sort`

## Code Health
!`grep -rn "TODO\|FIXME\|HACK\|XXX" server/src/ client/src/ --include="*.ts" --include="*.tsx" 2>/dev/null | head -15`

## Recent Changes
!`git diff --stat HEAD~3..HEAD 2>/dev/null`
