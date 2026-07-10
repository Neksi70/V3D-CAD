# OrcaSlicer → Browser (WASM) — Fahrplan

Ziel: Der komplette Orca-Slicing-Kern (`libslic3r`) läuft als WebAssembly im
Browser. Die wxWidgets-GUI wird NICHT portiert (nicht portierbar) — stattdessen
eigene Web-UI (Three.js, Wiederverwendung aus Volme3D).

## Stand
- Quelle: OrcaSlicer v2.3.0 (70931e5), shallow clone in `OrcaSlicer/`
- Toolchain: emsdk 6.0.2 in `~/emsdk` (aktivieren: `source ~/emsdk/emsdk_env.sh`)
- Maschine: 12 Kerne, 60 GB RAM, 360 GB frei — reicht dicke

## Lizenz
OrcaSlicer ist **AGPL-3.0**. Die Browser-Ableitung muss bei Veröffentlichung
(auch SaaS/Funnel!) im Quelltext offengelegt werden. Kein Minify-als-Schutz wie
bei volme3d.dist.html — Minify ok, aber Quelle muss verlinkt sein.

## Meilensteine (= Task-Liste in Claude)
- **M0** Toolchain + Inventur ✓
- **M1** Dependencies nach WASM → `wasm-deps/` ✓
- **M2** libslic3r kompiliert ✓ (liblibslic3r.a 46 MB; Stubs: STEP/SVG/3D-Text
  (OCCT), Hollowing (OpenVDB), OBJ-Farben (OpenCV), PostProcessor-Skripte)
- **M3** E2E ✓ — STL→G-Code in Node UND Browser (100 Layer/0,4s, 8 Threads)
- **M4** ✓ — Threads/TBB ✓, Profile via sliceSTLWithProfiles (inherits-Kette
  JS-seitig, load_from_json C++-seitig) ✓, OCCT: STEP ✓ + SVG ✓ (Tests
  step-test.mjs/svg-test.mjs; cube20.step via occt-server stl2step).
  Offen→M5: 3D-Text funktional (braucht Fonts), Multi-Objekt, Stützen-Verify
- **M5** Web-UI: Plater, Profileditor, G-Code-Preview (Viewer-Kern existiert
  schon in test/index.html: Layer-Slider, Feature-Farben, Orbit)

## Dependency-Inventur (libslic3r, aus src/libslic3r/CMakeLists.txt)

### Bundled im Orca-Baum (kompilieren einfach mit)
admesh, clipper, Clipper2, libnest2d, miniz, qhull, semver, glu-libtess,
mcut, qoi, libnoise, libigl (header), cereal (header), Eigen (header), agg, ankerl

### Extern — müssen mit Emscripten gebaut werden
| Dep | Version (Orca-Pin) | WASM-Weg |
|---|---|---|
| Boost | 1.84.0 | b2 toolset=emscripten; braucht: system filesystem thread log locale regex iostreams date_time |
| oneTBB | 2021.5 → **2021.13 nehmen** | 2021.5 kann kein Emscripten; ab ~2021.9 offizieller Support |
| ZLIB/PNG/JPEG/FreeType/EXPAT | div. | emscripten ports (`-sUSE_ZLIB` etc.) oder Eigenbau |
| GMP | 6.2.1 | emconfigure, bekannte Configs (--disable-assembly) |
| MPFR | 4.2.1 | emconfigure, gegen GMP-wasm |
| CGAL | 5.4 | header-only, braucht GMP+MPFR |
| NLopt | 1.4 (deps) | cmake, unkritisch |
| OCCT | 7.6 (deps) | **erst M4**; Volme3D-OCCT-WASM-Erfahrung nutzen. Hängt dran: STEP-Import UND SVG-Import (Format/svg.cpp baut Wires via OCCT) |
| OpenVDB | — | **stubben** (nur OpenVDBUtils.cpp = SLA-Hollowing) |
| OpenCV | — | **stubben** (nur ObjColorUtils.hpp = OBJ-Farbimport) |
| fontconfig | — | stubben/weglassen (Font-Handling im Browser anders) |

### GUI-only (fällt komplett weg)
wxWidgets, GLEW, GLFW, OpenGL, WebView2, CURL(?), OpenSSL(?), Blosc, OpenEXR

## Gefixte Portierungsfehler (M2, als Referenz für ähnliche Fälle)
- Boost.Log→asio→context/coroutine: asio-CMake linkt sie unconditional, sind aber
  header-only-Nutzung → aus libs/asio/CMakeLists.txt entfernt (01-boost.sh sed)
- encoding-check: Host-Tool, als .js nicht ausführbar → SLIC3R_ENC_CHECK off
- openssl/md5.h: eigener Shim src/wasm/compat/openssl/md5.h (RFC 1321, verifiziert)
- CGAL 5.4 inkompatibel Clang 21 (iterator.h "no member base") → 5.6.2
- wasm32-size_t: GCode.hpp LayerResult-Sentinel coord_t::max→size_t::max
- Eigen lazy cast: AABBTreeLines.hpp Cast-Ausdruck vor Übergabe materialisieren
- boost/process im PostProcessor: __EMSCRIPTEN__-Guard, run_script → -1
- STEP.hpp/svg.hpp nicht self-contained: Model.hpp zuerst includen
- pthread_setname_np fehlt in Emscripten-musl: Thread.cpp no-op-Zweig
- name_tbb_thread_pool_threads_set_locale(): Spin-Barriere über max_concurrency()
  Worker → Deadlock (global_control senkt max_concurrency nicht!) → Skip im WASM
- TBB braucht global_control ≤ PTHREAD_POOL_SIZE (8): Worker können nicht
  nachstarten, solange Main synchron im Slice steckt
- **Upstream-Bug** Config.hpp:1654: ConfigOptionEnumsGenericTempl{il}-Ctor hatte
  keys_map(keys_map) SELBST-Init → im WASM Endlosschleife in serialize_single_value
  (nativ nur durch zufällige Null-Pages gutartig). Gefixt + Null-Guard.
  → Kandidat für Upstream-Issue/PR an SoftFever/OrcaSlicer!
- embind: STL-Binärdaten als Uint8Array/val übergeben, nie als std::string (UTF-8!)

## Bekannte offene Punkte
- CONFIG_BLOCK im G-Code: coEnums-Keys (overhang_fan_threshold, z_hop_types,
  retract_lift_enforce) serialisieren als Int statt Label — keys_map fehlt im
  full_print_config-Pfad. Kosmetisch; fixen in M4.

## Bekannte Fallen
- WASM-Threads ⇒ SharedArrayBuffer ⇒ COOP/COEP-Header auf nginx + Funnel testen
- 32-bit-Adressraum: großes Modell + Voxel = Speicherlimit ~4 GB (MEMORY64 als Ausweg, langsamer)
- Erst single-threaded ans Laufen bringen, Threads sind M4
- `Print::process()` wirft Exceptions → Emscripten Exception-Support anschalten (-fexceptions, Kostenpunkt Performance)
- localization (gettext) im Kern: stubben oder mitkompilieren

## Verzeichnislayout
```
~/orca-wasm/
  OrcaSlicer/     # Upstream v2.3.0, unsere Patches als Commits obendrauf
  wasm-deps/      # Install-Prefix aller emscripten-gebauten Deps
  build-deps/     # Build-Verzeichnisse der Deps
  wrapper/        # embind-Wrapper + eigenes CMakeLists für M3
  web/            # M5: Browser-UI
  ROADMAP.md
```
