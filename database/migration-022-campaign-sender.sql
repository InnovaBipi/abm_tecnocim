-- Migration 022: Per-campaign sender (anchors From/Reply-To/signature to a user)
-- campaigns.sender_user_id -> users.id. NULL = tenant-config sender (current behaviour).
-- Send-time cascade: campaign.sender_user_id -> users.sender_email/sender_name -> tenant config.
-- ON DELETE SET NULL: sender resolution falls back to tenant config if the user is deleted.
-- Re-run safety: ER_DUP_FIELDNAME is a safe error in migrate.ts; MySQL 8 DDL is atomic per ALTER.

ALTER TABLE campaigns
    ADD COLUMN sender_user_id CHAR(36) NULL AFTER created_by,
    ADD KEY idx_campaigns_sender_user (sender_user_id),
    ADD CONSTRAINT fk_campaigns_sender_user FOREIGN KEY (sender_user_id)
        REFERENCES users(id) ON DELETE SET NULL;

-- ROLLBACK: ALTER TABLE campaigns DROP FOREIGN KEY fk_campaigns_sender_user;
-- ROLLBACK: ALTER TABLE campaigns DROP KEY idx_campaigns_sender_user;
-- ROLLBACK: ALTER TABLE campaigns DROP COLUMN sender_user_id;
