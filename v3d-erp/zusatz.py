"""Kundenpreise (Preis je Kunde/Artikel mit Staffel) und Kennzeichen (eigene Zusatzfelder)."""
import re

import erp
from erp import Fehler, heute, transaktion, zeile, zeilen


# ================================================================ Kundenpreise
def kundenpreise(db, adresse_id=None, artikel_id=None):
    sql = """SELECT kp.*, a.kurz kunde_kurz, k.kundennr, ar.artikelnr, ar.kurz artikel_kurz, ar.me, ar.vk_preis
             FROM kundenpreis kp JOIN adresse a ON a.id=kp.adresse_id LEFT JOIN kunde k ON k.adresse_id=a.id JOIN artikel ar ON ar.id=kp.artikel_id WHERE 1=1"""
    par = []
    if adresse_id:
        sql += " AND kp.adresse_id=?"
        par.append(adresse_id)
    if artikel_id:
        sql += " AND kp.artikel_id=?"
        par.append(artikel_id)
    return zeilen(db.execute(sql + " ORDER BY a.kurz, ar.artikelnr, kp.ab_menge", par))


def kundenpreis_speichern(db, d, benutzer=None):
    if not d.get("adresse_id") or not d.get("artikel_id"):
        raise Fehler("Kunde und Artikel angeben.")
    preis = float(d.get("preis") or 0)
    if preis < 0:
        raise Fehler("Preis darf nicht negativ sein.")
    ab = float(d.get("ab_menge") or 1)
    if ab <= 0:
        raise Fehler("„Ab Menge“ muss größer 0 sein.")
    werte = (d["adresse_id"], d["artikel_id"], ab, preis, d.get("gueltig_ab") or None, d.get("gueltig_bis") or None, d.get("bemerkung") or None)
    with transaktion(db):
        if d.get("id"):
            db.execute("""UPDATE kundenpreis SET adresse_id=?, artikel_id=?, ab_menge=?, preis=?, gueltig_ab=?, gueltig_bis=?, bemerkung=? WHERE id=?""",
                       werte + (d["id"],))
            kid = d["id"]
        else:
            kid = db.execute("INSERT INTO kundenpreis(adresse_id,artikel_id,ab_menge,preis,gueltig_ab,gueltig_bis,bemerkung) VALUES(?,?,?,?,?,?,?)", werte).lastrowid
        erp.protokoll(db, benutzer, "kundenpreis", kid, "gespeichert", {"preis": preis, "ab": ab})
    return zeile(db.execute("SELECT * FROM kundenpreis WHERE id=?", (kid,)))


def kundenpreis_loeschen(db, kid, benutzer=None):
    with transaktion(db):
        db.execute("DELETE FROM kundenpreis WHERE id=?", (kid,))
        erp.protokoll(db, benutzer, "kundenpreis", kid, "gelöscht")


def preis_finden(db, adresse_id, artikel_id, menge=1, datum=None):
    """Preisfindung: gültiger Kundenpreis (höchste passende Staffel) vor Listenpreis mit Kundenrabatt."""
    datum = datum or heute()
    a = db.execute("SELECT vk_preis FROM artikel WHERE id=?", (artikel_id,)).fetchone()
    if not a:
        raise Fehler("Artikel nicht gefunden.")
    kp = db.execute("""SELECT preis, ab_menge FROM kundenpreis WHERE adresse_id=? AND artikel_id=? AND ab_menge<=?
                       AND (gueltig_ab IS NULL OR gueltig_ab<=?) AND (gueltig_bis IS NULL OR gueltig_bis>=?)
                       ORDER BY ab_menge DESC LIMIT 1""", (adresse_id, artikel_id, float(menge or 1), datum, datum)).fetchone()
    if kp:
        return dict(preis=kp["preis"], rabatt_pct=0, quelle=f"Kundenpreis ab {kp['ab_menge']:g}")
    k = db.execute("SELECT rabatt_pct FROM kunde WHERE adresse_id=?", (adresse_id,)).fetchone()
    return dict(preis=a["vk_preis"], rabatt_pct=(k["rabatt_pct"] if k else 0) or 0, quelle="Listenpreis")


# ================================================================ Kennzeichen
TYPEN = ("text", "zahl", "datum", "janein", "auswahl")
OBJEKTE = ("adresse", "artikel")


def kz_defs(db, objekt):
    if objekt not in OBJEKTE:
        raise Fehler("Unbekanntes Objekt.")
    return zeilen(db.execute("SELECT * FROM kennzeichen_def WHERE objekt=? ORDER BY reihenfolge, id", (objekt,)))


