#!/bin/sh
# VolmeStick auf DIESEM Rechner starten (Linux).
# root wird gebraucht, um Datentraeger neu aufzuteilen.
cd "$(dirname "$0")" || exit 1
if [ "$(id -u)" != "0" ]; then
    echo "Starte mit sudo neu ..."
    exec sudo "$0" "$@"
fi
exec python3 server.py --host 127.0.0.1 --port 8775 --browser "$@"
