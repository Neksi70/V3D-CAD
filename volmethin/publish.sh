#!/usr/bin/env bash
# Baut das komplette Windows-Paket. Laeuft auch auf Linux (Cross-Build fuer win-x64).
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$PATH:$HOME/.dotnet"

AUS="build/VolmeThin"
rm -rf build
mkdir -p "$AUS/stub"

echo "== Stub (Launcher, self-contained + getrimmt) =="
dotnet publish src/VolmeThin.Stub -c Release -o "$AUS/stub" --nologo -v q

echo "== Kommandozeile =="
dotnet publish src/VolmeThin.Builder -c Release -r win-x64 --self-contained true \
  -p:PublishSingleFile=true -o "$AUS" --nologo -v q

echo "== Oberflaeche =="
dotnet publish src/VolmeThin.App -c Release -r win-x64 --self-contained true \
  -p:PublishSingleFile=true -o "$AUS" --nologo -v q

rm -f "$AUS"/*.pdb "$AUS"/stub/*.pdb
cp -f LIESMICH.md "$AUS/" 2>/dev/null || true

echo
echo "Fertig unter $AUS:"
ls -lh "$AUS" | tail -n +2
ls -lh "$AUS/stub"
