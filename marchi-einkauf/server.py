#!/usr/bin/env python3
"""Marchi Group – Zentraleinkauf.

Für einen Einkäufer, der lieber telefoniert als tippt:
- Telefonat eintragen: nach dem Gespräch ins Handy sprechen, Claude macht
  daraus Lieferant/Artikel/Menge/Preis/Konditionen (Angebot).
- Preisspiegel: alle Angebote je Artikel nebeneinander, günstigster oben.
- Ersparnis & Bonus: (Vergleichspreis − bezahlter Preis) × Menge, je Rubrik
  und über das Jahr; Bonus = einstellbarer Anteil der Ersparnis.
- Altpreise aus dem bisherigen Programm (CSV/XLSX-Export) einlesen; sie
  bilden die Vergleichsbasis.
- Rubriken (Stahl, Alu, ... frei erweiterbar), Artikel, Lieferanten, Kunden
  (Import CSV/XLSX), Bestellvorgänge mit Bestellschein.

Start:  python3 server.py [PORT]      (Default 8811)
Daten:  daten.db (SQLite) im selben Verzeichnis
Web:    app.html — eine Datei
Zugang: PIN aus ~/.config/marchi-einkauf/config.json (beim ersten Start
        erzeugt und im Log ausgegeben).
KI:     Schlüssel aus ~/.config/marchi-einkauf/config.json ("ki": {"key","model"}),
        sonst aus V3D Mail (~/.config/v3dmail/config.json, "ai").

Nur Python-Stdlib (+ optional lokales Whisper für die Server-Spracherkennung).
Öffentlich über den Tailscale-Funnel: dort ist remote_addr immer 127.0.0.1,
also schützt ausschließlich die PIN (mit Sperre nach Fehlversuchen).
"""
import csv
import datetime
import hashlib
import io
import json
import os
import re
import secrets
import socket
import sqlite3
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

HIER = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HIER, "daten.db")
CFG_DIR = os.path.join(os.path.expanduser("~"), ".config", "marchi-einkauf")
CFG_DATEI = os.path.join(CFG_DIR, "config.json")
V3DMAIL_CFG = os.path.join(os.path.expanduser("~"), ".config", "v3dmail", "config.json")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8811
MAX_BODY = 25 * 1024 * 1024
SITZUNG_TAGE = 180

_lock = threading.Lock()
_whisper = None
_whisper_lock = threading.Lock()
_fehlversuche = []          # Zeitstempel falscher PINs (global, hinter dem Funnel gibt es keine echte IP)

STANDARD_RUBRIKEN = [
    ("Stahl", "#5b6770", ["Bleche", "Rohre & Profile", "Flachstahl", "Rundstahl"]),
    ("Aluminium", "#00a2ff", ["Bleche", "Profile", "Riffelblech", "Strangpressprofile"]),
    ("Edelstahl", "#8a9aa6", ["Bleche", "Rohre", "Profile"]),
    ("Kunststoffe & Platten", "#7c5cff", ["Plexiglas/PC", "HPL/Siebdruck", "GFK"]),
    ("Holz & Möbelbau", "#a0703c", ["Multiplex", "Leichtbauplatten", "Kanten"]),
    ("Schrauben & Normteile", "#444444", ["Schrauben", "Muttern", "Nieten", "Scheiben"]),
    ("Elektrik & Beleuchtung", "#f5b400", ["Kabel", "LED", "Sicherungen", "Batterien"]),
    ("Fahrzeugteile & Fahrwerk", "#d0342c", ["Achsen", "Reifen", "Anhängerkupplung", "Bremsen"]),
    ("Lacke, Kleb- & Dichtstoffe", "#2aa876", ["Lacke", "Kleber", "Dichtstoffe", "Folien"]),
    ("Dämmung, Polster & Textil", "#c27ba0", ["Dämmung", "Polster", "Bezugsstoffe"]),
    ("Werkzeug & Verbrauchsmaterial", "#6b8e23", ["Schleifmittel", "Bohrer", "Schweißzubehör", "Gase"]),
    ("Arbeitsschutz", "#ff7a00", ["Handschuhe", "Schutzbrillen", "Kleidung"]),
    ("Büro & Sonstiges", "#999999", []),
]
# Stichwörter -> Hauptrubrik (für Altpreis-Import). Reihenfolge zählt: Edelstahl vor Stahl.
RUBRIK_STICHWORTE = [
    ("Edelstahl", ["edelstahl", "v2a", "v4a", "1.4301", "1.4571", "1.4404", "inox", "nirosta"]),
    ("Aluminium", ["alu", "almg", "almgsi", "aw-", "en aw", "eloxiert", "riffelblech"]),
    ("Stahl", ["stahl", "s235", "s355", "dc01", "dx51", "st37", "st52", "hea", "heb", "ipe", "unp",
               "verzinkt", "schwarzblech", "baustahl", "vierkantrohr", "flachstahl", "rundstahl"]),
    ("Kunststoffe & Platten", ["pvc", "plexi", "acryl", "polycarbonat", "pmma", "gfk", "hpl",
                               "kunststoff", "pe-hd", "pe-", "pp-", "forex", "dibond"]),
    ("Holz & Möbelbau", ["holz", "multiplex", "siebdruck", "mdf", "spanplatte", "sperrholz",
                         "osb", "leimholz", "kante"]),
    ("Schrauben & Normteile", ["schraube", "mutter", "niet", "scheibe", "din ", "iso 4", "gewinde",
                               "bolzen", "dübel"]),
    ("Elektrik & Beleuchtung", ["kabel", "led", "leitung", "sicherung", "batterie", "schalter",
                                "stecker", "relais", "leuchte", "lampe"]),
    ("Fahrzeugteile & Fahrwerk", ["achse", "reifen", "felge", "bremse", "kupplung", "fahrwerk",
                                  "stütze", "deichsel", "kotflügel"]),
    ("Lacke, Kleb- & Dichtstoffe", ["lack", "kleb", "sika", "dicht", "silikon", "grundierung",
                                    "folie", "farbe", "primer", "spachtel"]),
    ("Dämmung, Polster & Textil", ["dämm", "armaflex", "polster", "stoff", "schaum", "filz", "teppich"]),
    ("Werkzeug & Verbrauchsmaterial", ["schleif", "trennscheibe", "bohrer", "schweiß", "schweiss",
                                       "argon", "co2", "draht", "fräser", "säge", "elektrode"]),
    ("Arbeitsschutz", ["handschuh", "schutzbrille", "gehörschutz", "warnweste", "sicherheitsschuh",
                       "atemschutz", "maske"]),
]
EINHEITEN = ["Stk", "kg", "t", "m", "m²", "lfm", "Tafel", "Pak", "Rolle", "l", "Satz"]
STATUS = ["Bedarf", "Angefragt", "Bestellt", "Teilgeliefert", "Geliefert", "Storniert"]
ZAEHLT = ("Bestellt", "Teilgeliefert", "Geliefert")      # gilt als Einkauf

STANDARD_EINSTELLUNGEN = {
    "einkaeufer": "",
    "start": f"{datetime.date.today().year}-01-01",   # zuständig seit
    "basis": "start",          # "start" = Preise vor dem Start (fest) | "vorjahr" = jeweils Vorjahr
    "bonus_prozent": 10.0,
    "bonus_deckel": 0.0,       # 0 = ohne Obergrenze
    "bonus_basis": "hart",     # "hart" = nur ggü. Vergleichspreis | "beides" = sonst ggü. Angebots-Ø
    "sprache": "auto",         # "auto" = PC/iPhone live, Android Whisper | "browser" | "server"
    "firma_adresse": "Auf dem Brümmer 6a · 44149 Dortmund",
}

# Tabellen und welche Felder die API schreiben darf
FELDER = {
    "rubriken": ["name", "farbe", "parent_id", "sort", "notiz"],
    "artikel": ["rubrik_id", "nr", "name", "werkstoff", "abmessung", "einheit",
                "preis", "vorjahrespreis", "lieferant_id", "mindestmenge", "notiz", "aktiv"],
    "lieferanten": ["name", "ansprechpartner", "email", "telefon", "strasse",
                    "plz", "ort", "kundennr_bei_uns", "rubriken", "notiz"],
    "kunden": ["kundennr", "name", "ansprechpartner", "strasse", "plz", "ort",
               "land", "telefon", "email", "ustid", "notiz"],
    "angebote": ["datum", "lieferant_id", "artikel_id", "menge", "einheit", "preis",
                 "lieferzeit", "zahlungsbedingungen", "fracht", "gueltig_bis", "notiz", "memo"],
}
PFLICHT = {"angebote": "artikel_id"}
BESTELL_FELDER = ["status", "datum", "lieferant_id", "kunde_id", "projekt",
                  "besteller", "liefertermin", "lieferadresse", "notiz"]


