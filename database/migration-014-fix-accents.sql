-- Migration 014: Fix missing accents in scheduled emails
-- 90% of scheduled emails (1469/1638) have missing tildes/accents
-- Tenant-isolated: only affects tecnocim tenant
-- ROLLBACK: Not needed (accents are always correct)

SET @tid = (SELECT id FROM tenants WHERE slug = 'tecnocim');

-- ============================================================
-- SPANISH ACCENTS (body_html)
-- ============================================================

-- -ción words (most common pattern)
UPDATE generated_emails SET body_html = REPLACE(body_html, 'deduccion', 'deducción') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%deduccion%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'Deduccion', 'Deducción') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%Deduccion%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'innovacion', 'innovación') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%innovacion%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'Innovacion', 'Innovación') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%Innovacion%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'inversion', 'inversión') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%inversion%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'fabricacion', 'fabricación') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%fabricacion%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'produccion', 'producción') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%produccion%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'formulacion', 'formulación') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%formulacion%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'certificacion', 'certificación') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%certificacion%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'optimizacion', 'optimización') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%optimizacion%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'automatizacion', 'automatización') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%automatizacion%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'documentacion', 'documentación') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%documentacion%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'investigacion', 'investigación') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%investigacion%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'valoracion', 'valoración') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%valoracion%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'exportacion', 'exportación') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%exportacion%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'validacion', 'validación') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%validacion%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'regulacion', 'regulación') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%regulacion%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'operacion', 'operación') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%operacion%';

-- Other Spanish words
UPDATE generated_emails SET body_html = REPLACE(body_html, 'tecnologia', 'tecnología') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%tecnologia%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'Tecnologia', 'Tecnología') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%Tecnologia%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'ceramica', 'cerámica') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%ceramica%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'Ceramica', 'Cerámica') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%Ceramica%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'aeronautico', 'aeronáutico') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%aeronautico%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'electronica', 'electrónica') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%electronica%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'tecnica', 'técnica') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%tecnica%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'tecnico', 'técnico') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%tecnico%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'tambien', 'también') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%tambien%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'ademas', 'además') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%ademas%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'podria', 'podría') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%podria%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'tendria', 'tendría') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%tendria%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'seria', 'sería') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%seria%';
UPDATE generated_emails SET body_html = REPLACE(body_html, ' recupero ', ' recuperó ') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '% recupero %';
UPDATE generated_emails SET body_html = REPLACE(body_html, ' unico ', ' único ') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '% unico %';
UPDATE generated_emails SET body_html = REPLACE(body_html, ' mas ', ' más ') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '% mas %';
UPDATE generated_emails SET body_html = REPLACE(body_html, ' mas de', ' más de') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '% mas de%';
UPDATE generated_emails SET body_html = REPLACE(body_html, ' mas del', ' más del') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '% mas del%';

-- Proper name: Marquès (grave accent, NOT acute)
UPDATE generated_emails SET body_html = REPLACE(body_html, 'Marques', 'Marquès') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%Marques%';

