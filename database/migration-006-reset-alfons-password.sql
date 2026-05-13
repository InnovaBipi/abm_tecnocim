-- Migration 006: Reset alfons@tecnocim.com password to Tecnocim2026!
-- bcrypt hash generated locally with bcryptjs, salt rounds 10
-- Admin password reset requested by tenant owner Alfons Marques
-- ROLLBACK: N/A (previous password unknown)

SET @tecnocim_tenant_id = (SELECT id FROM tenants WHERE slug = 'tecnocim');

UPDATE users
SET password = '$2a$10$hvNPJyX/N3k2LOyCKSBfSOLG1ZCkts9fmFrPMgz0eGHgt7peJ/P9O'
WHERE email = 'alfons@tecnocim.com'
  AND tenant_id = @tecnocim_tenant_id;
