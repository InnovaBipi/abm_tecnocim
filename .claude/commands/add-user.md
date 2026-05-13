---
name: add-user
description: Create a new user for a tenant via the API using curl (no browser needed)
arguments:
  - name: email
    description: "User email address"
    required: true
  - name: name
    description: "Full name (e.g., 'Maria Garcia')"
    required: true
user_facing: true
---

# Add User Command

Create a new user for the current tenant via curl API calls.

**Skill reference**: Follow `.claude/skills/api-automation/SKILL.md` for all API calls.

## Steps

1. **Authenticate via curl**:

```bash
BASE="${ABM_BASE_URL:-https://abm.tecnociminnova.com}"
SLUG="${ABM_TENANT_SLUG:-tecnocim}"
```

If `ABM_EMAIL` or `ABM_PASSWORD` are not set, ask the user via AskUserQuestion.

```bash
TOKEN=$(curl -s -X POST "${BASE}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${ABM_EMAIL}\",\"password\":\"${ABM_PASSWORD}\",\"tenant_slug\":\"${SLUG}\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);process.stdout.write(r.data?.token||'')}catch(e){}})")
```

2. **Ask the user** (via AskUserQuestion) for:
   - Role: admin, manager, member, or viewer (default: member)
   - Password: or generate a random secure one (12 chars, mixed case + numbers + symbols)
   - Sender email: the email address this user will send campaigns from (optional)
   - Sender name: the display name for sent emails (optional, defaults to full name)

3. **Parse the full name** argument into first_name + last_name (split on first space).

4. **Create user via curl**:

```bash
RESULT=$(curl -s -X POST "${BASE}/api/users" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$ARGUMENTS.email\",
    \"password\": \"${PASSWORD}\",
    \"first_name\": \"${FIRST_NAME}\",
    \"last_name\": \"${LAST_NAME}\",
    \"role\": \"${ROLE}\",
    \"sender_email\": \"${SENDER_EMAIL}\",
    \"sender_name\": \"${SENDER_NAME}\"
  }")
echo "$RESULT"
```

5. **Report** to the user:
   - Created user: name, email, role
   - Login credentials: email + password
   - Sender config: sender_email + sender_name (if provided)
   - Remind: the user can change their password from Settings > Profile after first login
