-- Migration 012: Increase warmup daily limit to 100 for Tecnocim tenant
-- Domain has been active since May 13, 2026 (5+ days), safe to increase volume
-- ROLLBACK: UPDATE tenants SET config = JSON_SET(config, '$.warmup.daily_limit_base', 40, '$.warmup.daily_limit_max', 50) WHERE slug = 'tecnocim';

UPDATE tenants
SET config = JSON_SET(config,
  '$.warmup.daily_limit_base', 100,
  '$.warmup.daily_limit_max', 100,
  '$.warmup.ramp_up_days', 1
)
WHERE slug = 'tecnocim';
