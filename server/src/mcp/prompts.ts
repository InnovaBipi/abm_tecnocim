import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { query } from '../config/database';
import { getMadridDateString } from '../services/scheduling';
import { McpAuth } from './context';

/**
 * Same TS2589 workaround as tools/readonly.ts `reg`: the SDK generic over-instantiates on some
 * zod arg shapes. Runtime behaviour (zod validation, prompts/list, prompts/get) is unaffected.
 */
function regPrompt(
  server: McpServer,
  name: string,
  config: { title?: string; description?: string; argsSchema?: Record<string, unknown> },
  cb: (args: any, extra: any) => any
): void {
  (server.registerPrompt as any)(name, config, cb);
}

/** Build the standard single-user-message prompt result. */
function promptResult(text: string, description?: string) {
  return {
    description,
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Phase D server-side workflow prompts. Each prompt queries the tenant's live data at
 * invocation time so the instructions the client model receives carry REAL ids/counts,
 * not placeholders — argument mistakes surface here, before any tool is called.
 * All queries are scoped to auth.tenantId.
 */
export function registerPrompts(server: McpServer, auth: McpAuth): void {
  const t = auth.tenantId;

  // ─────────────────────────── campana_360 ───────────────────────────
  regPrompt(server,
    'campana_360',
    {
      title: 'Campaña 360',
      description:
        'Informe 360 de una campaña (o del tenant entero si no se indica campaign_id): pipeline, métricas de engagement, respuestas y acciones recomendadas. Solo lectura.',
      argsSchema: {
        campaign_id: z.string().optional().describe('UUID de la campaña. Vacío = visión global del tenant.'),
      },
    },
    async ({ campaign_id }: { campaign_id?: string }) => {
      let scopeBlock: string;
      if (campaign_id) {
        const rows = await query<any[]>(
          "SELECT id, name, status, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date FROM campaigns WHERE id = ? AND tenant_id = ?",
          [campaign_id, t]
        );
        if (!rows.length) {
          return promptResult(
            `La campaña ${campaign_id} no existe en este tenant. Llama a campaigns_list para ver las campañas disponibles y pide al usuario que elija una.`
          );
        }
        const c = rows[0];
        scopeBlock = `Campaña objetivo: "${c.name}" (id ${c.id}, estado ${c.status}, start_date ${c.start_date || 'sin definir'}).`;
      } else {
        const [counts] = await query<any[]>(
          "SELECT COUNT(*) AS total, SUM(status = 'active') AS active, SUM(status = 'paused') AS paused FROM campaigns WHERE tenant_id = ?",
          [t]
        );
        scopeBlock = `Sin campaign_id: visión global del tenant (${counts.total} campañas: ${counts.active || 0} activas, ${counts.paused || 0} pausadas).`;
      }
      return promptResult(
        `Prepara un informe 360 de prospección usando SOLO las tools MCP de esta conexión (no inventes datos).

${scopeBlock}

Pasos:
1. Llama a dashboard_stats para el contexto global del tenant.
${campaign_id
  ? `2. Llama a campaign_get y campaign_metrics con campaign_id=${campaign_id}.
3. Llama a generated_emails_list con campaign_id=${campaign_id} filtrando por status (draft, scheduled, sent) para dimensionar el pipeline. No pidas include_body.`
  : `2. Llama a campaigns_list (status=active y status=paused) y elige las 3-5 campañas con más actividad.
3. Para cada una, llama a campaign_metrics.`}
4. Llama a replies_list (since = últimos 14 días) y resume las respuestas por clasificación.

Entrega en castellano:
- Tabla de pipeline por estado (draft/scheduled/sent/bounced) y fechas de la cola programada.
- Tasas (open/click/reply/bounce) comparadas con benchmarks B2B 2026 (open 35-45%, reply 2-5%, bounce <3%).
- Respuestas pendientes de triaje con clasificación y snippet.
- 3-5 acciones recomendadas priorizadas.

Reglas: este informe es SOLO LECTURA — no cambies estados de campaña, no apruebes ni programes nada. Si detectas algo urgente (bounce alto, replies sin triar), recomiéndalo, no lo ejecutes.`,
        'Informe 360 de campaña'
      );
    }
  );

  // ──────────────────────── programar_borradores ────────────────────────
  regPrompt(server,
    'programar_borradores',
    {
      title: 'Programar borradores para fecha',
      description:
        'Programa TODOS los borradores de una campaña distribuidos con warmup desde una fecha de inicio, con verificación previa y posterior. No activa la campaña.',
      argsSchema: {
        campaign_id: z.string().describe('UUID de la campaña.'),
        start_date: z.string().describe('Fecha de inicio de la cola (YYYY-MM-DD).'),
      },
    },
    async ({ campaign_id, start_date }: { campaign_id: string; start_date: string }) => {
      if (!DATE_RE.test(start_date || '')) {
        return promptResult(
          `start_date "${start_date}" no es válida (formato YYYY-MM-DD). Pide al usuario la fecha correcta antes de continuar.`
        );
      }
      const rows = await query<any[]>(
        "SELECT id, name, status, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date FROM campaigns WHERE id = ? AND tenant_id = ?",
        [campaign_id, t]
      );
      if (!rows.length) {
        return promptResult(
          `La campaña ${campaign_id} no existe en este tenant. Llama a campaigns_list y confirma el id con el usuario.`
        );
      }
      const cam = rows[0];
      const [drafts] = await query<any[]>(
        "SELECT COUNT(*) AS c FROM generated_emails WHERE campaign_id = ? AND tenant_id = ? AND status = 'draft'",
        [campaign_id, t]
      );
      const today = getMadridDateString();
      const warnings: string[] = [];
      if (start_date < today) warnings.push(`start_date ${start_date} es ANTERIOR a hoy (${today}) — confirma con el usuario antes de programar.`);
      const camStart = cam.start_date || null;
      if (camStart && start_date < camStart) {
        warnings.push(`start_date ${start_date} es anterior a la start_date de la campaña (${camStart}). NO programes antes de esa fecha sin confirmación explícita del usuario.`);
      }
      if (!drafts.c) {
        return promptResult(
          `La campaña "${cam.name}" (${campaign_id}) no tiene borradores (0 drafts). Nada que programar. Verifica con generated_emails_list si esperabas drafts, o genera primero la secuencia.`
        );
      }
      return promptResult(
        `Programa los borradores de la campaña "${cam.name}" (id ${campaign_id}, estado ${cam.status}) para que la cola arranque el ${start_date}. Hay ${drafts.c} emails en draft.
${warnings.length ? `\n⚠️ AVISOS:\n${warnings.map((w) => `- ${w}`).join('\n')}\n` : ''}
Pasos:
1. Verificación previa: llama a generated_emails_list (campaign_id=${campaign_id}, status=draft, limit=10) y revisa una muestra: sin variables sin resolver ({{...}}, "Unknown", "Batch"), asuntos correctos, sin nombres de campaña filtrados. Si la muestra falla, PARA y repórtalo.
2. Llama a campaign_schedule_drafts con campaign_id=${campaign_id} y start_date=${start_date}. La distribución respeta días laborables y el límite de warmup del tenant.
3. Verificación posterior: reporta el "distribution" devuelto (emails por día) y confirma con generated_emails_list (status=scheduled) que el total coincide con ${drafts.c}.

Reglas:
- Esta operación NO activa la campaña: los emails no salen hasta que la campaña esté en estado active. NO llames a campaign_set_status salvo que el usuario lo pida explícitamente.
- Si campaign_schedule_drafts devuelve error o un count distinto de ${drafts.c}, repórtalo con el detalle — no reintentes a ciegas.
- Entrega el resumen final en castellano: total programado, límite diario aplicado y tabla fecha → nº emails.`,
        `Programar ${drafts.c} borradores desde ${start_date}`
      );
    }
  );

  // ───────────────────────── barrido_respuestas ─────────────────────────
  regPrompt(server,
    'barrido_respuestas',
    {
      title: 'Barrido de respuestas',
      description:
        'Triaje de las respuestas detectadas desde una fecha: clasifica, propone acción por playbook (positiva/negativa/OOO/baja) y prepara borradores de contestación. No envía nada.',
      argsSchema: {
        since: z.string().optional().describe('Fecha inicial YYYY-MM-DD (por defecto, últimos 7 días).'),
      },
    },
    async ({ since }: { since?: string }) => {
      let from = since;
      if (from && !DATE_RE.test(from)) {
        return promptResult(`since "${from}" no es válida (YYYY-MM-DD). Pide la fecha correcta al usuario.`);
      }
      if (!from) {
        from = getMadridDateString(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
      }
      const [count] = await query<any[]>(
        "SELECT COUNT(*) AS c FROM email_events WHERE tenant_id = ? AND event_type = 'replied' AND occurred_at >= ?",
        [t, from]
      );
      return promptResult(
        `Haz un barrido de las respuestas recibidas desde el ${from}. Hay ${count.c} respuestas registradas en ese rango.

Pasos:
1. Llama a replies_list con since=${from} (sube limit si hace falta hasta cubrir las ${count.c}).
2. Clasifica cada respuesta (usa la clasificación IA si existe; verifícala contra el snippet):
   - **positive**: redacta un borrador de contestación breve y profesional en el idioma del prospect. NO lo envíes — entrégalo como texto.
   - **negative / unsubscribe**: propone cierre: cancelar follow-ups pendientes de ese prospect (localízalos con generated_emails_list y usa emails_reject sobre los scheduled/draft de ese prospect) y reporta que hay que marcar do_not_contact + suppression manualmente (no hay tool MCP para eso todavía).
   - **out_of_office**: extrae la fecha de vuelta si aparece y propón re-programar sus follow-ups con email_update (scheduled_for posterior a la vuelta). No canceles nada.
   - **other/dudosa**: márcala para revisión humana con el snippet completo.
3. Antes de ejecutar cualquier emails_reject o email_update, presenta la tabla de triaje completa y las acciones propuestas, y ESPERA confirmación del usuario.

Entrega en castellano: tabla (prospect, empresa, clasificación, snippet, acción propuesta) + borradores de contestación para las positivas.

Reglas: NUNCA envíes emails ni actives campañas desde este flujo. Las bajas requieren cierre manual en plataforma — dilo explícitamente en el informe.`,
        `Triaje de ${count.c} respuestas desde ${from}`
      );
    }
  );
}
