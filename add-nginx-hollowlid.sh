#!/usr/bin/env bash
# Fügt die nginx-location für /api/occt-hollow-lid hinzu (gespiegelt vom
# bestehenden occt-subtract-Block) und lädt nginx neu. Idempotent.
# Aufruf:  sudo bash add-nginx-hollowlid.sh
set -euo pipefail
CONF=/etc/nginx/sites-enabled/openclaw

if grep -q '/api/occt-hollow-lid' "$CONF"; then
  echo "Block existiert bereits — nichts zu tun."
  exit 0
fi

# Nach dem schließenden '}' des occt-subtract-Blocks einfügen.
python3 - "$CONF" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p).read()
block = """
    location /api/occt-hollow-lid {
        proxy_pass https://127.0.0.1:3001/api/occt-hollow-lid;
        proxy_ssl_verify off;
        proxy_http_version 1.1;
        proxy_read_timeout 300s;
        client_max_body_size 100m;
    }
"""
# Anker: Ende des occt-subtract location-Blocks
anchor = "location /api/occt-subtract {"
i = s.index(anchor)
j = s.index("}", i) + 1           # schließende Klammer dieses Blocks
s = s[:j] + "\n" + block + s[j:]
open(p, "w").write(s)
print("Block eingefügt.")
PY

nginx -t
systemctl reload nginx
echo "nginx neu geladen ✓"
