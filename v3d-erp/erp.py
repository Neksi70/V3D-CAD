"""V3D ERP – Geschäftslogik (Belegkette, Lager, Offene Posten, Projekte).

Nur Python-Standardbibliothek. Datenbank: SQLite (Prototyp), Schema PostgreSQL-tauglich.
Alle Funktionen bekommen eine offene Verbindung `db` und arbeiten in einer Transaktion.
"""
import datetime as _dt
import hashlib
import json
import os
import secrets
import sqlite3

HIER = os.path.dirname(os.path.abspath(__file__))


class Fehler(Exception):
    """Fachlicher Fehler – Text geht so an die Oberfläche."""


# ---------------------------------------------------------------- Verbindung
def verbinden(pfad):
    db = sqlite3.connect(pfad, isolation_level=None, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA journal_mode = WAL")
    return db


def schema_anlegen(db):
    with open(os.path.join(HIER, "schema.sql"), encoding="utf-8") as f:
        db.executescript(f.read())
    if not db.execute("SELECT 1 FROM belegart LIMIT 1").fetchone():
        grundlagen_anlegen(db)
    # nachträglich hinzugekommene Spalten (bestehende Datenbanken)
    for tab, sp, typ in [("artikel", "memo", "TEXT"), ("beleg", "memo", "TEXT"), ("projekt", "memo", "TEXT"), ("artikel", "kalk", "TEXT"),
                         ("beleg_position", "charge_nr", "TEXT"), ("beleg_position", "charge_id", "INTEGER"),
                         ("offener_posten", "mahnstufe", "INTEGER NOT NULL DEFAULT 0"), ("offener_posten", "letzte_mahnung", "TEXT"),
                         ("offener_posten", "mahnsperre", "INTEGER NOT NULL DEFAULT 0"),
                         ("artikel", "arbeitsplan", "TEXT"), ("fertigung", "freigabe", "INTEGER NOT NULL DEFAULT 0"),
                         ("beleg", "verpackung", "TEXT"), ("beleg_position", "zusatz", "TEXT"),
                         ("artikel", "gewicht_kg", "REAL"), ("benutzer", "email", "TEXT"), ("benutzer", "telefon", "TEXT"),
                         ("beleg", "leistungsdatum", "TEXT"), ("kunde", "steuerfall", "TEXT"), ("beleg", "steuerfall", "TEXT")]:
        if sp not in [r["name"] for r in db.execute(f"PRAGMA table_info({tab})")]:
            db.execute(f"ALTER TABLE {tab} ADD COLUMN {sp} {typ}")
    if not db.execute("SELECT 1 FROM mahnstufe LIMIT 1").fetchone():
        db.executemany("INSERT INTO mahnstufe(stufe,name,tage,gebuehr,text) VALUES(?,?,?,?,?)", MAHNSTUFEN)
    # neue Belegarten/Folgen in bestehenden Datenbanken nachtragen
    for i, (c, b, n, p, l, o, v) in enumerate(BELEGARTEN):
        db.execute("INSERT OR IGNORE INTO belegart(code,bereich,name,praefix,lager,op,vorzeichen,reihenfolge) VALUES(?,?,?,?,?,?,?,?)", (c, b, n, p, l, o, v, i))
        db.execute("UPDATE belegart SET reihenfolge=? WHERE code=?", (i, c))
    db.executemany("INSERT OR IGNORE INTO belegart_folge(von,nach) VALUES(?,?)", FOLGEN)


def jetzt():
    return _dt.datetime.now().isoformat(timespec="seconds")


def heute():
    return _dt.date.today().isoformat()


def zeilen(cur):
    return [dict(r) for r in cur.fetchall()]


def zeile(cur):
    r = cur.fetchone()
    return dict(r) if r else None


class transaktion:
    def __init__(self, db):
        self.db = db

    def __enter__(self):
        self.db.execute("BEGIN IMMEDIATE")
        return self.db

    def __exit__(self, typ, wert, tb):
        self.db.execute("ROLLBACK" if typ else "COMMIT")
        return False


def protokoll(db, benutzer, objekt, objekt_id, aktion, details=None):
    db.execute("INSERT INTO protokoll(zeit,benutzer,objekt,objekt_id,aktion,details) VALUES(?,?,?,?,?,?)",
               (jetzt(), benutzer, objekt, objekt_id, aktion,
                json.dumps(details, ensure_ascii=False) if details is not None else None))


# ---------------------------------------------------------------- Grundlagen
BELEGARTEN = [
    # code, bereich, name, präfix, lager, op, vorzeichen
    ("AN", "VK", "Angebot", "AN", 0, None, 1),
    ("AB", "VK", "Auftragsbestätigung", "AB", 0, None, 1),
    ("WK", "VK", "Wareneingang Kundenmaterial", "WK", 0, None, 1),
    ("LS", "VK", "Lieferschein", "LS", -1, None, 1),
    ("RE", "VK", "Rechnung", "RE", 0, "debitor", 1),
    ("GS", "VK", "Gutschrift / Storno", "GS", 0, "debitor", -1),
    ("PA", "EK", "Preisanfrage", "PA", 0, None, 1),
    ("BE", "EK", "Bestellung", "BE", 0, None, 1),
    ("WE", "EK", "Wareneingang", "WE", 1, None, 1),
    ("ER", "EK", "Rechnungseingang", "ER", 0, "kreditor", 1),
]
FOLGEN = [("AN", "AB"), ("AB", "WK"), ("AB", "LS"), ("AB", "RE"), ("LS", "RE"), ("RE", "GS"),
          ("PA", "BE"), ("BE", "WE"), ("BE", "ER"), ("WE", "ER")]


MAHNSTUFEN = [
    (1, "Zahlungserinnerung", 7, 0,
     "sicher haben Sie es im Tagesgeschäft übersehen: Die folgenden Rechnungen sind noch offen. Bitte überweisen Sie den Betrag bis zum {frist}. Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos."),
    (2, "1. Mahnung", 14, 5.0,
     "leider konnten wir zu den folgenden Rechnungen noch keinen Zahlungseingang feststellen. Wir bitten Sie, den offenen Betrag zuzüglich Mahngebühr bis zum {frist} zu überweisen."),
    (3, "2. Mahnung", 14, 10.0,
     "trotz unserer Erinnerung sind die folgenden Rechnungen weiterhin offen. Bitte begleichen Sie den Gesamtbetrag bis spätestens {frist}. Andernfalls müssen wir weitere Schritte einleiten."),
]


def grundlagen_anlegen(db):
    for i, (c, b, n, p, l, o, v) in enumerate(BELEGARTEN):
        db.execute("INSERT INTO belegart(code,bereich,name,praefix,lager,op,vorzeichen,reihenfolge) VALUES(?,?,?,?,?,?,?,?)",
                   (c, b, n, p, l, o, v, i))
    db.executemany("INSERT INTO belegart_folge(von,nach) VALUES(?,?)", FOLGEN)
    db.executemany("INSERT INTO zahlungsbedingung(text,tage_netto,skonto_tage,skonto_pct) VALUES(?,?,?,?)", [
        ("14 Tage netto", 14, 0, 0), ("30 Tage netto", 30, 0, 0),
        ("10 Tage 2 % Skonto, 30 Tage netto", 30, 10, 2), ("Sofort ohne Abzug", 0, 0, 0)])
    db.execute("INSERT INTO lager(nr,name) VALUES('1','Hauptlager')")


# ---------------------------------------------------------------- Einstellungen
EINSTELLUNGEN = ["firma_name", "firma_zusatz", "strasse", "plz", "ort", "telefon", "email", "web", "ust_id", "steuernr",
                 "handelsregister", "geschaeftsfuehrer", "bank_name", "iban", "bic", "logo",
                 "kopftext_vk", "fusstext_vk", "kopftext_ek", "fusstext_ek", "farbe_haupt", "farbe_akzent", "betriebsstaette",
                 "arbeitsgaenge", "maschinen", "ls_nur_freigegeben",
                 "verpackungen", "formular", "positionsfelder", "briefpapier_bild", "nummernformat",
                 "kleinunternehmer", "datev_berater", "datev_mandant", "datev_kontenrahmen", "datev_konten",
                 "liq_kontostand", "liq_stand_datum"]
STANDARD_EINSTELLUNGEN = dict(
    firma_name="Muster Fertigung GmbH", firma_zusatz="Sondermaschinen · Vorrichtungen · Serienteile",
    strasse="Beispielstraße 1", plz="58089", ort="Hagen", telefon="02331 000000", email="info@muster-fertigung.example",
    web="www.muster-fertigung.example", ust_id="DE000000000", steuernr="", handelsregister="Amtsgericht Hagen HRB 0000",
    geschaeftsfuehrer="Max Mustermann", bank_name="Musterbank Hagen", iban="DE00 0000 0000 0000 0000 00", bic="MUSTDEXXX",
    arbeitsgaenge="Bohren; Gewinde schneiden; Entgraten; Prüfen; Verpacken", maschinen="", ls_nur_freigegeben="",
    verpackungen="Europalette; Einwegpalette; Gitterbox; Lochkiste SMB; Schäferkiste; Karton", formular="",
    logo="", kopftext_vk="Vielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen an:",
    fusstext_vk="Für Rückfragen stehen wir Ihnen gern zur Verfügung.", kopftext_ek="Wir bestellen zu den vereinbarten Bedingungen:",
    fusstext_ek="Bitte bestätigen Sie uns Liefertermin und Preis.",
    farbe_haupt="#004aad", farbe_akzent="#f39200", betriebsstaette="1 - Zentrale", datev_kontenrahmen="SKR03")


# ---------------------------------------------------------------- Umsatzsteuer-Sonderfälle
# Steuerfall am Kunden (vorbelegt) bzw. am Beleg (eingefroren). Leer = Inland mit Umsatzsteuer.
# kategorie/vatex = EN 16931 (E-Rechnung), hinweis = Pflichtangabe auf der Rechnung (§ 14a UStG bzw. § 19 UStG).
STEUERFAELLE = {
    "eu_lieferung": dict(name="Innergemeinschaftliche Lieferung (EU)", kategorie="K", vatex="VATEX-EU-IC", ust_id=True, ausland=True,
                         hinweis="Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1b i. V. m. § 6a UStG)."),
    "eu_leistung": dict(name="Leistung an Unternehmer im EU-Ausland (Reverse Charge)", kategorie="AE", vatex="VATEX-EU-AE", ust_id=True, ausland=True,
                        hinweis="Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge, Art. 196 MwStSystRL)."),
    "13b": dict(name="Inland § 13b UStG (Leistungsempfänger schuldet die Steuer)", kategorie="AE", vatex="VATEX-EU-AE", ust_id=True, ausland=False,
                hinweis="Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG)."),
    "drittland": dict(name="Ausfuhr in ein Drittland", kategorie="G", vatex="VATEX-EU-G", ust_id=False, ausland=True,
                      hinweis="Steuerfreie Ausfuhrlieferung (§ 4 Nr. 1a i. V. m. § 6 UStG)."),
    "kleinunternehmer": dict(name="Kleinunternehmer (§ 19 UStG)", kategorie="E", vatex="", ust_id=False, ausland=False,
                             hinweis="Gemäß § 19 UStG wird keine Umsatzsteuer berechnet."),
}


def steuerfall(code):
    """Angaben zum Steuerfall eines Belegs; None = Inland regulär."""
    return STEUERFAELLE.get(code or "")


def einstellungen(db):
    werte = {r["schluessel"]: r["wert"] for r in db.execute("SELECT schluessel, wert FROM einstellung")}
    return {k: werte.get(k, STANDARD_EINSTELLUNGEN.get(k, "")) or "" for k in EINSTELLUNGEN}


SPALTEN = [("pos", "Pos"), ("artikelnr", "Artikel"), ("text", "Bezeichnung"), ("menge", "Menge"), ("me", "ME"),
           ("einzelpreis", "Einzelpreis €"), ("rabatt", "Rabatt %"), ("gesamt", "Gesamt €"), ("ausschuss", "Ausschuss")]
BLOECKE = ["betreff", "referenz", "kopftext", "fusstext", "zahlungsbed", "bank", "quittung", "zusatzfelder", "charge", "verpackung", "gewicht",
           "arbeitsplan"]
FORMULAR_STANDARD = {
    "preise": True, "titel": "", "zusatztext": "", "schrift": 9.0, "briefpapier": False, "rand_oben": 45, "rand_unten": 25,
    "kopf": "rechts", "unterschriften": "", "hintergrund": True,
    "spalten": [{"key": k, "titel": t, "an": k not in ("artikelnr", "rabatt", "ausschuss")} for k, t in SPALTEN],
    "bloecke": {k: k not in ("quittung", "verpackung", "gewicht", "arbeitsplan") for k in BLOECKE},
}
FORMULAR_JE_ART = {
    "LS": {"preise": False, "bloecke": {"verpackung": True, "quittung": True, "gewicht": True},
           "spalten": [{"key": k, "titel": t, "an": k in ("pos", "artikelnr", "text", "menge", "me", "ausschuss")} for k, t in SPALTEN],
           "unterschriften": "Ware erhalten | Datum, Unterschrift Empfänger"},
    "WK": {"preise": False},
    "AB": {"bloecke": {"arbeitsplan": True}}}           # GSB: Arbeitsgänge auf der Auftragsbestätigung, nicht auf dem LS


def formular(db, belegart, aenderung=None):
    """Druck-Layout je Belegart (Formular-Baukasten): Spalten (Reihenfolge, Titel, an/aus), Blöcke, Titel, Zusatztext,
    Schriftgröße, Briefpapier-Ränder. Gespeichert als JSON in der Einstellung `formular`; `aenderung` = Vorschau ohne Speichern."""
    import copy
    o = copy.deepcopy(FORMULAR_STANDARD)
    gesp = {}
    r = db.execute("SELECT wert FROM einstellung WHERE schluessel='formular'").fetchone()
    try:
        gesp = (json.loads(r["wert"]) if r and r["wert"] else {}).get(belegart, {}) or {}
    except (ValueError, AttributeError):
        gesp = {}
    for quelle in (FORMULAR_JE_ART.get(belegart, {}), gesp, aenderung or {}):
        for k, v in quelle.items():
            if k == "bloecke" and isinstance(v, dict):
                o["bloecke"].update({b: bool(x) for b, x in v.items() if b in BLOECKE})
            elif k == "spalten" and isinstance(v, list):
                bekannt = dict(SPALTEN)
                neu = [{"key": x["key"], "titel": (str(x.get("titel") or bekannt[x["key"]]))[:30], "an": bool(x.get("an"))}
                       for x in v if isinstance(x, dict) and x.get("key") in bekannt]
                neu += [dict(s_) for s_ in o["spalten"] if s_["key"] not in {x["key"] for x in neu}]
                o["spalten"] = neu
            elif k in ("charge", "verpackung"):            # ältere Speicherform (Schalter direkt)
                o["bloecke"][k] = bool(v)
            elif k in ("preise", "briefpapier", "hintergrund"):
                o[k] = bool(v)
            elif k in ("titel", "zusatztext", "unterschriften"):
                o[k] = str(v or "")[:120 if k == "titel" else 1000]
            elif k == "kopf":
                o[k] = v if v in ("rechts", "myfactory") else "rechts"
            elif k in ("schrift", "rand_oben", "rand_unten"):
                try:
                    o[k] = float(v)
                except (TypeError, ValueError):
                    pass
    o["schrift"] = min(11.0, max(7.5, o["schrift"]))
    o["rand_oben"] = min(120.0, max(10.0, o["rand_oben"]))
    o["rand_unten"] = min(80.0, max(10.0, o["rand_unten"]))
    if belegart in ("RE", "GS"):
        o["preise"] = True                                   # Rechnung ohne Beträge gibt es nicht (E-Rechnung, UStG)
    # Kompatibilität für bestehenden Code
    o["charge"] = o["bloecke"]["charge"]
    o["verpackung"] = o["bloecke"]["verpackung"]
    return o


def positionsfelder(db):
    r = db.execute("SELECT wert FROM einstellung WHERE schluessel='positionsfelder'").fetchone()
    return [x.strip() for x in ((r["wert"] if r else "") or "").split(";") if x.strip()][:8]


def einstellungen_speichern(db, d, benutzer=None):
    logo = d.get("logo") or ""
    if logo and (not logo.startswith("data:image/") or len(logo) > 700_000):
        raise Fehler("Logo bitte als Bild (PNG/JPG/SVG) bis ca. 500 KB.")
    bp = d.get("briefpapier_bild") or ""
    if bp and (not bp.startswith(("data:image/png", "data:image/jpeg")) or len(bp) > 3_000_000):
        raise Fehler("Briefpapier bitte als PNG/JPG-Bild einer leeren A4-Seite (bis ca. 2 MB).")
    import re as _re
    for k in ("farbe_haupt", "farbe_akzent"):
        if d.get(k) and not _re.fullmatch(r"#[0-9a-fA-F]{6}", d[k]):
            raise Fehler("Farben bitte als #RRGGBB angeben.")
    with transaktion(db):
        for k in EINSTELLUNGEN:
            if k in d:
                db.execute("INSERT INTO einstellung(schluessel,wert) VALUES(?,?) ON CONFLICT(schluessel) DO UPDATE SET wert=excluded.wert",
                           (k, (d.get(k) or "").strip() if k not in ("logo", "briefpapier_bild") else (d.get(k) or "")))
        protokoll(db, benutzer, "einstellung", None, "geändert", [k for k in EINSTELLUNGEN if k in d])
    return einstellungen(db)


# ---------------------------------------------------------------- Passwörter
def pw_hash(pw, iter_=200_000):
    salz = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salz), iter_).hex()
    return f"pbkdf2_sha256${iter_}${salz}${h}"


