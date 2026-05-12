-- Migration 005: Add legal section to tenant config JSON
-- Required for RGPD/LSSI compliance footer (Art. 14 RGPD + Art. 20 LSSI)
-- Adds: legal_name, CIF, address, privacy_url, data_source to each tenant's config

-- Tecnocim tenant
UPDATE tenants SET config = JSON_SET(
  config,
  '$.legal', CAST('{"legal_name":"Tecnocim Innova SL","cif":"B02896231","address":"Sant Cugat del Valles, Barcelona","privacy_url":"","data_source":"su pagina web corporativa"}' AS JSON)
) WHERE slug = 'tecnocim';

-- CamiaCasa tenant
UPDATE tenants SET config = JSON_SET(
  config,
  '$.legal', CAST('{"legal_name":"Tecnocim Innova SL","cif":"B02896231","address":"Sant Cugat del Valles, Barcelona","privacy_url":"","data_source":"su pagina web corporativa"}' AS JSON)
) WHERE slug = 'camiacasa';

-- Technova Partners tenant
UPDATE tenants SET config = JSON_SET(
  config,
  '$.legal', CAST('{"legal_name":"Tecnocim Innova SL","cif":"B02896231","address":"Sant Cugat del Valles, Barcelona","privacy_url":"","data_source":"su pagina web corporativa"}' AS JSON)
) WHERE slug = 'technova';

-- ROLLBACK: UPDATE tenants SET config = JSON_REMOVE(config, '$.legal') WHERE slug IN ('tecnocim', 'camiacasa', 'technova');
