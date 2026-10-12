-- Migration 026: New Brokers warmup 30 -> 60/day over 7 days
-- Decided 2026-10-12: start sending on 2026-10-13 and reach 60 emails/day in
-- about a week (instead of 20 -> 50 over 30 days from migration-024).
-- Applied live first via PUT /api/settings/warmup; this keeps it durable.
--
-- ROLLBACK: UPDATE tenants SET config = JSON_SET(config, '$.warmup.daily_limit_base', 20, '$.warmup.daily_limit_max', 50, '$.warmup.ramp_up_days', 30) WHERE id = 'tenant-newbrokers-0005';

UPDATE tenants
SET config = JSON_SET(config,
  '$.warmup.daily_limit_base', 30,
  '$.warmup.daily_limit_max', 60,
  '$.warmup.ramp_up_days', 7
)
WHERE id = 'tenant-newbrokers-0005';
