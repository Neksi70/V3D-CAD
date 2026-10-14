#!/usr/bin/env python3
"""Marchi Group – Zentraleinkauf.

Rubriken (Stahl, Alu, ... frei erweiterbar), Artikel, Lieferanten, Kunden und
Bestellungen. Kunden lassen sich aus CSV oder Excel (.xlsx) einlesen; die
Spalten werden automatisch zugeordnet, bekannte Kunden aktualisiert statt
doppelt angelegt.

Start:  python3 server.py [PORT]      (Default 8811)
Daten:  daten.db (SQLite) im selben Verzeichnis
Web:    app.html — eine Datei
Zugang: PIN aus ~/.config/marchi-einkauf/config.json (wird beim ersten Start
        erzeugt und im Log ausgegeben).

Nur Python-Stdlib.
"""
import csv
import datetime
import hashlib
import io
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import zipfile
import xml.etree.ElementTree as ET
from http.cookies import SimpleCookie
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

HIER = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HIER, "daten.db")
CFG_DIR = os.path.join(os.path.expanduser("~"), ".config", "marchi-einkauf")
CFG_DATEI = os.path.join(CFG_DIR, "config.json")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8811
MAX_BODY = 20 * 1024 * 1024
SITZUNG_TAGE = 90

_lock = threading.Lock()
_sitzungen = {}

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
EINHEITEN = ["Stk", "kg", "t", "m", "m²", "lfm", "Tafel", "Pak", "Rolle", "l", "Satz"]
STATUS = ["Bedarf", "Angefragt", "Bestellt", "Teilgeliefert", "Geliefert", "Storniert"]

# Tabellen und welche Felder die API schreiben darf
FELDER = {
    "rubriken": ["name", "farbe", "parent_id", "sort", "notiz"],
    "artikel": ["rubrik_id", "nr", "name", "werkstoff", "abmessung", "einheit",
                "preis", "lieferant_id", "mindestmenge", "notiz", "aktiv"],
    "lieferanten": ["name", "ansprechpartner", "email", "telefon", "strasse",
                    "plz", "ort", "kundennr_bei_uns", "rubriken", "notiz"],
    "kunden": ["kundennr", "name", "ansprechpartner", "strasse", "plz", "ort",
               "land", "telefon", "email", "ustid", "notiz"],
    "bestellungen": ["status", "datum", "lieferant_id", "kunde_id", "projekt",
                     "besteller", "liefertermin", "lieferadresse", "notiz"],
}


