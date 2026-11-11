#!/usr/bin/env python3
"""Projektprofile der Orca-Ableger für den 3MF-Export von V3D CAD → ~/slicer-projekt/<Hersteller>.json

Gegenstück zu bau_bambu_projekt.py (Bambu Studio): OrcaSlicer, Anycubic Slicer Next,
Snapmaker Orca und ElegooSlicer öffnen eine 3MF nur dann als PROJEKT, wenn
Metadata/project_settings.config vollständig ist. Quelle sind die Orca-Systemprofile
des V3D Slicers (~/orca-wasm/profiles-merged), inherits-Ketten aufgelöst.

Je Hersteller aus druckerliste.json eine Datei (lädt V3D CAD erst bei Bedarf), Aufbau wie
bambu-projekt.json: maschine/prozess/filament als Basis + Abweichung, drucker → Prozess je
Schichthöhe + Filament je Typ der Druck-Vorschau.
Kompatibel = letztes compatible_printers der Kette enthält den Drucker oder ist leer
(wie presetCompatible im V3D Slicer). Neu bauen, wenn die Slicer-Profile aktualisiert wurden."""
import json, os, re, sys
from collections import Counter

P = os.path.expanduser('~/orca-wasm/profiles-merged')
ZIEL = os.path.expanduser('~/slicer-projekt')
TYPEN = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PLA-CF', 'PETG-CF', 'PA']
WEG = {'inherits', 'instantiation', 'setting_id', 'name', 'type', 'from', 'description', 'renamed_from'}
SONDER = re.compile(r'\b(CF|GF|HF|ESD|Silk|Matte|Support|Translucent|Glow|Marble|Wood|Galaxy|Sparkle|Metal|Metallic|Aero|Lite|'
                    r'Tough|Dynamic|Rapid|Speed|SnapSpeed|High Speed|Celestial|Luminous|Neon|Satin|Starlight|Dual|J1|HS|Hyper|Fast|Pro|PPS|\+)(?![A-Za-z])', re.I)


def index(vendor, art):
    """Name → (Profil, Datei) aus <Vendor>.json-Liste (wie der Slicer), plus Orca-Filamentbibliothek als Eltern."""
    m = {}
    for v in ([vendor] + (['OrcaFilamentLibrary'] if art == 'filament' else [])):
        try:
            liste = json.load(open(os.path.join(P, v + '.json')))[art + '_list']
        except Exception:
            continue
        for e in liste:
            try:
                d = json.load(open(os.path.join(P, v, e['sub_path'])))
            except Exception:
                continue
            m.setdefault(d.get('name', e['name']), (d, v))
    return m


def flach(idx, name):
    kette, n = [], name
    while n:
        if n not in idx:
            raise KeyError(f'{name}: Elternprofil {n} fehlt')
        kette.append(idx[n][0]); n = idx[n][0].get('inherits')
    r, compat = {}, None
    for d in reversed(kette):
        r.update(d)
        if 'compatible_printers' in d:
            compat = d['compatible_printers']
    return r, compat


def sauber(d):
    return {k: v for k, v in d.items() if k not in WEG}


def kompakt(dicts):
    zaehl = {}
    for d in dicts.values():
        for k, v in d.items():
            zaehl.setdefault(k, Counter())[json.dumps(v, sort_keys=True)] += 1
    basis = {k: json.loads(c.most_common(1)[0][0]) for k, c in zaehl.items()}
    je = {}
    for n, d in dicts.items():
        e = {k: v for k, v in d.items() if json.dumps(v, sort_keys=True) != json.dumps(basis[k], sort_keys=True)}
        ohne = [k for k in basis if k not in d]
        if ohne:
            e['_ohne'] = ohne
        je[n] = e
    return {'basis': basis, 'je': je}


