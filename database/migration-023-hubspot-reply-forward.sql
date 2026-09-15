-- Migration 023: HubSpot bridge + reply forwarding
-- (numbered 023: 019-022 were already taken by treemg/oauth/campaign-sender)
--
-- When a prospect replies to an ABM email the reply is (a) forwarded to a human
-- inbox and (b) pushed into HubSpot as a lead. See docs/hubspot-integration.md.
--
--  prospects.hubspot_contact_id   HubSpot contact id once synced (crm mode only —
--                                 the public Forms API does not return the id).
--  companies.hubspot_company_id   HubSpot company id once synced (crm mode).
--  hubspot_sync_log               one row per action attempted by the reply router
--                                 (forward_email, form_submit, contact_upsert,
--                                 company_upsert, note_create). The router never
--                                 throws; this table is where failures land.
--
-- Re-run safety: ER_DUP_FIELDNAME / ER_TABLE_EXISTS_ERROR are safe errors in
-- migrate.ts; MySQL 8 DDL is atomic per statement.

ALTER TABLE prospects
    ADD COLUMN hubspot_contact_id VARCHAR(32) NULL AFTER do_not_contact,
    ADD KEY idx_prospect_hubspot (tenant_id, hubspot_contact_id);

ALTER TABLE companies
    ADD COLUMN hubspot_company_id VARCHAR(32) NULL AFTER is_target,
    ADD KEY idx_company_hubspot (tenant_id, hubspot_company_id);

CREATE TABLE IF NOT EXISTS hubspot_sync_log (
    id           CHAR(36) PRIMARY KEY,
    tenant_id    CHAR(36) NOT NULL,
    prospect_id  CHAR(36) NULL,
    event_id     CHAR(36) NULL,                 -- email_events.id of the 'replied' row
    mode         VARCHAR(16) NOT NULL,          -- 'crm' | 'form' | 'email'
    action       VARCHAR(32) NOT NULL,          -- forward_email | form_submit | contact_upsert | company_upsert | note_create
    status       ENUM('ok', 'error', 'skipped') NOT NULL,
    hubspot_id   VARCHAR(32) NULL,
    error        TEXT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_hsl_tenant_created (tenant_id, created_at DESC),
    KEY idx_hsl_event (event_id, action),
    KEY idx_hsl_prospect (prospect_id),
    CONSTRAINT fk_hsl_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_hsl_prospect FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- Tenant config (NOT applied automatically — run by hand once the team confirms
-- the recipients; or set it from Settings > Claves API in the app).
--
-- Tecnocim: provisional 'form' mode (no Private App token available yet) using
-- the website contact form, so the existing HubSpot → Teams workflow fires; and
-- forward every non-OOO reply to Robert.
--
-- UPDATE tenants
-- SET config = JSON_SET(
--   config,
--   '$.hubspot', JSON_OBJECT(
--     'mode', 'form',
--     'enabled', TRUE,
--     'portal_id', '145850079',
--     'form_guid', '9c812eca-b6fb-4c2e-b2c9-5623008cfc0c',
--     'owner_id', '34489913',
--     'create_company', TRUE
--   ),
--   '$.reply_forward', JSON_OBJECT(
--     'to', JSON_ARRAY('Robert.Belmonte@tecnocim.com'),
--     'only_positive', FALSE,
--     'forward_out_of_office', FALSE
--   )
-- )
-- WHERE slug = 'tecnocim';
--
-- Switch to 'crm' once a Private App token with the right scopes exists:
--   POST /api/settings/hubspot { "mode": "crm", "access_token": "pat-eu1-..." }
-- (the endpoint encrypts the token; never paste it into SQL).
-- ---------------------------------------------------------------------------

-- ROLLBACK: DROP TABLE IF EXISTS hubspot_sync_log;
-- ROLLBACK: ALTER TABLE companies DROP KEY idx_company_hubspot, DROP COLUMN hubspot_company_id;
-- ROLLBACK: ALTER TABLE prospects DROP KEY idx_prospect_hubspot, DROP COLUMN hubspot_contact_id;
-- ROLLBACK: UPDATE tenants SET config = JSON_REMOVE(config, '$.hubspot', '$.reply_forward') WHERE slug = 'tecnocim';