# ---------------------------------------------------------------- Datenbank
def db():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c


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
        """)
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


def jetzt():
    return datetime.datetime.now().isoformat(timespec="seconds")


def zahl(v, standard=0.0):
    if v is None or v == "":
        return standard
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("€", "").replace(" ", "")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return standard


def neue_bestellnr(c):
    jahr = datetime.date.today().year
    vorsilbe = f"E-{jahr}-"
    r = c.execute("SELECT nr FROM bestellungen WHERE nr LIKE ? ORDER BY nr DESC LIMIT 1",
                  (vorsilbe + "%",)).fetchone()
    n = int(r["nr"].rsplit("-", 1)[1]) + 1 if r else 1
    return f"{vorsilbe}{n:04d}"


# ------------------------------------------------------ Kunden-Import (Datei)
def lies_csv(daten):
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
        dialekt = csv.excel
        dialekt.delimiter = ";" if probe.count(";") > probe.count(",") else ","
    return [r for r in csv.reader(io.StringIO(text), dialekt)]


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
            buchst = re.match(r"[A-Z]+", ref).group(0) if ref else None
            spalte = 0
            for ch in buchst or "A":
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


# Spaltenüberschrift -> Kundenfeld (Kleinbuchstaben, ohne Sonderzeichen)
SPALTEN_HINWEISE = {
    "kundennr": ["kundennr", "kundennummer", "kdnr", "debitor", "debitornr", "kunde nr",
                 "customerid", "customer no", "nr", "nummer", "id"],
    "name": ["firma", "name", "kunde", "firmenname", "unternehmen", "company", "name1",
             "kundenname", "bezeichnung"],
    "ansprechpartner": ["ansprechpartner", "kontakt", "kontaktperson", "contact", "name2",
                        "zuhanden"],
    "strasse": ["strasse", "straße", "str", "adresse", "anschrift", "street"],
    "plz": ["plz", "postleitzahl", "zip", "postcode"],
    "ort": ["ort", "stadt", "city", "wohnort"],
    "land": ["land", "country"],
    "telefon": ["telefon", "tel", "phone", "telefonnummer", "mobil", "handy"],
    "email": ["email", "e-mail", "mail", "emailadresse"],
    "ustid": ["ustid", "ust-id", "ustidnr", "umsatzsteuerid", "vat"],
    "notiz": ["notiz", "bemerkung", "info", "kommentar"],
}


def normal(s):
    return re.sub(r"[^a-z0-9äöüß]", "", str(s).lower())


def spalten_raten(kopf):
    zuordnung = {}
    for i, k in enumerate(kopf):
        nk = normal(k)
        if not nk:
            continue
        for feld, hinweise in SPALTEN_HINWEISE.items():
            if feld in zuordnung.values():
                continue
            if any(nk == normal(h) for h in hinweise):
                zuordnung[str(i)] = feld
                break
        else:
            for feld, hinweise in SPALTEN_HINWEISE.items():
                if feld in zuordnung.values():
                    continue
                if any(len(normal(h)) > 3 and normal(h) in nk for h in hinweise):
                    zuordnung[str(i)] = feld
                    break
    return zuordnung


def kunden_einlesen(c, zeilen, zuordnung, quelle):
    """zuordnung: {spaltenindex: feld}. Abgleich über Kundennr., sonst Name+PLZ."""
    neu = aktualisiert = uebersprungen = 0
    for z in zeilen:
        d = {}
        for idx, feld in zuordnung.items():
            if feld and int(idx) < len(z):
                wert = str(z[int(idx)]).strip()
                if wert:
                    d[feld] = (d[feld] + " " + wert) if feld in d else wert
        if not d.get("name"):
            uebersprungen += 1
            continue
        vorhanden = None
        if d.get("kundennr"):
            vorhanden = c.execute("SELECT id FROM kunden WHERE kundennr=?",
                                  (d["kundennr"],)).fetchone()
        if not vorhanden:
            vorhanden = c.execute(
                "SELECT id FROM kunden WHERE lower(name)=lower(?) AND plz=?",
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


# --------------------------------------------------------------------- HTTP
class H(BaseHTTPRequestHandler):
    server_version = "MarchiEinkauf/1.0"

    def log_message(self, fmt, *args):
        pass

    def antwort(self, code, daten, typ="application/json; charset=utf-8", kopf=None):
        if not isinstance(daten, (bytes, bytearray)):
            daten = json.dumps(daten, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(daten)))
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
            raise ValueError("Datei zu groß")
        return self.rfile.read(n) if n else b""

    def json_body(self):
        b = self.body()
        return json.loads(b) if b else {}

    def angemeldet(self):
        ck = SimpleCookie(self.headers.get("Cookie", ""))
        t = ck.get("me_sitzung")
        if not t:
            return False
        ablauf = _sitzungen.get(t.value)
        return bool(ablauf and ablauf > datetime.datetime.now())

    # -- Routing
    def do_GET(self):
        self.verteilen("GET")

    def do_POST(self):
        self.verteilen("POST")

    def do_PUT(self):
        self.verteilen("PUT")

    def do_DELETE(self):
        self.verteilen("DELETE")

    def verteilen(self, methode):
        url = urlparse(self.path)
        pfad = url.path.rstrip("/") or "/"
        try:
            if methode == "GET" and pfad in ("/", "/index.html"):
                with open(os.path.join(HIER, "app.html"), "rb") as f:
                    return self.antwort(200, f.read(), "text/html; charset=utf-8")
            if methode == "GET" and re.fullmatch(r"/logo-[a-z-]+\.svg", pfad):
                datei = os.path.join(HIER, pfad[1:])
                if os.path.exists(datei):
                    with open(datei, "rb") as f:
                        return self.antwort(200, f.read(), "image/svg+xml",
                                            {"Cache-Control": "max-age=86400"})
            if pfad == "/api/login" and methode == "POST":
                d = self.json_body()
                if not pin_ok(d.get("pin", "")):
                    return self.fehler(403, "PIN falsch")
                t = secrets.token_urlsafe(24)
                _sitzungen[t] = datetime.datetime.now() + datetime.timedelta(days=SITZUNG_TAGE)
                return self.antwort(200, {"ok": True}, kopf={
                    "Set-Cookie": f"me_sitzung={t}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SITZUNG_TAGE * 86400}"})
            if not pfad.startswith("/api/"):
                return self.fehler(404, "nicht gefunden")
            if not self.angemeldet():
                return self.fehler(401, "Anmeldung nötig")
            return self.api(methode, pfad[5:].split("/"), parse_qs(url.query))
        except ValueError as e:
            return self.fehler(400, str(e))
        except sqlite3.IntegrityError as e:
            return self.fehler(409, f"Datenbank: {e}")
        except Exception as e:                      # noqa: BLE001
            print("Fehler:", repr(e), flush=True)
            return self.fehler(500, "Interner Fehler")

    def api(self, methode, teile, query):
        res = teile[0]
        rid = int(teile[1]) if len(teile) > 1 and teile[1].isdigit() else None

        if res == "meta" and methode == "GET":
            return self.antwort(200, {"einheiten": EINHEITEN, "status": STATUS})
        if res == "alles" and methode == "GET":
            return self.antwort(200, alles())
        if res == "kunden" and len(teile) > 1 and teile[1] == "vorschau" and methode == "POST":
            return self.kunden_vorschau(query)
        if res == "kunden" and len(teile) > 1 and teile[1] == "import" and methode == "POST":
            d = self.json_body()
            with _lock, db() as c:
                erg = kunden_einlesen(c, d.get("zeilen", []), d.get("zuordnung", {}),
                                      d.get("quelle", "Import"))
            return self.antwort(200, erg)
        if res == "bestellungen":
            return self.bestellungen(methode, rid)
        if res == "export" and methode == "GET":
            return self.export(teile[1] if len(teile) > 1 else "")
        if res not in FELDER:
            return self.fehler(404, "unbekannt")

        felder = FELDER[res]
        with _lock, db() as c:
            if methode == "POST":
                d = self.json_body()
                if not str(d.get("name", "")).strip():
                    raise ValueError("Name fehlt")
                cols = [f for f in felder if f in d]
                extra = {"kunden": ["angelegt", "geaendert"]}.get(res, [])
                werte = [d[f] for f in cols] + [jetzt()] * len(extra)
                if res == "kunden":
                    cols_all = cols + extra + ["quelle"]
                    werte.append("manuell")
                else:
                    cols_all = cols + extra
                nid = c.execute(f"INSERT INTO {res}({', '.join(cols_all)}) VALUES({', '.join('?' * len(cols_all))})",
                                werte).lastrowid
                return self.antwort(200, {"id": nid})
            if methode == "PUT" and rid:
                d = self.json_body()
                cols = [f for f in felder if f in d]
                if res == "rubriken" and d.get("parent_id") == rid:
                    raise ValueError("Rubrik kann nicht unter sich selbst liegen")
                if cols:
                    zus = ", geaendert=?" if res == "kunden" else ""
                    werte = [d[f] for f in cols] + ([jetzt()] if res == "kunden" else []) + [rid]
                    c.execute(f"UPDATE {res} SET {', '.join(f + '=?' for f in cols)}{zus} WHERE id=?", werte)
                return self.antwort(200, {"ok": True})
            if methode == "DELETE" and rid:
                c.execute(f"DELETE FROM {res} WHERE id=?", (rid,))
                return self.antwort(200, {"ok": True})
        return self.fehler(405, "nicht erlaubt")

    def kunden_vorschau(self, query):
        name = (query.get("datei") or ["import.csv"])[0]
        daten = self.body()
        if name.lower().endswith(".xlsx") or daten[:2] == b"PK":
            zeilen = lies_xlsx(daten)
        elif name.lower().endswith(".xls"):
            raise ValueError("Altes .xls-Format: bitte in Excel als .xlsx oder CSV speichern")
        else:
            zeilen = lies_csv(daten)
        zeilen = [z for z in zeilen if any(str(x).strip() for x in z)]
        if not zeilen:
            raise ValueError("Datei enthält keine Zeilen")
        kopf = zeilen[0]
        return self.antwort(200, {"kopf": kopf, "zeilen": zeilen[1:],
                                  "zuordnung": spalten_raten(kopf),
                                  "felder": list(SPALTEN_HINWEISE)})

    def bestellungen(self, methode, rid):
        with _lock, db() as c:
            if methode == "GET" and rid:
                b = c.execute("SELECT * FROM bestellungen WHERE id=?", (rid,)).fetchone()
                if not b:
                    return self.fehler(404, "nicht gefunden")
                pos = c.execute("SELECT * FROM positionen WHERE bestellung_id=? ORDER BY sort,id",
                                (rid,)).fetchall()
                return self.antwort(200, {**dict(b), "positionen": [dict(p) for p in pos]})
            if methode in ("POST", "PUT"):
                d = self.json_body()
                felder = FELDER["bestellungen"]
                if methode == "POST":
                    d.setdefault("datum", datetime.date.today().isoformat())
                    cols = [f for f in felder if f in d]
                    rid = c.execute(
                        f"INSERT INTO bestellungen(nr, angelegt, {', '.join(cols)}) VALUES(?,?,{', '.join('?' * len(cols))})",
                        [neue_bestellnr(c), jetzt()] + [d[f] for f in cols]).lastrowid
                else:
                    cols = [f for f in felder if f in d]
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
                           p.bezeichnung, p.menge, p.einheit, p.preis, ROUND(p.menge*p.preis,2)
                    FROM bestellungen b
                    LEFT JOIN positionen p ON p.bestellung_id=b.id
                    LEFT JOIN rubriken r ON r.id=p.rubrik_id
                    LEFT JOIN rubriken r2 ON r2.id=r.parent_id
                    LEFT JOIN lieferanten l ON l.id=b.lieferant_id
                    LEFT JOIN kunden k ON k.id=b.kunde_id
                    ORDER BY b.nr, p.sort""").fetchall()
                kopf = ["Bestellnr", "Datum", "Status", "Lieferant", "Kunde", "Projekt", "Besteller",
                        "Liefertermin", "Rubrik", "Position", "Menge", "Einheit", "Einzelpreis", "Summe"]
            else:
                return self.fehler(404, "unbekannt")
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";")
        w.writerow(kopf)
        for r in rows:
            w.writerow([str(x).replace(".", ",") if isinstance(x, float) else ("" if x is None else x) for x in r])
        datei = f"marchi-{was}-{datetime.date.today().isoformat()}.csv"
        return self.antwort(200, ("﻿" + buf.getvalue()).encode(), "text/csv; charset=utf-8",
                            {"Content-Disposition": f'attachment; filename="{datei}"'})


