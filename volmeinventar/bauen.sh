#!/bin/bash
# Baut VolmeInventar.exe unter Wine.
#
# Gebaut wird mit einer VOLLSTAENDIGEN Windows-Python im Wine-Prefix, nicht
# mit der eingebetteten aus dem VolmeStick-Bau: die bringt kein tkinter mit,
# und ohne tkinter gibt es keine Oberflaeche.  Eingerichtet wird sie einmalig
# mit "./bauen.sh --python-einrichten".
set -eu
cd "$(dirname "$0")"

export WINEPREFIX="${WINEPREFIX:-$HOME/.wine-volmestick}"
export WINEDEBUG=-all
PYTHON_WIN="$WINEPREFIX/drive_c/Py311tk/python.exe"
BAUORDNER="$WINEPREFIX/drive_c/inventar"
QUELLE="https://github.com/astral-sh/python-build-standalone/releases/download/20240726/cpython-3.11.9%2B20240726-x86_64-pc-windows-msvc-install_only.tar.gz"

if [ "${1:-}" = "--python-einrichten" ]; then
    echo "Hole Windows-Python mit tkinter ..."
    ablage=$(mktemp -d)
    curl -L -o "$ablage/cpy.tar.gz" "$QUELLE"
    rm -rf "$WINEPREFIX/drive_c/Py311tk"
    mkdir -p "$WINEPREFIX/drive_c/Py311tk"
    tar xzf "$ablage/cpy.tar.gz" -C "$WINEPREFIX/drive_c/Py311tk" \
        --strip-components=1
    rm -rf "$ablage"
    wine "$PYTHON_WIN" -m pip install --no-warn-script-location pyinstaller
    echo "Fertig eingerichtet."
    exit 0
fi

if [ ! -f "$PYTHON_WIN" ]; then
    echo "Build-Python fehlt. Einmalig einrichten mit:" >&2
    echo "    ./bauen.sh --python-einrichten" >&2
    exit 1
fi

echo "Tests ..."
./pruefen.sh 2>&1 | tail -3

echo "Baue EXE ..."
rm -rf "$BAUORDNER"
mkdir -p "$BAUORDNER"
cp ./*.py ./*.spec "$BAUORDNER/"
(cd "$BAUORDNER" && wine ../Py311tk/python.exe -m PyInstaller \
    VolmeInventar.spec --noconfirm --distpath dist --workpath build) \
    2>&1 | tail -3

mkdir -p dist
cp "$BAUORDNER/dist/VolmeInventar.exe" dist/
echo "Fertig: $(pwd)/dist/VolmeInventar.exe" \
     "($(du -h dist/VolmeInventar.exe | cut -f1))"

# Rauchprobe: laeuft die frisch gebaute EXE ueberhaupt an?  Ohne diesen
# Schritt faellt ein fehlendes Modul erst auf dem Kurs-PC auf.
echo "Rauchprobe ..."
rm -f "$BAUORDNER/dist/probe.json"
wine "C:\\inventar\\dist\\VolmeInventar.exe" --format json \
     -o "C:\\inventar\\dist\\probe.json" --leise 2>/dev/null || true
if [ -s "$BAUORDNER/dist/probe.json" ]; then
    python3 -c "
import json, sys
d = json.load(open('$BAUORDNER/dist/probe.json'))
print('  Rauchprobe bestanden:', d['kennzahlen'])
"
else
    echo "  FEHLER: die EXE hat keinen Bericht geschrieben." >&2
    exit 1
fi
