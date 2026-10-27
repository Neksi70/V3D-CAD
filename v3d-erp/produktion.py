"""Produktion: Rückmeldung je Palette/Charge – Start, Pause, Ende mit Gut-/Ausschussmenge.
Ausschuss wird beim Beenden auf die Charge gebucht (Kundenmaterial), damit Lieferung und Rückverfolgung stimmen."""
import datetime as _dt

import erp
from erp import Fehler, jetzt, transaktion, zeile, zeilen


def _liste(text):
    return [x.strip() for x in (text or "").split(";") if x.strip()]


def arbeitsgaenge(db, artikel_id=None):
    """Arbeitsplan des Artikels, sonst die allgemeine Liste aus den Einstellungen."""
    if artikel_id:
        a = db.execute("SELECT arbeitsplan FROM artikel WHERE id=?", (artikel_id,)).fetchone()
        if a and _liste(a["arbeitsplan"]):
            return _liste(a["arbeitsplan"])
    return _liste(erp.einstellungen(db).get("arbeitsgaenge")) or ["Bearbeitung"]


def grundlagen(db):
    e = erp.einstellungen(db)
    return {"arbeitsgaenge": _liste(e.get("arbeitsgaenge")) or ["Bearbeitung"], "maschinen": _liste(e.get("maschinen"))}


def _minuten(f, bis=None):
    """Laufzeit ohne Pausen in Minuten."""
    start = _dt.datetime.fromisoformat(f["start"])
    ende = _dt.datetime.fromisoformat(bis or f["ende"] or f["pause_seit"] or jetzt())
    return max(0.0, round((ende - start).total_seconds() / 60 - (f["pause_min"] or 0), 1))


SELECT = """SELECT f.*, c.chargennr, c.adresse_id, c.artikel_id, a.kurz kunde_kurz, ar.artikelnr, ar.kurz artikel_kurz, ar.me,
                   b.projekt_id, p.projektnr
            FROM fertigung f JOIN charge c ON c.id=f.charge_id JOIN adresse a ON a.id=c.adresse_id
            LEFT JOIN artikel ar ON ar.id=c.artikel_id LEFT JOIN beleg b ON b.id=c.eingang_beleg_id LEFT JOIN projekt p ON p.id=b.projekt_id"""


def _aufbereiten(l, db=None):
    plaene = {}
    for f in l:
        if db is not None:
            if f["artikel_id"] not in plaene:
                plaene[f["artikel_id"]] = arbeitsgaenge(db, f["artikel_id"])
            f["letzter_gang"] = plaene[f["artikel_id"]][-1] == f["arbeitsgang"]
        f["minuten"] = _minuten(f)
        f["status"] = "fertig" if f["ende"] else ("pause" if f["pause_seit"] else "laeuft")
    return l


def lesen(db, fid):
    f = zeile(db.execute(SELECT + " WHERE f.id=?", (fid,)))
    if not f:
        raise Fehler("Rückmeldung nicht gefunden.")
    return _aufbereiten([f], db)[0]


def starten(db, d, benutzer=None):
    cid = int(d.get("charge_id") or 0)
    c = zeile(db.execute("SELECT * FROM charge WHERE id=?", (cid,)))
    if not c:
        raise Fehler("Bitte eine Charge wählen.")
    ag = (d.get("arbeitsgang") or "").strip()
    if not ag:
        raise Fehler("Bitte den Arbeitsgang wählen.")
    palette = (d.get("palette") or "").strip()[:40] or None
    menge = float(d["menge_plan"]) if d.get("menge_plan") not in (None, "") else None
    if menge is not None and menge <= 0:
        raise Fehler("Menge muss größer 0 sein.")
    with transaktion(db):
        doppelt = db.execute("""SELECT id FROM fertigung WHERE charge_id=? AND arbeitsgang=? AND palette IS ? AND ende IS NULL""",
                             (cid, ag, palette)).fetchone()
        if doppelt:
            raise Fehler(f"{ag} für diese Charge{' / Palette ' + palette if palette else ''} läuft bereits.")
        fid = db.execute("""INSERT INTO fertigung(charge_id,palette,arbeitsgang,maschine,mitarbeiter,menge_plan,start,bemerkung,benutzer)
                            VALUES(?,?,?,?,?,?,?,?,?)""",
                         (cid, palette, ag, (d.get("maschine") or "").strip() or None, (d.get("mitarbeiter") or "").strip()[:60] or None,
                          menge, jetzt(), (d.get("bemerkung") or "").strip()[:500] or None, benutzer)).lastrowid
        erp.protokoll(db, benutzer, "fertigung", fid, "gestartet", {"charge": c["chargennr"], "ag": ag, "palette": palette})
    return lesen(db, fid)


