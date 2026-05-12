# Auditoria Profunda: Sistema de Prospeccion ABM Tecnocim

**Fecha:** 2026-05-13
**Scope:** Sistema multi-agente /prospect + flujos de contacto + RGPD
**Motor:** Claude Code (agentes, WebSearch, browser automation, API calls)

---

## 1. Estado Actual del Sistema

### 1.1 Pipeline de Prospeccion (/prospect)

```
[prospect-researcher]     [prospect-scraper]     [prospect-compiler]
  WebSearch x3 queries  ->  Playwright browse  ->  Validate + CSV
  15-25 empresas/run       Extract emails          Dedup + RGPD log
```

**Comando:** `/prospect <sector> <region> <count>`
**Agentes:** 3 (researcher, scraper, compiler)
**Output:** CSV + source-log JSON

**Lo que funciona bien:**
- Separacion clara de responsabilidades (research / scrape / compile)
- Solo emails genericos (info@, contacto@, comercial@) -- evita RGPD sobre datos personales
- Source log con timestamp y URL (trazabilidad)
- Paralelizacion por sector/region
- Formato CSV compatible con wizard de importacion

**Gaps criticos identificados:**

| # | Gap | Impacto | Prioridad |
|---|-----|---------|-----------|
| G1 | No hay scoring pre-contacto (ICP fit) | Se contacta a empresas irrelevantes | ALTA |
| G2 | No hay dedup contra DB existente en la plataforma | Prospectos duplicados | ALTA |
| G3 | No hay verificacion de email (MX/SMTP check) | Bounces danan reputacion del dominio | ALTA |
| G4 | No hay Lista Robinson check | ILEGAL en Espana (obligatorio) | CRITICA |
| G5 | Solo 3 queries de busqueda por sector/region | Cobertura limitada (~60%) | MEDIA |
| G6 | No hay enrichment automatico post-scraping | Emails sin contexto para personalizar | MEDIA |
| G7 | No hay deteccion de senales de intencion | Sin priorizar empresas "in-market" | MEDIA |
| G8 | Scraper visita 1 empresa a la vez | Lento en batches grandes | BAJA |
| G9 | No hay canal LinkedIn (solo email) | Pierde 287% mas conversion multicanal | ALTA |
| G10 | No genera LIA (Legitimate Interest Assessment) | Sin defensa legal ante AEPD | CRITICA |

### 1.2 Flujos de Contacto (Sequences + Branching)

```
Step 1 (email inicial)
  |
Step 2 (condition: opened?)
  |-- YES -> Step 3 (engaged, deeper value)
  |-- NO  -> Step 4 (not_engaged, new subject)
  |
Step 5 (condition: clicked?)
  |-- YES -> Step 6 (direct_close, meeting CTA)
  |-- NO  -> Step 7 (soft_close, final touch)
```

**Lo que funciona bien:**
- Decision tree con condition nodes (opened/clicked/replied)
- Graph API para visualizacion (nodes + edges)
- 2-pass insert (insert steps -> wire FKs) robusto
- Scheduler cada 5 min con warm-up curve
- Timezone-aware sending con optimal hour
- AI genera 7-step branched sequence personalizada
- Suppression list + HMAC unsubscribe + List-Unsubscribe header

**Gaps identificados:**

| # | Gap | Benchmark | Prioridad |
|---|-----|-----------|-----------|
| F1 | Solo condiciones email (opened/clicked/replied) | Outreach: triggers externos, intent signals | MEDIA |
| F2 | No hay multi-canal (LinkedIn + phone + email) | La Growth Machine: 4 canales nativos | ALTA |
| F3 | No hay A/B testing real en branching | Lemlist: variant testing por rama | MEDIA |
| F4 | No hay "waterfall contact" (email->LinkedIn->phone) | Clay+LGM: escalation automatica | ALTA |
| F5 | Personalizacion solo {first_name}, {company} | AiSDR: parrafos completos personalizados | MEDIA |
| F6 | No hay nurture track (largo plazo post-secuencia) | 6sense: re-engagement automatico | BAJA |
| F7 | Enrichment pipeline incompleto (solo Gemini activo) | Clay: 150+ proveedores waterfall | ALTA |
| F8 | No hay scoring dinamico durante secuencia | Outreach: score ajusta prioridad | MEDIA |

