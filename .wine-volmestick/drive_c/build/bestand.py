#!/usr/bin/env python3
# VolmeStick - Abgleich mit dem, was schon auf dem Server liegt.
#
# Zweck: ein 7-GB-Abbild soll man nicht zweimal ziehen. Zwei Fragen sind zu
# beantworten:
#   1. Liegt genau diese Datei schon da (und ist sie vollstaendig)?
#   2. Liegt eine aeltere Fassung desselben Abbilds da? Dann ist der Download
#      ein Versionswechsel und lohnt sich - z. B. Win11_24H2 -> Win11_25H2.
#
# Dafuer wird aus dem Dateinamen eine "Familie" gebildet: alle versionsartigen
# Bestandteile werden ausgeblendet, der Rest muss uebereinstimmen. Wichtig ist,
# dass "Win10" und "Win11" dabei NICHT zusammenfallen - deshalb gelten nur
# eigenstaendige Zahl-Bausteine als Version, nicht Ziffern innerhalb eines Wortes.

import os
import re

TRENNER = re.compile(r"[._\-\s]+")
VERSION_MUSTER = (
    re.compile(r"^\d+(\.\d+)+$"),        # 24.04, 13.6.0, 2026.08.01
    re.compile(r"^\d{2}H\d$", re.I),     # 25H2, 24H2
    re.compile(r"^\d+$"),                # 44, 10, 9
    re.compile(r"^v\d+(\.\d+)*$", re.I),  # v3, v1.2
    re.compile(r"^\d{8}$"),              # 20260801
)


def _ist_version(baustein):
    return any(m.match(baustein) for m in VERSION_MUSTER)


def familie(dateiname):
    """Dateiname ohne die versionsartigen Bausteine - der Fingerabdruck
    eines Abbilds ueber Fassungen hinweg."""
    grund = re.sub(r"\.iso$", "", os.path.basename(dateiname), flags=re.I)
    teile = []
    for b in TRENNER.split(grund):
        if not b:
            continue
        if _ist_version(b):
            # Benachbarte Zahlbausteine zu EINEM Platzhalter zusammenfassen -
            # sonst gilt 26.04 (zwei Zahlen) als andere Familie als 24.04.4 (drei).
            if teile and teile[-1] == "#":
                continue
            teile.append("#")
        else:
            teile.append(b.lower())
    return "|".join(teile)


def versionsschluessel(dateiname):
    """Vergleichbarer Wert aus den Versionsbausteinen - fuer 'neuer als'."""
    grund = re.sub(r"\.iso$", "", os.path.basename(dateiname), flags=re.I)
    werte = []
    for b in TRENNER.split(grund):
        if not b or not _ist_version(b):
            continue
        m = re.match(r"^(\d{2})H(\d)$", b, re.I)     # 25H2 -> (25, 2)
        if m:
            werte += [int(m.group(1)), int(m.group(2))]
            continue
        werte += [int(t) for t in b.lstrip("vV").split(".") if t.isdigit()]
    return werte


def ist_neuer(angeboten, vorhanden):
    a, v = versionsschluessel(angeboten), versionsschluessel(vorhanden)
    return a > v


def sammeln(ordner):
    """Alle Abbilder in den angegebenen Ordnern einlesen."""
    bestand = []
    for o in ordner:
        if not os.path.isdir(o):
            continue
        for name in os.listdir(o):
            if not name.lower().endswith((".iso", ".img")):
                continue
            pfad = os.path.join(o, name)
            try:
                bestand.append({"name": name, "pfad": pfad,
                                "groesse": os.path.getsize(pfad),
                                "familie": familie(name)})
            except OSError:
                continue
    return bestand


def abgleichen(dateien, ordner, groesse_holen=None):
    """Ergaenzt jedes Angebot um den Bestandsvergleich.

    groesse_holen(uri) -> Bytes oder None; wird nur fuer bereits vorhandene
    Dateien aufgerufen, um Bruchstuecke zu erkennen.
    """
    bestand = sammeln(ordner)
    nach_name = {b["name"].lower(): b for b in bestand}
    for d in dateien:
        name = os.path.basename(str(d.get("name", "")).split("  ")[0]).strip()
        treffer = nach_name.get(name.lower())
        if treffer:
            fern = groesse_holen(d["uri"]) if groesse_holen else None
            vollstaendig = (fern is None) or (fern == treffer["groesse"])
            d["vorhanden"] = {"pfad": treffer["pfad"],
                              "groesse": treffer["groesse"],
                              "vollstaendig": vollstaendig,
                              "erwartet": fern}
            continue
        fam = familie(name)
        aeltere = [b for b in bestand
                   if b["familie"] == fam and not ist_neuer(b["name"], name)]
        if aeltere:
            d["ersetzt"] = sorted(b["name"] for b in aeltere)
    return dateien