def pause(db, fid, an=True, benutzer=None):
    f = lesen(db, fid)
    if f["ende"]:
        raise Fehler("Schon beendet.")
    with transaktion(db):
        if an and not f["pause_seit"]:
            db.execute("UPDATE fertigung SET pause_seit=? WHERE id=?", (jetzt(), fid))
        elif not an and f["pause_seit"]:
            dauer = (_dt.datetime.now() - _dt.datetime.fromisoformat(f["pause_seit"])).total_seconds() / 60
            db.execute("UPDATE fertigung SET pause_seit=NULL, pause_min=pause_min+? WHERE id=?", (round(dauer, 1), fid))
    return lesen(db, fid)


def beenden(db, fid, d, benutzer=None):
    f = lesen(db, fid)
    if f["ende"]:
        raise Fehler("Diese Rückmeldung ist schon beendet.")
    gut = float(d.get("menge_gut") or 0)
    aus = float(d.get("menge_ausschuss") or 0)
    if gut < 0 or aus < 0:
        raise Fehler("Mengen dürfen nicht negativ sein.")
    if gut + aus <= 0:
        raise Fehler("Bitte Gutmenge und/oder Ausschuss eintragen.")
    # Plausibilität: je Arbeitsgang nicht mehr melden, als von der Charge eingegangen ist (Tippfehler / falsche Charge)
    eingang = db.execute("SELECT COALESCE(SUM(menge),0) m FROM charge_bewegung WHERE charge_id=? AND art='eingang'", (f["charge_id"],)).fetchone()["m"]
    schon = db.execute("""SELECT COALESCE(SUM(COALESCE(menge_gut,0)+COALESCE(menge_ausschuss,0)),0) m FROM fertigung
                          WHERE charge_id=? AND arbeitsgang=? AND ende IS NOT NULL AND id<>?""", (f["charge_id"], f["arbeitsgang"], fid)).fetchone()["m"]
    if schon + gut + aus > eingang + 1e-9:
        raise Fehler(f"Charge {f['chargennr']} hat {eingang:,.0f} Stück; für „{f['arbeitsgang']}“ sind schon {schon:,.0f} gemeldet – "
                     f"zusammen mit {gut + aus:,.0f} wäre das zu viel. Falsche Charge oder Tippfehler?".replace(",", "."))
    if "freigabe" in d:
        freigabe = 1 if d.get("freigabe") else 0
    else:                       # ohne Angabe: der letzte Arbeitsgang des Arbeitsplans gibt für den Versand frei
        freigabe = 1 if arbeitsgaenge(db, f["artikel_id"])[-1] == f["arbeitsgang"] else 0
    with transaktion(db):
        ende = jetzt()
        pmin = f["pause_min"] or 0
        if f["pause_seit"]:
            pmin += (_dt.datetime.fromisoformat(ende) - _dt.datetime.fromisoformat(f["pause_seit"])).total_seconds() / 60
        bem = " · ".join(x for x in [f["bemerkung"], (d.get("bemerkung") or "").strip()[:500]] if x) or None
        db.execute("""UPDATE fertigung SET ende=?, pause_seit=NULL, pause_min=?, menge_gut=?, menge_ausschuss=?, bemerkung=?, freigabe=? WHERE id=?""",
                   (ende, round(pmin, 1), gut, aus, bem, freigabe, fid))
        if aus > 0:
            if aus > erp.charge_rest(db, f["charge_id"]) + 1e-9:
                raise Fehler("Mehr Ausschuss als Kundenmaterial der Charge im Haus ist.")
            grund = (d.get("grund") or "").strip()[:200]
            db.execute("INSERT INTO charge_bewegung(charge_id,datum,art,menge,text,benutzer) VALUES(?,?,?,?,?,?)",
                       (f["charge_id"], erp.heute(), "ausschuss", -aus,
                        f"Ausschuss {f['arbeitsgang']}{' Palette ' + f['palette'] if f['palette'] else ''}" + (f": {grund}" if grund else ""), benutzer))
        erp.protokoll(db, benutzer, "fertigung", fid, "beendet", {"gut": gut, "ausschuss": aus, "freigabe": freigabe})
    return lesen(db, fid)


