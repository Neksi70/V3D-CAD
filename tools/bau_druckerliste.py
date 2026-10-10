#!/usr/bin/env python3
"""Druckerliste für die Druck-Vorschau in V3D CAD aus den V3D-Slicer-Profilen
(~/orca-wasm/profiles-merged) bauen → ~/druckerliste.json.
Je Drucker: Name (= exakter Slicer-Profilname, wird an den V3D Slicer übergeben),
Modell, Bettgröße (printable_area) und Bauhöhe — inherits-Ketten werden aufgelöst.
Neu bauen, wenn die Slicer-Profile aktualisiert wurden."""
import json, os, re
P = os.path.expanduser('~/orca-wasm/profiles-merged')
HERSTELLER = [('BBL', 'Bambu Lab'), ('Snapmaker', 'Snapmaker'), ('Anycubic', 'Anycubic'), ('Elegoo', 'Elegoo'),
              ('Prusa', 'Prusa'), ('Creality', 'Creality'), ('Flashforge', 'Flashforge'), ('Qidi', 'Qidi'),
              ('Sovol', 'Sovol'), ('Voron', 'Voron'), ('Artillery', 'Artillery'), ('Anker', 'Anker')]

def lade(vendor):
    idx = json.load(open(os.path.join(P, vendor + '.json')))
    byname = {}
    for key in ('machine_list', 'machine_model_list'):
        for e in idx.get(key, []):
            try: byname[e['name']] = json.load(open(os.path.join(P, vendor, e['sub_path'])))
            except Exception: pass
    return idx, byname

def feld(byname, prof, key, tiefe=0):
    if key in prof or tiefe > 12: return prof.get(key)
    par = prof.get('inherits')
    if par and par in byname: return feld(byname, byname[par], key, tiefe + 1)
    # Basisprofile anderer Hersteller (fdm_machine_common …) liegen in OrcaFilamentLibrary/… nicht hier
    return None

out = []
for vendor, label in HERSTELLER:
    if not os.path.exists(os.path.join(P, vendor + '.json')): continue
    idx, byname = lade(vendor)
    liste = []
    for e in idx.get('machine_list', []):
        j = byname.get(e['name'])
        if not j or str(j.get('instantiation')) == 'false': continue
        if ' template ' in e['name']: continue
        area = feld(byname, j, 'printable_area') or []
        h = feld(byname, j, 'printable_height')
        try:
            xs = [float(s.split('x')[0]) for s in area]; ys = [float(s.split('x')[1]) for s in area]
            w, d = round(max(xs) - min(xs)), round(max(ys) - min(ys))
        except Exception: w = d = None
        try: h = round(float(h[0] if isinstance(h, list) else h))
        except Exception: h = None
        noz = feld(byname, j, 'nozzle_diameter'); noz = noz[0] if isinstance(noz, list) and noz else noz
        if not (w and d and h): continue
        liste.append({'n': e['name'], 'm': j.get('printer_model') or e['name'], 'w': w, 'd': d, 'h': h, 'noz': str(noz or '0.4')})
    liste.sort(key=lambda m: (m['m'], m['n']))
    if liste: out.append({'v': vendor, 'l': label, 'drucker': liste})
ziel = os.path.expanduser('~/druckerliste.json')
json.dump(out, open(ziel, 'w'), ensure_ascii=False, separators=(',', ':'))
print(ziel, sum(len(x['drucker']) for x in out), 'Drucker,', os.path.getsize(ziel) // 1024, 'KB')
for x in out: print(' ', x['l'], len(x['drucker']))
