-- Migration 004: Add sender_email and sender_name to users table
-- Allows per-user email sender configuration (each user can send from their own email)

ALTER TABLE users ADD COLUMN sender_email VARCHAR(255) NULL AFTER last_name;
ALTER TABLE users ADD COLUMN sender_name VARCHAR(100) NULL AFTER sender_email;

-- ROLLBACK: ALTER TABLE users DROP COLUMN sender_email;
-- ROLLBACK: ALTER TABLE users DROP COLUMN sender_name;
