"""V3D-Familie-Kalender: dieselbe SQLite-Datenbank wie die Web-App (~/v3dfamilie/daten.db).

Speicherformat der App: start/ende als lokale Berliner Zeit „JJJJ-MM-TTTHH:MM",
ganztägig als „JJJJ-MM-TT" (Ende = letzter Tag, einschließlich). Wiederholungen
klappt kalenderlogik.py der App auf — dieselbe Datei, kein Nachbau.
Gelöschte Termine landen zusätzlich als JSON-Zeile in DATA_DIR/familie-geloescht.jsonl.
"""
import datetime
import importlib.util
import json
import os
import sqlite3
import sys
from zoneinfo import ZoneInfo

from . import settings
from .core import MailError

FAMILIE_DIR = os.path.expanduser(os.environ.get('FAMILIE_DIR') or '~/v3dfamilie')
DB = os.path.join(FAMILIE_DIR, 'daten.db')
BERLIN = ZoneInfo('Europe/Berlin')
WDH_NAMEN = {'taeglich': 'täglich', 'woechentlich': 'wöchentlich', '2woechentlich': 'alle 2 Wochen',
             'monatlich': 'monatlich', 'jaehrlich': 'jährlich'}


def _kl():
    name = 'v3dfamilie_kalenderlogik'
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, os.path.join(FAMILIE_DIR, 'kalenderlogik.py'))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        sys.modules[name] = mod
    return sys.modules[name]


def _db():
    v = sqlite3.connect(DB, timeout=15)
    v.row_factory = sqlite3.Row
    v.execute('PRAGMA journal_mode=WAL')
    return v


def _jetzt():
    return datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S')


# --- Zeiten --------------------------------------------------------------------

def _eingabe(wert, ganztags, feld):
    """ISO-8601 (mit oder ohne Offset) → App-Format in Berliner Ortszeit."""
    s = (wert or '').strip()
    if not s:
        raise MailError('%s fehlt.' % feld)
    try:
        if ganztags or len(s) == 10:
            return datetime.date.fromisoformat(s[:10]).isoformat()
        dt = datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
    except ValueError:
        raise MailError('%s ist kein gültiges ISO-Datum: %s' % (feld, s[:40]))
    if dt.tzinfo is not None:
        dt = dt.astimezone(BERLIN)
    return dt.strftime('%Y-%m-%dT%H:%M')


def _ausgabe(s, ganztags):
    """App-Format → ISO mit Berliner UTC-Offset (ganztägig nur Datum)."""
    s = str(s or '')
    if ganztags or 'T' not in s:
        return s[:10]
    return datetime.datetime.fromisoformat(s[:16]).replace(tzinfo=BERLIN).isoformat()


def _fenster(wert, standard):
    if not wert:
        return standard
    s = wert.strip()
    try:
        if len(s) > 10:
            dt = datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
            if dt.tzinfo is not None:
                dt = dt.astimezone(BERLIN)
            return dt.date()
        return datetime.date.fromisoformat(s)
    except ValueError:
        raise MailError('Ungültiges Datum: %s' % s[:40])


# --- Personen ------------------------------------------------------------------

def _mitglieder(v):
    return {r['id']: r['name'] for r in v.execute('SELECT id,name FROM mitglieder')}


def _person_id(v, person):
    leute = _mitglieder(v)
    if not person:
        return min(leute) if leute else 1      # Standard: erstes Mitglied (Volker)
    for mid, name in leute.items():
        if name.lower() == person.strip().lower():
            return mid
    raise MailError('Unbekannte Person „%s" — vorhanden: %s' % (person, ', '.join(leute.values())))


def _termin(r, leute, start=None, ende=None):
    ganz = bool(r['ganztags'])
    aus = {'event_id': r['id'], 'title': r['titel'],
           'start': _ausgabe(start or r['start'], ganz), 'end': _ausgabe(ende or r['ende'] or r['start'], ganz),
           'all_day': ganz, 'location': r['ort'] or '', 'description': r['notiz'] or '',
           'person': leute.get(r['mid'], '')}
    if r['wdh']:
        aus['recurrence'] = WDH_NAMEN.get(r['wdh'], r['wdh'])
        if r['wdh_bis']:
            aus['recurrence_until'] = r['wdh_bis'][:10]
    return aus


def _holen(v, event_id):
    r = v.execute('SELECT * FROM termine WHERE id=?', (int(event_id),)).fetchone()
    if not r:
        raise MailError('Termin %s gibt es nicht (mehr).' % event_id)
    return r


# --- Werkzeuge -----------------------------------------------------------------

