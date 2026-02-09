-- ============================================
-- CamiaCasa ABM - Seed Data (Realistic)
-- ============================================

USE camiacasa_abm;

-- Get the admin user ID
SET @admin_id = (SELECT id FROM users WHERE email = 'alfons.marques@camiacasa.cat' LIMIT 1);

-- ============================================
-- COMPANIES
-- ============================================

INSERT INTO companies (id, name, domain, industry, employee_count, annual_revenue, city, region, country, website_url, linkedin_url, description, tier, account_score, is_target) VALUES
(UUID(), 'Inmobiliaria Costa Brava SL', 'costabravainmo.com', 'Real Estate', '50-200', '5M-10M EUR', 'Girona', 'Catalunya', 'Spain', 'https://costabravainmo.com', 'https://linkedin.com/company/costabravainmo', 'Promotora inmobiliaria especializada en propiedades de lujo en la Costa Brava', 'A', 85, TRUE),
(UUID(), 'Grup Habitatge Barcelona', 'gruphabitatge.cat', 'Real Estate', '200-500', '25M-50M EUR', 'Barcelona', 'Catalunya', 'Spain', 'https://gruphabitatge.cat', 'https://linkedin.com/company/gruphabitatge', 'Grupo inmobiliario lider en promocion residencial en el area metropolitana de Barcelona', 'A', 92, TRUE),
(UUID(), 'Finques Emporda', 'finquesemporda.com', 'Real Estate', '10-50', '1M-5M EUR', 'Figueres', 'Catalunya', 'Spain', 'https://finquesemporda.com', NULL, 'Agencia inmobiliaria centrada en fincas rusticas y masias del Emporda', 'B', 68, TRUE),
(UUID(), 'Capital Mediterrani Inversions', 'capmed.es', 'Investment', '10-50', '50M-100M EUR', 'Barcelona', 'Catalunya', 'Spain', 'https://capmed.es', 'https://linkedin.com/company/capmed', 'Fondo de inversion especializado en activos inmobiliarios del Mediterraneo occidental', 'A', 95, TRUE),
(UUID(), 'Constructora Pirineus SA', 'constructorapirineus.com', 'Construction', '100-200', '10M-25M EUR', 'Lleida', 'Catalunya', 'Spain', 'https://constructorapirineus.com', NULL, 'Constructora centrada en proyectos residenciales y hoteleros en los Pirineos', 'B', 72, TRUE),
(UUID(), 'Patrimoni Urba SL', 'patrimoniurba.cat', 'Real Estate', '20-50', '5M-10M EUR', 'Tarragona', 'Catalunya', 'Spain', 'https://patrimoniurba.cat', 'https://linkedin.com/company/patrimoniurba', 'Gestion y venta de patrimonio urbano en la provincia de Tarragona', 'B', 65, FALSE),
(UUID(), 'Reus Invest Group', 'reusinvest.com', 'Investment', '5-10', '10M-25M EUR', 'Reus', 'Catalunya', 'Spain', 'https://reusinvest.com', NULL, 'Grupo inversor enfocado en rehabilitacion de edificios historicos', 'C', 55, FALSE),
(UUID(), 'Maresme Premium Homes', 'maresmepremium.com', 'Real Estate', '10-20', '5M-10M EUR', 'Mataro', 'Catalunya', 'Spain', 'https://maresmepremium.com', 'https://linkedin.com/company/maresmepremium', 'Inmobiliaria premium especializada en la costa del Maresme', 'A', 88, TRUE),
(UUID(), 'Vallés Habitat Cooperativa', 'valleshab.coop', 'Real Estate', '20-50', '1M-5M EUR', 'Sabadell', 'Catalunya', 'Spain', 'https://valleshab.coop', NULL, 'Cooperativa de vivienda que promueve proyectos de housing asequible', 'C', 45, FALSE),
(UUID(), 'Delta Ebre Properties', 'deltaproperties.es', 'Real Estate', '5-10', '500K-1M EUR', 'Tortosa', 'Catalunya', 'Spain', 'https://deltaproperties.es', NULL, 'Agencia especializada en propiedades rurales y terrenos del Delta del Ebro', 'C', 40, FALSE),
(UUID(), 'BCN Luxury Living', 'bcnluxury.com', 'Real Estate', '10-20', '10M-25M EUR', 'Barcelona', 'Catalunya', 'Spain', 'https://bcnluxury.com', 'https://linkedin.com/company/bcnluxury', 'Propiedades de lujo y aticos exclusivos en Barcelona ciudad', 'A', 90, TRUE),
(UUID(), 'Garraf Costal Immobiliaria', 'garrafcoastal.com', 'Real Estate', '5-10', '1M-5M EUR', 'Sitges', 'Catalunya', 'Spain', 'https://garrafcoastal.com', NULL, 'Inmobiliaria de referencia en Sitges y la comarca del Garraf', 'B', 62, TRUE);

