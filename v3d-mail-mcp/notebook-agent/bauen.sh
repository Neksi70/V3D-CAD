#!/bin/sh
# Baut ~/Ablage/v3d-notebook-agent-einrichten.ps1 aus einrichten.vorlage.ps1 + agent.js.
# Beide Quellen muessen reines ASCII sein (PowerShell 5.1 liest Skripte ohne BOM als ANSI).
set -e
cd "$(dirname "$0")"
node --check agent.js
python3 -I - <<'PY'
import os
js = open('agent.js', encoding='ascii').read()
vorlage = open('einrichten.vorlage.ps1', encoding='ascii').read()
assert "\n'@" not in '\n' + js, "agent.js darf keine Zeile mit '@ beginnen (Here-String)"
assert vorlage.count('__AGENT_JS__') == 1
ziel = os.path.expanduser('~/Ablage/v3d-notebook-agent-einrichten.ps1')
open(ziel, 'w', encoding='ascii', newline='\r\n').write(vorlage.replace('__AGENT_JS__', js.rstrip('\n')))
print('gebaut:', ziel, os.path.getsize(ziel), 'Bytes')
PY
