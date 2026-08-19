#!/usr/bin/env python3
# Leser fuer Windows-Verknuepfungen (.lnk), Format MS-SHLLINK.
#
# Warum selbst gebaut und nicht ueber COM (WScript.Shell)?  Zwei Gruende:
# COM liest nur, was der Shell-Namensraum gerade aufloesen kann - eine
# Verknuepfung auf ein abgezogenes Laufwerk liefert dann leere Felder.  Und
# ohne COM laeuft der Leser auch auf Linux, wo die Tests entstehen.
#
# Gelesen wird in dieser Reihenfolge, so wie die Datei aufgebaut ist:
#   Kopf (76 Byte) -> Ziel-IDListe -> LinkInfo -> Zeichenketten -> Zusatzbloecke

import datetime
import struct

# Bits in LinkFlags (Kopf, Offset 20)
HAT_IDLISTE = 1 << 0
HAT_LINKINFO = 1 << 1
HAT_NAME = 1 << 2
HAT_RELATIVPFAD = 1 << 3
HAT_ARBEITSORDNER = 1 << 4
HAT_ARGUMENTE = 1 << 5
HAT_SYMBOL = 1 << 6
IST_UNICODE = 1 << 7
KEIN_LINKINFO = 1 << 8

FENSTER = {1: "normal", 2: "minimiert", 3: "maximiert"}

# Zusatzbloecke, die uns interessieren
BLOCK_UMGEBUNG = 0xA0000001      # Zielpfad noch mit %Variablen%
BLOCK_VERFOLGUNG = 0xA0000003    # Rechnername, auf dem die Verknuepfung entstand
BLOCK_EIGENSCHAFTEN = 0xA0000009  # u. a. AppUserModelID (Store-/UWP-Verknuepfungen)

# Virtuelle Wurzeln im Shell-Namensraum.  Ohne diese Tabelle sieht eine
# Verknuepfung zur Systemsteuerung aus wie ein leerer Zielpfad.
WURZELN = {
    "20D04FE0-3AEA-1069-A2D8-08002B30309D": "Dieser PC",
    "5E591A74-DF96-48D3-8D67-1733BCEE28BA": "Dokumente",
    "871C5380-42A0-1069-A2EA-08002B30309D": "Internet Explorer",
    "21EC2020-3AEA-1069-A2DD-08002B30309D": "Systemsteuerung",
    "645FF040-5081-101B-9F08-00AA002F954E": "Papierkorb",
    "031E4825-7B94-4DC3-B131-E946B44C8DD5": "Bibliotheken",
    "B4BFCC3A-DB2C-424C-B029-7FE99A87C641": "Desktop",
    "59031A47-3F72-44A7-89C5-5595FE6B30EE": "Benutzerordner",
    "F02C1A0D-BE21-4350-88B0-7367FC96EF3C": "Netzwerk",
}

# Kennungen (KNOWNFOLDERID), die als Ordner-Element in der IDListe stehen
ORDNER_KENNUNGEN = {
    "1AC14E77-02E7-4E5D-B744-2EB1AE5198B7": r"C:\Windows\System32",
    "6D809377-6AF0-444B-8957-A3773F02200E": r"C:\Program Files",
    "7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E": r"C:\Program Files (x86)",
    "F38BF404-1D43-42F2-9305-67DE0B28FC23": r"C:\Windows",
    "B4BFCC3A-DB2C-424C-B029-7FE99A87C641": "Desktop",
    "3EB685DB-65F9-4CF6-A03A-E3EF65729F3D": "%AppData%",
    "F1B32785-6FBA-4FCF-9D55-7B8E7F157091": "%LocalAppData%",
    "62AB5D82-FDC1-4DC3-A9DD-070D1D495D97": "%ProgramData%",
}


class LnkFehler(Exception):
    pass


