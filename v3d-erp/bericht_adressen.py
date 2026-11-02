#!/usr/bin/env python3
"""Adressbericht aus myfactory („Adresse;Kommunikation“, eine Zelle je Adresse) → CSV mit Einzelspalten für import_myfactory.py.

myfactory hängt im Bericht Kurzbezeichnung, Adressnummer, Name, Straße, PLZ, Ort, E-Mail und Web ohne Trennzeichen aneinander,
z. B. „MUSTERGMBH  (AD70001)Muster GmbHHauptstraße 1258089 Hagen“. Dieses Skript trennt das nach Regeln
(Rechtsform/Großbuchstabe direkt nach Kleinbuchstabe = Grenze Name|Straße, letzte 5 Ziffern vor dem Ort = PLZ).
Was nicht sicher ist, bekommt in der Spalte „Prüfen“ einen Hinweis – die Ausgabe bitte vor dem Import ansehen.

Aufruf:
  python3 bericht_adressen.py report.csv ausgabe.csv [--rolle-nach-nummer]
    --rolle-nach-nummer: AD7… = Lieferant, sonst Kunde (Hausregel bei GSB; ohne Schalter bleibt „Rolle“ leer)
Die Ausgabe enthält Kundendaten → nicht ins Git, nicht in öffentliche Ordner.
"""
import argparse
import csv
import re
import sys

RECHTSFORM = r"(?:GmbH & Co\.? KGaA|GmbH & Co\.? KG|GmbH&Co\.KG|GmbH|mbH|mbB|AG & Co\. KG|AG|KGaA|KG|SE|e\.K\.|B\.V\.|OHG|UG|Inc\.|Ltd\.)"
HAUSNR = r"\d+\s?[a-zA-Z]?(?:\s?-\s?\d+\s?[a-zA-Z]?)?"


def lesen(pfad):
    roh = open(pfad, "rb").read()
    for kod in ("utf-16", "utf-8-sig", "cp1252"):
        try:
            text = roh.decode(kod)
            if "Adresse" in text[:200]:
                break
        except UnicodeError:
            continue
    zeilen = [z for z in text.splitlines() if z.strip()]
    if zeilen and zeilen[0].lower().startswith("sep="):
        zeilen = zeilen[1:]
    return zeilen[1:]                               # ohne Kopf „Adresse;Kommunikation“


def kommunikation(t):
    k = {}
    for teil in re.split(r"(?=Telefon:|Telefax:|Kommunikation \d+:|Mobil:|E-Mail:)", t):
        m = re.match(r"(Telefon|Telefax|Mobil|E-Mail|Kommunikation \d+):\s*(.*)", teil.strip())
        if m:
            w = m.group(2).strip()
            if "@" in w:
                k.setdefault("email", w)
            elif m.group(1) == "Telefax":
                k.setdefault("fax", w)
            else:
                k.setdefault("telefon", w)
    return k


