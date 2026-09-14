#!/bin/sh
# V3D Scan lokal starten (Entwicklung, Linux)
cd "$(dirname "$0")" || exit 1
exec python3 server.py --port "${1:-8797}" --browser
