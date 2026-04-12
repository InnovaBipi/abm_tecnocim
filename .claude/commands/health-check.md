---
name: health-check
description: Run health checks on the ABM platform (local or production)
arguments:
  - name: target
    description: "Target: local or prod (default: local)"
    required: false
user_facing: true
---

# Health Check Command

Verify the ABM platform is running correctly.

## Checks Performed

1. **API Health**: `GET /api/health` — basic server status
2. **Database**: Connection test (included in health response)
3. **Environment**:
   - Required env vars set
   - JWT_SECRET not default
   - API keys configured (Gemini, Perplexity, Firecrawl, Resend)
4. **Build Status**:
   - Client builds without errors
   - Server builds without errors
5. **Endpoints** (smoke test):
   - `GET /api/health` — 200
   - `POST /api/auth/login` with invalid creds — 401 (not 500)

## Targets

- **local**: `http://localhost:3001` (dev server)
- **prod**: Production URL from `.env` or `FRONTEND_URL`
