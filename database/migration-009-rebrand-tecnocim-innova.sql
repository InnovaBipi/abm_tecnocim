-- Migration 009: Rebrand tenant "Tecnocim" to "Tecnocim Innova"
-- Updates tenant name and AI config company_name/description

UPDATE tenants
SET name = 'Tecnocim Innova',
    config = JSON_SET(
      config,
      '$.ai.company_name', 'Tecnocim Innova',
      '$.ai.company_description', 'Tecnocim Innova - Consultora de innovación tecnológica. Especializados en gestión integral de bonificaciones fiscales I+D+i, transformación digital y desarrollo de software a medida.',
      '$.branding.app_name', 'Tecnocim Innova',
      '$.branding.tagline', 'Prospecting',
      '$.branding.footer_html', '<p>Tecnocim Innova - Consultoría de Innovación Tecnológica<br><a href=\"https://tecnocim.com\" style=\"color:#2563EB\">tecnocim.com</a></p>'
    )
WHERE slug = 'tecnocim';

-- ROLLBACK: UPDATE tenants SET name = 'Tecnocim', config = JSON_SET(config, '$.ai.company_name', 'Tecnocim', '$.branding.app_name', 'Tecnocim ABM', '$.branding.tagline', 'Consultoría de Innovación - Account-Based Marketing') WHERE slug = 'tecnocim';
