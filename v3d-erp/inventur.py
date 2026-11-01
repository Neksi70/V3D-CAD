"""Inventur: eröffnen (Sollbestand zum Stichtag einfrieren) → zählen → abschließen (Differenzen ins Lager buchen) oder abbrechen.

Gezählt wird nur das eigene Lager (lagergeführte Artikel). Kundenmaterial läuft über Chargen und gehört dem Kunden.
Differenz = gezählt − Soll bei Eröffnung. Bewegungen nach der Eröffnung bleiben dadurch erhalten (Stichtagsinventur).
"""
import erp
from erp import Fehler, heute, jetzt, transaktion, zeile, zeilen


def liste(db):
    return zeilen(db.execute("""SELECT i.*, (SELECT COUNT(*) FROM inventur_position WHERE inventur_id=i.id) positionen,
                                (SELECT COUNT(*) FROM inventur_position WHERE inventur_id=i.id AND ist IS NOT NULL) gezaehlt
                                FROM inventur i ORDER BY i.id DESC"""))


def eroeffnen(db, bezeichnung, stichtag=None, gruppe=None, benutzer=None):
    bezeichnung = (bezeichnung or "").strip() or f"Inventur {(stichtag or heute())[:4]}"
    if db.execute("SELECT 1 FROM inventur WHERE status='offen'").fetchone():
        raise Fehler("Es gibt schon eine offene Inventur – erst abschließen oder abbrechen.")
    sql = "SELECT id, ek_preis FROM artikel WHERE lagerfuehrung=1 AND inaktiv=0"
    p = []
    if gruppe:
        sql += " AND gruppe=?"
        p.append(gruppe)
    artikel = zeilen(db.execute(sql + " ORDER BY artikelnr", p))
    if not artikel:
        raise Fehler("Keine lagergeführten Artikel" + (f" in der Gruppe „{gruppe}“" if gruppe else "") + ".")
    with transaktion(db):
        iid = db.execute("INSERT INTO inventur(bezeichnung,stichtag,filter_gruppe,eroeffnet,eroeffnet_von) VALUES(?,?,?,?,?)",
                         (bezeichnung[:80], stichtag or heute(), gruppe or None, jetzt(), benutzer)).lastrowid
        for a in artikel:
            db.execute("INSERT INTO inventur_position(inventur_id,artikel_id,soll,wert) VALUES(?,?,?,?)",
                       (iid, a["id"], erp.bestand(db, a["id"]), a["ek_preis"] or 0))
        erp.protokoll(db, benutzer, "inventur", iid, "eröffnet", {"artikel": len(artikel)})
    return lesen(db, iid)


def lesen(db, iid):
    i = zeile(db.execute("SELECT * FROM inventur WHERE id=?", (iid,)))
    if not i:
        raise Fehler("Inventur nicht gefunden.")
    i["positionen"] = zeilen(db.execute("""SELECT p.*, a.artikelnr, a.kurz, a.bezeichnung, a.me, a.gruppe FROM inventur_position p
                                          JOIN artikel a ON a.id=p.artikel_id WHERE p.inventur_id=? ORDER BY a.artikelnr""", (iid,)))
    diff = [p for p in i["positionen"] if p["ist"] is not None and abs(p["ist"] - p["soll"]) > 1e-9]
    i["summen"] = dict(positionen=len(i["positionen"]), gezaehlt=sum(1 for p in i["positionen"] if p["ist"] is not None),
                       differenzen=len(diff), wert_soll=round(sum(p["soll"] * p["wert"] for p in i["positionen"]), 2),
                       wert_ist=round(sum((p["ist"] if p["ist"] is not None else p["soll"]) * p["wert"] for p in i["positionen"]), 2),
                       wert_differenz=round(sum((p["ist"] - p["soll"]) * p["wert"] for p in diff), 2))
    return i


def _offen(db, iid):
    i = zeile(db.execute("SELECT * FROM inventur WHERE id=?", (iid,)))
    if not i:
        raise Fehler("Inventur nicht gefunden.")
    if i["status"] != "offen":
        raise Fehler("Die Inventur ist bereits " + ("abgeschlossen." if i["status"] == "abgeschlossen" else "abgebrochen."))
    return i


def zaehlen(db, iid, werte, benutzer=None):
    """werte: [{id (Position), ist (Zahl oder None = nicht gezählt), bemerkung}]"""
    with transaktion(db):
        _offen(db, iid)
        for w in werte or []:
            ist = w.get("ist")
            if ist in ("", None):
                ist = None
            else:
                try:
                    ist = float(ist)
                except (TypeError, ValueError):
                    raise Fehler("Gezählte Menge bitte als Zahl.")
                if ist < 0:
                    raise Fehler("Gezählte Menge kann nicht negativ sein.")
            n = db.execute("""UPDATE inventur_position SET ist=?, bemerkung=?, gezaehlt=?, gezaehlt_von=? WHERE id=? AND inventur_id=?""",
                           (ist, (w.get("bemerkung") or "").strip()[:200] or None, jetzt() if ist is not None else None,
                            benutzer if ist is not None else None, w.get("id"), iid)).rowcount
            if not n:
                raise Fehler("Position gehört nicht zu dieser Inventur.")
    return lesen(db, iid)


def abschliessen(db, iid, nicht_gezaehlt="soll", benutzer=None):
    """nicht_gezaehlt: 'soll' = Bestand bleibt wie im Soll, 'stopp' = Abschluss verweigern, solange etwas fehlt."""
    with transaktion(db):
        i = _offen(db, iid)
        pos = zeilen(db.execute("SELECT p.*, a.kurz FROM inventur_position p JOIN artikel a ON a.id=p.artikel_id WHERE inventur_id=?", (iid,)))
        fehlt = [p for p in pos if p["ist"] is None]
        if fehlt and nicht_gezaehlt == "stopp":
            raise Fehler(f"{len(fehlt)} Artikel sind noch nicht gezählt (z. B. {fehlt[0]['kurz']}).")
        gebucht = 0
        for p in pos:
            if p["ist"] is None:
                continue
            d = round(p["ist"] - p["soll"], 6)
            if abs(d) > 1e-9:
                db.execute("INSERT INTO lagerbewegung(datum,artikel_id,lager_id,menge,beleg_id,text) VALUES(?,?,?,?,?,?)",
                           (i["stichtag"], p["artikel_id"], i["lager_id"], d, None, f"Inventurdifferenz {i['bezeichnung']}"))
                gebucht += 1
        db.execute("UPDATE inventur SET status='abgeschlossen', abgeschlossen=?, abgeschlossen_von=? WHERE id=?", (jetzt(), benutzer, iid))
        erp.protokoll(db, benutzer, "inventur", iid, "abgeschlossen", {"differenzen": gebucht, "nicht_gezaehlt": len(fehlt)})
    erg = lesen(db, iid)
    erg["gebucht"] = gebucht
    return erg


def abbrechen(db, iid, benutzer=None):
    with transaktion(db):
        _offen(db, iid)
        db.execute("UPDATE inventur SET status='abgebrochen', abgeschlossen=?, abgeschlossen_von=? WHERE id=?", (jetzt(), benutzer, iid))
        erp.protokoll(db, benutzer, "inventur", iid, "abgebrochen")
    return lesen(db, iid)