def freigeben(db, fid, an=True, benutzer=None):
    """Gutmenge einer beendeten Rückmeldung nachträglich für den Versand freigeben (oder zurücknehmen)."""
    f = lesen(db, fid)
    if not f["ende"]:
        raise Fehler("Erst fertig melden, dann freigeben.")
    if not an:
        verplant = -db.execute("SELECT COALESCE(SUM(menge),0) m FROM charge_bewegung WHERE charge_id=? AND art='lieferung'", (f["charge_id"],)).fetchone()["m"]
        frei_rest = db.execute("SELECT COALESCE(SUM(menge_gut),0) m FROM fertigung WHERE charge_id=? AND freigabe=1 AND id<>?", (f["charge_id"], fid)).fetchone()["m"]
        if verplant > frei_rest + 1e-9:
            raise Fehler("Davon ist schon etwas geliefert – Freigabe kann nicht zurückgenommen werden.")
    with transaktion(db):
        db.execute("UPDATE fertigung SET freigabe=? WHERE id=?", (1 if an else 0, fid))
        erp.protokoll(db, benutzer, "fertigung", fid, "freigegeben" if an else "Freigabe zurückgenommen")
    return lesen(db, fid)


def zuruecknehmen(db, fid, benutzer=None):
    """Versehentlich beendet → wieder laufend; gebuchter Ausschuss wird storniert."""
    f = lesen(db, fid)
    if not f["ende"]:
        raise Fehler("Läuft noch.")
    with transaktion(db):
        if f["menge_ausschuss"]:
            db.execute("INSERT INTO charge_bewegung(charge_id,datum,art,menge,text,benutzer) VALUES(?,?,?,?,?,?)",
                       (f["charge_id"], erp.heute(), "korrektur", f["menge_ausschuss"], f"Storno Ausschuss {f['arbeitsgang']} (Rückmeldung zurückgenommen)", benutzer))
        if f.get("freigabe"):
            verplant = -db.execute("SELECT COALESCE(SUM(menge),0) m FROM charge_bewegung WHERE charge_id=? AND art='lieferung'", (f["charge_id"],)).fetchone()["m"]
            frei_rest = db.execute("SELECT COALESCE(SUM(menge_gut),0) m FROM fertigung WHERE charge_id=? AND freigabe=1 AND id<>?", (f["charge_id"], fid)).fetchone()["m"]
            if verplant > frei_rest + 1e-9 and erp.nur_freigegeben(db):
                raise Fehler("Davon ist schon etwas geliefert – Rückmeldung kann nicht zurückgenommen werden.")
        db.execute("UPDATE fertigung SET ende=NULL, menge_gut=NULL, menge_ausschuss=NULL, freigabe=0 WHERE id=?", (fid,))
        erp.protokoll(db, benutzer, "fertigung", fid, "zurückgenommen")
    return lesen(db, fid)


def loeschen(db, fid, benutzer=None):
    f = lesen(db, fid)
    if f["ende"]:
        raise Fehler("Beendete Rückmeldungen erst zurücknehmen.")
    with transaktion(db):
        db.execute("DELETE FROM fertigung WHERE id=?", (fid,))
        erp.protokoll(db, benutzer, "fertigung", fid, "gelöscht (Fehlstart)")
    return {"ok": True}


def liste(db, charge_id=None, projekt_id=None, von=None, laufend=False, limit=300):
    sql, par = SELECT + " WHERE 1=1", []
    if charge_id:
        sql += " AND f.charge_id=?"
        par.append(charge_id)
    if projekt_id:
        sql += " AND b.projekt_id=?"
        par.append(projekt_id)
    if laufend:
        sql += " AND f.ende IS NULL"
    if von:
        sql += " AND (f.ende IS NULL OR f.ende>=?)"
        par.append(von)
    return _aufbereiten(zeilen(db.execute(sql + f" ORDER BY f.ende IS NOT NULL, f.ende DESC, f.start DESC LIMIT {int(limit)}", par)), db)