-- Store company IDs for reference
SET @comp1 = (SELECT id FROM companies WHERE domain = 'costabravainmo.com');
SET @comp2 = (SELECT id FROM companies WHERE domain = 'gruphabitatge.cat');
SET @comp3 = (SELECT id FROM companies WHERE domain = 'finquesemporda.com');
SET @comp4 = (SELECT id FROM companies WHERE domain = 'capmed.es');
SET @comp5 = (SELECT id FROM companies WHERE domain = 'constructorapirineus.com');
SET @comp6 = (SELECT id FROM companies WHERE domain = 'patrimoniurba.cat');
SET @comp7 = (SELECT id FROM companies WHERE domain = 'reusinvest.com');
SET @comp8 = (SELECT id FROM companies WHERE domain = 'maresmepremium.com');
SET @comp9 = (SELECT id FROM companies WHERE domain = 'valleshab.coop');
SET @comp10 = (SELECT id FROM companies WHERE domain = 'deltaproperties.es');
SET @comp11 = (SELECT id FROM companies WHERE domain = 'bcnluxury.com');
SET @comp12 = (SELECT id FROM companies WHERE domain = 'garrafcoastal.com');

-- ============================================
-- PROSPECTS
-- ============================================

INSERT INTO prospects (id, company_id, email, first_name, last_name, title, seniority, department, phone, linkedin_url, city, region, country, status, lead_score, source, source_detail, last_contacted, last_replied) VALUES
(UUID(), @comp2, 'jordi.puig@gruphabitatge.cat', 'Jordi', 'Puig', 'Director General', 'C-Level', 'Executive', '+34 93 412 5500', 'https://linkedin.com/in/jordipuig', 'Barcelona', 'Catalunya', 'Spain', 'interested', 92, 'linkedin', 'LinkedIn Sales Navigator', DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)),
(UUID(), @comp4, 'marta.serra@capmed.es', 'Marta', 'Serra', 'Managing Partner', 'C-Level', 'Investment', '+34 93 301 2200', 'https://linkedin.com/in/martaserra', 'Barcelona', 'Catalunya', 'Spain', 'meeting', 95, 'referral', 'Referencia de Joan Vidal', DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)),
(UUID(), @comp1, 'pere.vila@costabravainmo.com', 'Pere', 'Vila', 'Director Comercial', 'Director', 'Sales', '+34 972 204 300', 'https://linkedin.com/in/perevila', 'Girona', 'Catalunya', 'Spain', 'contacted', 78, 'linkedin', 'LinkedIn outreach', DATE_SUB(NOW(), INTERVAL 3 DAY), NULL),
(UUID(), @comp11, 'anna.fonts@bcnluxury.com', 'Anna', 'Fonts', 'CEO', 'C-Level', 'Executive', '+34 93 487 9900', 'https://linkedin.com/in/annafonts', 'Barcelona', 'Catalunya', 'Spain', 'replied', 88, 'event', 'Barcelona Meeting Point 2025', DATE_SUB(NOW(), INTERVAL 5 DAY), DATE_SUB(NOW(), INTERVAL 4 DAY)),
(UUID(), @comp8, 'marc.olivé@maresmepremium.com', 'Marc', 'Olive', 'Director de Expansión', 'Director', 'Business Development', '+34 93 790 1100', NULL, 'Mataro', 'Catalunya', 'Spain', 'qualified', 82, 'web', 'Formulario web', DATE_SUB(NOW(), INTERVAL 7 DAY), NULL),
(UUID(), @comp5, 'nuria.roig@constructorapirineus.com', 'Nuria', 'Roig', 'Directora Financiera', 'Director', 'Finance', '+34 973 245 600', 'https://linkedin.com/in/nuriaroig', 'Lleida', 'Catalunya', 'Spain', 'contacted', 72, 'linkedin', 'LinkedIn Sales Navigator', DATE_SUB(NOW(), INTERVAL 4 DAY), NULL),
(UUID(), @comp3, 'xavier.mas@finquesemporda.com', 'Xavier', 'Mas', 'Gerente', 'C-Level', 'Executive', '+34 972 510 233', NULL, 'Figueres', 'Catalunya', 'Spain', 'interested', 68, 'cold_email', 'Campanya masies Emporda', DATE_SUB(NOW(), INTERVAL 10 DAY), DATE_SUB(NOW(), INTERVAL 8 DAY)),
(UUID(), @comp4, 'roberto.diaz@capmed.es', 'Roberto', 'Diaz', 'Investment Analyst', 'Manager', 'Investment', '+34 93 301 2205', 'https://linkedin.com/in/robertodiaz', 'Barcelona', 'Catalunya', 'Spain', 'enriched', 60, 'linkedin', 'LinkedIn', NULL, NULL),
(UUID(), @comp2, 'laura.grau@gruphabitatge.cat', 'Laura', 'Grau', 'Responsable de Marketing', 'Manager', 'Marketing', '+34 93 412 5510', 'https://linkedin.com/in/lauragrau', 'Barcelona', 'Catalunya', 'Spain', 'contacted', 55, 'linkedin', 'LinkedIn', DATE_SUB(NOW(), INTERVAL 6 DAY), NULL),
(UUID(), @comp6, 'francesc.torras@patrimoniurba.cat', 'Francesc', 'Torras', 'Director Comercial', 'Director', 'Sales', '+34 977 232 100', NULL, 'Tarragona', 'Catalunya', 'Spain', 'new', 50, 'import', 'CSV import SIMA 2025', NULL, NULL),
(UUID(), @comp12, 'silvia.costa@garrafcoastal.com', 'Silvia', 'Costa', 'Directora de Operaciones', 'Director', 'Operations', '+34 93 894 1200', 'https://linkedin.com/in/silviacosta', 'Sitges', 'Catalunya', 'Spain', 'contacted', 65, 'event', 'Barcelona Meeting Point 2025', DATE_SUB(NOW(), INTERVAL 12 DAY), NULL),
(UUID(), @comp7, 'albert.bosch@reusinvest.com', 'Albert', 'Bosch', 'Fundador', 'C-Level', 'Executive', '+34 977 310 500', NULL, 'Reus', 'Catalunya', 'Spain', 'new', 55, 'web', 'Formulario contacto web', NULL, NULL),
(UUID(), @comp1, 'montserrat.pla@costabravainmo.com', 'Montserrat', 'Pla', 'Directora de Proyectos', 'Director', 'Project Management', '+34 972 204 305', 'https://linkedin.com/in/montserratpla', 'Girona', 'Catalunya', 'Spain', 'qualified', 75, 'referral', 'Referencia Pere Vila', NULL, NULL),
(UUID(), @comp9, 'joan.ferrer@valleshab.coop', 'Joan', 'Ferrer', 'Presidente', 'C-Level', 'Executive', '+34 93 745 2200', NULL, 'Sabadell', 'Catalunya', 'Spain', 'enriched', 45, 'import', 'CSV import cooperatives', NULL, NULL),
(UUID(), @comp10, 'rosa.segura@deltaproperties.es', 'Rosa', 'Segura', 'Agente Principal', 'Manager', 'Sales', '+34 977 444 200', NULL, 'Tortosa', 'Catalunya', 'Spain', 'new', 35, 'import', 'CSV import Terres Ebre', NULL, NULL),
(UUID(), @comp11, 'david.martinez@bcnluxury.com', 'David', 'Martinez', 'Director de Ventas Internacionales', 'Director', 'Sales', '+34 93 487 9905', 'https://linkedin.com/in/davidmartinez', 'Barcelona', 'Catalunya', 'Spain', 'replied', 85, 'linkedin', 'LinkedIn', DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY)),
(UUID(), @comp8, 'elena.roca@maresmepremium.com', 'Elena', 'Roca', 'Responsable Legal', 'Manager', 'Legal', '+34 93 790 1105', NULL, 'Mataro', 'Catalunya', 'Spain', 'new', 40, 'web', 'Blog subscription', NULL, NULL),
(UUID(), @comp5, 'oriol.casas@constructorapirineus.com', 'Oriol', 'Casas', 'Director de Obra', 'Director', 'Construction', '+34 973 245 610', NULL, 'Lleida', 'Catalunya', 'Spain', 'enriched', 58, 'linkedin', 'LinkedIn', NULL, NULL),
(UUID(), NULL, 'carles.arnau@gmail.com', 'Carles', 'Arnau', 'Inversor Particular', 'Manager', 'Investment', '+34 609 123 456', NULL, 'Barcelona', 'Catalunya', 'Spain', 'qualified', 62, 'web', 'Landing page inversores', DATE_SUB(NOW(), INTERVAL 15 DAY), NULL),
(UUID(), @comp2, 'mireia.solé@gruphabitatge.cat', 'Mireia', 'Sole', 'Arquitecta Jefe', 'Director', 'Architecture', '+34 93 412 5520', 'https://linkedin.com/in/mireiasole', 'Barcelona', 'Catalunya', 'Spain', 'contacted', 70, 'event', 'Construmat 2025', DATE_SUB(NOW(), INTERVAL 8 DAY), NULL);