### 1.3 Madurez vs Mercado

```
                    Email-only    Multi-channel    Intent-driven    Autonomous
                    (Instantly)   (Lemlist/LGM)    (6sense)         (Landbase)
                         |             |               |                |
  ABM Tecnocim -----[X]--|-------------|---------------|----------------|
                     ^
                     Aqui estamos
```

**Posicion actual:** Entre Instantly (email-only) y Lemlist (multi-channel).
**Objetivo realista:** Nivel Lemlist/La Growth Machine con compliance Cognism.

---

## 2. Analisis RGPD -- Hallazgos Criticos

### 2.1 Marco Legal en Espana (3 capas)

| Regulacion | Gobierna | Aplica a nosotros |
|------------|---------|-------------------|
| RGPD Art. 6.1.f | Tratamiento datos personales | SI (si usamos emails nominales) |
| LOPDGDD Art. 19 | Datos contacto profesional | SI (presuncion de interes legitimo) |
| LSSI Art. 21 | Envio comunicaciones comerciales electronicas | SI (requiere consentimiento previo) |

### 2.2 La Tension Fundamental

**RGPD** permite tratar datos profesionales bajo interes legitimo (Art. 6.1.f + Art. 19 LOPDGDD).
**LSSI Art. 21.1** PROHIBE enviar emails comerciales sin consentimiento previo o relacion contractual previa.

> Tener base RGPD valida NO autoriza enviar emails bajo LSSI. Son regulaciones independientes.

**Nuestra posicion (emails genericos info@):**
- RGPD: NO aplica (no son datos personales)
- LSSI: SI aplica (prohibe comunicaciones comerciales no solicitadas por medios electronicos)

**Zona gris tolerada por AEPD:** outreach B2B altamente segmentado, bajo volumen, relevante para la funcion profesional del destinatario, con opt-out inmediato. Basicamente "networking profesional genuino" vs "marketing masivo".

### 2.3 Incumplimientos Actuales

| # | Incumplimiento | Riesgo | Solucion |
|---|---------------|--------|----------|
| R1 | No se consulta Lista Robinson | Sancion 1.000-70.000 EUR | Integrar API listarobinson.es |
| R2 | No hay LIA documentada por campana | Sin defensa ante AEPD | Generar LIA automatica con Claude |
| R3 | Footer email incompleto | Sancion LSSI Art. 20 | Anadir: CIF, base legal, fuente datos |
| R4 | No hay disclosure de fuente de datos | Incumple Art. 14 RGPD | Anadir "datos obtenidos de su web publica" |
| R5 | No hay politica de retencion | Incumple Art. 5.1.e RGPD | Auto-purge 12 meses sin interaccion |
| R6 | No distingue autonomos vs empresas | Autonomos = consentimiento obligatorio | Filtrar por forma juridica (S.L., S.A.) |
| R7 | No hay registro de actividades (Art. 30) | Obligatorio para responsable | Documentar en plataforma |

### 2.4 Sanciones Recientes AEPD (Contexto)

- 2024: 281 sanciones, 35.6M EUR total (record)
- 2025: multas individuales hasta 10M EUR
- Un solo email no solicitado: 2.000-5.000 EUR
- No consultar Lista Robinson: 5.000 EUR por caso
- AEPD ya sanciona a PYMES -- "somos pequenos" no protege

---

## 3. Benchmark: Que Hacen los Mejores

### 3.1 Arquitecturas Multi-Agente del Mercado

