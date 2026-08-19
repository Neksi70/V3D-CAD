#!/usr/bin/env python3
# Sucht die Verknuepfungen zusammen, die auf einem Windows angelegt wurden.
#
# Beruecksichtigt beide Ebenen: was fuer ALLE Benutzer angelegt wurde
# (ProgramData) und was nur fuer den angemeldeten (AppData).  Ein Installer
# legt je nach Einstellung das eine oder das andere an - wer nur eine Ebene
# liest, uebersieht die Haelfte.
#
# Neben .lnk werden .url (Internet-Verknuepfungen, eine INI-Datei) gelesen.

import configparser
import datetime
import os

import lnk
import windowsteile

# Name des Bereichs -> (Umgebungsvariable, Unterpfad, nur dieser Benutzer?)
BEREICHE = [
    ("Startmenue (alle Benutzer)", "PROGRAMDATA",
     r"Microsoft\Windows\Start Menu\Programs", False),
    ("Startmenue (Benutzer)", "APPDATA",
     r"Microsoft\Windows\Start Menu\Programs", True),
    ("Desktop (alle Benutzer)", "PUBLIC", "Desktop", False),
    ("Desktop (Benutzer)", "USERPROFILE", "Desktop", True),
    ("Autostart (alle Benutzer)", "PROGRAMDATA",
     r"Microsoft\Windows\Start Menu\Programs\StartUp", False),
    ("Autostart (Benutzer)", "APPDATA",
     r"Microsoft\Windows\Start Menu\Programs\StartUp", True),
    ("Taskleiste", "APPDATA",
     r"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar", True),
    ("Startmenue angeheftet", "APPDATA",
     r"Microsoft\Internet Explorer\Quick Launch\User Pinned\StartMenu", True),
    ("Schnellstart", "APPDATA",
     r"Microsoft\Internet Explorer\Quick Launch", True),
    ("Senden an", "APPDATA", r"Microsoft\Windows\SendTo", True),
]

# Autostart-Ordner liegen INNERHALB des Startmenues.  Ohne diese Liste
# erschiene jede Autostart-Verknuepfung zweimal, einmal je Bereich.
UNTERGEORDNET = {
    "Startmenue (alle Benutzer)": ["Autostart (alle Benutzer)"],
    "Startmenue (Benutzer)": ["Autostart (Benutzer)"],
    "Schnellstart": ["Taskleiste", "Startmenue angeheftet"],
}


def orte(umgebung=None):
    """Liefert [(Bereichsname, Ordner)] fuer alles, was es hier gibt."""
    umgebung = os.environ if umgebung is None else umgebung
    gefunden = []
    for name, variable, unterpfad, _ in BEREICHE:
        wurzel = umgebung.get(variable)
        if not wurzel:
            continue
        pfad = os.path.join(wurzel, *unterpfad.split("\\"))
        if os.path.isdir(pfad):
            gefunden.append((name, pfad))
    return gefunden


def _url_lesen(pfad):
    """.url ist eine INI-Datei; interessant ist [InternetShortcut] URL."""
    eintrag = {"datei": pfad, "ziel": None, "fehler": None, "argumente": None,
               "arbeitsordner": None, "beschreibung": None, "symbol": None,
               "symbolnummer": None, "fenster": None, "tastenkuerzel": None,
               "laufwerk": None, "rechner": None, "app_kennung": None,
               "ordner": False, "idliste": None, "zielgroesse": None,
               "ziel_geaendert": None, "ziel_erstellt": None,
               "ziel_zugriff": None}
    leser = configparser.RawConfigParser(strict=False)
    leser.optionxform = str
    try:
        with open(pfad, "r", encoding="utf-8", errors="replace") as f:
            leser.read_file(f)
        for abschnitt in leser.sections():
            for schluessel, wert in leser.items(abschnitt):
                if schluessel.lower() == "url":
                    eintrag["ziel"] = wert.strip() or None
                elif schluessel.lower() == "iconfile":
                    eintrag["symbol"] = wert.strip() or None
                elif schluessel.lower() == "iconindex":
                    try:
                        eintrag["symbolnummer"] = int(wert)
                    except ValueError:
                        pass
    except (OSError, configparser.Error) as e:
        eintrag["fehler"] = str(e)
    return eintrag