-- Store some prospect IDs
SET @pros1 = (SELECT id FROM prospects WHERE email = 'jordi.puig@gruphabitatge.cat');
SET @pros2 = (SELECT id FROM prospects WHERE email = 'marta.serra@capmed.es');
SET @pros3 = (SELECT id FROM prospects WHERE email = 'pere.vila@costabravainmo.com');
SET @pros4 = (SELECT id FROM prospects WHERE email = 'anna.fonts@bcnluxury.com');
SET @pros5 = (SELECT id FROM prospects WHERE email = 'marc.olivé@maresmepremium.com');
SET @pros6 = (SELECT id FROM prospects WHERE email = 'nuria.roig@constructorapirineus.com');
SET @pros7 = (SELECT id FROM prospects WHERE email = 'xavier.mas@finquesemporda.com');
SET @pros8 = (SELECT id FROM prospects WHERE email = 'david.martinez@bcnluxury.com');
SET @pros9 = (SELECT id FROM prospects WHERE email = 'silvia.costa@garrafcoastal.com');
SET @pros10 = (SELECT id FROM prospects WHERE email = 'montserrat.pla@costabravainmo.com');

-- ============================================
-- CAMPAIGNS
-- ============================================

INSERT INTO campaigns (id, name, description, asset_type, asset_location, asset_price, campaign_type, status, start_date, end_date, created_by) VALUES
(UUID(), 'Atic Eixample Dret 450m2', 'Campanya per vendre atic de luxe a lEixample Dret de Barcelona. 450m2 amb terrassa panoramica.', 'Residential', 'Barcelona - Eixample Dret', 2850000.00, 'outbound', 'active', '2025-12-01', '2026-03-31', @admin_id),
(UUID(), 'Masia Emporda 12Ha', 'Promocio de masia restaurada amb 12 hectarees de terreny al Baix Emporda.', 'Rural Estate', 'Baix Emporda', 1950000.00, 'outbound', 'active', '2026-01-15', '2026-04-30', @admin_id),
(UUID(), 'Nau Industrial Zona Franca', 'Venda de nau industrial de 2500m2 a la Zona Franca de Barcelona.', 'Industrial', 'Barcelona - Zona Franca', 3200000.00, 'outbound', 'active', '2026-01-01', '2026-06-30', @admin_id),
(UUID(), 'Promocio Residencial Sitges', 'Nova promocio de 24 habitatges amb piscina comunitaria i vistes al mar a Sitges.', 'New Development', 'Sitges', 8500000.00, 'outbound', 'draft', '2026-03-01', '2026-12-31', @admin_id),
(UUID(), 'Reactivacio Leads Q4 2025', 'Campanya de reactivacio de leads freds del Q4 2025 que no van respondre.', NULL, NULL, NULL, 'reactivation', 'active', '2026-02-01', '2026-02-28', @admin_id),
(UUID(), 'Newsletter Inversors Febrer', 'Newsletter mensual per a inversors amb les noves oportunitats del mercat.', NULL, NULL, NULL, 'nurture', 'completed', '2026-02-01', '2026-02-07', @admin_id);

