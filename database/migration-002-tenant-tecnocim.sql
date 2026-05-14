-- ============================================
-- Migration 002: Tenant Tecnocim
-- ============================================
-- Adds Tecnocim as the third tenant in the ABM platform.
-- Tecnocim is an innovation consulting company specializing in
-- R&D tax incentives (bonificaciones fiscales I+D+i), digital
-- transformation, and custom software development.
-- ============================================

-- ============================================
-- 1. INSERT TENANT
-- ============================================

INSERT INTO tenants (id, name, slug, domain, logo_url, primary_color, secondary_color, config)
VALUES (
    'tenant-tecnocim-0003',
    'Tecnocim',
    'tecnocim',
    'tecnocim.com',
    NULL,
    '#0F172A',
    '#2563EB',
    JSON_OBJECT(
        'email', JSON_OBJECT(
            'resend_api_key', '',
            'from_email', 'abm@tecnocim.com',
            'from_name', 'Tecnocim - Consultoría de Innovación',
            'reply_to', 'albert.sanchez@tecnocim.com',
            'notification_email', 'albert.sanchez@tecnocim.com'
        ),
        'imap', JSON_OBJECT(
            'host', '',
            'port', 993,
            'user', '',
            'pass', ''
        ),
        'entity', JSON_OBJECT(
            'type_label', 'Servicio',
            'type_label_plural', 'Servicios',
            'icon', 'Briefcase',
            'fields', JSON_ARRAY(
                JSON_OBJECT('key', 'service_type', 'label', 'Tipo de servicio', 'type', 'text'),
                JSON_OBJECT('key', 'service_area', 'label', 'Área de innovación', 'type', 'text'),
                JSON_OBJECT('key', 'service_price', 'label', 'Precio orientativo', 'type', 'number'),
                JSON_OBJECT('key', 'service_details', 'label', 'Detalles del servicio', 'type', 'json')
            )
        ),
        'ai', JSON_OBJECT(
            'company_description', 'Tecnocim - Consultora de innovación tecnológica con sede en Barcelona. Especializados en gestión integral de bonificaciones fiscales I+D+i (con sistema propio BIPI), transformación digital end-to-end, y desarrollo de software a medida. Equipo multidisciplinar de consultores e ingenieros con experiencia en sectores industrial, farmacéutico, tecnológico y de servicios. Gestionamos todo el proceso de deducciones fiscales por I+D+i: desde la identificación de proyectos elegibles hasta la defensa ante la AEAT.',
            'sender_name', 'Albert Sánchez',
            'industry_context', 'innovation consulting, R&D tax incentives (bonificaciones fiscales I+D+i), digital transformation, custom software development, FUNDAE training',
            'contact_email', 'albert.sanchez@tecnocim.com',
            'contact_phone', '',
            'perplexity_system', 'You are a research assistant specializing in innovation consulting, R&D tax incentives in Spain, digital transformation, technology services, and corporate training. Provide concise, factual information about companies and their innovation, technology, and R&D needs. Focus on Spanish and European markets.',
            'email_style', 'Tono profesional y técnico pero cercano. Hablar como consultor de innovación experto, de igual a igual. Enfatizar: experiencia en bonificaciones fiscales I+D+i con sistema propio, transformación digital end-to-end, soluciones de software a medida, equipo multidisciplinar. No usar lenguaje comercial agresivo ni exclamaciones. Adaptar el ángulo según el sector del prospect. Firma: Albert Sánchez / Tecnocim / tecnocim.com',
            'key_differentiators', 'Sistema propio BIPI para gestión integral de bonificaciones fiscales I+D+i. Transformación digital end-to-end (consultoría + implementación). Desarrollo de software a medida. Equipo multidisciplinar de consultores + ingenieros. Experiencia demostrable en sectores industrial, farmacéutico y tecnológico. Gestión completa ante AEAT para deducciones I+D+i.',
            'default_language', 'spanish'
        ),
        'branding', JSON_OBJECT(
            'app_name', 'Tecnocim ABM',
            'tagline', 'Consultoría de Innovación - Account-Based Marketing',
            'footer_html', '<p>Tecnocim Innova · <a href=\"https://tecnociminnova.com\" style=\"color:#2563EB\">tecnociminnova.com</a><br>Consultoría de Innovación Tecnológica</p>'
        ),
        'warmup', JSON_OBJECT(
            'daily_limit_base', 10,
            'daily_limit_max', 50,
            'ramp_up_days', 30
        )
    )
);

