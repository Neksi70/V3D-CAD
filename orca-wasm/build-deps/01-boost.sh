#!/bin/bash
# Boost 1.84 → WASM via offizielles Boost-CMake (wie Orca es baut, nur mit emcmake).
# Ausschlüsse wie Orca (deps/Boost/Boost.cmake) plus context/coroutine/cobalt
# (brauchen Assembler/C++20-Corotinen, kein WASM-Support; libslic3r nutzt sie nicht).
set -euo pipefail
source ~/emsdk/emsdk_env.sh
PREFIX=$HOME/orca-wasm/wasm-deps
SRC=$HOME/orca-wasm/build-deps
cd "$SRC"
if [ ! -d boost-1.84.0 ]; then
  [ -f boost-1.84.0.tar.gz ] || wget -q https://github.com/boostorg/boost/releases/download/boost-1.84.0/boost-1.84.0.tar.gz
  echo "4d27e9efed0f6f152dc28db6430b9d3dfb40c0345da7342eaa5a987dde57bd95  boost-1.84.0.tar.gz" | sha256sum -c -
  tar xf boost-1.84.0.tar.gz
fi
cd boost-1.84.0
# asio (header-only) linkt context/coroutine bedingungslos — die bauen unter WASM
# nicht (Assembler-fcontext) und werden von libslic3r/Boost.Log nie instanziiert.
sed -i '/Boost::context$/d;/Boost::coroutine$/d' libs/asio/CMakeLists.txt
emcmake cmake -B build-wasm -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DBUILD_SHARED_LIBS=OFF \
  -DBOOST_EXCLUDE_LIBRARIES="contract;fiber;numpy;stacktrace;wave;test;context;coroutine;cobalt;python;mpi;graph_parallel;process" \
  -DBOOST_LOCALE_ENABLE_ICU=OFF \
  -DBUILD_TESTING=OFF \
  -DCMAKE_C_FLAGS="-pthread -fexceptions" \
  -DCMAKE_CXX_FLAGS="-pthread -fexceptions" \
  -DCMAKE_POSITION_INDEPENDENT_CODE=OFF
cmake --build build-wasm -j12
cmake --install build-wasm
echo "BOOST-WASM-OK"
