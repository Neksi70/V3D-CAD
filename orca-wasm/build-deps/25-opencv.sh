#!/bin/bash
# OpenCV 4.14.0 (wie deps/OpenCV in OrcaSlicer 2.5): core+imgproc+imgcodecs als opencv_world, statisch.
# 2.5 braucht es im KERN (TexturePainting/TextureToColor/AssimpImport/OBJ-Texturen), nicht mehr nur GUI.
# Aufruf: 25-opencv.sh native|wasm
set -euo pipefail
MODE=${1:?native|wasm}
SRC=$HOME/orca-wasm/build-deps
cd "$SRC"
if [ "$MODE" = native ]; then
  PREFIX=$HOME/orca-wasm/native-deps-25; CM="cmake"; BD=bn25
  FLAGS="-O2 -fPIC"; EXTRA=(-DCMAKE_POSITION_INDEPENDENT_CODE=ON)
else
  PREFIX=$HOME/orca-wasm/wasm-deps-25; source ~/emsdk/emsdk_env.sh >/dev/null
  CM="emcmake cmake"; BD=bw25
  # kein SIMD-Dispatch/Threads im WASM-OpenCV (Orca ruft es nur seriell für Textur-Atlanten)
  FLAGS="-O2 -fexceptions -pthread"
  EXTRA=(-DCMAKE_FIND_ROOT_PATH="$PREFIX" -DCV_ENABLE_INTRINSICS=OFF -DCPU_BASELINE= -DCPU_DISPATCH=
         -DWITH_PTHREADS_PF=OFF -DBUILD_opencv_dnn=OFF -DWITH_IPP=OFF)
fi
[ -f opencv-4.14.0.tar.gz ] || wget -q https://github.com/opencv/opencv/archive/refs/tags/4.14.0.tar.gz -O opencv-4.14.0.tar.gz
echo "ee8fb9b30eb60850431b4656447080e3737b56e45719c92b67f245950609f86e  opencv-4.14.0.tar.gz" | sha256sum -c -
[ -d opencv-4.14.0 ] || tar xzf opencv-4.14.0.tar.gz
cd opencv-4.14.0
$CM -B $BD -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_PREFIX_PATH="$PREFIX" \
  -DBUILD_SHARED_LIBS=0 -DBUILD_TESTS=OFF -DBUILD_PERF_TESTS=OFF -DBUILD_EXAMPLES=OFF -DBUILD_JAVA=OFF \
  -DBUILD_JASPER=OFF -DBUILD_JPEG=OFF -DBUILD_PNG=OFF -DBUILD_OPENEXR=OFF -DBUILD_TBB=OFF -DBUILD_WEBP=OFF \
  -DBUILD_ZLIB=OFF -DBUILD_TIFF=OFF -DBUILD_opencv_apps=OFF -DBUILD_opencv_highgui=OFF \
  -DBUILD_opencv_python2=OFF -DBUILD_opencv_python3=OFF \
  -DWITH_1394=OFF -DWITH_CUDA=OFF -DWITH_EIGEN=OFF -DWITH_IPP=OFF -DWITH_ITT=OFF -DWITH_FFMPEG=OFF \
  -DWITH_GPHOTO2=OFF -DWITH_GSTREAMER=OFF -DWITH_GTK=OFF -DWITH_JASPER=OFF -DWITH_LAPACK=OFF \
  -DWITH_OPENCL=OFF -DWITH_OPENEXR=OFF -DWITH_OPENJPEG=OFF -DWITH_QUIRC=OFF -DWITH_VTK=OFF \
  -DWITH_JPEG=ON -DWITH_PNG=ON -DWITH_WEBP=OFF -DWITH_TIFF=OFF -DWITH_AVIF=OFF -DWITH_IMGCODEC_GIF=OFF \
  -DWITH_KLEIDICV=OFF -DWITH_ADE=OFF -DWITH_PROTOBUF=OFF -DWITH_OPENVINO=OFF -DWITH_TBB=OFF \
  -DENABLE_PRECOMPILED_HEADERS=OFF -DOPENCV_GENERATE_SETUPVARS=OFF \
  -DBUILD_LIST=core,imgcodecs,imgproc,world -DBUILD_opencv_world=ON \
  -DCMAKE_C_FLAGS="$FLAGS" -DCMAKE_CXX_FLAGS="$FLAGS" "${EXTRA[@]}" >/dev/null
cmake --build $BD -j10
cmake --install $BD >/dev/null
echo "OPENCV-OK ($MODE)"
