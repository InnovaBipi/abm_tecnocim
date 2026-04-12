---
name: security-scan
description: Run comprehensive security scan of the codebase using the security-auditor agent in isolated context
user-invocable: true
context: fork
agent: security-auditor
---

# Security Scan

Run a full security audit of the ABM platform codebase.

This skill spawns the security-auditor agent in an isolated context to:
1. Check tenant isolation on all SQL queries
2. Detect SQL injection vulnerabilities
3. Verify authentication on all routes
4. Check input validation coverage
5. Audit webhook security
6. Verify rate limiting configuration

The scan runs in a forked context to avoid polluting the main conversation.
