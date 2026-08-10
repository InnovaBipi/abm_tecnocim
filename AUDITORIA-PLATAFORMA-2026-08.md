# Auditoría de plataforma ABM — Agosto 2026

**Fecha:** 2026-08-10 · **Alcance:** validación integral de la plataforma (backend Express+MySQL, cliente React, MCP/OAuth, datos, deploy) con vistas a evolucionarla de forma incremental. **Modo:** solo informe — no se aplicó ningún fix en esta pasada.

**Método:** 2 agentes de exploración + 6 agentes especializados (security-auditor, migration-validator, api-contract-validator, qa-testing, performance-analyzer, bundle-analyzer, design-system-auditor) + baseline mecánico (npm audit, suites de test, tsc, git history) + 7 búsquedas de validación contra mejores prácticas 2026. Todos los hallazgos llevan fichero:línea.

> **Actualización 2026-08-10 (commit f86ab0c, desplegado + verificado E2E en prod):** aplicados 3 quick-wins OAuth. **H-1 RESUELTO** (rate limit en `/oauth/login`, confirmado 429 en el 11º intento). **H-4 RESUELTO** (binding `aud:'mcp'` + REST rechaza `aud:'mcp'` + guardia `typ:'refresh'`; connectors intactos). **H-2 CERRADO como falso positivo** — el SDK MCP ya fuerza S256 (`authorize.js` `z.literal('S256')` + `token.js` `verifyChallenge`); se añadió guardia defensiva. Validado con `/security-scan` (3/3 cerrados, sin regresión) y `/review` (0 bugs). Pendientes: H-3 (refresh rotation), C-1/C-2 y el resto del roadmap.

---

## 1. Veredicto ejecutivo

**La plataforma está estructuralmente bien montada, con salvedades concretas y acotadas — no un rediseño.** El aislamiento multi-tenant (el invariante crítico de un SaaS B2B) es sólido y consistente: `tenant_id` viaja siempre desde el JWT, nunca desde el input, y se aplica en la práctica totalidad de queries. La arquitectura MCP/OAuth añadida esta semana está bien concebida. Los problemas reales se concentran en **cuatro debilidades del flujo OAuth 2.1**, **cifrado de secretos que probablemente está inactivo en producción**, y **deuda de tests** en los módulos que mueven dinero/emails (outbox, campaigns, OAuth). Nada de esto bloquea la operación actual, pero debe resolverse antes de escalar a más tenants o exponer más la superficie MCP en lenguaje natural.

### Scorecard por dominio

| Dominio | Estado | Justificación |
|---------|:------:|---------------|
| Multi-tenancy | 🟢 | `tenant_id` universal en queries; verificado por agente + test dedicado. Gaps puntuales en SELECTs post-escritura (defensa en profundidad, no fuga real). |
| Seguridad — MCP/OAuth | 🟡 | 3 de 4 HIGH resueltos (f86ab0c): rate-limit, audience binding, PKCE (falso positivo). Queda H-3 (refresh rotation, sprint). |
| Seguridad — secretos | 🔴 | Password en git desde may-2026; cifrado at-rest AES-GCM correcto pero **no-op sin `SECRETS_ENCRYPTION_KEY`** (probablemente inactivo → IMAP/Resend en texto plano en BD). |
| Datos / Migraciones | 🟠 | `server/database/` (lo que se despliega) va 4 migraciones por detrás de `database/`. Son UPDATEs de datos, no esquema → riesgo = filas `tenant_id` NULL, no queries rotas. |
| Calidad de tests | 🟠 | ~16% server / ~19% client. 0 tests en outbox (558 LOC), campaigns/, sequences/, imports, y toda la superficie OAuth. |
| API / Contratos | 🟠 | Filtro `scoreMin/sortBy` client↔server roto (camelCase vs snake_case); `generate-step` devuelve `body` no `body_html`; enroll REST sin check de tenant en el prospect. |
| Rendimiento | 🟡 | Sano hoy (single-instance, volumen bajo). Bombas latentes: `cancelBouncedFollowups` full-scan cross-tenant cada 2 min; subconsultas correlacionadas en dashboard/campaigns. |
| Frontend / UX | 🟡 | Sistema de componentes usado consistentemente (~85%). Fallos: `<div onClick>` sin rol en Dashboard, queries secundarias que fallan en silencio mostrando vacío. |
| Dependencias | 🟠 | 13 HIGH server / 11 HIGH client (todas fixables): axios SSRF, react-router RCE, express-rate-limit bypass IPv6, nodemailer/multer. Express 4 y multer 1.x envejecidos. |
| Higiene de repo | 🔴 | ~250 ficheros scratch en raíz; password en claro en ficheros versionados y sin trackear; `.gitignore` insuficiente. |

