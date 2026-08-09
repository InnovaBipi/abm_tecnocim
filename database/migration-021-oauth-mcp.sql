-- Migration 021: OAuth 2.1 tables for the native MCP server (Claude.ai / ChatGPT custom connectors).
-- oauth_clients is GLOBAL by design (a client = the Claude/ChatGPT app, registered once via DCR;
-- the tenant is bound per-user at authorization time). This is a deliberate exception to the
-- tenant_id rule, analogous to the `tenants` / `_migrations` tables.

CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id                   VARCHAR(255) PRIMARY KEY,
    client_secret               VARCHAR(255),
    client_name                 VARCHAR(255),
    redirect_uris               JSON NOT NULL,
    grant_types                 JSON,
    scope                       VARCHAR(500) DEFAULT 'mcp',
    token_endpoint_auth_method  VARCHAR(64) DEFAULT 'none',
    created_at                  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Short-lived authorization codes (PKCE). tenant_id + user_id bind the code to the authenticated
-- user so the issued access token is correctly tenant-scoped.
CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
    code            VARCHAR(255) PRIMARY KEY,
    client_id       VARCHAR(255) NOT NULL,
    redirect_uri    VARCHAR(1000) NOT NULL,
    code_challenge  VARCHAR(255) NOT NULL,
    user_id         CHAR(36) NOT NULL,
    tenant_id       CHAR(36) NOT NULL,
    scope           VARCHAR(500) DEFAULT 'mcp',
    resource        VARCHAR(500),
    expires_at      DATETIME NOT NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_oauth_codes_expires (expires_at)
);

-- ROLLBACK: DROP TABLE IF EXISTS oauth_authorization_codes;
-- ROLLBACK: DROP TABLE IF EXISTS oauth_clients;
