# Known Bugs

## Fixed (2026-04-12)
- [x] Tenant isolation: prospect_activities query missing tenant_id (prospects.ts)
- [x] Tenant isolation: tags query missing tenant_id (prospects.ts, companies.ts)
- [x] Tenant isolation: company prospects query missing tenant_id (companies.ts)
- [x] Tenant isolation: campaign prospects/sequences/stats queries missing tenant_id (campaigns.ts)
- [x] Tenant isolation: sequence enrollments/stats/steps queries missing tenant_id (sequences.ts)
- [x] Tenant isolation: campaign prospect DELETE without tenant verification (campaigns.ts)
- [x] Suppression list cross-tenant: email.ts checking without tenant_id
- [x] Webhook signature bypass: accepting requests without Svix headers in production
- [x] Rate limiter global: sendLimiter shared across all tenants
- [x] Database pool: unbounded queue (queueLimit: 0)

## Open
- [ ] `email.ts`: prospect lookup `SELECT * FROM prospects WHERE id = ?` missing tenant_id (line ~112)
- [ ] `outbox.ts`: blocking email send loop (600ms delay per email blocks event loop)
- [ ] Bulk operations: no cap on array size for bulk-delete, bulk-add-campaign, enroll
- [ ] Frontend: auth token stored in localStorage (XSS vulnerable, should use HttpOnly cookies)
- [ ] No CSRF protection on state-changing endpoints
- [ ] Tenant secrets (IMAP password, Resend API key) stored unencrypted in DB JSON
- [ ] No idempotency on email send endpoint (double-send possible)
- [ ] `unsubscribe.ts`: footer_html rendered without sanitization (XSS risk)
