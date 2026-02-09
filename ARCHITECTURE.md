# CamiaCasa ABM Application - Architecture & Tech Stack Recommendation

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Database Choice](#1-database-choice)
3. [Backend Hosting](#2-backend-hosting)
4. [Background Job Processing](#3-background-job-processing)
5. [Authentication](#4-authentication)
6. [Email Service](#5-email-service)
7. [File Upload & Processing](#6-file-upload--processing)
8. [Overall System Architecture](#7-overall-system-architecture)
9. [Database Schema Design](#8-database-schema-design)
10. [Data Flow Diagrams](#9-data-flow-diagrams)
11. [Cost Estimate](#10-cost-estimate)
12. [Implementation Phases](#11-implementation-phases)

---

## Executive Summary

**Recommended Stack:**

| Layer                  | Technology                        | Why                                                    |
|------------------------|-----------------------------------|--------------------------------------------------------|
| Frontend               | React + Vite (on Vercel)          | Fast builds, great DX, free hosting                    |
| Backend                | Node.js/Express (on Railway)      | Persistent server for background jobs + API            |
| Database               | Supabase (PostgreSQL)             | Free tier, Auth, Realtime, Storage, Row Level Security |
| Background Jobs        | Inngest                           | Serverless durable workflows, 50K free runs/month      |
| Auth                   | Supabase Auth                     | Already included, 50K MAU free, social providers       |
| Email Sending          | Resend                            | Modern API, React Email support, 3K emails/month free  |
| File Storage           | Supabase Storage                  | 1GB free, integrated with auth/RLS                     |
| Cache/Rate Limiting    | Upstash Redis                     | Serverless Redis, 500K commands/month free             |
| CSV/Excel Parsing      | PapaParse + ExcelJS               | Mature, well-maintained, streaming support             |

---

## 1. Database Choice

### The MySQL vs PostgreSQL Decision

You expressed a preference for MySQL. Here is the honest assessment:

#### MySQL Options Evaluated

| Option                | Status (Feb 2026)                              | Free Tier         | Verdict           |
|-----------------------|------------------------------------------------|--------------------|-------------------|
| **PlanetScale**       | Free tier removed April 2024. Minimum $39/mo   | None               | Too expensive      |
| **TiDB Cloud Starter**| Active, MySQL-compatible                       | 5GB row + 250M RUs | Viable but niche   |
| **Railway MySQL**     | Active, managed MySQL available                | 30-day trial only  | No real free tier  |

#### PostgreSQL Options Evaluated

| Option                | Status (Feb 2026)                              | Free Tier                    | Verdict                   |
|-----------------------|------------------------------------------------|------------------------------|---------------------------|
| **Supabase**          | Active, thriving ecosystem                     | 500MB DB, 50K auth, 1GB storage | Best overall value     |
| **Neon**              | Active (acquired by Databricks)                | 0.5GB storage, 100 CU-hours | Good but DB-only          |

### RECOMMENDATION: Supabase (PostgreSQL)

**Why not MySQL?**
- PlanetScale killed its free tier in April 2024 and now starts at $39/month.
- TiDB Cloud Starter is viable but has a much smaller ecosystem, fewer tutorials, and no built-in auth/storage/realtime.
- Railway MySQL has no free tier (30-day trial then $5/month minimum).

**Why Supabase wins decisively:**
- PostgreSQL is actually *better* for CRM/ABM workloads (superior JSONB support for flexible prospect metadata, better full-text search, stronger ACID compliance, ~1.6x faster on complex queries).
- You get an entire backend-as-a-service: Database + Auth + Realtime subscriptions + File Storage + Edge Functions + Row Level Security -- all free tier.
- 50,000 monthly active users on auth (more than enough).
- Auto-generated REST and GraphQL APIs via PostgREST.
- Massive community: tutorials, libraries, and integrations everywhere.
- The SQL syntax differences between MySQL and PostgreSQL are minimal for application development. If you know MySQL, you already know 95% of PostgreSQL.

**Key PostgreSQL features that benefit ABM specifically:**
- `JSONB` columns for storing flexible enrichment data, custom fields, and metadata without schema migrations.
- Full-text search with `tsvector` for searching across prospect/company records.
- `ARRAY` types for tags, labels, and multi-value fields.
- Materialized views for pre-computing scoring dashboards.
- Row Level Security (RLS) to ensure multi-tenant data isolation if you ever go SaaS.

> **Important caveat:** Supabase free tier pauses projects after 7 days of inactivity. For production, the Pro plan at $25/month is recommended. During development, the free tier is perfectly fine since you will be actively using it.

---

## 2. Backend Hosting

### Options Evaluated

| Platform                       | Persistent Server | Background Jobs | Free Tier  | Cold Starts | Price           |
|-------------------------------|-------------------|-----------------|------------|-------------|-----------------|
| **Vercel Serverless**          | No                | Limited         | Yes        | Yes         | Free - $20/mo   |
| **Railway**                    | Yes               | Yes             | Trial only | No          | $5/mo + usage   |
| **Render**                     | Yes               | Yes             | Limited    | Yes (free)  | Free - $7/mo    |
| **Fly.io**                     | Yes               | Yes             | Limited    | No          | Free allowance  |

### RECOMMENDATION: Hybrid Architecture

**Frontend:** Vercel (React app, free tier)
**Backend API:** Railway ($5/month)

**Why Railway for the backend:**
- Your ABM app needs a **persistent server** for: WebSocket connections (real-time campaign updates), long-running CSV processing, email sequence orchestration, and scraping jobs.
- Vercel serverless has a 10-second timeout on free tier (60s on Pro) which is insufficient for CSV imports with thousands of rows or scraping operations.
- Railway provides: Git-based deploys, built-in logging, easy environment variable management, zero cold starts, and the ability to run background processes.
- $5/month is the minimum cost, and usage credits cover modest workloads.
- Railway also hosts MySQL/PostgreSQL/Redis natively if you ever need collocated databases.

**Why NOT Vercel for the backend:**
- 10-second function timeout on Hobby (60s on Pro) is too short for data processing.
- No persistent process means you cannot run scheduled tasks natively.
- Cannot maintain WebSocket connections for real-time updates.
- Express.js on Vercel requires wrapping in serverless adapter patterns, losing middleware capabilities.

**Why NOT Render:**
- Free tier services spin down after 15 minutes of inactivity (50+ second cold starts).
- Paid plans start at $7/month per service (more expensive than Railway for equivalent workload).

**Why NOT Fly.io:**
- Complex pricing model requiring careful resource planning.
- More operational overhead with Docker/VM-based deployment.
- Better for globally distributed apps (not critical for ABM internal tool).

---

## 3. Background Job Processing

### This Is Critical for ABM

Your application needs background jobs for:
1. **Scheduled email sequences** - Send email step 2 three days after step 1, respecting time zones.
2. **CSV/Excel import processing** - Parse, validate, deduplicate, and import thousands of rows.
3. **Data enrichment pipelines** - Call APIs (Clearbit, Apollo, LinkedIn) to enrich prospect data.
4. **Web scraping** - Scrape company websites for intelligence.
5. **Lead scoring recalculation** - Recompute scores when new data arrives or engagement events occur.
6. **Campaign analytics aggregation** - Roll up email open/click/reply metrics.

### Options Evaluated

| Solution              | Type                | Free Tier            | Self-hosted? | Best For                        |
|-----------------------|---------------------|----------------------|--------------|----------------------------------|
| **BullMQ + Redis**    | Self-hosted queue   | Free (need Redis)    | Yes          | Full control, complex workflows  |
| **Inngest**           | Managed durable FX  | 50K runs/month       | OSS option   | Event-driven, step functions     |
| **Trigger.dev**       | Managed background  | $5/mo free usage     | OSS option   | Long-running tasks, AI pipelines |
| **QStash (Upstash)**  | Serverless queue    | 500 msgs/day         | No           | Simple HTTP-triggered jobs       |
| **Temporal**          | Workflow engine     | Self-host only       | Yes          | Enterprise, complex orchestration|

### RECOMMENDATION: Inngest (Primary) + BullMQ (Fallback Plan)

**Primary: Inngest**

Why Inngest is the best fit:
- **Event-driven model** maps perfectly to ABM workflows: "when prospect is imported" -> enrich -> score -> add to sequence.
- **Durable step functions** with automatic retries: if an enrichment API call fails, Inngest retries that specific step without re-running the entire pipeline.
- **Cron/scheduled functions** built-in for recurring tasks (daily score recalculation, sequence scheduling).
- **50,000 free function runs per month** is generous for an early-stage ABM tool.
- **Zero infrastructure** - no Redis, no workers, no queue management.
- **Works with Express.js** by adding a single serve endpoint.
- **Vercel Marketplace integration** if you ever move API routes to Vercel.
- **Built-in concurrency control** to avoid rate-limiting enrichment APIs.
- **Fan-out patterns** to process CSV rows in parallel.

**Example ABM workflow with Inngest:**
```typescript
// When a CSV is uploaded and parsed
inngest.createFunction(
  { id: "enrich-prospect", concurrency: { limit: 5 } },
  { event: "prospect/imported" },
  async ({ event, step }) => {
    // Step 1: Enrich company data
    const company = await step.run("enrich-company", async () => {
      return enrichCompanyData(event.data.domain);
    });

    // Step 2: Enrich contact data
    const contact = await step.run("enrich-contact", async () => {
      return enrichContactData(event.data.email);
    });

    // Step 3: Calculate lead score
    const score = await step.run("calculate-score", async () => {
      return calculateLeadScore(company, contact);
    });

    // Step 4: Auto-assign to campaign if score > threshold
    if (score > 70) {
      await step.run("assign-campaign", async () => {
        return addToCampaign(event.data.prospectId, score);
      });
    }
  }
);

// Scheduled email sequence step
inngest.createFunction(
  { id: "send-sequence-email" },
  { event: "sequence/step-due" },
  async ({ event, step }) => {
    const { prospectId, sequenceId, stepNumber } = event.data;

    // Step 1: Check if prospect has replied (skip if so)
    const hasReplied = await step.run("check-reply", async () => {
      return checkForReply(prospectId, sequenceId);
    });

    if (hasReplied) return { skipped: true, reason: "prospect replied" };

    // Step 2: Send the email
    await step.run("send-email", async () => {
      return sendSequenceEmail(prospectId, sequenceId, stepNumber);
    });

    // Step 3: Schedule next step (if exists)
    await step.run("schedule-next", async () => {
      return scheduleNextStep(prospectId, sequenceId, stepNumber + 1);
    });
  }
);
```

**Fallback Plan: BullMQ + Upstash Redis**

If Inngest's free tier becomes insufficient or you need more control:
- BullMQ is the most mature Node.js job queue.
- Use Upstash Redis (500K free commands/month) as the backing store.
- Requires running a worker process on Railway (already have a server).
- More operational overhead but zero vendor lock-in.

---

## 4. Authentication

### RECOMMENDATION: Supabase Auth

Since we are already using Supabase for the database, Supabase Auth is the obvious choice:

| Feature                  | Supabase Auth | Clerk        | Auth.js      |
|--------------------------|---------------|--------------|--------------|
| Free tier MAU            | 50,000        | 10,000       | Unlimited*   |
| Social providers         | Yes           | Yes          | Yes          |
| Email/Password           | Yes           | Yes          | Yes          |
| Magic links              | Yes           | Yes          | Manual       |
| MFA                      | Yes           | $100/mo add-on | Manual     |
| Pre-built UI components  | Yes           | Yes          | No           |
| Row Level Security       | Native        | No           | No           |
| Additional cost          | $0            | $0.02/MAU > 10K | $0       |
| Setup complexity         | Low           | Low          | Medium-High  |

*Auth.js is free but requires significant development time (40-80 hours for production-ready).

**Why Supabase Auth:**
- Already included with Supabase (zero additional services to manage).
- 50,000 MAU free tier is more than enough.
- Native Row Level Security integration means database queries are automatically scoped to the authenticated user.
- Provides JWT tokens that your Express backend can verify.
- Built-in email confirmation, password reset, and social login flows.
- `@supabase/auth-helpers-react` provides React hooks for the frontend.

**Architecture for auth flow:**
1. Frontend uses Supabase Auth UI/hooks for login/signup.
2. Supabase returns a JWT access token.
3. Frontend sends JWT in `Authorization: Bearer <token>` header to Express backend.
4. Express middleware verifies JWT using Supabase's public key.
5. Supabase RLS policies enforce data access at the database level.

---

## 5. Email Service

### RECOMMENDATION: Resend

| Service      | Free Tier        | Price After Free  | React Email Support | Deliverability |
|-------------|------------------|-------------------|---------------------|----------------|
| **Resend**   | 3,000/month      | $20/mo for 50K    | Native              | Excellent      |
| SendGrid     | 100/day          | $19.95/mo for 50K | No                  | Good           |
| Mailgun      | None (trial only) | $35/mo            | No                  | Good           |
| Amazon SES   | 62,000/mo (EC2)  | $0.10/1K          | No                  | Excellent      |

**Why Resend:**
- Built by the creator of React Email, meaning first-class support for building email templates with React components.
- 3,000 free emails per month is perfect for starting out.
- Modern, developer-friendly API.
- Webhook support for tracking opens, clicks, bounces, and complaints.
- DKIM, SPF, and DMARC support for high deliverability.
- Easy integration with Node.js/Express.

```typescript
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: 'outreach@yourdomain.com',
  to: prospect.email,
  subject: renderTemplate(sequence.subject, prospect),
  react: SequenceEmailTemplate({ prospect, step: currentStep }),
});
```

---

## 6. File Upload & Processing

### CSV/Excel Parsing Libraries

| Library        | Weekly Downloads | Best For              | Streaming | Excel Support |
|----------------|------------------|-----------------------|-----------|---------------|
| **PapaParse**  | 5.5M             | CSV parsing           | Yes       | No            |
| **ExcelJS**    | 3.3M             | Excel read/write      | Yes       | Yes           |
| **XLSX (SheetJS)** | 4.7M         | Universal spreadsheet | Partial   | Yes           |
| **csv-parse**  | 8.7M             | Server-side CSV       | Yes       | No            |

### RECOMMENDATION: PapaParse (CSV) + ExcelJS (Excel)

**Processing Pipeline:**
1. User uploads CSV/Excel file via React frontend.
2. File is stored in Supabase Storage (1GB free).
3. Express API endpoint receives upload notification.
4. Inngest function triggered: `file/uploaded` event.
5. Worker streams the file from Supabase Storage.
6. PapaParse (for CSV) or ExcelJS (for .xlsx) parses in streaming mode.
7. Each row is validated, normalized, and deduplicated.
8. Batch insert into `prospects` and `companies` tables.
9. Fan-out enrichment jobs for each new prospect.

```typescript
// Upload endpoint
app.post('/api/imports', authMiddleware, upload.single('file'), async (req, res) => {
  // 1. Upload to Supabase Storage
  const { data, error } = await supabase.storage
    .from('imports')
    .upload(`${req.user.id}/${Date.now()}_${req.file.originalname}`, req.file.buffer);

  // 2. Create import record
  const importRecord = await db.imports.create({
    userId: req.user.id,
    filePath: data.path,
    status: 'pending',
    fileName: req.file.originalname,
  });

  // 3. Trigger background processing
  await inngest.send({
    name: 'import/file-uploaded',
    data: { importId: importRecord.id, filePath: data.path, userId: req.user.id },
  });

  res.json({ importId: importRecord.id, status: 'processing' });
});
```

---

## 7. Overall System Architecture

```
+------------------------------------------------------------------+
|                        FRONTEND (Vercel)                          |
|                                                                    |
|   React + Vite + TailwindCSS + Shadcn/UI                         |
|   - Dashboard / Analytics                                         |
|   - Prospect Management                                           |
|   - Campaign Builder                                              |
|   - Email Sequence Editor                                         |
|   - CSV/Excel Import UI                                           |
|   - Settings & Configuration                                      |
|                                                                    |
|   Auth: @supabase/auth-helpers-react                              |
|   State: TanStack Query (React Query) for server state            |
|   Realtime: Supabase Realtime subscriptions                       |
+----------------------------------+-------------------------------+
                                   |
                    HTTPS (REST API + JWT Auth)
                                   |
+----------------------------------v-------------------------------+
|                     BACKEND API (Railway)                         |
|                                                                    |
|   Node.js + Express + TypeScript                                  |
|   - REST API endpoints (/api/prospects, /api/campaigns, etc.)     |
|   - Auth middleware (verify Supabase JWT)                          |
|   - File upload handling (Multer)                                 |
|   - Webhook receivers (Resend events, enrichment callbacks)       |
|   - Inngest serve endpoint (/api/inngest)                         |
|                                                                    |
|   ORM: Drizzle ORM (type-safe, PostgreSQL native)                 |
|   Validation: Zod                                                 |
+--------+-------------+----------------+-------------------------+
         |             |                |
         |             |                |
    +----v----+  +-----v------+  +------v------+
    |Supabase |  |  Inngest   |  |   Resend    |
    |         |  | (Managed)  |  | (Email API) |
    |PostgreSQL| |            |  +------+------+
    |Auth     |  | Durable    |         |
    |Storage  |  | Workflows: |         | Webhooks (open/click/bounce)
    |Realtime |  | - Enrich   |         |
    |         |  | - Score    |  +------v------+
    +----+----+  | - Sequence |  |   Upstash   |
         |       | - Scrape   |  |   Redis     |
         |       | - Import   |  | (Cache +    |
         |       +-----+------+  |  Rate Limit)|
         |             |         +-------------+
         |             |
    +----v-------------v----+
    |   External APIs       |
    |                       |
    | - Clearbit/Apollo     |
    |   (enrichment)        |
    | - OpenAI/Claude       |
    |   (AI scoring/copy)   |
    | - LinkedIn (scraping) |
    | - Hunter.io (email    |
    |   verification)       |
    +------------------------+
```

### Component Communication Summary

| From              | To                | Method                      | Purpose                                  |
|-------------------|-------------------|-----------------------------|------------------------------------------|
| Frontend          | Backend API       | REST over HTTPS             | CRUD operations, file uploads            |
| Frontend          | Supabase          | Supabase JS Client          | Auth, Realtime subscriptions             |
| Backend API       | Supabase DB       | Drizzle ORM / Supabase Client | Data persistence                       |
| Backend API       | Inngest           | Event emission              | Trigger background workflows             |
| Inngest           | Backend API       | HTTP invocation             | Execute workflow steps                   |
| Inngest           | Supabase DB       | Direct connection           | Read/write during workflows              |
| Inngest           | Resend            | REST API                    | Send emails in sequences                 |
| Inngest           | External APIs     | REST API                    | Enrichment, AI, verification             |
| Resend            | Backend API       | Webhooks                    | Email event tracking                     |
| Backend API       | Upstash Redis     | REST / Redis protocol       | Caching, rate limiting, session store    |

---

## 8. Database Schema Design

### Entity Relationship Overview

```
users (Supabase Auth)
  |
  +-- workspaces (multi-tenant support)
        |
        +-- prospects ----+---- companies
        |                 |
        +-- campaigns     +---- prospect_tags
        |     |
        |     +-- campaign_prospects (junction)
        |
        +-- email_sequences
        |     |
        |     +-- sequence_steps
        |     |
        |     +-- sequence_enrollments
        |           |
        |           +-- sequence_events (sends, opens, clicks, replies)
        |
        +-- imports
        |     |
        |     +-- import_rows
        |
        +-- scoring_rules
        |
        +-- prospect_scores
        |
        +-- prospect_activities (unified activity log)
        |
        +-- enrichment_data
```

### Detailed Table Definitions

```sql
-- ============================================
-- CORE TABLES
-- ============================================

-- Workspaces (multi-tenant isolation)
CREATE TABLE workspaces (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    owner_id        UUID NOT NULL REFERENCES auth.users(id),
    settings        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Workspace members
CREATE TABLE workspace_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES auth.users(id),
    role            VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workspace_id, user_id)
);

-- ============================================
-- COMPANIES & PROSPECTS
-- ============================================

-- Companies (Accounts in ABM terminology)
CREATE TABLE companies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    domain          VARCHAR(255),
    industry        VARCHAR(100),
    employee_count  VARCHAR(50),        -- Range like "51-200"
    annual_revenue  VARCHAR(50),        -- Range like "$10M-$50M"
    city            VARCHAR(100),
    state           VARCHAR(100),
    country         VARCHAR(100),
    website_url     TEXT,
    linkedin_url    TEXT,
    description     TEXT,
    technologies    TEXT[],             -- PostgreSQL array for tech stack
    enrichment_data JSONB DEFAULT '{}', -- Flexible enrichment data
    tier            VARCHAR(10) DEFAULT 'C' CHECK (tier IN ('A', 'B', 'C', 'D')),
    account_score   INTEGER DEFAULT 0,
    is_target       BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workspace_id, domain)
);

-- Prospects (Contacts/Leads)
CREATE TABLE prospects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    company_id      UUID REFERENCES companies(id) ON DELETE SET NULL,
    email           VARCHAR(255) NOT NULL,
    first_name      VARCHAR(100),
    last_name       VARCHAR(100),
    title           VARCHAR(200),       -- Job title
    seniority       VARCHAR(50),        -- C-Level, VP, Director, Manager, etc.
    department      VARCHAR(100),       -- Engineering, Marketing, Sales, etc.
    phone           VARCHAR(50),
    linkedin_url    TEXT,
    city            VARCHAR(100),
    state           VARCHAR(100),
    country         VARCHAR(100),
    timezone        VARCHAR(50),
    email_verified  BOOLEAN DEFAULT false,
    email_status    VARCHAR(20) DEFAULT 'unknown' CHECK (email_status IN ('valid', 'invalid', 'catch-all', 'unknown')),
    status          VARCHAR(20) DEFAULT 'new' CHECK (status IN ('new', 'enriched', 'qualified', 'contacted', 'replied', 'meeting', 'converted', 'unsubscribed', 'bounced')),
    lead_score      INTEGER DEFAULT 0,
    custom_fields   JSONB DEFAULT '{}', -- Flexible custom data
    enrichment_data JSONB DEFAULT '{}', -- Raw enrichment API responses
    tags            TEXT[],             -- PostgreSQL array for tags
    source          VARCHAR(50),        -- csv_import, manual, api, linkedin, etc.
    source_detail   VARCHAR(255),       -- e.g., import file name
    last_contacted  TIMESTAMPTZ,
    last_replied    TIMESTAMPTZ,
    do_not_contact  BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workspace_id, email)
);

-- Tags (for flexible categorization)
CREATE TABLE tags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    color           VARCHAR(7),         -- Hex color code
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workspace_id, name)
);

-- ============================================
-- CAMPAIGNS
-- ============================================

-- Campaigns (ABM campaign containers)
CREATE TABLE campaigns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    campaign_type   VARCHAR(30) DEFAULT 'outbound' CHECK (campaign_type IN ('outbound', 'inbound', 'nurture', 'reactivation', 'event')),
    status          VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
    target_criteria JSONB DEFAULT '{}', -- ICP criteria for this campaign
    start_date      DATE,
    end_date        DATE,
    created_by      UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Campaign-Prospect junction (which prospects are in which campaigns)
CREATE TABLE campaign_prospects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    prospect_id     UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    status          VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'removed')),
    added_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(campaign_id, prospect_id)
);

-- ============================================
-- EMAIL SEQUENCES
-- ============================================

-- Email Sequences (multi-step email campaigns)
CREATE TABLE email_sequences (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    campaign_id     UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    status          VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
    from_name       VARCHAR(100),
    from_email      VARCHAR(255),
    reply_to        VARCHAR(255),
    send_window     JSONB DEFAULT '{"days": [1,2,3,4,5], "start_hour": 9, "end_hour": 17, "timezone": "America/New_York"}',
    settings        JSONB DEFAULT '{"stop_on_reply": true, "stop_on_bounce": true, "daily_limit": 50}',
    created_by      UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Sequence Steps (individual emails in a sequence)
CREATE TABLE sequence_steps (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id     UUID NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
    step_number     INTEGER NOT NULL,
    step_type       VARCHAR(20) DEFAULT 'email' CHECK (step_type IN ('email', 'wait', 'condition', 'task')),
    subject         TEXT,               -- Email subject (supports {{variables}})
    body_html       TEXT,               -- Email body HTML (supports {{variables}})
    body_text       TEXT,               -- Plain text version
    delay_days      INTEGER DEFAULT 0,  -- Days to wait after previous step
    delay_hours     INTEGER DEFAULT 0,  -- Additional hours to wait
    ab_variant      CHAR(1),            -- NULL = no A/B test, 'A' or 'B'
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(sequence_id, step_number)
);

-- Sequence Enrollments (a prospect enrolled in a sequence)
CREATE TABLE sequence_enrollments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id     UUID NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
    prospect_id     UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    current_step    INTEGER DEFAULT 0,
    status          VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'replied', 'bounced', 'unsubscribed', 'removed')),
    enrolled_at     TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    next_send_at    TIMESTAMPTZ,        -- When the next step should fire
    metadata        JSONB DEFAULT '{}',
    UNIQUE(sequence_id, prospect_id)
);

-- Email Events (granular tracking of every email interaction)
CREATE TABLE email_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    enrollment_id   UUID REFERENCES sequence_enrollments(id) ON DELETE SET NULL,
    prospect_id     UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    sequence_id     UUID REFERENCES email_sequences(id) ON DELETE SET NULL,
    step_id         UUID REFERENCES sequence_steps(id) ON DELETE SET NULL,
    event_type      VARCHAR(20) NOT NULL CHECK (event_type IN ('sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'complaint', 'unsubscribed')),
    resend_email_id VARCHAR(100),       -- Resend's email ID for tracking
    subject         TEXT,
    link_clicked    TEXT,               -- If event_type = 'clicked'
    user_agent      TEXT,
    ip_address      INET,
    metadata        JSONB DEFAULT '{}',
    occurred_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SCORING
-- ============================================

-- Scoring Rules (configurable scoring model)
CREATE TABLE scoring_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    category        VARCHAR(30) NOT NULL CHECK (category IN ('demographic', 'firmographic', 'behavioral', 'engagement')),
    field           VARCHAR(100) NOT NULL,   -- e.g., 'title', 'company.industry', 'email_opened'
    operator        VARCHAR(20) NOT NULL,    -- 'equals', 'contains', 'greater_than', 'in', etc.
    value           JSONB NOT NULL,          -- The value(s) to match
    points          INTEGER NOT NULL,        -- Points to add (can be negative)
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Prospect Score History (track score changes over time)
CREATE TABLE prospect_score_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prospect_id     UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    score           INTEGER NOT NULL,
    score_breakdown JSONB DEFAULT '{}',      -- Which rules contributed what points
    calculated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- IMPORTS
-- ============================================

-- Import Jobs
CREATE TABLE imports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    file_name       VARCHAR(255) NOT NULL,
    file_path       TEXT NOT NULL,            -- Path in Supabase Storage
    file_size       INTEGER,
    status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'mapping', 'importing', 'completed', 'failed')),
    total_rows      INTEGER DEFAULT 0,
    processed_rows  INTEGER DEFAULT 0,
    imported_rows   INTEGER DEFAULT 0,
    skipped_rows    INTEGER DEFAULT 0,
    error_rows      INTEGER DEFAULT 0,
    column_mapping  JSONB DEFAULT '{}',      -- User-defined column mapping
    default_tags    TEXT[],                   -- Tags to apply to all imported rows
    errors          JSONB DEFAULT '[]',      -- Array of row-level errors
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_by      UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Import Rows (individual rows from an import, for review/debugging)
CREATE TABLE import_rows (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id       UUID NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    row_number      INTEGER NOT NULL,
    raw_data        JSONB NOT NULL,          -- Original row data
    mapped_data     JSONB,                   -- Data after column mapping
    status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'imported', 'duplicate', 'invalid', 'error')),
    prospect_id     UUID REFERENCES prospects(id),  -- If successfully imported
    error_message   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ACTIVITY LOG
-- ============================================

-- Unified Activity/Event Log (all prospect interactions)
CREATE TABLE prospect_activities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    prospect_id     UUID NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
    activity_type   VARCHAR(30) NOT NULL,    -- 'email_sent', 'email_opened', 'note_added', 'score_changed', 'status_changed', 'enriched', 'imported', etc.
    title           VARCHAR(255),
    description     TEXT,
    metadata        JSONB DEFAULT '{}',
    performed_by    UUID REFERENCES auth.users(id),  -- NULL if system/automated
    occurred_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES (Critical for ABM query patterns)
-- ============================================

-- Prospect lookups
CREATE INDEX idx_prospects_workspace ON prospects(workspace_id);
CREATE INDEX idx_prospects_company ON prospects(company_id);
CREATE INDEX idx_prospects_email ON prospects(email);
CREATE INDEX idx_prospects_status ON prospects(workspace_id, status);
CREATE INDEX idx_prospects_score ON prospects(workspace_id, lead_score DESC);
CREATE INDEX idx_prospects_tags ON prospects USING GIN(tags);
CREATE INDEX idx_prospects_custom_fields ON prospects USING GIN(custom_fields);
CREATE INDEX idx_prospects_source ON prospects(workspace_id, source);

-- Company lookups
CREATE INDEX idx_companies_workspace ON companies(workspace_id);
CREATE INDEX idx_companies_domain ON companies(domain);
CREATE INDEX idx_companies_tier ON companies(workspace_id, tier);
CREATE INDEX idx_companies_technologies ON companies USING GIN(technologies);

-- Campaign/Sequence performance
CREATE INDEX idx_email_events_prospect ON email_events(prospect_id, occurred_at DESC);
CREATE INDEX idx_email_events_sequence ON email_events(sequence_id, event_type);
CREATE INDEX idx_email_events_type ON email_events(workspace_id, event_type, occurred_at DESC);

-- Sequence scheduling (critical for sending emails on time)
CREATE INDEX idx_enrollments_next_send ON sequence_enrollments(next_send_at)
    WHERE status = 'active' AND next_send_at IS NOT NULL;

-- Activity timeline
CREATE INDEX idx_activities_prospect ON prospect_activities(prospect_id, occurred_at DESC);
CREATE INDEX idx_activities_workspace ON prospect_activities(workspace_id, occurred_at DESC);

-- Full-text search on prospects
CREATE INDEX idx_prospects_search ON prospects
    USING GIN(to_tsvector('english', coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(title, '')));

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_sequences ENABLE ROW LEVEL SECURITY;

-- Example RLS policy: users can only see data in their workspaces
CREATE POLICY workspace_member_access ON prospects
    FOR ALL
    USING (
        workspace_id IN (
            SELECT workspace_id FROM workspace_members
            WHERE user_id = auth.uid()
        )
    );

-- Repeat similar policies for all workspace-scoped tables
```

---

## 9. Data Flow Diagrams

### Flow 1: CSV Upload -> Enrichment -> Scoring -> Campaign Assignment

```
User uploads CSV
       |
       v
[Frontend] --POST /api/imports--> [Express API]
       |                              |
       |                    Upload to Supabase Storage
       |                    Create import record (status: pending)
       |                    Emit Inngest event: "import/file-uploaded"
       |                              |
       v                              v
[UI shows "Processing..."]     [Inngest: process-import]
  (Realtime subscription)             |
                              Step 1: Download file from Storage
                              Step 2: Parse with PapaParse/ExcelJS
                              Step 3: Return column headers to user
                                      (update import status: mapping)
                                        |
                        User maps columns in UI
                        POST /api/imports/:id/mapping
                                        |
                              Emit "import/mapping-confirmed"
                                        |
                              [Inngest: import-rows]
                              Step 4: For each row:
                                - Validate data
                                - Deduplicate (by email)
                                - Create/update prospect
                                - Create/update company (by domain)
                                - Emit "prospect/imported" per row
                                        |
                              [Inngest: enrich-prospect]  (fan-out, concurrency: 5)
                              Step 5: Call enrichment APIs
                                - Company data (Clearbit/Apollo)
                                - Email verification (Hunter.io)
                                - LinkedIn data (if available)
                              Step 6: Update prospect & company records
                              Step 7: Emit "prospect/enriched"
                                        |
                              [Inngest: calculate-score]
                              Step 8: Load scoring rules
                              Step 9: Evaluate each rule against prospect
                              Step 10: Compute total score
                              Step 11: Save score + breakdown
                              Step 12: If score > threshold, emit "prospect/qualified"
                                        |
                              [Inngest: auto-assign-campaign] (optional)
                              Step 13: Match prospect to campaign criteria
                              Step 14: Add to campaign_prospects
                              Step 15: Enroll in email sequence
```

### Flow 2: Email Sequence Execution

```
[Inngest CRON: every 5 minutes]
  "sequence/check-due-sends"
           |
           v
  Query: SELECT * FROM sequence_enrollments
         WHERE status = 'active'
         AND next_send_at <= NOW()
           |
           v
  For each due enrollment:
    Emit "sequence/step-due" event
           |
           v
  [Inngest: send-sequence-step]
    Step 1: Load prospect, sequence, step data
    Step 2: Check if prospect replied (skip if so)
    Step 3: Check if within send window (defer if not)
    Step 4: Render email template with prospect variables
    Step 5: Send via Resend API
    Step 6: Record email_event (type: 'sent')
    Step 7: Update enrollment (current_step++, next_send_at)
    Step 8: Log prospect_activity
           |
           v
  [Resend Webhook: email events]
    POST /api/webhooks/resend
           |
           v
  [Express API]
    - Parse webhook payload
    - Record email_event (opened/clicked/bounced)
    - If replied: update enrollment status, prospect status
    - If bounced: update enrollment status, prospect email_status
    - Emit "email/event-received" for further processing
```

### Flow 3: Lead Scoring Pipeline

```
  Trigger: Any of:
    - "prospect/enriched"
    - "email/event-received" (opened, clicked, replied)
    - "scoring-rules/updated"
    - CRON: daily full recalculation
           |
           v
  [Inngest: recalculate-score]
    Step 1: Load prospect with company data
    Step 2: Load active scoring rules for workspace
    Step 3: Evaluate DEMOGRAPHIC rules:
            - Title contains "VP" or "Director" -> +20
            - Seniority = "C-Level" -> +30
            - Department matches target -> +15
    Step 4: Evaluate FIRMOGRAPHIC rules:
            - Company size 51-500 -> +20
            - Industry matches target -> +25
            - Uses target technology -> +15
    Step 5: Evaluate BEHAVIORAL rules:
            - Opened email -> +5 per open
            - Clicked link -> +10 per click
            - Replied -> +30
            - Meeting booked -> +50
    Step 6: Evaluate ENGAGEMENT rules:
            - Last interaction < 7 days -> +10
            - Last interaction > 30 days -> -10
    Step 7: Sum all points -> total score
    Step 8: Update prospect.lead_score
    Step 9: Insert prospect_score_history record
    Step 10: If score crossed tier threshold, update company.tier
    Step 11: Log prospect_activity (score_changed)
```

---

## 10. Cost Estimate

### Phase 1: Development & MVP (Months 1-3)

| Service            | Tier             | Monthly Cost |
|--------------------|------------------|-------------|
| Vercel (Frontend)  | Hobby (Free)     | $0          |
| Railway (Backend)  | Hobby            | $5          |
| Supabase           | Free             | $0          |
| Inngest            | Free (50K runs)  | $0          |
| Resend             | Free (3K emails) | $0          |
| Upstash Redis      | Free             | $0          |
| **Total**          |                  | **$5/mo**   |

### Phase 2: Production Launch (Months 4-8)

| Service            | Tier             | Monthly Cost |
|--------------------|------------------|-------------|
| Vercel (Frontend)  | Pro              | $20         |
| Railway (Backend)  | Pro              | $5 + ~$10 usage |
| Supabase           | Pro              | $25         |
| Inngest            | Free/Starter     | $0-$25      |
| Resend             | Pro (50K emails) | $20         |
| Upstash Redis      | Pay-as-you-go    | $0-$5       |
| Domain + DNS       |                  | ~$15/year   |
| **Total**          |                  | **$75-$100/mo** |

### Phase 3: Growth (Months 9+)

| Service            | Tier             | Monthly Cost  |
|--------------------|------------------|--------------|
| Vercel (Frontend)  | Pro              | $20          |
| Railway (Backend)  | Pro              | $5 + ~$30    |
| Supabase           | Pro              | $25-$75      |
| Inngest            | Starter/Pro      | $25-$150     |
| Resend             | Scale (100K)     | $90          |
| Upstash Redis      | Pay-as-you-go    | $5-$20       |
| Enrichment APIs    | Various          | $50-$200     |
| **Total**          |                  | **$220-$565/mo** |

---

## 11. Implementation Phases

### Phase 1: Foundation (Weeks 1-4)
- [ ] Set up monorepo (Turborepo recommended: `apps/web`, `apps/api`, `packages/shared`)
- [ ] Initialize React + Vite + TailwindCSS + Shadcn/UI frontend
- [ ] Initialize Express + TypeScript + Drizzle ORM backend
- [ ] Set up Supabase project (database, auth, storage)
- [ ] Implement authentication flow (signup, login, workspace creation)
- [ ] Deploy frontend to Vercel, backend to Railway
- [ ] Basic CRUD for prospects and companies

### Phase 2: Data Import & Enrichment (Weeks 5-8)
- [ ] CSV/Excel upload and parsing pipeline
- [ ] Column mapping UI
- [ ] Deduplication logic
- [ ] Inngest integration for background processing
- [ ] Enrichment API integrations (start with one: e.g., Clearbit)
- [ ] Email verification integration

### Phase 3: Scoring & Campaigns (Weeks 9-12)
- [ ] Scoring rules engine (CRUD + evaluation)
- [ ] Automatic score calculation on data changes
- [ ] Campaign management (CRUD, prospect assignment)
- [ ] Campaign analytics dashboard

### Phase 4: Email Sequences (Weeks 13-16)
- [ ] Email sequence builder UI
- [ ] Template editor with variable support
- [ ] Resend integration for sending
- [ ] Webhook handling for email events
- [ ] Sequence scheduling and execution engine
- [ ] Reply detection and auto-pause

### Phase 5: Analytics & Polish (Weeks 17-20)
- [ ] Dashboard with key ABM metrics
- [ ] Prospect activity timeline
- [ ] Campaign performance analytics
- [ ] A/B testing for email sequences
- [ ] Export functionality
- [ ] Settings and configuration pages

---

## Key Technology Versions (as of February 2026)

| Technology          | Recommended Version |
|---------------------|-------------------|
| Node.js             | 22 LTS            |
| React               | 19.x              |
| TypeScript          | 5.7+              |
| Vite                | 6.x               |
| Express             | 5.x               |
| Drizzle ORM         | 0.38+             |
| TanStack Query      | 5.x               |
| TailwindCSS         | 4.x               |
| Shadcn/UI           | Latest             |
| Zod                 | 3.x               |

---

## Summary of Final Recommendations

| Decision Point          | Recommendation            | Runner-Up              |
|------------------------|---------------------------|------------------------|
| **Database**            | Supabase (PostgreSQL)     | TiDB Cloud Starter (MySQL) |
| **Backend Hosting**     | Railway                   | Render                 |
| **Background Jobs**     | Inngest                   | BullMQ + Upstash Redis |
| **Authentication**      | Supabase Auth             | Clerk                  |
| **Email Service**       | Resend                    | Amazon SES             |
| **File Storage**        | Supabase Storage          | Cloudflare R2          |
| **Cache/Rate Limiting** | Upstash Redis             | In-memory (dev only)   |
| **ORM**                 | Drizzle ORM               | Prisma                 |
| **Frontend UI Library** | Shadcn/UI + TailwindCSS   | MUI                    |
| **CSV Parsing**         | PapaParse                 | csv-parse              |
| **Excel Parsing**       | ExcelJS                   | SheetJS (XLSX)         |
| **State Management**    | TanStack Query            | Zustand + React Query  |
| **Validation**          | Zod                       | Yup                    |

This architecture gives you a production-ready ABM platform starting at just **$5/month** during development, scaling gracefully to handle thousands of prospects and millions of emails as you grow.