**Landbase GTM-1 Omni (5 agentes):**
```
Strategy Agent -> Research Agent -> AI SDR Agent -> RevOps Agent -> IT Agent
(ICP + plan)     (220M contacts)   (email+LinkedIn)  (analytics)    (deliverability)
```
- 4-7x mas conversion, 70-80% menos coste vs SDR humano
- Agentes con memoria compartida y aprendizaje continuo

**Clay (Orquestacion de datos):**
```
Provider A (no data?) -> Provider B (no data?) -> Provider C -> Enriched Lead
                      Waterfall across 150+ sources
```
- 90%+ cobertura, 70% menos coste por contacto verificado
- Claygent: agente AI que navega web para cualquier pregunta sobre empresa

**La Growth Machine (Multi-canal nativo):**
```
Email -> (no response 48h) -> LinkedIn connect -> (accepted) -> LinkedIn DM
                           -> (not accepted)  -> Phone call -> Voicemail AI
```
- 3.5x mas respuestas que email-only
- AI voice cloning para voicemails personalizados

### 3.2 Cadencia Optima 2026 (Best Practice)

| Dia | Accion | Canal |
|-----|--------|-------|
| 1 | Email inicial (propuesta de valor) | Email |
| 3 | Conexion LinkedIn con nota personalizada | LinkedIn |
| 5 | Follow-up email con recurso/caso de estudio | Email |
| 8 | Llamada telefonica + voicemail | Phone |
| 10 | LinkedIn InMail referenciando touchpoints previos | LinkedIn |
| 14 | Email final ofreciendo hora concreta de reunion | Email |
| 17 | Email de despedida (breakup) | Email |

**Dato clave:** Secuencias multi-canal (email + phone + LinkedIn) generan **287% mas compras** que single-channel.

### 3.3 Lo Que Debemos Copiar (Adaptado a Claude Code)

| De quien | Que copiar | Como en Claude Code |
|----------|-----------|-------------------|
| Clay | Waterfall enrichment | Agente que encadena Perplexity -> Firecrawl -> web scraping -> Gemini |
| Outreach | Branching cross-channel | Conditions que incluyan LinkedIn connect/DM status |
| Cognism | Lista Robinson + DNC check | Agente pre-send que verifica contra API |
| La Growth Machine | Social warming pre-outreach | Agente LinkedIn que visita perfil + interactua antes de email |
| 6sense | Intent signals | Agente que busca senales: funding, job changes, tech evaluations |
| Lemlist | A/B testing por rama | Generar 2 variantes por step, medir open/click rate |

---

## 4. Plan de Mejoras Priorizadas

### Fase 1: COMPLIANCE (Semana 1-2) -- URGENTE

> Sin esto, cada email enviado es un riesgo legal de 2.000-5.000 EUR

#### M1. Agente `prospect-compliance-checker` (NUEVO)
```
Antes de cualquier envio:
1. Verificar Lista Robinson (API listarobinson.es o check manual)
2. Verificar suppression_list interna
3. Verificar do_not_contact flag
4. Filtrar autonomos (sin S.L., S.A., S.L.U. en nombre -> flag para revision)
5. Verificar que email es generico (no nominal)
```

#### M2. Comando `/generate-lia` (NUEVO)
```
Input: campana_id o descripcion de campana
Output: Documento LIA (Legitimate Interest Assessment) con:
  - Interes legitimo identificado
  - Test de necesidad
  - Ponderacion de intereses
  - Salvaguardas implementadas
  - Fecha y firma
Formato: Markdown + PDF exportable
```

#### M3. Mejorar footer de emails
```
Anadir a tenant.config.branding.footer_html:
  - Razon social + CIF (Tecnocim Innova SL, B02896231)
  - Base legal: "Art. 6.1.f RGPD - interes legitimo"
  - Fuente: "Datos obtenidos de la web publica de su empresa"
  - Derechos: acceso, rectificacion, supresion, oposicion
  - Link a politica de privacidad completa
  - Unsubscribe (ya existe, mantener)
```

