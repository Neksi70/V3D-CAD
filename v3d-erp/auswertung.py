"""Auswertungen: Liquiditätsplanung (Wochenvorschau aus offenen Posten + wiederkehrenden Zahlungen) und Umsatzauswertung."""
import datetime as _dt

import erp
from erp import Fehler, transaktion, zeilen

RHYTHMEN = {"einmalig": "einmalig", "woechentlich": "wöchentlich", "monatlich": "monatlich", "quartal": "vierteljährlich", "jaehrlich": "jährlich"}


def _plus_monate(d, n):
    y, m = divmod(d.year * 12 + d.month - 1 + n, 12)
    m += 1
    tag = min(d.day, [31, 29 if y % 4 == 0 and (y % 100 or y % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1])
    return _dt.date(y, m, tag)


def _termine(p, von, bis):
    """Fälligkeiten eines wiederkehrenden Postens im Zeitraum [von, bis]."""
    d = _dt.date.fromisoformat(p["erster"])
    ende = min(bis, _dt.date.fromisoformat(p["letzter"])) if p["letzter"] else bis
    schritt = {"einmalig": None, "woechentlich": "w", "monatlich": 1, "quartal": 3, "jaehrlich": 12}[p["rhythmus"]]
    i, out = 0, []
    while d <= ende and i < 2000:
        if d >= von:
            out.append(d)
        if schritt is None:
            break
        i += 1
        d = _dt.date.fromisoformat(p["erster"]) + _dt.timedelta(weeks=i) if schritt == "w" else _plus_monate(_dt.date.fromisoformat(p["erster"]), schritt * i)
    return out


def liq_posten(db):
    return zeilen(db.execute("SELECT * FROM liq_posten ORDER BY betrag DESC, text"))


def liq_posten_speichern(db, liste, benutzer=None):
    sauber = []
    for x in liste or []:
        text = (x.get("text") or "").strip()
        if not text:
            continue
        if x.get("rhythmus") not in RHYTHMEN:
            raise Fehler(f"„{text}“: unbekannter Rhythmus.")
        try:
            betrag = float(x.get("betrag"))
            erster = _dt.date.fromisoformat(x.get("erster") or "").isoformat()
            letzter = _dt.date.fromisoformat(x["letzter"]).isoformat() if x.get("letzter") else None
        except (TypeError, ValueError):
            raise Fehler(f"„{text}“: Betrag oder Datum ungültig.")
        if letzter and letzter < erster:
            raise Fehler(f"„{text}“: „bis“ liegt vor dem ersten Termin.")
        sauber.append((text[:80], round(betrag, 2), x["rhythmus"], erster, letzter))
    with transaktion(db):
        db.execute("DELETE FROM liq_posten")
        db.executemany("INSERT INTO liq_posten(text,betrag,rhythmus,erster,letzter) VALUES(?,?,?,?,?)", sauber)
        erp.protokoll(db, benutzer, "liquiditaet", None, "posten gespeichert", {"anzahl": len(sauber)})
    return liq_posten(db)


def liquiditaet(db, wochen=13, stichtag=None, ueberfaellige="woche1"):
    """Wochenvorschau ab der laufenden Woche.
    Kontostand: Einstellung liq_kontostand (Stand vom liq_stand_datum). Bewegungen zwischen Stand-Datum und heute
    stecken im Kontostand bzw. in den bereits ausgeglichenen offenen Posten – nur offene Posten und künftige Termine zählen.
    ueberfaellige: 'woche1' = überfällige offene Posten in der ersten Woche erwarten, 'aus' = nicht einplanen."""
    wochen = max(1, min(52, int(wochen)))
    heute = _dt.date.fromisoformat(stichtag) if stichtag else _dt.date.today()
    start = heute - _dt.timedelta(days=heute.weekday())
    ende = start + _dt.timedelta(weeks=wochen) - _dt.timedelta(days=1)
    e = erp.einstellungen(db)
    try:
        stand = float(e.get("liq_kontostand") or 0)
    except ValueError:
        stand = 0.0
    spalten = [dict(von=(start + _dt.timedelta(weeks=i)).isoformat(), bis=(start + _dt.timedelta(weeks=i, days=6)).isoformat(),
                    kw=(start + _dt.timedelta(weeks=i)).isocalendar()[1], ein=0.0, aus=0.0, posten=[]) for i in range(wochen)]

    def woche(d):
        i = (d - start).days // 7
        return spalten[i] if 0 <= i < wochen else None

    ueber = dict(ein=0.0, aus=0.0, anzahl=0)
    for o in db.execute("""SELECT o.*, b.nummer, a.kurz FROM offener_posten o JOIN beleg b ON b.id=o.beleg_id JOIN adresse a ON a.id=o.adresse_id
                           WHERE ABS(o.offen) > 0.005 AND o.faellig <= ?""", (ende.isoformat(),)):
        betrag = o["offen"] if o["art"] == "debitor" else -o["offen"]
        f = _dt.date.fromisoformat(o["faellig"])
        if f < heute:
            ueber["ein" if betrag > 0 else "aus"] += betrag
            ueber["anzahl"] += 1
            if ueberfaellige != "woche1":
                continue
            f = heute
        w = woche(f)
        if w:
            w["ein" if betrag > 0 else "aus"] += betrag
            w["posten"].append(dict(datum=o["faellig"], text=f"{o['nummer']} {o['kurz']}", betrag=round(betrag, 2), quelle="op", beleg_id=o["beleg_id"],
                                    ueberfaellig=_dt.date.fromisoformat(o["faellig"]) < heute))
    for p in liq_posten(db):
        for d in _termine(p, heute, ende):
            w = woche(d)
            if w:
                w["ein" if p["betrag"] > 0 else "aus"] += p["betrag"]
                w["posten"].append(dict(datum=d.isoformat(), text=f"{p['text']} ({RHYTHMEN[p['rhythmus']]})", betrag=p["betrag"], quelle="plan"))
    lauf = stand
    tiefst = None
    for w in spalten:
        w["ein"], w["aus"] = round(w["ein"], 2), round(w["aus"], 2)
        w["saldo"] = round(w["ein"] + w["aus"], 2)
        lauf = round(lauf + w["saldo"], 2)
        w["stand"] = lauf
        w["posten"].sort(key=lambda x: x["datum"])
        if tiefst is None or lauf < tiefst["stand"]:
            tiefst = dict(stand=lauf, kw=w["kw"], von=w["von"])
    return dict(kontostand=round(stand, 2), stand_datum=e.get("liq_stand_datum") or "", heute=heute.isoformat(), wochen=spalten,
                ueberfaellig=dict(ein=round(ueber["ein"], 2), aus=round(ueber["aus"], 2), anzahl=ueber["anzahl"]), ueberfaellige=ueberfaellige,
                tiefststand=tiefst, posten=liq_posten(db))


def kontostand_speichern(db, betrag, datum, benutzer=None):
    try:
        b = round(float(betrag), 2)
        d = _dt.date.fromisoformat(datum or _dt.date.today().isoformat()).isoformat()
    except (TypeError, ValueError):
        raise Fehler("Kontostand bzw. Datum ungültig.")
    erp.einstellungen_speichern(db, dict(liq_kontostand=str(b), liq_stand_datum=d), benutzer)
    return dict(kontostand=b, stand_datum=d)


# ---------------------------------------------------------------- Umsatzauswertung
def umsatz(db, jahr=None):
    """Netto-Umsatz (Rechnungen minus Gutschriften) je Monat, Artikelgruppe, Kunde und Artikel – Jahr gegen Vorjahr."""
    jahr = int(jahr or _dt.date.today().year)
    j, vj = str(jahr), str(jahr - 1)
    basis = """FROM beleg_position p JOIN beleg b ON b.id=p.beleg_id JOIN belegart ba ON ba.code=b.belegart
               WHERE b.status='verarbeitet' AND b.belegart IN ('RE','GS') AND substr(b.datum,1,4) IN (?,?)"""
    summe = lambda: f"""SUM(CASE WHEN substr(b.datum,1,4)=? THEN ba.vorzeichen*p.gesamt ELSE 0 END) jahr,
                        SUM(CASE WHEN substr(b.datum,1,4)=? THEN ba.vorzeichen*p.gesamt ELSE 0 END) vorjahr"""
    monate = {r["m"]: r for r in db.execute(f"SELECT substr(b.datum,6,2) m, {summe()} {basis} GROUP BY 1", (j, vj, j, vj))}
    mon = [dict(monat=m, jahr=round((monate.get(f"{m:02d}") or {"jahr": 0})["jahr"] or 0, 2),
                vorjahr=round((monate.get(f"{m:02d}") or {"vorjahr": 0})["vorjahr"] or 0, 2)) for m in range(1, 13)]

    def liste(gruppe, felder, limit):
        out = zeilen(db.execute(f"""SELECT {felder}, {summe()} {basis.replace('WHERE', gruppe[0] + ' WHERE')}
                                    GROUP BY {gruppe[1]} HAVING ABS(jahr)>0.005 OR ABS(vorjahr)>0.005 ORDER BY jahr DESC LIMIT {limit}""", (j, vj, j, vj)))
        for x in out:
            x["jahr"], x["vorjahr"] = round(x["jahr"] or 0, 2), round(x["vorjahr"] or 0, 2)
            x["diff_pct"] = round((x["jahr"] - x["vorjahr"]) / abs(x["vorjahr"]) * 100, 1) if abs(x["vorjahr"]) > 0.005 else None
        return out

    gruppen = liste(("LEFT JOIN artikel ar ON ar.id=p.artikel_id", "1"), "COALESCE(NULLIF(ar.gruppe,''),'ohne Gruppe') name", 50)
    kunden = liste(("JOIN adresse a ON a.id=b.adresse_id", "a.id"), "a.id, a.kurz name, a.name1", 25)
    artikel = liste(("JOIN artikel ar ON ar.id=p.artikel_id", "ar.id"), "ar.id, ar.artikelnr, ar.kurz name", 25)
    # Stichtagsvergleich: Vorjahr nur bis zum selben Tag, sonst hinkt das laufende Jahr immer hinterher
    h = _dt.date.today()
    bis_vj = f"{jahr - 1}-{h.month:02d}-{h.day:02d}" if jahr == h.year else f"{jahr - 1}-12-31"
    gleicher_zeitraum = db.execute("""SELECT COALESCE(SUM(ba.vorzeichen*b.netto),0) s FROM beleg b JOIN belegart ba ON ba.code=b.belegart
                                      WHERE b.status='verarbeitet' AND b.belegart IN ('RE','GS') AND b.datum BETWEEN ? AND ?""",
                                   (f"{jahr - 1}-01-01", bis_vj)).fetchone()["s"]
    jahre = [r["j"] for r in db.execute("""SELECT DISTINCT substr(datum,1,4) j FROM beleg WHERE status='verarbeitet' AND belegart IN ('RE','GS') ORDER BY 1 DESC""")]
    return dict(jahr=jahr, jahre=jahre or [j], monate=mon, summe_jahr=round(sum(m["jahr"] for m in mon), 2),
                summe_vorjahr=round(sum(m["vorjahr"] for m in mon), 2), vorjahr_gleicher_zeitraum=round(gleicher_zeitraum, 2),
                vorjahr_bis=bis_vj, gruppen=gruppen, kunden=kunden, artikel=artikel)
