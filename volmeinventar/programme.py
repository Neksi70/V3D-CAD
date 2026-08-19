#!/usr/bin/env python3
# Liest, welche Programme auf diesem Windows installiert sind.
#
# Quellen, in dieser Reihenfolge:
#   1. Deinstallations-Eintraege der Registry (das, was "Apps & Features" zeigt)
#      - je einmal in der 64- und in der 32-Bit-Sicht, sonst fehlt die Haelfte
#      - je einmal fuer den Rechner (HKLM) und fuer den Benutzer (HKCU)
#   2. Store-/UWP-Pakete, die dort gar nicht auftauchen
#
# Die Auswertung (Filter, Datumsformat, Paketnamen) steht bewusst in eigenen
# Funktionen ohne Registry-Zugriff - nur so laesst sie sich ausserhalb von
# Windows pruefen.

import datetime
import os
import platform

IST_WINDOWS = platform.system() == "Windows"

DEINSTALL_PFAD = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
UWP_PFAD = (r"Software\Classes\Local Settings\Software\Microsoft\Windows"
            r"\CurrentVersion\AppModel\Repository\Packages")

# Werte, die wir aus einem Deinstallations-Eintrag uebernehmen:
# Registry-Name -> unser Feldname
FELDER = {
    "DisplayName": "name",
    "DisplayVersion": "fassung",
    "Publisher": "hersteller",
    "InstallLocation": "ordner",
    # NICHT "quelle" nennen: so heisst schon die Registry-Wurzel
    # (Rechner/Benutzer), und der zuletzt gesetzte Wert gewinnt.
    "InstallSource": "quelle_pfad",
    "UninstallString": "deinstallation",
    "QuietUninstallString": "deinstallation_still",
    "DisplayIcon": "symbol",
    "HelpLink": "hilfe",
    "URLInfoAbout": "webseite",
    "Comments": "bemerkung",
}


def _als_text(wert):
    if wert is None:
        return None
    if isinstance(wert, bytes):
        wert = wert.decode("utf-16-le", "replace").rstrip("\x00")
    text = str(wert).strip()
    return text or None


