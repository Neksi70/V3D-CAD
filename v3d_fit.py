#!/usr/bin/env python3
"""🎯 Passprobe (Passung einmessen) — Korrekturwerte je Konto und Drucker.

Primär liegen die Werte im Browser (localStorage 'v3d_fitprofile'); der Server
gleicht sie nur zwischen Geräten ab (last-write-wins über geaendert_ts).
Werte in Slicer-Bedeutung (Orca/Bambu xy_*_compensation, je Seite in mm):
  loch   > 0 = Löcher größer drucken
  kontur > 0 = Außenkonturen größer drucken
Zugriff: jede Abfrage filtert auf die uid aus der Sitzung — nie aus dem Body.
Datei: ~/.config/volme3d/v3d.db (SQLite, WAL)
"""
import os
import json
import time
import uuid
import sqlite3
import threading

DB_PATH = os.environ.get('V3D_DB') or os.path.expanduser('~/.config/volme3d/v3d.db')
_lock = threading.Lock()
_bereit = False

_SCHEMA = '''
CREATE TABLE IF NOT EXISTS fit_profil (
  id             TEXT PRIMARY KEY,
  uid            TEXT NOT NULL,
  drucker        TEXT NOT NULL,
  duese_mm       REAL NOT NULL DEFAULT 0.4 CHECK (duese_mm BETWEEN 0.1 AND 2.0),
  material       TEXT NOT NULL DEFAULT 'PLA',
  loch_korr_mm   REAL NOT NULL DEFAULT 0 CHECK (loch_korr_mm BETWEEN -1 AND 1),
  kontur_korr_mm REAL NOT NULL DEFAULT 0 CHECK (kontur_korr_mm BETWEEN -1 AND 1),
  quelle         TEXT NOT NULL DEFAULT 'karte' CHECK (quelle IN ('karte','messschieber','hand')),
  messwerte      TEXT NOT NULL DEFAULT '{}',
  aktiv          INTEGER NOT NULL DEFAULT 1 CHECK (aktiv IN (0,1)),
  erstellt_ts    INTEGER NOT NULL,
  geaendert_ts   INTEGER NOT NULL,
  UNIQUE (uid, drucker, duese_mm, material)
);
CREATE INDEX IF NOT EXISTS fit_profil_uid ON fit_profil (uid, geaendert_ts);
'''

_FELDER = ('drucker', 'duese_mm', 'material', 'loch_korr_mm', 'kontur_korr_mm',
           'quelle', 'messwerte', 'aktiv', 'geaendert_ts')


def _con():
    global _bereit
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    if not _bereit:
        con.execute('PRAGMA journal_mode=WAL')
        con.executescript(_SCHEMA)
        _bereit = True
    return con


def _text(v, n=60):
    v = ''.join(ch for ch in str(v or '') if ch >= ' ' and ch not in '<>"\\')
    return ' '.join(v.split())[:n]


def _zahl(v, lo, hi, name):
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise ValueError(name + ' fehlt oder ist keine Zahl')
    if not (lo <= f <= hi):
        raise ValueError('%s muss zwischen %s und %s liegen' % (name, lo, hi))
    return round(f, 3)


def pruefen(b):
    """Request-Body → sauberer Datensatz (ValueError mit deutscher Meldung)."""
    if not isinstance(b, dict):
        raise ValueError('JSON-Objekt erwartet')
    d = {
        'drucker': _text(b.get('drucker')) or 'Standard',
        'duese_mm': _zahl(b.get('duese_mm', 0.4), 0.1, 2.0, 'Düse'),
        'material': _text(b.get('material'), 30) or 'PLA',
        'loch_korr_mm': _zahl(b.get('loch_korr_mm', 0), -1, 1, 'Loch-Korrektur'),
        'kontur_korr_mm': _zahl(b.get('kontur_korr_mm', 0), -1, 1, 'Kontur-Korrektur'),
        'quelle': b.get('quelle') if b.get('quelle') in ('karte', 'messschieber', 'hand') else 'hand',
        'messwerte': json.dumps(b.get('messwerte') if isinstance(b.get('messwerte'), dict) else {})[:2000],
        'aktiv': 0 if b.get('aktiv') in (0, False, '0') else 1,
        'geaendert_ts': int(b.get('geaendert_ts') or time.time()),
    }
    return d