---

## 2. Fortalezas confirmadas

Para que el veredicto sea creíble: lo que está **bien hecho** y no hay que tocar.

- **Aislamiento multi-tenant**: `tenant_id` en todas las queries de datos, siempre desde `req.user.tenantId` (JWT), nunca del body. Test dedicado `tenant-isolation.test.ts` + hook PreToolUse que lo verifica en cada edición.
- **Webhooks Resend**: verificación de firma Svix + protección anti-replay (ventana 5 min) en `webhooks.ts`.
- **Unsubscribe**: token HMAC-SHA256 con `timingSafeEqual` (no forjable), footer RGPD por tenant.
- **Cifrado at-rest bien implementado** (`crypto.ts`): AES-256-GCM correcto — IV de 12 bytes, auth tag, formato self-describing `enc:v1:`, tolera BD mixta. El problema es operacional (la clave), no el código.
- **Defensa weekend en 4 capas** + warmup lineal por tenant (scheduler, scheduling.ts). Ha evitado incidentes reales.
- **bcrypt** salt 10, rate limits en auth/send/upload, Helmet + CORS restringido a `FRONTEND_URL`.
- **MCP tools**: aislamiento de tenant sólido (el input de tool nunca influye en el tenant → confused deputy mitigado por diseño); `emails_bulk_insert` fail-fast (mejora deliberada sobre el REST).
- **Code splitting**: las 10 rutas con `lazy()`; bundle total ~255KB gzip (51% del target de 500KB).
- **Migraciones auto-aplicadas** en cada deploy con tracking `_migrations` y safe-errors (arreglado en jul-2026).

---

## 3. Hallazgos por severidad

### 🔴 Críticos

**C-1 · Password de plataforma en git desde 2026-05-13.**
`.claude/settings.json:40` contiene `ABM_PASSWORD: "Tecnocim2026!"` en claro, versionado. El literal aparece además en ficheros scratch sin trackear (`batch*.js`, `*.md`) y en specs de Playwright (`client/playwright/login.spec.ts`, `helpers/auth.ts`). En el historial desde el commit del 13-may. **Rotar la contraseña no basta**: hay que asumir la credencial comprometida y cambiarla en los 4 tenants (comparten `Tecnocim2026!`). Enlaza con la rotación pendiente desde la auditoría de junio (Resend/IMAP/webhook). **Esfuerzo: S** (rotar) **+ M** (limpiar historia o aceptar y rotar todo).

**C-2 · Cifrado de secretos probablemente inactivo en producción.**
`crypto.ts:41-46`: `encryptSecret()` es un **no-op** si `SECRETS_ENCRYPTION_KEY` no está definida. Esa variable **no está en `env.ts`, ni en la tabla de vars requeridas de CLAUDE.md, ni se verifica al arrancar** (`M-05`). Alta probabilidad de que en prod no esté puesta → IMAP passwords, Resend API keys y webhook secrets almacenados en **texto plano** en `tenants.config`. Una fuga de credencial de solo-lectura de MySQL expone todos los secretos de todos los tenants. El código de cifrado es correcto; falta activarlo. **Esfuerzo: S** (añadir var + check de arranque + reescribir settings una vez para cifrar lo existente).

### 🟠 Altos

**H-1 · `/oauth/login` sin rate-limit (credential stuffing).** ✅ **RESUELTO (f86ab0c).** `index.ts:188` / `oauth-login.ts:65`. El login REST tenía `authLimiter` (10/15min) pero `POST /oauth/login` no. Aplicado `app.post('/oauth/login', authLimiter, handleOAuthLogin)`; E2E confirma 429 en el 11º intento. **S**

