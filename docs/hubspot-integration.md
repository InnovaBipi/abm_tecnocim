# Respuestas ABM → HubSpot + reenvío a la bandeja del comercial

Tarea Asana "[HUBSPOT] - API amb ABM". Alcance: cuando un prospecto responde a un
email de ABM, **(a)** la respuesta se reenvía por email a una persona (Tecnocim:
Robert Belmonte) y **(b)** el prospecto entra en HubSpot como lead.

## Dónde vive

| Pieza | Fichero |
|-------|---------|
| Enganche único (IMAP + registro manual) | `server/src/services/replies.ts` → `recordReply()` llama a `routeReply()` al final |
| Orquestador (decide, reenvía, sincroniza, registra, nunca lanza) | `server/src/services/replyRouter.ts` |
| Cliente HubSpot (fetch, timeout 10 s, 1 reintento, sin SDK) | `server/src/services/hubspot.ts` |
| Config por tenant | `TenantConfig.hubspot` y `TenantConfig.reply_forward` en `server/src/middleware/tenant.ts` |
| Endpoints admin | `GET/POST /api/settings/hubspot`, `POST /api/settings/hubspot/test`, `GET/POST /api/settings/reply-forward` (`server/src/routes/settings.ts`) |
| UI | Configuración → pestaña **Claves API** (`client/src/pages/Settings.tsx`), solo admin |
| Migración | `database/migration-023-hubspot-reply-forward.sql` (copiada en `server/database/`) |
| Backfill | `scripts/hubspot-backfill-replies.js` (dry-run por defecto, `--apply` para ejecutar) |
| Tests | `server/src/services/replyRouter.test.ts`, `hubspot.test.ts`, `replies.test.ts` |

## Qué pasa con cada clasificación

El clasificador (Gemini, `classifyReply`) etiqueta cada respuesta. El router aplica:

| Clasificación | Reenvío email | Lead HubSpot | Por qué |
|---------------|:---:|:---:|-----|
| `positive` | sí | sí | |
| `other` (sin cuerpo / no clasificable) | sí (salvo `only_positive`) | sí | Un humano respondió; en ABM ya cuenta como `replied` |
| `negative` | sí (salvo `only_positive`) | **no** | El clasificador confunde respuestas comprometidas con rechazos (ver `PATCH /api/replies/:id`); Robert debe verlo, HubSpot no |
| `out_of_office` | solo con `forward_out_of_office` | **no** | |
| `unsubscribe` | **nunca** | **nunca** | RGPD/LSSI |

Rebotes no pasan por aquí (son eventos `bounced` del webhook Resend, no `replied`).

## Config del tenant (`tenants.config`)

```jsonc
"hubspot": {
  "mode": "form",                 // 'form' | 'crm'
  "enabled": true,                // false = pausar sin borrar la config
  "portal_id": "145850079",       // form
  "form_guid": "9c812eca-b6fb-4c2e-b2c9-5623008cfc0c", // form
  "access_token": "enc:v1:...",   // crm — cifrado con SECRETS_ENCRYPTION_KEY (nunca en SQL a mano)
  "owner_id": "34489913",         // crm — hubspot_owner_id del lead (Robert)
  "create_company": true,         // crm — upsert empresa por dominio + asociación
  "api_base": ""                  // crm — "https://api-eu1.hubapi.com" solo si el portal es EU data-residency
},
"reply_forward": {
  "to": ["Robert.Belmonte@tecnocim.com"],
  "only_positive": false,
  "forward_out_of_office": false
}
```

Se edita desde la UI (admin) o con los endpoints. El SQL de ejemplo para Tecnocim
está comentado al final de la migración 023.

## Modo `form` (funciona hoy, sin token) — puente provisional

`POST https://api.hsforms.com/submissions/v3/integration/submit/{portal}/{formGuid}`
con **los mismos nombres de campo que el formulario de contacto de la web**
(`tecnocim-landing/app/api/hubspot/route.ts`): contacto `email, firstname, lastname,
phone, company, message` + empresa (`0-2`) `name, necesidad`. `context.pageUri` es la
ficha del prospecto en ABM; `message` lleva campaña, paso, clasificación y la
respuesta íntegra.

Ventaja: HubSpot crea/actualiza el contacto y **dispara los workflows que ya existen
sobre ese formulario** (notificación a Teams, asignación). Limitaciones:

- HubSpot no devuelve el id del contacto → `prospects.hubspot_contact_id` queda NULL.
- No se puede fijar `hs_lead_status`, propietario ni crear empresa/nota: lo que haga el
  workflow del formulario. El lead aparece en HubSpot como "envío de formulario", no
  como "respuesta ABM"; el texto de `message`/`necesidad` (prefijo `[ABM]`/`ABM ·`) es
  la forma de filtrarlos.
- `legalConsentOptions`: se envía `consent.consentToProcess=true` con un texto que
  declara interés legítimo B2B (igual que hace la web). `legitimateInterest` exigiría
  un `subscriptionTypeId` del portal que no conocemos.
- Sin cookie `hutk` (no hay navegador): no enlaza con historial web anónimo.
- El formulario tiene rate limits generosos pero es un canal pensado para humanos: no
  lanzar el backfill de cientos de respuestas antiguas sin `--since`.

## Modo `crm` (preferido) — Private App token

Scopes mínimos de la Private App:

| Scope | Para |
|-------|------|
| `crm.objects.contacts.read` | comprobación de token (`/hubspot/test`) |
| `crm.objects.contacts.write` | crear/actualizar contacto y **notas** (las notas van con este scope) |
| `crm.objects.companies.read` | buscar empresa por dominio (`/companies/search`) |
| `crm.objects.companies.write` | crear/actualizar empresa y asociarla |
| `crm.schemas.contacts.read` (opcional) | detectar si existe la propiedad custom `abm_source` |

