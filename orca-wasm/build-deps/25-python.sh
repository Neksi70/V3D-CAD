#!/bin/bash
# CPython 3.12.13 (= deps/python3 in OrcaSlicer 2.5) für den headless Plugin-Host in orca_native.
# Shared-Build in eigenen Prefix; RPATH auf $PREFIX/lib, damit orca_native ihn ohne LD_LIBRARY_PATH findet.
set -euo pipefail
SRC=$HOME/orca-wasm/build-deps
PREFIX=$HOME/orca-wasm/python312
V=3.12.13
cd "$SRC"
[ -f Python-$V.tar.xz ] || wget -q https://www.python.org/ftp/python/$V/Python-$V.tar.xz
echo "c08bc65a81971c1dd5783182826503369466c7e67374d1646519adf05207b684  Python-$V.tar.xz" | sha256sum -c -
[ -d Python-$V ] || tar xJf Python-$V.tar.xz
cd Python-$V
./configure --prefix="$PREFIX" --enable-shared --without-ensurepip \
  LDFLAGS="-Wl,-rpath,$PREFIX/lib" >/dev/null
make -j12 >/dev/null
make install >/dev/null
"$PREFIX/bin/python3.12" -c "import sys, json, math; print('PYTHON-OK', sys.version)"