**H-2 · PKCE `code_challenge_method=plain`.** ✅ **CERRADO — falso positivo.** El SDK MCP ya fuerza S256: `node_modules/@modelcontextprotocol/sdk/.../authorize.js:80` (`z.literal('S256')`) rechaza `plain` en `/authorize`, y `token.js:97` verifica con `verifyChallenge` (hash S256). Un `plain` no puede redimirse. Añadida guardia defensiva en `oauth-login.ts` + doc. El agente de seguridad lo sobrevaloró al analizar `handleOAuthLogin` en aislamiento. **S (solo defensa en profundidad)**

**H-3 · Refresh tokens sin rotación.** 🟠 PENDIENTE (sprint). `oauth-provider.ts:112-123`. `exchangeRefreshToken` emite nuevo par pero no invalida el viejo (no hay tabla ni revocación). Un refresh token exfiltrado da acceso 30 días sin revocación. Fix: tabla `oauth_refresh_tokens` (hash), borrar el viejo al rotar, detectar reuso. **M** · _Parcialmente mitigado por f86ab0c: `verifyAccessToken` ya rechaza `typ:'refresh'` como access token._

**H-4 · Tokens sin binding de audiencia (token passthrough).** ✅ **RESUELTO (f86ab0c).** `oauth-provider.ts` / `auth.ts`. Los access tokens OAuth ahora llevan `aud:'mcp'`; `authenticate`/`optionalAuth` (REST) rechazan `aud:'mcp'`. Cierra la dirección prioritaria (token de connector filtrado → REST API). Residual documentado y no-breaking: los JWT REST (sin `aud`) siguen funcionando en ambas superficies — se cerrará la dirección REST→MCP cuando los connectors migren a OAuth (M1). **S**

**H-5 · `POST /campaigns/:id/prospects` no valida que el prospect sea del tenant.** `campaigns/prospects.ts:43-49`: inserta `(campaign_id, prospect_id)` sin comprobar `prospect_id AND tenant_id`. Un actor con un UUID de prospect de otro tenant podría enrolarlo en su campaña (aunque no leerlo). La tool MCP equivalente **sí** valida — el gap es solo en REST. Fix: `SELECT ... WHERE id=? AND tenant_id=?` antes del INSERT. **S**

**H-6 · Filtro y orden de prospects rotos (client↔server).** `api.ts:56-60` envía `scoreMin/scoreMax/sortBy/sortOrder` (camelCase); `prospects.ts:67-70` lee `score_min/score_max/sort_by/sort_order` (snake_case). Axios serializa las claves tal cual → el server nunca los encuentra y **el filtro por score y el orden custom se ignoran en silencio**. Fix: renombrar campos en `ProspectFilters` a snake_case. **S**

**H-7 · `POST /sequences/:id/generate-step` devuelve `body`, no `body_html`.** `sequences/steps.ts:338`. Cualquier consumidor que lea `body_html` obtiene `undefined`. Fix: renombrar el campo de respuesta. **S**

### 🟡 Medios

