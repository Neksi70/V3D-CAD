#!/bin/bash
# Prüft eigene Profile mit dem ECHTEN Profil-Lader von OrcaSlicer (PresetBundle::load_presets aus libslic3r,
# gleicher Code wie Snapmaker Orca/Elegoo/Sovol/Anycubic Next, Herkunft Bambu Studio).
# Aufruf: tests/preset_check.sh <datenordner>   (darin user/default/process|filament/*.json)
# Baut das Programm bei Bedarf gegen ~/orca-wasm/OrcaSlicer/build-native (Schalter wie orca_native) und legt
# BBL + OrcaFilamentLibrary als Herstellerprofile in <datenordner>/system an.
set -e
H=$(cd "$(dirname "$0")" && pwd); B=$HOME/orca-wasm/OrcaSlicer/build-native/src/wasm; R=$HOME/orca-wasm/OrcaSlicer/resources
EXE=/tmp/v3d-preset-check
if [ ! -x $EXE ]; then
  F=$B/CMakeFiles/orca_native.dir/flags.make
  eval c++ $(grep '^CXX_DEFINES' $F | cut -d= -f2-) $(grep '^CXX_INCLUDES' $F | cut -d= -f2-) $(grep '^CXX_FLAGS' $F | cut -d= -f2-) -c $H/preset_check.cpp -o $EXE.o
  (cd $B && eval $(sed "s#CMakeFiles/orca_native.dir/slicer_native.cpp.o CMakeFiles/orca_native.dir/nanosvg_impl.cpp.o -o orca_native#$EXE.o CMakeFiles/orca_native.dir/nanosvg_impl.cpp.o -o $EXE#" CMakeFiles/orca_native.dir/link.txt) -lz)
fi
D=$1; mkdir -p $D/system
for v in BBL OrcaFilamentLibrary; do [ -e $D/system/$v ] || ln -s $R/profiles/$v $D/system/$v; cp $R/profiles/$v.json $D/system/; done
$EXE $D $R 2>/dev/null | grep -v '^\['
