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
                         ("offener_posten", "mahnsperre", "INTEGER NOT NULL DEFAULT 0")]:
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
                 "kopftext_vk", "fusstext_vk", "kopftext_ek", "fusstext_ek", "farbe_haupt", "farbe_akzent", "betriebsstaette"]
STANDARD_EINSTELLUNGEN = dict(
    firma_name="Muster Fertigung GmbH", firma_zusatz="Sondermaschinen · Vorrichtungen · Serienteile",
    strasse="Beispielstraße 1", plz="58089", ort="Hagen", telefon="02331 000000", email="info@muster-fertigung.example",
    web="www.muster-fertigung.example", ust_id="DE000000000", steuernr="", handelsregister="Amtsgericht Hagen HRB 0000",
    geschaeftsfuehrer="Max Mustermann", bank_name="Musterbank Hagen", iban="DE00 0000 0000 0000 0000 00", bic="MUSTDEXXX",
    logo="", kopftext_vk="Vielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen an:",
    fusstext_vk="Für Rückfragen stehen wir Ihnen gern zur Verfügung.", kopftext_ek="Wir bestellen zu den vereinbarten Bedingungen:",
    fusstext_ek="Bitte bestätigen Sie uns Liefertermin und Preis.",
    farbe_haupt="#004aad", farbe_akzent="#f39200", betriebsstaette="1 - Zentrale")


def einstellungen(db):
    werte = {r["schluessel"]: r["wert"] for r in db.execute("SELECT schluessel, wert FROM einstellung")}
    return {k: werte.get(k, STANDARD_EINSTELLUNGEN.get(k, "")) or "" for k in EINSTELLUNGEN}


def einstellungen_speichern(db, d, benutzer=None):
    logo = d.get("logo") or ""
    if logo and (not logo.startswith("data:image/") or len(logo) > 700_000):
        raise Fehler("Logo bitte als Bild (PNG/JPG/SVG) bis ca. 500 KB.")
    import re as _re
    for k in ("farbe_haupt", "farbe_akzent"):
        if d.get(k) and not _re.fullmatch(r"#[0-9a-fA-F]{6}", d[k]):
            raise Fehler("Farben bitte als #RRGGBB angeben.")
    with transaktion(db):
        for k in EINSTELLUNGEN:
            if k in d:
                db.execute("INSERT INTO einstellung(schluessel,wert) VALUES(?,?) ON CONFLICT(schluessel) DO UPDATE SET wert=excluded.wert",
                           (k, (d.get(k) or "").strip() if k != "logo" else logo))
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
def naechste_nummer(db, praefix, datum):
    jahr = int(datum[:4])
    r = db.execute("SELECT naechste FROM nummernkreis WHERE praefix=? AND jahr=?", (praefix, jahr)).fetchone()
    n = r["naechste"] if r else 1
    if r:
        db.execute("UPDATE nummernkreis SET naechste=? WHERE praefix=? AND jahr=?", (n + 1, praefix, jahr))
    else:
        db.execute("INSERT INTO nummernkreis(praefix,jahr,naechste) VALUES(?,?,?)", (praefix, jahr, n + 1))
    return f"{praefix}-{str(jahr)[2:]}-{n:04d}"


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
            db.execute("""INSERT INTO kunde(adresse_id,kundennr,zahlungsbed_id,rabatt_pct,kreditlimit,leitweg_id,liefersperre)
                          VALUES(?,?,?,?,?,?,?) ON CONFLICT(adresse_id) DO UPDATE SET kundennr=excluded.kundennr,
                          zahlungsbed_id=excluded.zahlungsbed_id, rabatt_pct=excluded.rabatt_pct, kreditlimit=excluded.kreditlimit,
                          leitweg_id=excluded.leitweg_id, liefersperre=excluded.liefersperre""",
                       (aid, nr, k.get("zahlungsbed_id"), k.get("rabatt_pct") or 0, k.get("kreditlimit"),
                        k.get("leitweg_id"), 1 if k.get("liefersperre") else 0))
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
                    k.kundennr, l.lieferantennr, k.zahlungsbed_id k_zb, k.rabatt_pct k_rabatt, l.zahlungsbed_id l_zb
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
                  "lagerfuehrung", "meldebestand", "hauptlieferant_id", "inaktiv", "memo", "kalk"]