def zerlegen(zeile):
    adr, _, komm = zeile.rpartition(";")
    out = dict(adressnr="", kurz="", name1="", name2="", strasse="", plz="", ort="", land="DE", email="", web="", notiz="", pruefen=[])
    m = re.match(r"^(?P<kurz>.*?)\s+\((?P<nr>AD\d+)\)(?P<rest>.*)$", adr)
    if not m:
        out.update(name1=adr.strip(), pruefen=["keine Adressnummer"])
        return out
    out["kurz"], out["adressnr"], rest = m["kurz"].strip()[:30], m["nr"], m["rest"]
    k = kommunikation(komm)                         # zuerst – auch Adressen mit unklarer Anschrift behalten Telefon/Mail
    out["telefon"] = k.get("telefon", "")
    if k.get("fax"):
        out["notiz"] = "Fax " + k["fax"]
    # Web und E-Mail am Ende abtrennen
    for muster, feld in [(r"(https?://\S+|www\.\S+)$", "web"), (r"([\w.\-+]+@[\w.\-]+\.[a-z]{2,})$", "email")]:
        for _ in range(2):
            mm = re.search(muster, rest)
            if mm and not out[feld]:
                out[feld] = mm.group(1)
                rest = rest[:mm.start()]
    for land, code in [("NIEDERLANDE", "NL"), ("ÖSTERREICH", "AT"), ("SCHWEIZ", "CH"), ("BELGIEN", "BE"), ("FRANKREICH", "FR"), ("ITALIEN", "IT"), ("POLEN", "PL")]:
        if land in rest:
            out["land"] = code
            out["notiz"] = (out["notiz"] + " " + rest[rest.index(land) + len(land):].strip()).strip()
            rest = rest[:rest.index(land)]
    # PLZ + Ort: deutsch 5 Ziffern, NL „1234 AB“
    plz = None
    if out["land"] == "NL":
        plz = re.search(r"(\d{4}\s?[A-Z]{2})\s?([A-ZÄÖÜ][^\d]*)$", rest)
    else:
        kand = list(re.finditer(r"(\d{5}) ?([A-ZÄÖÜ][^\d@/]*?)(?=\d{5}|$)", rest))
        plz = kand[0] if kand else None
        if len(kand) > 1:                           # „…58300 Wetter58300 “ / Postfach-Doppel
            out["pruefen"].append("PLZ/Ort doppelt")
    if not plz:
        out["pruefen"].append("PLZ/Ort nicht erkannt")
        out["name1"] = rest.strip()
        return out
    out["plz"], out["ort"] = plz.group(1).strip(), plz.group(2).strip().rstrip("/ ").strip()
    vorn = rest[:plz.start()]
    if vorn.endswith("OK"):                          # myfactory-Platzhalter ohne Straße („Gödde GmbHOK50739 Köln“)
        vorn = vorn[:-2]
        out["pruefen"].append("ohne Straße")
    # Straße = letzter Abschnitt, der mit einer Hausnummer endet; Grenze zum Namen über Rechtsform oder Klebestelle
    sm = re.search(rf"^(?P<name>.*?{RECHTSFORM})(?P<str>[A-ZÄÖÜ].*?{HAUSNR})$", vorn)
    if not sm:
        kleb = [k.end() for k in re.finditer(r"[a-zäöüß.)A-ZÄÖÜ](?=[A-ZÄÖÜ][a-zäöüß])", vorn)]
        hn = re.search(rf"{HAUSNR}$", vorn)
        if kleb and hn and kleb[-1] < hn.start():
            g = kleb[-1]
            sm = {"name": vorn[:g], "str": vorn[g:]}
    if sm:
        out["name1"], out["strasse"] = sm["name"].strip(), sm["str"].strip()
    elif "ohne Straße" in out["pruefen"]:
        out["name1"] = vorn.strip()
    else:
        out["name1"] = vorn.strip()
        out["pruefen"].append("Straße nicht abgegrenzt")
    if out["name1"] and out["name1"] == out["kurz"]:
        pass
    # Hausnummer und PLZ kleben zusammen („2242349“) – Plausibilität: Straße endet auf Ziffer
    if out["strasse"] and not re.search(r"\d", out["strasse"]):
        out["pruefen"].append("Straße ohne Hausnummer")
    if k.get("email") and not out["email"]:
        out["email"] = k["email"]
    if out["web"]:
        out["notiz"] = (out["notiz"] + " " + out["web"]).strip()
    return out


SPALTEN = [("adressnr", "Adressnummer"), ("kurz", "Kurzbezeichnung"), ("name1", "Name"), ("name2", "Name (Zusatz)"), ("strasse", "Straße"),
           ("plz", "PLZ"), ("ort", "Ort"), ("land", "Land"), ("telefon", "Telefon"), ("email", "E-Mail"), ("notiz", "Notiz"), ("rolle", "Rolle"),
           ("pruefen", "Prüfen")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("eingabe")
    ap.add_argument("ausgabe")
    ap.add_argument("--rolle-nach-nummer", action="store_true")
    a = ap.parse_args()
    n = unsicher = 0
    with open(a.ausgabe, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow([t for _, t in SPALTEN])
        for z in lesen(a.eingabe):
            d = zerlegen(z)
            if not d["adressnr"]:
                print("übersprungen (ohne Adressnummer): 1 Zeile", file=sys.stderr)
                continue
            d["rolle"] = ("lieferant" if d["adressnr"].startswith("AD7") else "kunde") if a.rolle_nach_nummer else ""
            unsicher += bool(d["pruefen"])
            d["pruefen"] = ", ".join(d["pruefen"])
            w.writerow([d.get(k, "") for k, _ in SPALTEN])
            n += 1
    print(f"{n} Adressen geschrieben, {unsicher} mit Prüfhinweis → {a.ausgabe}")


if __name__ == "__main__":
    main()
