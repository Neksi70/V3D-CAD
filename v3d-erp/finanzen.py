"""Mahnwesen und Zahlungsabgleich (Kontoauszug) für V3D ERP."""
import csv
import datetime as _dt
import hashlib
import io
import re
import xml.etree.ElementTree as ET

import erp
from erp import Fehler, heute, jetzt, transaktion, zeile, zeilen


def _tage(a, b):
    return (_dt.date.fromisoformat(b[:10]) - _dt.date.fromisoformat(a[:10])).days


def _plus(d, n):
    return (_dt.date.fromisoformat(d[:10]) + _dt.timedelta(days=n)).isoformat()


# ================================================================ Mahnwesen
def mahnstufen(db):
    return zeilen(db.execute("SELECT * FROM mahnstufe ORDER BY stufe"))


def mahnstufen_speichern(db, liste, benutzer=None):
    with transaktion(db):
        for m in liste:
            if not (m.get("name") or "").strip():
                raise Fehler("Jede Mahnstufe braucht einen Namen.")
            db.execute("""INSERT INTO mahnstufe(stufe,name,tage,gebuehr,text) VALUES(?,?,?,?,?)
                          ON CONFLICT(stufe) DO UPDATE SET name=excluded.name, tage=excluded.tage, gebuehr=excluded.gebuehr, text=excluded.text""",
                       (int(m["stufe"]), m["name"].strip(), int(m.get("tage") or 0), float(m.get("gebuehr") or 0), m.get("text") or ""))
        erp.protokoll(db, benutzer, "mahnstufe", None, "geändert")
    return mahnstufen(db)


def mahnvorschlag(db, stichtag=None):
    """Überfällige Kunden-OPs, die für die nächste Mahnstufe reif sind – gruppiert je Kunde."""
    stichtag = stichtag or heute()
    stufen = {m["stufe"]: m for m in mahnstufen(db)}
    ops = zeilen(db.execute("""SELECT o.*, b.nummer, b.datum beleg_datum, a.kurz, a.name1 FROM offener_posten o
                               JOIN beleg b ON b.id=o.beleg_id JOIN adresse a ON a.id=o.adresse_id
                               WHERE o.art='debitor' AND o.offen>0.005 AND o.mahnsperre=0 AND o.faellig<?
                               ORDER BY a.kurz, o.faellig""", (stichtag,)))
    kunden = {}
    for o in ops:
        naechste = stufen.get(o["mahnstufe"] + 1)
        if not naechste:
            continue                                    # höchste Stufe erreicht
        basis = o["letzte_mahnung"] if o["mahnstufe"] and o["letzte_mahnung"] else o["faellig"]
        if _tage(basis, stichtag) < naechste["tage"]:
            continue                                    # noch nicht reif
        o["tage_ueber"] = _tage(o["faellig"], stichtag)
        o["naechste_stufe"] = naechste["stufe"]
        k = kunden.setdefault(o["adresse_id"], dict(adresse_id=o["adresse_id"], kurz=o["kurz"], name1=o["name1"], posten=[], summe=0, stufe=0))
        k["posten"].append(o)
        k["summe"] = round(k["summe"] + o["offen"], 2)
        k["stufe"] = max(k["stufe"], naechste["stufe"])
    for k in kunden.values():
        k["stufe_name"] = stufen[k["stufe"]]["name"]
        k["gebuehr"] = stufen[k["stufe"]]["gebuehr"]
    return list(kunden.values())


def mahnungen_erstellen(db, adresse_ids, stichtag=None, frist_tage=10, benutzer=None):
    vorschlag = [k for k in mahnvorschlag(db, stichtag) if k["adresse_id"] in set(adresse_ids)]
    if not vorschlag:
        raise Fehler("Für die gewählten Kunden ist nichts zu mahnen.")
    datum = stichtag or heute()
    neu = []
    with transaktion(db):
        for k in vorschlag:
            nummer = erp.naechste_nummer(db, "MA", datum)
            frist = _plus(datum, frist_tage)
            mid = db.execute("""INSERT INTO mahnung(nummer,adresse_id,datum,stufe,gebuehr,summe,neue_frist,erstellt_von) VALUES(?,?,?,?,?,?,?,?)""",
                             (nummer, k["adresse_id"], datum, k["stufe"], k["gebuehr"], round(k["summe"] + k["gebuehr"], 2), frist, benutzer)).lastrowid
            for o in k["posten"]:
                db.execute("INSERT INTO mahnung_posten(mahnung_id,op_id,offen,tage_ueber) VALUES(?,?,?,?)", (mid, o["id"], o["offen"], o["tage_ueber"]))
                db.execute("UPDATE offener_posten SET mahnstufe=?, letzte_mahnung=? WHERE id=?", (o["naechste_stufe"], datum, o["id"]))
            erp.protokoll(db, benutzer, "mahnung", mid, "erstellt", {"nummer": nummer, "stufe": k["stufe"]})
            neu.append(mid)
    return [mahnung_lesen(db, m) for m in neu]


