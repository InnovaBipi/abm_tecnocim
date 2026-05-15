-- migration-007-tecnocim-footer-fix.sql
-- Fix Tecnocim footer: "Tecnocim Innova" + tecnociminnova.com (not tecnocim.com)

UPDATE tenants
SET config = JSON_SET(config, '$.branding.footer_html',
  '<p>Tecnocim Innova · <a href=\"https://tecnociminnova.com\" style=\"color:#2563EB\">tecnociminnova.com</a><br>Consultoría de Innovación Tecnológica</p>')
WHERE slug = 'tecnocim';

-- ROLLBACK: UPDATE tenants SET config = JSON_SET(config, '$.branding.footer_html', '<p>Tecnocim - Consultoría de Innovación Tecnológica<br><a href=\"https://tecnocim.com\" style=\"color:#2563EB\">tecnocim.com</a></p>') WHERE slug = 'tecnocim';
