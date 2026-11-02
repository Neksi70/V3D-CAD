#!/usr/bin/env python3
"""Datenübernahme aus myfactory-Exporten in V3D ERP.

Liest CSV- (Semikolon/Komma/Tab, UTF-8 oder Windows-1252) und XLSX-Dateien, wie sie myfactory über
„Stammdatenlisten → Export nach Excel“ bzw. die Listenansichten erzeugt. Spalten werden über ihre
deutschen Überschriften erkannt (Reihenfolge egal, Groß-/Kleinschreibung egal).

DATENSCHUTZ: Das Protokoll enthält NIE Inhalte (Namen, Adressen, Beträge) – nur Spaltennamen,
Anzahlen und Zeilennummern. So kann der Kunde den Probelauf selbst machen und das Protokoll weitergeben.

Aufruf:
  python3 import_myfactory.py kunden     kunden.xlsx      --db erp.db            # Probelauf (ändert nichts)
  python3 import_myfactory.py kunden     kunden.xlsx      --db erp.db --ausfuehren
  Arten: kunden | lieferanten | artikel | op-kunden | op-lieferanten
"""
import argparse
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import erp  # noqa: E402

# ---------------------------------------------------------------- Spalten-Zuordnung
# Zielfeld → mögliche Überschriften in myfactory-Exporten
ADRESSE = {
    "adressnr": ["Adressnummer", "Adress-Nr", "Adressnr"],
    "kurz": ["Kurzbezeichnung", "Matchcode", "Kurzbez"],
    "name1": ["Name", "Name1", "Name 1", "Firma", "Bezeichnung"],
    "name2": ["Name (Zusatz)", "Name2", "Name 2", "Namenszusatz"],
    "strasse": ["Straße", "Strasse", "Str."],
    "plz": ["PLZ", "Postleitzahl"],
    "ort": ["Ort", "Stadt"],
    "land": ["Land", "Länderkennzeichen", "Landeskennzeichen"],
    "telefon": ["Telefon", "Telefonnummer", "Tel."],
    "email": ["E-Mail", "EMail", "Email", "E-Mail-Adresse"],
    "ust_id": ["EU USt.ID", "USt-IdNr", "UStID", "Umsatzsteuer-ID", "EU-USt-ID"],
    "zahlungsbed": ["Zahlungskonditionen", "Zahlungskondition", "Zahlungsbedingung"],
    "notiz": ["Notiz", "Bemerkung", "Memo"],
}
FELDER = {
    "kunden": dict(ADRESSE, kundennr=["Kundennummer", "Kunden-Nr", "Kundennr"], rabatt_pct=["Rabatt(%)", "Rabatt", "Rabatt %"],
                   kreditlimit=["Kreditlimit"], leitweg_id=["Leitweg-ID", "LeitwegID"]),
    "lieferanten": dict(ADRESSE, lieferantennr=["Lieferantennummer", "Lieferanten-Nr", "Lieferantennr"],
                        unsere_kundennr=["Unsere Kundennummer", "Unsere Kunden-Nr"], mindestbestellwert=["Mindestbestellwert"]),
    "artikel": {
        "artikelnr": ["Artikelnummer", "Artikel-Nr", "Artikelnr"],
        "kurz": ["Kurzbezeichnung", "Matchcode"],
        "bezeichnung": ["Bezeichnung", "Artikelbezeichnung", "Name1"],
        "bezeichnung2": ["Bezeichnung (Zusatz)", "Name2"],
        "me": ["Basismengeneinheit (BME)", "Basismengeneinheit", "Mengeneinheit", "ME", "BME"],
        "gruppe": ["Artikelgruppe", "Gruppe"],
        "vk_preis": ["VK-Preis", "Verkaufspreis", "Preis", "Listenpreis", "VK"],
        "ek_preis": ["Letzter EK", "EK-Preis", "Einkaufspreis", "Mittlerer Wert (MEK)", "Durchschnittlicher EK", "EK", "Interner Wert"],
        "steuer_pct": ["Steuersatz", "MwSt", "MwSt %"],
        "steuerklasse": ["Steuerklasse"],
        "typ": ["Artikeltyp", "Artikelart"],
        "meldebestand": ["Meldebestand"],
        "bestand": ["Gesamtlagerbestand", "Lagerbestand", "Bestand"],
        "lagerfuehrung": ["Lagerführung", "Lagerartikel"],
        "inaktiv": ["Inaktiv"],
    },
    "op-kunden": {
        "belegnr": ["Belegnummer", "OP-Nummer", "Rechnungsnummer", "Beleg"],
        "partnernr": ["Kundennummer", "Kunden-Nr", "Debitor", "Kontonummer"],
        "datum": ["Belegdatum", "Datum", "Rechnungsdatum"],
        "faellig": ["Fälligkeit", "Fällig am", "Fälligkeitsdatum", "Nettofälligkeit"],
        "betrag": ["Betrag", "Brutto", "Rechnungsbetrag", "Ursprungsbetrag"],
        "offen": ["Offen", "Offener Betrag", "Restbetrag", "Saldo"],
    },
}
FELDER["op-lieferanten"] = dict(FELDER["op-kunden"], partnernr=["Lieferantennummer", "Lieferanten-Nr", "Kreditor", "Kontonummer"])
PFLICHT = {"kunden": ["kundennr|adressnr", "name1"], "lieferanten": ["lieferantennr|adressnr", "name1"], "artikel": ["artikelnr", "bezeichnung|kurz"],
           "op-kunden": ["belegnr", "partnernr", "betrag"], "op-lieferanten": ["belegnr", "partnernr", "betrag"]}