| ID | Hallazgo | Fichero | Esfuerzo |
|----|----------|---------|:--------:|
| M-1 | Migraciones 013-016 no están en `server/database/` (lo desplegado). Son UPDATEs de datos; riesgo = filas `prospect_score_history.tenant_id` NULL viejas. Verificar en prod. | `server/database/` | S |
| M-2 | `cancelBouncedFollowups` hace `SELECT ... WHERE status='bounced'` **sin tenant_id** + N+1 UPDATE, cada 2 min. No fuga datos (UUIDs globales) pero escanea todo y no escala. | `scheduler.ts:499` | S |
| M-3 | CSP en `report-only` sin enforcement ni report-uri. XSS en la SPA sin mitigación de navegador. | `index.ts:63` | L |
| M-4 | `/uploads` estático sin `Content-Disposition: attachment` ni restricción de acceso. CSV con HTML podría ejecutarse por MIME-sniffing. | `index.ts:101` | S |
| M-5 | Tools MCP destructivas (`campaign_set_status`, `emails_reject`, `outbox_redistribute`) sin check de rol — un `viewer` puede archivar/rechazar. El REST usa `requireRole`. | `mcp/tools/write.ts` | M |
| M-6 | `GET /campaigns/:id/generated-emails` sin paginación — devuelve todos los emails de la campaña en una llamada. | `campaigns/emails.ts:254` | S |
| M-7 | "Enviados" en CampaignMetrics lee `emailStats.sent` (de `email_events`/sequences) mientras la pestaña métricas lee `generated_emails` (outbox) → dos contadores distintos como el mismo dato. | `CampaignMetrics.tsx` | S |
| M-8 | Subconsultas correlacionadas (3 sub-SELECT por campaña) en dashboard y campaigns list; `email_events` sin índice por campaign_id. O(campañas×emails) al crecer. | `dashboard.ts:226`, `campaigns/base.ts:69` | M |
| M-9 | OAuth consent form sin protección CSRF. | `oauth-login.ts:16-49` | M |
| M-10 | SELECTs post-escritura sin `tenant_id` (defensa en profundidad): sequences, settings scoring rules. | `sequences/base.ts:220`, `settings.ts:551` | S |
| M-11 | `enrichProspect(prospectId)` sin `tenant_id` en el SELECT interno; la tool MCP lo guarda, el REST no fuerza el check. | `enrichment.ts:22` | S |
| M-12 | Dashboard: 8 queries secundarias sin manejo de `error` → fallo de red se muestra como "sin datos". Idem tabs Email/APIKeys/Team de Settings. | `Dashboard.tsx`, `Settings.tsx` | M |
| M-13 | `<div onClick>` sin `role/tabIndex/onKeyDown` en 4 listas del Dashboard → no navegable por teclado. | `Dashboard.tsx:424+` | S |
| M-14 | `outbox_redistribute` MCP cap 500 vs REST 200, sin validar UUID por elemento. Divergencia latente. | `mcp/tools/write.ts:449` | S |

### 🔵 Bajos (resumen)

Endpoints de `campaigns/emails.ts` sin schema Zod (validación manual con `if`); `console.error` con UUID de prospect en `write.ts:617`; check de JWT_SECRET solo busca la cadena `'change'` (no entropía); `POST /api/admin/cleanup-today` sin `requireRole('admin')`; `unsubscribe.ts` UPDATE sin tenant_id cuando falta `tid`; SSRF guard sin IPv6/DNS-rebinding en `scraper.ts` (mitigado porque el fetch real lo hace Firecrawl); DCR de OAuth abierto (RFC 7591, mitigado por el login); recharts (108KB) preload eager para las 10 rutas cuando solo 2 lo usan; tablas `<table>` crudas en Dashboard/CampaignMetrics en vez del componente `<Table>`.

---

## 4. Deuda de tests

Cobertura actual: **server ~16%** (10 ficheros test / 61 fuente), **client ~19%** (10/52), **3 specs E2E**. Suites verdes: 123 server + 71 client. Sin ningún test: `outbox.ts` (558 LOC), `campaigns/*`, `sequences/*`, `imports.ts`, y **toda la superficie OAuth** (`oauth-provider.ts`, `oauth-login.ts`) — precisamente donde están los 4 HIGH de seguridad.

**Módulos de mayor riesgo sin cobertura** (criticidad = mueve dinero/emails/datos de tenant + ha causado incidentes):

| Módulo | LOC | Riesgo | Por qué |
|--------|----:|:------:|---------|
| `outbox.ts` (approve, bulk-approve, redistribute, send) | 558 | ALTO | Causó incidentes reales (doble conteo, envío agosto vs septiembre). Activa Resend; `send` chequea supresión/`do_not_contact` — un fallo silencioso salta RGPD. |
| `webhooks.ts` (bounce/complaint/open/click) | 360 | ALTO | Efectos irreversibles: suppression_list, `do_not_contact`, cancela enrollments, sube score. Firma Svix con 4 ramas. |
| `campaigns/emails.ts` (approve, schedule-drafts, generate) | 608 | ALTO | `approve-emails` auto-activa campaña (el incidente de agosto fue este path). schedule-drafts (Fase D) sin test. |
| `imports.ts` (upload + mapping + processInline) | 553 | ALTO | Puerta de datos de terceros. Dedup + `tenant_id` en INSERT críticos (lección ACCIÓ del bulk-import silencioso). |
| `unsubscribe.ts` (token HMAC + handler) | 367 | ALTO | Obligación legal LSSI. Un cambio en la derivación del token invalida todos los links de baja sin alertar. |
| `mcp/tools/write.ts` (7 tools sin test) | 697 | ALTO | Operan en prod vía Claude.ai (Fase C). Un bug en `approve_emails` MCP puede tocar el tenant equivocado. |
| `mcp/oauth-provider.ts` + `oauth-login.ts` | 349 | MED-ALTO | Único acceso Claude.ai/ChatGPT. `parseJsonCol` ya tuvo bug de prod (2278c4e). Donde están los 4 HIGH. |

