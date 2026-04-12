---
name: audit-emails
description: Run quality assurance on generated emails checking spam triggers, personalization, and compliance
arguments:
  - name: tenant
    description: "Tenant slug to audit (default: all)"
    required: false
user_facing: true
---

# Audit Emails Command

Launch the email-qa agent to review all draft/approved emails for quality issues.

## Steps

1. Spawn the `email-qa` agent with the specified tenant filter
2. The agent will:
   - Read generated emails from the database (status: draft, approved)
   - Check subject line quality
   - Verify body content standards
   - Validate compliance requirements
   - Assess personalization quality
   - Check deliverability factors
3. Report findings as PASS/WARN/FAIL per email
4. Provide aggregate summary with improvement suggestions