-- ============================================================
-- SPANISH ACCENTS (subject)
-- ============================================================
UPDATE generated_emails SET subject = REPLACE(subject, 'deduccion', 'deducción') WHERE tenant_id = @tid AND status = 'scheduled' AND subject LIKE '%deduccion%';
UPDATE generated_emails SET subject = REPLACE(subject, 'Deduccion', 'Deducción') WHERE tenant_id = @tid AND status = 'scheduled' AND subject LIKE '%Deduccion%';
UPDATE generated_emails SET subject = REPLACE(subject, 'innovacion', 'innovación') WHERE tenant_id = @tid AND status = 'scheduled' AND subject LIKE '%innovacion%';
UPDATE generated_emails SET subject = REPLACE(subject, 'ceramica', 'cerámica') WHERE tenant_id = @tid AND status = 'scheduled' AND subject LIKE '%ceramica%';
UPDATE generated_emails SET subject = REPLACE(subject, 'Ceramica', 'Cerámica') WHERE tenant_id = @tid AND status = 'scheduled' AND subject LIKE '%Ceramica%';
UPDATE generated_emails SET subject = REPLACE(subject, 'aeronautico', 'aeronáutico') WHERE tenant_id = @tid AND status = 'scheduled' AND subject LIKE '%aeronautico%';
UPDATE generated_emails SET subject = REPLACE(subject, 'electronica', 'electrónica') WHERE tenant_id = @tid AND status = 'scheduled' AND subject LIKE '%electronica%';
UPDATE generated_emails SET subject = REPLACE(subject, 'tecnologia', 'tecnología') WHERE tenant_id = @tid AND status = 'scheduled' AND subject LIKE '%tecnologia%';
UPDATE generated_emails SET subject = REPLACE(subject, 'Marques', 'Marquès') WHERE tenant_id = @tid AND status = 'scheduled' AND subject LIKE '%Marques%';
UPDATE generated_emails SET subject = REPLACE(subject, 'formulacion', 'formulación') WHERE tenant_id = @tid AND status = 'scheduled' AND subject LIKE '%formulacion%';
UPDATE generated_emails SET subject = REPLACE(subject, 'valoracion', 'valoración') WHERE tenant_id = @tid AND status = 'scheduled' AND subject LIKE '%valoracion%';
UPDATE generated_emails SET subject = REPLACE(subject, 'recupero', 'recuperó') WHERE tenant_id = @tid AND status = 'scheduled' AND subject LIKE '%recupero%';

-- ============================================================
-- CATALAN ACCENTS (body_html)
-- ============================================================
UPDATE generated_emails SET body_html = REPLACE(body_html, 'deduccio ', 'deducció ') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%deduccio %';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'deduccio.', 'deducció.') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%deduccio.%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'deduccio,', 'deducció,') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%deduccio,%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'innovacio ', 'innovació ') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%innovacio %';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'innovacio.', 'innovació.') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%innovacio.%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'inversio ', 'inversió ') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%inversio %';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'inversio.', 'inversió.') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%inversio.%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'produccio ', 'producció ') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%produccio %';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'produccio.', 'producció.') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%produccio.%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'formulacio ', 'formulació ') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%formulacio %';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'formulacio.', 'formulació.') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%formulacio.%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'bonificacio ', 'bonificació ') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%bonificacio %';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'bonificacio.', 'bonificació.') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%bonificacio.%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'tecnologic ', 'tecnològic ') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%tecnologic %';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'tecnologic.', 'tecnològic.') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%tecnologic.%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'quimic ', 'químic ') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%quimic %';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'quimic.', 'químic.') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%quimic.%';
UPDATE generated_emails SET body_html = REPLACE(body_html, 'ecologics', 'ecològics') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '%ecologics%';
UPDATE generated_emails SET body_html = REPLACE(body_html, ' mes ', ' més ') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '% mes %';
UPDATE generated_emails SET body_html = REPLACE(body_html, ' mes de', ' més de') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '% mes de%';
UPDATE generated_emails SET body_html = REPLACE(body_html, ' mes del', ' més del') WHERE tenant_id = @tid AND status = 'scheduled' AND body_html LIKE '% mes del%';

-- Catalan subjects
UPDATE generated_emails SET subject = REPLACE(subject, 'deduccio', 'deducció') WHERE tenant_id = @tid AND status = 'scheduled' AND subject LIKE '%deduccio%';
UPDATE generated_emails SET subject = REPLACE(subject, 'innovacio', 'innovació') WHERE tenant_id = @tid AND status = 'scheduled' AND subject LIKE '%innovacio%';
UPDATE generated_emails SET subject = REPLACE(subject, 'tecnologic', 'tecnològic') WHERE tenant_id = @tid AND status = 'scheduled' AND subject LIKE '%tecnologic%';
UPDATE generated_emails SET subject = REPLACE(subject, 'quimic', 'químic') WHERE tenant_id = @tid AND status = 'scheduled' AND subject LIKE '%quimic%';
UPDATE generated_emails SET subject = REPLACE(subject, 'ceramica', 'ceràmica') WHERE tenant_id = @tid AND status = 'scheduled' AND subject LIKE '%ceramica%';
