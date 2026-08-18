#!/usr/bin/env python3
"""VolmeKarte - direkt auf den Drucker, ohne Umweg ueber ein PDF.

Warum ueberhaupt: Ein PDF an Windows weiterzureichen ("Drucken"-Verb) laesst
alles offen, worauf es bei einer Karte ankommt - Papierformat, Wenderichtung
und vor allem der Massstab. Der Betrachter skaliert dann gern auf
"an Seite anpassen", und die Karte ist ein paar Millimeter zu klein.

Hier wird stattdessen selbst gedruckt: benutzerdefiniertes Papierformat und
Duplex im DEVMODE gesetzt, dann jede Bogenseite als Rasterbild an genau die
physische Stelle des Blattes gelegt. Der Treiber skaliert nichts mehr.

Nur Windows. Auf anderen Systemen meldet verfuegbar() False, und die
Oberflaeche blendet den Knopf aus.
"""

import ctypes
import platform
import sys

WINDOWS = platform.system() == "Windows"

# --- Konstanten aus der Windows-API ---------------------------------
DM_ORIENTATION = 0x00000001
DM_PAPERSIZE = 0x00000002
DM_PAPERLENGTH = 0x00000004
DM_PAPERWIDTH = 0x00000008
DM_COPIES = 0x00000100
DM_DUPLEX = 0x00001000
DM_COLLATE = 0x00008000
DM_FORMNAME = 0x00010000

DM_OUT_BUFFER = 2
DM_IN_BUFFER = 8

DMPAPER_USER = 256
DMORIENT_PORTRAIT = 1
DMORIENT_LANDSCAPE = 2
DMDUP_SIMPLEX = 1
DMDUP_VERTICAL = 2       # lange Kante
DMDUP_HORIZONTAL = 3     # kurze Kante

HORZRES = 8
VERTRES = 10
LOGPIXELSX = 88
LOGPIXELSY = 90
PHYSICALWIDTH = 110
PHYSICALHEIGHT = 111
PHYSICALOFFSETX = 112
PHYSICALOFFSETY = 113

DIB_RGB_COLORS = 0
SRCCOPY = 0x00CC0020
BI_RGB = 0

# Genormte Papierformate mit ihrer Windows-Kennung. Trifft das Bogenmass
# eines davon, nehmen wir die Kennung statt eines frei gesetzten Masses -
# benannte Formate versteht jeder Treiber, freie laengst nicht jeder.
NORMFORMATE = [
    (210.0, 297.0, 9,   "A4"),
    (297.0, 420.0, 8,   "A3"),
    (148.0, 210.0, 11,  "A5"),
    (105.0, 148.0, 70,  "A6"),
    (176.0, 250.0, 13,  "B5 (ISO)"),
    (250.0, 353.0, 12,  "B4 (ISO)"),
    (215.9, 279.4, 1,   "Letter"),
    (215.9, 355.6, 5,   "Legal"),
    (184.15, 266.7, 7,  "Executive"),
    (110.0, 220.0, 27,  "Umschlag DL"),
    (162.0, 229.0, 28,  "Umschlag C5"),
    (114.0, 162.0, 31,  "Umschlag C6"),
]


def _normformat(breite_mm, hoehe_mm, toleranz=1.0):
    """(Windows-Kennung, Name) wenn das Mass einem Normformat entspricht."""
    gesucht = sorted((breite_mm, hoehe_mm))
    for b, h, kennung, name in NORMFORMATE:
        norm = sorted((b, h))
        if (abs(norm[0] - gesucht[0]) <= toleranz
                and abs(norm[1] - gesucht[1]) <= toleranz):
            return kennung, name
    return None, None


DUPLEX_NACH_WENDEN = {"lang": DMDUP_VERTICAL,
                      "kurz": DMDUP_HORIZONTAL,
                      "manuell": DMDUP_SIMPLEX}


