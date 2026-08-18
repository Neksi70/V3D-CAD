#!/bin/sh
# VolmeKarte lokal starten (Entwicklung)
cd "$(dirname "$0")" || exit 1
exec python3 server.py --port "${1:-8785}" --browser
