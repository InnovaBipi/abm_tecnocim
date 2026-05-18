-- Migration 010: Complete rebrand - update tagline, footer, and tenant name
-- Complements migration-009 which only updated app_name and AI config

UPDATE tenants
SET name = 'Tecnocim Innova',
    config = JSON_SET(
      config,
      '$.branding.tagline', 'Prospecting',
      '$.branding.footer_html', '<p>Tecnocim Innova - Consultoría de Innovación Tecnológica<br><a href=\"https://tecnociminnova.com\" style=\"color:#ff7f00\">tecnociminnova.com</a></p>'
    )
WHERE slug = 'tecnocim';

-- ROLLBACK: UPDATE tenants SET name = 'Tecnocim', config = JSON_SET(config, '$.branding.tagline', 'Consultoría de Innovación - Account-Based Marketing', '$.branding.footer_html', '<p>Tecnocim - Consultoría de Innovación Tecnológica<br><a href=\"https://tecnocim.com\" style=\"color:#2563EB\">tecnocim.com</a></p>') WHERE slug = 'tecnocim';
