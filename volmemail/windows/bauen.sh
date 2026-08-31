#!/bin/bash
# Baut V3DMail.exe unter Wine (gleiche Umgebung wie VolmeInventar/VolmeStick).
set -eu
cd "$(dirname "$0")"

export WINEPREFIX="${WINEPREFIX:-$HOME/.wine-volmestick}"
export WINEDEBUG=-all
PYTHON_WIN="$WINEPREFIX/drive_c/Py311tk/python.exe"
BAUORDNER="$WINEPREFIX/drive_c/v3dmail"

if [ ! -f "$PYTHON_WIN" ]; then
    echo "Build-Python fehlt (siehe volmeinventar/bauen.sh --python-einrichten)" >&2
    exit 1
fi

echo "Baue EXE ..."
rm -rf "$BAUORDNER"
mkdir -p "$BAUORDNER"
cp v3dmail_start.py V3DMail.spec V3DMail.ico "$BAUORDNER/"
(cd "$BAUORDNER" && wine ../Py311tk/python.exe -m PyInstaller \
    V3DMail.spec --noconfirm --distpath dist --workpath build) \
    2>&1 | tail -3

mkdir -p dist
cp "$BAUORDNER/dist/V3DMail.exe" dist/
echo "Fertig: $(pwd)/dist/V3DMail.exe ($(du -h dist/V3DMail.exe | cut -f1))"
