"""Seed a tenant's MCP operational notes (Phase E) and verify they ride the initialize.

Usage: python scripts/mcp-seed-tenant-notes.py <camiacasa|tecnocim|technova|treemg>
Password read from env ABM_PASSWORD (same for all tenant admin users).
Caches the JWT to C:/Users/user/tmp_auth_<tenant>.txt for connector reuse.
"""
import json
import os
import subprocess
import sys

BASE = "https://abm.tecnociminnova.com"
URL = f"{BASE}/api/mcp"

TENANTS = {
    "camiacasa": "alfons.marques@camiacasa.cat",
    "tecnocim": "alfons.marques@tecnocim.com",
    "technova": "alfons.marques@technovapartners.com",
    "treemg": "alfons.marques@treemg.com",
}

NOTES = {
    "camiacasa": """Guardarrailes operativos CamiaCasa (actualizado 2026-08-10):
1. NO activar campanas ni aprobar/adelantar envios antes del 2026-09-01. La cola (~802 emails) esta programada desde el 1-sep con warmup; el 6-ago una aprobacion prematura envio 37 emails por error.
2. Firma SIEMPRE "Alfons Marques / CamiaCasa" — "Marques" sin acento.
3. Respuestas negativas o bajas: rechazar follow-ups pendientes (emails_reject) Y avisar de que el cierre (do_not_contact + suppression list) debe completarse en la plataforma — no existe tool MCP para eso.
4. NUNCA hacer cold email a Alemania ni Austria (UWG exige opt-in).
5. NUNCA contactar vgpparks.eu ni despina-im.com (cliente buy-side y su intermediario).
6. Envios solo lunes-viernes (bloqueo weekend en 4 capas); no intentar puentearlo.""",

    "tecnocim": """Guardarrailes operativos Tecnocim Innova (actualizado 2026-08-10):
1. Nombre oficial "Tecnocim Innova"; firma "Alfons Marques / Tecnocim Innova" — Marques SIN acento. URL publica SIEMPRE tecnociminnova.com/ca.
2. Warmup 50/dia. Envios solo lunes-viernes (bloqueo weekend); nunca forzar envios saltando el warmup.
3. DETECCION DE RESPUESTAS CAIDA: el IMAP de Office365 no funciona (Microsoft deshabilito basic auth). replies_list NO es fuente completa — los barridos de respuestas se hacen manualmente via Microsoft 365. No asumir que un prospect sin reply registrado no ha contestado.
4. Una campana en estado draft NO envia aunque tenga emails scheduled (el scheduler exige status active).
5. Bajas/negativas: emails_reject de follow-ups + cierre manual en plataforma (do_not_contact + suppression list).
6. Si el prospect ya tiene asesor de I+D+i: no ofrecer lo mismo; ampliar a subvenciones/ayudas/financiacion con CTA suave de "valorar sinergias".
7. Handoff de llamadas: Robert Belmonte (I+D+i). Solo ofrecer llamada/handoff cuando hay interes explicito del prospect.""",

    "technova": """Guardarrailes operativos Technova Partners (actualizado 2026-08-10):
1. Firma "Alfons Marques" SIN acento. Remitente @technovapartners.com (Resend propio verificado, workspace EU).
2. NUNCA afirmar hechos no verificados sobre el prospect (ej. "tu web no carga", "esta obsoleta"): en junio se pausaron 15 emails por claims falsos. Toda afirmacion sobre el prospect debe ser verificable.
3. Envios solo lunes-viernes, respetando warmup.
4. Bajas/negativas: emails_reject de follow-ups + cierre manual en plataforma (do_not_contact + suppression).
5. Relacion con Tecnocim: presentarse como "mismo grupo" cuando aplique (formacion IA + I+D+i); Robert Belmonte como POC tecnico si hay handoff.""",

    "treemg": """Guardarrailes operativos TreeMG / MasTree (actualizado 2026-08-10):
1. DRAFT-ONLY: nunca aprobar, programar ni enviar automaticamente. Toda salida de emails requiere decision explicita del usuario.
2. La BBDD de empresas comprada esta APARCADA por RGPD: no usarla como fuente de prospects.
3. Resend separado del tenant AUN PENDIENTE: verificar remitente/entregabilidad antes de aprobar cualquier envio.
4. Warmup 100/dia (desde 30-jul). Envios solo lunes-viernes.
5. Oferta de referencia: "LOVE 5" (fibra + 5 lineas moviles, 58 EUR/mes). No inventar otras ofertas ni precios.
6. Firma "Alfons Marques" SIN acento.""",
}


def curl_json(url, payload, token=None):
    args = ["curl", "-sS", "--ssl-no-revoke", "-X", "POST", url,
            "-H", "Content-Type: application/json",
            "-H", "Accept: application/json, text/event-stream"]
    if token:
        args += ["-H", f"Authorization: Bearer {token}"]
    args += ["--data-binary", "@-"]
    out = subprocess.run(args, input=json.dumps(payload).encode("utf-8"), capture_output=True, check=True)
    return json.loads(out.stdout.decode("utf-8"))


def main():
    tenant = sys.argv[1] if len(sys.argv) > 1 else ""
    if tenant not in TENANTS:
        sys.exit(f"Usage: {sys.argv[0]} <{'|'.join(TENANTS)}>")
    password = os.environ.get("ABM_PASSWORD")
    if not password:
        sys.exit("ABM_PASSWORD env var not set.")

    token_file = f"C:/Users/user/tmp_auth_{tenant}.txt"
    login = curl_json(f"{BASE}/api/auth/login", {"email": TENANTS[tenant], "password": password})
    token = (login.get("data") or {}).get("token")
    if not token:
        sys.exit(f"Login failed for {TENANTS[tenant]}: {login}")
    open(token_file, "w", encoding="utf-8").write(token)
    print(f"login OK ({TENANTS[tenant]}), token cached in {token_file}")

    r = curl_json(URL, {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                        "params": {"name": "settings_set_mcp_notes",
                                   "arguments": {"instructions": NOTES[tenant]}}}, token)
    body = json.loads(r["result"]["content"][0]["text"])
    print("set_mcp_notes:", {k: body.get(k) for k in ("updated", "cleared", "error")})
    if not body.get("updated"):
        sys.exit(1)

    r2 = curl_json(URL, {"jsonrpc": "2.0", "id": 2, "method": "initialize",
                         "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                                    "clientInfo": {"name": "seed-verify", "version": "1.0"}}}, token)
    instr = r2["result"]["instructions"]
    marker = NOTES[tenant].splitlines()[0][:40]
    print("initialize carries tenant notes:", marker in instr)


if __name__ == "__main__":
    main()
