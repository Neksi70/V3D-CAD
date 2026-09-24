"""Nutzungsmessung pro Konto (Beta-Phase V3D CAD).

Zaehlt, was Serverleistung kostet oder fuer die spaeteren Tarife zaehlt:
Editor-Starts, OCCT-Operationen (mit Rechenzeit), KI-Auftraege und Exporte.
Grundlage fuer die Preise nach der Beta — ohne diese Zahlen sind Tarif-
grenzen geraten.

Ablage: SQLite (Standardbibliothek, keine neue Abhaengigkeit) unter
~/.config/volme3d/nutzung.db — ausserhalb des Git-Baums, je Server eigene
Datei. Ereignisse aelter als AUFBEWAHRUNG_TAGE werden geloescht
(Datensparsamkeit, steht so auf beta.html).

Auswertung: GET /nutzung im Server, nur fuer Konten aus
~/.config/volme3d/admins (eine E-Mail pro Zeile).
"""

import os
import time
import sqlite3
import threading

DB_PATH = os.environ.get('V3D_NUTZUNG_DB',
                         os.path.expanduser('~/.config/volme3d/nutzung.db'))
ADMINS_FILE = os.environ.get('V3D_ADMINS',
                             os.path.expanduser('~/.config/volme3d/admins'))
AUFBEWAHRUNG_TAGE = 400          # gut 13 Monate: Vorjahresvergleich moeglich
ARTEN = ('start', 'occt', 'ki', 'export')
CLIENT_ARTEN = ('export',)       # nur das darf der Browser selbst melden

_lock = threading.Lock()
_bereit = False
_letztes_aufraeumen = 0.0


def _db():
    global _bereit
    con = sqlite3.connect(DB_PATH, timeout=10)
    if not _bereit:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        con.execute('PRAGMA journal_mode=WAL')
        con.execute('''CREATE TABLE IF NOT EXISTS ereignis (
            ts      INTEGER NOT NULL,   -- Unix-Sekunden
            uid     TEXT NOT NULL,
            email   TEXT NOT NULL DEFAULT '',
            gast    INTEGER NOT NULL DEFAULT 0,
            art     TEXT NOT NULL,      -- start | occt | ki | export
            detail  TEXT NOT NULL DEFAULT '',
            dauer_ms INTEGER NOT NULL DEFAULT 0,
            ok      INTEGER NOT NULL DEFAULT 1)''')
        con.execute('CREATE INDEX IF NOT EXISTS ereignis_ts ON ereignis(ts)')
        _bereit = True
    return con


def erfassen(sess, art, detail='', dauer_ms=0, ok=True):
    """Ein Ereignis ablegen. Fehler hier duerfen nie eine Anfrage kippen."""
    global _letztes_aufraeumen
    if not sess or art not in ARTEN:
        return
    try:
        jetzt = time.time()
        with _lock:
            con = _db()
            with con:
                con.execute(
                    'INSERT INTO ereignis VALUES (?,?,?,?,?,?,?,?)',
                    (int(jetzt), str(sess.get('u', '?'))[:128],
                     str(sess.get('e', ''))[:200], 1 if sess.get('g') else 0,
                     art, str(detail)[:80], int(dauer_ms), 1 if ok else 0))
                if jetzt - _letztes_aufraeumen > 86400:
                    con.execute('DELETE FROM ereignis WHERE ts < ?',
                                (int(jetzt - AUFBEWAHRUNG_TAGE * 86400),))
                    _letztes_aufraeumen = jetzt
            con.close()
    except Exception as e:  # noqa: BLE001 — Messung ist Nebensache
        print('Nutzungsmessung fehlgeschlagen:', e, flush=True)


def ist_admin(sess):
    if not sess or sess.get('g'):
        return False
    email = (sess.get('e') or '').strip().lower()
    if not email:
        return False
    try:
        with open(ADMINS_FILE, encoding='utf-8') as f:
            admins = {z.strip().lower() for z in f
                      if z.strip() and not z.lstrip().startswith('#')}
    except OSError:
        return False
    return email in admins


def monate():
    """Alle Monate mit Daten, neueste zuerst ('2026-09', ...)."""
    with _lock:
        con = _db()
        rows = con.execute(
            "SELECT DISTINCT strftime('%Y-%m', ts, 'unixepoch', 'localtime') "
            'FROM ereignis ORDER BY 1 DESC').fetchall()
        con.close()
    return [r[0] for r in rows]


def bericht(monat):
    """Kennzahlen eines Monats ('YYYY-MM'): je Konto und gesamt."""
    sql = '''SELECT uid, MAX(email), MAX(gast),
        SUM(art='start'), SUM(art='occt'),
        SUM(CASE WHEN art='occt' THEN dauer_ms ELSE 0 END),
        SUM(art='occt' AND ok=0), SUM(art='ki'), SUM(art='export'),
        COUNT(DISTINCT strftime('%Y-%m-%d', ts, 'unixepoch', 'localtime')),
        MAX(ts)
      FROM ereignis
      WHERE strftime('%Y-%m', ts, 'unixepoch', 'localtime') = ?
      GROUP BY uid ORDER BY 6 DESC, 5 DESC'''
    with _lock:
        con = _db()
        rows = con.execute(sql, (monat,)).fetchall()
        ops = con.execute(
            '''SELECT detail, COUNT(*), SUM(dauer_ms) FROM ereignis
               WHERE art='occt'
                 AND strftime('%Y-%m', ts, 'unixepoch', 'localtime') = ?
               GROUP BY detail ORDER BY 3 DESC''', (monat,)).fetchall()
        con.close()
    konten = [{'uid': r[0], 'email': r[1], 'gast': bool(r[2]),
               'starts': r[3], 'occt': r[4], 'occt_s': round(r[5] / 1000, 1),
               'occt_fehler': r[6], 'ki': r[7], 'exporte': r[8],
               'tage': r[9], 'zuletzt': r[10]} for r in rows]
    summe = {k: sum(x[k] for x in konten)
             for k in ('starts', 'occt', 'occt_s', 'occt_fehler', 'ki',
                       'exporte')}
    summe['occt_s'] = round(summe['occt_s'], 1)
    summe['konten'] = sum(1 for x in konten if not x['gast'])
    summe['gaeste'] = sum(1 for x in konten if x['gast'])
    return {'monat': monat, 'konten': konten, 'summe': summe,
            'operationen': [{'art': o[0], 'anzahl': o[1],
                             'sekunden': round((o[2] or 0) / 1000, 1)}
                            for o in ops]}
