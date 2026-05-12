---
name: add-user
description: Create a new user for a tenant via the API
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

Create a new user for the current tenant via the production API.

## Steps

1. Use `mcp__claude-in-chrome__tabs_context_mcp` to find the ABM platform tab.

2. Ask the user (via AskUserQuestion) for:
   - Role: admin, manager, member, or viewer (default: member)
   - Password: or generate a random secure one (12 chars, mixed)
   - Sender email: the email address this user will send campaigns from (optional)
   - Sender name: the display name for sent emails (optional, defaults to full name)

3. Parse the full name argument into first_name + last_name (split on first space).

4. Execute via browser JS:

```javascript
(async () => {
  const token = localStorage.getItem('token');
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: '<EMAIL>',
      password: '<PASSWORD>',
      first_name: '<FIRST>',
      last_name: '<LAST>',
      role: '<ROLE>',
      sender_email: '<SENDER_EMAIL>',
      sender_name: '<SENDER_NAME>'
    })
  }).then(r => r.json());
  return JSON.stringify(res, null, 2);
})();
```

5. Report to the user:
   - Created user: name, email, role
   - Login credentials: email + password
   - Sender config: sender_email + sender_name
   - Remind: the user can change their password from Settings > Profile after first login