**Los 10 tests prioritarios (en orden):**

1. `outbox.ts` — `POST /redistribute` con `start_date` + exclusión de IDs (el path del incidente de agosto; se refactoriza en el roadmap → blindar antes).
2. `outbox.ts` — `POST /bulk-approve` (protege presupuesto Resend; filtrado de `sent`, cap 200).
3. `webhooks.ts` — `POST /resend` bounced+complaint (verifica los 4 INSERT/UPDATE en secuencia; compliance).
4. `unsubscribe.ts` — `generate/verifyUnsubscribeToken` + handler GET (funciones puras + baja legal).
5. `campaigns/emails.ts` — `approve-emails` con auto-activate (verifica que NO activa si `scheduled===0`; el incidente de agosto).
6. `mcp/tools/write.ts` — `approve_emails` tool: `tenantId` viene de `auth`, nunca del input.
7. `mcp/oauth-provider.ts` — `parseJsonCol` + `AbmClientsStore` + `exchangeAuthorizationCode` (código expirado → null).
8. `webhooks.ts` — `checkSignature` + replay (multi-secret global/per-tenant, fail-closed en prod).
9. `imports.ts` — `fileFilter` dual extensión/MIME + dedup con `tenant_id`.
10. `dashboard.ts` — `GET /stats` con/sin filtro de fechas (`emails_sent` desde `generated_emails`, no `email_events`; sin división por cero).

**E2E recomendado (1 spec):** `outbox.spec.ts` — flujo `bulk-approve → schedule → verify outbox → campaña auto-active`, que replica el incidente de agosto y cubre la cadena de 3 endpoints que los unit tests no ven. **No** recomendado E2E de OAuth/MCP (requiere cliente externo + túnel HTTPS, frágil en CI; los unit tests del provider bastan).

---

## 5. Roadmap evolutivo

Priorización `riesgo × exposición / esfuerzo`. Los quick-wins (riesgo alto, esfuerzo S) suben a "YA" aunque no sean críticos.

### YA (esta semana — antes de cualquier otra evolución)

1. **Rotar credenciales de los 4 tenants** (password + Resend/IMAP/webhook de la deuda de junio) y purgar `ABM_PASSWORD` de `.claude/settings.json` → mover a `.env` o secret del entorno. Asumir `Tecnocim2026!` comprometido. _[C-1]_ · **Dep: hacer esto ANTES de limpiar el repo.**
2. **Activar cifrado at-rest**: añadir `SECRETS_ENCRYPTION_KEY` a `env.ts` + check de arranque en prod + reescribir una vez las settings de cada tenant para cifrar lo existente. _[C-2]_
3. ~~**OAuth quick-wins (3 fixes S)**: rate-limit en `/oauth/login` _[H-1]_, rechazar PKCE `plain` _[H-2]_, `aud` en tokens MCP/REST _[H-4]_.~~ ✅ **HECHO (f86ab0c, 2026-08-10)** — desplegado y verificado E2E.
4. **Fixes de contrato que rompen hoy**: `scoreMin→score_min` etc. _[H-6]_, `body→body_html` _[H-7]_, check de tenant en enroll REST _[H-5]_.
5. **`.gitignore` + limpieza** de los ~250 scratch de la raíz (mover a `.audit-archive/` o borrar).
6. **SSL CA cert** en `database.ts`: `rejectUnauthorized: true` + CA de DO (esfuerzo S confirmado por la doc DO — descargar CA + 3 líneas).
7. **Verificar migraciones en prod**: `SELECT COUNT(*) FROM prospect_score_history WHERE tenant_id IS NULL` y copiar 013-016 a `server/database/`. _[M-1]_