def norm(s):
    return re.sub(r"[^a-z0-9äöüß]", "", (s or "").strip().lower())


def zuordnen(kopf, art):
    """Gibt {zielfeld: spaltenindex} und die Liste unbekannter Spalten zurück."""
    idx = {norm(k): i for i, k in enumerate(kopf)}
    zu, benutzt = {}, set()
    for feld, namen in FELDER[art].items():
        for n in namen:
            i = idx.get(norm(n))
            if i is not None and i not in benutzt:
                zu[feld] = i
                benutzt.add(i)
                break
    unbekannt = [k for i, k in enumerate(kopf) if i not in benutzt and (k or "").strip()]
    return zu, unbekannt


# ---------------------------------------------------------------- Dateien lesen
def lies_csv(pfad):
    with open(pfad, "rb") as f:
        roh = f.read()
    kodierungen = ("utf-16",) if roh[:2] in (b"\xff\xfe", b"\xfe\xff") else ("utf-8-sig", "cp1252")   # myfactory-Berichte: UTF-16
    for kod in kodierungen:
        try:
            text = roh.decode(kod)
            break
        except UnicodeDecodeError:
            continue
    zeilen = text.splitlines()
    trenner = None
    if zeilen and re.match(r"^sep=.$", zeilen[0].strip()):          # Excel-Hinweiszeile „sep=;“
        trenner = zeilen.pop(0).strip()[4]
    probe = "\n".join(zeilen[:30])
    trenner = trenner or max([";", ",", "\t"], key=probe.count)
    # Ein einzelnes Anführungszeichen (Eingabefehler, z. B. Zoll-Zeichen) würde alle folgenden Zeilen verschlucken → entfernen
    zeilen = [z.replace('"', "") if z.count('"') % 2 else z for z in zeilen]
    return [z for z in csv.reader(io.StringIO("\n".join(zeilen)), delimiter=trenner)]


def _spalte(ref):
    buch = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for c in buch:
        n = n * 26 + ord(c) - 64
    return n - 1


def lies_xlsx(pfad):
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(pfad) as z:
        strings = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns):
                strings.append("".join(t.text or "" for t in si.iter("{%s}t" % ns["m"])))
        blatt = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))[0]
        root = ET.fromstring(z.read(blatt))
    zeilen = []
    for row in root.iter("{%s}row" % ns["m"]):
        werte = {}
        for c in row.findall("m:c", ns):
            t, v = c.get("t"), c.find("m:v", ns)
            if t == "s" and v is not None:
                w = strings[int(v.text)]
            elif t == "inlineStr":
                w = "".join(x.text or "" for x in c.iter("{%s}t" % ns["m"]))
            elif t == "b" and v is not None:
                w = "1" if v.text == "1" else "0"
            else:
                w = v.text if v is not None else ""
            werte[_spalte(c.get("r"))] = w
        if werte:
            zeilen.append([werte.get(i, "") for i in range(max(werte) + 1)])
    return zeilen