#### M4. Politica de retencion automatica
```
Cron job (mensual):
  - Prospects sin interaccion > 12 meses -> status='archived'
  - Prospects archived > 3 meses -> DELETE (conservar solo en suppression_list)
  - Log de purge para accountability
```

### Fase 2: ENRICHMENT MEJORADO (Semana 2-3)

#### M5. Agente `prospect-enricher` mejorado (Claude Code)
```
Pipeline waterfall:
1. WebSearch: "{company} {sector} Espana news funding employees"
2. WebSearch: "{company} LinkedIn company page"
3. Playwright: Navegar web empresa -> extraer about, servicios, equipo
4. WebSearch: Perplexity deep research (via API existente)
5. Consolidar con Claude -> structured JSON:
   {
     employee_range, revenue_estimate, founding_year,
     recent_news[], tech_stack[], pain_points[],
     icp_score (1-10), suggested_approach,
     decision_makers[], company_description
   }
```

#### M6. ICP Scoring pre-contacto (NUEVO)
```
Despues de enrichment, antes de generar CSV:
  Score 0-100 basado en:
  - Tamano empresa (10-500 empleados = ideal)
  - Sector match con oferta del tenant
  - Presencia digital (web moderna, LinkedIn activo)
  - Senales de intencion (hiring, funding, expansion)
  - Ubicacion geografica

  Solo incluir en CSV prospects con ICP score >= 60
```

#### M7. Email verification pre-import
```
Para cada email generico encontrado:
1. DNS MX record check (dominio tiene servidor de correo?)
2. SMTP connection test (servidor acepta conexiones?)
3. Catch-all detection (acepta cualquier email?)
Resultado: verified | unverified | catch-all | invalid
Solo importar verified + catch-all con advertencia
```

### Fase 3: MULTI-CANAL via Claude Code (Semana 3-5)

#### M8. Agente `linkedin-warmer` (NUEVO)
```
Pre-outreach (dias -3 a 0):
1. Buscar perfil del decision-maker en LinkedIn
2. Visitar perfil (social warming)
3. Interactuar con posts recientes (like/comment)
4. Enviar conexion con nota personalizada
5. Registrar actividad en prospect_activities

Post-email (si no hay respuesta dia 5):
6. Enviar DM LinkedIn referenciando email
7. Registrar como touchpoint en secuencia
```
**Herramientas:** LinkedIn MCP (ya operativo) + prospect-researcher

#### M9. Branching multi-canal en secuencias
```
Step 1: Email inicial (dia 0)
Step 2: Condition - opened? (48h)
  YES -> Step 3: LinkedIn connect + email engaged
  NO  -> Step 4: LinkedIn visit perfil + email re-engage (nuevo subject)
Step 5: Condition - replied OR linkedin_connected? (96h)
  YES -> Step 6: LinkedIn DM con propuesta reunion
  NO  -> Step 7: Email final breakup
```
**Requiere:** Extender condition_config para incluir `linkedin_connected`, `linkedin_messaged`

#### M10. Comando `/prospect-sequence` integrado (NUEVO)
```
Flujo completo desde Claude Code:
1. /prospect metalurgia catalunya 20
2. Enrichment automatico de los 20
3. ICP scoring -> filtrar top 10
4. Generar secuencia branched personalizada para cada uno
5. Social warming LinkedIn (agente en background)
6. Import a plataforma via API
7. Enroll en secuencia
8. Monitorizar respuestas
```

### Fase 4: INTELIGENCIA (Semana 5-8)

#### M11. Agente `intent-signal-detector` (NUEVO)
```
Para empresas target, buscar senales:
- Ofertas de empleo recientes (hiring = crecimiento)
- Noticias de funding/inversion
- Cambios en web (nuevos productos, expansion)
- Actividad LinkedIn del CEO/Director
- Mencion en prensa sectorial

Output: intent_score (0-10) + signals[]
Priorizar prospects con intent_score >= 7
```

