# ABM Tecnocim - Deployment Guide

## Architecture

```
[Client SPA]  →  DO App Platform Static Site  ─┐
[API Server]  →  DO App Platform Web Service   ├→  abm.tecnociminnova.com
[MySQL 8]     →  DO Managed Database           ─┘  (private networking)
```

Both frontend and backend are on the **same DigitalOcean app**, served under the same domain.
- Frontend: `/` (static site)
- Backend: `/api/*` (web service)

## Prerequisites

- `doctl` CLI authenticated: `doctl auth init`
- GitHub repo: `InnovaBipi/abm_tecnocim`
- DNS access for `tecnociminnova.com`

## Initial Setup

### 1. Create the App

```bash
doctl apps create --spec .do/app.yaml
```

Or create manually via DigitalOcean Dashboard:
1. Go to App Platform → Create App
2. Connect GitHub repo `InnovaBipi/abm_tecnocim`
3. Configure components as per `.do/app.yaml`

### 2. Set Secret Environment Variables

In DO Dashboard → App → Settings → Components → api → Environment Variables:

| Variable | Value |
|----------|-------|
| `JWT_SECRET` | Generate with: `openssl rand -hex 32` |
| `GEMINI_API_KEY` | Your Gemini API key |
| `PERPLEXITY_API_KEY` | Your Perplexity API key |
| `FIRECRAWL_API_KEY` | Your Firecrawl API key |
| `RESEND_API_KEY` | Your Resend API key |
| `RESEND_WEBHOOK_SECRET` | Your Resend webhook secret |
| `FRONTEND_URL` | `https://abm.tecnociminnova.com` |

### 3. Initialize Database

Get connection details:
```bash
doctl databases connection <db-id>
```

Run migrations:
```bash
mysql -h <host> -P 25060 -u doadmin -p --ssl-mode=REQUIRED < database/schema.sql
mysql -h <host> -P 25060 -u doadmin -p --ssl-mode=REQUIRED < database/migration-001-multitenancy.sql
mysql -h <host> -P 25060 -u doadmin -p --ssl-mode=REQUIRED < database/migration-002-tenant-tecnocim.sql
```

### 4. Configure Domain

In DO Dashboard → App → Settings → Domains → Add Domain:
- Add `abm.tecnociminnova.com`

Then configure DNS (in your DNS provider for `tecnociminnova.com`):
```
abm.tecnociminnova.com   CNAME  →  <DO app URL provided by DO>
```

SSL is automatic via Let's Encrypt.

### 5. Set Admin Password

Connect to the database and update the admin user password:
```sql
-- Generate a bcrypt hash for your desired password
-- Then update:
UPDATE users SET password = '<bcrypt_hash>'
WHERE email = 'albert.sanchez@tecnocim.com'
AND tenant_id = 'tenant-tecnocim-0003';
```

## Deploying Updates

Push to `main` triggers auto-deploy:
```bash
git push origin main
```

Monitor deployment:
```bash
doctl apps list-deployments <app-id>
```

## Health Check

```bash
curl https://abm.tecnociminnova.com/api/health
# Expected: { "success": true, "data": { "status": "healthy", ... } }
```

## Rollback

```bash
# List deployments
doctl apps list-deployments <app-id>

# Rollback to specific deployment
doctl apps create-deployment <app-id> --force-rebuild
```

## Useful Commands

```bash
# View app details
doctl apps get <app-id>

# View logs
doctl apps logs <app-id> --type=run
doctl apps logs <app-id> --type=build

# List databases
doctl databases list

# Database connection info
doctl databases connection <db-id>
```