class Fehler(Exception):
    pass


# ---------------------------------------------------------------- Datenbank
def db():
    c = sqlite3.connect(DB, timeout=15)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


def spalte_ergaenzen(c, tabelle, spalte, typ):
    if spalte not in [r["name"] for r in c.execute(f"PRAGMA table_info({tabelle})")]:
        c.execute(f"ALTER TABLE {tabelle} ADD COLUMN {spalte} {typ}")


def init_db():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS rubriken(
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, farbe TEXT DEFAULT '#00a2ff',
            parent_id INTEGER REFERENCES rubriken(id) ON DELETE CASCADE,
            sort INTEGER DEFAULT 0, notiz TEXT DEFAULT '');
        CREATE TABLE IF NOT EXISTS lieferanten(
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, ansprechpartner TEXT DEFAULT '',
            email TEXT DEFAULT '', telefon TEXT DEFAULT '', strasse TEXT DEFAULT '',
            plz TEXT DEFAULT '', ort TEXT DEFAULT '', kundennr_bei_uns TEXT DEFAULT '',
            rubriken TEXT DEFAULT '', notiz TEXT DEFAULT '');
        CREATE TABLE IF NOT EXISTS artikel(
            id INTEGER PRIMARY KEY,
            rubrik_id INTEGER REFERENCES rubriken(id) ON DELETE SET NULL,
            nr TEXT DEFAULT '', name TEXT NOT NULL, werkstoff TEXT DEFAULT '',
            abmessung TEXT DEFAULT '', einheit TEXT DEFAULT 'Stk', preis REAL DEFAULT 0,
            lieferant_id INTEGER REFERENCES lieferanten(id) ON DELETE SET NULL,
            mindestmenge REAL DEFAULT 0, notiz TEXT DEFAULT '', aktiv INTEGER DEFAULT 1);
        CREATE TABLE IF NOT EXISTS kunden(
            id INTEGER PRIMARY KEY, kundennr TEXT DEFAULT '', name TEXT NOT NULL,
            ansprechpartner TEXT DEFAULT '', strasse TEXT DEFAULT '', plz TEXT DEFAULT '',
            ort TEXT DEFAULT '', land TEXT DEFAULT '', telefon TEXT DEFAULT '',
            email TEXT DEFAULT '', ustid TEXT DEFAULT '', notiz TEXT DEFAULT '',
            quelle TEXT DEFAULT '', angelegt TEXT, geaendert TEXT);
        CREATE TABLE IF NOT EXISTS bestellungen(
            id INTEGER PRIMARY KEY, nr TEXT UNIQUE, status TEXT DEFAULT 'Bedarf',
            datum TEXT, lieferant_id INTEGER REFERENCES lieferanten(id) ON DELETE SET NULL,
            kunde_id INTEGER REFERENCES kunden(id) ON DELETE SET NULL,
            projekt TEXT DEFAULT '', besteller TEXT DEFAULT '', liefertermin TEXT DEFAULT '',
            lieferadresse TEXT DEFAULT '', notiz TEXT DEFAULT '', angelegt TEXT);
        CREATE TABLE IF NOT EXISTS positionen(
            id INTEGER PRIMARY KEY,
            bestellung_id INTEGER NOT NULL REFERENCES bestellungen(id) ON DELETE CASCADE,
            artikel_id INTEGER REFERENCES artikel(id) ON DELETE SET NULL,
            rubrik_id INTEGER REFERENCES rubriken(id) ON DELETE SET NULL,
            bezeichnung TEXT DEFAULT '', menge REAL DEFAULT 1, einheit TEXT DEFAULT 'Stk',
            preis REAL DEFAULT 0, sort INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS angebote(
            id INTEGER PRIMARY KEY, datum TEXT,
            lieferant_id INTEGER REFERENCES lieferanten(id) ON DELETE CASCADE,
            artikel_id INTEGER REFERENCES artikel(id) ON DELETE CASCADE,
            menge REAL, einheit TEXT DEFAULT '', preis REAL DEFAULT 0,
            lieferzeit TEXT DEFAULT '', zahlungsbedingungen TEXT DEFAULT '', fracht TEXT DEFAULT '',
            gueltig_bis TEXT DEFAULT '', notiz TEXT DEFAULT '', memo TEXT DEFAULT '', angelegt TEXT);
        CREATE TABLE IF NOT EXISTS historie(
            id INTEGER PRIMARY KEY, datum TEXT,
            lieferant_id INTEGER REFERENCES lieferanten(id) ON DELETE SET NULL,
            artikel_id INTEGER REFERENCES artikel(id) ON DELETE CASCADE,
            bezeichnung TEXT DEFAULT '', menge REAL DEFAULT 1, einheit TEXT DEFAULT '',
            preis REAL DEFAULT 0, quelle TEXT DEFAULT '');
        CREATE TABLE IF NOT EXISTS einstellungen(k TEXT PRIMARY KEY, v TEXT);
        CREATE TABLE IF NOT EXISTS sitzungen(token TEXT PRIMARY KEY, ablauf TEXT);
        CREATE INDEX IF NOT EXISTS ix_hist_art ON historie(artikel_id, datum);
        CREATE INDEX IF NOT EXISTS ix_ang_art ON angebote(artikel_id, datum);
        """)
        spalte_ergaenzen(c, "artikel", "vorjahrespreis", "REAL DEFAULT 0")
        spalte_ergaenzen(c, "positionen", "referenzpreis", "REAL")
        spalte_ergaenzen(c, "positionen", "angebotspreis", "REAL")
        spalte_ergaenzen(c, "bestellungen", "angebot_id", "INTEGER")
        if not c.execute("SELECT 1 FROM rubriken LIMIT 1").fetchone():
            for i, (name, farbe, unter) in enumerate(STANDARD_RUBRIKEN):
                rid = c.execute("INSERT INTO rubriken(name,farbe,sort) VALUES(?,?,?)",
                                (name, farbe, i)).lastrowid
                for j, u in enumerate(unter):
                    c.execute("INSERT INTO rubriken(name,farbe,parent_id,sort) VALUES(?,?,?,?)",
                              (u, farbe, rid, j))


def cfg():
    os.makedirs(CFG_DIR, exist_ok=True)
    if os.path.exists(CFG_DATEI):
        with open(CFG_DATEI) as f:
            return json.load(f)
    pin = "".join(secrets.choice("0123456789") for _ in range(6))
    salz = secrets.token_hex(8)
    d = {"pin_salz": salz, "pin_hash": hashlib.sha256((salz + pin).encode()).hexdigest()}
    with open(CFG_DATEI, "w") as f:
        json.dump(d, f, indent=2)
    os.chmod(CFG_DATEI, 0o600)
    print(f"*** Erste PIN für den Zentraleinkauf: {pin} (in {CFG_DATEI} änderbar) ***", flush=True)
    return d


def pin_ok(pin):
    d = cfg()
    return secrets.compare_digest(
        hashlib.sha256((d["pin_salz"] + str(pin)).encode()).hexdigest(), d["pin_hash"])


def einstellungen(c):
    e = dict(STANDARD_EINSTELLUNGEN)
    for r in c.execute("SELECT k, v FROM einstellungen"):
        if r["k"] in e:
            e[r["k"]] = json.loads(r["v"])
    return e


def jetzt():
    return datetime.datetime.now().isoformat(timespec="seconds")


def heute():
    return datetime.date.today().isoformat()


def tage_vorher(iso, n):
    return (datetime.date.fromisoformat(iso[:10]) - datetime.timedelta(days=n)).isoformat()


def zahl(v, standard=0.0):
    if v is None or v == "":
        return standard
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v))
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return standard


def datum_lesen(v):
    s = str(v or "").strip()
    if not s:
        return ""
    m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        j, mo, t = map(int, m.groups())
    else:
        m = re.match(r"(\d{1,2})[./](\d{1,2})[./](\d{2,4})", s)
        if m:
            t, mo, j = map(int, m.groups())
            j += 2000 if j < 100 else 0
        elif re.fullmatch(r"\d{5}(\.\d+)?", s):          # Excel-Seriennummer
            return (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(float(s)))).isoformat()
        else:
            return ""
    try:
        return datetime.date(j, mo, t).isoformat()
    except ValueError:
        return ""


def neue_bestellnr(c):
    vorsilbe = f"E-{datetime.date.today().year}-"
    r = c.execute("SELECT nr FROM bestellungen WHERE nr LIKE ? ORDER BY nr DESC LIMIT 1",
                  (vorsilbe + "%",)).fetchone()
    n = int(r["nr"].rsplit("-", 1)[1]) + 1 if r else 1
    return f"{vorsilbe}{n:04d}"


def normal(s):
    return re.sub(r"[^a-z0-9äöüß]", "", str(s).lower())


def hauptrubrik_id(c, rid):
    if not rid:
        return None
    r = c.execute("SELECT id, parent_id FROM rubriken WHERE id=?", (rid,)).fetchone()
    return (r["parent_id"] or r["id"]) if r else None


def rubrik_raten(c, text):
    t = " " + str(text).lower() + " "
    for name, worte in RUBRIK_STICHWORTE:
        if any(w in t for w in worte):
            r = c.execute("SELECT id FROM rubriken WHERE parent_id IS NULL AND name=?", (name,)).fetchone()
            if r:
                return r["id"]
    return None


def lieferant_finden_oder_anlegen(c, lid, name, rubrik_id=None, extra=None):
    if lid:
        r = c.execute("SELECT id FROM lieferanten WHERE id=?", (lid,)).fetchone()
        if r:
            lid = r["id"]
        else:
            lid = None
    if not lid:
        name = str(name or "").strip()
        if not name:
            return None, False
        r = c.execute("SELECT id FROM lieferanten WHERE lower(name)=lower(?)", (name,)).fetchone()
        if not r:
            r = next((x for x in c.execute("SELECT id, name FROM lieferanten")
                      if normal(x["name"]) == normal(name)), None)
        neu = not r
        lid = r["id"] if r else c.execute("INSERT INTO lieferanten(name) VALUES(?)", (name,)).lastrowid
    else:
        neu = False
    for k, v in (extra or {}).items():               # nur leere Felder ergänzen
        if v and k in ("ansprechpartner", "telefon", "email"):
            c.execute(f"UPDATE lieferanten SET {k}=? WHERE id=? AND COALESCE({k},'')=''", (v, lid))
    h = hauptrubrik_id(c, rubrik_id)
    if h:
        rub = c.execute("SELECT rubriken FROM lieferanten WHERE id=?", (lid,)).fetchone()["rubriken"] or ""
        ids = [x for x in rub.split(",") if x]
        if str(h) not in ids:
            c.execute("UPDATE lieferanten SET rubriken=? WHERE id=?", (",".join(ids + [str(h)]), lid))
    return lid, neu


def artikel_finden_oder_anlegen(c, aid, name, nr="", **felder):
    if aid and c.execute("SELECT 1 FROM artikel WHERE id=?", (aid,)).fetchone():
        return aid, False
    name = str(name or "").strip()
    if nr:
        r = c.execute("SELECT id FROM artikel WHERE nr=? AND nr!=''", (str(nr).strip(),)).fetchone()
        if r:
            return r["id"], False
    if not name:
        return None, False
    nn = normal(name)
    for r in c.execute("SELECT id, name, abmessung FROM artikel"):
        if normal(r["name"]) == nn or (r["abmessung"] and normal(r["name"] + r["abmessung"]) == nn):
            return r["id"], False
    werte = {k: v for k, v in felder.items() if v not in (None, "")}
    cols = ["name", "nr"] + list(werte)
    aid = c.execute(f"INSERT INTO artikel({', '.join(cols)}) VALUES({', '.join('?' * len(cols))})",
                    [name, str(nr or "")] + list(werte.values())).lastrowid
    return aid, True


# ------------------------------------------------ Vergleichspreis & Ersparnis
def grenze_fuer(E, datum):
    return f"{datum[:4]}-01-01" if E["basis"] == "vorjahr" else E["start"]


def referenzpreis(c, aid, datum, E):
    """Vergleichspreis eines Artikels für einen Einkauf am `datum`:
    mengengewichteter Ø der 12 Monate vor der Grenze (Start bzw. Jahresbeginn),
    sonst letzter Preis davor, sonst der von Hand eingetragene Vorjahrespreis."""
    if not aid:
        return None
    grenze = grenze_fuer(E, datum)
    von = tage_vorher(grenze, 365)
    rows = c.execute("""
        SELECT datum, menge, preis FROM historie WHERE artikel_id=? AND datum<? AND preis>0
        UNION ALL
        SELECT b.datum, p.menge, p.preis FROM positionen p JOIN bestellungen b ON b.id=p.bestellung_id
        WHERE p.artikel_id=? AND b.datum<? AND p.preis>0 AND b.status IN ('Bestellt','Teilgeliefert','Geliefert')
        """, (aid, grenze, aid, grenze)).fetchall()
    im = [r for r in rows if (r["datum"] or "") >= von]
    if im:
        gew = sum(max(r["menge"] or 0, 0) for r in im)
        if gew > 0:
            return round(sum(max(r["menge"] or 0, 0) * r["preis"] for r in im) / gew, 4)
        return round(sum(r["preis"] for r in im) / len(im), 4)
    if rows:
        return max(rows, key=lambda r: r["datum"] or "")["preis"]
    r = c.execute("SELECT vorjahrespreis FROM artikel WHERE id=?", (aid,)).fetchone()
    return r["vorjahrespreis"] if r and r["vorjahrespreis"] else None


def angebotsschnitt(c, aid, datum):
    """Ø der eingeholten Angebote (je Lieferant das neueste, 120 Tage vor dem Kauf),
    nur wenn mindestens zwei Lieferanten angeboten haben."""
    if not aid:
        return None
    rows = c.execute("""SELECT lieferant_id, preis, datum FROM angebote
                        WHERE artikel_id=? AND datum<=? AND datum>=? AND preis>0
                        ORDER BY datum""", (aid, datum, tage_vorher(datum, 120))).fetchall()
    je = {}
    for r in rows:                           # je Lieferant der beste Preis (Staffel) zählt
        je[r["lieferant_id"]] = min(je.get(r["lieferant_id"], r["preis"]), r["preis"])
    return round(sum(je.values()) / len(je), 4) if len(je) >= 2 else None


def vergleichspreise_setzen(c, bestellung_id=None):
    """Vergleichspreise an Positionen neu rechnen (nach Speichern, Import, Einstellungen)."""
    E = einstellungen(c)
    sql = """SELECT p.id, p.artikel_id, b.datum FROM positionen p
             JOIN bestellungen b ON b.id=p.bestellung_id"""
    rows = c.execute(sql + (" WHERE b.id=?" if bestellung_id else ""),
                     (bestellung_id,) if bestellung_id else ()).fetchall()
    for r in rows:
        d = r["datum"] or heute()
        c.execute("UPDATE positionen SET referenzpreis=?, angebotspreis=? WHERE id=?",
                  (referenzpreis(c, r["artikel_id"], d, E), angebotsschnitt(c, r["artikel_id"], d), r["id"]))


def ersparnis(c, jahr):
    E = einstellungen(c)
    jahr = str(jahr)
    rub = {r["id"]: dict(r) for r in c.execute("SELECT id, name, farbe, parent_id FROM rubriken")}

    def haupt(rid):
        r = rub.get(rid)
        return (r["parent_id"] or r["id"]) if r else None

    pos = c.execute("""
        SELECT p.*, b.datum, b.nr, b.lieferant_id, b.id AS bid, a.name AS artikelname, a.rubrik_id AS art_rubrik
        FROM positionen p JOIN bestellungen b ON b.id=p.bestellung_id
        LEFT JOIN artikel a ON a.id=p.artikel_id
        WHERE b.status IN ('Bestellt','Teilgeliefert','Geliefert')
          AND substr(b.datum,1,4)=? AND b.datum>=?""", (jahr, E["start"])).fetchall()
    je_rubrik, monate, liste = {}, [0.0] * 12, []
    summe = {"volumen": 0.0, "vergleichsvolumen": 0.0, "hart": 0.0, "angebot": 0.0, "basis": 0.0,
             "positionen": len(pos), "mit_vergleich": 0}
    for p in pos:
        menge, preis = p["menge"] or 0, p["preis"] or 0
        vol = menge * preis
        hart = (p["referenzpreis"] - preis) * menge if p["referenzpreis"] else 0.0
        ang = (p["angebotspreis"] - preis) * menge if p["angebotspreis"] else 0.0
        basis = hart if p["referenzpreis"] else (ang if E["bonus_basis"] == "beides" else 0.0)
        h = haupt(p["rubrik_id"] or p["art_rubrik"])
        z = je_rubrik.setdefault(h, {"rubrik_id": h, "volumen": 0.0, "vergleichsvolumen": 0.0,
                                     "hart": 0.0, "angebot": 0.0, "basis": 0.0})
        for ziel in (z, summe):
            ziel["volumen"] += vol
            ziel["hart"] += hart
            ziel["angebot"] += ang
            ziel["basis"] += basis
            if p["referenzpreis"]:
                ziel["vergleichsvolumen"] += p["referenzpreis"] * menge
        if p["referenzpreis"]:
            summe["mit_vergleich"] += 1
        monate[int(p["datum"][5:7]) - 1] += basis
        if hart or ang:
            liste.append({"nr": p["nr"], "bestellung_id": p["bid"], "datum": p["datum"],
                          "bezeichnung": p["bezeichnung"] or p["artikelname"], "menge": menge,
                          "einheit": p["einheit"], "preis": preis, "referenzpreis": p["referenzpreis"],
                          "angebotspreis": p["angebotspreis"], "hart": hart, "angebot": ang,
                          "basis": basis, "rubrik_id": h, "lieferant_id": p["lieferant_id"]})
    # Einkaufsvolumen im Vorjahr je Rubrik (Altpreise + Bestellungen) zum Vergleich
    vj = str(int(jahr) - 1)
    for r in c.execute("""
        SELECT a.rubrik_id AS rid, SUM(h.menge*h.preis) AS s FROM historie h
        LEFT JOIN artikel a ON a.id=h.artikel_id WHERE substr(h.datum,1,4)=? GROUP BY a.rubrik_id
        UNION ALL
        SELECT p.rubrik_id, SUM(p.menge*p.preis) FROM positionen p JOIN bestellungen b ON b.id=p.bestellung_id
        WHERE substr(b.datum,1,4)=? AND b.status IN ('Bestellt','Teilgeliefert','Geliefert') GROUP BY p.rubrik_id
        """, (vj, vj)):
        h = haupt(r["rid"])
        z = je_rubrik.setdefault(h, {"rubrik_id": h, "volumen": 0.0, "vergleichsvolumen": 0.0,
                                     "hart": 0.0, "angebot": 0.0, "basis": 0.0})
        z["vorjahr"] = z.get("vorjahr", 0.0) + (r["s"] or 0)
    kumuliert, s = [], 0.0
    for m in monate:
        s += m
        kumuliert.append(round(s, 2))
    bonus = max(summe["basis"], 0) * float(E["bonus_prozent"] or 0) / 100
    if float(E["bonus_deckel"] or 0) > 0:
        bonus = min(bonus, float(E["bonus_deckel"]))
    liste.sort(key=lambda x: -x["basis"])
    return {"jahr": int(jahr), "einstellungen": E, "summe": summe, "bonus": round(bonus, 2),
            "prozent": (summe["hart"] / summe["vergleichsvolumen"] * 100) if summe["vergleichsvolumen"] else None,
            "rubriken": sorted(je_rubrik.values(), key=lambda z: -z["basis"]),
            "monate": [round(m, 2) for m in monate], "kumuliert": kumuliert,
            "top": liste[:15], "schlechteste": [x for x in liste if x["basis"] < 0][-5:]}


def preisspiegel(c, aid):
    E = einstellungen(c)
    a = c.execute("SELECT * FROM artikel WHERE id=?", (aid,)).fetchone()
    if not a:
        raise Fehler("Artikel nicht gefunden")
    angebote = [dict(r) for r in c.execute("""
        SELECT an.*, l.name AS lieferant, l.telefon FROM angebote an
        LEFT JOIN lieferanten l ON l.id=an.lieferant_id
        WHERE an.artikel_id=? ORDER BY an.datum DESC, an.id DESC""", (aid,))]
    aktuell, schluessel, gesehen = [], set(), set()
    grenze = tage_vorher(heute(), 180)
    for an in angebote:                      # je Lieferant (und Staffelmenge) das neueste der letzten 180 Tage
        k = (an["lieferant_id"], an["menge"])
        if k in schluessel or (an["datum"] or "") < grenze:
            continue
        schluessel.add(k)
        gesehen.add(an["lieferant_id"])
        aktuell.append(an)
    aktuell.sort(key=lambda x: (x["preis"] or 1e18))
    ref = referenzpreis(c, aid, heute(), E)
    letzter = c.execute("""
        SELECT datum, preis, lieferant FROM (
          SELECT h.datum, h.preis, l.name AS lieferant FROM historie h LEFT JOIN lieferanten l ON l.id=h.lieferant_id
          WHERE h.artikel_id=?
          UNION ALL
          SELECT b.datum, p.preis, l.name FROM positionen p JOIN bestellungen b ON b.id=p.bestellung_id
          LEFT JOIN lieferanten l ON l.id=b.lieferant_id
          WHERE p.artikel_id=? AND b.status IN ('Bestellt','Teilgeliefert','Geliefert'))
        ORDER BY datum DESC LIMIT 1""", (aid, aid)).fetchone()
    h = hauptrubrik_id(c, a["rubrik_id"])
    kandidaten = []
    for l in c.execute("SELECT id, name, telefon, ansprechpartner, rubriken FROM lieferanten ORDER BY name"):
        if l["id"] in gesehen:
            continue
        passt = (h and str(h) in (l["rubriken"] or "").split(",")) or c.execute(
            "SELECT 1 FROM historie WHERE artikel_id=? AND lieferant_id=? LIMIT 1", (aid, l["id"])).fetchone()
        if passt:
            kandidaten.append({k: l[k] for k in ("id", "name", "telefon", "ansprechpartner")})
    return {"artikel": dict(a), "referenzpreis": ref, "letzter": dict(letzter) if letzter else None,
            "aktuell": aktuell, "alle": angebote, "noch_fragen": kandidaten}


# ------------------------------------------------------------- Datei-Import
def lies_csv(daten):
    text = None
    for kod in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = daten.decode(kod)
            break
        except UnicodeDecodeError:
            continue
    probe = text[:5000]
    try:
        dialekt = csv.Sniffer().sniff(probe, delimiters=";,\t|")
    except csv.Error:
        class dialekt(csv.excel):
            delimiter = ";" if probe.count(";") > probe.count(",") else ","
    return list(csv.reader(io.StringIO(text), dialekt))


def lies_xlsx(daten):
    """Erstes Tabellenblatt einer .xlsx ohne openpyxl lesen."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    z = zipfile.ZipFile(io.BytesIO(daten))
    geteilt = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns):
            geteilt.append("".join(t.text or "" for t in si.iter(f"{{{ns['m']}}}t")))
    blatt = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml", n))[0]
    zeilen = []
    for row in ET.fromstring(z.read(blatt)).iter(f"{{{ns['m']}}}row"):
        werte = {}
        for zelle in row.findall("m:c", ns):
            ref = zelle.get("r", "")
            buchst = re.match(r"[A-Z]+", ref).group(0) if ref else "A"
            spalte = 0
            for ch in buchst:
                spalte = spalte * 26 + ord(ch) - 64
            typ = zelle.get("t")
            v = zelle.find("m:v", ns)
            if typ == "s" and v is not None:
                wert = geteilt[int(v.text)]
            elif typ == "inlineStr":
                wert = "".join(t.text or "" for t in zelle.iter(f"{{{ns['m']}}}t"))
            else:
                wert = v.text if v is not None else ""
                if wert and re.fullmatch(r"-?\d+\.0", wert):
                    wert = wert[:-2]          # PLZ/Kundennr. nicht als 44149.0
            werte[spalte - 1] = wert
        if werte:
            zeilen.append([werte.get(i, "") for i in range(max(werte) + 1)])
    return zeilen