def _zeit(stempel):
    try:
        return datetime.datetime.fromtimestamp(stempel)
    except (OverflowError, OSError, ValueError):
        return None


def scannen(orte_liste, auf_fehler=None):
    """Alle Verknuepfungen unterhalb der angegebenen Orte einlesen.

    Eine kaputte Datei darf den Durchlauf nicht beenden - sie kommt mit
    ihrem Fehlertext in die Liste und wird im Bericht als solche gezeigt."""
    ergebnis = []
    schon_gesehen = set()
    for bereich, wurzel in orte_liste:
        ausnehmen = _unterordner_anderer_bereiche(bereich, orte_liste)
        for ordner, unterordner, dateien in os.walk(wurzel):
            unterordner[:] = [u for u in unterordner
                              if os.path.normcase(os.path.join(ordner, u))
                              not in ausnehmen]
            for datei in dateien:
                endung = os.path.splitext(datei)[1].lower()
                if endung not in (".lnk", ".url"):
                    continue
                voll = os.path.join(ordner, datei)
                kennung = os.path.normcase(os.path.abspath(voll))
                if kennung in schon_gesehen:
                    continue
                schon_gesehen.add(kennung)
                try:
                    eintrag = _url_lesen(voll) if endung == ".url" \
                        else lnk.lesen(voll)
                except Exception as e:                # noqa: BLE001
                    if auf_fehler:
                        auf_fehler(voll, e)
                    eintrag = {"datei": voll, "ziel": None, "fehler": str(e)}
                eintrag["bereich"] = bereich
                eintrag["art"] = "Internet" if endung == ".url" else "Programm"
                eintrag["anzeigename"] = os.path.splitext(datei)[0]
                unterpfad = os.path.relpath(ordner, wurzel)
                eintrag["gruppe"] = "" if unterpfad == "." else \
                    unterpfad.replace(os.sep, " / ")
                try:
                    zustand = os.stat(voll)
                    eintrag["angelegt"] = _zeit(zustand.st_ctime)
                    eintrag["geaendert"] = _zeit(zustand.st_mtime)
                except OSError:
                    eintrag["angelegt"] = eintrag["geaendert"] = None
                ergebnis.append(eintrag)
    ergebnis.sort(key=lambda e: (e.get("bereich", ""), e.get("gruppe", ""),
                                 (e.get("anzeigename") or "").lower()))
    return kennzeichnen(ergebnis)


def kennzeichnen(eintraege, umgebung=None):
    """Vermerken, welche Verknuepfung auf ein Windows-eigenes Programm
    zeigt - eine Kachel fuer den Editor sagt nichts darueber, was auf diesem
    Rechner installiert wurde.  Aussortiert wird erst bei der Anzeige."""
    for e in eintraege:
        e["windows_eigen"] = windowsteile.ist_windows_verknuepfung(e, umgebung)
    return eintraege


def _unterordner_anderer_bereiche(bereich, orte_liste):
    """Ordner, die als eigener Bereich gefuehrt werden, hier auslassen."""
    nach_name = dict(orte_liste)
    return {os.path.normcase(nach_name[n])
            for n in UNTERGEORDNET.get(bereich, []) if n in nach_name}


def ziel_pruefen(eintraege):
    """Zeigt die Verknuepfung ins Leere?  Das ist der haeufigste Befund nach
    einer Deinstallation und deshalb im Bericht eine eigene Spalte."""
    for e in eintraege:
        ziel = e.get("ziel")
        if not ziel or e.get("art") == "Internet":
            e["ziel_fehlt"] = None
            continue
        if ziel.startswith("\\\\"):
            e["ziel_fehlt"] = None            # Netzpfad: nicht pruefbar
            continue
        pfad = os.path.expandvars(ziel)
        if "%" in pfad:
            e["ziel_fehlt"] = None            # Variable nicht aufloesbar
            continue
        e["ziel_fehlt"] = not os.path.exists(pfad)
    return eintraege


def lesen():
    return ziel_pruefen(scannen(orte()))


if __name__ == "__main__":
    import json
    for e in lesen():
        print(json.dumps(e, ensure_ascii=False, default=str))
