"""Archiv: unveränderbare Originale verarbeiteter Belege (GoBD).

Beim Verarbeiten wird das PDF – bei Rechnung/Gutschrift als ZUGFeRD mit eingebetteter E-Rechnung, dazu die
XRechnung – genau einmal erzeugt, schreibgeschützt abgelegt und mit SHA-256 in `beleg_archiv` vermerkt.
Spätere Änderungen an Briefpapier, Formular oder Firmendaten wirken sich auf archivierte Belege nicht aus:
ausgeliefert wird immer die Archivdatei, deren Prüfsumme vorher kontrolliert wird.
Ändert sich nachträglich etwas Erlaubtes (Verpackung am Lieferschein), entsteht eine neue Version; alte bleiben.
"""
import datetime as _dt
import hashlib
import os
import re

import erp
from erp import Fehler, jetzt, transaktion, zeile, zeilen


def _schreiben(rel, daten):
    pfad = os.path.join(erp.ARCHIV_ORDNER, rel)
    os.makedirs(os.path.dirname(pfad), exist_ok=True)
    if os.path.exists(pfad):
        raise Fehler(f"Archivdatei {rel} existiert schon.")
    with open(pfad, "xb") as f:
        f.write(daten)
    os.chmod(pfad, 0o444)
    return hashlib.sha256(daten).hexdigest()


def archivieren(db, bid, benutzer=None, anlass="verarbeitet"):
    """Neue Archiv-Version eines verarbeiteten Belegs anlegen."""
    import bericht
    import erechnung
    if not erp.ARCHIV_ORDNER:
        raise Fehler("Kein Archiv-Ordner eingestellt.")
    b = zeile(db.execute("SELECT id, belegart, nummer, status, datum FROM beleg WHERE id=?", (bid,)))
    if not b or b["status"] != "verarbeitet":
        raise Fehler("Archiviert werden nur verarbeitete Belege.")
    version = (db.execute("SELECT MAX(version) v FROM beleg_archiv WHERE beleg_id=?", (bid,)).fetchone()["v"] or 0) + 1
    dateien, hinweis, mit_er = [], None, False
    if b["belegart"] in ("RE", "GS"):
        try:
            pdf, _ = erechnung.zugferd(db, bid)
            xml, _ = erechnung.xrechnung(db, bid)
            dateien = [("pdf", "pdf", pdf), ("xrechnung", "xml", xml if isinstance(xml, bytes) else xml.encode())]
            mit_er = True
        except Fehler as e:
            hinweis = f"ohne E-Rechnung archiviert: {e}"
    if not dateien:
        pdf, _ = bericht.beleg_pdf(db, bid)
        dateien = [("pdf", "pdf", pdf)]
    sicher = re.sub(r"[^A-Za-z0-9_.-]", "_", b["nummer"] or f"beleg{bid}")
    jahr = (b["datum"] or erp.heute())[:4]
    with transaktion(db):
        for art, endung, daten in dateien:
            rel = f"{jahr}/{b['belegart']}/{sicher}_v{version}.{endung}"
            sha = _schreiben(rel, daten)
            db.execute("""INSERT INTO beleg_archiv(beleg_id,version,art,datei,sha256,groesse,erstellt,benutzer,anlass)
                          VALUES(?,?,?,?,?,?,?,?,?)""", (bid, version, art, rel, sha, len(daten), jetzt(), benutzer, anlass))
        erp.protokoll(db, benutzer, "beleg", bid, "archiviert", {"version": version, "anlass": anlass, "erechnung": mit_er})
    return {"version": version, "erechnung": mit_er, "hinweis": hinweis}


def holen(db, bid, art="pdf", benutzer=None):
    """Archivdatei (neueste Version) liefern – mit Prüfsummenkontrolle. Fehlt sie bei einem verarbeiteten Beleg
    (vor Einführung des Archivs verarbeitet), wird sie jetzt einmalig erzeugt."""
    r = zeile(db.execute("SELECT * FROM beleg_archiv WHERE beleg_id=? AND art=? ORDER BY version DESC LIMIT 1", (bid, art)))
    if not r:
        st = db.execute("SELECT status FROM beleg WHERE id=?", (bid,)).fetchone()
        if not st or st["status"] != "verarbeitet" or not erp.ARCHIV_ORDNER:
            return None
        if db.execute("SELECT 1 FROM beleg_archiv WHERE beleg_id=?", (bid,)).fetchone():
            return None                                 # archiviert, aber diese Art gibt es nicht (z. B. XRechnung fehlte)
        archivieren(db, bid, benutzer, "nachträglich archiviert")
        r = zeile(db.execute("SELECT * FROM beleg_archiv WHERE beleg_id=? AND art=? ORDER BY version DESC LIMIT 1", (bid, art)))
        if not r:
            return None
    pfad = os.path.join(erp.ARCHIV_ORDNER, r["datei"])
    with open(pfad, "rb") as f:
        daten = f.read()
    if hashlib.sha256(daten).hexdigest() != r["sha256"]:
        raise Fehler(f"Archivdatei {r['datei']} wurde verändert (Prüfsumme stimmt nicht) – bitte Administrator informieren.")
    return daten, r


def versionen(db, bid):
    return zeilen(db.execute("SELECT id, version, art, erstellt, benutzer, anlass, sha256, groesse FROM beleg_archiv WHERE beleg_id=? ORDER BY version, art", (bid,)))


def datei(db, aid):
    r = zeile(db.execute("SELECT * FROM beleg_archiv WHERE id=?", (aid,)))
    if not r:
        raise Fehler("Archivdatei nicht gefunden.")
    with open(os.path.join(erp.ARCHIV_ORDNER, r["datei"]), "rb") as f:
        daten = f.read()
    if hashlib.sha256(daten).hexdigest() != r["sha256"]:
        raise Fehler("Archivdatei wurde verändert (Prüfsumme stimmt nicht).")
    return daten, r


def pruefen(db):
    """Alle Archivdateien gegen ihre Prüfsumme prüfen (für die Datensicherung / Betriebsprüfung)."""
    fehler = []
    n = 0
    for r in db.execute("SELECT * FROM beleg_archiv"):
        n += 1
        pfad = os.path.join(erp.ARCHIV_ORDNER, r["datei"])
        try:
            with open(pfad, "rb") as f:
                if hashlib.sha256(f.read()).hexdigest() != r["sha256"]:
                    fehler.append(f"{r['datei']}: Prüfsumme falsch")
        except OSError as e:
            fehler.append(f"{r['datei']}: {e}")
    return {"geprueft": n, "fehler": fehler, "zeit": _dt.datetime.now().isoformat(timespec="seconds")}
