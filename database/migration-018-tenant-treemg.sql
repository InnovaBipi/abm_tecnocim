-- ============================================
-- Migration 018: Tenant TreeMG
-- ============================================
-- Adds Tree Mobile Group S.L. (brand "MasTree", domain treemg.com)
-- as a new tenant in the ABM platform.
--
-- SCOPE: account + email configuration ONLY. No prospects imported,
-- no campaign created. The purchased database ("base comprada") and the
-- "LOVE 5" telecom campaign are intentionally out of scope until the
-- RGPD/LSSI data-source approach is decided (a purchased list has no
-- legal basis for commercial email under LSSI Art. 21).
--
-- SENDING: this platform sends via Resend only (no SMTP). treemg.com must
-- be verified in a SEPARATE Resend workspace to isolate the reputation of
-- Tecnocim / Technova / CamiaCasa. resend_api_key is left empty here and
-- loaded later (encrypted) via PUT /api/settings/email.
--
-- REPLIES: treemg.com mail is hosted at dinahosting (82.98.168.216). Standard
-- IMAP basic auth on 993 works (NOT Microsoft 365, so no basic-auth blackout
-- like the Tecnocim mailbox). IMPORTANT: use the official host
-- treemg-com.correoseguro.dinaserver.com, NOT mail.treemg.com — the TLS cert is
-- *.correoseguro.dinaserver.com, so mail.treemg.com fails strict cert validation
-- (Node ImapFlow rejectUnauthorized=true, and the new Outlook cloud sync too).
-- Host/port/user are pre-filled below; the IMAP password is loaded later
-- (encrypted) via PUT /api/settings/email.
-- ============================================

-- ============================================
-- 1. INSERT TENANT
-- ============================================

INSERT INTO tenants (id, name, slug, domain, logo_url, primary_color, secondary_color, config)
VALUES (
    'tenant-treemg-0004',
    'Tree Mobile Group',
    'treemg',
    'treemg.com',
    NULL,
    '#1F6B2E',
    '#76923C',
    JSON_OBJECT(
        'email', JSON_OBJECT(
            'resend_api_key', '',
            'from_email', 'alfons.marques@treemg.com',
            'from_name', 'Alfons Marques - MasTree',
            'reply_to', 'alfons.marques@treemg.com',
            'notification_email', 'alfons.marques@treemg.com'
        ),
        'imap', JSON_OBJECT(
            'host', 'treemg-com.correoseguro.dinaserver.com',
            'port', 993,
            'user', 'alfons.marques@treemg.com',
            'pass', ''
        ),
        'entity', JSON_OBJECT(
            'type_label', 'Tarifa',
            'type_label_plural', 'Tarifas',
            'icon', 'Smartphone',
            'fields', JSON_ARRAY(
                JSON_OBJECT('key', 'plan_name', 'label', 'Nombre de la tarifa', 'type', 'text'),
                JSON_OBJECT('key', 'plan_type', 'label', 'Tipo (fibra/móvil/convergente)', 'type', 'text'),
                JSON_OBJECT('key', 'plan_price', 'label', 'Precio mensual (EUR)', 'type', 'number'),
                JSON_OBJECT('key', 'plan_details', 'label', 'Detalles de la tarifa', 'type', 'json')
            )
        ),
        'ai', JSON_OBJECT(
            'company_description', 'Tree Mobile Group S.L. (marca comercial MasTree) - operador de telecomunicaciones en España. Ofrece servicios de fibra, telefonía móvil y paquetes convergentes (fibra + líneas móviles) para particulares y empresas, incluyendo terminales financiados a plazos.',
            'sender_name', 'Alfons Marques',
            'industry_context', 'telecomunicaciones, operador móvil virtual (OMV), fibra, telefonía móvil, paquetes convergentes',
            'contact_email', 'alfons.marques@treemg.com',
            'contact_phone', '902 92 92 36',
            'perplexity_system', 'You are a research assistant specializing in the Spanish telecommunications market (fibre, mobile, convergent packages) for both consumer and SMB segments. Provide concise, factual information about companies and their connectivity and mobile-fleet needs.',
            'email_style', 'Tono profesional y cercano, sin lenguaje comercial agresivo ni exclamaciones. Firma: Alfons Marques / MasTree.',
            'key_differentiators', 'Paquetes convergentes fibra + líneas móviles a precio competitivo. Terminales financiados a plazos. Atención en castellano.',
            'default_language', 'spanish'
        ),
        'legal', JSON_OBJECT(
            'legal_name', 'Tree Mobile Group S.L.',
            'cif', 'B98416480',
            'address', 'C/ Josep Saltó 21-23, Local 2, 08191 Rubí (Barcelona)',
            'privacy_url', '',
            'data_source', ''
        ),
        'branding', JSON_OBJECT(
            'app_name', 'Prospecting TreeMG',
            'tagline', 'MasTree - Account-Based Marketing',
            'footer_html', '<p>Tree Mobile Group S.L. (CIF B98416480) · C/ Josep Saltó 21-23, Local 2, 08191 Rubí (Barcelona) · Tel. 902 92 92 36<br>Puede ejercer sus derechos de acceso, rectificación, cancelación y oposición escribiendo a alfons.marques@treemg.com</p>'
        ),
        'warmup', JSON_OBJECT(
            'daily_limit_base', 20,
            'daily_limit_max', 50,
            'ramp_up_days', 30
        )
    )
);