if WINDOWS:
    import ctypes.wintypes as w

    winspool = ctypes.WinDLL("winspool.drv")
    gdi32 = ctypes.WinDLL("gdi32")
    kernel32 = ctypes.WinDLL("kernel32")

    class DEVMODEW(ctypes.Structure):
        _fields_ = [
            ("dmDeviceName", ctypes.c_wchar * 32),
            ("dmSpecVersion", w.WORD), ("dmDriverVersion", w.WORD),
            ("dmSize", w.WORD), ("dmDriverExtra", w.WORD),
            ("dmFields", w.DWORD),
            ("dmOrientation", ctypes.c_short), ("dmPaperSize", ctypes.c_short),
            ("dmPaperLength", ctypes.c_short), ("dmPaperWidth", ctypes.c_short),
            ("dmScale", ctypes.c_short), ("dmCopies", ctypes.c_short),
            ("dmDefaultSource", ctypes.c_short),
            ("dmPrintQuality", ctypes.c_short),
            ("dmColor", ctypes.c_short), ("dmDuplex", ctypes.c_short),
            ("dmYResolution", ctypes.c_short), ("dmTTOption", ctypes.c_short),
            ("dmCollate", ctypes.c_short),
            ("dmFormName", ctypes.c_wchar * 32),
            ("dmLogPixels", w.WORD), ("dmBitsPerPel", w.DWORD),
            ("dmPelsWidth", w.DWORD), ("dmPelsHeight", w.DWORD),
            ("dmDisplayFlags", w.DWORD), ("dmDisplayFrequency", w.DWORD),
            ("dmICMMethod", w.DWORD), ("dmICMIntent", w.DWORD),
            ("dmMediaType", w.DWORD), ("dmDitherType", w.DWORD),
            ("dmReserved1", w.DWORD), ("dmReserved2", w.DWORD),
            ("dmPanningWidth", w.DWORD), ("dmPanningHeight", w.DWORD)]

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [("biSize", w.DWORD), ("biWidth", ctypes.c_long),
                    ("biHeight", ctypes.c_long), ("biPlanes", w.WORD),
                    ("biBitCount", w.WORD), ("biCompression", w.DWORD),
                    ("biSizeImage", w.DWORD),
                    ("biXPelsPerMeter", ctypes.c_long),
                    ("biYPelsPerMeter", ctypes.c_long),
                    ("biClrUsed", w.DWORD), ("biClrImportant", w.DWORD)]

    class SIZEL(ctypes.Structure):
        _fields_ = [("cx", ctypes.c_long), ("cy", ctypes.c_long)]

    class RECTL(ctypes.Structure):
        _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                    ("right", ctypes.c_long), ("bottom", ctypes.c_long)]

    class FORM_INFO_1(ctypes.Structure):
        _fields_ = [("Flags", w.DWORD), ("pName", w.LPWSTR),
                    ("Size", SIZEL), ("ImageableArea", RECTL)]

    class DOCINFOW(ctypes.Structure):
        _fields_ = [("cbSize", ctypes.c_int), ("lpszDocName", w.LPCWSTR),
                    ("lpszOutput", w.LPCWSTR), ("lpszDatatype", w.LPCWSTR),
                    ("fwType", w.DWORD)]

    class PRINTER_INFO_2(ctypes.Structure):
        _fields_ = [
            ("pServerName", w.LPWSTR), ("pPrinterName", w.LPWSTR),
            ("pShareName", w.LPWSTR), ("pPortName", w.LPWSTR),
            ("pDriverName", w.LPWSTR), ("pComment", w.LPWSTR),
            ("pLocation", w.LPWSTR), ("pDevMode", ctypes.c_void_p),
            ("pSepFile", w.LPWSTR), ("pPrintProcessor", w.LPWSTR),
            ("pDatatype", w.LPWSTR), ("pParameters", w.LPWSTR),
            ("pSecurityDescriptor", ctypes.c_void_p),
            ("Attributes", w.DWORD), ("Priority", w.DWORD),
            ("DefaultPriority", w.DWORD), ("StartTime", w.DWORD),
            ("UntilTime", w.DWORD), ("Status", w.DWORD),
            ("cJobs", w.DWORD), ("AveragePPM", w.DWORD)]


def verfuegbar():
    return WINDOWS


def _fehler(was):
    kode = ctypes.get_last_error() if WINDOWS else 0
    return OSError("%s (Windows-Fehler %d)" % (was, kode))


def standarddrucker():
    if not WINDOWS:
        return ""
    puf = ctypes.create_unicode_buffer(512)
    groesse = ctypes.wintypes.DWORD(512)
    if winspool.GetDefaultPrinterW(puf, ctypes.byref(groesse)):
        return puf.value
    return ""