-- Store campaign IDs
SET @camp1 = (SELECT id FROM campaigns WHERE name = 'Atic Eixample Dret 450m2');
SET @camp2 = (SELECT id FROM campaigns WHERE name = 'Masia Emporda 12Ha');
SET @camp3 = (SELECT id FROM campaigns WHERE name = 'Nau Industrial Zona Franca');
SET @camp4 = (SELECT id FROM campaigns WHERE name = 'Promocio Residencial Sitges');
SET @camp5 = (SELECT id FROM campaigns WHERE name = 'Reactivacio Leads Q4 2025');
SET @camp6 = (SELECT id FROM campaigns WHERE name = 'Newsletter Inversors Febrer');

-- ============================================
-- CAMPAIGN PROSPECTS
-- ============================================

INSERT INTO campaign_prospects (id, campaign_id, prospect_id, status) VALUES
(UUID(), @camp1, @pros1, 'active'),
(UUID(), @camp1, @pros2, 'active'),
(UUID(), @camp1, @pros4, 'active'),
(UUID(), @camp1, @pros8, 'active'),
(UUID(), @camp1, @pros5, 'active'),
(UUID(), @camp2, @pros7, 'active'),
(UUID(), @camp2, @pros3, 'active'),
(UUID(), @camp2, @pros10, 'active'),
(UUID(), @camp3, @pros2, 'active'),
(UUID(), @camp3, @pros1, 'active'),
(UUID(), @camp5, @pros6, 'active'),
(UUID(), @camp5, @pros9, 'active'),
(UUID(), @camp6, @pros1, 'completed'),
(UUID(), @camp6, @pros2, 'completed'),
(UUID(), @camp6, @pros4, 'completed'),
(UUID(), @camp6, @pros8, 'completed');

-- ============================================
-- EMAIL SEQUENCES
-- ============================================

