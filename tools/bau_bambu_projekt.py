#!/usr/bin/env python3
"""Bambu-Projektprofile für den 3MF-Export von V3D CAD → ~/bambu-projekt.json

Damit Bambu Studio eine CAD-3MF als PROJEKT öffnet (und nicht „nur Geometrie
importiert"), braucht die 3MF eine vollständige Metadata/project_settings.config
mit den Namen echter System-Profile. Quelle sind die Profile, die Bambu Studio
selbst mitbringt (~/tools/bambustudio/…/profiles/BBL), inherits-Ketten aufgelöst.

Je Drucker (Namen = druckerliste.json): Maschinenprofil, je Schichthöhe der
passende Prozess, je Filamenttyp der Druck-Vorschau das Bambu-Filament.
Gespeichert als Basis + Abweichung, damit die Datei klein bleibt.
Neu bauen, wenn Bambu Studio aktualisiert wurde."""
import json, os, re, sys
from collections import Counter

P = os.path.expanduser('~/tools/bambustudio/squashfs-root/resources/profiles/BBL')
ZIEL = os.path.expanduser('~/bambu-projekt.json')
SCHICHTEN = ['0.08', '0.12', '0.16', '0.2', '0.24', '0.28']
# Filamenttypen wie in der Druck-Vorschau (_DV_FIL) → Bambu-Profile in Vorzugs-Reihenfolge
FILAMENT = {
    'PLA': ['Bambu PLA Basic', 'Generic PLA'],
    'PETG': ['Bambu PETG HF', 'Bambu PETG Basic', 'Generic PETG'],
    'ABS': ['Bambu ABS', 'Generic ABS'],
    'ASA': ['Bambu ASA', 'Generic ASA'],
    'TPU': ['Bambu TPU 95A HF', 'Generic TPU', 'Bambu TPU 95A'],
    'PLA-CF': ['Bambu PLA-CF', 'Generic PLA-CF'],
    'PETG-CF': ['Bambu PETG-CF', 'Generic PETG-CF'],
    'PA': ['Bambu PAHT-CF', 'Generic PA', 'Generic PA-CF'],
}
WEG = {'inherits', 'instantiation', 'setting_id', 'name', 'type', 'from', 'description',
       'renamed_from'}


def index(sub):
    m = {}
    for root, _, fs in os.walk(os.path.join(P, sub)):
        for f in fs:
            if not f.endswith('.json'):
                continue
            try:
                d = json.load(open(os.path.join(root, f)))
            except Exception:
                continue
            if 'name' in d:
                m[d['name']] = d
    return m


def flach(idx, name):
    kette, n = [], name
    while n:
        if n not in idx:
            raise KeyError(f'{name}: Elternprofil {n} fehlt')
        kette.append(idx[n]); n = idx[n].get('inherits')
    r = {}
    for d in reversed(kette):
        r.update(d)
    return r


def sauber(d):
    return {k: v for k, v in d.items() if k not in WEG}


def main():
    M, PR, F = index('machine'), index('process'), index('filament')
    liste = json.load(open(os.path.expanduser('~/druckerliste.json')))
    drucker = [m['n'] for v in liste if v['v'] == 'BBL' for m in v['drucker']]
    pr_flach = {n: flach(PR, n) for n, d in PR.items() if str(d.get('instantiation')) == 'true'}
    fi_flach = {n: flach(F, n) for n, d in F.items() if str(d.get('instantiation')) == 'true'}

    def passt(prof, maschine):
        return maschine in (prof.get('compatible_printers') or [])

    def rang(n):
        return (6 if 'Standard' in n else 5 if re.search('Optimal|Balanced', n) else
                4 if re.search('Fine|Draft', n) else 3 if 'High Quality' in n else 1)

    out = {'quelle': 'Bambu Studio ' + json.load(open(P + '.json')).get('version', '?'),
           'maschine': {}, 'prozess': {}, 'filament': {}, 'drucker': {}}
    for mn in drucker:
        if mn not in M:
            print('  fehlt in Bambu Studio:', mn, file=sys.stderr); continue
        mf = flach(M, mn)
        procs = {}
        for lh in SCHICHTEN:
            kand = [n for n, d in pr_flach.items() if passt(d, mn)
                    and abs(float(d.get('layer_height', 0)) - float(lh)) < 1e-4]
            kand.sort(key=lambda n: (-rang(n), len(n)))
            if kand:
                procs[lh] = kand[0]; out['prozess'][kand[0]] = sauber(pr_flach[kand[0]])
        fils = {}
        for typ, wunsch in FILAMENT.items():
            for w in wunsch:
                kand = [n for n, d in fi_flach.items() if passt(d, mn) and n.split(' @')[0] == w]
                if kand:
                    fils[typ] = kand[0]; out['filament'][kand[0]] = sauber(fi_flach[kand[0]]); break
        out['maschine'][mn] = sauber(mf)
        out['drucker'][mn] = {'prozess': procs, 'filament': fils}

    # Basis + Abweichung: je Art der häufigste Wert je Schlüssel
    for art in ('maschine', 'prozess', 'filament'):
        dicts = out[art]
        zaehl = {}
        for d in dicts.values():
            for k, v in d.items():
                zaehl.setdefault(k, Counter())[json.dumps(v, sort_keys=True)] += 1
        basis = {k: json.loads(c.most_common(1)[0][0]) for k, c in zaehl.items()}
        out[art] = {'basis': basis, 'je': {n: {k: v for k, v in d.items() if json.dumps(v, sort_keys=True) != json.dumps(basis[k], sort_keys=True)}
                                          | {'_ohne': [k for k in basis if k not in d]} for n, d in dicts.items()}}
        for e in out[art]['je'].values():
            if not e['_ohne']:
                del e['_ohne']
    json.dump(out, open(ZIEL, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(ZIEL, len(out['drucker']), 'Drucker,', len(out['prozess']['je']), 'Prozesse,',
          len(out['filament']['je']), 'Filamente,', os.path.getsize(ZIEL) // 1024, 'KB')
    ohne = [(m, t) for m, d in out['drucker'].items() for t in FILAMENT if t not in d['filament']]
    if ohne:
        print('  ohne Bambu-Filament:', ohne[:12], '…' if len(ohne) > 12 else '')


if __name__ == '__main__':
    main()