def datum_deuten(wert):
    """InstallDate steht als "20240317" da - manchmal aber auch als
    Datum in Landesschreibweise oder als Unsinn.  Nicht Deutbares gibt
    None, damit im Bericht kein erfundenes Datum steht."""
    text = _als_text(wert)
    if not text:
        return None
    text = text.strip()
    if len(text) == 8 and text.isdigit():
        try:
            return datetime.date(int(text[:4]), int(text[4:6]), int(text[6:]))
        except ValueError:
            return None
    for form in ("%d.%m.%Y", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.datetime.strptime(text, form).date()
        except ValueError:
            continue
    return None


def ist_nebeneintrag(werte):
    """Trennt echte Programme von dem, was Windows zusaetzlich in denselben
    Schluessel legt: Updates, Sprachpakete, Bestandteile groesserer Pakete.
    Ohne diesen Filter besteht die Liste zur Haelfte aus Sicherheitsupdates."""
    if not _als_text(werte.get("DisplayName")):
        return True                                   # namenlos = kein Eintrag
    if werte.get("SystemComponent") in (1, "1"):
        return True                                   # ausdruecklich versteckt
    if _als_text(werte.get("ParentKeyName")) or \
            _als_text(werte.get("ParentDisplayName")):
        return True                                   # Teil eines anderen Pakets
    art = (_als_text(werte.get("ReleaseType")) or "").lower()
    if art in ("security update", "update rollup", "hotfix", "update"):
        return True
    # Ein Eintrag ohne jeden Weg zum Deinstallieren ist meist eine Karteileiche.
    if not _als_text(werte.get("UninstallString")) and \
            not _als_text(werte.get("QuietUninstallString")):
        return True
    return False


def paketname_zerlegen(voll):
    """Store-Pakete heissen "Name_Fassung_Architektur__Herausgeber".
    Der angezeigte Name steht in der Registry oft nur als "ms-resource:..."
    (also unaufgeloest) - der Paketname dagegen ist immer da und immer
    zerlegbar, deshalb bauen wir die Angaben daraus."""
    teile = voll.split("_")
    if len(teile) < 2:
        return {"name": voll, "fassung": None, "architektur": None,
                "herausgeber": None}
    name = teile[0]
    fassung = teile[1] if teile[1] and teile[1][0].isdigit() else None
    architektur = teile[2] if len(teile) > 2 and teile[2] else None
    if architektur in ("neutral", ""):
        architektur = None
    herausgeber = teile[-1] or None
    # Vor der Herausgeberkennung steht ein leeres Feld (doppelter Unterstrich).
    if herausgeber == name:
        herausgeber = None
    return {"name": name, "fassung": fassung, "architektur": architektur,
            "herausgeber": herausgeber}


# ------------------------------------------------------------ Registry-Teil
def _werte_lesen(schluessel):
    import winreg
    werte = {}
    anzahl = winreg.QueryInfoKey(schluessel)[1]
    for i in range(anzahl):
        try:
            name, wert, _ = winreg.EnumValue(schluessel, i)
        except OSError:
            continue
        werte[name] = wert
    return werte


def _zweig_lesen(wurzel, sicht, quelle):
    """Einen Deinstallations-Zweig durchgehen.  sicht ist die 32- oder
    64-Bit-Sicht der Registry - beide braucht man, weil ein 64-Bit-Windows
    32-Bit-Programme in einem eigenen Zweig fuehrt."""
    import winreg
    gefunden = []
    try:
        zweig = winreg.OpenKey(wurzel, DEINSTALL_PFAD, 0,
                               winreg.KEY_READ | sicht)
    except OSError:
        return gefunden
    with zweig:
        anzahl = winreg.QueryInfoKey(zweig)[0]
        for i in range(anzahl):
            try:
                name = winreg.EnumKey(zweig, i)
                with winreg.OpenKey(zweig, name, 0,
                                    winreg.KEY_READ | sicht) as unter:
                    werte = _werte_lesen(unter)
            except OSError:
                continue
            if ist_nebeneintrag(werte):
                continue
            gefunden.append(_eintrag_bauen(name, werte, quelle, sicht))
    return gefunden


def _eintrag_bauen(schluessel, werte, quelle, sicht):
    import winreg
    eintrag = {feld: _als_text(werte.get(reg)) for reg, feld in FELDER.items()}
    eintrag["schluessel"] = schluessel
    eintrag["quelle"] = quelle
    eintrag["bitheit"] = "32-Bit" if sicht == winreg.KEY_WOW64_32KEY else "64-Bit"
    eintrag["installiert_am"] = datum_deuten(werte.get("InstallDate"))
    groesse = werte.get("EstimatedSize")
    eintrag["groesse_kb"] = int(groesse) if isinstance(groesse, int) else None
    # Ein Schluessel in GUID-Form heisst: von Windows Installer eingerichtet.
    eintrag["msi_kennung"] = schluessel if schluessel.startswith("{") \
        and schluessel.endswith("}") else None
    eintrag["art"] = "Programm"
    return eintrag


def _uwp_lesen():
    """Store-Apps.  Sie stehen in keinem Deinstallations-Zweig; ohne diesen
    Schritt fehlen auf einem frischen Windows 11 gut 30 Eintraege."""
    import winreg
    gefunden = []
    try:
        zweig = winreg.OpenKey(winreg.HKEY_CURRENT_USER, UWP_PFAD, 0,
                               winreg.KEY_READ)
    except OSError:
        return gefunden
    with zweig:
        anzahl = winreg.QueryInfoKey(zweig)[0]
        for i in range(anzahl):
            try:
                voll = winreg.EnumKey(zweig, i)
                with winreg.OpenKey(zweig, voll) as unter:
                    werte = _werte_lesen(unter)
            except OSError:
                continue
            teile = paketname_zerlegen(voll)
            angezeigt = _als_text(werte.get("DisplayName"))
            if angezeigt and angezeigt.startswith("@{"):
                angezeigt = None            # unaufgeloeste Ressourcen-Angabe
            gefunden.append({
                "name": angezeigt or teile["name"],
                "fassung": teile["fassung"],
                "hersteller": _als_text(werte.get("PublisherDisplayName"))
                              or teile["herausgeber"],
                "ordner": _als_text(werte.get("PackageRootFolder")),
                "schluessel": voll,
                "quelle": "Store (Benutzer)",
                "bitheit": teile["architektur"],
                "art": "Store-App",
                "installiert_am": None,
                "groesse_kb": None,
                "msi_kennung": None,
                "deinstallation": None,
                "deinstallation_still": None,
                "symbol": None, "hilfe": None, "webseite": None,
                "bemerkung": None, "quelle_pfad": None,
            })
    return gefunden


def lesen(mit_store=True):
    """Alle installierten Programme.  Doppelte Eintraege (derselbe Schluessel
    in 32- und 64-Bit-Sicht) werden zusammengefasst."""
    if not IST_WINDOWS:
        raise RuntimeError("Programme lesen geht nur unter Windows")
    import winreg
    alle = []
    for wurzel, quelle in ((winreg.HKEY_LOCAL_MACHINE, "Rechner"),
                           (winreg.HKEY_CURRENT_USER, "Benutzer")):
        for sicht in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
            alle.extend(_zweig_lesen(wurzel, sicht, quelle))
    if mit_store:
        alle.extend(_uwp_lesen())
    return zusammenfassen(alle)


def zusammenfassen(eintraege):
    """Derselbe Schluessel taucht in beiden Registry-Sichten auf, wenn das
    System ihn spiegelt.  Wir behalten den ersten und merken uns nur, dass er
    in beiden Sichten stand."""
    gesehen = {}
    ergebnis = []
    for e in eintraege:
        kennung = (e.get("schluessel"), e.get("quelle"), e.get("name"))
        if kennung in gesehen:
            vorhanden = gesehen[kennung]
            if vorhanden["bitheit"] != e["bitheit"]:
                vorhanden["bitheit"] = "32/64-Bit"
            continue
        gesehen[kennung] = e
        ergebnis.append(e)
    ergebnis.sort(key=lambda e: (e.get("name") or "").lower())
    return ergebnis


if __name__ == "__main__":
    import json
    for e in lesen():
        print(json.dumps(e, ensure_ascii=False, default=str))
