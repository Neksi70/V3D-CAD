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
echo '— Gesundheitscheck —'
curl -s -o /dev/null -w 'App:  HTTP %{http_code}\n' https://v3dcad.volme3dakademie.de/
curl -s https://v3dcad.volme3dakademie.de/occt-health | head -c 40; echo
git log --oneline -1
"
echo "✓ Rollout fertig."