#### M12. A/B testing en generacion de emails
```
Para cada step de email, generar 2 variantes:
- Variante A: approach directo
- Variante B: approach consultivo
Asignar aleatoriamente al enrollar
Medir: open_rate, click_rate, reply_rate por variante
Reportar ganador despues de N sends
```

#### M13. Agente `campaign-optimizer` mejorado
```
Post-campana (despues de 50+ sends):
1. Analizar open/click/reply rates por step
2. Identificar drop-off points
3. Sugerir mejoras especificas:
   - "Step 3 tiene 5% open rate -> cambiar subject line"
   - "Step 5 NO path tiene 0 replies -> reescribir angle"
4. Auto-generar variantes mejoradas con Claude
```

---

## 5. Arquitectura Multi-Agente Propuesta

### 5.1 Sistema Actual (3 agentes)

```
/prospect
  |-> prospect-researcher (WebSearch)
  |-> prospect-scraper (Playwright)
  |-> prospect-compiler (Read/Write)
```

### 5.2 Sistema Propuesto (8 agentes)

```
/prospect-full
  |
  |-> [DISCOVERY]
  |   |-> prospect-researcher (WebSearch) ............... ya existe
  |   |-> intent-signal-detector (WebSearch) ............ NUEVO
  |
  |-> [EXTRACTION]
  |   |-> prospect-scraper (Playwright) ................. ya existe
  |   |-> email-verifier (Bash: DNS/MX check) .......... NUEVO
  |
  |-> [ENRICHMENT]
  |   |-> prospect-enricher (WebSearch + Playwright) .... mejorado
  |   |-> icp-scorer (Read/Write) ...................... NUEVO
  |
  |-> [COMPLIANCE]
  |   |-> compliance-checker (WebSearch/API) ............ NUEVO
  |   |-> lia-generator (Write) ........................ NUEVO
  |
  |-> [COMPILATION]
  |   |-> prospect-compiler (Read/Write) ................ ya existe, mejorado
  |
  |-> [OUTREACH] (post-import)
  |   |-> linkedin-warmer (LinkedIn MCP) ................ NUEVO
  |   |-> sequence-generator (API calls) ................ ya existe como endpoint
```

### 5.3 Flujo Orquestado desde Claude Code

```
Usuario: /prospect-full metalurgia catalunya 20

Fase 1 - Discovery (paralelo):
  researcher x3 queries -> 40-60 empresas brutas
  intent-detector -> senales de intencion por empresa

Fase 2 - Extraction (paralelo por batch):
  scraper batch 1 (15 empresas) -> emails encontrados
  scraper batch 2 (15 empresas) -> emails encontrados
  scraper batch 3 (15 empresas) -> emails encontrados

Fase 3 - Verification:
  email-verifier -> MX check, SMTP test -> filtrar invalidos

Fase 4 - Enrichment (paralelo):
  enricher batch 1 -> datos estructurados
  enricher batch 2 -> datos estructurados

Fase 5 - Scoring + Compliance:
  icp-scorer -> score 0-100, filtrar < 60
  compliance-checker -> Lista Robinson, autonomos, suppression

Fase 6 - Compilation:
  compiler -> CSV final + source log + LIA draft

Fase 7 - Report:
  Mostrar: X encontradas, Y con email, Z verificadas,
           W pasan ICP, V pasan compliance
  CSV path, LIA path, next steps

Fase 8 - Outreach (opcional, post-import):
  linkedin-warmer -> social warming top 10 prospects
  sequence-generator -> branched sequences personalizadas
```

---

## 6. Comparativa Antes/Despues