def kz_defs_speichern(db, objekt, liste, benutzer=None):
    if objekt not in OBJEKTE:
        raise Fehler("Unbekanntes Objekt.")
    namen = [(d.get("name") or "").strip() for d in liste]
    if any(not n for n in namen):
        raise Fehler("Jedes Kennzeichen braucht einen Namen.")
    if len(set(n.lower() for n in namen)) != len(namen):
        raise Fehler("Namen doppelt vergeben.")
    with transaktion(db):
        bleiben = []
        for i, d in enumerate(liste):
            typ = d.get("typ") if d.get("typ") in TYPEN else "text"
            opt = "; ".join(x.strip() for x in (d.get("optionen") or "").split(";") if x.strip()) or None
            if typ == "auswahl" and not opt:
                raise Fehler(f"„{d['name']}“: Bitte Auswahlwerte mit ; getrennt angeben.")
            if d.get("id"):
                db.execute("UPDATE kennzeichen_def SET name=?, typ=?, optionen=?, reihenfolge=? WHERE id=? AND objekt=?", (d["name"].strip(), typ, opt, i, d["id"], objekt))
                bleiben.append(int(d["id"]))
            else:
                bleiben.append(db.execute("INSERT INTO kennzeichen_def(objekt,name,typ,optionen,reihenfolge) VALUES(?,?,?,?,?)",
                                          (objekt, d["name"].strip(), typ, opt, i)).lastrowid)
        alt = [r["id"] for r in db.execute("SELECT id FROM kennzeichen_def WHERE objekt=?", (objekt,))]
        for x in set(alt) - set(bleiben):
            db.execute("DELETE FROM kennzeichen_wert WHERE def_id=?", (x,))
            db.execute("DELETE FROM kennzeichen_def WHERE id=?", (x,))
        erp.protokoll(db, benutzer, "kennzeichen_def", None, "geändert", {"objekt": objekt, "anzahl": len(liste)})
    return kz_defs(db, objekt)


def kz_werte(db, objekt, objekt_id):
    defs = kz_defs(db, objekt)
    w = {r["def_id"]: r["wert"] for r in db.execute("""SELECT kw.def_id, kw.wert FROM kennzeichen_wert kw JOIN kennzeichen_def d ON d.id=kw.def_id
                                                       WHERE d.objekt=? AND kw.objekt_id=?""", (objekt, objekt_id))}
    for d in defs:
        d["wert"] = w.get(d["id"])
    return defs


def _pruefen(d, wert):
    if wert in (None, ""):
        return None
    wert = str(wert).strip()
    if d["typ"] == "zahl":
        try:
            float(wert.replace(".", "").replace(",", ".") if re.search(r",\d+$", wert) else wert)
        except ValueError:
            raise Fehler(f"„{d['name']}“ muss eine Zahl sein.")
    elif d["typ"] == "datum" and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", wert):
        raise Fehler(f"„{d['name']}“ muss ein Datum sein.")
    elif d["typ"] == "janein":
        wert = "1" if wert.lower() in ("1", "true", "ja", "on") else "0"
    elif d["typ"] == "auswahl" and wert not in [x.strip() for x in (d["optionen"] or "").split(";")]:
        raise Fehler(f"„{d['name']}“: unzulässiger Wert.")
    return wert[:500]


def kz_werte_speichern(db, objekt, objekt_id, werte, benutzer=None):
    defs = {d["id"]: d for d in kz_defs(db, objekt)}
    with transaktion(db):
        for k, v in (werte or {}).items():
            d = defs.get(int(k))
            if not d:
                continue
            v = _pruefen(d, v)
            if v is None:
                db.execute("DELETE FROM kennzeichen_wert WHERE def_id=? AND objekt_id=?", (d["id"], objekt_id))
            else:
                db.execute("INSERT INTO kennzeichen_wert(def_id,objekt_id,wert) VALUES(?,?,?) ON CONFLICT(def_id,objekt_id) DO UPDATE SET wert=excluded.wert",
                           (d["id"], objekt_id, v))
        erp.protokoll(db, benutzer, objekt, objekt_id, "Kennzeichen")
    return kz_werte(db, objekt, objekt_id)


def kz_filter(db, objekt, def_id, wert):
    """IDs der Objekte, deren Kennzeichen passt (Text: enthält, sonst gleich)."""
    d = zeile(db.execute("SELECT * FROM kennzeichen_def WHERE id=? AND objekt=?", (def_id, objekt)))
    if not d:
        raise Fehler("Kennzeichen nicht gefunden.")
    if d["typ"] == "text":
        q = db.execute("SELECT objekt_id FROM kennzeichen_wert WHERE def_id=? AND lower(wert) LIKE ?", (def_id, f"%{(wert or '').lower()}%"))
    elif d["typ"] == "janein":
        w = _pruefen(d, wert) or "0"
        q = db.execute("SELECT objekt_id FROM kennzeichen_wert WHERE def_id=? AND wert=?", (def_id, w)) if w == "1" else \
            db.execute(f"SELECT id objekt_id FROM {objekt} WHERE id NOT IN (SELECT objekt_id FROM kennzeichen_wert WHERE def_id=? AND wert='1')", (def_id,))
    else:
        q = db.execute("SELECT objekt_id FROM kennzeichen_wert WHERE def_id=? AND wert=?", (def_id, str(wert)))
    return [r["objekt_id"] for r in q]