def datei_lesen(name, daten):
    if name.lower().endswith(".xlsx") or daten[:2] == b"PK":
        zeilen = lies_xlsx(daten)
    elif name.lower().endswith(".xls"):
        raise Fehler("Altes .xls-Format: bitte in Excel als .xlsx oder CSV speichern")
    else:
        zeilen = lies_csv(daten)
    zeilen = [z for z in zeilen if any(str(x).strip() for x in z)]
    if not zeilen:
        raise Fehler("Datei enthält keine Zeilen")
    return zeilen


KUNDEN_HINWEISE = {
    "kundennr": ["kundennr", "kundennummer", "kdnr", "debitor", "debitornr", "kunde nr",
                 "customerid", "customer no", "nr", "nummer", "id"],
    "name": ["firma", "name", "kunde", "firmenname", "unternehmen", "company", "name1",
             "kundenname", "bezeichnung"],
    "ansprechpartner": ["ansprechpartner", "kontakt", "kontaktperson", "contact", "name2", "zuhanden"],
    "strasse": ["strasse", "straße", "str", "adresse", "anschrift", "street"],
    "plz": ["plz", "postleitzahl", "zip", "postcode"],
    "ort": ["ort", "stadt", "city", "wohnort"],
    "land": ["land", "country"],
    "telefon": ["telefon", "tel", "phone", "telefonnummer", "mobil", "handy"],
    "email": ["email", "e-mail", "mail", "emailadresse"],
    "ustid": ["ustid", "ust-id", "ustidnr", "umsatzsteuerid", "vat"],
    "notiz": ["notiz", "bemerkung", "info", "kommentar"],
}
HISTORIE_HINWEISE = {
    "datum": ["datum", "belegdatum", "bestelldatum", "rechnungsdatum", "lieferdatum", "date"],
    "lieferant": ["lieferant", "kreditor", "lieferantenname", "firma", "supplier", "vendor", "hersteller"],
    "artikelnr": ["artikelnr", "artikelnummer", "artnr", "materialnr", "material", "sachnummer", "itemno"],
    "bezeichnung": ["bezeichnung", "artikel", "artikelbezeichnung", "beschreibung", "text",
                    "materialkurztext", "kurztext", "description", "position", "leistung"],
    "menge": ["menge", "anzahl", "stückzahl", "qty", "quantity", "bestellmenge"],
    "einheit": ["einheit", "me", "mengeneinheit", "unit"],
    "preis": ["einzelpreis", "preis", "ep", "stückpreis", "preisjeeinheit", "nettopreis", "unitprice", "price"],
    "gesamt": ["gesamt", "gesamtpreis", "betrag", "summe", "nettobetrag", "positionswert", "gp", "total"],
    "rubrik": ["rubrik", "warengruppe", "kategorie", "gruppe", "materialgruppe", "category"],
}


