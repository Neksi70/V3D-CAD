#!/usr/bin/env python3
# VolmeStick - Erzeugt eine winzige ISO mit wenigen kleinen Dateien.
#
# Wozu: Windows Setup sucht die autounattend.xml auf JEDEM angeschlossenen
# Laufwerk. Statt eine 7-GB-ISO umzubauen (wofuer es xorriso braucht, das es
# unter Windows nicht gibt), legt man in der VM einfach ein zweites CD-Laufwerk
# mit dieser Antwort-ISO ein. Ergebnis ist dasselbe, dauert aber Sekunden.
#
# Umfang: ISO9660 Level 2 + Joliet, keine Startfaehigkeit - genau das, was
# eine Antwort-ISO braucht. Reines Python, laeuft ueberall.

import os
import struct
import time

SEKTOR = 2048


def _both16(wert):
    return struct.pack("<H", wert) + struct.pack(">H", wert)


def _both32(wert):
    return struct.pack("<I", wert) + struct.pack(">I", wert)


def _zeitstempel(t=None):
    """7-Byte-Form fuer Verzeichniseintraege."""
    z = time.gmtime(t if t is not None else time.time())
    return bytes([z.tm_year - 1900, z.tm_mon, z.tm_mday,
                  z.tm_hour, z.tm_min, z.tm_sec, 0])


def _zeittext(t=None):
    """17-Byte-Form fuer die Volume-Deskriptoren."""
    z = time.gmtime(t if t is not None else time.time())
    return ("%04d%02d%02d%02d%02d%02d00" % (z.tm_year, z.tm_mon, z.tm_mday,
                                            z.tm_hour, z.tm_min, z.tm_sec)
            ).encode() + b"\x00"


def _dir_record(name, lba, groesse, ist_verzeichnis, joliet, zeit):
    if isinstance(name, int):                 # 0 = ".", 1 = ".."
        roh = bytes([name])
    elif joliet:
        roh = name.encode("utf-16-be")
    else:
        roh = name.encode("ascii", "replace")
    laenge = 33 + len(roh)
    fuell = laenge % 2
    satz = bytearray()
    satz.append(laenge + fuell)
    satz.append(0)                            # keine erweiterten Attribute
    satz += _both32(lba)
    satz += _both32(groesse)
    satz += _zeitstempel(zeit)
    satz.append(0x02 if ist_verzeichnis else 0x00)
    satz += bytes([0, 0])                     # keine Interleave-Aufteilung
    satz += _both16(1)                        # Datentraegerfolge
    satz.append(len(roh))
    satz += roh
    satz += b"\x00" * fuell
    return bytes(satz)


def _pfadtabelle(gross, wurzel_lba):
    """Nur das Wurzelverzeichnis - Unterordner braucht eine Antwort-ISO nicht."""
    satz = bytearray()
    satz.append(1)                            # Laenge des Namens (leer = 1 Byte)
    satz.append(0)
    satz += struct.pack(">I" if gross else "<I", wurzel_lba)
    satz += struct.pack(">H" if gross else "<H", 1)
    satz += b"\x00"                           # Name des Wurzelverzeichnisses
    satz += b"\x00"                           # Auffuellung auf gerade Laenge
    return bytes(satz)