def mahnung_lesen(db, mid):
    m = zeile(db.execute("""SELECT m.*, s.name stufe_name, s.text stufe_text, a.kurz, a.name1, a.name2, a.strasse, a.plz, a.ort, a.land, k.kundennr
                            FROM mahnung m JOIN mahnstufe s ON s.stufe=m.stufe JOIN adresse a ON a.id=m.adresse_id
                            LEFT JOIN kunde k ON k.adresse_id=a.id WHERE m.id=?""", (mid,)))
    if not m:
        raise Fehler("Mahnung nicht gefunden.")
    m["posten"] = zeilen(db.execute("""SELECT mp.*, b.nummer, b.datum beleg_datum, o.faellig, o.betrag FROM mahnung_posten mp
                                       JOIN offener_posten o ON o.id=mp.op_id JOIN beleg b ON b.id=o.beleg_id WHERE mp.mahnung_id=? ORDER BY o.faellig""", (mid,)))
    return m


def mahnungen_liste(db):
    return zeilen(db.execute("""SELECT m.id, m.nummer, m.datum, m.stufe, s.name stufe_name, m.summe, m.neue_frist, a.kurz
                                FROM mahnung m JOIN mahnstufe s ON s.stufe=m.stufe JOIN adresse a ON a.id=m.adresse_id ORDER BY m.id DESC LIMIT 200"""))


def mahnsperre(db, op_id, an, benutzer=None):
    with transaktion(db):
        db.execute("UPDATE offener_posten SET mahnsperre=? WHERE id=?", (1 if an else 0, op_id))
        erp.protokoll(db, benutzer, "op", op_id, "Mahnsperre " + ("gesetzt" if an else "aufgehoben"))
    return {"ok": True}


# ================================================================ Kontoauszug einlesen
SPALTEN = {
    "datum": ["buchungstag", "buchungsdatum", "buchung", "datum", "valutadatum", "wertstellung"],
    "betrag": ["betrag", "betrageur", "umsatz", "betraginEUR".lower(), "umsatzineur"],
    "name": ["beguenstigterzahlungspflichtiger", "begünstigterzahlungspflichtiger", "namezahlungsbeteiligter", "empfängerauftraggeber",
             "auftraggeberbegünstigter", "auftraggeberempfänger", "zahlungsempfänger", "name", "gegenseite"],
    "iban": ["kontonummeriban", "ibanzahlungsbeteiligter", "iban", "kontonummer"],
    "zweck": ["verwendungszweck", "vorgangverwendungszweck", "buchungsdetails", "zweck"],
    "sollhaben": ["sollhaben", "sh"],
}


def _norm(s):
    return re.sub(r"[^a-z0-9äöüß]", "", (s or "").lower())


def _zahl(s):
    t = (s or "").strip().replace("€", "").replace("EUR", "").replace(" ", "")
    if not t:
        raise ValueError("Betrag fehlt")
    if re.fullmatch(r"-?\d+(\.\d+)?", t):
        return float(t)
    return float(t.replace(".", "").replace(",", "."))


def _datum(s):
    t = (s or "").strip()[:10]
    for f in ("%d.%m.%Y", "%d.%m.%y", "%Y-%m-%d"):
        try:
            return _dt.datetime.strptime(t, f).date().isoformat()
        except ValueError:
            pass
    raise ValueError("Datum nicht lesbar")