INSERT INTO email_sequences (id, campaign_id, name, description, status, from_name, from_email, reply_to, created_by) VALUES
(UUID(), @camp1, 'Atic Eixample - Sequencia Principal', 'Sequencia de 3 emails per latic de lEixample', 'active', 'Alfons Marques', 'alfons.marques@camiacasa.cat', 'alfons.marques@camiacasa.cat', @admin_id),
(UUID(), @camp2, 'Masia Emporda - Primer Contacte', 'Sequencia introductoria per la masia de lEmporda', 'active', 'Alfons Marques', 'alfons.marques@camiacasa.cat', 'alfons.marques@camiacasa.cat', @admin_id),
(UUID(), @camp3, 'Nau Zona Franca - Inversors', 'Sequencia dirigida a inversors industrials', 'active', 'Alfons Marques', 'alfons.marques@camiacasa.cat', 'alfons.marques@camiacasa.cat', @admin_id),
(UUID(), @camp5, 'Reactivacio Q4 - Follow Up', 'Sequencia de reactivacio amb nou valor', 'draft', 'Alfons Marques', 'alfons.marques@camiacasa.cat', 'alfons.marques@camiacasa.cat', @admin_id);

-- Store sequence IDs
SET @seq1 = (SELECT id FROM email_sequences WHERE name = 'Atic Eixample - Sequencia Principal');
SET @seq2 = (SELECT id FROM email_sequences WHERE name = 'Masia Emporda - Primer Contacte');
SET @seq3 = (SELECT id FROM email_sequences WHERE name = 'Nau Zona Franca - Inversors');

-- ============================================
-- SEQUENCE STEPS
-- ============================================

INSERT INTO sequence_steps (id, sequence_id, step_number, step_type, subject, body_html, delay_days) VALUES
(UUID(), @seq1, 1, 'email', 'Oportunitat unica: Atic de 450m2 a lEixample Dret', '<p>Hola {{first_name}},</p><p>Tescric perque tenim una propietat excepcional que crec que pot ser del teu interes...</p>', 0),
(UUID(), @seq1, 2, 'email', 'Re: Atic Eixample - Fotos exclusives', '<p>Hola {{first_name}},</p><p>Volia compartir amb tu les fotos exclusives de latic...</p>', 3),
(UUID(), @seq1, 3, 'email', 'Ultima oportunitat - Visita privada atic Eixample', '<p>Hola {{first_name}},</p><p>Tenim programades visites privades aquesta setmana...</p>', 5),
(UUID(), @seq2, 1, 'email', 'Masia restaurada al cor de lEmporda - 12 hectarees', '<p>Hola {{first_name}},</p><p>Tinc el plaer de presentar-te una masia unica...</p>', 0),
(UUID(), @seq2, 2, 'email', 'Re: Masia Emporda - Detalls i visita', '<p>Hola {{first_name}},</p><p>Hem rebut molt interes per la masia...</p>', 4),
(UUID(), @seq3, 1, 'email', 'Nau industrial 2500m2 Zona Franca - Inversio estrategica', '<p>Hola {{first_name}},</p><p>La Zona Franca de Barcelona ofereix una oportunitat unica...</p>', 0);

-- Store step IDs
SET @step1_1 = (SELECT id FROM sequence_steps WHERE sequence_id = @seq1 AND step_number = 1);
SET @step1_2 = (SELECT id FROM sequence_steps WHERE sequence_id = @seq1 AND step_number = 2);
SET @step1_3 = (SELECT id FROM sequence_steps WHERE sequence_id = @seq1 AND step_number = 3);
SET @step2_1 = (SELECT id FROM sequence_steps WHERE sequence_id = @seq2 AND step_number = 1);
SET @step2_2 = (SELECT id FROM sequence_steps WHERE sequence_id = @seq2 AND step_number = 2);
SET @step3_1 = (SELECT id FROM sequence_steps WHERE sequence_id = @seq3 AND step_number = 1);

-- ============================================
-- SEQUENCE ENROLLMENTS
-- ============================================

INSERT INTO sequence_enrollments (id, sequence_id, prospect_id, current_step, status, enrolled_at, next_send_at) VALUES
(UUID(), @seq1, @pros1, 3, 'completed', DATE_SUB(NOW(), INTERVAL 15 DAY), NULL),
(UUID(), @seq1, @pros2, 2, 'replied', DATE_SUB(NOW(), INTERVAL 12 DAY), NULL),
(UUID(), @seq1, @pros4, 3, 'completed', DATE_SUB(NOW(), INTERVAL 10 DAY), NULL),
(UUID(), @seq1, @pros8, 2, 'replied', DATE_SUB(NOW(), INTERVAL 8 DAY), NULL),
(UUID(), @seq1, @pros5, 1, 'active', DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_ADD(NOW(), INTERVAL 1 DAY)),
(UUID(), @seq2, @pros7, 2, 'replied', DATE_SUB(NOW(), INTERVAL 14 DAY), NULL),
(UUID(), @seq2, @pros3, 1, 'active', DATE_SUB(NOW(), INTERVAL 5 DAY), DATE_ADD(NOW(), INTERVAL 2 DAY)),
(UUID(), @seq2, @pros10, 1, 'active', DATE_SUB(NOW(), INTERVAL 4 DAY), DATE_ADD(NOW(), INTERVAL 3 DAY)),
(UUID(), @seq3, @pros2, 1, 'active', DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_ADD(NOW(), INTERVAL 1 DAY)),
(UUID(), @seq3, @pros1, 1, 'active', DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_ADD(NOW(), INTERVAL 1 DAY));