def pw_pruefen(pw, gespeichert):
    try:
        _, it, salz, h = gespeichert.split("$")
        neu = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salz), int(it)).hex()
        return secrets.compare_digest(neu, h)
    except Exception:
        return False


# ---------------------------------------------------------------- Nummern
NUMMERN_MUSTER = "{P}-{JJ}-{N4}"


def nummern_muster(db, praefix):
    """Nummernformat je Präfix (Einstellung `nummernformat`, JSON {"RE": "RG{JJ}{N5}"}). {P}=Präfix, {JJ}/{JJJJ}=Jahr, {N4}/{N5}…=laufende Nr."""
    r = db.execute("SELECT wert FROM einstellung WHERE schluessel='nummernformat'").fetchone()
    try:
        return (json.loads(r["wert"]) if r and r["wert"] else {}).get(praefix) or NUMMERN_MUSTER
    except ValueError:
        return NUMMERN_MUSTER


def nummer_formatieren(muster, praefix, jahr, n):
    import re as _re
    t = muster.replace("{P}", praefix).replace("{JJJJ}", str(jahr)).replace("{JJ}", str(jahr)[2:])
    return _re.sub(r"\{N(\d)\}", lambda m: f"{n:0{int(m.group(1))}d}", t)


def naechste_nummer(db, praefix, datum):
    """Fortlaufend und lückenlos je Präfix und Jahr – läuft in der Transaktion des Verarbeitens (Rollback = keine Lücke)."""
    jahr = int(datum[:4])
    r = db.execute("SELECT naechste FROM nummernkreis WHERE praefix=? AND jahr=?", (praefix, jahr)).fetchone()
    n = r["naechste"] if r else 1
    muster = nummern_muster(db, praefix)
    while db.execute("SELECT 1 FROM beleg WHERE nummer=?", (nummer_formatieren(muster, praefix, jahr, n),)).fetchone():
        n += 1                                           # nie eine Nummer doppelt vergeben (z. B. nach Formatwechsel)
    if r:
        db.execute("UPDATE nummernkreis SET naechste=? WHERE praefix=? AND jahr=?", (n + 1, praefix, jahr))
    else:
        db.execute("INSERT INTO nummernkreis(praefix,jahr,naechste) VALUES(?,?,?)", (praefix, jahr, n + 1))
    return nummer_formatieren(muster, praefix, jahr, n)


def nummernkreise(db):
    jahr = _dt.date.today().year
    out = []
    for a in zeilen(db.execute("SELECT code, name, praefix FROM belegart ORDER BY reihenfolge")):
        r = db.execute("SELECT naechste FROM nummernkreis WHERE praefix=? AND jahr=?", (a["praefix"], jahr)).fetchone()
        n = r["naechste"] if r else 1
        m = nummern_muster(db, a["praefix"])
        out.append(dict(a, muster=m, naechste=n, jahr=jahr, beispiel=nummer_formatieren(m, a["praefix"], jahr, n),
                        letzte=(db.execute("SELECT nummer FROM beleg WHERE belegart=? AND nummer IS NOT NULL ORDER BY verarbeitet DESC, id DESC LIMIT 1",
                                           (a["code"],)).fetchone() or {"nummer": None})["nummer"]))
    return out


def nummernkreise_speichern(db, liste, benutzer=None):
    import re as _re
    jahr = _dt.date.today().year
    formate = {}
    r = db.execute("SELECT wert FROM einstellung WHERE schluessel='nummernformat'").fetchone()
    try:
        formate = json.loads(r["wert"]) if r and r["wert"] else {}
    except ValueError:
        formate = {}
    with transaktion(db):
        for x in liste:
            praefix = db.execute("SELECT praefix FROM belegart WHERE code=?", (x.get("code"),)).fetchone()
            if not praefix:
                continue
            praefix = praefix["praefix"]
            m = (x.get("muster") or NUMMERN_MUSTER).strip()
            if not _re.search(r"\{N\d\}", m) or len(m) > 30:
                raise Fehler(f"{x.get('code')}: Das Format braucht eine laufende Nummer, z. B. {{N4}} oder {{N5}}.")
            formate[praefix] = m
            n = int(x.get("naechste") or 1)
            if n < 1:
                raise Fehler("Die nächste Nummer muss mindestens 1 sein.")
            nr = nummer_formatieren(m, praefix, jahr, n)
            if db.execute("SELECT 1 FROM beleg WHERE nummer=?", (nr,)).fetchone():
                raise Fehler(f"{nr} ist schon vergeben – bitte eine höhere nächste Nummer wählen.")
            db.execute("INSERT INTO nummernkreis(praefix,jahr,naechste) VALUES(?,?,?) ON CONFLICT(praefix,jahr) DO UPDATE SET naechste=excluded.naechste",
                       (praefix, jahr, n))
        db.execute("INSERT INTO einstellung(schluessel,wert) VALUES('nummernformat',?) ON CONFLICT(schluessel) DO UPDATE SET wert=excluded.wert",
                   (json.dumps(formate),))
        protokoll(db, benutzer, "nummernkreis", None, "geändert", formate)
    return nummernkreise(db)


def naechste_stammnr(db, tabelle, spalte, start):
    r = db.execute(f"SELECT MAX(CAST({spalte} AS INTEGER)) m FROM {tabelle} WHERE {spalte} GLOB '[0-9]*'").fetchone()
    return str(max(start, (r["m"] or 0) + 1))


# ---------------------------------------------------------------- Adressen
ADRESS_FELDER = ["kurz", "name1", "name2", "strasse", "plz", "ort", "land", "telefon", "email", "ust_id", "notiz"]


def adresse_speichern(db, daten, benutzer=None):
    """Legt eine Adresse an oder ändert sie. Rollen: daten['kunde'] / daten['lieferant'] (dict oder None)."""
    if not (daten.get("name1") or "").strip():
        raise Fehler("Name fehlt.")
    if not daten.get("kurz"):
        daten["kurz"] = daten["name1"][:30].upper()
    if not daten.get("land"):
        daten["land"] = "DE"
    with transaktion(db):
        aid = daten.get("id")
        werte = [daten.get(f) for f in ADRESS_FELDER]
        if aid:
            db.execute(f"UPDATE adresse SET {', '.join(f + '=?' for f in ADRESS_FELDER)} WHERE id=?", werte + [aid])
            protokoll(db, benutzer, "adresse", aid, "geändert")
        else:
            nr = daten.get("adressnr") or naechste_stammnr(db, "adresse", "adressnr", 10000)
            cur = db.execute(f"INSERT INTO adresse(adressnr,{','.join(ADRESS_FELDER)},angelegt) VALUES(?,{','.join('?' * len(ADRESS_FELDER))},?)",
                             [nr] + werte + [jetzt()])
            aid = cur.lastrowid
            protokoll(db, benutzer, "adresse", aid, "angelegt")
        k = daten.get("kunde")
        if k is not None:
            alt = db.execute("SELECT kundennr FROM kunde WHERE adresse_id=?", (aid,)).fetchone()
            nr = k.get("kundennr") or (alt["kundennr"] if alt else naechste_stammnr(db, "kunde", "kundennr", 10000))
            sf = k.get("steuerfall") or None
            if sf and (sf not in STEUERFAELLE or sf == "kleinunternehmer"):
                raise Fehler("Unbekannter Steuerfall.")
            db.execute("""INSERT INTO kunde(adresse_id,kundennr,zahlungsbed_id,rabatt_pct,kreditlimit,leitweg_id,liefersperre,steuerfall)
                          VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(adresse_id) DO UPDATE SET kundennr=excluded.kundennr,
                          zahlungsbed_id=excluded.zahlungsbed_id, rabatt_pct=excluded.rabatt_pct, kreditlimit=excluded.kreditlimit,
                          leitweg_id=excluded.leitweg_id, liefersperre=excluded.liefersperre, steuerfall=excluded.steuerfall""",
                       (aid, nr, k.get("zahlungsbed_id"), k.get("rabatt_pct") or 0, k.get("kreditlimit"),
                        k.get("leitweg_id"), 1 if k.get("liefersperre") else 0, sf))
        lf = daten.get("lieferant")
        if lf is not None:
            alt = db.execute("SELECT lieferantennr FROM lieferant WHERE adresse_id=?", (aid,)).fetchone()
            nr = lf.get("lieferantennr") or (alt["lieferantennr"] if alt else naechste_stammnr(db, "lieferant", "lieferantennr", 70000))
            db.execute("""INSERT INTO lieferant(adresse_id,lieferantennr,zahlungsbed_id,unsere_kundennr,mindestbestellwert)
                          VALUES(?,?,?,?,?) ON CONFLICT(adresse_id) DO UPDATE SET lieferantennr=excluded.lieferantennr,
                          zahlungsbed_id=excluded.zahlungsbed_id, unsere_kundennr=excluded.unsere_kundennr,
                          mindestbestellwert=excluded.mindestbestellwert""",
                       (aid, nr, lf.get("zahlungsbed_id"), lf.get("unsere_kundennr"), lf.get("mindestbestellwert")))
    return adresse_lesen(db, aid)



