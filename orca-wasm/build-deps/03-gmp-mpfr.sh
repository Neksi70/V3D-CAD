#!/bin/bash
# GMP 6.2.1 + MPFR 4.2.1 → WASM (für CGAL). GMP ohne Assembly (--disable-assembly),
# host=none = generischer C-Code. Bewährtes Emscripten-Rezept.
set -euo pipefail
source ~/emsdk/emsdk_env.sh
PREFIX=$HOME/orca-wasm/wasm-deps
SRC=$HOME/orca-wasm/build-deps
cd "$SRC"
if [ ! -d gmp-6.2.1 ]; then
  [ -f gmp-6.2.1.tar.bz2 ] || wget -q https://github.com/SoftFever/OrcaSlicer_deps/releases/download/gmp-6.2.1/gmp-6.2.1.tar.bz2
  tar xf gmp-6.2.1.tar.bz2
fi
cd gmp-6.2.1
emconfigure ./configure --disable-assembly --disable-shared --enable-static \
  --enable-cxx --host=none --prefix="$PREFIX" CFLAGS="-O2 -fexceptions -pthread" CXXFLAGS="-O2 -fexceptions -pthread"
emmake make -j12
emmake make install
cd "$SRC"
if [ ! -d mpfr-4.2.1 ]; then
  [ -f mpfr-4.2.1.tar.bz2 ] || wget -q https://www.mpfr.org/mpfr-4.2.1/mpfr-4.2.1.tar.bz2
  tar xf mpfr-4.2.1.tar.bz2
fi
cd mpfr-4.2.1
emconfigure ./configure --disable-shared --enable-static --host=none \
  --with-gmp="$PREFIX" --prefix="$PREFIX" CFLAGS="-O2 -fexceptions -pthread"
emmake make -j12
emmake make install
echo "GMP-MPFR-WASM-OK"