def _deskriptor(typ, volid, gesamt_sektoren, pfad_groesse, pfad_l, pfad_m,
                wurzel_record, joliet, zeit):
    d = bytearray(b"\x00" * SEKTOR)
    d[0] = typ
    d[1:6] = b"CD001"
    d[6] = 1

    def text(wert, laenge, offset):
        if joliet:
            roh = wert.encode("utf-16-be")[:laenge]
            roh += b"\x00\x20" * ((laenge - len(roh)) // 2)
        else:
            roh = wert.encode("ascii", "replace")[:laenge].ljust(laenge, b" ")
        d[offset:offset + laenge] = roh

    text("", 32, 8)                           # System-Kennung
    text(volid, 32, 40)                       # Datentraegername
    d[80:88] = _both32(gesamt_sektoren)
    if joliet:
        d[88:91] = b"%/E"                     # Kennung: UCS-2 Ebene 3
    d[120:124] = _both16(1)                   # Groesse des Datentraegersatzes
    d[124:128] = _both16(1)                   # Folgenummer
    d[128:132] = _both16(SEKTOR)
    d[132:140] = _both32(pfad_groesse)
    d[140:144] = struct.pack("<I", pfad_l)
    d[148:152] = struct.pack(">I", pfad_m)
    d[156:156 + len(wurzel_record)] = wurzel_record
    text("VOLMESTICK", 128, 190)              # Datentraegersatz
    text("VOLMESTICK", 128, 318)              # Herausgeber
    text("VOLMESTICK", 128, 446)              # Aufbereiter
    text("VOLMESTICK", 128, 574)              # Anwendung
    zt = _zeittext(zeit)
    d[813:830] = zt                           # erstellt
    d[830:847] = zt                           # geaendert
    d[847:864] = b"0" * 16 + b"\x00"          # laeuft nicht ab
    d[864:881] = zt                           # gueltig ab
    d[881] = 1                                # Fassung der Dateistruktur
    if len(d) != SEKTOR:
        # Waere ein Schreibfehler im Aufbau oben - lieber hier auffliegen
        # als spaeter in einer stillschweigend kaputten ISO.
        raise ValueError(f"Deskriptor ist {len(d)} statt {SEKTOR} Bytes gross")
    return bytes(d)


def schreibe_iso(ziel, dateien, volid="V3D_ANTWORT"):
    """dateien: {"AUTOUNATTEND.XML": b"..."} - Namen in Grossbuchstaben.
    Liefert den Pfad der erzeugten ISO."""
    if not dateien:
        raise ValueError("Keine Dateien angegeben")
    zeit = time.time()
    volid = (volid or "V3D_ANTWORT")[:32]

    # Aufbau: 16 leere Sektoren, PVD, Joliet-SVD, Abschluss,
    #         4 Pfadtabellen, 2 Wurzelverzeichnisse, dann die Dateien
    lba_pvd, lba_svd, lba_ende = 16, 17, 18
    lba_pfad = 19                              # 4 Sektoren: L/M je Satz
    lba_wurzel, lba_wurzel_j = 23, 24
    lba = 25
    lage = {}
    for name, inhalt in dateien.items():
        sektoren = max(1, (len(inhalt) + SEKTOR - 1) // SEKTOR)
        lage[name] = (lba, len(inhalt))
        lba += sektoren
    gesamt = lba

    def wurzel(joliet):
        eintraege = [_dir_record(0, lba_wurzel_j if joliet else lba_wurzel,
                                 SEKTOR, True, False, zeit),
                     _dir_record(1, lba_wurzel_j if joliet else lba_wurzel,
                                 SEKTOR, True, False, zeit)]
        for name, (dlba, groesse) in lage.items():
            # ISO9660 verlangt die Fassungsnummer ";1", Joliet nicht.
            eintraege.append(_dir_record(name if joliet else name + ";1",
                                         dlba, groesse, False, joliet, zeit))
        inhalt = b"".join(eintraege)
        if len(inhalt) > SEKTOR:
            raise ValueError("Zu viele Dateien fuer diese kleine ISO")
        return inhalt.ljust(SEKTOR, b"\x00")

    wurzel_record = _dir_record(0, lba_wurzel, SEKTOR, True, False, zeit)
    wurzel_record_j = _dir_record(0, lba_wurzel_j, SEKTOR, True, False, zeit)
    pfad_l = _pfadtabelle(False, lba_wurzel)
    pfad_m = _pfadtabelle(True, lba_wurzel)
    pfad_l_j = _pfadtabelle(False, lba_wurzel_j)
    pfad_m_j = _pfadtabelle(True, lba_wurzel_j)

    with open(ziel, "wb") as f:
        f.write(b"\x00" * SEKTOR * 16)
        f.write(_deskriptor(1, volid, gesamt, len(pfad_l), lba_pfad, lba_pfad + 1,
                            wurzel_record, False, zeit))
        f.write(_deskriptor(2, volid, gesamt, len(pfad_l_j), lba_pfad + 2,
                            lba_pfad + 3, wurzel_record_j, True, zeit))
        abschluss = bytearray(b"\x00" * SEKTOR)
        abschluss[0] = 255
        abschluss[1:6] = b"CD001"
        abschluss[6] = 1
        f.write(bytes(abschluss))
        for tabelle in (pfad_l, pfad_m, pfad_l_j, pfad_m_j):
            f.write(tabelle.ljust(SEKTOR, b"\x00"))
        f.write(wurzel(False))
        f.write(wurzel(True))
        for name, inhalt in dateien.items():
            sektoren = max(1, (len(inhalt) + SEKTOR - 1) // SEKTOR)
            f.write(inhalt.ljust(sektoren * SEKTOR, b"\x00"))
    return ziel


def antwort_iso(ziel, xml_text, volid="V3D_ANTWORT"):
    """Die uebliche Anwendung: eine ISO mit nur der autounattend.xml."""
    roh = xml_text.encode("utf-8")
    return schreibe_iso(ziel, {"AUTOUNATTEND.XML": roh}, volid)
