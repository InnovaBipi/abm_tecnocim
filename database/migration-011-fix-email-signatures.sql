-- Migration 011: Fix email signatures from "Tecnocim" to "Tecnocim Innova"
-- Updates body_html in all scheduled generated emails

-- Pattern 1: <br>Tecnocim</p>
UPDATE generated_emails
SET body_html = REPLACE(body_html, '<br>Tecnocim</p>', '<br>Tecnocim Innova</p>')
WHERE status = 'scheduled' AND tenant_id = 'tenant-tecnocim-0003'
  AND body_html LIKE '%<br>Tecnocim</p>%';

-- Pattern 2: <br/>Tecnocim</p>
UPDATE generated_emails
SET body_html = REPLACE(body_html, '<br/>Tecnocim</p>', '<br/>Tecnocim Innova</p>')
WHERE status = 'scheduled' AND tenant_id = 'tenant-tecnocim-0003'
  AND body_html LIKE '%<br/>Tecnocim</p>%';

-- Also fix "Marqués" (missing accent) to "Marquès" while we're at it
UPDATE generated_emails
SET body_html = REPLACE(body_html, 'Alfons Marqués', 'Alfons Marquès')
WHERE status = 'scheduled' AND tenant_id = 'tenant-tecnocim-0003'
  AND body_html LIKE '%Alfons Marqués%';

-- ROLLBACK: UPDATE generated_emails SET body_html = REPLACE(body_html, 'Tecnocim Innova</p>', 'Tecnocim</p>') WHERE status = 'scheduled' AND tenant_id = 'tenant-tecnocim-0003';
