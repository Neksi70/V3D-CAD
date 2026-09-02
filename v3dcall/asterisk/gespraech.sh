#!/bin/bash
# Gespraechsassistent an- oder ausschalten.
#   sudo bash ~/v3dcall/asterisk/gespraech.sh an
#   sudo bash ~/v3dcall/asterisk/gespraech.sh aus
set -euo pipefail
BASE="$(cd "$(dirname "$0")/.." && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo starten."; exit 1; }
case "${1:-}" in
  an)  WERT=true  ;;
  aus) WERT=false ;;
  *)   echo "Aufruf: sudo bash $0 an|aus"; exit 1 ;;
esac

# Vor dem Einschalten pruefen, ob der Assistent ueberhaupt denken kann —
# sonst laeuft jeder Anrufer in die Stoerungsansage.
if [ "$WERT" = true ]; then
  echo "==> Pruefe den Anthropic-Zugang"
  ANTWORT=$(sudo -u "$(stat -c %U "$BASE")" "$BASE/.venv/bin/python" - <<'PY'
import json, urllib.request, core
k = core.cfg("dialog", "apiKey", default="")
if not k:
    print("FEHLER: kein Schluessel hinterlegt"); raise SystemExit
r = urllib.request.Request("https://api.anthropic.com/v1/messages",
    data=json.dumps({"model": core.cfg("dialog","model",default="claude-haiku-4-5"),
                     "max_tokens": 8,
                     "messages":[{"role":"user","content":"hi"}]}).encode(),
    headers={"x-api-key": k, "anthropic-version": "2023-06-01",
             "content-type": "application/json"})
try:
    urllib.request.urlopen(r, timeout=25)
    print("OK")
except Exception as e:
    leib = getattr(e, "read", lambda: b"")()
    try:
        print("FEHLER:", json.loads(leib)["error"]["message"][:120])
    except Exception:
        print("FEHLER:", e)
PY
)
  echo "    $ANTWORT"
  case "$ANTWORT" in
    OK) ;;
    *) echo "    Abbruch — der Assistent koennte nicht antworten."; exit 1 ;;
  esac
fi

sudo -u "$(stat -c %U "$BASE")" "$BASE/.venv/bin/python" - "$WERT" <<'PY'
import sys, core
c = core.full_cfg(); c["dialog"]["aktiv"] = (sys.argv[1] == "true"); core.save_cfg(c)
print("    dialog.aktiv =", c["dialog"]["aktiv"])
PY
echo "==> V3D-Dienst neu starten"
# Pflicht: dialog.py wird beim Start eingelesen. Ohne Neustart laeuft der
# Assistent mit dem alten Systemprompt weiter, ohne dass man es merkt.
EIGNER="$(stat -c %U "$BASE")"
sudo -u "$EIGNER" XDG_RUNTIME_DIR="/run/user/$(id -u "$EIGNER")" \
    systemctl --user restart v3dcall.service
sleep 2

echo "==> Neu ausrollen"
bash "$BASE/asterisk/install.sh" | tail -4
