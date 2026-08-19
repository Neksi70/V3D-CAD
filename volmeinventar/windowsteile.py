#!/usr/bin/env python3
# Erkennt, was zu Windows selbst gehoert und deshalb nicht als "installiertes
# Programm" mitgezaehlt werden soll.
#
# Der naheliegende Kurzschluss waere "alles von Microsoft" - der ist falsch:
# Office, Teams, Visual Studio oder der SQL Server stammen ebenfalls von
# Microsoft und sind echte Installationen, die in die Liste gehoeren.
# Erkannt wird deshalb an harten Merkmalen:
#
#   1. Store-Pakete mit Microsofts eigener Herausgeberkennung
#   2. Programme, die IM Windows-Ordner liegen
#   3. eine kurze, nachlesbare Liste mitgelieferter Programme (Edge, OneDrive),
#      die ausserhalb des Windows-Ordners installiert werden
#
# Ausdruecklich NICHT als Merkmal benutzt: der Deinstallations-Befehl.  Der
# zeigt bei jedem MSI-Paket auf C:\Windows\System32\MsiExec.exe - damit waere
# schlagartig jedes MSI-Programm ein Windows-Bestandteil.

import os

# Herausgeberkennungen aus dem Store.  Sie stehen am Ende jedes Paketnamens
# und werden aus dem Signaturzertifikat abgeleitet - anders als der
# Anzeigename lassen sie sich nicht frei waehlen.
MS_STORE_KENNUNGEN = {
    "8wekyb3d8bbwe",    # Microsoft Corporation (Rechner, Fotos, Terminal ...)
    "cw5n1h2txyewy",    # Windows-Systemkomponenten (Startmenue, Suche ...)
}

# Mit Windows 11 ausgeliefert, liegt aber nicht im Windows-Ordner.  Bewusst
# kurz gehalten: was hier faelschlich landet, verschwindet aus der Liste.
WINDOWS_NAMEN = (
    "microsoft edge",                  # deckt auch Update und WebView2 ab
    "microsoft onedrive",
    "microsoft update health tools",
)


def windows_ordner(umgebung=None):
    umgebung = os.environ if umgebung is None else umgebung
    return (umgebung.get("SystemRoot") or umgebung.get("windir")
            or r"C:\Windows")


def _norm(pfad):
    """Windows-Pfade vergleichbar machen.  Nicht ueber os.path: die Tests
    laufen auf Linux, wo weder der Backslash noch die Gleichheit von Gross-
    und Kleinschreibung gelten."""
    if not pfad:
        return ""
    return str(pfad).strip().strip('"').replace("/", "\\").rstrip("\\").lower()


def _aufloesen(pfad, umgebung):
    """%SystemRoot% und Konsorten ersetzen.  Nicht ueber ntpath.expandvars -
    das nimmt immer die echte Umgebung, geprueft wird aber gegen eine
    gestellte."""
    if not pfad or "%" not in pfad:
        return pfad
    teile = str(pfad).split("%")
    if len(teile) % 2 == 0:            # ungerade Anzahl % - nichts anfassen
        return pfad
    for i in range(1, len(teile), 2):
        wert = umgebung.get(teile[i]) or umgebung.get(teile[i].upper())
        teile[i] = wert if wert else "%" + teile[i] + "%"
    return "".join(teile)


def _liegt_in(pfad, ordner):
    p, o = _norm(pfad), _norm(ordner)
    if not p or not o:
        return False
    # Der Trennstrich muss mitgeprueft werden, sonst gilt "C:\Windows Alt"
    # als Teil von "C:\Windows".
    return p == o or p.startswith(o + "\\")


def _ist_ms_paket(kennung):
    """Aus einer AppUserModelID oder einem Paketnamen die Herausgeberkennung
    ziehen: "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"."""
    if not kennung:
        return False
    familie = str(kennung).split("!")[0]
    return familie.rsplit("_", 1)[-1].lower() in MS_STORE_KENNUNGEN


def ist_windows_programm(eintrag, umgebung=None):
    umgebung = os.environ if umgebung is None else umgebung
    if str(eintrag.get("store_kennung") or "").lower() in MS_STORE_KENNUNGEN:
        return True
    name = (eintrag.get("name") or "").strip().lower()
    if any(name.startswith(w) for w in WINDOWS_NAMEN):
        return True
    ordner = _aufloesen(eintrag.get("ordner"), umgebung)
    return _liegt_in(ordner, windows_ordner(umgebung))


def ist_windows_verknuepfung(eintrag, umgebung=None):
    umgebung = os.environ if umgebung is None else umgebung
    if eintrag.get("art") == "Internet":
        return False                       # eine Adresse ist kein Programm
    if _ist_ms_paket(eintrag.get("app_kennung")):
        return True
    ziel = _aufloesen(eintrag.get("ziel"), umgebung)
    return _liegt_in(ziel, windows_ordner(umgebung))
