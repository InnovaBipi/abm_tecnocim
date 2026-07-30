-- Migration 019: Increase warmup daily limit to 100 for TreeMG tenant
-- Requested explicitly by Alfons: 100 emails/day (migration-018 shipped a
-- conservative 20 base / 50 max / 30-day ramp, which capped a cold domain at
-- ~20/day near-term and never reached 100). Domain treemg.com is warmed
-- (68+ emails already delivered without issues), so the 100/100/1 pattern
-- (same as migration-012 for tecnocim) is applied.
--
-- NOTE: production was already updated live via PUT /api/settings/warmup and the
-- TreeMG "Oleada 1" campaign redistributed to 100/business-day. This migration
-- makes the change durable/idempotent and keeps it in version history.
--
-- ROLLBACK: UPDATE tenants SET config = JSON_SET(config, '$.warmup.daily_limit_base', 20, '$.warmup.daily_limit_max', 50, '$.warmup.ramp_up_days', 30) WHERE slug = 'treemg';

UPDATE tenants
SET config = JSON_SET(config,
  '$.warmup.daily_limit_base', 100,
  '$.warmup.daily_limit_max', 100,
  '$.warmup.ramp_up_days', 1
)
WHERE slug = 'treemg';