def drucker():
    """Alle lokal bekannten Drucker mit ihrem unbedruckbaren Rand."""
    if not WINDOWS:
        return []
    PRINTER_ENUM_LOCAL, PRINTER_ENUM_CONNECTIONS = 2, 4
    noetig = ctypes.wintypes.DWORD()
    zahl = ctypes.wintypes.DWORD()
    winspool.EnumPrintersW(PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS,
                           None, 2, None, 0, ctypes.byref(noetig),
                           ctypes.byref(zahl))
    if not noetig.value:
        return []
    puffer = ctypes.create_string_buffer(noetig.value)
    if not winspool.EnumPrintersW(PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS,
                                  None, 2, puffer, noetig.value,
                                  ctypes.byref(noetig), ctypes.byref(zahl)):
        return []
    feld = ctypes.cast(puffer, ctypes.POINTER(PRINTER_INFO_2))
    standard = standarddrucker()
    aus = []
    for i in range(zahl.value):
        name = feld[i].pPrinterName
        eintrag = {"name": name, "standard": name == standard,
                   "rand": None, "dpi": None}
        try:
            eintrag["rand"], eintrag["dpi"] = _rand_und_dpi(name)
        except Exception:
            pass
        aus.append(eintrag)
    aus.sort(key=lambda e: (not e["standard"], e["name"].lower()))
    return aus


def _rand_und_dpi(name):
    """Unbedruckbarer Rand in mm (links, oben, rechts, unten) und die
    Auflösung des Druckers. Mit der rendert die Oberflaeche dann 1:1 -
    so muss beim Drucken nichts mehr umgerechnet werden."""
    ic = gdi32.CreateICW("WINSPOOL", name, None, None)
    if not ic:
        return None, None
    try:
        hole = gdi32.GetDeviceCaps
        dpix = hole(ic, LOGPIXELSX) or 600
        dpiy = hole(ic, LOGPIXELSY) or 600
        pb, ph = hole(ic, PHYSICALWIDTH), hole(ic, PHYSICALHEIGHT)
        ox, oy = hole(ic, PHYSICALOFFSETX), hole(ic, PHYSICALOFFSETY)
        bb, bh = hole(ic, HORZRES), hole(ic, VERTRES)
        mm = lambda p, dpi: round(p / dpi * 25.4, 1)
        return ([mm(ox, dpix), mm(oy, dpiy),
                 mm(max(0, pb - ox - bb), dpix),
                 mm(max(0, ph - oy - bh), dpiy)],
                [dpix, dpiy])
    finally:
        gdi32.DeleteDC(ic)


def formulare(name):
    """Papierformate, die der Treiber selbst kennt. Millimeter."""
    if not WINDOWS:
        return []
    griff = ctypes.c_void_p()
    if not winspool.OpenPrinterW(name, ctypes.byref(griff), None):
        return []
    try:
        noetig = ctypes.wintypes.DWORD()
        zahl = ctypes.wintypes.DWORD()
        winspool.EnumFormsW(griff, 1, None, 0, ctypes.byref(noetig),
                            ctypes.byref(zahl))
        if not noetig.value:
            return []
        puffer = ctypes.create_string_buffer(noetig.value)
        if not winspool.EnumFormsW(griff, 1, puffer, noetig.value,
                                   ctypes.byref(noetig), ctypes.byref(zahl)):
            return []
        feld = ctypes.cast(puffer, ctypes.POINTER(FORM_INFO_1))
        # SIZEL zaehlt in Tausendstel Millimetern
        return [{"name": feld[i].pName,
                 "b": feld[i].Size.cx / 1000.0,
                 "h": feld[i].Size.cy / 1000.0}
                for i in range(zahl.value)]
    finally:
        winspool.ClosePrinter(griff)