def lies_csv(daten):
    for kod in ("utf-8-sig", "cp1252"):
        try:
            text = daten.decode(kod)
            break
        except UnicodeDecodeError:
            continue
    trenner = max([";", ",", "\t"], key=text[:3000].count)
    zeilen_ = list(csv.reader(io.StringIO(text), delimiter=trenner))
    for i, kopf in enumerate(zeilen_[:30]):
        idx = {_norm(k): j for j, k in enumerate(kopf)}
        zu = {}
        for feld, namen in SPALTEN.items():
            for n in namen:
                if n in idx and idx[n] not in zu.values():
                    zu[feld] = idx[n]
                    break
        if "datum" in zu and "betrag" in zu:
            erg = []
            for z in zeilen_[i + 1:]:
                if not any(c.strip() for c in z) or len(z) <= max(zu.values()):
                    continue
                try:
                    betrag = _zahl(z[zu["betrag"]])
                    if "sollhaben" in zu and z[zu["sollhaben"]].strip().upper().startswith("S"):
                        betrag = -abs(betrag)
                    erg.append(dict(datum=_datum(z[zu["datum"]]), betrag=betrag,
                                    name=z[zu["name"]].strip() if "name" in zu else "", iban=z[zu["iban"]].strip() if "iban" in zu else "",
                                    zweck=z[zu["zweck"]].strip() if "zweck" in zu else ""))
                except (ValueError, IndexError):
                    continue
            return erg
    raise Fehler("Kontoauszug nicht erkannt: Spalten für Datum und Betrag fehlen. Bitte als CSV (CAMT-Format) oder CAMT.053-XML aus dem Online-Banking exportieren.")


def lies_camt(daten):
    try:
        root = ET.fromstring(daten)
    except ET.ParseError:
        raise Fehler("Die XML-Datei ist kein gültiger CAMT-Kontoauszug.")
    t = lambda el, *pfad: _finde(el, pfad)
    erg = []
    for ntry in root.iter():
        if not ntry.tag.endswith("}Ntry") and ntry.tag != "Ntry":
            continue
        betrag = float(t(ntry, "Amt") or 0)
        if (t(ntry, "CdtDbtInd") or "CRDT") == "DBIT":
            betrag = -betrag
        datum = t(ntry, "BookgDt", "Dt") or t(ntry, "BookgDt", "DtTm") or t(ntry, "ValDt", "Dt") or heute()
        partei = "Dbtr" if betrag > 0 else "Cdtr"
        name = t(ntry, "NtryDtls", "TxDtls", "RltdPties", partei, "Nm") or t(ntry, "NtryDtls", "TxDtls", "RltdPties", partei, "Pty", "Nm") or ""
        iban = t(ntry, "NtryDtls", "TxDtls", "RltdPties", partei + "Acct", "Id", "IBAN") or ""
        zweck = " ".join(x.text.strip() for x in ntry.iter() if x.tag.endswith("Ustrd") and x.text) or (t(ntry, "AddtlNtryInf") or "")
        erg.append(dict(datum=datum[:10], betrag=betrag, name=name, iban=iban, zweck=zweck))
    if not erg:
        raise Fehler("Im CAMT-Kontoauszug wurden keine Buchungen gefunden.")
    return erg


def _finde(el, pfad):
    akt = [el]
    for teil in pfad:
        nxt = []
        for e in akt:
            nxt += [c for c in e if c.tag.split("}")[-1] == teil]
        akt = nxt
        if not akt:
            return None
    return (akt[0].text or "").strip()


def kontoauszug_importieren(db, dateiname, daten, benutzer=None):
    roh = daten.lstrip()
    umsaetze, fmt = (lies_camt(daten), "CAMT.053") if roh.startswith(b"<") else (lies_csv(daten), "CSV")
    neu = doppelt = 0
    with transaktion(db):
        iid = db.execute("INSERT INTO bankimport(datei,format,zeit,von) VALUES(?,?,?,?)", (dateiname, fmt, jetzt(), benutzer)).lastrowid
        gesehen = {}
        for u in umsaetze:
            basis = f"{u['datum']}|{u['betrag']:.2f}|{u['name']}|{u['zweck']}"
            gesehen[basis] = gesehen.get(basis, 0) + 1
            schl = hashlib.sha1(f"{basis}|{gesehen[basis]}".encode()).hexdigest()
            try:
                db.execute("INSERT INTO bankumsatz(import_id,datum,betrag,name,iban,zweck,schluessel) VALUES(?,?,?,?,?,?,?)",
                           (iid, u["datum"], u["betrag"], u["name"], u["iban"], u["zweck"], schl))
                neu += 1
            except Exception:
                doppelt += 1
        db.execute("UPDATE bankimport SET anzahl=? WHERE id=?", (neu, iid))
        erp.protokoll(db, benutzer, "bankimport", iid, "eingelesen", {"neu": neu, "doppelt": doppelt})
    return {"format": fmt, "neu": neu, "doppelt": doppelt}


# ================================================================ Abgleich
def _nummer_muster(nummer):
    """RE-26-0001 → auch RE260001, RE 26 0001, RE/26/0001 im Verwendungszweck finden."""
    teile = re.split(r"[-/ ]", nummer.replace("ALT-ER-", "").replace("ALT-", ""))
    return re.compile(r"(?<![0-9A-Za-z])" + r"[\s\-/]?".join(map(re.escape, teile)) + r"(?![0-9])", re.I)


