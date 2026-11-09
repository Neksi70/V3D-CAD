#!/bin/bash
# OrcaSlicer 2.5: neue/aktualisierte Deps in EIGENE Prefixes (native-deps-25, wasm-deps-25),
# damit der Produktiv-Build (OrcaSlicer/ wasm-main, native-deps, wasm-deps) unberührt bleibt.
# Neu ggü. 2.3/2.5-dev: OCCT 8.0.1 (+ModelingAlgorithms für Design-Tab/CAD-Kern), CGAL 6.2.1, assimp 5.4.3.
# Aufruf: 25-deps.sh native|wasm
set -euo pipefail
MODE=${1:?native|wasm}
SRC=$HOME/orca-wasm/build-deps
ORCA=$HOME/orca-wasm/OrcaSlicer-migrate
cd "$SRC"

if [ "$MODE" = native ]; then
  PREFIX=$HOME/orca-wasm/native-deps-25
  BASE=$HOME/orca-wasm/native-deps
  export PATH="$SRC/local-tools/usr/bin:$PATH"
  export LD_LIBRARY_PATH="$SRC/local-tools/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
  CM="cmake"; BD=bn25
  # X11-Header (ohne Root per dpkg -x entpackt) — OCCT-TKService includet Xlib.h auch ohne Visualization
  FLAGS="-O2 -fPIC -I$PREFIX/x11/usr/include"; EXTRA=(-DCMAKE_POSITION_INDEPENDENT_CODE=ON)
else
  PREFIX=$HOME/orca-wasm/wasm-deps-25
  BASE=$HOME/orca-wasm/wasm-deps
  source ~/emsdk/emsdk_env.sh >/dev/null
  CM="emcmake cmake"; BD=bw25
  FLAGS="-O2 -fexceptions -pthread"; EXTRA=(-DCMAKE_FIND_ROOT_PATH="$PREFIX")
fi

# Prefix = Kopie des alten, alte OCCT/CGAL-Reste raus (sonst findet CMake die falsche Version)
if [ ! -d "$PREFIX" ]; then
  cp -a "$BASE" "$PREFIX"
  rm -rf "$PREFIX"/include/opencascade "$PREFIX"/lib/cmake/opencascade "$PREFIX"/lib/libTK*.a \
         "$PREFIX"/include/CGAL "$PREFIX"/lib/cmake/CGAL
fi

# --- Quellen
[ -f occt-801.zip ] || wget -q https://github.com/Open-Cascade-SAS/OCCT/archive/refs/tags/V8_0_1.zip -O occt-801.zip
echo "7c033d917ee8f040c0512d289dcc5f02c148889d5bac17c3e25639accb44f0da  occt-801.zip" | sha256sum -c -
if [ ! -d OCCT-8_0_1 ]; then
  unzip -q occt-801.zip
  (cd OCCT-8_0_1 && git apply --ignore-space-change --whitespace=fix "$ORCA/deps/OCCT/0001-BRepMesh-seam-pcurve-at-edge-parameter.patch")
fi
[ -f cgal-621.zip ] || wget -q https://github.com/CGAL/cgal/releases/download/v6.2.1/CGAL-6.2.1.zip -O cgal-621.zip
[ -d CGAL-6.2.1 ] || unzip -q cgal-621.zip
[ -f assimp-543.tar.gz ] || wget -q https://github.com/assimp/assimp/archive/refs/tags/v5.4.3.tar.gz -O assimp-543.tar.gz
echo "66dfbaee288f2bc43172440a55d0235dfc7bf885dda6435c038e8000e79582cb  assimp-543.tar.gz" | sha256sum -c -
[ -d assimp-5.4.3 ] || tar xzf assimp-543.tar.gz

# --- CGAL 6.2.1 (header-only)
cd "$SRC/CGAL-6.2.1"
$CM -B $BD -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCGAL_HEADER_ONLY=ON >/dev/null
cmake --install $BD >/dev/null
echo "CGAL-OK"

# --- assimp 5.4.3 (nur glTF/OBJ/FBX-Import, wie deps/Assimp)
cd "$SRC/assimp-5.4.3"
$CM -B $BD -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_PREFIX_PATH="$PREFIX" \
  -DBUILD_SHARED_LIBS=OFF -DASSIMP_BUILD_USE_CCACHE=OFF -DASSIMP_BUILD_TESTS=OFF -DASSIMP_BUILD_SAMPLES=OFF \
  -DASSIMP_BUILD_ASSIMP_TOOLS=OFF -DASSIMP_NO_EXPORT=ON -DASSIMP_BUILD_ALL_IMPORTERS_BY_DEFAULT=OFF \
  -DASSIMP_BUILD_GLTF_IMPORTER=ON -DASSIMP_BUILD_OBJ_IMPORTER=ON -DASSIMP_BUILD_FBX_IMPORTER=ON \
  -DASSIMP_BUILD_ZLIB=ON -DASSIMP_WARNINGS_AS_ERRORS=OFF \
  -DCMAKE_C_FLAGS="$FLAGS" -DCMAKE_CXX_FLAGS="$FLAGS" "${EXTRA[@]}" >/dev/null
cmake --build $BD -j12
cmake --install $BD >/dev/null
echo "ASSIMP-OK"

# --- OCCT 8.0.1 (Layout wie deps/OCCT: lib/occt, include/occt, lib/cmake/occt)
cd "$SRC/OCCT-8_0_1"
$CM -B $BD -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_PREFIX_PATH="$PREFIX" \
  -DCMAKE_CXX_STANDARD=17 -DBUILD_LIBRARY_TYPE=Static \
  -DINSTALL_DIR_LAYOUT=Unix -DINSTALL_DIR_BIN=bin/occt -DINSTALL_DIR_LIB=lib/occt \
  -DINSTALL_DIR_INCLUDE=include/occt -DINSTALL_DIR_CMAKE=lib/cmake/occt \
  -DUSE_TK=OFF -DUSE_TBB=OFF -DUSE_FREETYPE=OFF -DUSE_FFMPEG=OFF -DUSE_VTK=OFF \
  -DBUILD_DOC_Overview=OFF -DBUILD_MODULE_ApplicationFramework=OFF -DBUILD_MODULE_Draw=OFF \
  -DBUILD_MODULE_FoundationClasses=OFF -DBUILD_MODULE_ModelingAlgorithms=ON \
  -DBUILD_MODULE_ModelingData=OFF -DBUILD_MODULE_Visualization=OFF \
  -DCMAKE_C_FLAGS="$FLAGS" -DCMAKE_CXX_FLAGS="$FLAGS" "${EXTRA[@]}" >/dev/null
cmake --build $BD -j12
cmake --install $BD >/dev/null
echo "OCCT-OK ($MODE)"