def list_events(start=None, end=None):
    kl = _kl()
    heute = datetime.datetime.now(BERLIN).date()
    von = _fenster(start, heute)
    bis = _fenster(end, von + datetime.timedelta(days=14))
    if bis < von:
        raise MailError('end liegt vor start.')
    if (bis - von).days > 400:
        raise MailError('Zeitraum zu groß (max. 400 Tage).')
    with _db() as v:
        roh = v.execute('SELECT * FROM termine').fetchall()
        leute = _mitglieder(v)
    raus = []
    for r in roh:
        for k in kl.termine_im_fenster(dict(r), von, bis):
            t = _termin(r, leute, k['start'], k['ende'])
            if r['wdh']:
                t['occurrence_date'] = k['wdh_datum']
            raus.append(t)
    sonder = [(e, 'Feiertag NRW') for e in kl.feiertage_im_fenster(von, bis)]
    try:
        with open(os.path.join(FAMILIE_DIR, 'ferien_nrw.json'), encoding='utf-8') as fh:
            ferien = json.load(fh)
        ferien = ferien.get('ferien', ferien) if isinstance(ferien, dict) else ferien
        sonder += [(e, 'Schulferien NRW') for e in kl.ferien_im_fenster(ferien, von, bis)]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    for e, quelle in sonder:
        raus.append({'event_id': None, 'title': e['titel'], 'start': e['start'], 'end': e['ende'],
                     'all_day': True, 'source': quelle, 'read_only': True})
    raus.sort(key=lambda t: (t['start'][:10], 0 if t['all_day'] else 1, t['start']))
    return {'start': von.isoformat(), 'end': bis.isoformat(), 'timezone': 'Europe/Berlin',
            'count': len(raus), 'events': raus}


def get_event(event_id):
    with _db() as v:
        return _termin(_holen(v, event_id), _mitglieder(v))


def create_event(title, start, end=None, location=None, description=None, all_day=False, person=None):
    titel = (title or '').strip()[:200]
    if not titel:
        raise MailError('Titel fehlt.')
    s = _eingabe(start, all_day, 'start')
    e = _eingabe(end, all_day, 'end') if end else (
        s if all_day else (datetime.datetime.fromisoformat(s) + datetime.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M'))
    if e < s:
        raise MailError('Ende liegt vor dem Beginn.')
    with _db() as v:
        mid = _person_id(v, person)
        c = v.execute('INSERT INTO termine(titel,start,ende,ganztags,mid,ort,notiz,wdh,wdh_tage,wdh_bis,'
                      'erinnerung,geaendert) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                      (titel, s, e, 1 if all_day else 0, mid, (location or '')[:200],
                       (description or '')[:2000], '', '', '', -1, _jetzt()))
        tid = c.lastrowid
        return {'ok': True, 'event': _termin(_holen(v, tid), _mitglieder(v))}


def update_event(event_id, title=None, start=None, end=None, location=None, description=None,
                 all_day=None, person=None):
    with _db() as v:
        r = _holen(v, event_id)
        ganz = bool(r['ganztags']) if all_day is None else bool(all_day)
        if all_day is not None and all_day != bool(r['ganztags']) and not (start and end):
            raise MailError('Beim Umstellen ganztägig ↔ mit Uhrzeit bitte start und end mitgeben.')
        s = _eingabe(start, ganz, 'start') if start else r['start']
        e = _eingabe(end, ganz, 'end') if end else r['ende']
        if start and not end and r['ende'] and not ganz:
            # Dauer beibehalten, wenn nur der Beginn verschoben wird
            dauer = datetime.datetime.fromisoformat(r['ende'][:16]) - datetime.datetime.fromisoformat(r['start'][:16])
            e = (datetime.datetime.fromisoformat(s) + dauer).strftime('%Y-%m-%dT%H:%M')
        elif start and not end and ganz:
            dauer = datetime.date.fromisoformat(r['ende'][:10]) - datetime.date.fromisoformat(r['start'][:10])
            e = (datetime.date.fromisoformat(s) + dauer).isoformat()
        if e < s:
            raise MailError('Ende liegt vor dem Beginn.')
        v.execute('UPDATE termine SET titel=?,start=?,ende=?,ganztags=?,mid=?,ort=?,notiz=?,geaendert=? '
                  'WHERE id=?',
                  ((title or r['titel']).strip()[:200], s, e, 1 if ganz else 0,
                   _person_id(v, person) if person else r['mid'],
                   (r['ort'] if location is None else location)[:200],
                   (r['notiz'] if description is None else description)[:2000], _jetzt(), r['id']))
        aus = {'ok': True, 'event': _termin(_holen(v, r['id']), _mitglieder(v))}
        if r['wdh']:
            aus['hinweis'] = 'Serientermin: die Änderung gilt für die ganze Serie.'
        return aus


def delete_event(event_id, confirm_series=False):
    with _db() as v:
        r = _holen(v, event_id)
        if r['wdh'] and not confirm_series:
            raise MailError('„%s" ist ein Serientermin (%s). Löschen entfernt ALLE Wiederholungen — '
                            'nur nach Rückfrage mit confirm_series=true.'
                            % (r['titel'], WDH_NAMEN.get(r['wdh'], r['wdh'])))
        os.makedirs(settings.DATA_DIR, mode=0o700, exist_ok=True)
        with open(os.path.join(settings.DATA_DIR, 'familie-geloescht.jsonl'), 'a', encoding='utf-8') as fh:
            fh.write(json.dumps(dict(r) | {'geloescht': _jetzt()}, ensure_ascii=False) + '\n')
        v.execute('DELETE FROM termine WHERE id=?', (r['id'],))
    return {'ok': True, 'deleted': {'event_id': r['id'], 'title': r['titel'],
                                    'start': _ausgabe(r['start'], r['ganztags'])}}
