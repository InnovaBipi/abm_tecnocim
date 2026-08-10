#!/bin/sh
# E2E smoke test for Phase D MCP prompts against production.
# Usage: sh scripts/mcp-prompts-e2e.sh  (token read from C:/Users/user/tmp_auth_cc.txt)
TOKEN=$(tr -d '\r\n' < C:/Users/user/tmp_auth_cc.txt)
URL=https://abm.tecnociminnova.com/api/mcp
H1="Authorization: Bearer $TOKEN"
H2="Content-Type: application/json"
H3="Accept: application/json, text/event-stream"

echo "== prompts/list =="
curl -sS --ssl-no-revoke -X POST "$URL" -H "$H1" -H "$H2" -H "$H3" \
  -d '{"jsonrpc":"2.0","id":1,"method":"prompts/list","params":{}}'
echo
echo "== prompts/get campana_360 (global) =="
curl -sS --ssl-no-revoke -X POST "$URL" -H "$H1" -H "$H2" -H "$H3" \
  -d '{"jsonrpc":"2.0","id":2,"method":"prompts/get","params":{"name":"campana_360","arguments":{}}}'
echo
echo "== prompts/get programar_borradores (fecha invalida — debe devolver mensaje de validacion) =="
curl -sS --ssl-no-revoke -X POST "$URL" -H "$H1" -H "$H2" -H "$H3" \
  -d '{"jsonrpc":"2.0","id":3,"method":"prompts/get","params":{"name":"programar_borradores","arguments":{"campaign_id":"527ae0d1-431f-4eb4-8b1d-c1f84aeb3d95","start_date":"01/09/2026"}}}'
echo
echo "== prompts/get barrido_respuestas (default 7 dias) =="
curl -sS --ssl-no-revoke -X POST "$URL" -H "$H1" -H "$H2" -H "$H3" \
  -d '{"jsonrpc":"2.0","id":4,"method":"prompts/get","params":{"name":"barrido_respuestas","arguments":{}}}'
echo
