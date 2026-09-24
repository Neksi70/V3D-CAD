"""SQLite-Ablage: Konten, Umsätze, Kategorie-Regeln.

Umsätze sind pro (bank, ext_id) eindeutig — wiederholtes Abrufen oder ein
doppelter CSV-Import legt nichts doppelt an. Die Kategorie, die der Nutzer von
Hand setzt, überlebt jedes erneute Abrufen (kategorie_fest = 1).
"""
import sqlite3
import threading
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS konten (
  id        TEXT PRIMARY KEY,          -- bank:ext_id
  bank      TEXT NOT NULL,
  ext_id    TEXT NOT NULL,
  name      TEXT,
  iban      TEXT,
  waehrung  TEXT,
  saldo     REAL,
  saldo_am  REAL,
  aktiv     INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS umsaetze (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  bank           TEXT NOT NULL,
  ext_id         TEXT NOT NULL,
  konto_id       TEXT NOT NULL,
  datum          TEXT NOT NULL,        -- ISO, lokale Zeit
  betrag         REAL NOT NULL,        -- negativ = Ausgabe
  waehrung       TEXT,
  gegenpartei    TEXT,
  text           TEXT,
  art            TEXT,                 -- z. B. Kartenzahlung, Überweisung, Auszahlung
  status         TEXT,
  kategorie      TEXT,
  kategorie_fest INTEGER DEFAULT 0,
  notiz          TEXT,
  UNIQUE(bank, ext_id)
);
CREATE INDEX IF NOT EXISTS umsaetze_datum ON umsaetze(datum);
CREATE TABLE IF NOT EXISTS regeln (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  muster    TEXT NOT NULL,             -- Teilstring, Groß/klein egal
  kategorie TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS abrufe (
  bank     TEXT PRIMARY KEY,
  zuletzt  REAL,
  ok       INTEGER,
  meldung  TEXT
);
"""

STANDARD_REGELN = [
    # SumUp: Kartenverkauf = Einnahme; die Auszahlung aufs Bankkonto ist nur eine Umbuchung
    # (sonst zählte jeder Verkauf doppelt).
    ("sumup-verkauf", "Einnahmen Kasse"), ("sumup-erstattung", "Einnahmen Kasse"),
    ("sumup auszahlung", "Umbuchung"),
    ("sumup", "Umbuchung"), ("umbuchung", "Umbuchung"),
    ("finanzamt", "Steuern"), ("aok", "Versicherung"), ("techniker", "Versicherung"),
    ("allianz", "Versicherung"), ("huk", "Versicherung"), ("ergo", "Versicherung"),
    ("telekom", "Telefon/Internet"), ("vodafone", "Telefon/Internet"), ("o2", "Telefon/Internet"),
    ("netcup", "IT/Server"), ("goneo", "IT/Server"), ("hetzner", "IT/Server"),
    ("anthropic", "IT/Server"), ("google", "IT/Server"), ("github", "IT/Server"),
    ("amazon", "Einkauf"), ("ebay", "Einkauf"), ("paypal", "Einkauf"),
    ("bambu", "Material/Filament"), ("prusa", "Material/Filament"), ("filament", "Material/Filament"),
    ("aral", "Tanken/Laden"), ("shell", "Tanken/Laden"), ("esso", "Tanken/Laden"),
    ("ionity", "Tanken/Laden"), ("enbw", "Tanken/Laden"),
    ("rewe", "Lebensmittel"), ("edeka", "Lebensmittel"), ("aldi", "Lebensmittel"),
    ("lidl", "Lebensmittel"), ("kaufland", "Lebensmittel"),
    ("miete", "Miete"), ("gehalt", "Gehalt/Lohn"), ("lohn", "Gehalt/Lohn"),
    ("gebühr", "Bankgebühren"), ("kontoführung", "Bankgebühren"),
]


class Speicher:
    def __init__(self, pfad):
        self.db = sqlite3.connect(pfad, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock:
            self.db.executescript(SCHEMA)
            if not self.db.execute("SELECT 1 FROM regeln LIMIT 1").fetchone():
                self.db.executemany("INSERT INTO regeln(muster, kategorie) VALUES (?, ?)", STANDARD_REGELN)
            self.db.commit()

    def _alle(self, sql, arg=()):
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, arg).fetchall()]

    # -------------------------------------------------------------- Konten
    def konto_speichern(self, bank, k):
        kid = f"{bank}:{k['ext_id']}"
        with self.lock:
            self.db.execute(
                """INSERT INTO konten(id, bank, ext_id, name, iban, waehrung, saldo, saldo_am)
                   VALUES (?,?,?,?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET name=excluded.name, iban=excluded.iban,
                     waehrung=excluded.waehrung,
                     saldo=COALESCE(excluded.saldo, konten.saldo),
                     saldo_am=CASE WHEN excluded.saldo IS NULL THEN konten.saldo_am ELSE excluded.saldo_am END""",
                (kid, bank, str(k["ext_id"]), k.get("name"), k.get("iban"), k.get("waehrung"),
                 k.get("saldo"), time.time()))
            self.db.commit()
        return kid

    def konten(self):
        return self._alle("SELECT * FROM konten WHERE aktiv = 1 ORDER BY bank, name")

    def konto_ausblenden(self, kid, aktiv):
        with self.lock:
            self.db.execute("UPDATE konten SET aktiv = ? WHERE id = ?", (1 if aktiv else 0, kid))
            self.db.commit()

    # -------------------------------------------------------------- Umsätze
    def umsaetze_speichern(self, bank, konto_id, liste):
        """Neue anlegen, bekannte aktualisieren (Status kann sich ändern). Gibt Anzahl neuer zurück."""
        regeln = self.regeln()
        neu = 0
        with self.lock:
            for u in liste:
                kat = kategorie_fuer(regeln, u)
                if not self.db.execute("SELECT 1 FROM umsaetze WHERE bank = ? AND ext_id = ?",
                                       (bank, str(u["ext_id"]))).fetchone():
                    neu += 1
                self.db.execute(
                    """INSERT INTO umsaetze(bank, ext_id, konto_id, datum, betrag, waehrung,
                                            gegenpartei, text, art, status, kategorie)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(bank, ext_id) DO UPDATE SET
                         datum=excluded.datum, betrag=excluded.betrag, status=excluded.status,
                         gegenpartei=excluded.gegenpartei, text=excluded.text, art=excluded.art,
                         kategorie=CASE WHEN umsaetze.kategorie_fest = 1 THEN umsaetze.kategorie
                                        ELSE excluded.kategorie END""",
                    (bank, str(u["ext_id"]), konto_id, u["datum"], float(u["betrag"]),
                     u.get("waehrung"), u.get("gegenpartei"), u.get("text"), u.get("art"),
                     u.get("status"), kat))
            self.db.commit()
        return neu

    def umsaetze(self, von=None, bis=None, bank=None, konto=None, kategorie=None, suche=None, limit=500):
        sql, arg = "SELECT u.*, k.name AS konto_name FROM umsaetze u LEFT JOIN konten k ON k.id = u.konto_id WHERE 1=1", []
        if von:
            sql += " AND u.datum >= ?"; arg.append(von)
        if bis:
            sql += " AND u.datum < ?"; arg.append(bis)
        if bank:
            sql += " AND u.bank = ?"; arg.append(bank)
        if konto:
            sql += " AND u.konto_id = ?"; arg.append(konto)
        if kategorie:
            if kategorie == "(ohne)":
                sql += " AND (u.kategorie IS NULL OR u.kategorie = '')"
            else:
                sql += " AND u.kategorie = ?"; arg.append(kategorie)
        if suche:
            sql += " AND (u.gegenpartei LIKE ? OR u.text LIKE ? OR u.notiz LIKE ? OR CAST(u.betrag AS TEXT) LIKE ?)"
            s = f"%{suche}%"; arg += [s, s, s, s]
        sql += " ORDER BY u.datum DESC, u.id DESC LIMIT ?"; arg.append(int(limit))
        return self._alle(sql, arg)

    def umsatz_setzen(self, uid, kategorie=None, notiz=None):
        with self.lock:
            if kategorie is not None:
                self.db.execute("UPDATE umsaetze SET kategorie = ?, kategorie_fest = 1 WHERE id = ?",
                                (kategorie.strip() or None, uid))
            if notiz is not None:
                self.db.execute("UPDATE umsaetze SET notiz = ? WHERE id = ?", (notiz.strip() or None, uid))
            self.db.commit()

    def anzahl(self, bank=None):
        with self.lock:
            if bank:
                return self.db.execute("SELECT COUNT(*) FROM umsaetze WHERE bank = ?", (bank,)).fetchone()[0]
            return self.db.execute("SELECT COUNT(*) FROM umsaetze").fetchone()[0]

    def kategorien(self):
        a = {r["kategorie"] for r in self._alle("SELECT DISTINCT kategorie FROM umsaetze WHERE kategorie IS NOT NULL")}
        a |= {r["kategorie"] for r in self._alle("SELECT DISTINCT kategorie FROM regeln")}
        return sorted(a, key=str.lower)

    def auswertung(self, von, bis):
        """Summen pro Monat und Kategorie, getrennt nach Währung. Umbuchungen zählen nicht."""
        return self._alle(
            """SELECT substr(datum, 1, 7) AS monat, COALESCE(kategorie, '(ohne)') AS kategorie,
                      waehrung, SUM(CASE WHEN betrag > 0 THEN betrag ELSE 0 END) AS ein,
                      SUM(CASE WHEN betrag < 0 THEN betrag ELSE 0 END) AS aus, COUNT(*) AS anzahl
               FROM umsaetze WHERE datum >= ? AND datum < ? AND COALESCE(status, '') NOT IN ('abgelehnt', 'storniert', 'fehlgeschlagen')
                 AND COALESCE(kategorie, '') != 'Umbuchung'
               GROUP BY monat, kategorie, waehrung ORDER BY monat""", (von, bis))

    # -------------------------------------------------------------- Regeln
    def regeln(self):
        return self._alle("SELECT * FROM regeln ORDER BY length(muster) DESC")

    def regel_neu(self, muster, kategorie, anwenden=True):
        muster, kategorie = muster.strip(), kategorie.strip()
        if not muster or not kategorie:
            raise ValueError("Muster und Kategorie angeben")
        with self.lock:
            self.db.execute("INSERT INTO regeln(muster, kategorie) VALUES (?, ?)", (muster, kategorie))
            self.db.commit()
        if anwenden:
            self.regeln_anwenden()

    def regel_loeschen(self, rid):
        with self.lock:
            self.db.execute("DELETE FROM regeln WHERE id = ?", (rid,))
            self.db.commit()

    def regeln_anwenden(self):
        """Alle nicht von Hand gesetzten Kategorien neu berechnen."""
        regeln = self.regeln()
        with self.lock:
            zeilen = self.db.execute(
                "SELECT id, gegenpartei, text, art FROM umsaetze WHERE kategorie_fest = 0").fetchall()
            for z in zeilen:
                self.db.execute("UPDATE umsaetze SET kategorie = ? WHERE id = ?",
                                (kategorie_fuer(regeln, dict(z)), z["id"]))
            self.db.commit()

    # -------------------------------------------------------------- Abrufe
    def abruf_melden(self, bank, ok, meldung=""):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO abrufe(bank, zuletzt, ok, meldung) VALUES (?,?,?,?)",
                            (bank, time.time(), 1 if ok else 0, meldung))
            self.db.commit()

    def abrufe(self):
        return {r["bank"]: r for r in self._alle("SELECT * FROM abrufe")}


def kategorie_fuer(regeln, u):
    """Längstes passendes Muster gewinnt (Regeln kommen nach Länge sortiert)."""
    hay = " ".join(str(u.get(k) or "") for k in ("gegenpartei", "text", "art")).lower()
    for r in regeln:
        if r["muster"].lower() in hay:
            return r["kategorie"]
    return None