def spalten_raten(kopf, hinweise):
    zuordnung = {}
    for genau in (True, False):
        for i, k in enumerate(kopf):
            nk = normal(k)
            if not nk or str(i) in zuordnung:
                continue
            for feld, hw in hinweise.items():
                if feld in zuordnung.values():
                    continue
                if (genau and any(nk == normal(h) for h in hw)) or \
                   (not genau and any(len(normal(h)) > 3 and normal(h) in nk for h in hw)):
                    zuordnung[str(i)] = feld
                    break
    return zuordnung


def zeile_zu_dict(z, zuordnung):
    d = {}
    for idx, feld in zuordnung.items():
        if feld and int(idx) < len(z):
            wert = str(z[int(idx)]).strip()
            if wert:
                d[feld] = (d[feld] + " " + wert) if feld in d else wert
    return d


def kunden_einlesen(c, zeilen, zuordnung, quelle):
    """Abgleich über Kundennr., sonst Name+PLZ: vorhandene aktualisieren, neue anlegen."""
    neu = aktualisiert = uebersprungen = 0
    for z in zeilen:
        d = zeile_zu_dict(z, zuordnung)
        d = {k: v for k, v in d.items() if k in KUNDEN_HINWEISE}
        if not d.get("name"):
            uebersprungen += 1
            continue
        vorhanden = None
        if d.get("kundennr"):
            vorhanden = c.execute("SELECT id FROM kunden WHERE kundennr=?", (d["kundennr"],)).fetchone()
        if not vorhanden:
            vorhanden = c.execute("SELECT id FROM kunden WHERE lower(name)=lower(?) AND plz=?",
                                  (d["name"], d.get("plz", ""))).fetchone()
        if vorhanden:
            felder = list(d)
            c.execute(f"UPDATE kunden SET {', '.join(f + '=?' for f in felder)}, geaendert=? WHERE id=?",
                      [d[f] for f in felder] + [jetzt(), vorhanden["id"]])
            aktualisiert += 1
        else:
            felder = list(d) + ["quelle", "angelegt", "geaendert"]
            c.execute(f"INSERT INTO kunden({', '.join(felder)}) VALUES({', '.join('?' * len(felder))})",
                      [d[f] for f in d] + [quelle, jetzt(), jetzt()])
            neu += 1
    return {"neu": neu, "aktualisiert": aktualisiert, "uebersprungen": uebersprungen}