def artikel_speichern(db, d, benutzer=None):
    if not (d.get("bezeichnung") or "").strip():
        raise Fehler("Bezeichnung fehlt.")
    d.setdefault("kurz", d["bezeichnung"][:30])
    with transaktion(db):
        if not d.get("artikelnr"):
            d["artikelnr"] = naechste_stammnr(db, "artikel", "artikelnr", 100000)
        werte = [d.get(f) for f in ARTIKEL_FELDER]
        if isinstance(d.get("kalk"), dict):
            werte[ARTIKEL_FELDER.index("kalk")] = json.dumps(d["kalk"])
        werte = [w if w is not None else dflt for w, dflt in zip(werte, [None, None, None, "Stk", None, 0, 0, 19, 1, 0, None, 0, None, None])]
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
    netto, steuer, brutto = _summen(pos)
    if not d.get("zahlungsbed_id"):            # Zahlungsbedingung des Kunden/Lieferanten vorbelegen
        zb = db.execute(f"SELECT zahlungsbed_id FROM {rolle} WHERE adresse_id=?", (d["adresse_id"],)).fetchone()
        d["zahlungsbed_id"] = zb["zahlungsbed_id"] if zb else None
    felder = dict(belegart=art["code"], datum=d.get("datum") or heute(), adresse_id=d["adresse_id"],
                  projekt_id=d.get("projekt_id") or None, betreff=d.get("betreff"), ihre_referenz=d.get("ihre_referenz"),
                  kopftext=d.get("kopftext"), fusstext=d.get("fusstext"), zahlungsbed_id=d.get("zahlungsbed_id") or None,
                  lager_id=d.get("lager_id") or 1, netto=netto, steuer=steuer, brutto=brutto, memo=d.get("memo"))
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
            db.execute("""INSERT INTO beleg_position(beleg_id,pos,artikel_id,text,menge,me,einzelpreis,rabatt_pct,steuer_pct,gesamt,vorgaenger_pos_id,charge_nr,charge_id)
                          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                       (bid, i, p.get("artikel_id") or None, p["text"], float(p["menge"]), p["me"], float(p["einzelpreis"]),
                        float(p.get("rabatt_pct") or 0), float(p["steuer_pct"]), p["gesamt"], p.get("vorgaenger_pos_id"),
                        (p.get("charge_nr") or "").strip() or None, p.get("charge_id") or None))
        protokoll(db, benutzer, "beleg", bid, "gespeichert")
    return beleg_lesen(db, bid)


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
    sql = """SELECT b.id,b.belegart,b.nummer,b.status,b.datum,b.betreff,b.netto,b.brutto,a.kurz adresse_kurz,
                    p.projektnr FROM beleg b JOIN belegart ba ON ba.code=b.belegart JOIN adresse a ON a.id=b.adresse_id
             LEFT JOIN projekt p ON p.id=b.projekt_id WHERE ba.bereich=?"""
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
        nummer = naechste_nummer(db, art["praefix"], b["datum"])
        db.execute("UPDATE beleg SET nummer=?, status='verarbeitet', verarbeitet=?, verarbeitet_von=? WHERE id=?",
                   (nummer, jetzt(), benutzer, bid))
        # Lager
        if art["lager"]:
            gebucht = 0
            for p in pos:
                a = db.execute("SELECT lagerfuehrung FROM artikel WHERE id=?", (p["artikel_id"],)).fetchone() if p["artikel_id"] else None
                if a and a["lagerfuehrung"]:
                    db.execute("INSERT INTO lagerbewegung(datum,artikel_id,lager_id,menge,beleg_id,text) VALUES(?,?,?,?,?,?)",
                               (b["datum"], p["artikel_id"], b["lager_id"] or 1, art["lager"] * p["menge"], bid, f"{art['name']} {nummer}"))
                    gebucht += 1
            if gebucht:
                meldungen.append("Lager gebucht")
            if art["lager"] < 0:
                for p in pos:
                    if p["artikel_id"]:
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
                if p["charge_id"]:
                    rest = charge_rest(db, p["charge_id"])
                    if p["menge"] > rest + 1e-9:
                        nr = db.execute("SELECT chargennr FROM charge WHERE id=?", (p["charge_id"],)).fetchone()["chargennr"]
                        raise Fehler(f"Charge {nr} hat nur noch {rest:g} – Position {p['pos']} will {p['menge']:g}.")
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
    return {"beleg": beleg_lesen(db, bid), "meldungen": meldungen}


def offene_menge(db, pos_id, zielart):
    """Menge einer Position, die noch nicht in Belege der Zielart übernommen wurde."""
    p = db.execute("SELECT menge FROM beleg_position WHERE id=?", (pos_id,)).fetchone()
    r = db.execute("""SELECT COALESCE(SUM(n.menge),0) m FROM beleg_position n JOIN beleg b ON b.id=n.beleg_id
                      WHERE n.vorgaenger_pos_id=? AND b.belegart=? AND b.status<>'storniert'""", (pos_id, zielart)).fetchone()
    return p["menge"] - r["m"]


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
                       rabatt_pct=p["rabatt_pct"], steuer_pct=p["steuer_pct"], vorgaenger_pos_id=p["id"],
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
    neu = beleg_speichern(db, dict(belegart=zielart, adresse_id=b["adresse_id"], projekt_id=b["projekt_id"], betreff=betreff,
                                   ihre_referenz=b["ihre_referenz"], zahlungsbed_id=b["zahlungsbed_id"], lager_id=b["lager_id"],
                                   kopftext=b["kopftext"], fusstext=b["fusstext"], positionen=pos), benutzer)
    with transaktion(db):
        db.execute("INSERT INTO beleg_verknuepfung(vorgaenger_id,nachfolger_id) VALUES(?,?)", (bid, neu["id"]))
    return beleg_lesen(db, neu["id"])


# ---------------------------------------------------------------- Chargen
def charge_rest(db, cid):
    return db.execute("SELECT COALESCE(SUM(menge),0) m FROM charge_bewegung WHERE charge_id=?", (cid,)).fetchone()["m"]


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
        rest = charge_rest(db, c["id"]) - db.execute("""SELECT COALESCE(SUM(p.menge),0) m FROM beleg_position p JOIN beleg b ON b.id=p.beleg_id
                                                         WHERE p.charge_id=? AND b.status='entwurf' AND b.belegart='LS'""", (c["id"],)).fetchone()["m"]
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
