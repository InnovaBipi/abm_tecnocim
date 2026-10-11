-- Migration 025: New Brokers signs as the company, not as a person
-- Decided 2026-10-11: outreach is signed "Equipo New Brokers" instead of
-- César Perejoan (migration-024). Sender becomes the existing info@ mailbox,
-- which is also reply_to, so the From address is a real, monitored inbox.
-- The voice moves to first person plural to match a corporate signature.
--
-- Idempotent: JSON_SET overwrites with the same values on a re-run.
--
-- ROLLBACK: UPDATE tenants SET config = JSON_SET(config,
--   '$.email.from_email', 'cesarperejoan@newbrokers.es',
--   '$.email.from_name', 'César Perejoan · New Brokers',
--   '$.ai.sender_name', 'César Perejoan') WHERE id = 'tenant-newbrokers-0005';
--   (and restore $.ai.email_style from migration-024)

UPDATE tenants
SET config = JSON_SET(config,
  '$.email.from_email', 'info@newbrokers.es',
  '$.email.from_name', 'New Brokers Correduría de Seguros',
  '$.ai.sender_name', 'Equipo New Brokers',
  '$.ai.email_style', 'Registro de usted, técnico, sobrio y discreto, propio de una correduría corporativa. Escribir en primera persona del plural (nosotros, en New Brokers), nunca como una persona concreta. Hablar de riesgo, exposición, programa de seguros y mandato; nunca de tranquilidad, precio barato ni del mejor. No nombrar aseguradoras concretas. No citar clientes ni casos reales. No dar cifras ni datos normativos sin fuente. Sin exclamaciones ni lenguaje comercial agresivo. Correos breves. Firma: Equipo New Brokers / New Brokers Correduría de Seguros.'
)
WHERE id = 'tenant-newbrokers-0005';