def historie_einlesen(c, zeilen, zuordnung, quelle):
    """Alte Einkäufe einlesen: Lieferanten/Artikel werden gefunden oder angelegt."""
    E = einstellungen(c)
    ersatzdatum = tage_vorher(E["start"], 1)
    n = ohne_datum = uebersprungen = 0
    neue_art = neue_lief = 0
    rubrik_namen = {normal(r["name"]): r["id"] for r in c.execute("SELECT id, name FROM rubriken")}
    for z in zeilen:
        d = zeile_zu_dict(z, zuordnung)
        bez = d.get("bezeichnung") or d.get("artikelnr")
        menge = zahl(d.get("menge"), 1) or 1
        preis = zahl(d.get("preis"), 0)
        if not preis and d.get("gesamt"):
            preis = zahl(d["gesamt"]) / menge
        if not bez or preis <= 0:
            uebersprungen += 1
            continue
        datum = datum_lesen(d.get("datum"))
        if not datum:
            datum, ohne_datum = ersatzdatum, ohne_datum + 1
        rid = rubrik_namen.get(normal(d.get("rubrik", ""))) or rubrik_raten(c, bez + " " + d.get("rubrik", ""))
        lid, ln = lieferant_finden_oder_anlegen(c, None, d.get("lieferant"), rid)
        aid, an = artikel_finden_oder_anlegen(
            c, None, d.get("bezeichnung") or d.get("artikelnr"), d.get("artikelnr", ""),
            rubrik_id=rid, einheit=d.get("einheit") or "Stk", preis=round(preis, 4), lieferant_id=lid)
        neue_art += an
        neue_lief += ln
        c.execute("""INSERT INTO historie(datum, lieferant_id, artikel_id, bezeichnung, menge, einheit, preis, quelle)
                     VALUES(?,?,?,?,?,?,?,?)""",
                  (datum, lid, aid, bez, menge, d.get("einheit", ""), round(preis, 4), quelle))
        n += 1
    vergleichspreise_setzen(c)
    return {"zeilen": n, "neue_artikel": neue_art, "neue_lieferanten": neue_lief,
            "ohne_datum": ohne_datum, "ersatzdatum": ersatzdatum, "uebersprungen": uebersprungen}


# ------------------------------------------------------------ KI & Sprache
def mail_cfg():
    try:
        with open(V3DMAIL_CFG) as f:
            return json.load(f)
    except Exception:
        return {}


def ki_einstellung():
    eigen = cfg().get("ki") or {}
    fremd = mail_cfg().get("ai") or {}
    return ((eigen.get("key") or fremd.get("key") or "").strip(),
            eigen.get("model") or fremd.get("model") or "claude-haiku-4-5")


