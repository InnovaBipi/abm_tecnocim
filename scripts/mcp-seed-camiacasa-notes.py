"""Seed the CamiaCasa tenant MCP operational notes (Phase E) and verify they ride the initialize.
Usage: python scripts/mcp-seed-camiacasa-notes.py
"""
import json
import subprocess

URL = "https://abm.tecnociminnova.com/api/mcp"
TOKEN = open("C:/Users/user/tmp_auth_cc.txt", encoding="utf-8").read().strip()

NOTES = """Guardarrailes operativos CamiaCasa (actualizado 2026-08-10):
1. NO activar campanas ni aprobar/adelantar envios antes del 2026-09-01. La cola (~802 emails) esta programada desde el 1-sep con warmup; el 6-ago una aprobacion prematura envio 37 emails por error.
2. Firma SIEMPRE "Alfons Marques / CamiaCasa" — "Marques" sin acento.
3. Respuestas negativas o bajas: rechazar follow-ups pendientes (emails_reject) Y avisar de que el cierre (do_not_contact + suppression list) debe completarse en la plataforma — no existe tool MCP para eso.
4. NUNCA hacer cold email a Alemania ni Austria (UWG exige opt-in).
5. NUNCA contactar vgpparks.eu ni despina-im.com (cliente buy-side y su intermediario).
6. Envios solo lunes-viernes (bloqueo weekend en 4 capas); no intentar puentearlo."""


def rpc(method, params, rpc_id):
    payload = json.dumps({"jsonrpc": "2.0", "id": rpc_id, "method": method, "params": params})
    out = subprocess.run(
        ["curl", "-sS", "--ssl-no-revoke", "-X", "POST", URL,
         "-H", f"Authorization: Bearer {TOKEN}",
         "-H", "Content-Type: application/json",
         "-H", "Accept: application/json, text/event-stream",
         "--data-binary", "@-"],
        input=payload.encode("utf-8"), capture_output=True, check=True)
    return json.loads(out.stdout.decode("utf-8"))


r = rpc("tools/call", {"name": "settings_set_mcp_notes", "arguments": {"instructions": NOTES}}, 1)
body = json.loads(r["result"]["content"][0]["text"])
print("set_mcp_notes:", {k: body[k] for k in ("updated", "cleared") if k in body} or body)

r2 = rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
                        "clientInfo": {"name": "seed-verify", "version": "1.0"}}, 2)
instr = r2["result"]["instructions"]
ok = "Guardarrailes operativos CamiaCasa" in instr and "2026-09-01" in instr
print("initialize carries tenant notes:", ok)
print("--- instructions tail ---")
print(instr[-400:])
