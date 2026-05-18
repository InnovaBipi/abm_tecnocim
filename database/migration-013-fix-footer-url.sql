-- Migration 013: Fix footer URL tecnocim.com → tecnociminnova.com
-- Migrations 009/010 accidentally reverted the correct URL from migration 007
-- ROLLBACK: See migration-010 for previous values

-- Fix footer_html with correct URL and brand name
UPDATE tenants
SET config = JSON_SET(
  config,
  '$.branding.footer_html',
  '<p style="font-size:12px;color:#666;margin-top:24px;padding-top:16px;border-top:1px solid #eee;">Tecnocim Innova - Consultoría de Innovación Tecnológica<br><a href="https://tecnociminnova.com" style="color:#ff7f00;">tecnociminnova.com</a></p><p style="font-size:11px;color:#999;">Este correo se dirige a la dirección de contacto público de su empresa, obtenida de fuentes de acceso público (su página web corporativa), con base en interés legítimo (Art. 6.1.f RGPD). Puede ejercer sus derechos de acceso, rectificación, supresión y oposición contactando a alfons.marques@tecnocim.com o usando el enlace inferior.</p>'
)
WHERE slug = 'tecnocim';

-- Fix AI email_style to reference correct brand
UPDATE tenants
SET config = JSON_SET(
  config,
  '$.ai.email_style',
  'Tono: consultor de innovación hablando de igual a igual. Firma: Alfons Marquès / Tecnocim Innova'
)
WHERE slug = 'tecnocim';