| Dimension | Ahora | Propuesto | Benchmark mercado |
|-----------|-------|-----------|-------------------|
| Agentes | 3 | 8 | Landbase: 5 |
| Canales | Email only | Email + LinkedIn | LGM: 4 canales |
| Enrichment | Gemini only | Waterfall 4 fuentes | Clay: 150+ |
| ICP scoring | No | Pre-contacto 0-100 | 6sense: predictivo |
| Intent signals | No | WebSearch-based | 6sense: 1T signals/dia |
| Email verification | No | MX + SMTP | ZoomInfo: phone-verified |
| Lista Robinson | No (ILEGAL) | Integrado | Cognism: 15 DNC lists |
| LIA documentada | No | Auto-generada | Cognism: built-in |
| A/B testing | No | Por rama | Lemlist: nativo |
| Data retention | No | 12-month auto-purge | RGPD best practice |
| Branching | Email events only | + LinkedIn + intent | Outreach: external triggers |
| Compliance footer | Parcial | Completo (Art. 14+20+21) | Cognism: enterprise |

---

## 7. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigacion |
|--------|-------------|---------|-----------|
| Sancion AEPD por no consultar Lista Robinson | ALTA | 5.000+ EUR | M1: integrar check inmediato |
| Sancion LSSI por email no solicitado | MEDIA | 2.000-30.000 EUR | M2: LIA + bajo volumen + relevancia |
| Bounces danan dominio tecnocim.com | ALTA | Blacklist = 0 entregas | M7: verificacion email pre-send |
| Autonomos contactados sin consentimiento | MEDIA | Sancion RGPD | M1: filtrar por forma juridica |
| LinkedIn rate limiting / ban | MEDIA | Pierde canal | M8: limitar a 20 acciones/dia |
| Gemini rate limiting en enrichment | ALTA | Pipeline bloqueado | M5: usar Claude como fallback |

---

## 8. Quick Wins (Implementables Esta Semana)

### QW1. Mejorar queries del researcher (30 min)
Anadir queries adicionales al agente:
```
4. "[sector] [region] Spain empresas directorio industrial"
5. "poligono industrial [region] empresas [sector]"
6. "asociacion empresarial [sector] [region] miembros"
```
Pasa de ~60% a ~80% cobertura.

### QW2. Dedup contra DB existente en compiler (1 hora)
El compiler ya lee CSVs previos. Anadir:
```
Antes de escribir CSV:
1. GET /api/prospects?search={domain} para cada empresa
2. Si existe -> skip (ya en sistema)
3. Log: "X empresas ya en DB, excluidas"
```

### QW3. Footer compliance mejorado (30 min)
Actualizar tenant.config.branding.footer_html con todos los campos RGPD/LSSI requeridos.

### QW4. Filtro de autonomos en compiler (30 min)
```
Si company_name NO contiene S.L.|S.A.|S.L.U.|S.C.|S.Coop:
  -> flag: "posible_autonomo = true"
  -> excluir del CSV principal
  -> incluir en CSV separado con advertencia
```

### QW5. Comando /generate-lia con Claude (1 hora)
Nuevo comando que genera documento LIA a partir de descripcion de campana.
Template basado en EDPB Guidelines 1/2024.

---

## 9. Fuentes de la Investigacion

### Herramientas ABM analizadas
- Landbase GTM-1 Omni, Clay.com, Instantly.ai, La Growth Machine
- Lemlist, Outreach, Salesloft, 6sense, Demandbase
- Apollo.io, ZoomInfo, Cognism, Amplemarket, AiSDR
- 11x.ai, Artisan (resultados negativos documentados)

### Marco legal consultado
- RGPD Art. 6.1.f, Art. 14, Art. 21, Art. 5.1.e
- LOPDGDD Art. 19 (datos contacto profesional)
- LSSI-CE Art. 20, Art. 21 (comunicaciones comerciales)
- EDPB Guidelines 1/2024 (interes legitimo)
- CJEU Sentencia C-621/22 (interes comercial como legitimo)
- AEPD criterio 2025 (empresarios autonomos)
- AEPD resoluciones: PS/00362/2020, EXP202312711/PS-00084-2024

### Frameworks multi-agente
- CrewAI (mejor para sales prospecting: roles naturales)
- LangGraph (mejor para produccion: state management)
- Claude Code Agent system (nuestro approach actual)
