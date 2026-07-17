#!/usr/bin/env python3
"""Bindet die ausgelagerten G-Code-Templates in die Bambu-Maschinenprofile ein.

Neuere BBL-Profile (H2C/H2D/…) tragen machine_start_gcode & Co. NICHT direkt,
sondern in separaten Presets "<Maschine> template <feld>". OrcaSlicer/BambuStudio
setzt sie zur Slice-Zeit ein; unser nativer Slicer kennt diesen Mechanismus
nicht → er nahm den generischen fdm_machine_common-Default (kein AMS-Laden,
keine Kalibrierung → Düse zu hoch, kein Filament).

Dieses Skript kopiert die Template-Inhalte fest ins Maschinenprofil, sofern das
Feld dort leer/null ist und ein passendes Template existiert. Idempotent —
nach jedem Neu-Mergen der Profile erneut laufen lassen.
"""
import json, os, glob

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'BBL', 'machine')
FIELDS = ['machine_start_gcode', 'machine_end_gcode', 'change_filament_gcode',
          'layer_change_gcode', 'time_lapse_gcode', 'wrapping_detection_gcode']


def is_empty(v):
    return v is None or (isinstance(v, str) and not v.strip())


def main():
    patched = 0
    for path in sorted(glob.glob(os.path.join(BASE, '*.json'))):
        name = os.path.basename(path)[:-5]
        if ' template ' in name:
            continue
        try:
            prof = json.load(open(path))
        except (OSError, ValueError):
            continue
        if prof.get('type') != 'machine' or not str(prof.get('name', '')).startswith('Bambu'):
            continue
        changed = []
        for field in FIELDS:
            if not is_empty(prof.get(field)):
                continue
            tmpl_path = os.path.join(BASE, f"{prof['name']} template {field}.json")
            if not os.path.exists(tmpl_path):
                continue
            try:
                tmpl = json.load(open(tmpl_path))
            except (OSError, ValueError):
                continue
            val = tmpl.get(field)
            if is_empty(val):
                continue
            prof[field] = val
            changed.append(field)
        if changed:
            with open(path, 'w') as f:
                json.dump(prof, f, ensure_ascii=False, indent=1)
            patched += 1
            print(f'  {prof["name"]}: {", ".join(changed)}')
    print(f'{patched} Profil(e) gepatcht.')


if __name__ == '__main__':
    main()