-- Store enrollment IDs
SET @enr1 = (SELECT id FROM sequence_enrollments WHERE sequence_id = @seq1 AND prospect_id = @pros1);
SET @enr2 = (SELECT id FROM sequence_enrollments WHERE sequence_id = @seq1 AND prospect_id = @pros2);
SET @enr3 = (SELECT id FROM sequence_enrollments WHERE sequence_id = @seq1 AND prospect_id = @pros4);
SET @enr4 = (SELECT id FROM sequence_enrollments WHERE sequence_id = @seq1 AND prospect_id = @pros8);
SET @enr5 = (SELECT id FROM sequence_enrollments WHERE sequence_id = @seq2 AND prospect_id = @pros7);
SET @enr6 = (SELECT id FROM sequence_enrollments WHERE sequence_id = @seq2 AND prospect_id = @pros3);
SET @enr7 = (SELECT id FROM sequence_enrollments WHERE sequence_id = @seq3 AND prospect_id = @pros2);

-- ============================================
-- EMAIL EVENTS
-- ============================================

-- Campaign 1: Atic Eixample
INSERT INTO email_events (id, enrollment_id, prospect_id, sequence_id, step_id, event_type, subject, from_email, occurred_at) VALUES
-- Jordi Puig - 3 emails sent, 3 opened, 1 replied
(UUID(), @enr1, @pros1, @seq1, @step1_1, 'sent', 'Oportunitat unica: Atic de 450m2', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 15 DAY)),
(UUID(), @enr1, @pros1, @seq1, @step1_1, 'delivered', 'Oportunitat unica: Atic de 450m2', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 15 DAY)),
(UUID(), @enr1, @pros1, @seq1, @step1_1, 'opened', 'Oportunitat unica: Atic de 450m2', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 14 DAY)),
(UUID(), @enr1, @pros1, @seq1, @step1_2, 'sent', 'Re: Atic Eixample - Fotos exclusives', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 12 DAY)),
(UUID(), @enr1, @pros1, @seq1, @step1_2, 'delivered', 'Re: Atic Eixample - Fotos exclusives', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 12 DAY)),
(UUID(), @enr1, @pros1, @seq1, @step1_2, 'opened', 'Re: Atic Eixample - Fotos exclusives', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 11 DAY)),
(UUID(), @enr1, @pros1, @seq1, @step1_2, 'clicked', 'Re: Atic Eixample - Fotos exclusives', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 11 DAY)),
(UUID(), @enr1, @pros1, @seq1, @step1_3, 'sent', 'Ultima oportunitat - Visita privada', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 7 DAY)),
(UUID(), @enr1, @pros1, @seq1, @step1_3, 'delivered', 'Ultima oportunitat - Visita privada', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 7 DAY)),
(UUID(), @enr1, @pros1, @seq1, @step1_3, 'opened', 'Ultima oportunitat - Visita privada', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 6 DAY)),
(UUID(), @enr1, @pros1, @seq1, @step1_3, 'replied', 'Ultima oportunitat - Visita privada', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 5 DAY)),

-- Marta Serra - 2 emails sent, 2 opened, 1 replied
(UUID(), @enr2, @pros2, @seq1, @step1_1, 'sent', 'Oportunitat unica: Atic de 450m2', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 12 DAY)),
(UUID(), @enr2, @pros2, @seq1, @step1_1, 'delivered', 'Oportunitat unica: Atic de 450m2', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 12 DAY)),
(UUID(), @enr2, @pros2, @seq1, @step1_1, 'opened', 'Oportunitat unica: Atic de 450m2', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 11 DAY)),
(UUID(), @enr2, @pros2, @seq1, @step1_2, 'sent', 'Re: Atic Eixample - Fotos exclusives', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 9 DAY)),
(UUID(), @enr2, @pros2, @seq1, @step1_2, 'delivered', 'Re: Atic Eixample - Fotos exclusives', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 9 DAY)),
(UUID(), @enr2, @pros2, @seq1, @step1_2, 'opened', 'Re: Atic Eixample - Fotos exclusives', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 8 DAY)),
(UUID(), @enr2, @pros2, @seq1, @step1_2, 'replied', 'Re: Atic Eixample - Fotos exclusives', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 8 DAY)),