def lies(pfad):
    if pfad.lower().endswith((".xlsx", ".xlsm")):
        return lies_xlsx(pfad)
    return lies_csv(pfad)


# ---------------------------------------------------------------- Werte umwandeln
def zahl(s):
    if s is None or str(s).strip() == "":
        return None
    t = str(s).strip().replace("€", "").replace("%", "").replace(" ", "")
    if re.match(r"^-?\d+(\.\d+)?(E-?\d+)?$", t, re.I):     # Excel-Zahl (Punkt)
        return float(t)
    t = t.replace(".", "").replace(",", ".")                 # deutsches Format 1.234,56
    return float(t)


def datum(s):
    if not s or not str(s).strip():
        return None
    t = str(s).strip()
    if re.match(r"^\d+(\.0+)?$", t):                          # Excel-Seriennummer
        return (dt.date(1899, 12, 30) + dt.timedelta(days=int(float(t)))).isoformat()
    for f in ("%d.%m.%Y", "%d.%m.%y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return dt.datetime.strptime(t[:10], f).date().isoformat()
        except ValueError:
            pass
    raise ValueError("Datum nicht lesbar")


def janein(s):
    return 1 if norm(s) in ("1", "ja", "true", "wahr", "x", "yes") else 0


def zahlungsbed_id(db, text, cache):
    if not text or not text.strip():
        return None
    if text in cache:
        return cache[text]
    r = db.execute("SELECT id FROM zahlungsbedingung WHERE text=?", (text,)).fetchone()
    if r:
        cache[text] = r["id"]
    else:
        tage = re.findall(r"(\d+)\s*Tag", text)
        skonto = re.search(r"(\d+(?:[.,]\d+)?)\s*%", text)
        cache[text] = db.execute("INSERT INTO zahlungsbedingung(text,tage_netto,skonto_tage,skonto_pct) VALUES(?,?,?,?)",
                                 (text, int(tage[-1]) if tage else 30, int(tage[0]) if skonto and len(tage) > 1 else 0,
                                  float(skonto.group(1).replace(",", ".")) if skonto else 0)).lastrowid
    return cache[text]


# ---------------------------------------------------------------- Import
def importieren(db, art, pfad, ausfuehren=False, protokoll=print):
    zeilen = [z for z in lies(pfad) if any((c or "").strip() for c in z)]
    if not zeilen:
        raise erp.Fehler("Datei ist leer.")
    # Kopfzeile = erste Zeile, in der mindestens 2 bekannte Spalten stehen
    kopf_i = next((i for i, z in enumerate(zeilen[:10]) if len(zuordnen(z, art)[0]) >= 2), 0)
    kopf = zeilen[kopf_i]
    zu, unbekannt = zuordnen(kopf, art)
    daten = zeilen[kopf_i + 1:]
    protokoll(f"Datei: {os.path.basename(pfad)}  ·  Art: {art}  ·  {len(daten)} Datenzeilen")
    protokoll("Erkannte Spalten: " + ", ".join(f"{kopf[i]} → {f}" for f, i in zu.items()))
    if unbekannt:
        protokoll("Nicht übernommene Spalten: " + ", ".join(unbekannt))
    fehlt = [f.split("|")[0] for f in PFLICHT[art] if not any(x in zu for x in f.split("|"))]
    if fehlt:
        raise erp.Fehler("Pflichtspalten fehlen: " + ", ".join(fehlt))

    st = dict(neu=0, aktualisiert=0, fehler=0, leer=0)
    fehlerzeilen = []
    zb_cache = {}

    def w(z, f):
        i = zu.get(f)
        return (z[i].strip() if i is not None and i < len(z) and z[i] is not None else "")

    db.execute("BEGIN")
    try:
        for nr, z in enumerate(daten, start=kopf_i + 2):
            try:
                if art in ("kunden", "lieferanten"):
                    schluessel = "kundennr" if art == "kunden" else "lieferantennr"
                    tab = "kunde" if art == "kunden" else "lieferant"
                    ohne_nr = schluessel not in zu                  # Bericht ohne Kunden-/Lieferantennummer: über Adressnummer wiedererkennen
                    if ohne_nr and not w(z, "adressnr") or not ohne_nr and not w(z, schluessel):
                        st["leer"] += 1
                        continue
                    if not w(z, "name1"):
                        raise ValueError("Name leer")
                    if ohne_nr:
                        vorh = db.execute(f"SELECT r.adresse_id, r.{schluessel} FROM {tab} r JOIN adresse a ON a.id=r.adresse_id WHERE a.adressnr=?",
                                          (w(z, "adressnr"),)).fetchone()
                        nr_rolle = vorh[schluessel] if vorh else erp.naechste_stammnr(db, tab, schluessel, 10000 if art == "kunden" else 70000)
                    else:
                        vorh = db.execute(f"SELECT adresse_id FROM {tab} WHERE {schluessel}=?", (w(z, schluessel),)).fetchone()
                        nr_rolle = w(z, schluessel)
                    adr = {f: (w(z, f) or None) for f in erp.ADRESS_FELDER if f in zu}
                    adressnr = w(z, "adressnr") or None
                    adr["kurz"] = adr.get("kurz") or w(z, "name1")[:30].upper()
                    adr["land"] = _land(adr.get("land"))
                    rolle = {schluessel: nr_rolle, "zahlungsbed_id": zahlungsbed_id(db, w(z, "zahlungsbed"), zb_cache)}
                    if art == "kunden":
                        rolle.update(rabatt_pct=zahl(w(z, "rabatt_pct")) or 0, kreditlimit=zahl(w(z, "kreditlimit")), leitweg_id=w(z, "leitweg_id") or None)
                        zeilen_rolle = ("kundennr", "zahlungsbed_id", "rabatt_pct", "kreditlimit", "leitweg_id")
                    else:
                        rolle.update(unsere_kundennr=w(z, "unsere_kundennr") or None, mindestbestellwert=zahl(w(z, "mindestbestellwert")))
                        zeilen_rolle = ("lieferantennr", "zahlungsbed_id", "unsere_kundennr", "mindestbestellwert")
                    if vorh:
                        aid = vorh["adresse_id"]
                        sets = {k: v for k, v in adr.items() if v is not None}
                        if sets:
                            db.execute(f"UPDATE adresse SET {', '.join(k + '=?' for k in sets)} WHERE id=?", list(sets.values()) + [aid])
                        db.execute(f"UPDATE {tab} SET {', '.join(k + '=?' for k in zeilen_rolle[1:])} WHERE adresse_id=?",
                                   [rolle[k] for k in zeilen_rolle[1:]] + [aid])
                        st["aktualisiert"] += 1
                    else:
                        # gleiche Adressnummer schon da (z. B. Kunde UND Lieferant) → Rolle an dieselbe Adresse hängen
                        aid = None
                        if adressnr:
                            r = db.execute("SELECT id FROM adresse WHERE adressnr=?", (adressnr,)).fetchone()
                            aid = r["id"] if r else None
                        if not aid:
                            nr_ = adressnr or erp.naechste_stammnr(db, "adresse", "adressnr", 10000)
                            felder = [f for f in erp.ADRESS_FELDER]
                            aid = db.execute(f"INSERT INTO adresse(adressnr,{','.join(felder)},angelegt) VALUES(?,{','.join('?' * len(felder))},?)",
                                             [nr_] + [adr.get(f) for f in felder] + [erp.jetzt()]).lastrowid
                        db.execute(f"INSERT INTO {tab}(adresse_id,{','.join(zeilen_rolle)}) VALUES(?,{','.join('?' * len(zeilen_rolle))})",
                                   [aid] + [rolle[k] for k in zeilen_rolle])
                        st["neu"] += 1
                elif art == "artikel":
                    if not w(z, "artikelnr"):
                        st["leer"] += 1
                        continue
                    bez = w(z, "bezeichnung") or w(z, "kurz")          # myfactory-Bericht: nur „Kurzbezeichnung“ (bis 100 Zeichen)
                    if not bez:
                        raise ValueError("Bezeichnung leer")
                    if w(z, "bezeichnung2"):
                        bez += " " + w(z, "bezeichnung2")
                    typ = w(z, "typ")
                    if "lagerfuehrung" in zu:
                        lf = janein(w(z, "lagerfuehrung"))
                    else:
                        lf = 0 if typ in ARTIKELTYP_OHNE_LAGER else 1
                    if w(z, "steuer_pct"):
                        steuer = zahl(w(z, "steuer_pct"))
                    else:
                        steuer = STEUERKLASSE.get(w(z, "steuerklasse"), 19)
                    d = dict(artikelnr=w(z, "artikelnr"), kurz=(w(z, "kurz") if w(z, "bezeichnung") else "")[:30] or bez[:30], bezeichnung=bez,
                             me=w(z, "me") or "Stk", gruppe=w(z, "gruppe") or None, vk_preis=zahl(w(z, "vk_preis")) or 0,
                             ek_preis=zahl(w(z, "ek_preis")) or 0, steuer_pct=steuer, meldebestand=zahl(w(z, "meldebestand")) or 0,
                             lagerfuehrung=lf, inaktiv=janein(w(z, "inaktiv")) if "inaktiv" in zu else 0)
                    if "vk_preis" not in zu:                         # Bericht ohne Preise: vorhandene Preise nicht auf 0 setzen
                        del d["vk_preis"]
                    vorh = db.execute("SELECT id, arbeitsplan, memo FROM artikel WHERE artikelnr=?", (d["artikelnr"],)).fetchone()
                    # Lohnfertigung: Artikelgruppe = Arbeitsgang → als Arbeitsplan vorbelegen (nur wenn noch keiner gepflegt ist)
                    if typ in ARTIKELTYP_LEISTUNG and d["gruppe"] and d["gruppe"] not in GRUPPE_KEIN_ARBEITSGANG and not (vorh and vorh["arbeitsplan"]):
                        d["arbeitsplan"] = json.dumps([{"nr": "", "text": d["gruppe"], "toleranz": "", "pruef": False}], ensure_ascii=False)
                    b_roh = zahl(w(z, "bestand"))
                    if not lf and b_roh and not (vorh and vorh["memo"]):
                        d["memo"] = (f"myfactory-Bestand am {dt.date.today():%d.%m.%Y}: {w(z, 'bestand')} {d['me']}"
                                     + (" Kundenmaterial ohne Charge – beim nächsten Wareneingang mit Charge erfassen." if typ in ARTIKELTYP_KUNDENMATERIAL
                                        else " (ohne Lagerführung nicht als Bestand übernommen)"))
                    if vorh:
                        db.execute(f"UPDATE artikel SET {', '.join(k + '=?' for k in d)} WHERE id=?", list(d.values()) + [vorh["id"]])
                        aid = vorh["id"]
                        st["aktualisiert"] += 1
                    else:
                        aid = db.execute(f"INSERT INTO artikel({','.join(d)}) VALUES({','.join('?' * len(d))})", list(d.values())).lastrowid
                        st["neu"] += 1
                    b = zahl(w(z, "bestand")) if lf else None
                    if b:
                        ist = erp.bestand(db, aid)
                        if abs(b - ist) > 1e-9:
                            db.execute("INSERT INTO lagerbewegung(datum,artikel_id,lager_id,menge,text) VALUES(?,?,1,?,?)",
                                       (erp.heute(), aid, b - ist, "Bestandsübernahme myfactory"))
                else:   # offene Posten
                    if not w(z, "belegnr"):
                        st["leer"] += 1
                        continue
                    debitor = art == "op-kunden"
                    tab, sp = ("kunde", "kundennr") if debitor else ("lieferant", "lieferantennr")
                    p = db.execute(f"SELECT adresse_id FROM {tab} WHERE {sp}=?", (w(z, "partnernr"),)).fetchone()
                    if not p:
                        raise ValueError(f"{'Kunde' if debitor else 'Lieferant'} unbekannt – zuerst Stammdaten importieren")
                    betrag = zahl(w(z, "betrag"))
                    offen = zahl(w(z, "offen")) if w(z, "offen") else betrag
                    bdat = datum(w(z, "datum")) or erp.heute()
                    faellig = datum(w(z, "faellig")) or bdat
                    nummer = ("ALT-" if debitor else "ALT-ER-") + w(z, "belegnr")
                    if db.execute("SELECT 1 FROM beleg WHERE nummer=?", (nummer,)).fetchone():
                        st["aktualisiert"] += 1
                        continue
                    bid = db.execute("""INSERT INTO beleg(belegart,nummer,status,datum,adresse_id,betreff,netto,steuer,brutto,angelegt,angelegt_von,verarbeitet,verarbeitet_von)
                                        VALUES(?,?,'verarbeitet',?,?,?,?,0,?,?,'import',?,'import')""",
                                     ("RE" if debitor else "ER", nummer, bdat, p["adresse_id"], "Übernahme offener Posten aus myfactory",
                                      betrag, betrag, erp.jetzt(), erp.jetzt())).lastrowid
                    db.execute("INSERT INTO offener_posten(art,beleg_id,adresse_id,datum,faellig,betrag,offen) VALUES(?,?,?,?,?,?,?)",
                               ("debitor" if debitor else "kreditor", bid, p["adresse_id"], bdat, faellig, betrag, offen))
                    st["neu"] += 1
            except (ValueError, TypeError, erp.Fehler) as e:
                st["fehler"] += 1
                if len(fehlerzeilen) < 50:
                    fehlerzeilen.append(f"Zeile {nr}: {e}")   # bewusst ohne Inhalt der Zeile
            except Exception as e:      # z. B. doppelte Nummer
                st["fehler"] += 1
                if len(fehlerzeilen) < 50:
                    fehlerzeilen.append(f"Zeile {nr}: {type(e).__name__}: {str(e).split(':')[0]}")
        if ausfuehren:
            db.execute("COMMIT")
        else:
            db.execute("ROLLBACK")
    except Exception:
        db.execute("ROLLBACK")
        raise
    for f in fehlerzeilen:
        protokoll("  " + f)
    protokoll(f"Ergebnis: {st['neu']} neu · {st['aktualisiert']} aktualisiert · {st['fehler']} Fehler · {st['leer']} leere Zeilen übersprungen")
    protokoll("→ AUSGEFÜHRT, Daten gespeichert." if ausfuehren else "→ PROBELAUF, nichts gespeichert. Zum Übernehmen mit --ausfuehren starten.")
    return st


# myfactory-Artikeltypen: was hat eigenen Lagerbestand, was ist Leistung (Lohnbearbeitung), was gehört dem Kunden
ARTIKELTYP_OHNE_LAGER = {"Stückliste", "Rohstoff", "Dienstleistung", "Artikel ohne Bestandsführung"}
ARTIKELTYP_LEISTUNG = {"Stückliste"}
ARTIKELTYP_KUNDENMATERIAL = {"Rohstoff"}
GRUPPE_KEIN_ARBEITSGANG = {"Allgemein", "Sonstiges", "Sonstige"}
STEUERKLASSE = {"1": 19, "2": 7, "0": 0, "3": 0}     # myfactory-Standard: 1 = voll, 2 = ermäßigt


LAENDER = {"deutschland": "DE", "österreich": "AT", "oesterreich": "AT", "schweiz": "CH", "niederlande": "NL", "belgien": "BE",
           "frankreich": "FR", "italien": "IT", "polen": "PL", "luxemburg": "LU", "dänemark": "DK", "tschechische republik": "CZ",
           "spanien": "ES", "usa": "US", "großbritannien": "GB"}


def _land(s):
    s = (s or "").strip()
    if not s:
        return "DE"
    if len(s) == 2:
        return s.upper()
    return LAENDER.get(s.lower(), s[:2].upper())


def main():
    ap = argparse.ArgumentParser(description="myfactory-Exporte nach V3D ERP übernehmen (Probelauf ohne --ausfuehren).")
    ap.add_argument("art", choices=list(FELDER))
    ap.add_argument("datei")
    ap.add_argument("--db", default=os.path.expanduser("~/.local/share/v3d-erp/erp.db"))
    ap.add_argument("--ausfuehren", action="store_true", help="Daten wirklich speichern")
    a = ap.parse_args()
    db = erp.verbinden(a.db)
    erp.schema_anlegen(db)
    try:
        importieren(db, a.art, a.datei, a.ausfuehren)
    except erp.Fehler as e:
        print("FEHLER:", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
