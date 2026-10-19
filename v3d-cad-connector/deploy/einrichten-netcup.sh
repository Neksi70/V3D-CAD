#!/bin/bash
# Einmalig auf netcup (als v3da, sudo ohne Passwort): Connector + Hub einrichten.
# Danach reicht ./ausrollen.sh; Dienste neu starten: sudo systemctl restart v3d-cad-connector v3d-cad-agent-hub
set -euo pipefail
cd ~/v3d-cad-connector
echo '== venv'
[ -L .venv ] && rm .venv
if ! python3 -m venv --help >/dev/null 2>&1 || ! python3 -c 'import ensurepip' 2>/dev/null; then sudo apt-get install -y python3-venv; fi
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
echo '== Dienste'
sudo install -m 644 deploy/v3d-cad-connector.service deploy/v3d-cad-agent-hub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now v3d-cad-agent-hub v3d-cad-connector
sleep 3
systemctl is-active v3d-cad-agent-hub v3d-cad-connector
echo '== nginx'
SITE=$(grep -l 'server_name[^;]*v3dcad.volme3dakademie.de' /etc/nginx/sites-enabled/* | head -1)
echo "Site: $SITE"
if ! grep -q 'v3d-cad-connector/deploy/nginx-cad.conf' "$SITE"; then
  sudo cp "$SITE" "$SITE.bak-$(date +%Y%m%d-%H%M%S)"
  # in den 443-Block: direkt nach der ersten „listen 443“-Zeile einfügen
  sudo sed -i '0,/listen[^;]*443/{/listen[^;]*443[^;]*;/a\    include /home/v3da/v3d-cad-connector/deploy/nginx-cad.conf;
}' "$SITE"
fi
sudo nginx -t && sudo systemctl reload nginx
echo '== Prüfen'
curl -s -o /dev/null -w 'Hub lokal: %{http_code}\n' http://127.0.0.1:8830/
curl -s -o /dev/null -w 'Connector lokal: %{http_code}\n' http://127.0.0.1:8840/health
curl -s -o /dev/null -w 'öffentlich /cad-mcp/health: %{http_code}\n' https://v3dcad.volme3dakademie.de/cad-mcp/health
curl -s -o /dev/null -w 'OAuth-Metadaten: %{http_code}\n' https://v3dcad.volme3dakademie.de/.well-known/oauth-authorization-server/cad-mcp
curl -s -o /dev/null -w 'Resource-Metadaten: %{http_code}\n' https://v3dcad.volme3dakademie.de/.well-known/oauth-protected-resource/cad-mcp/mcp
curl -s -o /dev/null -w '/cad-mcp/mcp ohne Token (soll 401): %{http_code}\n' -X POST -H 'content-type: application/json' -d '{}' https://v3dcad.volme3dakademie.de/cad-mcp/mcp
curl -s -o /dev/null -w '/cad-agent/live/info: %{http_code}\n' https://v3dcad.volme3dakademie.de/cad-agent/live/info
