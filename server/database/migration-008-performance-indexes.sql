-- ============================================
-- Migration 008: Performance Indexes
-- ============================================
-- Adds composite indexes for commonly queried columns
-- that only had single-column tenant_id indexes.
-- These cover frequent query patterns in the scheduler,
-- dashboard, and list endpoints.
-- ============================================

-- ============================================
-- 1. email_events: composite (tenant_id, event_type)
-- ============================================
-- Used by dashboard stats, engagement metrics per tenant.
-- Single tenant_id index (idx_event_tenant) already exists from migration-001.

CREATE INDEX idx_event_tenant_type
  ON email_events (tenant_id, event_type);

-- ============================================
-- 2. generated_emails: composite (tenant_id, status)
-- ============================================
-- Used by campaign list queries filtering by status per tenant.
-- Single tenant_id index (idx_ge_tenant) already exists from migration-001.

CREATE INDEX idx_ge_tenant_status
  ON generated_emails (tenant_id, status);

-- ============================================
-- 3. generated_emails: composite (tenant_id, status, scheduled_for)
-- ============================================
-- Used by the outbox scheduler (scheduler.ts) which queries:
--   WHERE ge.status = 'scheduled' AND ge.scheduled_for <= NOW()
-- Adding tenant_id as prefix enables tenant-scoped scheduler queries
-- and covers the non-tenant scheduler query via index skip-scan.

CREATE INDEX idx_ge_tenant_status_scheduled
  ON generated_emails (tenant_id, status, scheduled_for);

-- ============================================
-- 4. sequence_enrollments: composite (tenant_id, status)
-- ============================================
-- Used by enrollment list queries and the scheduler that
-- filters active enrollments per tenant.
-- Single tenant_id index (idx_enrollment_tenant) exists from migration-003.

CREATE INDEX idx_enrollment_tenant_status
  ON sequence_enrollments (tenant_id, status);

-- ============================================
-- 5. prospect_activities: composite (tenant_id, prospect_id)
-- ============================================
-- Used by prospect detail pages that fetch activities
-- for a specific prospect within a tenant.
-- Single tenant_id index (idx_activity_tenant) exists from migration-001.

CREATE INDEX idx_activity_tenant_prospect
  ON prospect_activities (tenant_id, prospect_id, occurred_at DESC);

-- ROLLBACK:
-- DROP INDEX idx_event_tenant_type ON email_events;
-- DROP INDEX idx_ge_tenant_status ON generated_emails;
-- DROP INDEX idx_ge_tenant_status_scheduled ON generated_emails;
-- DROP INDEX idx_enrollment_tenant_status ON sequence_enrollments;
-- DROP INDEX idx_activity_tenant_prospect ON prospect_activities;
