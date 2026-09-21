"""Zustand des Connectors in SQLite: Clients, Anmelde-Vorgänge, Codes, Tokens,
Fehlversuche. Tokens und Codes liegen nur als SHA-256-Hash in der Datenbank —
ein Abzug der Datei gibt keine gültigen Zugänge preis.
"""
import hashlib
import json
import os
import secrets
import sqlite3
import threading
import time

from . import settings

_lock = threading.Lock()
_conn = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS clients (
    client_id TEXT PRIMARY KEY, info TEXT NOT NULL, created REAL NOT NULL, last_used REAL);
CREATE TABLE IF NOT EXISTS pending (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL, params TEXT NOT NULL, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS codes (
    hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, data TEXT NOT NULL, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS tokens (
    hash TEXT PRIMARY KEY, kind TEXT NOT NULL, client_id TEXT NOT NULL, family TEXT NOT NULL,
    scopes TEXT NOT NULL, resource TEXT, expires REAL NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS tokens_family ON tokens(family);
CREATE TABLE IF NOT EXISTS fails (
    key TEXT PRIMARY KEY, count INTEGER NOT NULL, first REAL NOT NULL, locked_until REAL NOT NULL);
"""


def h(geheim):
    return hashlib.sha256(geheim.encode('utf-8')).hexdigest()


def db():
    global _conn
    if _conn is None:
        os.makedirs(settings.DATA_DIR, mode=0o700, exist_ok=True)
        pfad = os.path.join(settings.DATA_DIR, 'state.db')
        neu = not os.path.exists(pfad)
        _conn = sqlite3.connect(pfad, check_same_thread=False, isolation_level=None)
        if neu:
            os.chmod(pfad, 0o600)
        _conn.execute('PRAGMA journal_mode=WAL')
        _conn.executescript(SCHEMA)
    return _conn


def q(sql, args=(), one=False):
    with _lock:
        cur = db().execute(sql, args)
        rows = cur.fetchall()
    return (rows[0] if rows else None) if one else rows


def aufraeumen():
    jetzt = time.time()
    q('DELETE FROM pending WHERE expires < ?', (jetzt,))
    q('DELETE FROM codes WHERE expires < ?', (jetzt,))
    q('DELETE FROM tokens WHERE expires < ?', (jetzt,))
    # Clients, die 90 Tage kein Token mehr geholt haben, fliegen raus (DCR legt
    # bei jedem neuen Verbinden einen an).
    q('DELETE FROM clients WHERE COALESCE(last_used, created) < ? '
      'AND client_id NOT IN (SELECT client_id FROM tokens)', (jetzt - 90 * 86400,))


# --- Clients ---

def client_speichern(client_id, info_json):
    q('INSERT OR REPLACE INTO clients(client_id, info, created) VALUES (?,?,?)',
      (client_id, info_json, time.time()))


def client_laden(client_id):
    r = q('SELECT info FROM clients WHERE client_id=?', (client_id,), one=True)
    return r[0] if r else None


def client_anzahl():
    return q('SELECT COUNT(*) FROM clients', one=True)[0]


def client_benutzt(client_id):
    q('UPDATE clients SET last_used=? WHERE client_id=?', (time.time(), client_id))


# --- Anmelde-Vorgänge (zwischen /authorize und dem Login-Formular) ---

def pending_neu(client_id, params):
    pid = secrets.token_urlsafe(32)
    q('INSERT INTO pending VALUES (?,?,?,?)',
      (pid, client_id, json.dumps(params), time.time() + 600))
    return pid


def pending_laden(pid):
    r = q('SELECT client_id, params FROM pending WHERE id=? AND expires>?', (pid, time.time()), one=True)
    return (r[0], json.loads(r[1])) if r else (None, None)


def pending_loeschen(pid):
    q('DELETE FROM pending WHERE id=?', (pid,))


# --- Codes ---

def code_neu(client_id, data):
    code = secrets.token_urlsafe(32)
    q('INSERT INTO codes VALUES (?,?,?,?)', (h(code), client_id, json.dumps(data), time.time() + 300))
    return code


def code_laden(code):
    r = q('SELECT client_id, data, expires FROM codes WHERE hash=? AND expires>?',
          (h(code), time.time()), one=True)
    return (r[0], json.loads(r[1]), r[2]) if r else None


def code_verbrauchen(code):
    with _lock:
        cur = db().execute('DELETE FROM codes WHERE hash=?', (h(code),))
        return cur.rowcount == 1


# --- Tokens ---

def token_neu(kind, client_id, family, scopes, resource, laufzeit):
    t = secrets.token_urlsafe(40)
    ablauf = int(time.time() + laufzeit)
    q('INSERT INTO tokens VALUES (?,?,?,?,?,?,?,0)',
      (h(t), kind, client_id, family, ' '.join(scopes), resource, ablauf))
    return t, ablauf


def token_laden(t, kind):
    r = q('SELECT client_id, family, scopes, resource, expires, used FROM tokens '
          'WHERE hash=? AND kind=?', (h(t), kind), one=True)
    if not r or r[4] < time.time():
        return None
    return {'client_id': r[0], 'family': r[1], 'scopes': r[2].split() if r[2] else [],
            'resource': r[3], 'expires': int(r[4]), 'used': bool(r[5])}


def refresh_verbrauchen(t):
    """Refresh-Token genau einmal einlösen (Rotation)."""
    with _lock:
        cur = db().execute('UPDATE tokens SET used=1 WHERE hash=? AND kind="refresh" AND used=0', (h(t),))
        return cur.rowcount == 1


def familie_sperren(family):
    q('DELETE FROM tokens WHERE family=?', (family,))


def familie_von(t):
    r = q('SELECT family FROM tokens WHERE hash=?', (h(t),), one=True)
    return r[0] if r else None


def alles_widerrufen():
    n = q('SELECT COUNT(*) FROM tokens', one=True)[0]
    q('DELETE FROM tokens')
    q('DELETE FROM codes')
    q('DELETE FROM pending')
    return n


def token_anzahl():
    return {k: n for k, n in q('SELECT kind, COUNT(*) FROM tokens WHERE used=0 AND expires>? GROUP BY kind',
                               (time.time(),))}


# --- Fehlversuche ---

def fail_stand(key):
    r = q('SELECT count, first, locked_until FROM fails WHERE key=?', (key,), one=True)
    return r if r else (0, 0.0, 0.0)


def fail_setzen(key, count, first, locked_until):
    q('INSERT OR REPLACE INTO fails VALUES (?,?,?,?)', (key, count, first, locked_until))


def fail_loeschen(key):
    q('DELETE FROM fails WHERE key=?', (key,))
