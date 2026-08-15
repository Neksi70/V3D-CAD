#!/usr/bin/env bash
# Baut alle drei Teile fuer Windows. Laeuft auch auf Linux (Cross-Build fuer win-x64).
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$PATH:$HOME/.dotnet"

WERK="build/VolmeThin"          # Paketier-Werkzeug, Arbeitsplatzrechner
SRV="build/VolmeThin-Server"    # Verteilserver, VHS-Rechner
AGT="build/VolmeThin-Agent"     # Agent, Kurs-PCs

rm -rf build
mkdir -p "$WERK/stub" "$SRV" "$AGT"

echo "== Stub (Launcher, self-contained + getrimmt) =="
dotnet publish src/VolmeThin.Stub -c Release -o "$WERK/stub" --nologo -v q

echo "== Kommandozeile =="
dotnet publish src/VolmeThin.Builder -c Release -r win-x64 --self-contained true \
  -p:PublishSingleFile=true -o "$WERK" --nologo -v q

echo "== Oberflaeche =="
dotnet publish src/VolmeThin.App -c Release -r win-x64 --self-contained true \
  -p:PublishSingleFile=true -o "$WERK" --nologo -v q

echo "== Verteilserver =="
dotnet publish src/VolmeThin.Server -c Release -r win-x64 --self-contained true \
  -p:PublishSingleFile=true -o "$SRV" --nologo -v q

echo "== Agent =="
dotnet publish src/VolmeThin.Agent -c Release -o "$AGT" --nologo -v q

find build -name '*.pdb' -delete
cp -f LIESMICH.md "$WERK/" 2>/dev/null || true

if command -v zip >/dev/null; then
  ( cd build && zip -qr VolmeThin-win-x64.zip VolmeThin \
      && zip -qr VolmeThin-Server-win-x64.zip VolmeThin-Server \
      && zip -qr VolmeThin-Agent-win-x64.zip VolmeThin-Agent )
fi

echo
for ordner in "$WERK" "$SRV" "$AGT"; do
  echo "$ordner:"
  find "$ordner" -maxdepth 2 -name '*.exe' -printf '  %-32f %8s Bytes\n' | sed 's/ [0-9]* Bytes//;s/$//'
  du -sh "$ordner" | sed 's/^/  gesamt /'
done
ls -lh build/*.zip 2>/dev/null | awk '{print "  " $9 "  " $5}'