def _passendes_formular(name, breite_mm, hoehe_mm, toleranz=0.6):
    """Kennt der Treiber das Format schon unter einem Namen? Das ist der weit
    verlaesslichere Weg als ein frei gesetztes Mass - viele Treiber nehmen
    freie Masse nur an, wenn im Treiber ein Formular dafuer angelegt wurde."""
    gesucht = sorted((round(breite_mm, 1), round(hoehe_mm, 1)))
    treffer = None
    for f in formulare(name):
        hat = sorted((round(f["b"], 1), round(f["h"], 1)))
        if (abs(hat[0] - gesucht[0]) <= toleranz
                and abs(hat[1] - gesucht[1]) <= toleranz):
            # Genauester Treffer gewinnt
            abstand = abs(hat[0] - gesucht[0]) + abs(hat[1] - gesucht[1])
            if treffer is None or abstand < treffer[0]:
                treffer = (abstand, f["name"])
    return treffer[1] if treffer else None


def _devmode(name, breite_mm, hoehe_mm, duplex, kopien):
    """DEVMODE des Druckers holen und auf unsere Karte umstellen."""
    griff = ctypes.c_void_p()
    if not winspool.OpenPrinterW(name, ctypes.byref(griff), None):
        raise _fehler("Drucker „%s“ lässt sich nicht öffnen" % name)
    try:
        noetig = winspool.DocumentPropertiesW(None, griff, name, None, None, 0)
        if noetig <= 0:
            raise _fehler("Die Druckereinstellungen sind nicht lesbar")
        puffer = ctypes.create_string_buffer(noetig)
        if winspool.DocumentPropertiesW(None, griff, name, puffer, None,
                                        DM_OUT_BUFFER) < 0:
            raise _fehler("Die Druckereinstellungen sind nicht lesbar")
        dm = ctypes.cast(puffer, ctypes.POINTER(DEVMODEW)).contents

        quer = breite_mm > hoehe_mm
        dm.dmFields |= (DM_ORIENTATION | DM_DUPLEX | DM_COPIES | DM_COLLATE)
        dm.dmOrientation = DMORIENT_LANDSCAPE if quer else DMORIENT_PORTRAIT

        kennung, normname = _normformat(breite_mm, hoehe_mm)
        formular = None
        if kennung:
            # Erste Wahl: genormtes Format ueber seine Windows-Kennung
            formular = normname
            dm.dmFields |= DM_PAPERSIZE
            dm.dmPaperSize = kennung
        elif _passendes_formular(name, breite_mm, hoehe_mm):
            # Zweite Wahl: ein Formular, das im Treiber angelegt ist
            formular = _passendes_formular(name, breite_mm, hoehe_mm)
            dm.dmFields |= DM_FORMNAME
            dm.dmFormName = formular
        else:
            dm.dmFields |= DM_PAPERSIZE | DM_PAPERWIDTH | DM_PAPERLENGTH
            dm.dmPaperSize = DMPAPER_USER
            # Windows misst Papier in Zehntelmillimetern, und zwar immer als
            # Hochformat: Breite = kurze Seite, Laenge = lange Seite.
            kurz, lang = sorted((breite_mm, hoehe_mm))
            dm.dmPaperWidth = int(round(kurz * 10))
            dm.dmPaperLength = int(round(lang * 10))
        dm.dmDuplex = duplex
        dm.dmCopies = max(1, int(kopien))
        dm.dmCollate = 1

        # Den Treiber die Angaben zurechtruecken lassen
        if winspool.DocumentPropertiesW(None, griff, name, puffer, puffer,
                                        DM_IN_BUFFER | DM_OUT_BUFFER) < 0:
            raise _fehler("Der Drucker nimmt das Format nicht an")
        return puffer, formular
    finally:
        winspool.ClosePrinter(griff)


