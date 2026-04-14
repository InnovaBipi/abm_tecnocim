---
name: ux-review
description: Review frontend pages against design system and usability standards
arguments:
  - name: page
    description: "Page: dashboard, prospects, companies, campaigns, outbox, imports, settings, or all"
    required: false
user_facing: true
---

Launch the ux-reviewer agent to audit frontend pages.

1. If page specified, target `client/src/pages/<Page>.tsx`
2. Otherwise review all pages
3. Spawn the `ux-reviewer` agent
4. Report findings with severity ratings
