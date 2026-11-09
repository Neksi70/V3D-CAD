#!/bin/bash
# Konfiguriert OrcaSlicer 2.5 (Worktree OrcaSlicer-migrate) nativ (build-native) fuer libslic3r + orca_native.
# -DEMSCRIPTEN=ON ist ein reiner Build-System-Schalter (wie im WASM-Build):
# er umgeht CURL/OpenGL/glfw3/OpenVDB/OpenCV/fontconfig-Zweige im CMake.
# Der Compiler ist echter g++, __EMSCRIPTEN__ ist NICHT definiert -> nativer Code.
# ORCA_NATIVE_SLICER=ON waehlt in src/wasm das native Target orca_native.
set -euo pipefail
ORCA=$HOME/orca-wasm/OrcaSlicer-migrate
PREFIX=$HOME/orca-wasm/native-deps-25
TOOLS=$HOME/orca-wasm/build-deps/local-tools/usr
export PATH="$TOOLS/bin:$PATH"
export LD_LIBRARY_PATH="$TOOLS/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
cd "$ORCA"

cmake -S . -B build-native \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_PREFIX_PATH="$PREFIX" \
  -DEMSCRIPTEN=ON \
  -DORCA_NATIVE_SLICER=ON \
  -DSLIC3R_GUI=0 \
  -DSLIC3R_STATIC=1 \
  -DSLIC3R_FHS=0 \
  -DSLIC3R_PCH=0 \
  -DSLIC3R_ENC_CHECK=OFF \
  -DSLIC3R_BUILD_SANDBOXES=OFF \
  -DBUILD_TESTS=OFF \
  -DORCA_TOOLS=OFF \
  -DSLIC3R_CAD=ON \
  -DCMAKE_CXX_FLAGS=-DORCA_NO_OPENVDB \
  -DOpenCASCADE_DIR="$PREFIX/lib/cmake/occt" \
  -DOPENSSL_ROOT_DIR="$PREFIX" \
  -DOPENSSL_USE_STATIC_LIBS=TRUE \
  -DPKG_CONFIG_EXECUTABLE="$TOOLS/bin/pkg-config" \
  -DDBUS_INCLUDE_DIR="$TOOLS/include/dbus-1.0" \
  -DDBUS_ARCH_INCLUDE_DIR="$TOOLS/lib/x86_64-linux-gnu/dbus-1.0/include" \
  -DDBUS_LIBRARIES="$TOOLS/lib/x86_64-linux-gnu/libdbus-1.so"

echo "CONFIGURE-OK"