-- ============================================
-- 2. ADMIN USER FOR TECNOCIM
-- ============================================
-- Password: TecnocimABM2026! (bcrypt hash below)
-- IMPORTANT: Change this password on first login!

INSERT INTO users (id, tenant_id, email, password, first_name, last_name, role)
VALUES (
    UUID(),
    'tenant-tecnocim-0003',
    'albert.sanchez@tecnocim.com',
    '$2b$10$placeholder_hash_change_on_first_run',
    'Albert',
    'Sánchez',
    'admin'
);

-- ============================================
-- 3. DEFAULT SCORING RULES FOR TECNOCIM
-- ============================================
-- Adapted for innovation consulting / R&D tax incentives market

INSERT INTO scoring_rules (id, tenant_id, name, category, field_name, operator, field_value, points) VALUES
-- Demographic: target decision-makers for innovation/R&D
(UUID(), 'tenant-tecnocim-0003', 'CTO/CIO', 'demographic', 'title', 'contains', '"CTO"', 30),
(UUID(), 'tenant-tecnocim-0003', 'Director I+D', 'demographic', 'title', 'contains', '"I+D"', 30),
(UUID(), 'tenant-tecnocim-0003', 'Director Innovación', 'demographic', 'title', 'contains', '"Innovación"', 30),
(UUID(), 'tenant-tecnocim-0003', 'Director Tecnología', 'demographic', 'title', 'contains', '"Tecnología"', 25),
(UUID(), 'tenant-tecnocim-0003', 'CFO / Director Financiero', 'demographic', 'title', 'contains', '"Financiero"', 20),
(UUID(), 'tenant-tecnocim-0003', 'Director RRHH', 'demographic', 'title', 'contains', '"RRHH"', 15),
(UUID(), 'tenant-tecnocim-0003', 'CEO / Director General', 'demographic', 'seniority', 'equals', '"C-Level"', 25),
(UUID(), 'tenant-tecnocim-0003', 'VP', 'demographic', 'seniority', 'equals', '"VP"', 20),

-- Firmographic: industries with high R&D potential
(UUID(), 'tenant-tecnocim-0003', 'Sector Tecnología', 'firmographic', 'industry', 'contains', '"Tecnología"', 25),
(UUID(), 'tenant-tecnocim-0003', 'Sector Farmacéutico', 'firmographic', 'industry', 'contains', '"Farmacéutico"', 25),
(UUID(), 'tenant-tecnocim-0003', 'Sector Industrial', 'firmographic', 'industry', 'contains', '"Industrial"', 20),
(UUID(), 'tenant-tecnocim-0003', 'Sector Automoción', 'firmographic', 'industry', 'contains', '"Automoción"', 20),
(UUID(), 'tenant-tecnocim-0003', 'Sector Alimentación', 'firmographic', 'industry', 'contains', '"Alimentación"', 15),
(UUID(), 'tenant-tecnocim-0003', 'Empresa mediana (+50 empleados)', 'firmographic', 'employee_count', 'greater_than', '"50"', 15),
(UUID(), 'tenant-tecnocim-0003', 'Empresa grande (+200 empleados)', 'firmographic', 'employee_count', 'greater_than', '"200"', 25),

-- Engagement: email interactions
(UUID(), 'tenant-tecnocim-0003', 'Email abierto', 'engagement', 'email_opened', 'equals', 'true', 5),
(UUID(), 'tenant-tecnocim-0003', 'Link clicado', 'engagement', 'email_clicked', 'equals', 'true', 15),
(UUID(), 'tenant-tecnocim-0003', 'Email respondido', 'engagement', 'email_replied', 'equals', 'true', 30),
(UUID(), 'tenant-tecnocim-0003', 'Respuesta negativa', 'engagement', 'negative_reply', 'equals', 'true', -50);

-- ============================================
-- 4. IMAP SYNC STATE FOR TECNOCIM
-- ============================================

INSERT IGNORE INTO imap_sync_state (id, tenant_id, mailbox, last_uid)
VALUES (UUID(), 'tenant-tecnocim-0003', 'INBOX', 0);
