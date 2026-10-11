-- ============================================
-- Migration 024: Tenant New Brokers
-- ============================================
-- Adds New Brokers Correduría de Seguros S.L. (domain newbrokers.es) as a new
-- tenant. Independent insurance brokerage in Barcelona, DGSFP key J0140,
-- positioned towards large accounts / corporate insurance (D&O, cyber, RC,
-- surety, tailored programmes) — NOT personal lines.
--
-- SCOPE: account + email configuration ONLY (same as TreeMG, migration-018).
-- No prospects, no campaign. Before the first send these must be cleared:
--   * DMARC on newbrokers.es is p=none with no rua (DNS is held by SCRINF /
--     Electro BCN, not by us).
--   * The New Brokers privacy policy only covers consent (contact form); the
--     footer below invokes legitimate interest (Art. 6.1.f RGPD). It needs
--     updating + an LSSI Art. 21 review first.
--   * César must confirm he signs, and provide the exclusion list (current
--     clients and insurers live only with him: the repo is not the CRM).
--
-- SENDING: from the apex newbrokers.es (owner's decision, 2026-10-11). The
-- domain is already verified in New Brokers' own Resend account, which also
-- sends the website form and the client portal, so reputation is SHARED.
-- Use a dedicated API key for the ABM; resend_api_key stays empty here and is
-- loaded later (encrypted if SECRETS_ENCRYPTION_KEY is set) via
-- PUT /api/settings/email. While empty, sendEmail() falls back to the GLOBAL
-- Resend key (Tecnocim's account): do not activate any campaign before that.
--
-- REPLIES: César signs (from_email) but replies go to info@newbrokers.es,
-- the Electro BCN-hosted mailbox, because IMAP basic auth is off in M365 and
-- the poller could not read an M365 inbox. mail.newbrokers.es:993 serves a
-- cert whose SAN covers mail.newbrokers.es. If the poller logs a chain error,
-- the IMAP server is probably not sending its intermediate certificate.
-- The IMAP password is loaded later via PUT /api/settings/email.
--
-- Every statement is idempotent on its own: the runner has no transaction
-- and marks the file applied on ER_DUP_ENTRY.
-- ============================================

-- ============================================
-- 1. INSERT TENANT
-- ============================================

-- Config notes:
--   * entity.fields carry both key and name: the interface declares key, the
--     client reads name (Campaigns.tsx).
--   * legal.data_source is shown verbatim to recipients when set: only fill
--     it with a true, recipient-ready source.
--   * branding.footer_html: the identity line (legal name | CIF | address) and
--     the rights text are added by getEmailFooter(); this only carries what
--     that line does not.
--   * scheduling.holidays: Catalonia + Barcelona city (national ones are built
--     in): Easter Monday, Whit Monday, Sant Joan, Diada, La Mercè, Sant Esteve.

INSERT IGNORE INTO tenants (id, name, slug, domain, logo_url, primary_color, secondary_color, config)
VALUES (
    'tenant-newbrokers-0005',
    'New Brokers',
    'newbrokers',
    'newbrokers.es',
    'https://www.newbrokers.es/brand/logo.png',
    '#0f1e3d',
    '#e8a04b',
    JSON_OBJECT(
        'email', JSON_OBJECT(
            'resend_api_key', '',
            'from_email', 'cesarperejoan@newbrokers.es',
            'from_name', 'César Perejoan · New Brokers',
            'reply_to', 'info@newbrokers.es',
            'notification_email', 'info@newbrokers.es'
        ),
        'imap', JSON_OBJECT(
            'host', 'mail.newbrokers.es',
            'port', 993,
            'user', 'info@newbrokers.es',
            'pass', ''
        ),
        'entity', JSON_OBJECT(
            'type_label', 'Programa de seguros',
            'type_label_plural', 'Programas de seguros',
            'icon', 'Shield',
            'fields', JSON_ARRAY(
                JSON_OBJECT('key', 'coverage_area', 'name', 'coverage_area', 'label', 'Área de cobertura', 'type', 'text'),
                JSON_OBJECT('key', 'target_sector', 'name', 'target_sector', 'label', 'Sector objetivo', 'type', 'text'),
                JSON_OBJECT('key', 'risk_focus', 'name', 'risk_focus', 'label', 'Riesgo o exposición que aborda', 'type', 'text'),
                JSON_OBJECT('key', 'program_notes', 'name', 'program_notes', 'label', 'Notas del programa', 'type', 'json')
            )
        ),
        'ai', JSON_OBJECT(
            'company_description', 'New Brokers Correduría de Seguros S.L. — correduría de seguros independiente con sede en Barcelona, inscrita en el Registro de Mediadores de la DGSFP (clave J0140). Trabaja para empresas medianas y grandes cuentas: diseña, coloca y defiende su programa de seguros bajo mandato del cliente, con acceso a todo el mercado asegurador, incluido el mercado de Londres.',
            'sender_name', 'César Perejoan',
            'industry_context', 'correduría de seguros corporativos para empresas: D&O (responsabilidad de directivos), RC profesional, ciberriesgos, daños materiales, responsabilidad civil general, transporte de mercancías, crédito y caución, responsabilidad medioambiental, construcción y decenal, flotas, programas internacionales y beneficios para empleados',
            'contact_email', 'info@newbrokers.es',
            'contact_phone', '+34 932 419 401',
            'perplexity_system', 'You are a research assistant specialising in corporate risk and commercial insurance in Spain. For a given company, report concisely and factually: sector, size, international footprint, regulatory exposure, recent corporate events (financing, M&A, public tenders, expansion) and the risk exposures they create (directors liability, cyber, product/professional liability, surety requirements, transport, environmental). Never speculate about which insurer the company uses.',
            'email_style', 'Registro de usted, técnico, sobrio y discreto, propio de una correduría corporativa. Hablar de riesgo, exposición, programa de seguros y mandato; nunca de tranquilidad, precio barato ni del mejor. No nombrar aseguradoras concretas. No citar clientes ni casos reales. No dar cifras ni datos normativos sin fuente. Sin exclamaciones ni lenguaje comercial agresivo. Correos breves. Firma: César Perejoan / New Brokers.',
            'key_differentiators', 'Correduría independiente: asesoramiento objetivo por ley y trabajo bajo mandato del cliente, no de la aseguradora. Un único interlocutor para todo el programa de seguros de la empresa. Acceso a todo el mercado, incluido Londres. Acompañamiento y defensa del cliente en el siniestro.',
            'default_language', 'spanish'
        ),
        'legal', JSON_OBJECT(
            'legal_name', 'New Brokers Correduría de Seguros S.L.',
            'cif', 'B58280868',
            'address', 'Carrer d''Ivorra 19, 08034 Barcelona',
            'privacy_url', 'https://www.newbrokers.es/es/privacidad/',
            'data_source', ''
        ),
        'branding', JSON_OBJECT(
            'app_name', 'Prospecting New Brokers',
            'tagline', 'New Brokers - Account-Based Marketing',
            'footer_html', '<p>Correduría de seguros inscrita en el Registro de Mediadores de la DGSFP, clave J0140 · www.newbrokers.es · Tel. +34 932 419 401</p>'
        ),
        'warmup', JSON_OBJECT(
            'daily_limit_base', 20,
            'daily_limit_max', 50,
            'ramp_up_days', 30
        ),
        'alerts', JSON_OBJECT(
            'recipient_email', 'amarquescancio@gmail.com',
            'bounce_pct_threshold', 2,
            'complaint_pct_threshold', 0.1,
            'min_sample', 30,
            'window_hours', 48
        ),
        'scheduling', JSON_OBJECT(
            'holidays', JSON_ARRAY(
                '2026-04-06', '2026-05-25', '2026-06-24', '2026-09-11', '2026-09-24', '2026-12-26',
                '2027-03-29', '2027-05-17', '2027-06-24', '2027-09-11', '2027-09-24', '2027-12-26'
            )
        )
    )
);

-- ============================================
-- 2. ADMIN USER FOR NEW BROKERS
-- ============================================
-- Login: info@newbrokers.es (unique across tenants, so the MCP OAuth login
-- does not hit the multi-tenant 409). bcrypt cost 10. The password is handed
-- over out of band and is NOT recorded here.

INSERT IGNORE INTO users (id, tenant_id, email, password, first_name, last_name, role)
VALUES (
    UUID(),
    'tenant-newbrokers-0005',
    'info@newbrokers.es',
    '$2a$10$Z/lIxwj4ytgB1gt6n2d9a.Trv2aYslyYLgsSQociTm73eu8QDGr0W',
    'New Brokers',
    'Admin',
    'admin'
);

-- ============================================
-- 3. DEFAULT SCORING RULES FOR NEW BROKERS
-- ============================================
-- Corporate insurance buyer: finance / risk / legal decision makers in
-- mid-size and large companies of the 8 published sectors.
-- 'contains' is a case-insensitive substring match, so stems are used.
-- It does NOT fold accents, and stored data comes accented, unaccented or in
-- English: accented stems get an unaccented twin (they never co-fire on the
-- same string). 'prevenci' cancels 'riesgo' for workplace-safety (PRL) staff,
-- very common in the construction/industrial sectors targeted here.
-- KNOWN LIMIT: greater_than uses Number(employee_count); enrichment stores
-- ranges like '51-200' (NaN), so the size rules only fire when the import
-- writes a plain number. Imports for this tenant must do that.
-- Guarded by NOT EXISTS: scoring_rules has no natural unique key.

INSERT INTO scoring_rules (id, tenant_id, name, category, field_name, operator, field_value, points)
SELECT UUID(), 'tenant-newbrokers-0005', r.name, r.category, r.field_name, r.operator, r.field_value, r.points
FROM (
    -- Demographic
    SELECT 'Dirección financiera' AS name, 'demographic' AS category, 'title' AS field_name, 'contains' AS operator, '"financ"' AS field_value, 25 AS points
    UNION ALL SELECT 'CFO', 'demographic', 'title', 'contains', '"CFO"', 25
    UNION ALL SELECT 'Gerencia de riesgos', 'demographic', 'title', 'contains', '"riesgo"', 30
    UNION ALL SELECT 'Risk manager (EN)', 'demographic', 'title', 'contains', '"risk"', 30
    UNION ALL SELECT 'Prevención de riesgos laborales (no es comprador)', 'demographic', 'title', 'contains', '"prevenci"', -30
    UNION ALL SELECT 'Dirección jurídica', 'demographic', 'title', 'contains', '"jurídic"', 20
    UNION ALL SELECT 'Dirección jurídica (sin tilde)', 'demographic', 'title', 'contains', '"juridic"', 20
    UNION ALL SELECT 'Legal / General Counsel', 'demographic', 'title', 'contains', '"legal"', 20
    UNION ALL SELECT 'CEO / Director General', 'demographic', 'seniority', 'equals', '"C-Level"', 25
    -- Firmographic: size first (large accounts), then published sectors
    UNION ALL SELECT 'Gran empresa (+250 empleados)', 'firmographic', 'employee_count', 'greater_than', '"250"', 20
    UNION ALL SELECT 'Empresa mediana (+50 empleados)', 'firmographic', 'employee_count', 'greater_than', '"50"', 15
    UNION ALL SELECT 'Sector construcción', 'firmographic', 'industry', 'contains', '"construc"', 10
    UNION ALL SELECT 'Sector logística', 'firmographic', 'industry', 'contains', '"logíst"', 10
    UNION ALL SELECT 'Sector logística (sin tilde / EN)', 'firmographic', 'industry', 'contains', '"logist"', 10
    UNION ALL SELECT 'Sector transporte', 'firmographic', 'industry', 'contains', '"transport"', 5
    UNION ALL SELECT 'Sector industrial', 'firmographic', 'industry', 'contains', '"industr"', 10
    UNION ALL SELECT 'Sector energía', 'firmographic', 'industry', 'contains', '"energ"', 10
    -- Engagement
    UNION ALL SELECT 'Email abierto', 'engagement', 'email_opened', 'equals', 'true', 5
    UNION ALL SELECT 'Link clicado', 'engagement', 'email_clicked', 'equals', 'true', 15
    UNION ALL SELECT 'Email respondido', 'engagement', 'email_replied', 'equals', 'true', 30
    UNION ALL SELECT 'Respuesta negativa', 'engagement', 'negative_reply', 'equals', 'true', -50
) AS r
WHERE NOT EXISTS (
    SELECT 1 FROM scoring_rules WHERE tenant_id = 'tenant-newbrokers-0005'
);

-- ============================================
-- 4. IMAP SYNC STATE FOR NEW BROKERS
-- ============================================

INSERT IGNORE INTO imap_sync_state (id, tenant_id, mailbox, last_uid)
VALUES (UUID(), 'tenant-newbrokers-0005', 'INBOX', 0);

-- ============================================
-- ROLLBACK
-- ============================================
-- ROLLBACK: DELETE FROM imap_sync_state WHERE tenant_id = 'tenant-newbrokers-0005';
-- ROLLBACK: DELETE FROM scoring_rules   WHERE tenant_id = 'tenant-newbrokers-0005';
-- ROLLBACK: DELETE FROM users           WHERE tenant_id = 'tenant-newbrokers-0005';
-- ROLLBACK: DELETE FROM tenants         WHERE id = 'tenant-newbrokers-0005';