def _guid(rohdaten):
    """16 Byte GUID in die uebliche Schreibweise - die ersten drei Felder
    stehen in der Datei mit vertauschter Bytefolge."""
    a, b, c = struct.unpack_from("<IHH", rohdaten, 0)
    d = rohdaten[8:16]
    return "%08X-%04X-%04X-%02X%02X-%s" % (
        a, b, c, rohdaten[6], rohdaten[7], d[2:].hex().upper())


def _zeit(wert):
    """FILETIME (100-ns-Schritte seit 1601) in datetime; 0 heisst 'nicht gesetzt'."""
    if not wert:
        return None
    try:
        return (datetime.datetime(1601, 1, 1)
                + datetime.timedelta(microseconds=wert // 10))
    except (OverflowError, OSError, ValueError):
        return None


def _text(rohdaten, pos, unicode_):
    """Zeichenkette aus dem StringData-Teil: 2 Byte Laenge in ZEICHEN
    (nicht Bytes!) - genau hier verrechnet man sich bei Unicode leicht."""
    if pos + 2 > len(rohdaten):
        raise LnkFehler("Zeichenkette reicht ueber das Dateiende hinaus")
    (anzahl,) = struct.unpack_from("<H", rohdaten, pos)
    pos += 2
    breite = 2 if unicode_ else 1
    ende = pos + anzahl * breite
    if ende > len(rohdaten):
        raise LnkFehler("Zeichenkette reicht ueber das Dateiende hinaus")
    roh = rohdaten[pos:ende]
    if unicode_:
        wert = roh.decode("utf-16-le", "replace")
    else:
        wert = roh.decode("cp1252", "replace")
    # Laut Format sind diese Zeichenketten NICHT nullterminiert, etliche
    # Schreiber haengen die Null trotzdem an und zaehlen sie mit.  Bliebe sie
    # stehen, hinge an jedem Ziel ein unsichtbares Zeichen - und Vergleiche
    # ("ist das dasselbe Programm?") gingen daneben.
    return wert.rstrip("\x00"), ende


def _null_text(rohdaten, pos, unicode_=False, grenze=None):
    """Nullterminierte Zeichenkette ab pos (LinkInfo arbeitet damit)."""
    grenze = len(rohdaten) if grenze is None else min(grenze, len(rohdaten))
    if unicode_:
        ende = pos
        while ende + 1 < grenze and rohdaten[ende:ende + 2] != b"\x00\x00":
            ende += 2
        return rohdaten[pos:ende].decode("utf-16-le", "replace")
    ende = rohdaten.find(b"\x00", pos, grenze)
    ende = grenze if ende < 0 else ende
    return rohdaten[pos:ende].decode("cp1252", "replace")


# ------------------------------------------------------------ Ziel-IDListe
def _shell_element(roh):
    """Ein Element der IDListe zu Klartext machen.  Wir brauchen das als
    Rueckfallebene: Verknuepfungen aus dem Startmenue haben oft keinen
    LinkInfo-Teil, ihr Ziel steckt dann nur hier drin."""
    if len(roh) < 3:
        return None
    art = roh[2]

    # Wurzel-Element (0x1F): 0x1F, Sortierkennung, dann 16 Byte GUID
    if art == 0x1F and len(roh) >= 20:
        return WURZELN.get(_guid(roh[4:20]))

    # Datei/Ordner (0x31 Ordner, 0x32 Datei, 0x35/0x36 Unicode-Fassungen)
    if art in (0x31, 0x32, 0x35, 0x36, 0xB1, 0xB2):
        # Der lange Name steht in einem BEEF0004-Anhang; der kurze 8.3-Name
        # ab Offset 14.  Wir bevorzugen den langen - "PROGRA~1" hilft niemandem.
        lang = _langer_name(roh)
        if lang:
            return lang
        return _null_text(roh, 14)

    # Laufwerk (0x2F): "C:\" als ANSI ab Offset 3
    if art == 0x2F:
        return _null_text(roh, 3).rstrip("\\")

    # Ordner-Kennung (0x2E / 0x1F mit KNOWNFOLDERID im Anhang)
    if len(roh) >= 20:
        name = ORDNER_KENNUNGEN.get(_guid(roh[4:20]))
        if name:
            return name
    return None


def _langer_name(roh):
    """Im Anhang BEEF0004 steht der lange Datei-/Ordnername als UTF-16."""
    stelle = roh.find(b"\x04\x00\xef\xbe")
    if stelle < 2:
        return None
    # Vor der Kennung stehen 2 Byte Blockgroesse; danach Fassung, Zeitstempel.
    (fassung,) = struct.unpack_from("<H", roh, stelle + 4)
    pos = stelle + (12 if fassung < 0x0007 else 18)
    if fassung >= 0x0009:
        pos += 4
    if fassung >= 0x0008:
        pos += 4
    if pos >= len(roh):
        return None
    name = _null_text(roh, pos, unicode_=True)
    # Bei krummen Fassungen landet man neben dem Namen - dann lieber nichts.
    if not name or "\ufffd" in name:
        return None
    return name


def _idliste(rohdaten, pos):
    """Liefert (Klartextpfad oder None, Position nach der Liste)."""
    (groesse,) = struct.unpack_from("<H", rohdaten, pos)
    ende = pos + 2 + groesse
    teile, p = [], pos + 2
    while p + 2 <= len(rohdaten) and p < ende:
        (laenge,) = struct.unpack_from("<H", rohdaten, p)
        if laenge == 0:                      # Abschluss der Liste
            break
        stueck = _shell_element(rohdaten[p:p + laenge])
        if stueck:
            teile.append(stueck)
        p += laenge
    if not teile:
        return None, ende
    # Laufwerksbuchstabe + Rest ergibt einen echten Pfad, alles andere bleibt
    # eine Beschreibung des Shell-Ortes ("Systemsteuerung").
    if len(teile) > 1 and len(teile[0]) == 2 and teile[0].endswith(":"):
        return teile[0] + "\\" + "\\".join(teile[1:]), ende
    return "\\".join(teile), ende


# ---------------------------------------------------------------- LinkInfo
def _linkinfo(rohdaten, pos):
    """Liefert (Pfad oder None, Laufwerksname, Position dahinter)."""
    (groesse,) = struct.unpack_from("<I", rohdaten, pos)
    ende = pos + groesse
    if groesse < 0x20 or ende > len(rohdaten):
        raise LnkFehler("LinkInfo-Block unschluessig")
    kopf, flags = struct.unpack_from("<II", rohdaten, pos + 4)
    vol_off, basis_off, netz_off, suffix_off = struct.unpack_from(
        "<IIII", rohdaten, pos + 12)
    unicode_ = kopf >= 0x24
    if unicode_:
        basis_off_u, suffix_off_u = struct.unpack_from("<II", rohdaten, pos + 28)

    pfad = laufwerk = None
    if flags & 1:                                    # Ziel liegt auf diesem PC
        if unicode_ and basis_off_u:
            basis = _null_text(rohdaten, pos + basis_off_u, True, ende)
            suffix = _null_text(rohdaten, pos + suffix_off_u, True, ende) \
                if suffix_off_u else ""
        else:
            basis = _null_text(rohdaten, pos + basis_off, False, ende) \
                if basis_off else ""
            suffix = _null_text(rohdaten, pos + suffix_off, False, ende) \
                if suffix_off else ""
        pfad = (basis + suffix) or None
        if vol_off:
            v = pos + vol_off
            (kennung,) = struct.unpack_from("<I", rohdaten, v + 8)
            (name_off,) = struct.unpack_from("<I", rohdaten, v + 12)
            if name_off == 0x14:                     # Unicode-Fassung
                (name_off,) = struct.unpack_from("<I", rohdaten, v + 16)
                laufwerk = _null_text(rohdaten, v + name_off, True, ende) or None
            else:
                laufwerk = _null_text(rohdaten, v + name_off, False, ende) or None
    elif flags & 2 and netz_off:                     # Ziel liegt im Netz
        n = pos + netz_off
        (geraet_off,) = struct.unpack_from("<I", rohdaten, n + 8)
        freigabe = _null_text(rohdaten, n + geraet_off, False, ende) \
            if geraet_off else ""
        suffix = _null_text(rohdaten, pos + suffix_off, False, ende) \
            if suffix_off else ""
        pfad = (freigabe + "\\" + suffix).rstrip("\\") or None
    return pfad, laufwerk, ende


# ------------------------------------------------------------ Zusatzbloecke
def _zusatzbloecke(rohdaten, pos):
    ergebnis = {}
    while pos + 8 <= len(rohdaten):
        groesse, kennung = struct.unpack_from("<II", rohdaten, pos)
        if groesse < 8 or pos + groesse > len(rohdaten):
            break
        block = rohdaten[pos:pos + groesse]
        if kennung == BLOCK_UMGEBUNG and groesse >= 0x314:
            ansi = _null_text(block, 8, False, 8 + 260)
            uni = _null_text(block, 268, True, 268 + 520)
            ergebnis["umgebungspfad"] = uni or ansi or None
        elif kennung == BLOCK_VERFOLGUNG and groesse >= 0x60:
            ergebnis["rechner"] = _null_text(block, 16, False, 16 + 16) or None
        elif kennung == BLOCK_EIGENSCHAFTEN:
            kennzeichen = _app_kennung(block)
            if kennzeichen:
                ergebnis["app_kennung"] = kennzeichen
        pos += groesse
    return ergebnis


def _app_kennung(block):
    """AppUserModelID aus dem Eigenschaftsspeicher.  Sie verraet bei
    Store-Verknuepfungen, welche App wirklich gestartet wird - der Zielpfad
    zeigt dort nur auf einen Platzhalter."""
    stelle = block.find("AppUserModelID".encode("utf-16-le"))
    if stelle < 0:
        # Ohne Namensfeld liegt der Wert unter Eigenschaft 5 der bekannten
        # Sammlung; dann bleibt nur die Suche nach der letzten Textangabe.
        return None
    pos = stelle + len("AppUserModelID") * 2
    while pos + 2 <= len(block) and block[pos:pos + 2] == b"\x00\x00":
        pos += 2
    if pos + 8 > len(block):
        return None
    (art,) = struct.unpack_from("<H", block, pos)
    if art != 31:                                    # VT_LPWSTR
        return None
    (zeichen,) = struct.unpack_from("<I", block, pos + 4)
    text = block[pos + 8:pos + 8 + zeichen * 2].decode("utf-16-le", "replace")
    return text.rstrip("\x00") or None


# ------------------------------------------------------------------- lesen
def lesen(pfad):
    """Verknuepfung einlesen.  Liefert immer ein Wortverzeichnis; konnte die
    Datei nicht gedeutet werden, steht der Grund unter 'fehler'."""
    grund = {"datei": str(pfad)}
    try:
        with open(pfad, "rb") as f:
            rohdaten = f.read()
    except OSError as e:
        grund["fehler"] = f"nicht lesbar: {e}"
        return grund
    try:
        return _deuten(rohdaten, str(pfad))
    except (LnkFehler, struct.error, IndexError, ValueError) as e:
        grund["fehler"] = str(e)
        return grund


def _deuten(rohdaten, pfad):
    if len(rohdaten) < 76:
        raise LnkFehler("zu kurz fuer einen Verknuepfungskopf")
    (kopfgroesse,) = struct.unpack_from("<I", rohdaten, 0)
    if kopfgroesse != 0x4C:
        raise LnkFehler("kein .lnk (Kopfgroesse %d)" % kopfgroesse)
    flags, dateiattribute = struct.unpack_from("<II", rohdaten, 20)
    erstellt, zugriff, geaendert = struct.unpack_from("<QQQ", rohdaten, 28)
    zielgroesse, symbolnummer, fenster = struct.unpack_from("<iii", rohdaten, 52)
    (tastenkuerzel,) = struct.unpack_from("<H", rohdaten, 64)

    eintrag = {
        "datei": pfad,
        "ziel": None,
        "argumente": None,
        "arbeitsordner": None,
        "beschreibung": None,
        "symbol": None,
        "symbolnummer": symbolnummer,
        "fenster": FENSTER.get(fenster, str(fenster)),
        "tastenkuerzel": _kuerzel(tastenkuerzel),
        "zielgroesse": zielgroesse or None,
        "ziel_geaendert": _zeit(geaendert),
        "ziel_erstellt": _zeit(erstellt),
        "ziel_zugriff": _zeit(zugriff),
        "laufwerk": None,
        "rechner": None,
        "app_kennung": None,
        # Dreizustand mit Absicht: manche Schreiber lassen das Attributfeld
        # ganz leer.  Dann ist "kein Ordner" eine Behauptung, die wir nicht
        # belegen koennen - im Bericht soll dort nichts stehen statt "Datei".
        "ordner": bool(dateiattribute & 0x10) if dateiattribute else None,
        "fehler": None,
    }

    unicode_ = bool(flags & IST_UNICODE)
    pos = 76
    idliste_pfad = None
    if flags & HAT_IDLISTE:
        idliste_pfad, pos = _idliste(rohdaten, pos)
    if flags & HAT_LINKINFO and not flags & KEIN_LINKINFO:
        info_pfad, eintrag["laufwerk"], pos = _linkinfo(rohdaten, pos)
        eintrag["ziel"] = info_pfad

    for bit, feld in ((HAT_NAME, "beschreibung"),
                      (HAT_RELATIVPFAD, "relativpfad"),
                      (HAT_ARBEITSORDNER, "arbeitsordner"),
                      (HAT_ARGUMENTE, "argumente"),
                      (HAT_SYMBOL, "symbol")):
        if flags & bit:
            wert, pos = _text(rohdaten, pos, unicode_)
            eintrag[feld] = wert or None

    eintrag.update(_zusatzbloecke(rohdaten, pos))

    # Zielpfad in der Reihenfolge der Verlaesslichkeit: LinkInfo (voller Pfad
    # mit Laufwerk) vor Umgebungsblock (%ProgramFiles%...) vor IDListe.  Die
    # IDListe nur, wenn sie wie ein echter Pfad aussieht: sie kann auch einen
    # Ort im Shell-Namensraum beschreiben ("Systemsteuerung"), und der gehoert
    # nicht in ein Feld, das anderswo als Dateipfad weiterverwendet wird.
    if not eintrag["ziel"]:
        eintrag["ziel"] = eintrag.get("umgebungspfad") or _als_pfad(idliste_pfad)
    eintrag["idliste"] = idliste_pfad
    eintrag.pop("relativpfad", None)
    return eintrag


def _als_pfad(wert):
    """Nur durchlassen, was ein Dateisystempfad sein kann."""
    if not wert:
        return None
    if wert.startswith("\\\\") or (len(wert) > 1 and wert[1] == ":"):
        return wert
    if wert.startswith("%"):
        return wert
    return None


def _kuerzel(wert):
    if not wert:
        return None
    taste, halten = wert & 0xFF, wert >> 8
    teile = []
    if halten & 0x02:
        teile.append("Strg")
    if halten & 0x04:
        teile.append("Alt")
    if halten & 0x01:
        teile.append("Umschalt")
    if 0x30 <= taste <= 0x5A:
        teile.append(chr(taste))
    elif 0x70 <= taste <= 0x87:
        teile.append("F%d" % (taste - 0x6F))
    else:
        teile.append("0x%02X" % taste)
    return "+".join(teile)


if __name__ == "__main__":
    import json
    import sys
    for p in sys.argv[1:]:
        print(json.dumps(lesen(p), indent=2, ensure_ascii=False, default=str))
