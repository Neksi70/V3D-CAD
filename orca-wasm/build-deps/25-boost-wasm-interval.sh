#!/bin/bash
# Boost.Interval für wasm32 (wasm-deps-25): CGAL 6.2 zieht <boost/numeric/interval.hpp> über
# Surface_sweep_2/Default_arr_traits.h → Arr_rational_function_traits_2 herein (unbedingt, auch für
# OrcaSlicers VoronoiUtilsCgal). Boost kennt für wasm keine Rundungssteuerung (platform/wasm.hpp
# setzt BOOST_NO_FENV_H) → "Please specify rounding control mechanism". WebAssembly hat nur
# Round-to-nearest; OrcaSlicer instanziiert Boost.Interval nicht → wirkungslose Steuerung genügt,
# damit es kompiliert. Idempotent.
set -euo pipefail
H=$HOME/orca-wasm/wasm-deps-25/include/boost/numeric/interval/hw_rounding.hpp
grep -q "V3D-WASM-ROUNDING" "$H" && { echo "schon gepatcht"; exit 0; }
python3 - "$H" <<'EOF'
import sys
p = sys.argv[1]
s = open(p).read()
anchor = "#if defined(BOOST_NUMERIC_INTERVAL_NO_HARDWARE) && !defined(BOOST_NO_FENV_H)"
shim = '''// V3D-WASM-ROUNDING: WebAssembly kennt nur Round-to-nearest (keine Modus-Steuerung).
#if defined(BOOST_NUMERIC_INTERVAL_NO_HARDWARE) && defined(__wasm__)
#include <cmath>
namespace boost { namespace numeric { namespace interval_lib {
namespace detail {
struct wasm_rounding_control {
  typedef int rounding_mode;
  static void set_rounding_mode(rounding_mode) {}
  static void get_rounding_mode(rounding_mode &mode) { mode = 0; }
  static void downward() {}
  static void upward() {}
  static void to_nearest() {}
  static void toward_zero() {}
  template<class T> static T to_int(const T& r) { return std::nearbyint(r); }
};
} // namespace detail
template<> struct rounding_control<float> : detail::wasm_rounding_control
{ static float force_rounding(float const &r) { volatile float r_ = r; return r_; } };
template<> struct rounding_control<double> : detail::wasm_rounding_control
{ static double force_rounding(double const &r) { volatile double r_ = r; return r_; } };
template<> struct rounding_control<long double> : detail::wasm_rounding_control
{ static long double force_rounding(long double const &r) { volatile long double r_ = r; return r_; } };
}}} // namespace boost::numeric::interval_lib
#  undef BOOST_NUMERIC_INTERVAL_NO_HARDWARE
#endif

'''
assert s.count(anchor) == 1
open(p, 'w').write(s.replace(anchor, shim + anchor))
EOF
echo "gepatcht: $H"
