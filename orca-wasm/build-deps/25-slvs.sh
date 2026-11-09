#!/bin/bash
# libslvs (SolveSpace-Constraint-Solver, GPLv3) für den 2.5-CAD-Kern (SLIC3R_CAD) — wie deps/SLVS.
# Aufruf: 25-slvs.sh native|wasm
set -euo pipefail
MODE=${1:?native|wasm}
SRC=$HOME/orca-wasm/build-deps
ORCA=$HOME/orca-wasm/OrcaSlicer-migrate
cd "$SRC"
if [ "$MODE" = native ]; then
  PREFIX=$HOME/orca-wasm/native-deps-25; CM="cmake"; BD=bn25; FLAGS="-O2 -fPIC"
else
  PREFIX=$HOME/orca-wasm/wasm-deps-25; source ~/emsdk/emsdk_env.sh >/dev/null
  CM="emcmake cmake"; BD=bw25; FLAGS="-O2 -fexceptions -pthread"
fi
REV=4d8704523e4bf212fadf5189f92484244f670fea
[ -f slvs-$REV.zip ] || wget -q https://github.com/JacobStoren/SolveSpaceLib/archive/$REV.zip -O slvs-$REV.zip
echo "1c4bdde9c3c6ef20ea4b50b73601de56769f2eb131b36927d7c6489f102e6c30  slvs-$REV.zip" | sha256sum -c -
if [ ! -d SolveSpaceLib-$REV ]; then
  unzip -q slvs-$REV.zip
  cp "$ORCA/deps/SLVS/CMakeLists.txt.in" SolveSpaceLib-$REV/CMakeLists.txt
fi
cd SolveSpaceLib-$REV
$CM -B $BD -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DCMAKE_C_FLAGS="$FLAGS" -DCMAKE_CXX_FLAGS="$FLAGS" >/dev/null
cmake --build $BD -j12
cmake --install $BD >/dev/null
echo "SLVS-OK ($MODE)"
