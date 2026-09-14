#!/bin/bash
# V3DScan.exe bauen - unter Wine 11 (Wine 6 aus Ubuntu kann Open3D nicht
# laden: fetestexcept fehlt in der UCRT).
#
# Voraussetzungen (einmalig, siehe LIESMICH.md):
#   ~/tools/wine-11.17-amd64          portable Wine (Kron4ek-Build)
#   ~/.wine-v3dscan/drive_c/Py311e    Python 3.11 embeddable + PyInstaller,
#                                     numpy + open3d als entpackte Wheels
set -e
cd "$(dirname "$0")"
export V3DSCAN_KONSOLE WINEPREFIX="$HOME/.wine-v3dscan" WINEDEBUG=-all
export PATH="$HOME/tools/wine-11.17-amd64/bin:$PATH"
BAU="$WINEPREFIX/drive_c/v3dscan_bau"

rm -rf "$BAU"
mkdir -p "$BAU"
cp -r kern web server.py exe_start.py V3DScan.spec v3dscan.ico "$BAU/"
find "$BAU" -name __pycache__ -type d -exec rm -rf {} +

# PyInstaller will ein Terminal sehen (sonst bricht der Wine-Build still ab).
script -qec "wine 'C:\\Py311e\\python.exe' -m PyInstaller --noconfirm --clean \
  --distpath 'C:\\v3dscan_bau\\dist' --workpath 'C:\\v3dscan_bau\\build' \
  'C:\\v3dscan_bau\\V3DScan.spec'" /dev/null 2>&1 | grep -v "libEGL\|^$" | tail -25

mkdir -p dist
cp "$BAU/dist/V3DScan.exe" dist/V3DScan.exe
ls -la dist/V3DScan.exe