def vorschlaege(db, umsatz):
    """Bis zu 3 passende offene Posten mit Punktzahl und Begründung."""
    eingang = umsatz["betrag"] > 0
    art = "debitor" if eingang else "kreditor"
    betrag = abs(umsatz["betrag"])
    ops = zeilen(db.execute("""SELECT o.*, b.nummer, b.datum beleg_datum, b.zahlungsbed_id, a.kurz, a.name1,
                                      z.skonto_pct, z.skonto_tage FROM offener_posten o JOIN beleg b ON b.id=o.beleg_id
                               JOIN adresse a ON a.id=o.adresse_id LEFT JOIN zahlungsbedingung z ON z.id=b.zahlungsbed_id
                               WHERE o.art=? AND o.offen>0.005""", (art,)))
    zweck, name = umsatz.get("zweck") or "", _norm(umsatz.get("name"))
    erg = []
    for o in ops:
        punkte, gruende, skonto = 0, [], 0.0
        if o["nummer"] and _nummer_muster(o["nummer"]).search(zweck):
            punkte += 100
            gruende.append(f"Nummer {o['nummer']} im Verwendungszweck")
        if abs(betrag - o["offen"]) < 0.005:
            punkte += 40
            gruende.append("Betrag stimmt genau")
        elif o["skonto_pct"] and o["skonto_tage"] is not None:
            mit_skonto = round(o["offen"] * (1 - o["skonto_pct"] / 100), 2)
            if abs(betrag - mit_skonto) < 0.02 and _tage(o["beleg_datum"], umsatz["datum"]) <= o["skonto_tage"] + 3:
                punkte += 35
                skonto = round(o["offen"] - betrag, 2)
                gruende.append(f"Betrag = abzüglich {o['skonto_pct']:g} % Skonto")
        woerter = [w for w in re.split(r"\W+", f"{o['kurz']} {o['name1']}".lower()) if len(w) > 3 and w not in ("gmbh", "kg", "ag", "mbh")]
        if name and any(_norm(w) in name for w in woerter):
            punkte += 30
            gruende.append("Name passt")
        if punkte >= 40:
            erg.append(dict(op_id=o["id"], nummer=o["nummer"], kurz=o["kurz"], offen=o["offen"], faellig=o["faellig"],
                            punkte=punkte, grund=", ".join(gruende), skonto=skonto,
                            sicher=punkte >= 130 or (punkte >= 70 and "Betrag" in " ".join(gruende))))
    erg.sort(key=lambda x: -x["punkte"])
    return erg[:3]


def umsaetze(db, status="offen"):
    l = zeilen(db.execute("""SELECT u.*, o.beleg_id, b.nummer op_nummer FROM bankumsatz u LEFT JOIN offener_posten o ON o.id=u.op_id
                             LEFT JOIN beleg b ON b.id=o.beleg_id WHERE (?='' OR u.status=?) ORDER BY u.datum DESC, u.id DESC LIMIT 500""", (status, status)))
    for u in l:
        u["vorschlaege"] = vorschlaege(db, u) if u["status"] == "offen" else []
    return l


def zuordnen(db, umsatz_id, op_id, skonto=0.0, benutzer=None):
    with transaktion(db):
        u = zeile(db.execute("SELECT * FROM bankumsatz WHERE id=?", (umsatz_id,)))
        o = zeile(db.execute("SELECT o.*, b.nummer FROM offener_posten o JOIN beleg b ON b.id=o.beleg_id WHERE o.id=?", (op_id,)))
        if not u or not o:
            raise Fehler("Umsatz oder offener Posten nicht gefunden.")
        if u["status"] != "offen":
            raise Fehler("Dieser Umsatz ist bereits erledigt.")
        if (u["betrag"] > 0) != (o["art"] == "debitor"):
            raise Fehler("Zahlungseingänge gehören zu Kunden, Ausgänge zu Lieferanten.")
        bezahlt = abs(u["betrag"])
        skonto = round(float(skonto or 0), 2)
        neu_offen = round(o["offen"] - bezahlt - skonto, 2)
        db.execute("UPDATE offener_posten SET offen=? WHERE id=?", (neu_offen, op_id))
        db.execute("UPDATE bankumsatz SET status='zugeordnet', op_id=?, skonto=?, erledigt=?, von=? WHERE id=?", (op_id, skonto, jetzt(), benutzer, umsatz_id))
        erp.protokoll(db, benutzer, "op", op_id, "Zahlung aus Kontoauszug", {"betrag": bezahlt, "skonto": skonto, "umsatz": umsatz_id})
    return {"ok": True, "nummer": o["nummer"], "offen": neu_offen}


