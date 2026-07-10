#!/bin/bash
# Kleinkram → WASM: zlib, libpng, libjpeg-turbo (ohne SIMD), freetype, expat, NLopt, CGAL (header-only)
set -euo pipefail
source ~/emsdk/emsdk_env.sh
PREFIX=$HOME/orca-wasm/wasm-deps
SRC=$HOME/orca-wasm/build-deps
FLAGS="-O2 -fexceptions -pthread"
cd "$SRC"

# --- zlib 1.3.1
if [ ! -f "$PREFIX/lib/libz.a" ]; then
  [ -d zlib-1.3.1 ] || { wget -q https://github.com/madler/zlib/releases/download/v1.3.1/zlib-1.3.1.tar.gz; tar xf zlib-1.3.1.tar.gz; }
  cd zlib-1.3.1
  emcmake cmake -B bw -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_C_FLAGS="$FLAGS" -DZLIB_BUILD_EXAMPLES=OFF
  cmake --build bw -j12 && cmake --install bw
  rm -f "$PREFIX"/lib/libz.so* 2>/dev/null || true
  cd "$SRC"
fi

# --- libpng 1.6.43
if [ ! -f "$PREFIX/lib/libpng.a" ]; then
  [ -d libpng-1.6.43 ] || { wget -q https://github.com/pnggroup/libpng/archive/refs/tags/v1.6.43.tar.gz -O libpng-1.6.43.tar.gz; tar xf libpng-1.6.43.tar.gz; }
  cd libpng-1.6.43
  emcmake cmake -B bw -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DPNG_SHARED=OFF -DPNG_STATIC=ON -DPNG_TESTS=OFF -DPNG_TOOLS=OFF \
    -DCMAKE_FIND_ROOT_PATH="$PREFIX" \
    -DZLIB_LIBRARY="$PREFIX/lib/libz.a" -DZLIB_INCLUDE_DIR="$PREFIX/include" \
    -DCMAKE_C_FLAGS="$FLAGS"
  cmake --build bw -j12 && cmake --install bw
  cd "$SRC"
fi

# --- libjpeg-turbo 3.0.3 (ohne SIMD-Assembly)
if [ ! -f "$PREFIX/lib/libjpeg.a" ]; then
  [ -d libjpeg-turbo-3.0.3 ] || { wget -q https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/3.0.3/libjpeg-turbo-3.0.3.tar.gz; tar xf libjpeg-turbo-3.0.3.tar.gz; }
  cd libjpeg-turbo-3.0.3
  emcmake cmake -B bw -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DWITH_SIMD=0 -DENABLE_SHARED=0 -DENABLE_STATIC=1 -DWITH_TURBOJPEG=0 -DCMAKE_C_FLAGS="$FLAGS"
  cmake --build bw -j12 && cmake --install bw
  cd "$SRC"
fi

# --- expat 2.6.2
if [ ! -f "$PREFIX/lib/libexpat.a" ]; then
  [ -d expat-2.6.2 ] || { wget -q https://github.com/libexpat/libexpat/releases/download/R_2_6_2/expat-2.6.2.tar.gz; tar xf expat-2.6.2.tar.gz; }
  cd expat-2.6.2
  emcmake cmake -B bw -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DEXPAT_BUILD_TESTS=OFF -DEXPAT_BUILD_EXAMPLES=OFF -DEXPAT_BUILD_TOOLS=OFF \
    -DEXPAT_SHARED_LIBS=OFF -DCMAKE_C_FLAGS="$FLAGS"
  cmake --build bw -j12 && cmake --install bw
  cd "$SRC"
fi

# --- freetype 2.13.2 (ohne harfbuzz/brotli)
if [ ! -f "$PREFIX/lib/libfreetype.a" ]; then
  [ -d freetype-2.13.2 ] || { wget -q https://github.com/freetype/freetype/archive/refs/tags/VER-2-13-2.tar.gz -O freetype-2.13.2.tar.gz; tar xf freetype-2.13.2.tar.gz; mv freetype-VER-2-13-2 freetype-2.13.2; }
  cd freetype-2.13.2
  emcmake cmake -B bw -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DBUILD_SHARED_LIBS=OFF -DFT_DISABLE_HARFBUZZ=ON -DFT_DISABLE_BROTLI=ON -DFT_DISABLE_BZIP2=ON \
    -DCMAKE_FIND_ROOT_PATH="$PREFIX" \
    -DZLIB_LIBRARY="$PREFIX/lib/libz.a" -DZLIB_INCLUDE_DIR="$PREFIX/include" \
    -DFT_DISABLE_PNG=OFF -DPNG_LIBRARY="$PREFIX/lib/libpng.a" -DPNG_PNG_INCLUDE_DIR="$PREFIX/include" \
    -DCMAKE_C_FLAGS="$FLAGS"
  cmake --build bw -j12 && cmake --install bw
  cd "$SRC"
fi

# --- NLopt 2.7.1 (wie Orca-Pin)
if [ ! -f "$PREFIX/lib/libnlopt.a" ]; then
  [ -d nlopt-2.7.1 ] || { wget -q https://github.com/stevengj/nlopt/archive/refs/tags/v2.7.1.tar.gz -O nlopt-2.7.1.tar.gz; tar xf nlopt-2.7.1.tar.gz; }
  cd nlopt-2.7.1
  emcmake cmake -B bw -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DBUILD_SHARED_LIBS=OFF -DNLOPT_PYTHON=OFF -DNLOPT_OCTAVE=OFF -DNLOPT_MATLAB=OFF \
    -DNLOPT_GUILE=OFF -DNLOPT_SWIG=OFF -DNLOPT_TESTS=OFF \
    -DCMAKE_C_FLAGS="$FLAGS" -DCMAKE_CXX_FLAGS="$FLAGS"
  cmake --build bw -j12 && cmake --install bw
  cd "$SRC"
fi

# --- cereal 1.3.0 (header-only, wie Orca-Pin)
if [ ! -d "$PREFIX/include/cereal" ]; then
  [ -d cereal-1.3.0 ] || { wget -q https://github.com/USCiLab/cereal/archive/refs/tags/v1.3.0.zip -O cereal-1.3.0.zip; unzip -q cereal-1.3.0.zip; }
  cd cereal-1.3.0
  emcmake cmake -B bw -DCMAKE_INSTALL_PREFIX="$PREFIX" -DJUST_INSTALL_CEREAL=ON -DSKIP_PERFORMANCE_COMPARISON=ON -DBUILD_TESTS=OFF
  cmake --install bw
  cd "$SRC"
fi

# --- libnoise (SoftFever-Fork, wie Orca-Pin)
if [ ! -f "$PREFIX/lib/libnoise.a" ] && [ ! -f "$PREFIX/lib/liblibnoise.a" ]; then
  [ -d libnoise-src ] || { wget -q https://github.com/SoftFever/Orca-deps-libnoise/archive/refs/tags/1.0.zip -O libnoise-1.0.zip; unzip -q libnoise-1.0.zip; mv Orca-deps-libnoise-1.0 libnoise-src; }
  cd libnoise-src
  emcmake cmake -B bw -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DBUILD_SHARED_LIBS=OFF -DCMAKE_CXX_FLAGS="$FLAGS"
  cmake --build bw -j12 && cmake --install bw
  cd "$SRC"
fi

# --- CGAL 5.4 (header-only installieren)
if [ ! -d "$PREFIX/include/CGAL" ]; then
  [ -d cgal-5.4 ] || { wget -q https://github.com/CGAL/cgal/archive/refs/tags/v5.4.zip -O cgal-5.4.zip; unzip -q cgal-5.4.zip; }
  cd cgal-5.4
  cmake -B bw -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCGAL_HEADER_ONLY=ON
  cmake --install bw
  cd "$SRC"
fi

echo "MISC-WASM-OK"
