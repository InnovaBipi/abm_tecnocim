-- ============================================
-- Migration 016: backfill prospect_score_history.tenant_id
-- ============================================
-- The tenant_id column + idx_score_tenant index are already added by
-- migration-001-multitenancy.sql (lines 209-211), so they exist on every
-- migrated environment. This migration only backfills tenant_id from the parent
-- prospect for any rows where it is missing/empty, so the column is consistent
-- with the prospect's tenant (the webhook click handler now writes tenant_id on
-- every new row).
--
-- Single idempotent statement: re-running is a no-op. No stored procedure / no
-- ALTER, so it runs cleanly through the multipleStatements migration runner.
-- ============================================

UPDATE prospect_score_history psh
JOIN prospects p ON p.id = psh.prospect_id
SET psh.tenant_id = p.tenant_id
WHERE psh.tenant_id IS NULL OR psh.tenant_id = '';

-- ROLLBACK: (none — backfill only; the column itself is owned by migration-001)
