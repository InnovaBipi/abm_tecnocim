-- Migration 020: Deliverability alert config for TreeMG
-- Enables the deliverability monitor (jobs/deliverabilityAlert.ts): emails
-- amarquescancio@gmail.com when TreeMG's bounce rate > 2% OR complaint rate > 0.1%
-- over the last 48h (min 30 sends in window). TreeMG sends 100/day on a purchased
-- list, so a spike must be caught fast to protect the treemg.com sending domain.
--
-- ROLLBACK: UPDATE tenants SET config = JSON_REMOVE(config, '$.alerts') WHERE slug = 'treemg';

UPDATE tenants
SET config = JSON_SET(config, '$.alerts', JSON_OBJECT(
  'recipient_email', 'amarquescancio@gmail.com',
  'bounce_pct_threshold', 2,
  'complaint_pct_threshold', 0.1,
  'min_sample', 30,
  'window_hours', 48
))
WHERE slug = 'treemg';
