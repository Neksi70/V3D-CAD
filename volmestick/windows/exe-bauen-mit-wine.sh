#!/bin/bash
# VolmeStick - VolmeStick.exe unter Linux bauen (mit Wine).
#
# Warum so umstaendlich: Eine Windows-EXE laesst sich nur unter Windows
# kompilieren - oder eben unter Wine. Dabei gibt es einige Klippen, die hier
# schon umschifft sind:
#
#   * Wine 6 (Ubuntu) kann die MSI-Installer von python.org nicht ausfuehren
#     -> stattdessen das "embeddable" Python-Paket, das nur entpackt wird
#   * Python 3.12 startet unter Wine 6 gar nicht -> 3.9 laeuft
#   * get-pip.py stirbt unter Wine still -> Pakete als Wheels von Linux-pip
#     herunterladen und einfach nach Lib/site-packages entpacken
#   * PyInstaller 6 braucht Windows-Funktionen, die Wine 6 nicht hat
#     -> Version 5.13.2, dazu setuptools 69 (neuere haben kein pkg_resources)
#
# Voraussetzung:  sudo apt install wine64 wine32
set -e
HIER="$(cd "$(dirname "$0")/.." && pwd)"
export WINEPREFIX="$HOME/.wine-volmestick" WINEARCH=win64 WINEDEBUG=-all
export WINEDLLOVERRIDES="mscoree,mshtml="
CACHE="$HOME/.cache/volmestick"
PY="$WINEPREFIX/drive_c/Py39e"
mkdir -p "$CACHE"

if [ ! -d "$WINEPREFIX" ]; then wineboot --init; fi

PYI_FASSUNG="5.13.2"

if [ ! -f "$PY/python.exe" ]; then
    echo "== Python 3.9 (embeddable) einrichten =="
    [ -f "$CACHE/python-3.9.13-embed.zip" ] || curl -sL -o "$CACHE/python-3.9.13-embed.zip" \
        https://www.python.org/ftp/python/3.9.13/python-3.9.13-embed-amd64.zip
    mkdir -p "$PY" && unzip -oq "$CACHE/python-3.9.13-embed.zip" -d "$PY"
    printf 'python39.zip\n.\nLib\\site-packages\nimport site\n' > "$PY/python39._pth"

fi

# Immer die Bauwerkzeuge auf einen bekannten Stand bringen. Eine Mischung aus
# zwei PyInstaller-Fassungen ergibt eine EXE, die beim Start abbricht
# ("Bootloader did not set sys._pyinstaller_pyz") - der Bootloader kommt dann
# aus der einen, die Lademodule aus der anderen Fassung.
echo "== Baupakete auf Fassung $PYI_FASSUNG bringen =="
rm -rf "$PY"/Lib/site-packages/PyInstaller "$PY"/Lib/site-packages/pyinstaller* \
       "$PY"/Lib/site-packages/PyInstaller-* "$PY"/Lib/site-packages/_pyinstaller_hooks_contrib \
       "$PY"/Lib/site-packages/setuptools "$PY"/Lib/site-packages/pkg_resources
rm -rf "$CACHE/wheels" && mkdir -p "$CACHE/wheels"
python3 -m pip download --platform win_amd64 --python-version 3.9 \
    --only-binary :all: --no-deps -d "$CACHE/wheels" -q \
    "pyinstaller==$PYI_FASSUNG" "pyinstaller-hooks-contrib==2023.12" \
    "setuptools==69.5.1" altgraph pefile pywin32-ctypes importlib-metadata zipp packaging
for w in "$CACHE"/wheels/*.whl; do unzip -oq "$w" -d "$PY/Lib/site-packages"; done

echo "== Quellen bereitstellen =="
B="$WINEPREFIX/drive_c/build"
# Zwischenergebnisse eines frueheren Laufs koennen sonst wiederverwendet werden
rm -rf "$B" "$WINEPREFIX"/drive_c/users/*/AppData/Roaming/pyinstaller
mkdir -p "$B/web"
cp "$HIER"/*.py "$B/"
cp "$HIER"/web/*.html "$B/web/"
cp "$HIER"/windows/exe_start.py "$B/"

echo "== EXE bauen =="
cd "$B"
wine "$PY/python.exe" -m PyInstaller --noconfirm --clean --onefile --windowed --uac-admin \
    --name VolmeStick --add-data "web;web" \
    --hidden-import vstick --hidden-import unattend --hidden-import iso9660 \
    --hidden-import isowriter --hidden-import isopatch --hidden-import wim \
    --hidden-import download --hidden-import linuxisos --hidden-import bestand \
    exe_start.py

mkdir -p "$HIER/build"
cp "$B/dist/VolmeStick.exe" "$HIER/build/VolmeStick.exe"

# Gegenprobe: liegt wirklich der frische Bau im Projekt?
if ! cmp -s "$B/dist/VolmeStick.exe" "$HIER/build/VolmeStick.exe"; then
    echo "FEHLER: Im Projekt liegt nicht die eben gebaute Datei." >&2
    exit 1
fi

# Gegenprobe: keine Fassungsmischung in der fertigen Datei
python3 - "$HIER/build/VolmeStick.exe" <<'PRUEF'
import sys
roh = open(sys.argv[1], "rb").read()
if b"_pyinstaller_pyz" in roh:
    sys.exit("FEHLER: Die EXE enthaelt Lademodule von PyInstaller 6 - "
             "sie wuerde beim Start abbrechen. Bitte neu bauen.")
print("Gegenprobe in Ordnung: einheitliche PyInstaller-Fassung")
PRUEF
echo
echo "Fertig: $HIER/build/VolmeStick.exe"
echo "ACHTUNG: Unter Wine 6 laesst sich die EXE nicht starten - ein Lauftest"
echo "ist nur auf einem echten Windows moeglich."