def adressen_zusammenfuehren(db, bleibt, weg, benutzer=None):
    """Dublette auflösen: alles von `weg` (Belege, OP, Chargen, Projekte, Preise, Ansprechpartner, Dokumente,
    Kennzeichen …) auf `bleibt` umhängen, leere Felder ergänzen, Rollen vereinen, `weg` löschen.
    Kunden-/Lieferantennummer von `bleibt` gilt; fehlt dort eine Rolle, wird die von `weg` übernommen."""
    bleibt, weg = int(bleibt), int(weg)
    if bleibt == weg:
        raise Fehler("Bitte zwei verschiedene Adressen wählen.")
    a = zeile(db.execute("SELECT * FROM adresse WHERE id=?", (bleibt,)))
    b = zeile(db.execute("SELECT * FROM adresse WHERE id=?", (weg,)))
    if not a or not b:
        raise Fehler("Adresse nicht gefunden.")
    with transaktion(db):
        ergaenzt = {f: b[f] for f in ADRESS_FELDER if f != "kurz" and not (a.get(f) or "").strip() and (b.get(f) or "").strip()}
        if ergaenzt:
            db.execute(f"UPDATE adresse SET {', '.join(f + '=?' for f in ergaenzt)} WHERE id=?", list(ergaenzt.values()) + [bleibt])
        for rolle in ("kunde", "lieferant"):
            hat_a = db.execute(f"SELECT 1 FROM {rolle} WHERE adresse_id=?", (bleibt,)).fetchone()
            hat_b = db.execute(f"SELECT 1 FROM {rolle} WHERE adresse_id=?", (weg,)).fetchone()
            if hat_b and not hat_a:
                db.execute(f"UPDATE {rolle} SET adresse_id=? WHERE adresse_id=?", (bleibt, weg))
            elif hat_b:
                db.execute(f"DELETE FROM {rolle} WHERE adresse_id=?", (weg,))
        tabellen = [r["name"] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        for t in tabellen:
            if t in ("adresse", "kunde", "lieferant"):
                continue
            spalten = [r["name"] for r in db.execute(f"PRAGMA table_info({t})")]
            for sp in ("adresse_id", "kunde_id", "lieferant_id", "hauptlieferant_id"):
                if sp in spalten:
                    try:
                        db.execute(f"UPDATE {t} SET {sp}=? WHERE {sp}=?", (bleibt, weg))
                    except sqlite3.IntegrityError:
                        raise Fehler(f"Zusammenführen nicht möglich: doppelter Eintrag in {t} (z. B. gleiche Charge bei beiden Adressen).")
        db.execute("UPDATE dokument SET objekt_id=? WHERE objekt='adresse' AND objekt_id=?", (bleibt, weg))
        defs = [r["id"] for r in db.execute("SELECT id FROM kennzeichen_def WHERE objekt='adresse'")]
        for d in defs:
            if db.execute("SELECT 1 FROM kennzeichen_wert WHERE def_id=? AND objekt_id=?", (d, bleibt)).fetchone():
                db.execute("DELETE FROM kennzeichen_wert WHERE def_id=? AND objekt_id=?", (d, weg))
            else:
                db.execute("UPDATE kennzeichen_wert SET objekt_id=? WHERE def_id=? AND objekt_id=?", (bleibt, d, weg))
        db.execute("DELETE FROM adresse WHERE id=?", (weg,))
        protokoll(db, benutzer, "adresse", bleibt, "zusammengeführt", {"aufgeloest": weg, "name": b["name1"], "ergaenzt": list(ergaenzt)})
    return adresse_lesen(db, bleibt)


def rolle_entfernen(db, aid, rolle, benutzer=None):
    """Kunden- oder Lieferantenrolle entfernen – nur, wenn es dazu keine Belege gibt."""
    if rolle not in ("kunde", "lieferant"):
        raise Fehler("Unbekannte Rolle.")
    bereich = "VK" if rolle == "kunde" else "EK"
    if db.execute("""SELECT 1 FROM beleg b JOIN belegart ba ON ba.code=b.belegart WHERE b.adresse_id=?
                     AND (CASE WHEN b.belegart='WK' THEN 'VK' ELSE ba.bereich END)=? LIMIT 1""", (aid, bereich)).fetchone():
        raise Fehler(f"Es gibt {'Verkaufs' if rolle == 'kunde' else 'Einkaufs'}belege zu dieser Adresse – Rolle bleibt.")
    with transaktion(db):
        db.execute(f"DELETE FROM {rolle} WHERE adresse_id=?", (aid,))
        protokoll(db, benutzer, "adresse", aid, f"Rolle {rolle} entfernt")
    return adresse_lesen(db, aid)


def adresse_lesen(db, aid):
    a = zeile(db.execute("SELECT * FROM adresse WHERE id=?", (aid,)))
    if not a:
        raise Fehler("Adresse nicht gefunden.")
    a["kunde"] = zeile(db.execute("SELECT * FROM kunde WHERE adresse_id=?", (aid,)))
    a["lieferant"] = zeile(db.execute("SELECT * FROM lieferant WHERE adresse_id=?", (aid,)))
    a["ansprechpartner"] = zeilen(db.execute("SELECT * FROM ansprechpartner WHERE adresse_id=? ORDER BY nachname", (aid,)))
    a["belege"] = zeilen(db.execute("""SELECT b.id,b.belegart,b.nummer,b.status,b.datum,b.brutto,b.betreff FROM beleg b
                                       WHERE b.adresse_id=? ORDER BY b.datum DESC, b.id DESC LIMIT 50""", (aid,)))
    a["op"] = zeilen(db.execute("SELECT * FROM offener_posten WHERE adresse_id=? AND offen<>0 ORDER BY faellig", (aid,)))
    a["projekte"] = zeilen(db.execute("SELECT id,projektnr,titel,status FROM projekt WHERE kunde_id=? ORDER BY id DESC", (aid,)))
    return a


def adresse_loeschen(db, aid, benutzer=None):
    with transaktion(db):
        if db.execute("SELECT 1 FROM beleg WHERE adresse_id=? LIMIT 1", (aid,)).fetchone():
            raise Fehler("Zu dieser Adresse gibt es Belege – sie kann nicht gelöscht werden. Stattdessen Liefersperre setzen.")
        if db.execute("SELECT 1 FROM projekt WHERE kunde_id=? LIMIT 1", (aid,)).fetchone():
            raise Fehler("Die Adresse ist Kunde eines Projekts und kann nicht gelöscht werden.")
        for t in ("ansprechpartner", "kunde", "lieferant"):
            db.execute(f"DELETE FROM {t} WHERE adresse_id=?", (aid,))
        db.execute("DELETE FROM adresse WHERE id=?", (aid,))
        protokoll(db, benutzer, "adresse", aid, "gelöscht")


def suche(db, q):
    """Business-Suche: Adressen, Artikel, Belege, Projekte mit einem Begriff."""
    q = (q or "").strip()
    if len(q) < 2:
        return []
    l = f"%{q}%"
    erg = []
    for r in db.execute("""SELECT a.id, a.kurz, a.name1, a.ort, k.kundennr, lf.lieferantennr FROM adresse a LEFT JOIN kunde k ON k.adresse_id=a.id
                           LEFT JOIN lieferant lf ON lf.adresse_id=a.id WHERE a.kurz LIKE ? OR a.name1 LIKE ? OR a.adressnr LIKE ? OR k.kundennr LIKE ?
                           OR lf.lieferantennr LIKE ? OR a.ort LIKE ? OR a.email LIKE ? LIMIT 8""", [l] * 7):
        rolle = "kunde" if r["kundennr"] else ("lieferant" if r["lieferantennr"] else "")
        erg.append(dict(typ="Adresse", titel=f"{r['kundennr'] or r['lieferantennr'] or ''} {r['kurz']}".strip(), info=f"{r['name1']} · {r['ort'] or ''}",
                        ziel=f"#/adressen/{rolle}/{r['id']}"))
    for r in db.execute("SELECT id, artikelnr, kurz, bezeichnung FROM artikel WHERE artikelnr LIKE ? OR kurz LIKE ? OR bezeichnung LIKE ? LIMIT 8", [l] * 3):
        erg.append(dict(typ="Artikel", titel=f"{r['artikelnr']} {r['kurz']}", info=r["bezeichnung"], ziel=f"#/artikel/{r['id']}"))
    for r in db.execute("""SELECT b.id, b.nummer, b.status, b.betreff, ba.name, a.kurz FROM beleg b JOIN belegart ba ON ba.code=b.belegart
                           JOIN adresse a ON a.id=b.adresse_id WHERE b.nummer LIKE ? OR b.betreff LIKE ? OR b.ihre_referenz LIKE ? ORDER BY b.id DESC LIMIT 8""", [l] * 3):
        erg.append(dict(typ="Beleg", titel=f"{r['name']} {r['nummer'] or '(Entwurf)'}", info=f"{r['kurz']} · {r['betreff'] or ''}", ziel=f"#/beleg/{r['id']}"))
    for r in db.execute("SELECT id, projektnr, titel FROM projekt WHERE projektnr LIKE ? OR titel LIKE ? LIMIT 8", [l] * 2):
        erg.append(dict(typ="Projekt", titel=r["projektnr"], info=r["titel"], ziel=f"#/projekt/{r['id']}"))
    return erg


def adressen_liste(db, suche="", rolle=""):
    sql = """SELECT a.id,a.adressnr,a.kurz,a.name1,a.name2,a.strasse,a.plz,a.ort,a.land,a.telefon,a.email,
                    k.kundennr, l.lieferantennr, k.zahlungsbed_id k_zb, k.rabatt_pct k_rabatt, k.steuerfall k_sf, l.zahlungsbed_id l_zb
             FROM adresse a LEFT JOIN kunde k ON k.adresse_id=a.id LEFT JOIN lieferant l ON l.adresse_id=a.id WHERE 1=1"""
    p = []
    if suche:
        sql += " AND (a.kurz LIKE ? OR a.name1 LIKE ? OR a.adressnr LIKE ? OR k.kundennr LIKE ? OR l.lieferantennr LIKE ? OR a.ort LIKE ?)"
        p += [f"%{suche}%"] * 6
    if rolle == "kunde":
        sql += " AND k.kundennr IS NOT NULL"
    elif rolle == "lieferant":
        sql += " AND l.lieferantennr IS NOT NULL"
    return zeilen(db.execute(sql + " ORDER BY a.kurz LIMIT 500", p))


# ---------------------------------------------------------------- Artikel
ARTIKEL_FELDER = ["artikelnr", "kurz", "bezeichnung", "me", "gruppe", "vk_preis", "ek_preis", "steuer_pct",
                  "lagerfuehrung", "meldebestand", "hauptlieferant_id", "inaktiv", "memo", "kalk", "arbeitsplan", "gewicht_kg"]


def arbeitsplan(wert):
    """Arbeitsplan als Liste von Arbeitsgängen {nr, text, toleranz, pruef}.
    Gespeichert als JSON-Liste; ältere Form „Bohren; Gewinde schneiden“ wird ebenfalls gelesen."""
    if isinstance(wert, list):
        roh = wert
    else:
        t = (wert or "").strip()
        if t.startswith("["):
            try:
                roh = json.loads(t)
            except ValueError:
                roh = []
        else:
            roh = [{"text": x.strip()} for x in t.split(";") if x.strip()]
    out = []
    for x in roh:
        if isinstance(x, str):
            x = {"text": x}
        if not isinstance(x, dict) or not str(x.get("text") or "").strip():
            continue
        out.append({"nr": str(x.get("nr") or "").strip()[:20], "text": str(x["text"]).strip()[:120],
                    "toleranz": str(x.get("toleranz") or "").strip()[:200], "pruef": bool(x.get("pruef"))})
    return out[:40]


def arbeitsplan_zeile(ag):
    """Eine Druckzeile: „AG000019 Nut fräsen – 12 mm ±0,1 (Prüfschritt)“."""
    return " ".join(x for x in [ag["nr"], ag["text"]] if x) + (f" – {ag['toleranz']}" if ag["toleranz"] else "") + (" (Prüfschritt)" if ag["pruef"] else "")


def artikel_speichern(db, d, benutzer=None):
    if not (d.get("bezeichnung") or "").strip():
        raise Fehler("Bezeichnung fehlt.")
    if "arbeitsplan" in d:
        ap = arbeitsplan(d["arbeitsplan"])
        d["arbeitsplan"] = json.dumps(ap, ensure_ascii=False) if ap else None
    if not (d.get("kurz") or "").strip():        # Oberfläche schickt leer/None → aus der Bezeichnung (BUG-001)
        d["kurz"] = d["bezeichnung"].strip()[:30]
    with transaktion(db):
        if not d.get("artikelnr"):
            d["artikelnr"] = naechste_stammnr(db, "artikel", "artikelnr", 100000)
        werte = [d.get(f) for f in ARTIKEL_FELDER]
        if isinstance(d.get("kalk"), dict):
            werte[ARTIKEL_FELDER.index("kalk")] = json.dumps(d["kalk"])
        werte = [w if w is not None else dflt for w, dflt in zip(werte, [None, None, None, "Stk", None, 0, 0, 19, 1, 0, None, 0, None, None, None, None])]
        if d.get("id"):
            db.execute(f"UPDATE artikel SET {', '.join(f + '=?' for f in ARTIKEL_FELDER)} WHERE id=?", werte + [d["id"]])
            aid = d["id"]
        else:
            aid = db.execute(f"INSERT INTO artikel({','.join(ARTIKEL_FELDER)}) VALUES({','.join('?' * len(ARTIKEL_FELDER))})", werte).lastrowid
        protokoll(db, benutzer, "artikel", aid, "gespeichert")
    return artikel_lesen(db, aid)


def artikel_loeschen(db, aid, benutzer=None):
    with transaktion(db):
        if db.execute("SELECT 1 FROM beleg_position WHERE artikel_id=? LIMIT 1", (aid,)).fetchone() or \
           db.execute("SELECT 1 FROM lagerbewegung WHERE artikel_id=? LIMIT 1", (aid,)).fetchone():
            raise Fehler("Der Artikel wird in Belegen oder Lagerbewegungen verwendet – stattdessen auf „inaktiv“ setzen.")
        db.execute("DELETE FROM artikel WHERE id=?", (aid,))
        protokoll(db, benutzer, "artikel", aid, "gelöscht")


def bestand(db, artikel_id):
    r = db.execute("SELECT COALESCE(SUM(menge),0) m FROM lagerbewegung WHERE artikel_id=?", (artikel_id,)).fetchone()
    return r["m"]


def reserviert(db, artikel_id):
    """Offene Auftragsmenge: verarbeitete AB-Positionen minus bereits gelieferte Mengen."""
    r = db.execute("""SELECT COALESCE(SUM(p.menge),0) - COALESCE((SELECT SUM(n.menge) FROM beleg_position n JOIN beleg nb ON nb.id=n.beleg_id
                        WHERE nb.belegart='LS' AND nb.status='verarbeitet' AND n.vorgaenger_pos_id IN
                        (SELECT p2.id FROM beleg_position p2 JOIN beleg b2 ON b2.id=p2.beleg_id WHERE b2.belegart='AB' AND b2.status='verarbeitet' AND p2.artikel_id=?)),0) m
                      FROM beleg_position p JOIN beleg b ON b.id=p.beleg_id
                      WHERE b.belegart='AB' AND b.status='verarbeitet' AND p.artikel_id=?""", (artikel_id, artikel_id)).fetchone()
    return max(0, r["m"])


def artikel_lesen(db, aid):
    a = zeile(db.execute("SELECT * FROM artikel WHERE id=?", (aid,)))
    if not a:
        raise Fehler("Artikel nicht gefunden.")
    try:
        a["kalk"] = json.loads(a["kalk"]) if a.get("kalk") else None
    except ValueError:
        a["kalk"] = None
    a["arbeitsplan_liste"] = arbeitsplan(a.get("arbeitsplan"))
    a["bestand"] = bestand(db, aid)
    a["reserviert"] = reserviert(db, aid)
    a["verfuegbar"] = a["bestand"] - a["reserviert"]
    a["bewegungen"] = zeilen(db.execute("""SELECT lb.datum,lb.menge,lb.text,b.nummer FROM lagerbewegung lb LEFT JOIN beleg b ON b.id=lb.beleg_id
                                          WHERE lb.artikel_id=? ORDER BY lb.id DESC LIMIT 30""", (aid,)))
    return a


def artikel_liste(db, suche=""):
    sql = "SELECT a.*, (SELECT COALESCE(SUM(menge),0) FROM lagerbewegung WHERE artikel_id=a.id) bestand FROM artikel a WHERE 1=1"
    p = []
    if suche:
        sql += " AND (a.artikelnr LIKE ? OR a.kurz LIKE ? OR a.bezeichnung LIKE ? OR a.gruppe LIKE ?)"
        p += [f"%{suche}%"] * 4
    return zeilen(db.execute(sql + " ORDER BY a.artikelnr LIMIT 500", p))


# ---------------------------------------------------------------- Belege
def _belegart(db, code):
    r = zeile(db.execute("SELECT * FROM belegart WHERE code=?", (code,)))
    if not r:
        raise Fehler(f"Unbekannte Belegart {code}.")
    return r


def ist_textzeile(p):
    """Positionen ohne Artikel, Menge und Preis sind reine Textzeilen (Überschrift im Beleg)."""
    return not p.get("artikel_id") and not float(p.get("menge") or 0) and not float(p.get("einzelpreis") or 0)


def _summen(positionen):
    """Netto je Position gerundet; Steuer je Steuersatz auf die Summe gerechnet und gerundet (EN 16931 / E-Rechnung)."""
    netto, je_satz = 0.0, {}
    for p in positionen:
        g = round(float(p["menge"]) * float(p["einzelpreis"]) * (1 - float(p.get("rabatt_pct") or 0) / 100), 2)
        p["gesamt"] = g
        netto += g
        s = float(p.get("steuer_pct", 19))
        je_satz[s] = je_satz.get(s, 0.0) + g
    netto = round(netto, 2)
    steuer = round(sum(round(round(b, 2) * s / 100 + 1e-9, 2) for s, b in je_satz.items()), 2)
    return netto, steuer, round(netto + steuer, 2)


def beleg_speichern(db, d, benutzer=None):
    """Neuer Beleg oder Änderung eines Entwurfs. Verarbeitete Belege sind gesperrt."""
    art = _belegart(db, d.get("belegart") or "")
    if not d.get("adresse_id"):
        raise Fehler("Bitte zuerst Kunde bzw. Lieferant wählen.")
    rolle = "kunde" if art["bereich"] == "VK" else "lieferant"
    if not db.execute(f"SELECT 1 FROM {rolle} WHERE adresse_id=?", (d["adresse_id"],)).fetchone():
        raise Fehler(f"Die Adresse ist kein {'Kunde' if rolle == 'kunde' else 'Lieferant'}.")
    pos = [p for p in (d.get("positionen") or []) if (p.get("text") or p.get("artikel_id"))]
    for p in pos:
        if p.get("artikel_id") and not p.get("text"):
            a = db.execute("SELECT bezeichnung FROM artikel WHERE id=?", (p["artikel_id"],)).fetchone()
            p["text"] = a["bezeichnung"] if a else "?"
        p.setdefault("menge", 1)
        p.setdefault("einzelpreis", 0)
        p.setdefault("steuer_pct", 19)
        p.setdefault("me", "Stk")
    sf = None
    if art["bereich"] == "VK":
        if einstellungen(db).get("kleinunternehmer"):
            sf = "kleinunternehmer"
        elif "steuerfall" in d:
            sf = d.get("steuerfall") or None
        elif d.get("id"):
            alt = db.execute("SELECT steuerfall FROM beleg WHERE id=?", (d["id"],)).fetchone()
            sf = alt["steuerfall"] if alt else None
        else:
            k = db.execute("SELECT steuerfall FROM kunde WHERE adresse_id=?", (d["adresse_id"],)).fetchone()
            sf = k["steuerfall"] if k else None
        if sf and sf not in STEUERFAELLE:
            raise Fehler("Unbekannter Steuerfall.")
        if sf:
            for p in pos:                      # steuerfrei bzw. Steuer schuldet der Kunde → 0 % auf jeder Position
                p["steuer_pct"] = 0
    netto, steuer, brutto = _summen(pos)
    if not d.get("zahlungsbed_id"):            # Zahlungsbedingung des Kunden/Lieferanten vorbelegen
        zb = db.execute(f"SELECT zahlungsbed_id FROM {rolle} WHERE adresse_id=?", (d["adresse_id"],)).fetchone()
        d["zahlungsbed_id"] = zb["zahlungsbed_id"] if zb else None
    felder = dict(belegart=art["code"], datum=d.get("datum") or heute(), adresse_id=d["adresse_id"],
                  projekt_id=d.get("projekt_id") or None, betreff=d.get("betreff"), ihre_referenz=d.get("ihre_referenz"),
                  kopftext=d.get("kopftext"), fusstext=d.get("fusstext"), zahlungsbed_id=d.get("zahlungsbed_id") or None,
                  lager_id=d.get("lager_id") or 1, netto=netto, steuer=steuer, brutto=brutto, memo=d.get("memo"),
                  leistungsdatum=(d.get("leistungsdatum") or "").strip()[:60] or None, steuerfall=sf,
                  verpackung=json.dumps(_verpackung_pruefen(d.get("verpackung")), ensure_ascii=False) if d.get("verpackung") else None)
    with transaktion(db):
        bid = d.get("id")
        if bid:
            alt = db.execute("SELECT status FROM beleg WHERE id=?", (bid,)).fetchone()
            if not alt:
                raise Fehler("Beleg nicht gefunden.")
            if alt["status"] != "entwurf":
                raise Fehler("Der Beleg ist verarbeitet und kann nicht mehr geändert werden. Korrektur nur per Gutschrift/Storno.")
            db.execute(f"UPDATE beleg SET {', '.join(k + '=?' for k in felder)} WHERE id=?", list(felder.values()) + [bid])
            db.execute("DELETE FROM beleg_position WHERE beleg_id=?", (bid,))
        else:
            felder.update(angelegt=jetzt(), angelegt_von=benutzer)
            bid = db.execute(f"INSERT INTO beleg({','.join(felder)}) VALUES({','.join('?' * len(felder))})", list(felder.values())).lastrowid
        for i, p in enumerate(pos, 1):
            z = _zusatz(p.get("zusatz"))
            db.execute("""INSERT INTO beleg_position(beleg_id,pos,artikel_id,text,menge,me,einzelpreis,rabatt_pct,steuer_pct,gesamt,vorgaenger_pos_id,charge_nr,charge_id,zusatz)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                       (bid, i, p.get("artikel_id") or None, p["text"], float(p["menge"]), p["me"], float(p["einzelpreis"]),
                        float(p.get("rabatt_pct") or 0), float(p["steuer_pct"]), p["gesamt"], p.get("vorgaenger_pos_id"),
                        (p.get("charge_nr") or "").strip() or None, p.get("charge_id") or None,
                        json.dumps(z, ensure_ascii=False) if z else None))
        protokoll(db, benutzer, "beleg", bid, "gespeichert")
    return beleg_lesen(db, bid)


def _zusatz(z):
    """Eigene Positionsfelder (Einstellung `positionsfelder`) als dict; aus DB-Text oder Eingabe."""
    if isinstance(z, str):
        try:
            z = json.loads(z or "{}")
        except ValueError:
            z = {}
    return {str(k)[:40]: str(v)[:200] for k, v in (z or {}).items() if str(v or "").strip()} if isinstance(z, dict) else {}


def _verpackung_pruefen(liste):
    out = []
    for v in liste or []:
        art = (v.get("art") or "").strip()[:60]
        try:
            anzahl = float(str(v.get("anzahl") or 0).replace(",", "."))
        except ValueError:
            raise Fehler("Verpackung: Anzahl muss eine Zahl sein.")
        if art and anzahl > 0:
            out.append({"art": art, "anzahl": anzahl})
    return out


def verpackung_speichern(db, bid, liste, benutzer=None):
    """Verpackung/Ladungsträger am Lieferschein – auch nach dem Verarbeiten änderbar (keine Buchung)."""
    v = _verpackung_pruefen(liste)
    with transaktion(db):
        if not db.execute("UPDATE beleg SET verpackung=? WHERE id=?", (json.dumps(v, ensure_ascii=False) if v else None, bid)).rowcount:
            raise Fehler("Beleg nicht gefunden.")
        protokoll(db, benutzer, "beleg", bid, "Verpackung", v)
    return v


def beleg_memo(db, bid, memo, benutzer=None):
    with transaktion(db):
        if not db.execute("UPDATE beleg SET memo=? WHERE id=?", (memo, bid)).rowcount:
            raise Fehler("Beleg nicht gefunden.")
        protokoll(db, benutzer, "beleg", bid, "Memotext")
    return {"ok": True}


def beleg_lesen(db, bid):
    b = zeile(db.execute("""SELECT b.*, ba.name belegart_name, ba.bereich, a.kurz adresse_kurz, a.name1, a.name2, a.strasse, a.plz, a.ort,
                                   k.kundennr, l.lieferantennr, p.projektnr, p.titel projekt_titel, z.text zahlungsbed
                            FROM beleg b JOIN belegart ba ON ba.code=b.belegart JOIN adresse a ON a.id=b.adresse_id
                            LEFT JOIN kunde k ON k.adresse_id=a.id LEFT JOIN lieferant l ON l.adresse_id=a.id
                            LEFT JOIN projekt p ON p.id=b.projekt_id LEFT JOIN zahlungsbedingung z ON z.id=b.zahlungsbed_id
                            WHERE b.id=?""", (bid,)))
    if not b:
        raise Fehler("Beleg nicht gefunden.")
    b["positionen"] = zeilen(db.execute("SELECT * FROM beleg_position WHERE beleg_id=? ORDER BY pos", (bid,)))
    for p in b["positionen"]:
        p["zusatz"] = _zusatz(p.get("zusatz"))
    try:
        b["verpackung"] = json.loads(b.get("verpackung") or "[]")
    except ValueError:
        b["verpackung"] = []
    b["formular"] = formular(db, b["belegart"])
    sf = steuerfall(b.get("steuerfall"))
    b["steuerfall_name"], b["steuerfall_hinweis"] = (sf["name"], sf["hinweis"]) if sf else (None, None)
    b["archiv"] = zeilen(db.execute("SELECT id, version, art, erstellt, benutzer, anlass, sha256, groesse FROM beleg_archiv WHERE beleg_id=? ORDER BY version, art", (bid,)))
    b["folgearten"] = [dict(r) for r in db.execute(
        "SELECT f.nach code, ba.name FROM belegart_folge f JOIN belegart ba ON ba.code=f.nach WHERE f.von=? ORDER BY ba.reihenfolge", (b["belegart"],))]
    b["kette"] = belegkette(db, bid)
    b["dokumente"] = dokumente_beleg(db, bid)
    return b


def belegkette(db, bid):
    """Alle Belege desselben Vorgangs (Vorgänger und Nachfolger, transitiv)."""
    gesehen, offen = set(), [bid]
    while offen:
        x = offen.pop()
        if x in gesehen:
            continue
        gesehen.add(x)
        for r in db.execute("SELECT vorgaenger_id v, nachfolger_id n FROM beleg_verknuepfung WHERE vorgaenger_id=? OR nachfolger_id=?", (x, x)):
            offen += [r["v"], r["n"]]
    if not gesehen:
        return []
    q = ",".join("?" * len(gesehen))
    return zeilen(db.execute(f"""SELECT b.id,b.belegart,b.nummer,b.status,b.datum,b.brutto,ba.name belegart_name
                                 FROM beleg b JOIN belegart ba ON ba.code=b.belegart WHERE b.id IN ({q})
                                 ORDER BY b.datum, ba.reihenfolge, b.id""", list(gesehen)))


def belege_liste(db, bereich="VK", suche="", belegart="", status=""):
    # Wareneingang Kundenmaterial gehört für den Anwender zum Einkauf (Daten bleiben in der Verkaufskette AB→WK→LS)
    sql = """SELECT b.id,b.belegart,b.nummer,b.status,b.datum,b.betreff,b.netto,b.brutto,a.kurz adresse_kurz,
                    p.projektnr FROM beleg b JOIN belegart ba ON ba.code=b.belegart JOIN adresse a ON a.id=b.adresse_id
             LEFT JOIN projekt p ON p.id=b.projekt_id
             WHERE (CASE WHEN b.belegart='WK' THEN 'EK' ELSE ba.bereich END)=?"""
    p = [bereich]
    if belegart:
        sql += " AND b.belegart=?"
        p.append(belegart)
    if status:
        sql += " AND b.status=?"
        p.append(status)
    if suche:
        sql += " AND (b.nummer LIKE ? OR a.kurz LIKE ? OR b.betreff LIKE ? OR p.projektnr LIKE ?)"
        p += [f"%{suche}%"] * 4
    return zeilen(db.execute(sql + " ORDER BY b.datum DESC, b.id DESC LIMIT 500", p))


def beleg_verarbeiten(db, bid, benutzer=None):
    """Der harte Schnitt: Nummer vergeben, sperren, Lager/OP buchen, Meilensteine erledigen."""
    meldungen = []
    with transaktion(db):
        b = zeile(db.execute("SELECT * FROM beleg WHERE id=?", (bid,)))
        if not b:
            raise Fehler("Beleg nicht gefunden.")
        if b["status"] != "entwurf":
            raise Fehler("Der Beleg ist bereits verarbeitet.")
        pos = zeilen(db.execute("SELECT * FROM beleg_position WHERE beleg_id=?", (bid,)))
        if not pos:
            raise Fehler("Der Beleg hat keine Positionen.")
        art = _belegart(db, b["belegart"])
        sf = steuerfall(b.get("steuerfall"))
        if sf and b["belegart"] in ("RE", "GS"):
            a = db.execute("SELECT ust_id, land FROM adresse WHERE id=?", (b["adresse_id"],)).fetchone()
            if sf["ust_id"] and not (a["ust_id"] or "").strip():
                raise Fehler(f"{sf['name']}: Für die steuerfreie Rechnung fehlt die USt-IdNr. des Kunden (Adresse → USt-IdNr.).")
            if sf["ausland"] and (a["land"] or "DE").strip().upper()[:2] == "DE":
                raise Fehler(f"{sf['name']}: Das Land der Kundenadresse ist Deutschland – bitte Land bzw. Steuerfall prüfen.")
        nummer = naechste_nummer(db, art["praefix"], b["datum"])
        db.execute("UPDATE beleg SET nummer=?, status='verarbeitet', verarbeitet=?, verarbeitet_von=? WHERE id=?",
                   (nummer, jetzt(), benutzer, bid))
        # Lager
        if art["lager"]:
            gebucht = 0
            for p in pos:
                if p["charge_id"] or art["code"] == "WK":      # Kundenmaterial gehört dem Kunden – läuft über die Charge, nicht übers eigene Lager
                    continue
                a = db.execute("SELECT lagerfuehrung FROM artikel WHERE id=?", (p["artikel_id"],)).fetchone() if p["artikel_id"] else None
                if a and a["lagerfuehrung"]:
                    db.execute("INSERT INTO lagerbewegung(datum,artikel_id,lager_id,menge,beleg_id,text) VALUES(?,?,?,?,?,?)",
                               (b["datum"], p["artikel_id"], b["lager_id"] or 1, art["lager"] * p["menge"], bid, f"{art['name']} {nummer}"))
                    gebucht += 1
            if gebucht:
                meldungen.append("Lager gebucht")
            if art["lager"] < 0:
                for p in pos:
                    if p["artikel_id"] and not p["charge_id"]:
                        rest = bestand(db, p["artikel_id"])
                        if rest < 0:
                            meldungen.append(f"Achtung: Bestand „{p['text'][:30]}“ jetzt {rest:g}")
        # Offene Posten
        if art["op"]:
            tage = 30
            if b["zahlungsbed_id"]:
                z = db.execute("SELECT tage_netto FROM zahlungsbedingung WHERE id=?", (b["zahlungsbed_id"],)).fetchone()
                tage = z["tage_netto"] if z else 30
            faellig = (_dt.date.fromisoformat(b["datum"]) + _dt.timedelta(days=tage)).isoformat()
            betrag = art["vorzeichen"] * b["brutto"]
            db.execute("INSERT INTO offener_posten(art,beleg_id,adresse_id,datum,faellig,betrag,offen) VALUES(?,?,?,?,?,?,?)",
                       (art["op"], bid, b["adresse_id"], b["datum"], faellig, betrag, betrag))
            meldungen.append(f"Offener Posten {'Debitor' if art['op'] == 'debitor' else 'Kreditor'} angelegt")
        # Chargen (Lohnbearbeitung)
        if art["code"] == "WK":
            for p in pos:
                if not (p["charge_nr"] or "").strip():
                    raise Fehler(f"Bitte für Position {p['pos']} die Charge eintragen.")
                cid = _charge_finden_oder_anlegen(db, p["charge_nr"].strip(), b["adresse_id"], p["artikel_id"], bid, p["id"], b["ihre_referenz"], b["datum"])
                db.execute("UPDATE beleg_position SET charge_id=? WHERE id=?", (cid, p["id"]))
                db.execute("INSERT INTO charge_bewegung(charge_id,datum,art,menge,beleg_id,pos_id,text,benutzer) VALUES(?,?,?,?,?,?,?,?)",
                           (cid, b["datum"], "eingang", p["menge"], bid, p["id"], f"Wareneingang {nummer}" + (f" (Ihr LS {b['ihre_referenz']})" if b["ihre_referenz"] else ""), benutzer))
            meldungen.append(f"{len(pos)} Charge(n) eingebucht")
        if art["code"] == "LS":
            for p in pos:
                if p["artikel_id"] and not p["charge_id"] and not p["vorgaenger_pos_id"] and db.execute(
                        """SELECT 1 FROM charge c WHERE c.adresse_id=? AND c.artikel_id=?
                           AND (SELECT COALESCE(SUM(menge),0) FROM charge_bewegung WHERE charge_id=c.id) > 0 LIMIT 1""",
                        (b["adresse_id"], p["artikel_id"])).fetchone():
                    raise Fehler(f"Position {p['pos']} ist nicht mit Auftrag und Charge verknüpft, obwohl Kundenmaterial im Haus ist. "
                                 "Bitte den Lieferschein über „Lieferschein aus offenen Aufträgen“ bzw. aus der Auftragsbestätigung erstellen.")
            je_charge = {}
            for p in pos:
                if p["charge_id"]:
                    je_charge[p["charge_id"]] = je_charge.get(p["charge_id"], 0) + p["menge"]
            for cid, m in je_charge.items():
                lieferbar = charge_lieferbar(db, cid, entwuerfe=False)
                if m > lieferbar + 1e-9:
                    nr = db.execute("SELECT chargennr FROM charge WHERE id=?", (cid,)).fetchone()["chargennr"]
                    grund = "von der Produktion freigegeben" if nur_freigegeben(db) else "im Haus"
                    raise Fehler(f"Charge {nr}: nur {lieferbar:g} {grund} – der Lieferschein will {m:g}.")
            for p in pos:
                if p["charge_id"]:
                    db.execute("INSERT INTO charge_bewegung(charge_id,datum,art,menge,beleg_id,pos_id,text,benutzer) VALUES(?,?,?,?,?,?,?,?)",
                               (p["charge_id"], b["datum"], "lieferung", -p["menge"], bid, p["id"], f"Lieferschein {nummer}", benutzer))
        # Meilensteine im Projekt automatisch erledigen
        if b["projekt_id"]:
            ms = zeilen(db.execute("""SELECT * FROM meilenstein WHERE projekt_id=? AND ist_ende IS NULL
                                      AND (ausloeser_beleg_id=? OR (ausloeser=? AND ausloeser_beleg_id IS NULL))
                                      ORDER BY pos LIMIT 1""", (b["projekt_id"], bid, b["belegart"])))
            for m in ms:
                db.execute("UPDATE meilenstein SET ist_ende=?, ausloeser_beleg_id=? WHERE id=?", (b["datum"], bid, m["id"]))
                txt = f"{art['name']} {nummer} verarbeitet → „{m['titel']}“ automatisch erledigt"
                db.execute("INSERT INTO projekt_verlauf(projekt_id,zeit,benutzer,text) VALUES(?,?,?,?)", (b["projekt_id"], jetzt(), benutzer, txt))
                meldungen.append(f"Meilenstein „{m['titel']}“ erledigt")
        protokoll(db, benutzer, "beleg", bid, "verarbeitet", {"nummer": nummer})
    if ARCHIV_ORDNER:
        try:
            import archiv
            a = archiv.archivieren(db, bid, benutzer, "verarbeitet")
            meldungen.append("archiviert" + (" (mit E-Rechnung)" if a.get("erechnung") else ""))
            if a.get("hinweis"):
                meldungen.append(a["hinweis"])
        except Exception as ex:                       # Verarbeiten bleibt gültig; Archiv wird beim ersten Abruf nachgeholt
            meldungen.append(f"Achtung: Archiv nicht erstellt ({ex})")
    erg = {"beleg": beleg_lesen(db, bid), "meldungen": meldungen}
    if b["belegart"] == "WK":
        erg["abweichungen"] = mengen_abweichung(db, bid)
    return erg


def offene_menge(db, pos_id, zielart):
    """Menge einer Position, die noch nicht in Belege der Zielart übernommen wurde."""
    p = db.execute("SELECT menge FROM beleg_position WHERE id=?", (pos_id,)).fetchone()
    r = db.execute("""SELECT COALESCE(SUM(n.menge),0) m FROM beleg_position n JOIN beleg b ON b.id=n.beleg_id
                      WHERE n.vorgaenger_pos_id=? AND b.belegart=? AND b.status<>'storniert'""", (pos_id, zielart)).fetchone()
    return p["menge"] - r["m"]


def herkunft_text(db, quelle):
    """Kopfzeile „aus Auftragsbestätigung … / aus Lieferschein …“ für Folgebelege (GSB: LS-Nummer + Auftrag auf der Rechnung)."""
    q = quelle if isinstance(quelle, dict) else zeile(db.execute("SELECT * FROM beleg WHERE id=?", (quelle,)))
    datum = _dt.date.fromisoformat(q["datum"]).strftime("%d.%m.%Y")
    if q["belegart"] == "LS":
        abs_ = [r["nummer"] for r in db.execute("""SELECT DISTINCT b.nummer FROM beleg_verknuepfung v JOIN beleg b ON b.id=v.vorgaenger_id
                                                   WHERE v.nachfolger_id=? AND b.belegart='AB' ORDER BY b.nummer""", (q["id"],))]
        t = f"aus Lieferschein {q['nummer']} vom {datum}" + (f" · Auftrag {', '.join(abs_)}" if abs_ else "")
    else:
        t = f"aus {'Auftragsbestätigung' if q['belegart'] == 'AB' else q['belegart']} {q['nummer']} vom {datum}"
    return t + (f" · Ihre Bestellung {q['ihre_referenz']}" if q.get("ihre_referenz") else "") + ":"


def _ausschuss_offen(db, cid):
    """Ausschuss der Charge, der noch auf keinem Lieferschein gemeldet ist (für die Spalte „Ausschuss“ am LS)."""
    gesamt = -db.execute("SELECT COALESCE(SUM(menge),0) m FROM charge_bewegung WHERE charge_id=? AND art='ausschuss'", (cid,)).fetchone()["m"]
    gesamt -= db.execute("SELECT COALESCE(SUM(menge),0) m FROM charge_bewegung WHERE charge_id=? AND art='korrektur' AND text LIKE 'Storno Ausschuss%'", (cid,)).fetchone()["m"]
    gemeldet = 0.0
    for r in db.execute("""SELECT p.zusatz FROM beleg_position p JOIN beleg b ON b.id=p.beleg_id
                           WHERE p.charge_id=? AND b.belegart='LS' AND b.status<>'storniert'""", (cid,)):
        try:
            gemeldet += float(str(_zusatz(r["zusatz"]).get("Ausschuss", "0")).replace(".", "").replace(",", ".") or 0)
        except ValueError:
            pass
    return max(0.0, gesamt - gemeldet)


def _ausschuss_vorbelegen(db, positionen):
    gesehen = set()
    for p in positionen:
        if p.get("charge_id") and p["charge_id"] not in gesehen and "Ausschuss" not in (p.get("zusatz") or {}):
            gesehen.add(p["charge_id"])
            a = _ausschuss_offen(db, p["charge_id"])
            p["zusatz"] = dict(p.get("zusatz") or {}, Ausschuss=f"{a:g}")
    return positionen


def beleg_weiterverarbeiten(db, bid, zielart, benutzer=None):
    """Folgebeleg als Entwurf erzeugen; Positionen mit offener Restmenge werden übernommen."""
    b = beleg_lesen(db, bid)
    if b["status"] != "verarbeitet":
        raise Fehler("Bitte den Beleg zuerst verarbeiten.")
    if zielart not in [f["code"] for f in b["folgearten"]]:
        raise Fehler(f"{b['belegart_name']} kann nicht zu {zielart} weiterverarbeitet werden.")
    ziel = _belegart(db, zielart)
    pos = []
    for p in b["positionen"]:
        rest = offene_menge(db, p["id"], zielart) if ziel["vorzeichen"] > 0 else p["menge"]
        if rest <= 0:
            continue
        neu_pos = dict(artikel_id=p["artikel_id"], text=p["text"], menge=rest, me=p["me"], einzelpreis=p["einzelpreis"],
                       rabatt_pct=p["rabatt_pct"], steuer_pct=p["steuer_pct"], vorgaenger_pos_id=p["id"], zusatz=p.get("zusatz"),
                       charge_nr=p.get("charge_nr") if zielart != "WK" else None, charge_id=p.get("charge_id") if zielart != "WK" else None)
        if zielart == "LS" and not p.get("charge_id"):
            pos.extend(_chargen_zuordnen(db, neu_pos, p["id"]))    # älteste Charge zuerst, ggf. aufteilen
        else:
            pos.append(neu_pos)
    if not pos:
        if zielart == "LS" and db.execute("""SELECT 1 FROM beleg_verknuepfung v JOIN beleg w ON w.id=v.nachfolger_id
                                             WHERE v.vorgaenger_id=? AND w.belegart='WK' LIMIT 1""", (bid,)).fetchone():
            raise Fehler("Kein Kundenmaterial mehr im Haus (alle Chargen geliefert oder Ausschuss) – erst neuen Wareneingang buchen.")
        raise Fehler(f"Alle Positionen sind bereits vollständig in {ziel['name']} übernommen.")
    if ziel["vorzeichen"] < 0:
        betreff = f"Gutschrift zu {b['nummer']}"
    else:
        betreff = b["betreff"]
    if zielart in ("LS", "RE") and b["belegart"] in ("AB", "LS"):
        pos.insert(0, dict(text=herkunft_text(db, b), menge=0, einzelpreis=0))
    if zielart == "LS":
        _ausschuss_vorbelegen(db, pos)
    neu = beleg_speichern(db, dict(belegart=zielart, adresse_id=b["adresse_id"], projekt_id=b["projekt_id"], betreff=betreff,
                                   ihre_referenz=b["ihre_referenz"], zahlungsbed_id=b["zahlungsbed_id"], lager_id=b["lager_id"],
                                   kopftext=b["kopftext"], fusstext=b["fusstext"], positionen=pos,
                                   steuerfall=b.get("steuerfall")), benutzer)
    with transaktion(db):
        db.execute("INSERT INTO beleg_verknuepfung(vorgaenger_id,nachfolger_id) VALUES(?,?)", (bid, neu["id"]))
    return beleg_lesen(db, neu["id"])



# ---------------------------------------------------------------- Mengenabgleich Wareneingang → Auftrag
def mengen_abweichung(db, wk_id):
    """Auftragspositionen, deren eingegangene Kundenmaterial-Menge (alle verarbeiteten WK) von der AB-Menge abweicht."""
    out = []
    for r in db.execute("""SELECT DISTINCT p.vorgaenger_pos_id ab_pos FROM beleg_position p WHERE p.beleg_id=? AND p.vorgaenger_pos_id IS NOT NULL""", (wk_id,)):
        ab = zeile(db.execute("""SELECT p.*, b.nummer, b.id ab_id, b.belegart FROM beleg_position p JOIN beleg b ON b.id=p.beleg_id WHERE p.id=?""", (r["ab_pos"],)))
        if not ab or ab["belegart"] != "AB":
            continue
        eingang = db.execute("""SELECT COALESCE(SUM(p.menge),0) m FROM beleg_position p JOIN beleg b ON b.id=p.beleg_id
                                WHERE p.vorgaenger_pos_id=? AND b.belegart='WK' AND b.status='verarbeitet'""", (ab["id"],)).fetchone()["m"]
        geliefert = ab["menge"] - offene_menge(db, ab["id"], "LS")
        if abs(eingang - ab["menge"]) > 1e-9:
            out.append(dict(ab_id=ab["ab_id"], ab_nummer=ab["nummer"], pos_id=ab["id"], pos=ab["pos"], text=ab["text"], me=ab["me"],
                            ab_menge=ab["menge"], eingang=eingang, geliefert=geliefert, moeglich=eingang >= geliefert - 1e-9))
    return out


def ab_angleichen(db, wk_id, benutzer=None):
    """AB-Mengen auf die tatsächlich eingegangene Menge setzen – die einzige erlaubte Änderung an einer verarbeiteten AB
    (sie bucht weder Lager noch OP). Wird protokolliert und im Projektverlauf vermerkt."""
    abw = [a for a in mengen_abweichung(db, wk_id) if a["moeglich"]]
    if not abw:
        raise Fehler("Keine Abweichung zum Angleichen.")
    with transaktion(db):
        for a in abw:
            db.execute("UPDATE beleg_position SET menge=? WHERE id=?", (a["eingang"], a["pos_id"]))
        for ab_id in {a["ab_id"] for a in abw}:
            pos = zeilen(db.execute("SELECT * FROM beleg_position WHERE beleg_id=? ORDER BY pos", (ab_id,)))
            netto, steuer, brutto = _summen(pos)
            for p in pos:
                db.execute("UPDATE beleg_position SET gesamt=? WHERE id=?", (p["gesamt"], p["id"]))
            db.execute("UPDATE beleg SET netto=?, steuer=?, brutto=? WHERE id=?", (netto, steuer, brutto, ab_id))
            text = "; ".join(f"Pos. {a['pos']} {a['ab_menge']:g} → {a['eingang']:g} {a['me']}" for a in abw if a["ab_id"] == ab_id)
            wk = db.execute("SELECT nummer FROM beleg WHERE id=?", (wk_id,)).fetchone()["nummer"]
            protokoll(db, benutzer, "beleg", ab_id, "Menge an Wareneingang angeglichen", {"wk": wk, "text": text})
            prj = db.execute("SELECT projekt_id, nummer FROM beleg WHERE id=?", (ab_id,)).fetchone()
            if prj["projekt_id"]:
                db.execute("INSERT INTO projekt_verlauf(projekt_id,zeit,benutzer,text) VALUES(?,?,?,?)",
                           (prj["projekt_id"], jetzt(), benutzer, f"{prj['nummer']}: Menge an Wareneingang {wk} angeglichen ({text})"))
    return {"angeglichen": abw}


# ---------------------------------------------------------------- Sammel-Lieferschein aus offenen Auftragspositionen
def _im_haus(db, ab_pos_id):
    """Kundenmaterial dieser Auftragsposition, das noch im Haus und nicht in einem LS-Entwurf verplant ist."""
    summe, nrn, hat_wk = 0.0, [], False
    for c in db.execute("""SELECT c.id, c.chargennr FROM charge c JOIN beleg_position wp ON wp.id=c.eingang_pos_id
                           WHERE wp.vorgaenger_pos_id=? ORDER BY c.datum, c.id""", (ab_pos_id,)):
        hat_wk = True
        rest = charge_lieferbar(db, c["id"])
        if rest > 1e-9:
            summe += rest
            nrn.append(c["chargennr"])
    return summe, nrn, hat_wk


def offene_auftragspositionen(db, adresse_id=None):
    """Ohne Kunde: Kunden mit offenen AB-Positionen (Anzahl). Mit Kunde: die Positionen, gruppierbar nach AB."""
    if not adresse_id:
        l = {}
        for r in db.execute("""SELECT p.id, b.adresse_id, a.kurz, k.kundennr FROM beleg_position p JOIN beleg b ON b.id=p.beleg_id
                               JOIN adresse a ON a.id=b.adresse_id LEFT JOIN kunde k ON k.adresse_id=a.id
                               WHERE b.belegart='AB' AND b.status='verarbeitet' AND p.menge>0"""):
            if offene_menge(db, r["id"], "LS") > 1e-9:
                x = l.setdefault(r["adresse_id"], dict(adresse_id=r["adresse_id"], kurz=r["kurz"], kundennr=r["kundennr"], anzahl=0))
                x["anzahl"] += 1
        return sorted(l.values(), key=lambda x: x["kurz"])
    out = []
    for p in zeilen(db.execute("""SELECT p.*, b.nummer ab_nummer, b.datum ab_datum, b.id ab_id, b.projekt_id, ar.artikelnr
                                  FROM beleg_position p JOIN beleg b ON b.id=p.beleg_id LEFT JOIN artikel ar ON ar.id=p.artikel_id
                                  WHERE b.belegart='AB' AND b.status='verarbeitet' AND b.adresse_id=? AND p.menge>0
                                  ORDER BY b.datum, b.id, p.pos""", (adresse_id,))):
        offen = offene_menge(db, p["id"], "LS")
        if offen <= 1e-9:
            continue
        im_haus, chargen, hat_wk = _im_haus(db, p["id"])
        out.append(dict(pos_id=p["id"], ab_id=p["ab_id"], ab_nummer=p["ab_nummer"], ab_datum=p["ab_datum"], pos=p["pos"],
                        artikelnr=p["artikelnr"], text=p["text"], me=p["me"], menge=p["menge"], offen=offen,
                        im_haus=im_haus, chargen=chargen, kundenmaterial=hat_wk,
                        vorschlag=min(offen, im_haus) if hat_wk else offen))
    return out


def sammel_lieferschein(db, adresse_id, auswahl, benutzer=None):
    """Ein Lieferschein aus Positionen mehrerer Aufträge eines Kunden; Chargen werden wie beim normalen LS verteilt."""
    if not auswahl:
        raise Fehler("Bitte mindestens eine Position auswählen.")
    offen = {p["pos_id"]: p for p in offene_auftragspositionen(db, adresse_id)}
    gruppen = {}
    for a in auswahl:
        pid, menge = int(a.get("pos_id") or 0), float(a.get("menge") or 0)
        p = offen.get(pid)
        if not p:
            raise Fehler("Eine gewählte Position ist nicht mehr offen – bitte Liste neu laden.")
        if menge <= 0:
            continue
        if menge > p["offen"] + 1e-9:
            raise Fehler(f"{p['ab_nummer']} Pos. {p['pos']}: höchstens {p['offen']:g} offen.")
        if p["kundenmaterial"] and menge > p["im_haus"] + 1e-9:
            raise Fehler(f"{p['ab_nummer']} Pos. {p['pos']}: nur {p['im_haus']:g} Kundenmaterial im Haus.")
        gruppen.setdefault(p["ab_id"], []).append((p, menge))
    if not gruppen:
        raise Fehler("Bitte Mengen größer 0 angeben.")
    pos, projekte, refs = [], set(), set()
    for ab_id, liste in gruppen.items():
        ab = zeile(db.execute("SELECT * FROM beleg WHERE id=?", (ab_id,)))
        projekte.add(ab["projekt_id"])
        refs.add(ab["ihre_referenz"])
        pos.append(dict(text=herkunft_text(db, ab), menge=0, einzelpreis=0))
        for p, menge in liste:
            bp = zeile(db.execute("SELECT * FROM beleg_position WHERE id=?", (p["pos_id"],)))
            np = dict(artikel_id=bp["artikel_id"], text=bp["text"], menge=menge, me=bp["me"], einzelpreis=bp["einzelpreis"],
                      rabatt_pct=bp["rabatt_pct"], steuer_pct=bp["steuer_pct"], vorgaenger_pos_id=bp["id"],
                      charge_nr=bp["charge_nr"], charge_id=bp["charge_id"], zusatz=bp.get("zusatz"))
            pos.extend(_chargen_zuordnen(db, np, bp["id"]) if not bp["charge_id"] else [np])
    _ausschuss_vorbelegen(db, pos)
    erste = zeile(db.execute("SELECT * FROM beleg WHERE id=?", (next(iter(gruppen)),)))
    neu = beleg_speichern(db, dict(belegart="LS", adresse_id=adresse_id,
                                   projekt_id=projekte.pop() if len(projekte) == 1 else None,
                                   ihre_referenz=refs.pop() if len(refs) == 1 else None,
                                   betreff=erste["betreff"] if len(gruppen) == 1 else f"Lieferung zu {len(gruppen)} Aufträgen",
                                   zahlungsbed_id=erste["zahlungsbed_id"], lager_id=erste["lager_id"], positionen=pos), benutzer)
    with transaktion(db):
        for ab_id in gruppen:
            db.execute("INSERT OR IGNORE INTO beleg_verknuepfung(vorgaenger_id,nachfolger_id) VALUES(?,?)", (ab_id, neu["id"]))
    return beleg_lesen(db, neu["id"])



# ---------------------------------------------------------------- Sammelrechnung aus offenen Lieferscheinen
def offene_lieferscheine(db, adresse_id=None):
    """Verarbeitete Lieferscheine mit noch nicht berechneten Positionen. Ohne Kunde: Kunden mit Anzahl."""
    l = []
    for b in zeilen(db.execute("""SELECT b.id, b.nummer, b.datum, b.adresse_id, b.ihre_referenz, a.kurz, k.kundennr FROM beleg b
                                  JOIN adresse a ON a.id=b.adresse_id LEFT JOIN kunde k ON k.adresse_id=a.id
                                  WHERE b.belegart='LS' AND b.status='verarbeitet'""" + (" AND b.adresse_id=?" if adresse_id else "") + " ORDER BY b.datum, b.id",
                               (adresse_id,) if adresse_id else ())):
        pos = [p for p in zeilen(db.execute("SELECT * FROM beleg_position WHERE beleg_id=? ORDER BY pos", (b["id"],))) if not ist_textzeile(p)]
        offen = [dict(p, offen=offene_menge(db, p["id"], "RE")) for p in pos]
        offen = [p for p in offen if p["offen"] > 1e-9]
        if offen:
            b["positionen"] = offen
            b["netto"] = round(sum(round(p["offen"] * p["einzelpreis"] * (1 - (p["rabatt_pct"] or 0) / 100), 2) for p in offen), 2)
            l.append(b)
    if adresse_id:
        return l
    k = {}
    for b in l:
        x = k.setdefault(b["adresse_id"], dict(adresse_id=b["adresse_id"], kurz=b["kurz"], kundennr=b["kundennr"], anzahl=0, netto=0.0))
        x["anzahl"] += 1
        x["netto"] = round(x["netto"] + b["netto"], 2)
    return sorted(k.values(), key=lambda x: x["kurz"])


def sammel_rechnung(db, adresse_id, ls_ids, benutzer=None):
    """Eine Rechnung über mehrere Lieferscheine eines Kunden (nur noch nicht berechnete Mengen)."""
    offen = {b["id"]: b for b in offene_lieferscheine(db, adresse_id)}
    ls_ids = [int(x) for x in ls_ids or []]
    if not ls_ids:
        raise Fehler("Bitte mindestens einen Lieferschein auswählen.")
    if any(i not in offen for i in ls_ids):
        raise Fehler("Ein gewählter Lieferschein ist nicht mehr offen – bitte Liste neu laden.")
    ls_ids.sort(key=lambda i: (offen[i]["datum"], i))
    pos, projekte, refs = [], set(), set()
    for i in ls_ids:
        ls = zeile(db.execute("SELECT * FROM beleg WHERE id=?", (i,)))
        projekte.add(ls["projekt_id"])
        refs.add(ls["ihre_referenz"])
        pos.append(dict(text=herkunft_text(db, ls), menge=0, einzelpreis=0))
        for p in offen[i]["positionen"]:
            pos.append(dict(artikel_id=p["artikel_id"], text=p["text"], menge=p["offen"], me=p["me"], einzelpreis=p["einzelpreis"],
                            rabatt_pct=p["rabatt_pct"], steuer_pct=p["steuer_pct"], vorgaenger_pos_id=p["id"],
                            charge_nr=p["charge_nr"], charge_id=p["charge_id"], zusatz=p.get("zusatz")))
    erste = zeile(db.execute("SELECT * FROM beleg WHERE id=?", (ls_ids[0],)))
    zb = db.execute("SELECT zahlungsbed_id FROM kunde WHERE adresse_id=?", (adresse_id,)).fetchone()
    neu = beleg_speichern(db, dict(belegart="RE", adresse_id=adresse_id,
                                   projekt_id=projekte.pop() if len(projekte) == 1 else None,
                                   ihre_referenz=refs.pop() if len(refs) == 1 else None,
                                   betreff=erste["betreff"] if len(ls_ids) == 1 else f"Rechnung zu {len(ls_ids)} Lieferscheinen",
                                   zahlungsbed_id=(zb["zahlungsbed_id"] if zb else None) or erste["zahlungsbed_id"], positionen=pos), benutzer)
    with transaktion(db):
        for i in ls_ids:
            db.execute("INSERT OR IGNORE INTO beleg_verknuepfung(vorgaenger_id,nachfolger_id) VALUES(?,?)", (i, neu["id"]))
    return beleg_lesen(db, neu["id"])


# ---------------------------------------------------------------- Chargen
def charge_rest(db, cid):
    return db.execute("SELECT COALESCE(SUM(menge),0) m FROM charge_bewegung WHERE charge_id=?", (cid,)).fetchone()["m"]


def nur_freigegeben(db):
    r = db.execute("SELECT wert FROM einstellung WHERE schluessel='ls_nur_freigegeben'").fetchone()
    return bool(r and (r["wert"] or "").strip() not in ("", "0"))


def charge_lieferbar(db, cid, entwuerfe=True, ohne_beleg=None):
    """Was von der Charge auf einen Lieferschein darf: Rest im Haus, abzüglich LS-Entwürfe;
    mit Einstellung „Lieferschein nur nach Produktionsfreigabe“ höchstens die freigegebene Menge minus bereits Geliefertes."""
    rest = charge_rest(db, cid)
    if nur_freigegeben(db):
        frei = db.execute("SELECT COALESCE(SUM(menge_gut),0) m FROM fertigung WHERE charge_id=? AND freigabe=1 AND ende IS NOT NULL", (cid,)).fetchone()["m"]
        geliefert = -db.execute("SELECT COALESCE(SUM(menge),0) m FROM charge_bewegung WHERE charge_id=? AND art='lieferung'", (cid,)).fetchone()["m"]
        rest = min(rest, frei - geliefert)
    if entwuerfe:
        rest -= db.execute("""SELECT COALESCE(SUM(p.menge),0) m FROM beleg_position p JOIN beleg b ON b.id=p.beleg_id
                              WHERE p.charge_id=? AND b.status='entwurf' AND b.belegart='LS' AND b.id IS NOT ?""", (cid, ohne_beleg)).fetchone()["m"]
    return max(0.0, rest)


def _charge_finden_oder_anlegen(db, nr, adresse_id, artikel_id, beleg_id, pos_id, kunden_ls, datum):
    r = db.execute("SELECT id FROM charge WHERE chargennr=? AND adresse_id=? AND artikel_id IS ?", (nr, adresse_id, artikel_id)).fetchone()
    if r:
        return r["id"]          # Nachlieferung derselben Charge
    return db.execute("""INSERT INTO charge(chargennr,adresse_id,artikel_id,herkunft,eingang_beleg_id,eingang_pos_id,kunden_ls,datum)
                         VALUES(?,?,?,?,?,?,?,?)""", (nr, adresse_id, artikel_id, "kunde", beleg_id, pos_id, kunden_ls, datum)).lastrowid


def _chargen_zuordnen(db, pos, ab_pos_id):
    """Lieferschein-Position auf die eingegangenen Chargen dieser Auftragsposition verteilen (älteste zuerst)."""
    chargen = zeilen(db.execute("""SELECT c.id, c.chargennr FROM charge c JOIN beleg_position wp ON wp.id=c.eingang_pos_id
                                   WHERE wp.vorgaenger_pos_id=? ORDER BY c.datum, c.id""", (ab_pos_id,)))
    if not chargen:     # Charge evtl. über eine andere Position eingegangen – gleiche Kunde/Artikel
        chargen = []
    offen, teile = pos["menge"], []
    for c in chargen:
        rest = charge_lieferbar(db, c["id"])
        if rest <= 0 or offen <= 0:
            continue
        m = min(rest, offen)
        teile.append(dict(pos, menge=m, charge_id=c["id"], charge_nr=c["chargennr"]))
        offen -= m
    if offen > 1e-9 and not chargen:
        teile.append(dict(pos, menge=offen))          # noch kein Wareneingang zu dieser Position → ohne Charge vorschlagen
    return teile                                       # sonst nur liefern, was an Kundenmaterial im Haus ist


def chargen_liste(db, suche="", adresse_id=None, artikel_id=None, nur_offen=False):
    sql = """SELECT c.*, a.kurz kunde_kurz, ar.artikelnr, ar.kurz artikel_kurz, b.nummer eingang_nummer,
                    (SELECT COALESCE(SUM(menge),0) FROM charge_bewegung WHERE charge_id=c.id AND art='eingang') eingang,
                    (SELECT COALESCE(-SUM(menge),0) FROM charge_bewegung WHERE charge_id=c.id AND art='lieferung') geliefert,
                    (SELECT COALESCE(-SUM(menge),0) FROM charge_bewegung WHERE charge_id=c.id AND art='ausschuss') ausschuss,
                    (SELECT COALESCE(SUM(menge),0) FROM charge_bewegung WHERE charge_id=c.id) rest
             FROM charge c JOIN adresse a ON a.id=c.adresse_id LEFT JOIN artikel ar ON ar.id=c.artikel_id
             LEFT JOIN beleg b ON b.id=c.eingang_beleg_id WHERE 1=1"""
    par = []
    if suche:
        sql += " AND (c.chargennr LIKE ? OR a.kurz LIKE ? OR ar.artikelnr LIKE ? OR c.kunden_ls LIKE ? OR b.nummer LIKE ?)"
        par += [f"%{suche}%"] * 5
    if adresse_id:
        sql += " AND c.adresse_id=?"
        par.append(adresse_id)
    if artikel_id:
        sql += " AND c.artikel_id=?"
        par.append(artikel_id)
    l = zeilen(db.execute(sql + " ORDER BY c.datum DESC, c.id DESC LIMIT 500", par))
    return [c for c in l if c["rest"] > 1e-9] if nur_offen else l


def charge_lesen(db, cid):
    c = next((x for x in chargen_liste(db) if x["id"] == cid), None) or zeile(db.execute("SELECT * FROM charge WHERE id=?", (cid,)))
    if not c:
        raise Fehler("Charge nicht gefunden.")
    c = dict(c)
    c["bewegungen"] = zeilen(db.execute("""SELECT cb.*, b.nummer, b.belegart FROM charge_bewegung cb LEFT JOIN beleg b ON b.id=cb.beleg_id
                                           WHERE cb.charge_id=? ORDER BY cb.datum, cb.id""", (cid,)))
    # Rückverfolgung: Rechnungen zu den Lieferscheinen
    c["rechnungen"] = zeilen(db.execute("""SELECT DISTINCT r.id, r.nummer, r.datum, r.status FROM charge_bewegung cb
                                          JOIN beleg_verknuepfung v ON v.vorgaenger_id=cb.beleg_id JOIN beleg r ON r.id=v.nachfolger_id
                                          WHERE cb.charge_id=? AND cb.art='lieferung' AND r.belegart IN ('RE','GS')""", (cid,)))
    c["dokumente"] = dokumente_zu(db, "charge", cid)
    if c.get("eingang_beleg_id"):
        for d in dokumente_zu(db, "beleg", c["eingang_beleg_id"]):
            d["herkunft"] = f"Wareneingang {c.get('eingang_nummer') or ''}".strip()
            c["dokumente"].append(d)
    return c


def charge_ausschuss(db, cid, menge, grund, benutzer=None):
    menge = float(menge or 0)
    if menge <= 0:
        raise Fehler("Bitte eine Menge größer 0 angeben.")
    with transaktion(db):
        if menge > charge_rest(db, cid) + 1e-9:
            raise Fehler("Mehr Ausschuss als Restmenge der Charge.")
        db.execute("INSERT INTO charge_bewegung(charge_id,datum,art,menge,text,benutzer) VALUES(?,?,?,?,?,?)",
                   (cid, heute(), "ausschuss", -menge, f"Ausschuss: {grund or 'ohne Angabe'}", benutzer))
    return charge_lesen(db, cid)


# ---------------------------------------------------------------- Dokumente
DOK_ORDNER = None      # wird vom Server gesetzt
ARCHIV_ORDNER = None   # unveränderbare Beleg-Originale (GoBD), vom Server gesetzt


def dokument_speichern(db, objekt, objekt_id, name, daten, mime=None, benutzer=None):
    if objekt not in ("charge", "beleg", "projekt", "adresse", "artikel"):
        raise Fehler("Unbekanntes Objekt.")
    if not daten or len(daten) > 25_000_000:
        raise Fehler("Datei leer oder größer als 25 MB.")
    name = os.path.basename(name or "datei").replace("/", "_")[:120] or "datei"
    os.makedirs(DOK_ORDNER, exist_ok=True)
    datei = f"{secrets.token_hex(8)}_{name}"
    with open(os.path.join(DOK_ORDNER, datei), "wb") as f:
        f.write(daten)
    with transaktion(db):
        did = db.execute("INSERT INTO dokument(objekt,objekt_id,name,mime,groesse,datei,hochgeladen,von) VALUES(?,?,?,?,?,?,?,?)",
                         (objekt, objekt_id, name, mime, len(daten), datei, jetzt(), benutzer)).lastrowid
        protokoll(db, benutzer, objekt, objekt_id, "Dokument hochgeladen", {"name": name})
    return {"id": did, "name": name}


def dokumente_zu(db, objekt, objekt_id):
    return zeilen(db.execute("SELECT id,name,mime,groesse,hochgeladen,von,objekt,objekt_id FROM dokument WHERE objekt=? AND objekt_id=? ORDER BY id DESC",
                             (objekt, objekt_id)))


def dokumente_beleg(db, bid):
    """Eigene Dokumente + Dokumente der Chargen in den Positionen + Dokumente des Wareneingangs dieser Chargen."""
    erg = dokumente_zu(db, "beleg", bid)
    for r in db.execute("SELECT DISTINCT charge_id FROM beleg_position WHERE beleg_id=? AND charge_id IS NOT NULL", (bid,)):
        c = db.execute("SELECT chargennr, eingang_beleg_id FROM charge WHERE id=?", (r["charge_id"],)).fetchone()
        for d in dokumente_zu(db, "charge", r["charge_id"]) + (dokumente_zu(db, "beleg", c["eingang_beleg_id"]) if c["eingang_beleg_id"] and c["eingang_beleg_id"] != bid else []):
            d["herkunft"] = f"Charge {c['chargennr']}"
            erg.append(d)
    seen, out = set(), []
    for d in erg:
        if d["id"] not in seen:
            seen.add(d["id"])
            out.append(d)
    return out


def dokument_datei(db, did):
    d = zeile(db.execute("SELECT * FROM dokument WHERE id=?", (did,)))
    if not d:
        raise Fehler("Dokument nicht gefunden.")
    with open(os.path.join(DOK_ORDNER, d["datei"]), "rb") as f:
        return d, f.read()


def beleg_loeschen(db, bid, benutzer=None):
    with transaktion(db):
        b = db.execute("SELECT status FROM beleg WHERE id=?", (bid,)).fetchone()
        if not b:
            raise Fehler("Beleg nicht gefunden.")
        if b["status"] != "entwurf":
            raise Fehler("Verarbeitete Belege werden nie gelöscht – bitte Gutschrift/Storno erstellen.")
        db.execute("DELETE FROM beleg_verknuepfung WHERE nachfolger_id=? OR vorgaenger_id=?", (bid, bid))
        db.execute("DELETE FROM beleg_position WHERE beleg_id=?", (bid,))
        db.execute("DELETE FROM beleg WHERE id=?", (bid,))
        protokoll(db, benutzer, "beleg", bid, "Entwurf gelöscht")


# ---------------------------------------------------------------- Offene Posten
def op_liste(db, art="debitor", nur_offen=True):
    sql = """SELECT o.*, a.kurz adresse_kurz, b.nummer, b.belegart,
                    CAST(julianday('now') - julianday(o.faellig) AS INTEGER) tage_ueber
             FROM offener_posten o JOIN adresse a ON a.id=o.adresse_id JOIN beleg b ON b.id=o.beleg_id WHERE o.art=?"""
    if nur_offen:
        sql += " AND o.offen<>0"
    return zeilen(db.execute(sql + " ORDER BY o.faellig", (art,)))


def zahlung_buchen(db, op_id, betrag, benutzer=None):
    with transaktion(db):
        o = db.execute("SELECT * FROM offener_posten WHERE id=?", (op_id,)).fetchone()
        if not o:
            raise Fehler("Offener Posten nicht gefunden.")
        neu = round(o["offen"] - float(betrag), 2)
        db.execute("UPDATE offener_posten SET offen=? WHERE id=?", (neu, op_id))
        protokoll(db, benutzer, "op", op_id, "Zahlung", {"betrag": betrag})
    return {"offen": neu}


# ---------------------------------------------------------------- Projekte & Zeitstrahl
def _tage(a, b):
    return (_dt.date.fromisoformat(b) - _dt.date.fromisoformat(a)).days


def de(d):
    return _dt.date.fromisoformat(d[:10]).strftime("%d.%m.%Y") if d else "–"


def _verschiebe(d, n):
    return (_dt.date.fromisoformat(d) + _dt.timedelta(days=n)).isoformat()


def ms_status(m, stichtag=None):
    stichtag = stichtag or heute()
    if m["ist_ende"]:
        v = _tage(m["zugesagt"], m["ist_ende"])
        return ("ok", "Termin gehalten") if v <= 0 else ("late", f"Erledigt, {v} Tag{'e' if v > 1 else ''} Verzug")
    rest = _tage(stichtag, m["plan_ende"])
    if rest < 0:
        return "over", f"Überfällig seit {-rest} Tag{'en' if rest < -1 else ''}"
    if rest <= 3:
        return "risk", "Heute fällig" if rest == 0 else f"Fällig in {rest} Tag{'en' if rest > 1 else ''}"
    if _tage(m["plan_start"], stichtag) >= 0:
        return "open", "In Arbeit"
    return "fut", "Geplant"


def projekt_speichern(db, d, benutzer=None):
    if not (d.get("titel") or "").strip():
        raise Fehler("Titel fehlt.")
    with transaktion(db):
        if d.get("id"):
            db.execute("UPDATE projekt SET titel=?, kunde_id=?, ansprechpartner=?, status=? WHERE id=?",
                       (d["titel"], d.get("kunde_id"), d.get("ansprechpartner"), d.get("status") or "aktiv", d["id"]))
            pid = d["id"]
        else:
            jahr = heute()[2:4]
            n = db.execute("SELECT COUNT(*) c FROM projekt WHERE projektnr LIKE ?", (f"P-{jahr}-%",)).fetchone()["c"] + 1
            pid = db.execute("INSERT INTO projekt(projektnr,titel,kunde_id,ansprechpartner,status,angelegt) VALUES(?,?,?,?,?,?)",
                             (d.get("projektnr") or f"P-{jahr}-{n:04d}", d["titel"], d.get("kunde_id"), d.get("ansprechpartner"),
                              d.get("status") or "aktiv", jetzt())).lastrowid
            db.execute("INSERT INTO projekt_verlauf(projekt_id,zeit,benutzer,text) VALUES(?,?,?,?)", (pid, jetzt(), benutzer, "Projekt angelegt"))
        for i, m in enumerate(d.get("meilensteine") or [], 1):
            ende = m.get("plan_ende") or m.get("plan_start")
            db.execute("""INSERT INTO meilenstein(projekt_id,pos,titel,verantwortlich,ist_meilenstein,plan_start,plan_ende,zugesagt,ist_ende,ausloeser,grund)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                       (pid, m.get("pos") or i, m["titel"], m.get("verantwortlich"), 1 if m.get("ist_meilenstein") else 0,
                        m.get("plan_start") or ende, ende, m.get("zugesagt") or ende, m.get("ist_ende"), m.get("ausloeser"), m.get("grund")))
    return projekt_lesen(db, pid)


def plan_fixieren(db, pid, benutzer=None):
    """Aktuellen Plan als Zusage an den Kunden einfrieren."""
    with transaktion(db):
        db.execute("UPDATE meilenstein SET zugesagt=plan_ende WHERE projekt_id=? AND ist_ende IS NULL", (pid,))
        db.execute("UPDATE projekt SET plan_fixiert=? WHERE id=?", (jetzt(), pid))
        db.execute("INSERT INTO projekt_verlauf(projekt_id,zeit,benutzer,text) VALUES(?,?,?,?)",
                   (pid, jetzt(), benutzer, "Terminplan als Zusage an den Kunden eingefroren"))
    return projekt_lesen(db, pid)


def projekt_lesen(db, pid, stichtag=None):
    p = zeile(db.execute("""SELECT p.*, a.kurz kunde_kurz, a.name1 kunde_name FROM projekt p LEFT JOIN adresse a ON a.id=p.kunde_id WHERE p.id=?""", (pid,)))
    if not p:
        raise Fehler("Projekt nicht gefunden.")
    ms = zeilen(db.execute("""SELECT m.*, b.nummer ausloeser_nummer, ba.name ausloeser_name FROM meilenstein m
                              LEFT JOIN beleg b ON b.id=m.ausloeser_beleg_id LEFT JOIN belegart ba ON ba.code=m.ausloeser
                              WHERE m.projekt_id=? ORDER BY m.pos""", (pid,)))
    for m in ms:
        m["status"], m["status_text"] = ms_status(m, stichtag)
    p["meilensteine"] = ms
    erl = [m for m in ms if m["ist_ende"]]
    geh = [m for m in erl if m["status"] == "ok"]
    ende = ms[-1] if ms else None
    p["kennzahlen"] = dict(erledigt=len(erl), gesamt=len(ms), gehalten=len(geh),
                           termintreue=round(len(geh) / len(erl) * 100) if erl else 100,
                           ueberfaellig=sum(1 for m in ms if m["status"] == "over"),
                           endtermin=(ende["ist_ende"] or ende["plan_ende"]) if ende else None,
                           endtermin_zugesagt=ende["zugesagt"] if ende else None,
                           endverzug=_tage(ende["zugesagt"], ende["ist_ende"] or ende["plan_ende"]) if ende else 0)
    p["verlauf"] = zeilen(db.execute("SELECT * FROM projekt_verlauf WHERE projekt_id=? ORDER BY id DESC", (pid,)))
    p["belege"] = zeilen(db.execute("""SELECT b.id,b.belegart,b.nummer,b.status,b.datum,b.brutto,ba.name belegart_name,ba.bereich
                                       FROM beleg b JOIN belegart ba ON ba.code=b.belegart WHERE b.projekt_id=? ORDER BY b.datum,b.id""", (pid,)))
    return p


def projekte_liste(db):
    out = []
    for r in zeilen(db.execute("SELECT p.id FROM projekt p ORDER BY p.status='abgeschlossen', p.id DESC")):
        p = projekt_lesen(db, r["id"])
        out.append({k: p[k] for k in ("id", "projektnr", "titel", "kunde_kurz", "status", "kennzahlen")})
    return out


def meilenstein_erledigt(db, mid, datum=None, benutzer=None, zuruecknehmen=False):
    with transaktion(db):
        m = zeile(db.execute("SELECT * FROM meilenstein WHERE id=?", (mid,)))
        if not m:
            raise Fehler("Meilenstein nicht gefunden.")
        if zuruecknehmen:
            db.execute("UPDATE meilenstein SET ist_ende=NULL WHERE id=?", (mid,))
            txt = f"„{m['titel']}“: Erledigt-Meldung zurückgenommen"
        else:
            datum = datum or heute()
            db.execute("UPDATE meilenstein SET ist_ende=? WHERE id=?", (datum, mid))
            txt = f"„{m['titel']}“ erledigt gemeldet ({de(datum)})"
        db.execute("INSERT INTO projekt_verlauf(projekt_id,zeit,benutzer,text) VALUES(?,?,?,?)", (m["projekt_id"], jetzt(), benutzer, txt))
    return projekt_lesen(db, m["projekt_id"])


def meilenstein_verschieben(db, mid, neu_ende, grund, folge=True, bemerkung="", benutzer=None):
    if not grund:
        raise Fehler("Ohne Grund keine Verschiebung – bitte einen Grund angeben.")
    with transaktion(db):
        m = zeile(db.execute("SELECT * FROM meilenstein WHERE id=?", (mid,)))
        if not m:
            raise Fehler("Meilenstein nicht gefunden.")
        if m["ist_ende"]:
            raise Fehler("Erledigte Schritte können nicht verschoben werden.")
        delta = _tage(m["plan_ende"], neu_ende)
        if delta == 0:
            raise Fehler("Termin unverändert.")
        db.execute("UPDATE meilenstein SET plan_start=?, plan_ende=?, grund=? WHERE id=?",
                   (_verschiebe(m["plan_start"], delta), neu_ende, grund, mid))
        n = 0
        if folge:
            for f in zeilen(db.execute("SELECT * FROM meilenstein WHERE projekt_id=? AND pos>? AND ist_ende IS NULL", (m["projekt_id"], m["pos"]))):
                db.execute("UPDATE meilenstein SET plan_start=?, plan_ende=?, grund=COALESCE(grund, ?) WHERE id=?",
                           (_verschiebe(f["plan_start"], delta), _verschiebe(f["plan_ende"], delta),
                            f"Folge aus Schritt {m['pos']} ({grund})", f["id"]))
                n += 1
        txt = (f"„{m['titel']}“ verschoben um {'+' if delta > 0 else ''}{delta} Tage auf {de(neu_ende)} – Grund: {grund}"
               + (f" ({bemerkung})" if bemerkung else "") + (f", {n} Folgeschritte mitgeschoben" if n else ""))
        db.execute("INSERT INTO projekt_verlauf(projekt_id,zeit,benutzer,text) VALUES(?,?,?,?)", (m["projekt_id"], jetzt(), benutzer, txt))
    return projekt_lesen(db, m["projekt_id"])


# ---------------------------------------------------------------- Werkstatt (Tablet in der Produktion)
WERKSTATT_PREFIX = "Werkstatt meldet"


def werkstatt_liste(db, bereich=""):
    """Offene Schritte aller laufenden Projekte – ohne Preise/Kundendaten außer Kurzname."""
    sql = """SELECT m.id, m.pos, m.titel, m.verantwortlich, m.plan_start, m.plan_ende, m.zugesagt, m.ist_ende, m.ist_meilenstein,
                    p.id projekt_id, p.projektnr, p.titel projekt_titel, a.kurz kunde_kurz
             FROM meilenstein m JOIN projekt p ON p.id=m.projekt_id LEFT JOIN adresse a ON a.id=p.kunde_id
             WHERE p.status<>'abgeschlossen' AND (m.ist_ende IS NULL OR m.ist_ende>=?)"""
    par = [(_dt.date.today() - _dt.timedelta(days=1)).isoformat()]
    if bereich:
        sql += " AND m.verantwortlich=?"
        par.append(bereich)
    out = zeilen(db.execute(sql + " ORDER BY m.ist_ende IS NOT NULL, m.plan_ende, p.projektnr, m.pos", par))
    for m in out:
        m["status"], m["status_text"] = ms_status(m)
    bereiche = [r["v"] for r in db.execute("""SELECT DISTINCT m.verantwortlich v FROM meilenstein m JOIN projekt p ON p.id=m.projekt_id
                                              WHERE p.status<>'abgeschlossen' AND m.verantwortlich IS NOT NULL ORDER BY 1""")]
    return {"schritte": out, "bereiche": bereiche}


def meilenstein_hinweis(db, mid, text, benutzer=None):
    text = (text or "").strip()
    if not text:
        raise Fehler("Bitte kurz beschreiben, was los ist.")
    with transaktion(db):
        m = db.execute("SELECT projekt_id, titel FROM meilenstein WHERE id=?", (mid,)).fetchone()
        if not m:
            raise Fehler("Schritt nicht gefunden.")
        db.execute("INSERT INTO projekt_verlauf(projekt_id,zeit,benutzer,text) VALUES(?,?,?,?)",
                   (m["projekt_id"], jetzt(), benutzer, f"{WERKSTATT_PREFIX} zu „{m['titel']}“: {text[:500]}"))
    return {"ok": True}


# ---------------------------------------------------------------- Startseite
def diagrammdaten(db):
    """Daten für die Startseiten-Diagramme (Netto, Rechnungen minus Gutschriften)."""
    h = _dt.date.today()
    umsatz_sql = """SELECT substr(b.datum,1,7) monat, SUM(ba.vorzeichen*b.netto) s FROM beleg b JOIN belegart ba ON ba.code=b.belegart
                    WHERE b.status='verarbeitet' AND b.belegart IN ('RE','GS') AND b.datum>=? GROUP BY 1"""
    werte = {r["monat"]: r["s"] for r in db.execute(umsatz_sql, ((h.replace(day=1) - _dt.timedelta(days=760)).isoformat(),))}
    monate = []
    for i in range(11, -1, -1):
        y, m = divmod(h.year * 12 + h.month - 1 - i, 12)
        k = f"{y}-{m + 1:02d}"
        monate.append(dict(monat=k, netto=round(werte.get(k, 0), 2), vorjahr=round(werte.get(f"{y - 1}-{m + 1:02d}", 0), 2)))
    jahr, vj = str(h.year), str(h.year - 1)
    top = zeilen(db.execute("""SELECT a.id, a.kurz, SUM(ba.vorzeichen*b.netto) netto FROM beleg b JOIN belegart ba ON ba.code=b.belegart
                               JOIN adresse a ON a.id=b.adresse_id WHERE b.status='verarbeitet' AND b.belegart IN ('RE','GS') AND substr(b.datum,1,4)=?
                               GROUP BY a.id ORDER BY netto DESC LIMIT 6""", (jahr,)))
    gruppen = zeilen(db.execute("""SELECT COALESCE(ar.gruppe,'ohne Gruppe') gruppe,
                                   SUM(CASE WHEN substr(b.datum,1,4)=? THEN ba.vorzeichen*p.gesamt ELSE 0 END) jahr,
                                   SUM(CASE WHEN substr(b.datum,1,4)=? THEN ba.vorzeichen*p.gesamt ELSE 0 END) vorjahr
                                   FROM beleg_position p JOIN beleg b ON b.id=p.beleg_id JOIN belegart ba ON ba.code=b.belegart
                                   LEFT JOIN artikel ar ON ar.id=p.artikel_id
                                   WHERE b.status='verarbeitet' AND b.belegart IN ('RE','GS') GROUP BY 1 HAVING jahr<>0 OR vorjahr<>0 ORDER BY jahr DESC""", (jahr, vj)))
    # Auftragsbestand: verarbeitete AB-Positionen minus bereits gelieferte Mengen, bewertet mit Positionspreis
    bestand = zeilen(db.execute("""SELECT a.id, a.kurz, SUM(MAX(p.menge - COALESCE((SELECT SUM(n.menge) FROM beleg_position n JOIN beleg nb ON nb.id=n.beleg_id
                                          WHERE n.vorgaenger_pos_id=p.id AND nb.belegart IN ('LS','RE') AND nb.status='verarbeitet'),0), 0)
                                          * p.einzelpreis * (1 - p.rabatt_pct/100)) wert
                                   FROM beleg_position p JOIN beleg b ON b.id=p.beleg_id JOIN adresse a ON a.id=b.adresse_id
                                   WHERE b.belegart='AB' AND b.status='verarbeitet' GROUP BY a.id HAVING wert>0.005 ORDER BY wert DESC LIMIT 8"""))
    return dict(umsatz_monate=monate, top_kunden=top, artikelgruppen=gruppen, auftragsbestand=bestand,
                auftragsbestand_summe=round(sum(x["wert"] for x in bestand), 2))


def uebersicht(db):
    h = heute()
    monat = h[:7]
    umsatz = db.execute("""SELECT COALESCE(SUM(ba.vorzeichen*b.netto),0) s FROM beleg b JOIN belegart ba ON ba.code=b.belegart
                           WHERE b.status='verarbeitet' AND b.belegart IN ('RE','GS') AND substr(b.datum,1,7)=?""", (monat,)).fetchone()["s"]
    jahr = db.execute("""SELECT COALESCE(SUM(ba.vorzeichen*b.netto),0) s FROM beleg b JOIN belegart ba ON ba.code=b.belegart
                         WHERE b.status='verarbeitet' AND b.belegart IN ('RE','GS') AND substr(b.datum,1,4)=?""", (h[:4],)).fetchone()["s"]
    deb = db.execute("SELECT COALESCE(SUM(offen),0) s, COALESCE(SUM(CASE WHEN faellig<? THEN offen END),0) u FROM offener_posten WHERE art='debitor'", (h,)).fetchone()
    kred = db.execute("SELECT COALESCE(SUM(offen),0) s, COALESCE(SUM(CASE WHEN faellig<? THEN offen END),0) u FROM offener_posten WHERE art='kreditor'", (h,)).fetchone()
    entwuerfe = db.execute("SELECT COUNT(*) c FROM beleg WHERE status='entwurf'").fetchone()["c"]
    melde = zeilen(db.execute("""SELECT a.id,a.artikelnr,a.kurz,a.meldebestand,
                                 (SELECT COALESCE(SUM(menge),0) FROM lagerbewegung WHERE artikel_id=a.id) bestand
                                 FROM artikel a WHERE a.lagerfuehrung=1 AND a.meldebestand>0""" ))
    melde = [m for m in melde if m["bestand"] <= m["meldebestand"]]
    projekte = projekte_liste(db)
    kritisch = []
    for p in projekte:
        if p["status"] == "abgeschlossen":
            continue
        for m in projekt_lesen(db, p["id"])["meilensteine"]:
            if m["status"] in ("over", "risk"):
                kritisch.append(dict(projekt_id=p["id"], projektnr=p["projektnr"], titel=m["titel"], status=m["status"],
                                     status_text=m["status_text"], plan_ende=m["plan_ende"]))
    diagramme = diagrammdaten(db)
    meldungen = zeilen(db.execute("""SELECT v.zeit, v.benutzer, v.text, p.id projekt_id, p.projektnr FROM projekt_verlauf v JOIN projekt p ON p.id=v.projekt_id
                                     WHERE v.text LIKE ? ORDER BY v.id DESC LIMIT 8""", (WERKSTATT_PREFIX + "%",)))
    return dict(diagramme=diagramme, werkstatt_meldungen=meldungen, umsatz_monat=umsatz, umsatz_jahr=jahr, op_debitor=deb["s"], op_debitor_ueber=deb["u"],
                op_kreditor=kred["s"], op_kreditor_ueber=kred["u"], entwuerfe=entwuerfe, meldebestand=melde,
                projekte=projekte, kritisch=kritisch)