### PRÓXIMO SPRINT (2-4 semanas)

- Refresh token rotation con tabla + revocación _[H-3]_.
- Role guards en tools MCP destructivas _[M-5]_; `requireRole` en `/admin/cleanup-today`.
- Fix `cancelBouncedFollowups` (scope tenant + UPDATE con JOIN) _[M-2]_.
- Headers en `/uploads` _[M-4]_; CSRF en consent _[M-9]_; `enrichProspect(id, tenantId)` _[M-11]_.
- Tests: OAuth (los 4 HIGH) + outbox + `emails_bulk_insert` extendido — **antes** de refactorizar esos módulos.
- Manejo de `error` en queries secundarias del Dashboard/Settings _[M-12]_; a11y de `<div onClick>` _[M-13]_.
- **`npm audit fix`** de los HIGH fixables (axios, react-router, express-rate-limit, postcss) — validar que no rompe.
- Lazy-load recharts (quita 108KB del initial load).

### TRIMESTRE

- Express 4→5 + multer 1.x→2.1+ (multer <2.1.0 tiene DoS conocido; Express 5 ya es el recomendado).
- CSP enforced con nonce _[M-3]_; SSRF IPv6/DNS-rebinding _[scraper]_.
- Cobertura server → 50-60% en módulos de riesgo; E2E de flujo campaña (approve→schedule) e imports CSV.
- Paginación en `generated-emails` _[M-6]_; unificar contador "Enviados" _[M-7]_; índices `email_events(tenant_id, prospect_id)` y refactor de subconsultas _[M-8]_.
- Reunificar `database/` y `server/database/` a una sola fuente de verdad (procedimiento en anexo).
- Tenant cache → store compartido **solo si** se planea segunda instancia (hoy no hace falta).

---

## 6. Anexos

### A. npm audit (2026-08-10)
- **Server**: 22 vulns (13 HIGH, 8 moderate, 1 low), todas con fix disponible. HIGH: nodemailer (SMTP injection), express-rate-limit (bypass IPv6), form-data (CRLF), ip-address (SSRF), path-to-regexp (ReDoS), postcss, vite, tmp, minimatch, nanoid, brace-expansion, linkify-it, mailparser.
- **Client**: 14 vulns (11 HIGH, 2 moderate, 1 low). HIGH: axios (SSRF + prototype pollution), react-router/-dom (RCE vía turbo-stream), lodash, undici (TLS bypass), vite, rollup, postcss, picomatch, nanoid, form-data.

### B. Migraciones
`database/` = 21 (fuente de intención), `server/database/` = 17 (lo desplegado, vía `source_dir: server` en el spec vivo de DO, verificado con `doctl`). Faltan 013-016 (UPDATEs de footer/acentos/backfill de tenant_id). Convenciones: 20/21 cumplen; 003 sin comentario ROLLBACK. `schema.sql` es base pre-multitenancia por diseño (no drift). Procedimiento de reunificación: verificar estado en prod (`_migrations`, columnas de tablas nuevas, NULLs en score_history) → copiar 013-016 → validar 001-021 consecutivas en local → deploy → post-check.

### C. Validación externa (fuentes 2026)
Spec MCP OAuth 2.1 (modelcontextprotocol.io, 2025-06-18): PKCE S256 obligatorio, `plain` prohibido (nov-2025), RFC 9728 PRM, RFC 8707 resource indicators, prohibido token passthrough → respalda H-2/H-4. mysql2+DO: CA cert + `rejectUnauthorized:true` (docs DigitalOcean). AES-256-GCM: IV 12 bytes único por mensaje, key-id para rotación → `crypto.ts` ya lo hace bien. Express 5 recomendado; multer <2.1.0 DoS. express-rate-limit: `ipKeyGenerator` para IPv6 + store Redis si multi-instancia. SSRF: defensa en capas, no blocklist.

### D. Bundle
Total ~255KB gzip (✅ 51% del target 500KB). recharts 108KB (42%) preload eager para 10 rutas, solo 2 lo usan → lazy-load = -108KB del initial. Todas las rutas con `lazy()`. DOMPurify 9.6KB lazy-able.
