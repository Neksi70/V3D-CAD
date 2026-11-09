#!/bin/bash
# Konfiguriert OrcaSlicer 2.5 (Worktree OrcaSlicer-migrate) als WASM-Kern → build-wasm-main/src/wasm/orca-slicer.{js,wasm}.
# Spiegelt die Produktiv-Konfiguration (OrcaSlicer/build-wasm-main), aber gegen wasm-deps-25
# (OCCT 8.0.1, CGAL 6.2.1, assimp 5.4.3, SLVS).
set -euo pipefail
source ~/emsdk/emsdk_env.sh >/dev/null
ORCA=$HOME/orca-wasm/OrcaSlicer-migrate
PREFIX=$HOME/orca-wasm/wasm-deps-25
cd "$ORCA"

emcmake cmake -S . -B build-wasm-main \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH="$PREFIX" \
  -DCMAKE_FIND_ROOT_PATH="$PREFIX" \
  -DCMAKE_C_FLAGS="-pthread -fexceptions" \
  -DCMAKE_CXX_FLAGS="-pthread -fexceptions" \
  -DSLIC3R_GUI=0 -DSLIC3R_STATIC=1 -DSLIC3R_FHS=0 -DSLIC3R_PCH=0 \
  -DSLIC3R_ENC_CHECK=OFF -DSLIC3R_BUILD_SANDBOXES=OFF \
  -DSLIC3R_CAD=OFF \
  -DBUILD_TESTS=OFF -DORCA_TOOLS=OFF \
  -DBoost_DIR="$PREFIX/lib/cmake/Boost-1.84.0" \
  -DEigen3_DIR="$PREFIX/share/eigen3/cmake" \
  -DOpenCASCADE_DIR="$PREFIX/lib/cmake/occt" \
  -DOPENSSL_ROOT_DIR="$PREFIX" -DOPENSSL_USE_STATIC_LIBS=TRUE \
  -Ddraco_DIR="$PREFIX/share/cmake/draco"

echo "CONFIGURE-OK"
