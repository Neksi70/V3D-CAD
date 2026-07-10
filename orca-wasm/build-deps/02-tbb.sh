#!/bin/bash
# oneTBB → WASM. Orca pinnt 2021.5 (kein Emscripten-Support); wir nehmen 2021.13
# mit offiziellem WASM-Support. API-kompatibel zu 2021.5.
set -euo pipefail
source ~/emsdk/emsdk_env.sh
PREFIX=$HOME/orca-wasm/wasm-deps
SRC=$HOME/orca-wasm/build-deps
cd "$SRC"
[ -d oneTBB ] || git clone --depth 1 --branch v2021.13.0 https://github.com/uxlfoundation/oneTBB.git
cd oneTBB
emcmake cmake -B build-wasm -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DBUILD_SHARED_LIBS=OFF \
  -DTBB_TEST=OFF -DTBB_EXAMPLES=OFF -DTBB_STRICT=OFF \
  -DTBB_DISABLE_HWLOC_AUTOMATIC_SEARCH=ON \
  -DCMAKE_CXX_FLAGS="-pthread -fexceptions" \
  -DEMSCRIPTEN_WITHOUT_PTHREAD=OFF
cmake --build build-wasm -j12
cmake --install build-wasm
echo "TBB-WASM-OK"
