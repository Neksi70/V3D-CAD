#!/bin/bash
# Alle Tests. Xvfb wird gebraucht, weil die Oberflaechen-Tests ein echtes
# Tk-Fenster bauen - ohne Bildschirm ueberspringt unittest sie stillschweigend,
# und dann faellt ein Fehler darin nicht auf.
set -u
cd "$(dirname "$0")"

if command -v xvfb-run >/dev/null 2>&1; then
    xvfb-run -a python3 -m unittest discover -s tests -v "$@"
else
    echo "Hinweis: Xvfb fehlt - die Oberflaechen-Tests werden uebersprungen." >&2
    python3 -m unittest discover -s tests -v "$@"
fi