-- Anna Fonts - 3 emails sent, 2 opened, clicked, replied
(UUID(), @enr3, @pros4, @seq1, @step1_1, 'sent', 'Oportunitat unica: Atic de 450m2', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 10 DAY)),
(UUID(), @enr3, @pros4, @seq1, @step1_1, 'delivered', 'Oportunitat unica: Atic de 450m2', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 10 DAY)),
(UUID(), @enr3, @pros4, @seq1, @step1_1, 'opened', 'Oportunitat unica: Atic de 450m2', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 9 DAY)),
(UUID(), @enr3, @pros4, @seq1, @step1_2, 'sent', 'Re: Atic Eixample - Fotos exclusives', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 7 DAY)),
(UUID(), @enr3, @pros4, @seq1, @step1_2, 'delivered', 'Re: Atic Eixample - Fotos exclusives', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 7 DAY)),
(UUID(), @enr3, @pros4, @seq1, @step1_2, 'opened', 'Re: Atic Eixample - Fotos exclusives', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 6 DAY)),
(UUID(), @enr3, @pros4, @seq1, @step1_2, 'clicked', 'Re: Atic Eixample - Fotos exclusives', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 6 DAY)),
(UUID(), @enr3, @pros4, @seq1, @step1_3, 'sent', 'Ultima oportunitat - Visita privada', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 5 DAY)),
(UUID(), @enr3, @pros4, @seq1, @step1_3, 'delivered', 'Ultima oportunitat - Visita privada', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 5 DAY)),
(UUID(), @enr3, @pros4, @seq1, @step1_3, 'opened', 'Ultima oportunitat - Visita privada', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 4 DAY)),
(UUID(), @enr3, @pros4, @seq1, @step1_3, 'replied', 'Ultima oportunitat - Visita privada', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 4 DAY)),

-- David Martinez - 2 emails, 2 opened, 1 replied
(UUID(), @enr4, @pros8, @seq1, @step1_1, 'sent', 'Oportunitat unica: Atic de 450m2', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 8 DAY)),
(UUID(), @enr4, @pros8, @seq1, @step1_1, 'delivered', 'Oportunitat unica: Atic de 450m2', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 8 DAY)),
(UUID(), @enr4, @pros8, @seq1, @step1_1, 'opened', 'Oportunitat unica: Atic de 450m2', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 7 DAY)),
(UUID(), @enr4, @pros8, @seq1, @step1_2, 'sent', 'Re: Atic Eixample - Fotos exclusives', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 5 DAY)),
(UUID(), @enr4, @pros8, @seq1, @step1_2, 'delivered', 'Re: Atic Eixample - Fotos exclusives', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 5 DAY)),
(UUID(), @enr4, @pros8, @seq1, @step1_2, 'opened', 'Re: Atic Eixample - Fotos exclusives', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 4 DAY)),
(UUID(), @enr4, @pros8, @seq1, @step1_2, 'replied', 'Re: Atic Eixample - Fotos exclusives', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 3 DAY)),

-- Campaign 2: Masia Emporda
-- Xavier Mas - 2 emails, 1 opened, 1 replied
(UUID(), @enr5, @pros7, @seq2, @step2_1, 'sent', 'Masia restaurada al cor de lEmporda', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 14 DAY)),
(UUID(), @enr5, @pros7, @seq2, @step2_1, 'delivered', 'Masia restaurada al cor de lEmporda', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 14 DAY)),
(UUID(), @enr5, @pros7, @seq2, @step2_1, 'opened', 'Masia restaurada al cor de lEmporda', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 13 DAY)),
(UUID(), @enr5, @pros7, @seq2, @step2_2, 'sent', 'Re: Masia Emporda - Detalls', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 10 DAY)),
(UUID(), @enr5, @pros7, @seq2, @step2_2, 'delivered', 'Re: Masia Emporda - Detalls', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 10 DAY)),
(UUID(), @enr5, @pros7, @seq2, @step2_2, 'opened', 'Re: Masia Emporda - Detalls', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 9 DAY)),
(UUID(), @enr5, @pros7, @seq2, @step2_2, 'replied', 'Re: Masia Emporda - Detalls', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 8 DAY)),

-- Pere Vila - 1 email sent, opened
(UUID(), @enr6, @pros3, @seq2, @step2_1, 'sent', 'Masia restaurada al cor de lEmporda', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 5 DAY)),
(UUID(), @enr6, @pros3, @seq2, @step2_1, 'delivered', 'Masia restaurada al cor de lEmporda', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 5 DAY)),
(UUID(), @enr6, @pros3, @seq2, @step2_1, 'opened', 'Masia restaurada al cor de lEmporda', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 4 DAY)),