-- ============================================
-- 2. ADMIN USER FOR TREEMG
-- ============================================
-- Platform login (NOT the mailbox password). Password: Tecnocim2026!
-- (same password Alfons uses for the other tenants' platform login).
-- NOTE: the mailbox password arrived in cleartext by email and is separate;
-- it should be rotated.

INSERT INTO users (id, tenant_id, email, password, first_name, last_name, role)
VALUES (
    UUID(),
    'tenant-treemg-0004',
    'alfons.marques@treemg.com',
    '$2a$10$W3JZmtpvzvRdmZcDymJcfurbWciaWSqemHXoDyGSfmUU3ZCn525Zu',
    'Alfons',
    'Marques',
    'admin'
);

-- ============================================
-- 3. DEFAULT SCORING RULES FOR TREEMG
-- ============================================
-- Adapted for SMB telecom (fibre + mobile-fleet decision makers)

INSERT INTO scoring_rules (id, tenant_id, name, category, field_name, operator, field_value, points) VALUES
-- Demographic: decision-makers for connectivity / mobile fleet
(UUID(), 'tenant-treemg-0004', 'Gerente / Administrador', 'demographic', 'title', 'contains', '"Gerente"', 30),
(UUID(), 'tenant-treemg-0004', 'Administrador', 'demographic', 'title', 'contains', '"Administrador"', 30),
(UUID(), 'tenant-treemg-0004', 'Director IT / Sistemas', 'demographic', 'title', 'contains', '"Sistemas"', 25),
(UUID(), 'tenant-treemg-0004', 'Responsable Compras', 'demographic', 'title', 'contains', '"Compras"', 20),
(UUID(), 'tenant-treemg-0004', 'CEO / Director General', 'demographic', 'seniority', 'equals', '"C-Level"', 25),

-- Firmographic: SMBs are the sweet spot for convergent packages
(UUID(), 'tenant-treemg-0004', 'Pequena empresa (5-50 empleados)', 'firmographic', 'employee_count', 'greater_than', '"5"', 20),
(UUID(), 'tenant-treemg-0004', 'Empresa mediana (+50 empleados)', 'firmographic', 'employee_count', 'greater_than', '"50"', 15),
(UUID(), 'tenant-treemg-0004', 'Sector Servicios', 'firmographic', 'industry', 'contains', '"Servicios"', 10),
(UUID(), 'tenant-treemg-0004', 'Sector Comercio', 'firmographic', 'industry', 'contains', '"Comercio"', 10),

-- Engagement: email interactions
(UUID(), 'tenant-treemg-0004', 'Email abierto', 'engagement', 'email_opened', 'equals', 'true', 5),
(UUID(), 'tenant-treemg-0004', 'Link clicado', 'engagement', 'email_clicked', 'equals', 'true', 15),
(UUID(), 'tenant-treemg-0004', 'Email respondido', 'engagement', 'email_replied', 'equals', 'true', 30),
(UUID(), 'tenant-treemg-0004', 'Respuesta negativa', 'engagement', 'negative_reply', 'equals', 'true', -50);

-- ============================================
-- 4. IMAP SYNC STATE FOR TREEMG
-- ============================================

INSERT IGNORE INTO imap_sync_state (id, tenant_id, mailbox, last_uid)
VALUES (UUID(), 'tenant-treemg-0004', 'INBOX', 0);

-- ============================================
-- ROLLBACK
-- ============================================
-- ROLLBACK: DELETE FROM imap_sync_state WHERE tenant_id = 'tenant-treemg-0004';
-- ROLLBACK: DELETE FROM scoring_rules   WHERE tenant_id = 'tenant-treemg-0004';
-- ROLLBACK: DELETE FROM users           WHERE tenant_id = 'tenant-treemg-0004';
-- ROLLBACK: DELETE FROM tenants         WHERE id = 'tenant-treemg-0004';
