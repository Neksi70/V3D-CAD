"""Gemeinsames Fundament: Konfiguration, Ablage, Datenbank."""
import json, os, sqlite3, threading, time

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
REC = os.path.join(DATA, "recordings")
SOUNDS = os.path.join(DATA, "sounds")
DB_PATH = os.path.join(DATA, "calls.db")

_lock = threading.Lock()


def cfg(*path, default=None):
    """cfg('mail','smtpHost') -> Wert oder default."""
    with open(os.path.join(BASE, "config.json"), encoding="utf-8") as fh:
        node = json.load(fh)
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return default
        node = node[key]
    return node


def save_cfg(new):
    tmp = os.path.join(BASE, "config.json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(new, fh, indent=2, ensure_ascii=False)
    os.chmod(tmp, 0o600)
    os.replace(tmp, os.path.join(BASE, "config.json"))


def full_cfg():
    with open(os.path.join(BASE, "config.json"), encoding="utf-8") as fh:
        return json.load(fh)


def db():
    con = sqlite3.connect(DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    os.makedirs(REC, exist_ok=True)
    os.makedirs(SOUNDS, exist_ok=True)
    with db() as con:
        con.execute("""CREATE TABLE IF NOT EXISTS calls (
            id       TEXT PRIMARY KEY,
            ts       INTEGER NOT NULL,
            caller   TEXT DEFAULT '',
            name     TEXT DEFAULT '',
            seconds  REAL DEFAULT 0,
            audio    TEXT DEFAULT '',
            text     TEXT DEFAULT '',
            status   TEXT DEFAULT 'neu',
            gelesen  INTEGER DEFAULT 0,
            gemailt  INTEGER DEFAULT 0,
            fehler   TEXT DEFAULT ''
        )""")
        con.execute("""CREATE TABLE IF NOT EXISTS subs (
            endpoint TEXT PRIMARY KEY,
            sub      TEXT NOT NULL,
            ts       INTEGER NOT NULL
        )""")
        con.execute("CREATE INDEX IF NOT EXISTS calls_ts ON calls(ts DESC)")


def add_call(cid, caller, name, audio, seconds=0.0):
    with _lock, db() as con:
        con.execute(
            "INSERT OR IGNORE INTO calls (id,ts,caller,name,audio,seconds,status)"
            " VALUES (?,?,?,?,?,?,'neu')",
            (cid, int(time.time()), caller or "", name or "", audio or "", seconds))


def update_call(cid, **felder):
    if not felder:
        return
    sets = ",".join(f"{k}=?" for k in felder)
    with _lock, db() as con:
        con.execute(f"UPDATE calls SET {sets} WHERE id=?", (*felder.values(), cid))


def get_call(cid):
    with db() as con:
        row = con.execute("SELECT * FROM calls WHERE id=?", (cid,)).fetchone()
    return dict(row) if row else None


def list_calls(limit=200):
    with db() as con:
        rows = con.execute("SELECT * FROM calls ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]