-- Campaign 3: Nau Zona Franca
-- Marta Serra - 1 email sent, opened
(UUID(), @enr7, @pros2, @seq3, @step3_1, 'sent', 'Nau industrial Zona Franca', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 2 DAY)),
(UUID(), @enr7, @pros2, @seq3, @step3_1, 'delivered', 'Nau industrial Zona Franca', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 2 DAY)),
(UUID(), @enr7, @pros2, @seq3, @step3_1, 'opened', 'Nau industrial Zona Franca', 'alfons.marques@camiacasa.cat', DATE_SUB(NOW(), INTERVAL 1 DAY));

-- ============================================
-- PROSPECT ACTIVITIES
-- ============================================

INSERT INTO prospect_activities (id, prospect_id, activity_type, title, description, performed_by, occurred_at) VALUES
(UUID(), @pros2, 'meeting_scheduled', 'Reunio programada', 'Reunio presencial per latic de lEixample Dret amb Marta Serra de Capital Mediterrani', @admin_id, DATE_SUB(NOW(), INTERVAL 1 DAY)),
(UUID(), @pros1, 'email_replied', 'Resposta rebuda', 'Jordi Puig ha respost interessat en visitar latic de lEixample', @admin_id, DATE_SUB(NOW(), INTERVAL 5 DAY)),
(UUID(), @pros4, 'email_replied', 'Resposta rebuda', 'Anna Fonts ha demanat mes informacio sobre latic i el finançament', @admin_id, DATE_SUB(NOW(), INTERVAL 4 DAY)),
(UUID(), @pros8, 'email_replied', 'Resposta rebuda', 'David Martinez vol organitzar una visita amb un client internacional', @admin_id, DATE_SUB(NOW(), INTERVAL 3 DAY)),
(UUID(), @pros7, 'email_replied', 'Resposta rebuda', 'Xavier Mas interesat en la masia de lEmporda per a hotel boutique', @admin_id, DATE_SUB(NOW(), INTERVAL 8 DAY)),
(UUID(), @pros3, 'email_sent', 'Email enviat', 'Primer email de la campanya Masia Emporda enviat a Pere Vila', @admin_id, DATE_SUB(NOW(), INTERVAL 5 DAY)),
(UUID(), @pros5, 'status_changed', 'Estat actualitzat', 'Marc Olive passat a Qualificat despres de la trucada de qualificacio', @admin_id, DATE_SUB(NOW(), INTERVAL 7 DAY)),
(UUID(), @pros1, 'note_added', 'Nota afegida', 'Jordi comenta que esta buscant inversions per sobre de 2M per al grup. Molt bon perfil.', @admin_id, DATE_SUB(NOW(), INTERVAL 2 DAY)),
(UUID(), @pros2, 'status_changed', 'Estat actualitzat', 'Marta Serra passa a Meeting despres de confirmar visita presencial', @admin_id, DATE_SUB(NOW(), INTERVAL 1 DAY)),
(UUID(), @pros6, 'email_sent', 'Email enviat', 'Email de reactivacio enviat a Nuria Roig de Constructora Pirineus', @admin_id, DATE_SUB(NOW(), INTERVAL 4 DAY)),
(UUID(), @pros9, 'email_sent', 'Email enviat', 'Email de reactivacio enviat a Silvia Costa de Garraf Coastal', @admin_id, DATE_SUB(NOW(), INTERVAL 4 DAY)),
(UUID(), @pros10, 'enrichment', 'Dades enriquides', 'Dades de Montserrat Pla enriquides automaticament via LinkedIn', NULL, DATE_SUB(NOW(), INTERVAL 3 DAY)),
(UUID(), @pros2, 'email_opened', 'Email obert', 'Marta Serra ha obert lemail de Nau Industrial Zona Franca', NULL, DATE_SUB(NOW(), INTERVAL 1 DAY)),
(UUID(), @pros1, 'score_updated', 'Puntuacio actualitzada', 'Lead score de Jordi Puig actualitzat de 78 a 92 (resposta + click)', NULL, DATE_SUB(NOW(), INTERVAL 5 DAY));

-- ============================================
-- TAGS
-- ============================================

INSERT INTO tags (id, name, color) VALUES
(UUID(), 'Inversor', '#4f46e5'),
(UUID(), 'Promotor', '#0891b2'),
(UUID(), 'Direccio', '#7c3aed'),
(UUID(), 'Luxe', '#dc2626'),
(UUID(), 'Industrial', '#ca8a04'),
(UUID(), 'Rural', '#16a34a'),
(UUID(), 'Barcelona', '#2563eb'),
(UUID(), 'Costa Brava', '#0d9488'),
(UUID(), 'Hot Lead', '#ef4444'),
(UUID(), 'VIP', '#f59e0b');