def fortschritt(db, charge_ids=None, nur_offen=True):
    """Je Charge: Eingang und je Arbeitsgang gut/Ausschuss/laufend – Grundlage für Büro-Übersicht und Kunden-PDF."""
    chargen = erp.chargen_liste(db, nur_offen=False)
    if charge_ids is not None:
        chargen = [c for c in chargen if c["id"] in set(charge_ids)]
    summen = {}
    for r in db.execute("""SELECT charge_id, arbeitsgang, COALESCE(SUM(menge_gut),0) gut, COALESCE(SUM(menge_ausschuss),0) aus,
                                  SUM(ende IS NULL) laufend, MIN(start) erster, MAX(ende) letzter
                           FROM fertigung GROUP BY charge_id, arbeitsgang"""):
        summen.setdefault(r["charge_id"], {})[r["arbeitsgang"]] = dict(r)
    out = []
    for c in chargen:
        s = summen.get(c["id"], {})
        if nur_offen and charge_ids is None and c["rest"] <= 1e-9 and not any(x["laufend"] for x in s.values()):
            continue
        plan = arbeitsgaenge(db, c["artikel_id"])
        schritte, verlust = [], 0.0          # Ausschuss früherer Arbeitsgänge kommt beim nächsten nicht mehr an
        for ag in plan + [x for x in s if x not in plan]:
            x = s.get(ag, {})
            gut, aus = x.get("gut", 0), x.get("aus", 0)
            soll = max(0.0, c["eingang"] - verlust)
            schritte.append(dict(arbeitsgang=ag, gut=gut, ausschuss=aus, laufend=x.get("laufend", 0) or 0, soll=soll,
                                 erster=x.get("erster"), letzter=x.get("letzter"),
                                 pct=min(100, round(100 * (gut + aus) / soll)) if soll else 100,
                                 fertig=bool(soll) and gut + aus >= soll - 1e-9 and not x.get("laufend")))
            verlust += aus
        if not s and charge_ids is None and c["geliefert"] >= c["eingang"] - 1e-9:
            continue
        frei = db.execute("SELECT COALESCE(SUM(menge_gut),0) m FROM fertigung WHERE charge_id=? AND freigabe=1 AND ende IS NOT NULL", (c["id"],)).fetchone()["m"]
        ziel = c["eingang"] - c["ausschuss"]
        naechster = next((x["arbeitsgang"] for x in schritte if not x["fertig"]), None)
        if frei >= ziel - 1e-9 and ziel > 0:
            status, text = "freigegeben", "komplett für den Versand freigegeben"
        elif all(x["fertig"] for x in schritte) and s:
            status, text = "fertig", "alle Arbeitsgänge fertig"
        elif frei > 0:
            status, text = "teilweise frei", f"{frei:,.0f} freigegeben".replace(",", ".") + (f" · als Nächstes: {naechster}" if naechster else "")
        elif s:
            status, text = "in Arbeit", " · ".join([x["arbeitsgang"] + " ✓" for x in schritte if x["fertig"]] + ([f"als Nächstes: {naechster}"] if naechster else []))
        else:
            status, text = "wartet", f"als Nächstes: {naechster}" if naechster else ""
        out.append(dict(charge_id=c["id"], chargennr=c["chargennr"], kunde_kurz=c["kunde_kurz"], artikelnr=c["artikelnr"], artikel_kurz=c["artikel_kurz"],
                        eingang=c["eingang"], geliefert=c["geliefert"], ausschuss=c["ausschuss"], rest=c["rest"], datum=c["datum"],
                        freigegeben=frei, lieferbar=erp.charge_lieferbar(db, c["id"]) if erp.nur_freigegeben(db) else None,
                        status=status, status_text=text, naechster=naechster, schritte=schritte))
    return out


def chargen_fuer_projekt(db, projekt_id):
    return [r["id"] for r in db.execute("""SELECT c.id FROM charge c JOIN beleg b ON b.id=c.eingang_beleg_id WHERE b.projekt_id=? ORDER BY c.datum, c.id""",
                                        (projekt_id,))]


def charge_suchen(db, text):
    """Für Tablet/Scanner: exakte Chargennummer zuerst, sonst Teiltreffer bei offenen Chargen."""
    text = (text or "").strip()
    l = erp.chargen_liste(db, suche=text, nur_offen=True) if text else erp.chargen_liste(db, nur_offen=True)
    exakt = [c for c in l if c["chargennr"].lower() == text.lower()]
    l = exakt + [c for c in l if c not in exakt]
    return [dict(id=c["id"], chargennr=c["chargennr"], kunde_kurz=c["kunde_kurz"], artikelnr=c["artikelnr"], artikel_kurz=c["artikel_kurz"],
                 rest=c["rest"], eingang=c["eingang"], arbeitsgaenge=arbeitsgaenge(db, c["artikel_id"])) for c in l[:30]]
