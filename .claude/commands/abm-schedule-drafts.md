# /abm-schedule-drafts


**Piloto Fase D**: primer comando que orquesta sobre las **tools MCP nativas** del servidor embebido (`mcp__abm-camiacasa__*`) en vez de curl contra la REST API. Sustituye el flujo frágil de schedule-drafts (cientos de PUT / ECONNRESET / token caducado en mitad del batch).

Programa TODOS los borradores de una campaña distribuidos con warmup desde una fecha, con verificación previa (QA de muestra) y posterior (conteo + distribución). **No activa la campaña.**

## Usage

```bash
/abm-schedule-drafts <campaign> <start_date>
```

| Parámetro | Formato | Ejemplo |
|-----------|---------|---------|
| `campaign` | UUID o nombre parcial de campaña | `527ae0d1-...` o `"Mandatos"` |
| `start_date` | `YYYY-MM-DD` (la cola no arranca antes de ese día) | `2026-09-01` |

## Prerrequisito: tools MCP cargadas

Comprueba que `mcp__abm-camiacasa__campaigns_list` está disponible (ToolSearch si está deferred).

**Si NO están cargadas: PARA.** No caigas a curl — ese fallback silencioso es exactamente lo que este comando elimina. Informa al usuario:
1. Verificar que el conector está registrado **bajo este proyecto** (scope local es por-directorio): `claude mcp list` desde `C:\Users\user\proyectos\abm_tecnocim`.
2. Si falta o el JWT caducó (7 días — token en `C:/Users/user/tmp_auth_cc.txt`): re-login CamiaCasa y `claude mcp add --transport http --scope local abm-camiacasa https://abm.tecnociminnova.com/api/mcp --header "Authorization: Bearer <JWT>"`.
3. Reiniciar la sesión de Claude Code (las tools solo cargan al arrancar).

## Pasos

1. **Resolver campaña**: si `campaign` no es UUID, `campaigns_list` con `search=<campaign>`. Si hay 0 o >1 coincidencias, muestra las opciones y pide elegir. Con UUID, `campaign_get` para confirmar nombre/estado.
2. **Guardarraíles de fecha** (parar y confirmar con el usuario si falla alguno):
   - `start_date` no puede ser pasada.
   - Si la campaña tiene `start_date` propia, no programar antes de ella.
   - Vigente hasta fin de agosto 2026: campañas CamiaCasa pausadas — nada que pueda enviar antes del **2026-09-01** (ver memoria `incident_camiacasa_premature_approval`).
3. **QA de muestra**: `generated_emails_list` (`campaign_id`, `status=draft`, `limit=10`, `include_body=true`). Revisar: sin `{{variables}}` sin resolver, sin "Unknown"/"Batch", sin nombres de campaña filtrados, firma "Alfons Marques" sin acento. Si falla la muestra, PARA y reporta — no programes emails defectuosos.
4. **Programar**: `campaign_schedule_drafts` con `{campaign_id, start_date}`. Una sola llamada server-side: distribuye a límite de warmup, salta weekends, marca approved_by.
5. **Verificar**: comparar `count` devuelto con el nº de drafts del paso 1 (`emails_by_status.draft` de `campaign_get`). Si difieren, reportar el detalle sin reintentar a ciegas. Confirmar con `generated_emails_list` (`status=scheduled`, `limit=5`) que `scheduled_for` arranca en `start_date` (o el lunes siguiente si cae en weekend).

## Salida

Resumen en castellano: campaña, total programado, límite diario aplicado, tabla `fecha → nº emails` (el campo `distribution` de la respuesta), y recordatorio explícito: **la campaña NO se ha activado** — los emails no salen hasta que esté `active`.

## Reglas

- NUNCA llamar a `campaign_set_status` desde este comando, ni siquiera si la campaña está en draft/paused — activar es decisión explícita del usuario.
- Alternativa server-side pura: el MCP prompt `programar_borradores` (mismo flujo, invocable desde Claude.ai/ChatGPT).
