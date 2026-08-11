-- ============================================
-- ABM Platform - MySQL Database Schema
-- ============================================

CREATE DATABASE IF NOT EXISTS abm_tecnocim
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE abm_tecnocim;

-- ============================================
-- USERS & AUTH
-- ============================================

CREATE TABLE users (
    id          CHAR(36) PRIMARY KEY,
    email       VARCHAR(255) NOT NULL UNIQUE,
    password    VARCHAR(255) NOT NULL,
    first_name  VARCHAR(100),
    last_name   VARCHAR(100),
    sender_email VARCHAR(255) NULL,
    sender_name  VARCHAR(100) NULL,
    role        ENUM('admin', 'manager', 'member', 'viewer') DEFAULT 'member',
    is_active   BOOLEAN DEFAULT TRUE,
    last_login  DATETIME,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================
-- COMPANIES (Accounts in ABM)
-- ============================================

CREATE TABLE companies (
    id                CHAR(36) PRIMARY KEY,
    name              VARCHAR(255) NOT NULL,
    domain            VARCHAR(255),
    industry          VARCHAR(100),
    employee_count    VARCHAR(50),
    annual_revenue    VARCHAR(50),
    city              VARCHAR(100),
    region            VARCHAR(100),
    country           VARCHAR(100) DEFAULT 'Spain',
    website_url       TEXT,
    linkedin_url      TEXT,
    description       TEXT,
    enrichment_data   JSON,
    tier              ENUM('A', 'B', 'C', 'D') DEFAULT 'C',
    account_score     INT DEFAULT 0,
    is_target         BOOLEAN DEFAULT FALSE,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY idx_company_domain (domain)
);

-- ============================================
-- PROSPECTS (Contacts/Leads)
-- ============================================

CREATE TABLE prospects (
    id                CHAR(36) PRIMARY KEY,
    company_id        CHAR(36),
    email             VARCHAR(255) NOT NULL,
    first_name        VARCHAR(100),
    last_name         VARCHAR(100),
    full_name         VARCHAR(200) AS (CONCAT_WS(' ', first_name, last_name)) STORED,
    title             VARCHAR(200),
    seniority         VARCHAR(50),
    department        VARCHAR(100),
    phone             VARCHAR(50),
    linkedin_url      TEXT,
    city              VARCHAR(100),
    region            VARCHAR(100),
    country           VARCHAR(100) DEFAULT 'Spain',
    timezone          VARCHAR(50) DEFAULT 'Europe/Madrid',
    email_verified    BOOLEAN DEFAULT FALSE,
    email_status      ENUM('valid', 'invalid', 'catch-all', 'unknown') DEFAULT 'unknown',
    status            ENUM('new', 'enriched', 'qualified', 'contacted', 'replied', 'interested', 'meeting', 'converted', 'unsubscribed', 'bounced') DEFAULT 'new',
    lead_score        INT DEFAULT 0,
    custom_fields     JSON,
    enrichment_data   JSON,
    source            VARCHAR(50),
    source_detail     VARCHAR(255),
    last_contacted    DATETIME,
    last_replied      DATETIME,
    do_not_contact    BOOLEAN DEFAULT FALSE,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY idx_prospect_email (email),
    KEY idx_prospect_company (company_id),
    KEY idx_prospect_status (status),
    KEY idx_prospect_score (lead_score DESC),
    KEY idx_prospect_source (source),
    FULLTEXT KEY idx_prospect_search (first_name, last_name, email, title),
    CONSTRAINT fk_prospect_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
);

-- ============================================
-- TAGS
-- ============================================

CREATE TABLE tags (
    id          CHAR(36) PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    color       VARCHAR(7) DEFAULT '#6366f1',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE prospect_tags (
    prospect_id CHAR(36) NOT NULL,
    tag_id      CHAR(36) NOT NULL,
    PRIMARY KEY (prospect_id, tag_id),
    CONSTRAINT fk_pt_prospect FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE,
    CONSTRAINT fk_pt_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE company_tags (
    company_id  CHAR(36) NOT NULL,
    tag_id      CHAR(36) NOT NULL,
    PRIMARY KEY (company_id, tag_id),
    CONSTRAINT fk_ct_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
    CONSTRAINT fk_ct_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- ============================================
-- CAMPAIGNS (each real estate asset = 1 campaign)
-- ============================================

CREATE TABLE campaigns (
    id                CHAR(36) PRIMARY KEY,
    name              VARCHAR(255) NOT NULL,
    description       TEXT,
    asset_type        VARCHAR(100),
    asset_location    VARCHAR(255),
    asset_price       DECIMAL(15, 2),
    asset_details     JSON,
    campaign_type     ENUM('outbound', 'nurture', 'reactivation') DEFAULT 'outbound',
    status            ENUM('draft', 'active', 'paused', 'completed', 'archived') DEFAULT 'draft',
    start_date        DATE,
    end_date          DATE,
    created_by        CHAR(36),
    sender_user_id    CHAR(36),
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_campaign_status (status),
    KEY idx_campaigns_sender_user (sender_user_id),
    CONSTRAINT fk_campaign_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_campaigns_sender_user FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE campaign_prospects (
    id              CHAR(36) PRIMARY KEY,
    campaign_id     CHAR(36) NOT NULL,
    prospect_id     CHAR(36) NOT NULL,
    status          ENUM('active', 'paused', 'completed', 'removed') DEFAULT 'active',
    added_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY idx_cp_unique (campaign_id, prospect_id),
    CONSTRAINT fk_cp_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    CONSTRAINT fk_cp_prospect FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
);

-- ============================================
-- EMAIL SEQUENCES
-- ============================================

CREATE TABLE email_sequences (
    id              CHAR(36) PRIMARY KEY,
    campaign_id     CHAR(36),
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    status          ENUM('draft', 'active', 'paused', 'archived') DEFAULT 'draft',
    from_name       VARCHAR(100),
    from_email      VARCHAR(255),
    reply_to        VARCHAR(255),
    send_window     JSON DEFAULT (JSON_OBJECT(
        'days', JSON_ARRAY(1,2,3,4,5),
        'start_hour', 9,
        'end_hour', 17,
        'timezone', 'Europe/Madrid'
    )),
    settings        JSON DEFAULT (JSON_OBJECT(
        'stop_on_reply', TRUE,
        'stop_on_bounce', TRUE,
        'daily_limit', 50
    )),
    created_by      CHAR(36),
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_sequence_campaign (campaign_id),
    KEY idx_sequence_status (status),
    CONSTRAINT fk_seq_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL,
    CONSTRAINT fk_seq_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE sequence_steps (
    id              CHAR(36) PRIMARY KEY,
    sequence_id     CHAR(36) NOT NULL,
    step_number     INT NOT NULL,
    step_type       ENUM('email', 'wait', 'condition') DEFAULT 'email',
    subject         TEXT,
    body_html       TEXT,
    body_text       TEXT,
    delay_days      INT DEFAULT 0,
    delay_hours     INT DEFAULT 0,
    ab_variant      CHAR(1),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY idx_step_order (sequence_id, step_number),
    CONSTRAINT fk_step_sequence FOREIGN KEY (sequence_id) REFERENCES email_sequences(id) ON DELETE CASCADE
);

CREATE TABLE sequence_enrollments (
    id              CHAR(36) PRIMARY KEY,
    sequence_id     CHAR(36) NOT NULL,
    prospect_id     CHAR(36) NOT NULL,
    current_step    INT DEFAULT 0,
    status          ENUM('active', 'paused', 'completed', 'replied', 'bounced', 'unsubscribed', 'removed') DEFAULT 'active',
    enrolled_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at    DATETIME,
    next_send_at    DATETIME,
    metadata        JSON,
    UNIQUE KEY idx_enrollment_unique (sequence_id, prospect_id),
    KEY idx_enrollment_next_send (status, next_send_at),
    CONSTRAINT fk_enroll_sequence FOREIGN KEY (sequence_id) REFERENCES email_sequences(id) ON DELETE CASCADE,
    CONSTRAINT fk_enroll_prospect FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
);

-- ============================================
-- EMAIL EVENTS (tracking)
-- ============================================

CREATE TABLE email_events (
    id              CHAR(36) PRIMARY KEY,
    enrollment_id   CHAR(36),
    prospect_id     CHAR(36) NOT NULL,
    sequence_id     CHAR(36),
    step_id         CHAR(36),
    event_type      ENUM('sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'complaint', 'unsubscribed') NOT NULL,
    resend_email_id VARCHAR(100),
    message_id      VARCHAR(255),
    subject         TEXT,
    from_email      VARCHAR(255),
    link_clicked    TEXT,
    user_agent      TEXT,
    ip_address      VARCHAR(45),
    metadata        JSON,
    occurred_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_event_prospect (prospect_id, occurred_at DESC),
    KEY idx_event_sequence (sequence_id, event_type),
    KEY idx_event_type (event_type, occurred_at DESC),
    KEY idx_event_resend (resend_email_id),
    CONSTRAINT fk_event_enrollment FOREIGN KEY (enrollment_id) REFERENCES sequence_enrollments(id) ON DELETE SET NULL,
    CONSTRAINT fk_event_prospect FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE,
    CONSTRAINT fk_event_sequence FOREIGN KEY (sequence_id) REFERENCES email_sequences(id) ON DELETE SET NULL,
    CONSTRAINT fk_event_step FOREIGN KEY (step_id) REFERENCES sequence_steps(id) ON DELETE SET NULL
);

-- ============================================
-- GENERATED EMAILS (per-prospect personalized emails)
-- ============================================

CREATE TABLE generated_emails (
    id              CHAR(36) PRIMARY KEY,
    campaign_id     CHAR(36) NOT NULL,
    prospect_id     CHAR(36) NOT NULL,
    step_number     INT NOT NULL,
    subject         TEXT,
    body_html       TEXT,
    delay_days      INT DEFAULT 0,
    status          ENUM('draft', 'approved', 'rejected', 'scheduled', 'sent', 'opened', 'replied', 'bounced') DEFAULT 'draft',
    approved_at     DATETIME,
    approved_by     CHAR(36),
    sent_at         DATETIME,
    scheduled_for   DATETIME,
    metadata        JSON,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY idx_ge_unique (campaign_id, prospect_id, step_number),
    KEY idx_ge_campaign (campaign_id, status),
    KEY idx_ge_prospect (prospect_id),
    KEY idx_ge_status (status),
    KEY idx_ge_scheduled (status, scheduled_for),
    CONSTRAINT fk_ge_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
    CONSTRAINT fk_ge_prospect FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE,
    CONSTRAINT fk_ge_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================
-- SCORING
-- ============================================

CREATE TABLE scoring_rules (
    id              CHAR(36) PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    category        ENUM('demographic', 'firmographic', 'behavioral', 'engagement') NOT NULL,
    field_name      VARCHAR(100) NOT NULL,
    operator        ENUM('equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'in', 'not_in', 'exists') NOT NULL,
    field_value     JSON NOT NULL,
    points          INT NOT NULL,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE prospect_score_history (
    id              CHAR(36) PRIMARY KEY,
    prospect_id     CHAR(36) NOT NULL,
    score           INT NOT NULL,
    score_breakdown JSON,
    calculated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_score_prospect (prospect_id, calculated_at DESC),
    CONSTRAINT fk_score_prospect FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
);

-- ============================================
-- CSV/EXCEL IMPORTS
-- ============================================

CREATE TABLE imports (
    id              CHAR(36) PRIMARY KEY,
    file_name       VARCHAR(255) NOT NULL,
    file_path       TEXT,
    file_size       INT,
    status          ENUM('pending', 'processing', 'mapping', 'importing', 'completed', 'failed') DEFAULT 'pending',
    total_rows      INT DEFAULT 0,
    processed_rows  INT DEFAULT 0,
    imported_rows   INT DEFAULT 0,
    skipped_rows    INT DEFAULT 0,
    error_rows      INT DEFAULT 0,
    column_mapping  JSON,
    default_tags    JSON,
    errors          JSON,
    started_at      DATETIME,
    completed_at    DATETIME,
    created_by      CHAR(36),
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_import_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE import_rows (
    id              CHAR(36) PRIMARY KEY,
    import_id       CHAR(36) NOT NULL,
    `row_number`    INT NOT NULL,
    raw_data        JSON NOT NULL,
    mapped_data     JSON,
    status          ENUM('pending', 'imported', 'duplicate', 'invalid', 'error') DEFAULT 'pending',
    prospect_id     CHAR(36),
    error_message   TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_row_import (import_id, status),
    CONSTRAINT fk_row_import FOREIGN KEY (import_id) REFERENCES imports(id) ON DELETE CASCADE,
    CONSTRAINT fk_row_prospect FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE SET NULL
);

-- ============================================
-- BACKGROUND JOBS (MySQL-based queue)
-- ============================================

CREATE TABLE jobs (
    id              CHAR(36) PRIMARY KEY,
    queue           VARCHAR(50) NOT NULL DEFAULT 'default',
    job_type        VARCHAR(100) NOT NULL,
    payload         JSON NOT NULL,
    status          ENUM('pending', 'processing', 'completed', 'failed', 'retry') DEFAULT 'pending',
    priority        INT DEFAULT 0,
    attempts        INT DEFAULT 0,
    max_attempts    INT DEFAULT 3,
    result          JSON,
    error_message   TEXT,
    run_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at      DATETIME,
    completed_at    DATETIME,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_job_queue (queue, status, run_at),
    KEY idx_job_type (job_type, status)
);

-- ============================================
-- ACTIVITY LOG
-- ============================================

CREATE TABLE prospect_activities (
    id              CHAR(36) PRIMARY KEY,
    prospect_id     CHAR(36) NOT NULL,
    activity_type   VARCHAR(30) NOT NULL,
    title           VARCHAR(255),
    description     TEXT,
    metadata        JSON,
    performed_by    CHAR(36),
    occurred_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    KEY idx_activity_prospect (prospect_id, occurred_at DESC),
    KEY idx_activity_type (activity_type, occurred_at DESC),
    CONSTRAINT fk_activity_prospect FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE,
    CONSTRAINT fk_activity_user FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================
-- SUPPRESSION LIST (anti-spam compliance)
-- ============================================

CREATE TABLE suppression_list (
    id              CHAR(36) PRIMARY KEY,
    email           VARCHAR(255) NOT NULL UNIQUE,
    reason          ENUM('unsubscribed', 'bounced', 'complaint', 'manual') NOT NULL,
    source          VARCHAR(100),
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- SEED DATA: Default scoring rules
-- ============================================

INSERT INTO scoring_rules (id, name, category, field_name, operator, field_value, points) VALUES
(UUID(), 'C-Level seniority', 'demographic', 'seniority', 'equals', '"C-Level"', 30),
(UUID(), 'VP seniority', 'demographic', 'seniority', 'equals', '"VP"', 25),
(UUID(), 'Director seniority', 'demographic', 'seniority', 'equals', '"Director"', 20),
(UUID(), 'Manager seniority', 'demographic', 'seniority', 'equals', '"Manager"', 10),
(UUID(), 'Real Estate industry', 'firmographic', 'industry', 'contains', '"Real Estate"', 25),
(UUID(), 'Investment industry', 'firmographic', 'industry', 'contains', '"Investment"', 25),
(UUID(), 'Finance industry', 'firmographic', 'industry', 'contains', '"Finance"', 15),
(UUID(), 'Email opened', 'engagement', 'email_opened', 'equals', 'true', 5),
(UUID(), 'Link clicked', 'engagement', 'email_clicked', 'equals', 'true', 15),
(UUID(), 'Email replied', 'engagement', 'email_replied', 'equals', 'true', 30),
(UUID(), 'Negative reply', 'engagement', 'negative_reply', 'equals', 'true', -50);

-- ============================================
-- SEED DATA: Default admin user
-- Password: admin123 (bcrypt hash - CHANGE IN PRODUCTION)
-- ============================================

INSERT INTO users (id, email, password, first_name, last_name, role) VALUES
(UUID(), 'alfons.marques@camiacasa.cat', '$2b$10$placeholder_hash_change_on_first_run', 'Alfons', 'Marques', 'admin');

-- ============================================
-- IMAP SYNC STATE (for reply detection polling)
-- ============================================

CREATE TABLE IF NOT EXISTS imap_sync_state (
    id          CHAR(36) PRIMARY KEY,
    mailbox     VARCHAR(255) NOT NULL DEFAULT 'INBOX',
    last_uid    INT UNSIGNED NOT NULL DEFAULT 0,
    last_synced_at DATETIME,
    UNIQUE KEY idx_imap_mailbox (mailbox)
);

INSERT IGNORE INTO imap_sync_state (id, mailbox, last_uid) VALUES (UUID(), 'INBOX', 0);

-- Performance index for warm-up daily send counting
CREATE INDEX idx_event_sent_today ON email_events (sequence_id, event_type, occurred_at);
