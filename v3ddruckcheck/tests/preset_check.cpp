// Lädt Profile genau wie der Slicer beim Start (PresetBundle::load_presets) und listet die eigenen.
#include "libslic3r/libslic3r.h"
#include "libslic3r/PresetBundle.hpp"
#include "libslic3r/AppConfig.hpp"
#include "libslic3r/Utils.hpp"
#include <iostream>
using namespace Slic3r;
int main(int argc, char **argv) {
    set_data_dir(argv[1]); set_resources_dir(argv[2]);
    AppConfig cfg;
    PresetBundle b;
    try { b.load_presets(cfg, ForwardCompatibilitySubstitutionRule::EnableSilent); }
    catch (const std::exception &e) { std::cout << "FEHLER " << e.what() << "\n"; return 2; }
    int n = 0;
    auto dump = [&](PresetCollection &c, const char *t) {
        for (const Preset &p : c) if (p.is_user()) {
            n++; std::cout << t << " | " << p.name << " | inherits=" << p.inherits() << " | visible=" << p.is_visible;
            for (auto k : {"wall_loops", "sparse_infill_density", "layer_height", "textured_plate_temp", "nozzle_temperature", "filament_type"})
                if (p.config.has(k)) std::cout << " " << k << "=" << p.config.opt_serialize(k);
            std::cout << "\n";
        }
    };
    dump(b.prints, "process"); dump(b.filaments, "filament");
    std::cout << "eigene Profile: " << n << "\n";
    return 0;
}