Flujo por respuesta positiva/other:

1. `POST /crm/v3/objects/contacts` con `email, firstname, lastname, phone, company,
   jobtitle, lifecyclestage=lead, hs_lead_status=NEW, hubspot_owner_id`. Si HubSpot
   devuelve 409 "Existing ID: n" → `PATCH /contacts/n` **sin** `lifecyclestage` (nunca
   degradamos un cliente a lead). Guarda `prospects.hubspot_contact_id`.
2. Empresa (si `create_company`): dominio = `companies.domain` → `website_url` → dominio
   del email (se salta gmail/hotmail/etc.). Busca por `domain`; crea o actualiza; guarda
   `companies.hubspot_company_id`; asociación por defecto contacto→empresa (v4).
3. Nota en el timeline del contacto con campaña, paso, clasificación, asunto y respuesta
   íntegra, propietario = `owner_id`.
4. Origen: HubSpot no permite escribir `hs_analytics_source*`. Si el portal define una
   propiedad de contacto **`abm_source`** (crearla a mano en HubSpot: texto de una
   línea) se rellena con `ABM · {campaña}`; si no existe, el origen va solo en la nota.
   No se inventan otros nombres de propiedad.

Fallos en empresa o nota son *best effort*: el contacto cuenta como sincronizado.

### Pasar de `form` a `crm`

1. HubSpot → Settings → Integrations → Private Apps → crear app con los scopes de arriba.
   Copiar el token (`pat-eu1-...` o `pat-na1-...`).
2. En ABM (admin): Configuración → Claves API → HubSpot: modo **CRM**, pegar token,
   `owner_id` 34489913, guardar. O bien:
   `POST /api/settings/hubspot {"mode":"crm","access_token":"pat-...","owner_id":"34489913"}`.
   El token se guarda cifrado (`SECRETS_ENCRYPTION_KEY`; sin ella queda en claro — ver
   auditoría C-2).
3. **Probar conexión** (`POST /api/settings/hubspot/test`): 401 = token malo, 403 =
   faltan scopes.
4. Si el portal es de residencia de datos EU (`app-eu1.hubspot.com` y el token empieza
   por `pat-eu1-`), poner `api_base: https://api-eu1.hubapi.com`. El portal 145850079
   funciona hoy con `api.hubapi.com` desde la web, así que por defecto no hace falta.
5. Opcional: `node scripts/hubspot-backfill-replies.js --since=YYYY-MM-DD --apply` para
   subir a HubSpot respuestas anteriores (idempotente por evento).

El token actual en `tecnocim-landing/.env.local` devuelve 403 incluso en lectura:
está caducado/revocado o sin scopes. **No sirve** y no se ha copiado a este repo.

## Reenvío a la bandeja humana

Email vía el remitente Resend del tenant (`config.email.from_*`), `Reply-To` = email
del prospecto (Robert puede contestar directamente). Asunto
`[ABM] Resposta de {nombre} ({empresa})`. Cuerpo: clasificación, respuesta original
íntegra (escapada), ficha (nombre, cargo, empresa, email, teléfono, LinkedIn), campaña
y paso (último `generated_emails` enviado al prospecto), enlace `PUBLIC_URL|FRONTEND_URL/prospects/{id}`.

Nota: `sendEmail()` añade el pie RGPD y cabeceras `List-Unsubscribe` a todo lo que
sale por Resend, incluido este aviso interno. Es inocuo (Robert no va a darse de baja)
pero si molesta, hay que añadir una variante sin pie a `email.ts`.

## Trazabilidad e idempotencia

Cada acción deja una fila en `hubspot_sync_log` (`tenant_id, prospect_id, event_id,
mode, action, status ok|error|skipped, hubspot_id, error`). Acciones:
`forward_email`, `form_submit`, `contact_upsert`, `company_upsert`, `note_create`
(y `hubspot` con `skipped` cuando la clasificación no aplica).

El router **salta** cualquier acción que ya tenga una fila `ok` para ese `event_id`, así
que reprocesar (backfill, reintentos) no duplica emails ni leads.

```sql
-- Últimos fallos
SELECT created_at, action, mode, status, error FROM hubspot_sync_log
WHERE tenant_id = 'tenant-tecnocim-0003' AND status = 'error'
ORDER BY created_at DESC LIMIT 20;
```

## Garantía de no-rotura

`routeReply()` nunca lanza (captura todo, `console.error` + fila `error`). Además,
`recordReply()` lo envuelve en `try/catch`. Si HubSpot o Resend caen, la respuesta se
sigue detectando, el prospecto pasa a `replied` y los follow-ups se cancelan igual.

Coste: `POST /api/replies` y el ciclo IMAP esperan a HubSpot/Resend (timeout 10 s por
llamada, 1 reintento). Si se convierte en problema, pasar el enganche a fire-and-forget
(quitar el `await` en `replies.ts`), perdiendo `result.routing` en la respuesta.

## Activación en producción (Tecnocim)

1. Deploy (la migración 023 se aplica sola al arrancar).
2. Config del tenant: UI (Claves API) o el `UPDATE tenants ... JSON_SET(...)` comentado
   en la migración (`mode: form`, portal, form GUID, `reply_forward.to` = Robert).
3. Probar con `POST /api/replies` sobre un prospecto de prueba
   (`{"prospect_email":"...","classification":"positive","snippet":"prueba"}`) y comprobar
   el email a Robert + el contacto en HubSpot + `hubspot_sync_log`.
4. Cuando llegue el token con scopes: pasar a `crm` (sección anterior).