def ki_aufrufen(system, text, max_tokens=1500):
    key, modell = ki_einstellung()
    if not key:
        raise Fehler("Kein KI-Schlüssel hinterlegt – bitte die Felder unten von Hand ausfüllen.")
    body = json.dumps({"model": modell, "max_tokens": max_tokens, "system": system,
                       "messages": [{"role": "user", "content": text}]}).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, headers={
        "Content-Type": "application/json", "x-api-key": key,
        "anthropic-version": "2023-06-01", "User-Agent": "MarchiEinkauf/2.0"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise Fehler(f"KI-Auswertung fehlgeschlagen ({e.code}) – bitte die Felder von Hand ausfüllen.")
    except (urllib.error.URLError, socket.timeout, TimeoutError):
        raise Fehler("KI nicht erreichbar – bitte die Felder von Hand ausfüllen.")
    return "".join(b.get("text", "") for b in data.get("content") or [] if b.get("type") == "text")


MEMO_SYSTEM = """Du bist die Eingabehilfe im Einkaufsprogramm der Marchi Group (Fahrzeug- und Sonderbau, Dortmund).
Der Einkäufer hat gerade mit einem Lieferanten telefoniert und spricht das Ergebnis kurz ins Handy.
Der Text kommt aus einer Spracherkennung: Zahlwörter, Versprecher und Erkennungsfehler sind normal.
Manche Handys wiederholen dabei den Satzanfang immer wieder ("ich ich habe ich habe heute ..."): werte so einen Text nur EINMAL aus, maßgeblich ist die längste/letzte Fassung.
Mach daraus ein Angebot. Antworte AUSSCHLIESSLICH mit JSON (kein Fließtext, kein Code-Zaun):
{"lieferant":{"id":null,"name":""},"ansprechpartner":"","telefon":"",
 "positionen":[{"artikel_id":null,"artikel_name":"","werkstoff":"","abmessung":"","rubrik_id":null,
   "menge":null,"einheit":"kg","preis":null,"vorjahrespreis":null}],
 "lieferzeit":"","zahlungsbedingungen":"","fracht":"","gueltig_bis":"","notiz":"","rueckfrage":""}
Regeln:
- lieferant.id: id aus der Lieferantenliste, wenn der Name passt (auch ungefähr/abgekürzt/falsch erkannt, z. B. "Müller" = "Stahlhandel Müller GmbH"). Sonst null und den Namen sauber schreiben.
- Eine Position je angebotenem Artikel. artikel_id aus der Artikelliste, wenn derselbe Artikel gemeint ist (gleiches Material und gleiche Abmessung); sonst null, und artikel_name kurz und eindeutig formulieren, wie man ihn in einer Artikelliste führt (z. B. "Aluprofil 40×40×2", "Stahlblech DC01 2 mm").
- rubrik_id: passendste Rubrik-ID aus der Liste (Unterrubrik, wenn eine passt).
- einheit: eine aus der Einheitenliste ("pro Kilo" = "kg", "pro Meter" = "m", "pro Tafel" = "Tafel", "Stück" = "Stk").
- preis: netto in Euro JE EINHEIT als Zahl. "drei achtzig" = 3.80, "drei Euro achtzig" = 3.80, "zwölfhundert" = 1200. Nennt er nur einen Gesamtpreis und eine Menge, teile durch die Menge. Fehlt der Preis: null und in rueckfrage nachfragen.
- menge: angefragte bzw. Mindestmenge, sonst null. Staffelpreise ("ab 500 kg 3,60") als eigene Position mit gleichem Artikel und anderer Menge.
- vorjahrespreis: nur wenn er sagt, was man bisher/letztes Jahr bezahlt hat.
- lieferzeit, zahlungsbedingungen (Zahlungsziel, Skonto), fracht (frei Haus/Versandkosten), gueltig_bis (YYYY-MM-DD, relativ zu heute auflösen): nur wenn genannt.
- notiz: alles Weitere in einem kurzen Satz. rueckfrage: nur wenn etwas Wichtiges fehlt oder unklar ist.
- Nichts erfinden."""


def memo_auswerten(c, text, lieferant_id=None, artikel_id=None):
    lief = [{"id": r["id"], "name": r["name"], "ort": r["ort"]} for r in
            c.execute("SELECT id, name, ort FROM lieferanten ORDER BY name LIMIT 400")]
    rub = {r["id"]: dict(r) for r in c.execute("SELECT id, name, parent_id FROM rubriken")}
    rubriken = [{"id": i, "name": (rub[r["parent_id"]]["name"] + " › " if r["parent_id"] in rub else "") + r["name"]}
                for i, r in rub.items()]
    art = [{"id": r["id"], "name": r["name"], "abmessung": r["abmessung"], "werkstoff": r["werkstoff"],
            "einheit": r["einheit"]} for r in
           c.execute("SELECT id, name, abmessung, werkstoff, einheit FROM artikel WHERE aktiv=1 ORDER BY id DESC LIMIT 600")]
    kontext = {"heute": heute(), "lieferanten": lief, "artikel": art, "rubriken": rubriken, "einheiten": EINHEITEN}
    if lieferant_id:
        kontext["hinweis_lieferant"] = f"Das Gespräch war mit Lieferant id {lieferant_id}."
    if artikel_id:
        kontext["hinweis_artikel"] = f"Angefragt war Artikel id {artikel_id}."
    antwort = ki_aufrufen(MEMO_SYSTEM, "KONTEXT:\n" + json.dumps(kontext, ensure_ascii=False) +
                          "\n\nDIKTAT DES EINKÄUFERS:\n" + text)
    m = re.search(r"\{.*\}", antwort, re.S)
    if not m:
        raise Fehler("KI-Antwort nicht lesbar – bitte von Hand ausfüllen.")
    d = json.loads(m.group(0))
    # Plausibilisieren: nur existierende IDs durchlassen
    ids_l = {x["id"] for x in lief}
    ids_a = {x["id"] for x in art}
    if (d.get("lieferant") or {}).get("id") not in ids_l:
        d.setdefault("lieferant", {})["id"] = None
    if lieferant_id and not d["lieferant"].get("id") and not d["lieferant"].get("name"):
        d["lieferant"]["id"] = lieferant_id
    for p in d.get("positionen") or []:
        if p.get("artikel_id") not in ids_a:
            p["artikel_id"] = None
        if p.get("rubrik_id") not in rub:
            p["rubrik_id"] = None
        if p.get("einheit") not in EINHEITEN:
            p["einheit"] = "Stk"
    return d


def memo_speichern(c, d):
    """Bestätigtes Angebot aus dem Telefonat ablegen. Legt fehlende Lieferanten/Artikel an."""
    datum = d.get("datum") or heute()
    positionen = [p for p in d.get("positionen") or [] if (p.get("artikel_id") or p.get("artikel_name"))]
    if not positionen:
        raise Fehler("Kein Artikel angegeben")
    erste_rubrik = next((p.get("rubrik_id") for p in positionen if p.get("rubrik_id")), None)
    l = d.get("lieferant") or {}
    lid, lneu = lieferant_finden_oder_anlegen(
        c, l.get("id"), l.get("name"), erste_rubrik,
        {"ansprechpartner": d.get("ansprechpartner"), "telefon": d.get("telefon")})
    if not lid:
        raise Fehler("Bitte den Lieferanten angeben")
    ergebnis = {"lieferant_id": lid, "lieferant_neu": lneu, "artikel": [], "angebote": []}
    for p in positionen:
        aid, aneu = artikel_finden_oder_anlegen(
            c, p.get("artikel_id"), p.get("artikel_name"), "",
            rubrik_id=p.get("rubrik_id"), werkstoff=p.get("werkstoff"), abmessung=p.get("abmessung"),
            einheit=p.get("einheit") or "Stk", preis=zahl(p.get("preis")), lieferant_id=lid)
        if p.get("rubrik_id"):
            lieferant_finden_oder_anlegen(c, lid, None, p["rubrik_id"])
        if zahl(p.get("vorjahrespreis")) > 0:
            c.execute("UPDATE artikel SET vorjahrespreis=? WHERE id=?", (zahl(p["vorjahrespreis"]), aid))
        nid = c.execute("""INSERT INTO angebote(datum, lieferant_id, artikel_id, menge, einheit, preis, lieferzeit,
                           zahlungsbedingungen, fracht, gueltig_bis, notiz, memo, angelegt)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (datum, lid, aid, zahl(p.get("menge"), None), p.get("einheit") or "Stk", zahl(p.get("preis")),
                         d.get("lieferzeit") or "", d.get("zahlungsbedingungen") or "", d.get("fracht") or "",
                         d.get("gueltig_bis") or "", d.get("notiz") or "", d.get("memo") or "", jetzt())).lastrowid
        ergebnis["angebote"].append(nid)
        if aid not in ergebnis["artikel"]:
            ergebnis["artikel"].append(aid)
        ergebnis.setdefault("artikel_neu", []).append(aneu)
    return ergebnis


def whisper_da():
    try:
        import importlib.util
        return importlib.util.find_spec("whisper") is not None
    except Exception:
        return False


def ton_zu_text(daten):
    global _whisper
    with _whisper_lock:
        if _whisper is None:
            try:
                import whisper
            except ImportError:
                raise Fehler("Auf dem Server ist keine Spracherkennung installiert.")
            _whisper = whisper.load_model(cfg().get("whisper_modell") or "small")
        tmp = os.path.join(tempfile.gettempdir(), f"marchi-{secrets.token_hex(6)}.bin")
        try:
            with open(tmp, "wb") as f:
                f.write(daten)
            r = _whisper.transcribe(tmp, language="de", fp16=False,
                                    initial_prompt="Einkauf: Lieferant, Angebot, Aluprofil, Stahlblech, pro Kilo, Euro, Lieferzeit, Skonto, frei Haus.")
        except Exception as e:
            raise Fehler(f"Erkennung fehlgeschlagen: {e}")
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass
    return (r.get("text") or "").strip()


# --------------------------------------------------------------------- HTTP
class H(BaseHTTPRequestHandler):
    server_version = "MarchiEinkauf/2.0"

    def log_message(self, fmt, *args):
        pass

    def antwort(self, code, daten, typ="application/json; charset=utf-8", kopf=None):
        if not isinstance(daten, (bytes, bytearray)):
            daten = json.dumps(daten, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(daten)))
        self.send_header("X-Content-Type-Options", "nosniff")
        if "Cache-Control" not in (kopf or {}):
            self.send_header("Cache-Control", "no-store")
        for k, v in (kopf or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(daten)

    def fehler(self, code, text):
        self.antwort(code, {"fehler": text})

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise Fehler("Datei zu groß")
        return self.rfile.read(n) if n else b""

    def json_body(self):
        b = self.body()
        return json.loads(b) if b else {}

    def angemeldet(self):
        t = SimpleCookie(self.headers.get("Cookie", "")).get("me_sitzung")
        if not t:
            return False
        with db() as c:
            r = c.execute("SELECT ablauf FROM sitzungen WHERE token=?",
                          (hashlib.sha256(t.value.encode()).hexdigest(),)).fetchone()
        return bool(r and r["ablauf"] > jetzt())

    def do_GET(self):
        self.verteilen("GET")

    def do_POST(self):
        self.verteilen("POST")

    def do_PUT(self):
        self.verteilen("PUT")

    def do_DELETE(self):
        self.verteilen("DELETE")

    def statisch(self, pfad):
        typen = {".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json"}
        name = pfad.lstrip("/")
        if name in ("", "index.html"):
            with open(os.path.join(HIER, "app.html"), "rb") as f:
                return self.antwort(200, f.read(), "text/html; charset=utf-8")
        if re.fullmatch(r"(logo-[a-z-]+\.svg|icon-\d+\.png|manifest\.webmanifest)", name):
            datei = os.path.join(HIER, name)
            if os.path.exists(datei):
                with open(datei, "rb") as f:
                    return self.antwort(200, f.read(), typen[os.path.splitext(name)[1]],
                                        {"Cache-Control": "max-age=86400"})
        return self.fehler(404, "nicht gefunden")

    def verteilen(self, methode):
        url = urlparse(self.path)
        pfad = url.path.rstrip("/") or "/"
        try:
            if methode == "GET" and not pfad.startswith("/api/"):
                return self.statisch(pfad)
            if pfad == "/api/login" and methode == "POST":
                return self.login()
            if not pfad.startswith("/api/"):
                return self.fehler(404, "nicht gefunden")
            if not self.angemeldet():
                return self.fehler(401, "Anmeldung nötig")
            return self.api(methode, pfad[5:].split("/"), parse_qs(url.query))
        except (Fehler, ValueError) as e:
            return self.fehler(400, str(e))
        except sqlite3.IntegrityError as e:
            return self.fehler(409, f"Datenbank: {e}")
        except Exception as e:                      # noqa: BLE001
            print("Fehler:", repr(e), flush=True)
            return self.fehler(500, "Interner Fehler")

    def login(self):
        global _fehlversuche
        t = time.time()
        _fehlversuche = [x for x in _fehlversuche if t - x < 600]
        if len(_fehlversuche) >= 8:
            return self.fehler(429, "Zu viele Fehlversuche – bitte 10 Minuten warten.")
        if not pin_ok(self.json_body().get("pin", "")):
            _fehlversuche.append(t)
            return self.fehler(403, "PIN falsch")
        tok = secrets.token_urlsafe(32)
        ablauf = (datetime.datetime.now() + datetime.timedelta(days=SITZUNG_TAGE)).isoformat(timespec="seconds")
        with db() as c:
            c.execute("DELETE FROM sitzungen WHERE ablauf<?", (jetzt(),))
            c.execute("INSERT INTO sitzungen VALUES(?,?)", (hashlib.sha256(tok.encode()).hexdigest(), ablauf))
        sicher = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
        return self.antwort(200, {"ok": True}, kopf={
            "Set-Cookie": f"me_sitzung={tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SITZUNG_TAGE * 86400}{sicher}"})

    def api(self, methode, teile, query):
        res = teile[0]
        unter = teile[1] if len(teile) > 1 else ""
        rid = int(unter) if unter.isdigit() else None

        if res == "alles" and methode == "GET":
            return self.antwort(200, alles())
        if res == "einstellungen" and methode == "PUT":
            d = self.json_body()
            with _lock, db() as c:
                for k, v in d.items():
                    if k in STANDARD_EINSTELLUNGEN:
                        if isinstance(STANDARD_EINSTELLUNGEN[k], float):
                            v = zahl(v)
                        if k == "start" and not datum_lesen(v):
                            raise Fehler("Datum ungültig")
                        c.execute("INSERT OR REPLACE INTO einstellungen VALUES(?,?)", (k, json.dumps(v)))
                vergleichspreise_setzen(c)
            return self.antwort(200, {"ok": True})
        if res == "ersparnis" and methode == "GET":
            with db() as c:
                return self.antwort(200, ersparnis(c, (query.get("jahr") or [datetime.date.today().year])[0]))
        if res == "preisspiegel" and rid and methode == "GET":
            with db() as c:
                return self.antwort(200, preisspiegel(c, rid))
        if res == "memo" and methode == "POST":
            d = self.json_body()
            if unter == "speichern":
                with _lock, db() as c:
                    return self.antwort(200, memo_speichern(c, d))
            text = str(d.get("text", "")).strip()
            if len(text) < 5:
                raise Fehler("Bitte zuerst etwas sagen oder eintippen.")
            with db() as c:
                return self.antwort(200, memo_auswerten(c, text[:6000], d.get("lieferant_id"), d.get("artikel_id")))
        if res == "ton" and methode == "POST":
            return self.antwort(200, {"text": ton_zu_text(self.body())})
        if res in ("kunden", "historie") and unter == "vorschau" and methode == "POST":
            zeilen = datei_lesen((query.get("datei") or ["import.csv"])[0], self.body())
            hw = KUNDEN_HINWEISE if res == "kunden" else HISTORIE_HINWEISE
            return self.antwort(200, {"kopf": zeilen[0], "zeilen": zeilen[1:],
                                      "zuordnung": spalten_raten(zeilen[0], hw), "felder": list(hw)})
        if res in ("kunden", "historie") and unter == "import" and methode == "POST":
            d = self.json_body()
            f = kunden_einlesen if res == "kunden" else historie_einlesen
            with _lock, db() as c:
                return self.antwort(200, f(c, d.get("zeilen", []), d.get("zuordnung", {}),
                                           d.get("quelle", "Import")[:120]))
        if res == "historie" and methode == "DELETE":
            quelle = (query.get("quelle") or [""])[0]
            with _lock, db() as c:
                n = c.execute("DELETE FROM historie WHERE quelle=?", (quelle,)).rowcount
                vergleichspreise_setzen(c)
            return self.antwort(200, {"geloescht": n})
        if res == "angebote" and rid and len(teile) > 2 and teile[2] == "bestellen" and methode == "POST":
            with _lock, db() as c:
                return self.antwort(200, {"id": aus_angebot_bestellen(c, rid, self.json_body())})
        if res == "bestellungen":
            return self.bestellungen(methode, rid)
        if res == "export" and methode == "GET":
            return self.export(unter)
        if res not in FELDER:
            return self.fehler(404, "unbekannt")

        felder = FELDER[res]
        pflicht = PFLICHT.get(res, "name")
        with _lock, db() as c:
            if methode == "POST":
                d = self.json_body()
                if not str(d.get(pflicht) or "").strip():
                    raise Fehler("Name fehlt" if pflicht == "name" else "Pflichtfeld fehlt")
                cols = [f for f in felder if f in d]
                werte = [d[f] for f in cols]
                if res == "kunden":
                    cols += ["angelegt", "geaendert", "quelle"]
                    werte += [jetzt(), jetzt(), "manuell"]
                if res == "angebote":
                    cols.append("angelegt")
                    werte.append(jetzt())
                    if "datum" not in d:
                        cols.append("datum")
                        werte.append(heute())
                nid = c.execute(f"INSERT INTO {res}({', '.join(cols)}) VALUES({', '.join('?' * len(cols))})",
                                werte).lastrowid
                return self.antwort(200, {"id": nid})
            if methode == "PUT" and rid:
                d = self.json_body()
                cols = [f for f in felder if f in d]
                if res == "rubriken" and d.get("parent_id") == rid:
                    raise Fehler("Rubrik kann nicht unter sich selbst liegen")
                if cols:
                    zus = ", geaendert=?" if res == "kunden" else ""
                    werte = [d[f] for f in cols] + ([jetzt()] if res == "kunden" else []) + [rid]
                    c.execute(f"UPDATE {res} SET {', '.join(f + '=?' for f in cols)}{zus} WHERE id=?", werte)
                if res == "artikel" and "vorjahrespreis" in d:
                    vergleichspreise_setzen(c)
                return self.antwort(200, {"ok": True})
            if methode == "DELETE" and rid:
                c.execute(f"DELETE FROM {res} WHERE id=?", (rid,))
                return self.antwort(200, {"ok": True})
        return self.fehler(405, "nicht erlaubt")

    def bestellungen(self, methode, rid):
        with _lock, db() as c:
            if methode == "GET" and rid:
                b = c.execute("SELECT * FROM bestellungen WHERE id=?", (rid,)).fetchone()
                if not b:
                    return self.fehler(404, "nicht gefunden")
                pos = c.execute("SELECT * FROM positionen WHERE bestellung_id=? ORDER BY sort,id", (rid,)).fetchall()
                return self.antwort(200, {**dict(b), "positionen": [dict(p) for p in pos]})
            if methode in ("POST", "PUT"):
                d = self.json_body()
                rid = bestellung_schreiben(c, rid if methode == "PUT" else None, d)
                return self.antwort(200, {"id": rid})
            if methode == "DELETE" and rid:
                c.execute("DELETE FROM bestellungen WHERE id=?", (rid,))
                return self.antwort(200, {"ok": True})
        return self.fehler(405, "nicht erlaubt")

    def export(self, was):
        with db() as c:
            if was == "kunden":
                rows = c.execute("SELECT kundennr,name,ansprechpartner,strasse,plz,ort,land,telefon,email,ustid,notiz FROM kunden ORDER BY name").fetchall()
                kopf = ["Kundennr", "Name", "Ansprechpartner", "Straße", "PLZ", "Ort", "Land", "Telefon", "E-Mail", "USt-ID", "Notiz"]
            elif was == "bestellungen":
                rows = c.execute("""
                    SELECT b.nr, b.datum, b.status, l.name, k.name, b.projekt, b.besteller,
                           b.liefertermin, COALESCE(r2.name || ' › ', '') || COALESCE(r.name,''),
                           p.bezeichnung, p.menge, p.einheit, p.preis, ROUND(p.menge*p.preis,2),
                           p.referenzpreis, ROUND((p.referenzpreis-p.preis)*p.menge,2)
                    FROM bestellungen b
                    LEFT JOIN positionen p ON p.bestellung_id=b.id
                    LEFT JOIN rubriken r ON r.id=p.rubrik_id
                    LEFT JOIN rubriken r2 ON r2.id=r.parent_id
                    LEFT JOIN lieferanten l ON l.id=b.lieferant_id
                    LEFT JOIN kunden k ON k.id=b.kunde_id
                    ORDER BY b.nr, p.sort""").fetchall()
                kopf = ["Bestellnr", "Datum", "Status", "Lieferant", "Kunde", "Projekt", "Besteller",
                        "Liefertermin", "Rubrik", "Position", "Menge", "Einheit", "Einzelpreis", "Summe",
                        "Vergleichspreis", "Ersparnis"]
            elif was == "angebote":
                rows = c.execute("""
                    SELECT an.datum, l.name, a.name, a.abmessung, an.menge, an.einheit, an.preis,
                           an.lieferzeit, an.zahlungsbedingungen, an.fracht, an.gueltig_bis, an.notiz
                    FROM angebote an LEFT JOIN lieferanten l ON l.id=an.lieferant_id
                    LEFT JOIN artikel a ON a.id=an.artikel_id ORDER BY a.name, an.preis""").fetchall()
                kopf = ["Datum", "Lieferant", "Artikel", "Abmessung", "Menge", "Einheit", "Preis je Einheit",
                        "Lieferzeit", "Zahlungsbedingungen", "Fracht", "Gültig bis", "Notiz"]
            else:
                return self.fehler(404, "unbekannt")
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";")
        w.writerow(kopf)
        for r in rows:
            w.writerow([str(x).replace(".", ",") if isinstance(x, float) else ("" if x is None else x) for x in r])
        datei = f"marchi-{was}-{heute()}.csv"
        return self.antwort(200, ("﻿" + buf.getvalue()).encode(), "text/csv; charset=utf-8",
                            {"Content-Disposition": f'attachment; filename="{datei}"'})


def bestellung_schreiben(c, rid, d):
    if rid is None:
        d.setdefault("datum", heute())
        cols = [f for f in BESTELL_FELDER + ["angebot_id"] if f in d]
        rid = c.execute(
            f"INSERT INTO bestellungen(nr, angelegt, {', '.join(cols)}) VALUES(?,?,{', '.join('?' * len(cols))})",
            [neue_bestellnr(c), jetzt()] + [d[f] for f in cols]).lastrowid
    else:
        cols = [f for f in BESTELL_FELDER if f in d]
        if cols:
            c.execute(f"UPDATE bestellungen SET {', '.join(f + '=?' for f in cols)} WHERE id=?",
                      [d[f] for f in cols] + [rid])
    if "positionen" in d:
        c.execute("DELETE FROM positionen WHERE bestellung_id=?", (rid,))
        for i, p in enumerate(d["positionen"]):
            if not (p.get("bezeichnung") or p.get("artikel_id")):
                continue
            c.execute("""INSERT INTO positionen(bestellung_id, artikel_id, rubrik_id,
                         bezeichnung, menge, einheit, preis, sort) VALUES(?,?,?,?,?,?,?,?)""",
                      (rid, p.get("artikel_id") or None, p.get("rubrik_id") or None,
                       p.get("bezeichnung", ""), zahl(p.get("menge"), 1),
                       p.get("einheit", "Stk"), zahl(p.get("preis")), i))
    vergleichspreise_setzen(c, rid)
    return rid


def aus_angebot_bestellen(c, angebot_id, d):
    an = c.execute("""SELECT an.*, a.name, a.abmessung, a.rubrik_id FROM angebote an
                      JOIN artikel a ON a.id=an.artikel_id WHERE an.id=?""", (angebot_id,)).fetchone()
    if not an:
        raise Fehler("Angebot nicht gefunden")
    E = einstellungen(c)
    kond = ", ".join(x for x in (an["lieferzeit"] and "Lieferzeit: " + an["lieferzeit"],
                                 an["zahlungsbedingungen"], an["fracht"]) if x)
    return bestellung_schreiben(c, None, {
        "status": "Bestellt", "lieferant_id": an["lieferant_id"], "angebot_id": angebot_id,
        "besteller": d.get("besteller") or E["einkaeufer"], "notiz": kond,
        "positionen": [{"artikel_id": an["artikel_id"], "rubrik_id": an["rubrik_id"],
                        "bezeichnung": an["name"] + (" – " + an["abmessung"] if an["abmessung"] else ""),
                        "menge": zahl(d.get("menge")) or an["menge"] or 1, "einheit": an["einheit"],
                        "preis": an["preis"]}]})


def alles():
    with db() as c:
        def liste(sql, *a):
            return [dict(r) for r in c.execute(sql, a).fetchall()]
        E = einstellungen(c)
        refs = {}
        for r in c.execute("SELECT id FROM artikel"):
            v = referenzpreis(c, r["id"], heute(), E)
            if v:
                refs[r["id"]] = v
        key, _ = ki_einstellung()
        return {
            "rubriken": liste("SELECT * FROM rubriken ORDER BY sort, name"),
            "artikel": liste("SELECT * FROM artikel ORDER BY name"),
            "lieferanten": liste("SELECT * FROM lieferanten ORDER BY name"),
            "kunden": liste("SELECT * FROM kunden ORDER BY name"),
            "bestellungen": liste("""
                SELECT b.*, COALESCE(SUM(p.menge*p.preis),0) AS summe, COUNT(p.id) AS anzahl,
                       GROUP_CONCAT(DISTINCT p.rubrik_id) AS rubrik_ids,
                       SUM(CASE WHEN p.referenzpreis>0 THEN (p.referenzpreis-p.preis)*p.menge ELSE 0 END) AS ersparnis
                FROM bestellungen b LEFT JOIN positionen p ON p.bestellung_id=b.id
                GROUP BY b.id ORDER BY b.nr DESC"""),
            "angebote": liste("""SELECT * FROM angebote WHERE datum>=? ORDER BY datum DESC, id DESC""",
                              tage_vorher(heute(), 365)),
            "historie_quellen": liste("""SELECT quelle, COUNT(*) AS n, MIN(datum) AS von, MAX(datum) AS bis
                                         FROM historie GROUP BY quelle ORDER BY MAX(id) DESC"""),
            "refs": refs,
            "einstellungen": E,
            "ki": bool(key),
            "whisper": whisper_da(),
            "einheiten": EINHEITEN,
            "status": STATUS,
        }


if __name__ == "__main__":
    init_db()
    cfg()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), H)
    print(f"Marchi Zentraleinkauf läuft auf http://127.0.0.1:{PORT}", flush=True)
    srv.serve_forever()
