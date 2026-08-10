#!/bin/sh
# E2E smoke test for emails_bulk_insert in prod. VALIDATION-ONLY calls: nothing is inserted.
# Usage: sh scripts/mcp-bulk-insert-e2e.sh
TOKEN=$(tr -d '\r\n' < C:/Users/user/tmp_auth_cc.txt)
URL=https://abm.tecnociminnova.com/api/mcp
H1="Authorization: Bearer $TOKEN"
H2="Content-Type: application/json"
H3="Accept: application/json, text/event-stream"

echo "== tools/list (expect emails_bulk_insert present) =="
curl -sS --ssl-no-revoke -X POST "$URL" -H "$H1" -H "$H2" -H "$H3" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | python -c "import json,sys; r=json.load(sys.stdin); names=[t['name'] for t in r['result']['tools']]; print(len(names),'tools'); print('emails_bulk_insert' if 'emails_bulk_insert' in names else 'MISSING emails_bulk_insert')"

echo "== fake campaign -> must be 'Campaign not found' =="
curl -sS --ssl-no-revoke -X POST "$URL" -H "$H1" -H "$H2" -H "$H3" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"emails_bulk_insert","arguments":{"campaign_id":"00000000-0000-0000-0000-000000000000","emails":[{"prospect_id":"x","subject":"s","body_html":"<p>b</p>"}]}}}'
echo

echo "== real campaign (Mandatos) + fake prospect -> must be 'Unknown prospect_ids ... Nothing inserted' =="
curl -sS --ssl-no-revoke -X POST "$URL" -H "$H1" -H "$H2" -H "$H3" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"emails_bulk_insert","arguments":{"campaign_id":"527ae0d1-431f-4eb4-8b1d-c1f84aeb3d95","emails":[{"prospect_id":"11111111-2222-3333-4444-555555555555","subject":"s","body_html":"<p>b</p>"}]}}}'
echo
