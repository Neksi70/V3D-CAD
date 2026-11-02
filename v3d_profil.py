#!/usr/bin/env python3
"""Namen der V3D-CAD-Nutzer (Vorname, Nachname) — serverseitig je Konto.

Die E-Mail allein ist oft kryptisch (Volker 2.11.26). Der Name wird bei der
Registrierung abgefragt, bestehende Nutzer einmal beim naechsten Start.
Er benennt auch den Ordner in Mimi share ("Nachname, Vorname").

Datei: ~/.config/volme3d/profile.json  {uid: {vorname, nachname, email, vorschlag, t}}
"""
import os
import json
import time
import threading

DATEI = os.environ.get('V3D_PROFIL_DATEI') or os.path.expanduser('~/.config/volme3d/profile.json')
_lock = threading.Lock()


def _laden():
    try:
        with open(DATEI, encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _speichern(d):
    os.makedirs(os.path.dirname(DATEI), exist_ok=True)
    tmp = DATEI + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.chmod(tmp, 0o600)
    os.replace(tmp, DATEI)


def sauber(txt):
    txt = ''.join(ch for ch in str(txt or '') if ch >= ' ' and ch not in '<>/\\"')
    return ' '.join(txt.split())[:60]


def holen(uid):
    with _lock:
        return dict(_laden().get(uid) or {})


def setzen(uid, email='', vorname=None, nachname=None, vorschlag=None):
    """Nur gesetzte Felder aendern. Gibt das neue Profil zurueck."""
    with _lock:
        d = _laden()
        p = d.get(uid) or {}
        if email:
            p['email'] = email
        if vorname is not None:
            p['vorname'] = sauber(vorname)
        if nachname is not None:
            p['nachname'] = sauber(nachname)
        if vorschlag:
            p['vorschlag'] = sauber(vorschlag)
        p['t'] = int(time.time())
        d[uid] = p
        _speichern(d)
        return dict(p)


def ordnername(p):
    """'Nachname, Vorname' — oder None, solange der Name fehlt."""
    vn, nn = (p or {}).get('vorname', ''), (p or {}).get('nachname', '')
    if not vn or not nn:
        return None
    return nn + ', ' + vn
