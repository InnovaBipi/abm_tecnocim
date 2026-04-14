---
name: abm-user-journey
description: User journey map for ABM Platform - defines the workflow, KPIs per page, and user goals at each step
triggers: ["journey", "workflow", "user flow", "KPI", "objective", "goal", "what should", "user story"]
---

# ABM User Journey

## Core Workflow

```
┌─────────┐    ┌──────────┐    ┌─────────┐    ┌──────────┐
│ IMPORTAR │───▶│ ENRIQUECER│───▶│ PUNTUAR │───▶│ CAMPAÑA  │
│ CSV/Excel│    │ AI Research│   │ Auto-score│   │ Crear    │
└─────────┘    └──────────┘    └─────────┘    └────┬─────┘
                                                    │
┌─────────┐    ┌──────────┐    ┌─────────┐    ┌────▼─────┐
│OPTIMIZAR│◀───│MONITORIZAR│◀───│ ENVIAR  │◀───│ GENERAR  │
│ Ajustar │    │ Dashboard │    │ Warm-up │    │ AI Emails│
└─────────┘    └──────────┘    └─────────┘    └──────────┘
                                    ▲
                               ┌────┴─────┐
                               │ REVISAR  │
                               │ Outbox   │
                               └──────────┘
```

## Page-by-Page Goals

### Dashboard (/)
**User goal**: "Saber cómo va todo de un vistazo"
- KPIs: emails sent today, open rate, reply rate, bounce rate
- Quick actions: importar, crear campaña, revisar outbox
- Alertas: warm-up progress, bounces altos, replies sin responder
- Hot prospects: quién ha interactuado en las últimas 48h

### Prospects (/prospects)
**User goal**: "Gestionar mi base de contactos"
- KPIs: total, enriched %, avg score, new this week
- Actions: search, filter, bulk select, enrich, add to campaign, export
- Key insight: score badge visible para priorizar outreach

### Prospect Detail (/prospects/:id)
**User goal**: "Entender quién es este contacto y cómo abordarlo"
- Info: datos de contacto, empresa, cargo, LinkedIn
- Enrichment: análisis AI, use cases sugeridos, pain points
- Activity: timeline de interacciones (emails sent/opened/replied)
- Score: breakdown por categoría con reglas aplicadas

### Companies (/companies)
**User goal**: "Ver mis cuentas target y su estado"
- KPIs: total accounts, tier distribution, avg score
- View: cards con tier, industry, prospect count
- Detail: prospects asociados, campaigns, enrichment

### Campaigns (/campaigns)
**User goal**: "Gestionar mis campañas de outreach"
- KPIs: active campaigns, emails generated, approval rate
- Cards: status, progress (sent/total), reply rate
- Create: definir servicio, descripción, target

### Campaign Detail (/campaigns/:id)
**User goal**: "Configurar y monitorizar una campaña específica"
- Prospects: añadir/quitar prospects
- Emails: generar secuencia AI, revisar, aprobar
- Analytics: performance por step (open/click/reply)
- Sequence: visualizar flujo de emails

### Outbox (/outbox)
**User goal**: "Revisar y aprobar emails antes de enviar"
- KPIs: pending review, scheduled, sent today
- Actions: preview, approve, reject, bulk approve, force send
- Preview: ver email renderizado como lo recibirá el prospect

### Imports (/imports)
**User goal**: "Subir mis listas de contactos"
- Wizard: upload → map columns → check duplicates → import
- Feedback: progress bar, summary, post-import actions
- History: imports anteriores con resultados

### Settings (/settings)
**User goal**: "Configurar mi cuenta y plataforma"
- Profile: nombre, email, password
- Email: SMTP/IMAP config, from address
- Scoring: reglas de puntuación customizables
- API: keys para servicios externos

## User Personas

### Albert (Admin / Consultor)
- Configura scoring rules para el sector
- Importa listas de prospects potenciales
- Revisa y aprueba emails generados por IA
- Monitoriza métricas de campañas
- **Pain point**: quiere que la IA genere buenos emails sin tener que editarlos mucho

### Equipo Comercial (futuro)
- Ve solo sus prospects asignados
- Hace follow-up manual a replies
- Reporta resultados de meetings
- **Pain point**: necesita saber quién ha respondido y qué dijo