def baue(vendor, drucker):
    M, PR, F = index(vendor, 'machine'), index(vendor, 'process'), index(vendor, 'filament')
    marke = vendor.lower() if vendor != 'BBL' else 'bambu'

    def instanzen(idx, nur_eigene):
        out = {}
        for n, (d, quelle) in idx.items():
            if str(d.get('instantiation')) != 'true' or (nur_eigene and quelle != vendor):
                continue
            try:
                out[n] = flach(idx, n)
            except KeyError:
                pass
        return out
    pr_flach, fi_flach = instanzen(PR, True), instanzen(F, False)
    passt = lambda compat, mn: not compat or mn in compat
    rang = lambda n: (6 if 'Standard' in n else 5 if re.search('Optimal|Balanced', n) else
                      4 if re.search('Fine|Draft', n) else 3 if 'High Quality' in n else 1) - (5 if re.search('benchy|support|strength|speed', n, re.I) else 0)

    def f_rang(n, typ, mn):
        kurz = re.sub(r'\s*\(?[0-9.]+\s*nozzle\)?\s*$', '', mn)
        rest = n.split(' @')[0].replace(typ, '')   # „PLA-CF“ selbst ist keine Sondersorte
        return ((6 if re.search(r'(?<![A-Za-z])' + re.escape(typ) + r'(?![A-Za-z-])', n.split(' @')[0]) else 0) + (4 if kurz in n else 0) + (3 if n.lower().startswith(marke) else 0) + (2 if re.search('Generic|Basic', n) else 0)
                - (4 if SONDER.search(rest) else 0) - len(n) / 100)

    out = {'quelle': 'Orca-Profile ' + vendor + ' ' + json.load(open(os.path.join(P, vendor + '.json'))).get('version', '?'),
           'maschine': {}, 'prozess': {}, 'filament': {}, 'drucker': {}}
    for mn in drucker:
        if mn not in M:
            print('  fehlt:', mn, file=sys.stderr); continue
        try:
            mf, _ = flach(M, mn)
        except KeyError as e:
            print('  ', e, file=sys.stderr); continue
        procs = {}
        # alle Schichthöhen, die es für diesen Drucker gibt (0,2er/0,6er Düsen haben andere Stufen), je Höhe das beste Profil
        je_lh = {}
        for n, (d, c) in pr_flach.items():
            try:
                lh = float(d.get('layer_height', 0) or 0)
            except ValueError:
                continue
            if lh > 0 and passt(c, mn):
                je_lh.setdefault(('%.3f' % lh).rstrip('0').rstrip('.'), []).append(n)
        for lh, kand in je_lh.items():
            kand.sort(key=lambda n: (-rang(n), len(n)))
            procs[lh] = kand[0]; out['prozess'][kand[0]] = sauber(pr_flach[kand[0]][0])
        fils = {}
        for typ in TYPEN:
            def ftyp(d):
                t = d.get('filament_type', '')
                return (t[0] if isinstance(t, list) and t else t or '').upper()
            kand = [n for n, (d, c) in fi_flach.items() if passt(c, mn) and ftyp(d) == typ]
            kand.sort(key=lambda n: -f_rang(n, typ, mn))
            if kand:
                fils[typ] = kand[0]; out['filament'][kand[0]] = sauber(fi_flach[kand[0]][0])
        if not procs or not fils:
            print('  unvollständig:', mn, 'Prozesse', len(procs), 'Filamente', len(fils), file=sys.stderr)
            if not procs or 'PLA' not in fils and not fils:
                continue
        out['maschine'][mn] = sauber(mf)
        out['drucker'][mn] = {'prozess': procs, 'filament': fils}
    for art in ('maschine', 'prozess', 'filament'):
        out[art] = kompakt(out[art])
    return out


def main():
    os.makedirs(ZIEL, exist_ok=True)
    liste = json.load(open(os.path.expanduser('~/druckerliste.json')))
    gesamt = 0
    for v in liste:
        r = baue(v['v'], [m['n'] for m in v['drucker']])
        ziel = os.path.join(ZIEL, v['v'] + '.json')
        json.dump(r, open(ziel, 'w'), ensure_ascii=False, separators=(',', ':'))
        gesamt += os.path.getsize(ziel)
        print(f"{v['v']:12} {len(r['drucker']):3}/{len(v['drucker']):3} Drucker, {len(r['prozess']['je']):3} Prozesse, "
              f"{len(r['filament']['je']):3} Filamente, {os.path.getsize(ziel) // 1024} KB")
    print('zusammen', gesamt // 1024, 'KB →', ZIEL)


if __name__ == '__main__':
    main()
