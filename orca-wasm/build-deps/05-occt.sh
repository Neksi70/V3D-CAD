#!/bin/bash
# OCCT 7.6.0 → WASM (für STEP-/SVG-Import + 3D-Text in M4).
# Spiegelt Orcas deps/OCCT/OCCT.cmake: gleiche Version, gleicher Patch,
# gleiche Modul-Flags; plus Emscripten-Pflicht (-pthread -fexceptions).
set -euo pipefail
source ~/emsdk/emsdk_env.sh
PREFIX=$HOME/orca-wasm/wasm-deps
SRC=$HOME/orca-wasm/build-deps
ORCA=$HOME/orca-wasm/OrcaSlicer
cd "$SRC"

if [ ! -d OCCT-7_6_0 ]; then
  [ -f occt-760.zip ] || wget -q https://github.com/Open-Cascade-SAS/OCCT/archive/refs/tags/V7_6_0.zip -O occt-760.zip
  echo "28334f0e98f1b1629799783e9b4d21e05349d89e695809d7e6dfa45ea43e1dbc  occt-760.zip" | sha256sum -c -
  unzip -q occt-760.zip
  cd OCCT-7_6_0
  git apply --ignore-space-change --whitespace=fix "$ORCA/deps/OCCT/0001-OCCT-fix.patch"
  cd "$SRC"
fi

cd OCCT-7_6_0
emcmake cmake -B bw -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DBUILD_LIBRARY_TYPE=Static \
  -DUSE_TK=OFF -DUSE_TBB=OFF -DUSE_FFMPEG=OFF -DUSE_VTK=OFF \
  -DBUILD_DOC_Overview=OFF \
  -DBUILD_MODULE_ApplicationFramework=OFF \
  -DBUILD_MODULE_Draw=OFF \
  -DBUILD_MODULE_FoundationClasses=OFF \
  -DBUILD_MODULE_ModelingAlgorithms=OFF \
  -DBUILD_MODULE_ModelingData=OFF \
  -DBUILD_MODULE_Visualization=OFF \
  -D3RDPARTY_FREETYPE_DIR="$PREFIX" \
  -DCMAKE_FIND_ROOT_PATH="$PREFIX" \
  -DCMAKE_C_FLAGS="-O2 -fexceptions -pthread" \
  -DCMAKE_CXX_FLAGS="-O2 -fexceptions -pthread"
cmake --build bw -j12
cmake --install bw
echo "OCCT-WASM-OK"
