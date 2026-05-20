-- Migration 015: Force correct footer, legal name, and fix baked-in URLs
-- Previous migrations (010, 013) did not take effect in production.
-- Same pattern as migration-010/012/013/014 (tenant-specific data fix).
-- ROLLBACK: UPDATE tenants SET config = JSON_SET(config, '$.branding.footer_html', '<p>Tecnocim Innova</p>') WHERE slug = 'tecnocim';

-- A) Force correct branding footer (NO RGPD text here — getEmailFooter() generates that from config.legal)
UPDATE tenants SET config = JSON_SET(config,
  '$.branding.footer_html',
  '<p>Tecnocim Innova<br><a href="https://tecnociminnova.com/ca" style="color:#ff7f00">tecnociminnova.com</a></p>'
) WHERE slug = 'tecnocim';

-- B) Force correct legal entity name (shown in RGPD disclaimer)
UPDATE tenants SET config = JSON_SET(config,
  '$.legal.legal_name', 'Tecnocim Innova SL'
) WHERE slug = 'tecnocim';

-- C) Fix baked-in tecnocim.com in scheduled email bodies (tenant-scoped)
UPDATE generated_emails
SET body_html = REPLACE(body_html, 'tecnocim.com', 'tecnociminnova.com')
WHERE tenant_id = 'tenant-tecnocim-0003'
  AND status = 'scheduled'
  AND body_html LIKE '%tecnocim.com%'
  AND body_html NOT LIKE '%tecnociminnova.com%';