def drucke(druckername, seiten, breite_mm, hoehe_mm, wenden="lang",
           kopien=1, titel="VolmeKarte", ausgabedatei=None):
    """Bogenseiten drucken.

    seiten:        Liste von (breite_px, hoehe_px, DIB-Bytes) - unterste
                   Zeile zuerst, BGR, Zeilen auf 4 Byte aufgefuellt.
    breite/hoehe:  Bogenmass in Millimetern.
    ausgabedatei:  Wenn gesetzt, schreibt der Treiber in diese Datei,
                   statt zu drucken. Nur zum Pruefen gedacht.
    """
    if not WINDOWS:
        raise OSError("Direktdruck gibt es nur unter Windows.")
    if not seiten:
        raise ValueError("Es gibt nichts zu drucken.")

    duplex = DUPLEX_NACH_WENDEN.get(wenden, DMDUP_VERTICAL)
    if len(seiten) < 2:
        duplex = DMDUP_SIMPLEX
    dm, formular = _devmode(druckername, breite_mm, hoehe_mm, duplex, kopien)

    dc = gdi32.CreateDCW("WINSPOOL", druckername, None,
                         ctypes.cast(dm, ctypes.c_void_p))
    if not dc:
        raise _fehler("Kein Zugriff auf den Drucker „%s“" % druckername)
    try:
        hole = gdi32.GetDeviceCaps
        dpix = hole(dc, LOGPIXELSX) or 600
        dpiy = hole(dc, LOGPIXELSY) or 600
        ox = hole(dc, PHYSICALOFFSETX)
        oy = hole(dc, PHYSICALOFFSETY)

        # Nachsehen, was der Treiber tatsaechlich eingestellt hat. Manche
        # Treiber nehmen freie Masse stillschweigend nicht an und legen ein
        # anderes Format unter - dann kaeme die Karte falsch skaliert oder
        # abgeschnitten heraus. Lieber gar nicht drucken und es sagen.
        echt_b = hole(dc, PHYSICALWIDTH) / dpix * 25.4
        echt_h = hole(dc, PHYSICALHEIGHT) / dpiy * 25.4
        soll = sorted((round(breite_mm, 1), round(hoehe_mm, 1)))
        ist = sorted((round(echt_b, 1), round(echt_h, 1)))
        if abs(ist[0] - soll[0]) > 1.0 or abs(ist[1] - soll[1]) > 1.0:
            raise ValueError(
                "Der Drucker stellt %.0f × %.0f mm ein, gebraucht werden "
                "aber %.0f × %.0f mm. Bitte im Druckertreiber einmal ein "
                "eigenes Papierformat mit diesen Maßen anlegen "
                "(Systemsteuerung / Geräte und Drucker / Druckserver-"
                "eigenschaften / Formulare), dann erkennt VolmeKarte es "
                "von selbst."
                % (echt_b, echt_h, breite_mm, hoehe_mm))

        # Zielgroesse in Geraetepunkten - daraus ergibt sich der Massstab.
        # Wir zeichnen ab der physischen Blattecke, nicht ab dem Druckbereich;
        # der unbedruckbare Rand schneidet dann einfach ab.
        ziel_b = int(round(breite_mm / 25.4 * dpix))
        ziel_h = int(round(hoehe_mm / 25.4 * dpiy))

        info = DOCINFOW()
        info.cbSize = ctypes.sizeof(DOCINFOW)
        info.lpszDocName = titel
        info.lpszOutput = ausgabedatei
        info.lpszDatatype = None
        info.fwType = 0
        if gdi32.StartDocW(dc, ctypes.byref(info)) <= 0:
            raise _fehler("Der Druckauftrag lässt sich nicht anlegen")

        for breite_px, hoehe_px, pixel in seiten:
            if gdi32.StartPage(dc) <= 0:
                raise _fehler("Die Seite lässt sich nicht anlegen")
            kopf = BITMAPINFOHEADER()
            kopf.biSize = ctypes.sizeof(BITMAPINFOHEADER)
            kopf.biWidth = breite_px
            kopf.biHeight = hoehe_px          # positiv = unterste Zeile zuerst
            kopf.biPlanes = 1
            kopf.biBitCount = 24
            kopf.biCompression = BI_RGB
            kopf.biSizeImage = len(pixel)
            if gdi32.StretchDIBits(
                    dc, -ox, -oy, ziel_b, ziel_h,
                    0, 0, breite_px, hoehe_px,
                    pixel, ctypes.byref(kopf), DIB_RGB_COLORS, SRCCOPY) == 0:
                raise _fehler("Die Seite lässt sich nicht zeichnen")
            if gdi32.EndPage(dc) <= 0:
                raise _fehler("Die Seite lässt sich nicht abschließen")

        if gdi32.EndDoc(dc) <= 0:
            raise _fehler("Der Druckauftrag lässt sich nicht abschließen")
        return {"dpi": [dpix, dpiy], "punkte": [ziel_b, ziel_h],
                "versatz": [ox, oy], "seiten": len(seiten),
                "formular": formular,
                "blatt_mm": [round(echt_b, 1), round(echt_h, 1)]}
    finally:
        gdi32.DeleteDC(dc)