def alles():
    with db() as c:
        def liste(sql):
            return [dict(r) for r in c.execute(sql).fetchall()]
        return {
            "rubriken": liste("SELECT * FROM rubriken ORDER BY sort, name"),
            "artikel": liste("SELECT * FROM artikel ORDER BY name"),
            "lieferanten": liste("SELECT * FROM lieferanten ORDER BY name"),
            "kunden": liste("SELECT * FROM kunden ORDER BY name"),
            "bestellungen": liste("""
                SELECT b.*, COALESCE(SUM(p.menge*p.preis),0) AS summe, COUNT(p.id) AS anzahl,
                       GROUP_CONCAT(DISTINCT p.rubrik_id) AS rubrik_ids
                FROM bestellungen b LEFT JOIN positionen p ON p.bestellung_id=b.id
                GROUP BY b.id ORDER BY b.nr DESC"""),
            "rubrik_summen": liste("""
                SELECT COALESCE(r.parent_id, r.id) AS rubrik_id, SUM(p.menge*p.preis) AS summe
                FROM positionen p JOIN bestellungen b ON b.id=p.bestellung_id
                JOIN rubriken r ON r.id=p.rubrik_id
                WHERE b.status!='Storniert' AND substr(b.datum,1,4)=strftime('%Y','now')
                GROUP BY 1"""),
            "einheiten": EINHEITEN,
            "status": STATUS,
        }


if __name__ == "__main__":
    init_db()
    cfg()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), H)
    print(f"Marchi Zentraleinkauf läuft auf http://127.0.0.1:{PORT}", flush=True)
    srv.serve_forever()
