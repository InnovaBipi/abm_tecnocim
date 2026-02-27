-- ============================================
-- Migration 001: Multi-Tenancy Support
-- ============================================
-- Converts single-tenant CamiaCasa ABM into multi-tenant platform.
-- All existing data gets assigned to tenant-camiacasa-0001.
-- ============================================

-- ============================================
-- 1. CREATE TENANTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS tenants (
    id              CHAR(36) PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(100) NOT NULL UNIQUE,
    domain          VARCHAR(255),
    logo_url        TEXT,
    primary_color   VARCHAR(7) DEFAULT '#1e40af',
    secondary_color VARCHAR(7) DEFAULT '#6366f1',
    config          JSON NOT NULL DEFAULT ('{}'),
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================
-- 2. SEED INITIAL TENANTS
-- ============================================

INSERT INTO tenants (id, name, slug, domain, logo_url, primary_color, secondary_color, config) VALUES
(
    'tenant-camiacasa-0001',
    'CamiaCasa',
    'camiacasa',
    'camiacasa.cat',
    NULL,
    '#1e40af',
    '#6366f1',
    JSON_OBJECT(
        'email', JSON_OBJECT(
            'resend_api_key', '',
            'from_email', 'noreply@camiacasa.cat',
            'from_name', 'CamiaCasa',
            'reply_to', 'alfons.marques@camiacasa.cat',
            'notification_email', 'alfons.marques@camiacasa.cat'
        ),
        'imap', JSON_OBJECT(
            'host', '',
            'port', 993,
            'user', '',
            'pass', ''
        ),
        'entity', JSON_OBJECT(
            'type_label', 'Propiedad',
            'type_label_plural', 'Propiedades',
            'icon', 'Building2',
            'fields', JSON_ARRAY(
                JSON_OBJECT('key', 'asset_type', 'label', 'Tipo de activo', 'type', 'text'),
                JSON_OBJECT('key', 'asset_location', 'label', 'Ubicación', 'type', 'text'),
                JSON_OBJECT('key', 'asset_price', 'label', 'Precio', 'type', 'number'),
                JSON_OBJECT('key', 'asset_details', 'label', 'Detalles', 'type', 'json')
            )
        ),
        'ai', JSON_OBJECT(
            'company_description', 'CamiaCasa - Agencia inmobiliaria profesional en Sant Vicenç dels Horts (Baix Llobregat, Catalunya). +15 años de experiencia, +64 municipios. Especializados en compra-venta, gestión de patrimonio, inversión inmobiliaria, personal shopping inmobiliario y valoraciones profesionales.',
            'sender_name', 'Alfons Marques',
            'industry_context', 'real estate and property investment',
            'perplexity_system', 'You are a research assistant specializing in real estate and business intelligence. Provide concise, factual information.'
        ),
        'branding', JSON_OBJECT(
            'app_name', 'CamiaCasa ABM',
            'tagline', 'Account-Based Marketing for Real Estate',
            'footer_html', '<p>CamiaCasa - Agencia Inmobiliaria Profesional</p>'
        ),
        'warmup', JSON_OBJECT(
            'daily_limit_base', 20,
            'daily_limit_max', 100,
            'ramp_up_days', 30
        )
    )
),
(
    'tenant-technova-0002',
    'Technova Partners',
    'technova',
    'technovapartners.com',
    NULL,
    '#1a56db',
    '#14b8a6',
    JSON_OBJECT(
        'email', JSON_OBJECT(
            'resend_api_key', '',
            'from_email', 'alfons.marques@technovapartners.com',
            'from_name', 'Alfons Marquès - Technova Partners',
            'reply_to', 'info@technovapartners.com',
            'notification_email', 'alfons.marques@technovapartners.com'
        ),
        'imap', JSON_OBJECT(
            'host', '',
            'port', 993,
            'user', '',
            'pass', ''
        ),
        'entity', JSON_OBJECT(
            'type_label', 'Programa',
            'type_label_plural', 'Programas',
            'icon', 'GraduationCap',
            'fields', JSON_ARRAY(
                JSON_OBJECT('name', 'training', 'label', 'Formación IA', 'type', 'text'),
                JSON_OBJECT('name', 'consulting', 'label', 'Consultoría + Formación', 'type', 'text'),
                JSON_OBJECT('name', 'partnering', 'label', 'Partnering 12 Meses', 'type', 'text'),
                JSON_OBJECT('name', 'general', 'label', 'General', 'type', 'text')
            )
        ),
        'ai', JSON_OBJECT(
            'company_description', 'Technova Partners - Consultora especializada en formación estratégica en Inteligencia Artificial para empresas. Programas 100% a medida: diagnóstico previo con entrevistas 1:1, formación práctica hands-on con herramientas reales (ChatGPT, Gemini, Copilot), y seguimiento post-formación de 30/60/90 días. Tres modalidades: Formación IA (3-5 días, 12-40h), Consultoría + Formación (6-8 semanas) y Partnering 12 Meses (transformación total). Clientes: Lidl, SEAT, AstraZeneca, Iberostar. 100% bonificable vía FUNDAE. Gestionamos la tramitación con RRHH. Sede: Carrer Cortina 16, 08720 Vilafranca del Penedès, Barcelona.',
            'sender_name', 'Alfons Marquès',
            'industry_context', 'AI training, corporate education, digital transformation consulting',
            'contact_email', 'info@technovapartners.com',
            'contact_phone', '+34 614 378 560',
            'perplexity_system', 'You are a research assistant specializing in corporate training, AI adoption, digital transformation, and business intelligence. Provide concise, factual information about companies and their training needs.',
            'email_style', 'Tono profesional pero cercano. No usar lenguaje comercial agresivo ni exclamaciones. Hablar como un consultor experto, de igual a igual. Enfatizar: formación a medida (no de catálogo), diagnóstico previo, enfoque práctico hands-on, bonificable FUNDAE 100%, casos reales del sector del prospect. Firma: Alfons Marquès / Technova Partners / 614 378 560',
            'key_differentiators', 'Diagnóstico previo personalizado con entrevistas 1:1 y formulario discovery. Programas a medida desde casos de uso reales del cliente. Herramientas prácticas: ChatGPT, Gemini, Copilot, Notion AI. 100% bonificable vía FUNDAE (gestionamos tramitación con RRHH). Seguimiento post-formación. Clientes referencia: Lidl, SEAT, AstraZeneca, Iberostar.',
            'default_language', 'spanish'
        ),
        'branding', JSON_OBJECT(
            'app_name', 'Technova Partners',
            'tagline', 'Formación Estratégica en IA',
            'footer_html', '<p>Technova Partners - Formación Estratégica en IA para Empresas<br>Carrer Cortina 16 · 08720 Vilafranca del Penedès, Barcelona<br><a href="https://technovapartners.com" style="color:#1a56db">technovapartners.com</a></p>'
        ),
        'warmup', JSON_OBJECT(
            'daily_limit_base', 20,
            'daily_limit_max', 100,
            'ramp_up_days', 30
        )
    )
);

-- ============================================
-- 3. ADD tenant_id TO ALL DATA TABLES
-- ============================================

-- Users
ALTER TABLE users ADD COLUMN tenant_id CHAR(36) NOT NULL DEFAULT 'tenant-camiacasa-0001' AFTER id;
ALTER TABLE users ADD KEY idx_user_tenant (tenant_id);
ALTER TABLE users ADD CONSTRAINT fk_user_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Companies
ALTER TABLE companies ADD COLUMN tenant_id CHAR(36) NOT NULL DEFAULT 'tenant-camiacasa-0001' AFTER id;
ALTER TABLE companies ADD KEY idx_company_tenant (tenant_id);
ALTER TABLE companies ADD CONSTRAINT fk_company_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Prospects
ALTER TABLE prospects ADD COLUMN tenant_id CHAR(36) NOT NULL DEFAULT 'tenant-camiacasa-0001' AFTER id;
ALTER TABLE prospects ADD KEY idx_prospect_tenant (tenant_id);
ALTER TABLE prospects ADD CONSTRAINT fk_prospect_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Campaigns
ALTER TABLE campaigns ADD COLUMN tenant_id CHAR(36) NOT NULL DEFAULT 'tenant-camiacasa-0001' AFTER id;
ALTER TABLE campaigns ADD KEY idx_campaign_tenant (tenant_id);
ALTER TABLE campaigns ADD CONSTRAINT fk_campaign_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Email Sequences
ALTER TABLE email_sequences ADD COLUMN tenant_id CHAR(36) NOT NULL DEFAULT 'tenant-camiacasa-0001' AFTER id;
ALTER TABLE email_sequences ADD KEY idx_sequence_tenant (tenant_id);
ALTER TABLE email_sequences ADD CONSTRAINT fk_sequence_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Generated Emails
ALTER TABLE generated_emails ADD COLUMN tenant_id CHAR(36) NOT NULL DEFAULT 'tenant-camiacasa-0001' AFTER id;
ALTER TABLE generated_emails ADD KEY idx_ge_tenant (tenant_id);
ALTER TABLE generated_emails ADD CONSTRAINT fk_ge_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Scoring Rules
ALTER TABLE scoring_rules ADD COLUMN tenant_id CHAR(36) NOT NULL DEFAULT 'tenant-camiacasa-0001' AFTER id;
ALTER TABLE scoring_rules ADD KEY idx_scoring_tenant (tenant_id);
ALTER TABLE scoring_rules ADD CONSTRAINT fk_scoring_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Imports
ALTER TABLE imports ADD COLUMN tenant_id CHAR(36) NOT NULL DEFAULT 'tenant-camiacasa-0001' AFTER id;
ALTER TABLE imports ADD KEY idx_import_tenant (tenant_id);
ALTER TABLE imports ADD CONSTRAINT fk_import_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Jobs
ALTER TABLE jobs ADD COLUMN tenant_id CHAR(36) NOT NULL DEFAULT 'tenant-camiacasa-0001' AFTER id;
ALTER TABLE jobs ADD KEY idx_job_tenant (tenant_id);
ALTER TABLE jobs ADD CONSTRAINT fk_job_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Suppression List
ALTER TABLE suppression_list ADD COLUMN tenant_id CHAR(36) NOT NULL DEFAULT 'tenant-camiacasa-0001' AFTER id;
ALTER TABLE suppression_list ADD KEY idx_suppression_tenant (tenant_id);
ALTER TABLE suppression_list ADD CONSTRAINT fk_suppression_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- IMAP Sync State
ALTER TABLE imap_sync_state ADD COLUMN tenant_id CHAR(36) NOT NULL DEFAULT 'tenant-camiacasa-0001' AFTER id;
ALTER TABLE imap_sync_state ADD KEY idx_imap_tenant (tenant_id);
ALTER TABLE imap_sync_state ADD CONSTRAINT fk_imap_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Email Events
ALTER TABLE email_events ADD COLUMN tenant_id CHAR(36) NOT NULL DEFAULT 'tenant-camiacasa-0001' AFTER id;
ALTER TABLE email_events ADD KEY idx_event_tenant (tenant_id);
ALTER TABLE email_events ADD CONSTRAINT fk_event_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Prospect Activities
ALTER TABLE prospect_activities ADD COLUMN tenant_id CHAR(36) NOT NULL DEFAULT 'tenant-camiacasa-0001' AFTER id;
ALTER TABLE prospect_activities ADD KEY idx_activity_tenant (tenant_id);
ALTER TABLE prospect_activities ADD CONSTRAINT fk_activity_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Prospect Score History
ALTER TABLE prospect_score_history ADD COLUMN tenant_id CHAR(36) NOT NULL DEFAULT 'tenant-camiacasa-0001' AFTER id;
ALTER TABLE prospect_score_history ADD KEY idx_score_tenant (tenant_id);
ALTER TABLE prospect_score_history ADD CONSTRAINT fk_score_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- Tags
ALTER TABLE tags ADD COLUMN tenant_id CHAR(36) NOT NULL DEFAULT 'tenant-camiacasa-0001' AFTER id;
ALTER TABLE tags ADD KEY idx_tag_tenant (tenant_id);
ALTER TABLE tags ADD CONSTRAINT fk_tag_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- ============================================
-- 4. UPDATE UNIQUE CONSTRAINTS TO PER-TENANT
-- ============================================

-- Users: email unique per tenant (not globally)
ALTER TABLE users DROP INDEX email;
ALTER TABLE users ADD UNIQUE KEY idx_user_tenant_email (tenant_id, email);

-- Prospects: email unique per tenant
ALTER TABLE prospects DROP INDEX idx_prospect_email;
ALTER TABLE prospects ADD UNIQUE KEY idx_prospect_tenant_email (tenant_id, email);

-- Companies: domain unique per tenant
ALTER TABLE companies DROP INDEX idx_company_domain;
ALTER TABLE companies ADD UNIQUE KEY idx_company_tenant_domain (tenant_id, domain);

-- Tags: name unique per tenant
ALTER TABLE tags DROP INDEX name;
ALTER TABLE tags ADD UNIQUE KEY idx_tag_tenant_name (tenant_id, name);

-- Suppression list: email unique per tenant
ALTER TABLE suppression_list DROP INDEX email;
ALTER TABLE suppression_list ADD UNIQUE KEY idx_suppression_tenant_email (tenant_id, email);

-- IMAP sync state: mailbox unique per tenant
ALTER TABLE imap_sync_state DROP INDEX idx_imap_mailbox;
ALTER TABLE imap_sync_state ADD UNIQUE KEY idx_imap_tenant_mailbox (tenant_id, mailbox);