def alle_sicheren_zuordnen(db, benutzer=None):
    n = 0
    for u in umsaetze(db, "offen"):
        v = u["vorschlaege"]
        if v and v[0]["sicher"] and (len(v) == 1 or v[1]["punkte"] < v[0]["punkte"]):
            zuordnen(db, u["id"], v[0]["op_id"], v[0]["skonto"], benutzer)
            n += 1
    return {"zugeordnet": n}


def ignorieren(db, umsatz_id, zurueck=False, benutzer=None):
    with transaktion(db):
        u = zeile(db.execute("SELECT * FROM bankumsatz WHERE id=?", (umsatz_id,)))
        if not u:
            raise Fehler("Umsatz nicht gefunden.")
        if zurueck and u["status"] == "zugeordnet":           # Zuordnung rückgängig
            db.execute("UPDATE offener_posten SET offen=round(offen+?+?,2) WHERE id=?", (abs(u["betrag"]), u["skonto"], u["op_id"]))
        db.execute("UPDATE bankumsatz SET status=?, op_id=NULL, skonto=0, erledigt=?, von=? WHERE id=?",
                   ("offen" if zurueck else "ignoriert", None if zurueck else jetzt(), benutzer, umsatz_id))
        erp.protokoll(db, benutzer, "bankumsatz", umsatz_id, "zurückgesetzt" if zurueck else "ignoriert")
    return {"ok": True}


def beispiel_kontoauszug(db):
    """Nur fürs Testsystem: CSV im Sparkassen-Format passend zu den offenen Posten (erfundene Zahlungen)."""
    ops = zeilen(db.execute("""SELECT o.*, b.nummer, a.name1, z.skonto_pct FROM offener_posten o JOIN beleg b ON b.id=o.beleg_id
                               JOIN adresse a ON a.id=o.adresse_id LEFT JOIN zahlungsbedingung z ON z.id=b.zahlungsbed_id
                               WHERE o.offen>0.005 ORDER BY o.art, o.faellig"""))
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", quoting=csv.QUOTE_ALL)
    w.writerow(["Auftragskonto", "Buchungstag", "Valutadatum", "Buchungstext", "Verwendungszweck", "Beguenstigter/Zahlungspflichtiger",
                "Kontonummer/IBAN", "BIC (SWIFT-Code)", "Betrag", "Waehrung", "Info"])
    tag = _dt.date.today().strftime("%d.%m.%y")
    de = lambda x: f"{x:.2f}".replace(".", ",")
    deb = [o for o in ops if o["art"] == "debitor"]
    kred = [o for o in ops if o["art"] == "kreditor"]
    if deb:
        o = deb[0]
        w.writerow(["DE00TEST", tag, tag, "GUTSCHR. UEBERWEISUNG", f"Rechnung {o['nummer']} vielen Dank", o["name1"].upper(), "DE11111111111111111111", "TESTDEXX", de(o["offen"]), "EUR", "Umsatz gebucht"])
    if len(deb) > 1:
        o = deb[1]
        betrag = o["offen"] * (1 - (o["skonto_pct"] or 0) / 100)       # Skonto nur, wenn die Rechnung es vorsieht
        w.writerow(["DE00TEST", tag, tag, "GUTSCHR. UEBERWEISUNG", "Zahlung abzgl. Skonto" if o["skonto_pct"] else "Ausgleich offene Rechnung",
                    o["name1"], "DE22222222222222222222", "TESTDEXX", de(betrag), "EUR", "Umsatz gebucht"])
    if kred:
        o = kred[0]
        w.writerow(["DE00TEST", tag, tag, "UEBERWEISUNG", f"Rg. {o['nummer'].replace('ALT-ER-', '')} Kd-Nr. K-4711", o["name1"], "DE33333333333333333333", "TESTDEXX", de(-o["offen"]), "EUR", "Umsatz gebucht"])
    w.writerow(["DE00TEST", tag, tag, "LASTSCHRIFT", "Stromabschlag Oktober", "STADTWERKE BEISPIEL", "DE44444444444444444444", "TESTDEXX", "-312,00", "EUR", "Umsatz gebucht"])
    w.writerow(["DE00TEST", tag, tag, "GUTSCHR. UEBERWEISUNG", "Anzahlung ohne Rechnungsnummer", "Unbekannter Absender", "DE55555555555555555555", "TESTDEXX", "150,00", "EUR", "Umsatz gebucht"])
    return buf.getvalue().encode("cp1252", errors="replace")
