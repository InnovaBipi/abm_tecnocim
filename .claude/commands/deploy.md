---
name: deploy
description: Deploy the ABM platform to DigitalOcean with pre-flight checks
arguments:
  - name: target
    description: "Deployment target: staging or production (default: production)"
    required: false
user_facing: true
---

# Deploy Command

Run pre-flight checks and deploy to DigitalOcean App Platform.

## Steps

1. **Pre-flight checks**:
   - `git status` — must be clean
   - `cd client && npm run build` — client builds without errors
   - `cd server && npm run build` — server builds without errors
   - Verify on correct branch (main for production)
   - Check no `.env` files staged

2. **Deploy**:
   - For auto-deploy: just push to main (`git push origin main`)
   - For manual: `doctl apps create-deployment <app-id>`

3. **Post-deploy verification**:
   - Wait for build completion
   - `curl <api-url>/api/health` — verify healthy response
   - Report deployment status
