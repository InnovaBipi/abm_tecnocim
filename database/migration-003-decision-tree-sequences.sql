-- ============================================
-- Migration 003: Decision Tree Sequences
-- ============================================
-- Adds conditional branching, A/B testing, and
-- graph-based navigation to email sequences.
-- Backward-compatible: existing linear sequences
-- continue to work (NULL next_step fields = linear).
-- ============================================

-- ============================================
-- 1. ADD tenant_id TO sequence_steps
-- ============================================

ALTER TABLE sequence_steps
  ADD COLUMN tenant_id CHAR(36) NOT NULL DEFAULT 'tenant-camiacasa-0001' AFTER id;

-- Backfill tenant_id from parent sequence
UPDATE sequence_steps ss
  JOIN email_sequences es ON ss.sequence_id = es.id
  SET ss.tenant_id = es.tenant_id;

ALTER TABLE sequence_steps
  ADD KEY idx_step_tenant (tenant_id);

-- ============================================
-- 2. ADD tenant_id TO sequence_enrollments
-- ============================================

ALTER TABLE sequence_enrollments
  ADD COLUMN tenant_id CHAR(36) NOT NULL DEFAULT 'tenant-camiacasa-0001' AFTER id;

-- Backfill tenant_id from parent sequence
UPDATE sequence_enrollments se
  JOIN email_sequences es ON se.sequence_id = es.id
  SET se.tenant_id = es.tenant_id;

ALTER TABLE sequence_enrollments
  ADD KEY idx_enrollment_tenant (tenant_id);

-- ============================================
-- 3. ADD BRANCHING COLUMNS TO sequence_steps
-- ============================================

-- Condition configuration (JSON): what behavior to evaluate
-- Example: {"type": "opened", "step_id": "uuid-of-previous-email-step", "threshold_hours": 48}
-- Supported types: "opened", "clicked", "replied"
ALTER TABLE sequence_steps
  ADD COLUMN condition_config JSON DEFAULT NULL AFTER ab_variant;

-- Graph navigation: where to go based on condition result
-- NULL = linear mode (use step_number + 1)
ALTER TABLE sequence_steps
  ADD COLUMN yes_next_step_id CHAR(36) DEFAULT NULL AFTER condition_config;

ALTER TABLE sequence_steps
  ADD COLUMN no_next_step_id CHAR(36) DEFAULT NULL AFTER yes_next_step_id;

-- Branch label for UI display (e.g. "engaged", "not_engaged", "direct_close", "soft_close")
ALTER TABLE sequence_steps
  ADD COLUMN branch_label VARCHAR(50) DEFAULT NULL AFTER no_next_step_id;

-- Self-referential FKs for graph navigation
ALTER TABLE sequence_steps
  ADD CONSTRAINT fk_step_yes_next FOREIGN KEY (yes_next_step_id)
  REFERENCES sequence_steps(id) ON DELETE SET NULL;

ALTER TABLE sequence_steps
  ADD CONSTRAINT fk_step_no_next FOREIGN KEY (no_next_step_id)
  REFERENCES sequence_steps(id) ON DELETE SET NULL;

-- ============================================
-- 4. ADD GRAPH TRACKING TO sequence_enrollments
-- ============================================

-- Track current step by ID (not just number) for graph navigation
ALTER TABLE sequence_enrollments
  ADD COLUMN current_step_id CHAR(36) DEFAULT NULL AFTER current_step;

ALTER TABLE sequence_enrollments
  ADD CONSTRAINT fk_enroll_current_step FOREIGN KEY (current_step_id)
  REFERENCES sequence_steps(id) ON DELETE SET NULL;

-- A/B variant assignment (persists for entire enrollment)
ALTER TABLE sequence_enrollments
  ADD COLUMN ab_variant CHAR(1) DEFAULT NULL AFTER current_step_id;

-- Track which branch path was taken (for analytics)
-- Array of: {"from_step": 2, "to_step": 3, "condition": "opened", "result": true, "at": "..."}
ALTER TABLE sequence_enrollments
  ADD COLUMN path_history JSON DEFAULT NULL AFTER ab_variant;

-- ============================================
-- 5. SEQUENCE TYPE FLAG
-- ============================================

ALTER TABLE email_sequences
  ADD COLUMN sequence_type ENUM('linear', 'branched') DEFAULT 'linear' AFTER status;

-- ============================================
-- 6. A/B TEST RESULTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS ab_test_results (
    id              CHAR(36) PRIMARY KEY,
    tenant_id       CHAR(36) NOT NULL,
    sequence_id     CHAR(36) NOT NULL,
    step_number     INT NOT NULL,
    variant         CHAR(1) NOT NULL,
    sends           INT DEFAULT 0,
    opens           INT DEFAULT 0,
    clicks          INT DEFAULT 0,
    replies         INT DEFAULT 0,
    bounces         INT DEFAULT 0,
    is_winner       BOOLEAN DEFAULT FALSE,
    decided_at      DATETIME DEFAULT NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_abtest_tenant (tenant_id),
    KEY idx_abtest_sequence (sequence_id, step_number),
    UNIQUE KEY idx_abtest_unique (sequence_id, step_number, variant),
    CONSTRAINT fk_abtest_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    CONSTRAINT fk_abtest_sequence FOREIGN KEY (sequence_id) REFERENCES email_sequences(id) ON DELETE CASCADE
);

-- ============================================
-- 7. INDEX FOR CONDITION EVALUATION PERFORMANCE
-- ============================================

-- Speed up condition checks: "did prospect open email from step X?"
ALTER TABLE email_events
  ADD KEY idx_event_step_type (step_id, event_type, occurred_at DESC);

-- ROLLBACK:
-- ALTER TABLE sequence_steps DROP FOREIGN KEY fk_step_yes_next;
-- ALTER TABLE sequence_steps DROP FOREIGN KEY fk_step_no_next;
-- ALTER TABLE sequence_steps DROP COLUMN condition_config;
-- ALTER TABLE sequence_steps DROP COLUMN yes_next_step_id;
-- ALTER TABLE sequence_steps DROP COLUMN no_next_step_id;
-- ALTER TABLE sequence_steps DROP COLUMN branch_label;
-- ALTER TABLE sequence_steps DROP COLUMN tenant_id;
-- ALTER TABLE sequence_enrollments DROP FOREIGN KEY fk_enroll_current_step;
-- ALTER TABLE sequence_enrollments DROP COLUMN current_step_id;
-- ALTER TABLE sequence_enrollments DROP COLUMN ab_variant;
-- ALTER TABLE sequence_enrollments DROP COLUMN path_history;
-- ALTER TABLE sequence_enrollments DROP COLUMN tenant_id;
-- ALTER TABLE email_sequences DROP COLUMN sequence_type;
-- DROP TABLE IF EXISTS ab_test_results;
-- ALTER TABLE email_events DROP KEY idx_event_step_type;