def liste(uid):
    with _lock, _con() as con:
        rows = con.execute('SELECT * FROM fit_profil WHERE uid = ? ORDER BY geaendert_ts DESC', (uid,)).fetchall()
    out = []
    for r in rows:
        d = {k: r[k] for k in _FELDER}
        try:
            d['messwerte'] = json.loads(d['messwerte'])
        except ValueError:
            d['messwerte'] = {}
        d['aktiv'] = bool(d['aktiv'])
        out.append(d)
    return out


def speichern(uid, d):
    """Upsert. Rückgabe (ok, geaendert_ts_auf_dem_server). ok=False = Server hat Neueres."""
    jetzt = int(time.time())
    with _lock, _con() as con:
        alt = con.execute('SELECT geaendert_ts FROM fit_profil WHERE uid=? AND drucker=? AND duese_mm=? AND material=?',
                          (uid, d['drucker'], d['duese_mm'], d['material'])).fetchone()
        if alt and alt['geaendert_ts'] > d['geaendert_ts']:
            return False, alt['geaendert_ts']
        con.execute('''INSERT INTO fit_profil (id, uid, drucker, duese_mm, material, loch_korr_mm, kontur_korr_mm,
                         quelle, messwerte, aktiv, erstellt_ts, geaendert_ts)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                       ON CONFLICT (uid, drucker, duese_mm, material) DO UPDATE SET
                         loch_korr_mm=excluded.loch_korr_mm, kontur_korr_mm=excluded.kontur_korr_mm,
                         quelle=excluded.quelle, messwerte=excluded.messwerte, aktiv=excluded.aktiv,
                         geaendert_ts=excluded.geaendert_ts''',
                    (str(uuid.uuid4()), uid, d['drucker'], d['duese_mm'], d['material'], d['loch_korr_mm'],
                     d['kontur_korr_mm'], d['quelle'], d['messwerte'], d['aktiv'], jetzt, d['geaendert_ts']))
    return True, d['geaendert_ts']


def loeschen(uid, drucker, duese_mm, material):
    with _lock, _con() as con:
        n = con.execute('DELETE FROM fit_profil WHERE uid=? AND drucker=? AND duese_mm=? AND material=?',
                        (uid, drucker, duese_mm, material)).rowcount
    return n


def konto_loeschen(uid):
    """Für die Konto-Löschung (DSGVO): alle Profile der uid."""
    with _lock, _con() as con:
        return con.execute('DELETE FROM fit_profil WHERE uid=?', (uid,)).rowcount


if __name__ == '__main__':   # Selbsttest: python3 v3d_fit.py  (eigene Temp-DB)
    import tempfile
    DB_PATH = os.path.join(tempfile.mkdtemp(), 't.db')
    d = pruefen({'drucker': 'A1 / P1S / X1C', 'loch_korr_mm': 0.15, 'quelle': 'karte', 'geaendert_ts': 100})
    assert speichern('u1', d) == (True, 100)
    assert speichern('u1', dict(d, geaendert_ts=50, loch_korr_mm=0.3))[0] is False      # älter → abgelehnt
    assert speichern('u1', dict(d, geaendert_ts=200, loch_korr_mm=0.2)) == (True, 200)
    assert liste('u2') == []                                                            # fremde uid sieht nichts
    l = liste('u1'); assert len(l) == 1 and l[0]['loch_korr_mm'] == 0.2, l
    try:
        pruefen({'loch_korr_mm': 5}); raise SystemExit('Grenze nicht geprüft')
    except ValueError:
        pass
    assert loeschen('u1', 'A1 / P1S / X1C', 0.4, 'PLA') == 1 and liste('u1') == []
    print('v3d_fit Selbsttest ok')
