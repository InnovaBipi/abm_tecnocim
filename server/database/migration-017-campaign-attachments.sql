-- Migration 017: Campaign attachments (e.g. blind-teaser PDF attached to outreach emails)
-- Stores one optional attachment per campaign as base64; injected at send time by the
-- Resend wrapper (sendEmail) when present. Tenant-isolated.

CREATE TABLE IF NOT EXISTS campaign_attachments (
    id              CHAR(36) PRIMARY KEY,
    tenant_id       CHAR(36) NOT NULL,
    campaign_id     CHAR(36) NOT NULL,
    filename        VARCHAR(255) NOT NULL,
    mime_type       VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
    file_size       INT NOT NULL,
    content_base64  LONGTEXT NOT NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY idx_campaign_attachments_tenant_campaign (tenant_id, campaign_id),
    KEY idx_campaign_attachments_tenant (tenant_id),
    CONSTRAINT fk_campaign_attachments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_campaign_attachments_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- ROLLBACK: DROP TABLE IF EXISTS campaign_attachments;
