#!/bin/bash
# Rollout V3DA → netcup (v3dcad.volme3dakademie.de).
# Ablauf: committeten master-Stand als Git-Bundle rüberschieben, dort
# ff-mergen, dist bauen, Gesundheitscheck. Bricht bei jedem Fehler ab.
# Voraussetzung: ssh-Alias "netcup" (~/.ssh/config, Key id_ed25519_netcup).
set -euo pipefail
cd "$(dirname "$0")"

if ! git diff --quiet -- volme3d.html occt-server.js occt-pool.js volme3d_server.py start.html; then
  echo "⚠ Uncommittete Änderungen an Kern-Dateien — erst committen, dann ausrollen." >&2
  exit 1
fi

# Sperre für die UI-Testversion (Branch ui-neu): volme3d-neu.html und alle
# *-neu.*-Kopien dürfen nie nach netcup. Erst nach dem „Go" werden sie zu
# volme3d.html umbenannt – solange sie auf master liegen, bricht der Rollout ab.
NEU_DATEIEN=$(git ls-tree -r --name-only master | grep -E '(^|/)[^/]*-neu(\.[A-Za-z0-9]+)+$' || true)
if [ -n "$NEU_DATEIEN" ]; then
  echo "⚠ master enthält Testdateien der UI-Testversion — Rollout abgebrochen:" >&2
  echo "$NEU_DATEIEN" | sed 's/^/   /' >&2
  exit 1
fi

REMOTE_HEAD=$(ssh -o BatchMode=yes netcup "cd ~ && git rev-parse HEAD")
LOCAL_HEAD=$(git rev-parse master)
if [ "$REMOTE_HEAD" = "$LOCAL_HEAD" ]; then
  echo "netcup ist schon auf $LOCAL_HEAD — nichts zu tun."
  exit 0
fi

BUNDLE=$(mktemp /tmp/ausrollen-XXXX.bundle)
trap 'rm -f "$BUNDLE"' EXIT
git bundle create "$BUNDLE" "$REMOTE_HEAD..master"
rsync -az "$BUNDLE" netcup:/tmp/ausrollen.bundle

ssh -o BatchMode=yes netcup "
set -e
cd ~
git fetch -q /tmp/ausrollen.bundle master:refs/remotes/v3da/master
git merge -q --ff-only v3da/master
rm /tmp/ausrollen.bundle
npm run build 2>&1 | tail -2
# volme3d_server.py & Co. laufen als System-Dienst weiter — ohne Neustart
# bliebe der alte Python-Code aktiv (dist/HTML liest er dagegen frisch).
if ! git diff --quiet $REMOTE_HEAD HEAD -- '*.py' ':!v3d-cad-connector'; then   # Connector-Python startet unten nur den Connector neu
  sudo systemctl restart volme3d.service
  echo 'volme3d.service neu gestartet (Python geaendert)'
  sleep 2
fi
# Claude-Anbindung: Connector (claude.ai) und Agent-Hub (Live-Tabs) lesen ihren Code nur beim Start
if ! git diff --quiet $REMOTE_HEAD HEAD -- v3d-cad-connector; then
  sudo systemctl restart v3d-cad-connector && echo 'v3d-cad-connector neu gestartet'
fi
if ! git diff --quiet $REMOTE_HEAD HEAD -- v3d-cad-mcp/server.mjs; then
  sudo systemctl restart v3d-cad-agent-hub && echo 'v3d-cad-agent-hub neu gestartet (offene Live-Tabs müssen Claude live neu starten)'
fi
echo '— Gesundheitscheck —'
curl -sL -o /dev/null -w 'App:  HTTP %{http_code}\n' https://v3dcad.volme3dakademie.de/
curl -s https://v3dcad.volme3dakademie.de/occt-health | head -c 40; echo
git log --oneline -1
"
echo "✓ Rollout fertig."
