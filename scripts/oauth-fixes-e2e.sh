#!/bin/sh
# E2E verification of the OAuth security fixes (H-1, H-4) in production.
# Read-only probing: does not mutate anything.
BASE=https://abm.tecnociminnova.com
CC_TOKEN=$(tr -d '\r\n' < C:/Users/user/tmp_auth_cc.txt)

echo "== H-4: static REST JWT (no aud) still works on REST /api/prospects =="
curl -sS --ssl-no-revoke -o /dev/null -w "  HTTP %{http_code} (expect 200)\n" \
  "$BASE/api/prospects?limit=1" -H "Authorization: Bearer $CC_TOKEN"

echo "== H-4: static REST JWT still works on MCP (initialize) =="
curl -sS --ssl-no-revoke -X POST "$BASE/api/mcp" \
  -H "Authorization: Bearer $CC_TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"e2e","version":"1"}}}' \
  | python -c "import json,sys; r=json.load(sys.stdin); print('  MCP initialize OK:', r.get('result',{}).get('serverInfo',{}).get('name'))"

echo "== H-4: forge an aud:'mcp' token with the SAME secret is NOT possible (no secret locally) =="
echo "  (audience rejection is covered by unit tests; here we only confirm live surfaces are intact)"

echo "== H-1: /oauth/login rate limit — 12 rapid POSTs, expect a 429 to appear =="
codes=""
i=1
while [ $i -le 12 ]; do
  c=$(curl -sS --ssl-no-revoke -o /dev/null -w "%{http_code}" -X POST "$BASE/oauth/login" \
      -H "Content-Type: application/x-www-form-urlencoded" \
      --data "email=nobody@example.com&password=wrong&client_id=x&redirect_uri=https://x&code_challenge=y")
  codes="$codes $c"
  i=$((i+1))
done
echo "  status codes:$codes"
echo "$codes" | grep -q 429 && echo "  -> 429 present: rate limit ACTIVE" || echo "  -> NO 429: rate limit NOT active (check deploy)"
