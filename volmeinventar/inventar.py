#!/usr/bin/env python3
# VolmeInventar - Kern.  Liest, was auf einem Windows installiert ist und
# welche Verknuepfungen dafuer angelegt wurden.
#
#   python inventar.py                      Bericht als HTML, oeffnet ihn
#   python inventar.py -o bestand.html      Ziel selbst bestimmen
#   python inventar.py --format csv         stattdessen CSV (zwei Dateien)
#   python inventar.py --format json        alles als JSON
#   python inventar.py --nur programme      nur der eine Teil
#   python inventar.py --leise              nichts oeffnen, nur schreiben
#
# Der Aufruf braucht keine Administratorrechte.  Ohne sie fehlen lediglich
# Verknuepfungen anderer Benutzerkonten - darauf weist der Bericht hin.

import argparse
import datetime
import getpass
import os
import platform
import socket
import sys

BASIS = os.path.dirname(os.path.abspath(__file__))
if BASIS not in sys.path:
    sys.path.insert(0, BASIS)

FASSUNG = "1.0"


def rechner_angaben():
    """Kopfzeile des Berichts: wo und wann wurde das aufgenommen."""
    angaben = {
        "rechner": socket.gethostname(),
        "benutzer": getpass.getuser(),
        "system": " ".join(x for x in (platform.system(),
                                       platform.release()) if x),
        "aufbau": platform.version(),
        "architektur": platform.machine(),
        "zeitpunkt": datetime.datetime.now(),
        "fassung": FASSUNG,
        "administrator": _ist_administrator(),
    }
    angaben["system_name"] = _windows_name() or angaben["system"]
    return angaben


def _ist_administrator():
    try:
        import ctypes
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:                                  # noqa: BLE001
        return False


def _windows_name():
    """"Windows 11 Pro" statt "Windows 10" - die Fassungsnummer allein
    unterscheidet 10 und 11 nicht, dafuer muss die Aufbaunummer her."""
    try:
        import winreg
        with winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\Windows NT\CurrentVersion") as k:
            name = winreg.QueryValueEx(k, "ProductName")[0]
            try:
                aufbau = int(winreg.QueryValueEx(k, "CurrentBuildNumber")[0])
            except (OSError, ValueError):
                aufbau = 0
            if aufbau >= 22000 and "11" not in name:
                name = name.replace("Windows 10", "Windows 11")
            try:
                anzeige = winreg.QueryValueEx(k, "DisplayVersion")[0]
                name = f"{name} {anzeige}"
            except OSError:
                pass
            return f"{name} (Aufbau {aufbau})" if aufbau else name
    except Exception:                                  # noqa: BLE001
        return None


def aufnehmen(mit_programmen=True, mit_verknuepfungen=True, mit_store=True,
              melden=None):
    """Bestandsaufnahme.  melden(text) wird fuer den Fortschritt gerufen."""
    melden = melden or (lambda text: None)
    ergebnis = {"angaben": rechner_angaben(), "programme": [],
                "verknuepfungen": [], "hinweise": []}

    if mit_programmen:
        melden("Lese installierte Programme aus der Registry ...")
        try:
            import programme as _programme
            ergebnis["programme"] = _programme.lesen(mit_store=mit_store)
            melden(f"{len(ergebnis['programme'])} Programme gefunden.")
        except RuntimeError as e:
            ergebnis["hinweise"].append(str(e))
        except Exception as e:                         # noqa: BLE001
            ergebnis["hinweise"].append(f"Programme unvollstaendig: {e}")

    if mit_verknuepfungen:
        melden("Suche Verknuepfungen ...")
        import verknuepfungen as _verknuepfungen
        orte = _verknuepfungen.orte()
        fehler = []
        eintraege = _verknuepfungen.scannen(
            orte, auf_fehler=lambda p, e: fehler.append(f"{p}: {e}"))
        _verknuepfungen.ziel_pruefen(eintraege)
        ergebnis["verknuepfungen"] = eintraege
        ergebnis["orte"] = orte
        melden(f"{len(eintraege)} Verknuepfungen in {len(orte)} Orten gefunden.")
        ergebnis["hinweise"].extend(fehler[:20])

    if not ergebnis["angaben"]["administrator"]:
        ergebnis["hinweise"].append(
            "Ohne Administratorrechte gelesen: Verknuepfungen und "
            "benutzereigene Programme ANDERER Konten sind nicht enthalten.")
    ergebnis["kennzahlen"] = kennzahlen(ergebnis)
    return ergebnis


def kennzahlen(bestand):
    """Die Zahlen fuer den Kopf des Berichts."""
    programme_ = bestand["programme"]
    verweise = bestand["verknuepfungen"]
    return {
        "programme": len(programme_),
        "store_apps": sum(1 for p in programme_ if p.get("art") == "Store-App"),
        "nur_benutzer": sum(1 for p in programme_
                            if p.get("quelle") == "Benutzer"),
        "verknuepfungen": len(verweise),
        "autostart": sum(1 for v in verweise
                         if "Autostart" in (v.get("bereich") or "")),
        "ziel_fehlt": sum(1 for v in verweise if v.get("ziel_fehlt")),
        "unlesbar": sum(1 for v in verweise if v.get("fehler")),
    }


def hauptprogramm(argumente=None):
    zerleger = argparse.ArgumentParser(
        prog="VolmeInventar",
        description="Liest installierte Programme und angelegte "
                    "Verknuepfungen eines Windows-Rechners aus.")
    zerleger.add_argument("-o", "--ausgabe", help="Zieldatei")
    zerleger.add_argument("--format", choices=("html", "csv", "json"),
                          default="html")
    zerleger.add_argument("--nur", choices=("programme", "verknuepfungen"),
                          help="nur diesen Teil aufnehmen")
    zerleger.add_argument("--ohne-store", action="store_true",
                          help="Store-Apps auslassen")
    zerleger.add_argument("--leise", action="store_true",
                          help="Bericht nicht im Browser oeffnen")
    zerleger.add_argument("--oberflaeche", action="store_true",
                          help="Fenster statt Kommandozeile")
    werte = zerleger.parse_args(argumente)

    if werte.oberflaeche:
        import oberflaeche
        return oberflaeche.starten()

    bestand = aufnehmen(
        mit_programmen=werte.nur != "verknuepfungen",
        mit_verknuepfungen=werte.nur != "programme",
        mit_store=not werte.ohne_store,
        melden=lambda t: print(t, file=sys.stderr))

    import bericht
    ziel = werte.ausgabe or bericht.name_vorschlagen(bestand, werte.format)
    geschrieben = bericht.schreiben(bestand, ziel, werte.format)
    for datei in geschrieben:
        print(datei)
    if not werte.leise and werte.format == "html":
        _oeffnen(geschrieben[0])
    return 0


def _oeffnen(pfad):
    try:
        if platform.system() == "Windows":
            os.startfile(pfad)                        # noqa: S606
        else:
            import webbrowser
            webbrowser.open("file://" + os.path.abspath(pfad))
    except Exception:                                  # noqa: BLE001
        pass


if __name__ == "__main__":
    sys.exit(hauptprogramm())
