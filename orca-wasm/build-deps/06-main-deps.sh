#!/bin/bash
# Neue Deps für Orca-main: Draco 1.5.7 (3MF-Kompression) + OpenSSL 1.1.1w
# (libcrypto — libslic3r linkt jetzt OpenSSL::Crypto direkt)
set -euo pipefail
source ~/emsdk/emsdk_env.sh
export EMSCRIPTEN="$EMSDK/upstream/emscripten"   # draco_check_emscripten_environment
PREFIX=$HOME/orca-wasm/wasm-deps
SRC=$HOME/orca-wasm/build-deps
FLAGS="-O2 -fexceptions -pthread"
cd "$SRC"

# --- Draco 1.5.7
if [ ! -f "$PREFIX/lib/libdraco.a" ]; then
  [ -d draco-1.5.7 ] || { wget -q https://github.com/google/draco/archive/refs/tags/1.5.7.zip -O draco-157.zip; unzip -q draco-157.zip; }
  cd draco-1.5.7
  emcmake cmake -B bw -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DBUILD_SHARED_LIBS=OFF -DDRACO_JS_GLUE=OFF -DDRACO_WASM=OFF \
    -DDRACO_TESTS=OFF -DDRACO_ANIMATION_ENCODING=OFF \
    -DCMAKE_CXX_FLAGS="$FLAGS" -DCMAKE_C_FLAGS="$FLAGS"
  cmake --build bw -j12 && cmake --install bw
  cd "$SRC"
fi

# --- OpenSSL 1.1.1w (nur libcrypto/libssl statisch, kein ASM)
if [ ! -f "$PREFIX/lib/libcrypto.a" ]; then
  [ -d openssl-OpenSSL_1_1_1w ] || { wget -q https://github.com/openssl/openssl/archive/OpenSSL_1_1_1w.tar.gz -O openssl-111w.tar.gz; tar xf openssl-111w.tar.gz; }
  cd openssl-OpenSSL_1_1_1w
  # Flags als nackte Argumente — Configure lehnt CFLAGS=… ab
  emconfigure ./Configure linux-generic32 no-asm no-shared no-engine no-dso \
    no-tests no-afalgeng no-async -DOPENSSL_NO_SECURE_MEMORY \
    -O2 -fexceptions -pthread \
    --prefix="$PREFIX" --openssldir="$PREFIX/ssl"
  # CROSS_COMPILE leeren: emconfigure hinterlässt einen Präfix, der den
  # Compiler-Pfad doppelt zusammensetzt (em/home/…/emcc)
  emmake make CROSS_COMPILE= CC=emcc AR=emar RANLIB=emranlib -j12 build_libs
  emmake make CROSS_COMPILE= CC=emcc AR=emar RANLIB=emranlib install_dev 2>/dev/null || \
    { cp libcrypto.a libssl.a "$PREFIX/lib/"; cp -r include/openssl "$PREFIX/include/"; }
  cd "$SRC"
fi
echo "MAIN-DEPS-OK"
