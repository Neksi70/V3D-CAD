#!/usr/bin/env python3
# VolmeStick - Eine Datei in eine bestehende ISO einhaengen, ohne sie neu zu bauen.
#
# Warum nicht einfach neu bauen: dafuer braucht es xorriso (gibt es unter Windows
# nicht) und es dauert bei 7 GB entsprechend. Und warum nicht die kleine
# Antwort-ISO danebenlegen: weil zwei Laufwerke in VMware laestig sind.
#
# Der Weg hier: die ISO wird 1:1 kopiert, die neue Datei ans Ende angehaengt und
# nur das Wurzelverzeichnis umgebogen. Ein groesseres Wurzelverzeichnis wird
# ebenfalls ans Ende geschrieben; im Volume-Deskriptor und in der Pfadtabelle
# zeigt danach alles auf die neue Stelle.
#
# Wichtig: Die Startsaetze (El Torito, BIOS + UEFI) werden nicht angefasst - sie
# verweisen auf Sektoren, die unveraendert an ihrem Platz bleiben. Genau deshalb
# bleibt die ISO startfaehig.

import io
import os
import shutil
import struct
import sys

SEKTOR = 2048
BASIS = os.path.dirname(os.path.abspath(__file__))
# Mitgelieferte Fremdbibliothek fuer UDF (pycdlib, LGPL 2.1)
for _pfad in (os.path.join(BASIS, "vendor"), getattr(sys, "_MEIPASS", "")):
    if _pfad and _pfad not in sys.path:
        sys.path.append(_pfad)


class PatchFehler(Exception):
    pass


def _both32(wert):
    return struct.pack("<I", wert) + struct.pack(">I", wert)


def _deskriptoren(f):
    """Liefert (Offset, Rohdaten, ist_joliet) fuer PVD und Joliet-SVD."""
    treffer = []
    for lba in range(16, 96):
        f.seek(lba * SEKTOR)
        d = f.read(SEKTOR)
        if len(d) < SEKTOR or d[1:6] != b"CD001":
            break
        if d[0] == 1:
            treffer.append((lba * SEKTOR, d, False))
        elif d[0] == 2 and d[88:91] in (b"%/@", b"%/C", b"%/E"):
            treffer.append((lba * SEKTOR, d, True))
        elif d[0] == 255:
            break
    if not treffer:
        raise PatchFehler("Keine ISO9660-Deskriptoren gefunden")
    return treffer


def _records(daten):
    """Verzeichniseintraege eines Verzeichnisses roh zerlegen."""
    eintraege = []
    pos = 0
    while pos < len(daten):
        laenge = daten[pos]
        if laenge == 0:
            pos = (pos // SEKTOR + 1) * SEKTOR      # Rest des Sektors ist Fuellung
            continue
        eintraege.append(daten[pos:pos + laenge])
        pos += laenge
    return eintraege


def _name_von(record):
    laenge = record[32]
    return record[33:33 + laenge]


def _neuer_record(name_roh, lba, groesse, vorlage):
    """Eintrag fuer eine Datei - Zeitstempel und Kennungen von einem
    vorhandenen Eintrag uebernehmen, damit alles zusammenpasst."""
    satz = bytearray()
    laenge = 33 + len(name_roh)
    fuell = laenge % 2
    satz.append(laenge + fuell)
    satz.append(0)
    satz += _both32(lba)
    satz += _both32(groesse)
    satz += vorlage[18:25]                 # Datum/Uhrzeit
    satz.append(0)                         # gewoehnliche Datei
    satz += bytes([0, 0])
    satz += vorlage[28:32]                 # Datentraegerfolge
    satz.append(len(name_roh))
    satz += name_roh
    satz += b"\x00" * fuell
    return bytes(satz)


def _sektorweise(eintraege):
    """Eintraege auf Sektoren verteilen - ein Eintrag darf nie ueber eine
    Sektorgrenze hinausragen (ISO9660-Regel)."""
    sektoren = [bytearray()]
    for e in eintraege:
        if len(sektoren[-1]) + len(e) > SEKTOR:
            sektoren[-1] = sektoren[-1].ljust(SEKTOR, b"\x00")
            sektoren.append(bytearray())
        sektoren[-1] += e
    sektoren[-1] = sektoren[-1].ljust(SEKTOR, b"\x00")
    return b"".join(sektoren)


def _pfadtabelle_umbiegen(f, tabelle_lba, gross, alt_lba, neu_lba):
    """In der Pfadtabelle steht die Lage jedes Verzeichnisses - der Eintrag
    fuer das Wurzelverzeichnis muss mitwandern."""
    if not tabelle_lba:
        return
    f.seek(tabelle_lba * SEKTOR)
    daten = bytearray(f.read(SEKTOR))
    pos = 0
    format = ">I" if gross else "<I"
    while pos + 8 <= len(daten):
        namenlaenge = daten[pos]
        if namenlaenge == 0:
            break
        lba = struct.unpack_from(format, daten, pos + 2)[0]
        if lba == alt_lba:
            struct.pack_into(format, daten, pos + 2, neu_lba)
        satz = 8 + namenlaenge + (namenlaenge % 2)
        pos += satz
    f.seek(tabelle_lba * SEKTOR)
    f.write(daten)


def hat_udf(pfad):
    """Windows-ISOs tragen neben ISO9660 ein UDF-Dateisystem - und Windows
    liest AUSSCHLIESSLICH das UDF. Eine Datei, die nur im ISO9660-Teil steht,
    ist fuer das Setup unsichtbar. Erkennbar an der Kennung NSR02/NSR03 in der
    Erkennungssequenz ab Sektor 16."""
    try:
        with open(pfad, "rb") as f:
            f.seek(16 * SEKTOR)
            roh = f.read(16 * SEKTOR)
        return b"NSR02" in roh or b"NSR03" in roh
    except OSError:
        return False


def _kurzname(name):
    """8.3-Form fuer den ISO9660-Teil (dort sind lange Namen nicht sicher)."""
    grund, _, endung = name.rpartition(".")
    grund = (grund or name)[:8].upper()
    endung = endung[:3].upper()
    return f"{grund}.{endung};1" if endung else f"{grund};1"


def _namen_wie_microsoft(pycdlib):
    """pycdlib schreibt Dateinamen im UDF als 8-Bit-Zeichen, sobald sie sich so
    darstellen lassen. Erlaubt ist das, aber Microsoft legt in seinen ISOs alle
    Namen als UTF-16BE ab. Wir ziehen nach, damit unser Eintrag sich in nichts
    von seinen Nachbarn unterscheidet - beim Suchen nach der Antwortdatei soll
    es keine Unterschiede geben, an denen etwas haengen bleiben kann."""
    from pycdlib import udf as _udf
    klasse = _udf.UDFFileIdentifierDescriptor
    if getattr(klasse, "_volmestick", False):
        return
    urspruenglich = klasse.new

    def neu(self, isdir, isparent, name, parent):
        urspruenglich(self, isdir, isparent, name, parent)
        if not isparent and getattr(self, "encoding", "") == "latin-1":
            self.fi = self.fi.decode("latin-1").encode("utf-16_be")
            self.encoding = "utf-16_be"
            self.len_fi = len(self.fi) + 1

    klasse.new = neu
    klasse._volmestick = True


def _mit_udf(quelle, ziel, dateien, fortschritt=None):
    """Einhaengen in ISO9660, Joliet UND UDF. Dafuer wird die ISO neu
    geschrieben - anders kommt man an die UDF-Strukturen nicht heran."""
    try:
        import pycdlib
    except ImportError:
        raise PatchFehler(
            "Diese ISO benutzt UDF - dafuer wird die Bibliothek pycdlib "
            "gebraucht, die hier fehlt.")
    _namen_wie_microsoft(pycdlib)
    iso = pycdlib.PyCdlib()
    try:
        iso.open(quelle)
        joliet = iso.has_joliet()
        for name, inhalt in dateien.items():
            klein = name.lower()
            for weg in ("/" + klein, "/" + name):
                try:
                    iso.rm_file(udf_path=weg)      # eine vorhandene ersetzen
                except Exception:
                    pass
            iso.add_fp(io.BytesIO(inhalt), len(inhalt), "/" + _kurzname(name),
                       joliet_path=("/" + klein) if joliet else None,
                       udf_path="/" + klein)
        gesamt = [0]

        def melden(fertig, alles, _egal=None):
            if fortschritt and alles:
                gesamt[0] = fertig
                fortschritt(min(99, int(100 * fertig / alles)),
                            f"ISO schreiben: {fertig / 1024**3:.2f} / {alles / 1024**3:.2f} GB")

        iso.write(ziel, progress_cb=melden)
    except PatchFehler:
        raise
    except Exception as e:
        raise PatchFehler(f"UDF-Einhaengen fehlgeschlagen: {e}")
    finally:
        try:
            iso.close()
        except Exception:
            pass
    if fortschritt:
        fortschritt(100, "Fertig")
    return {"ziel": ziel, "groesse": os.path.getsize(ziel), "weg": "udf"}


def lege_datei_bei(quelle, ziel, dateien, fortschritt=None):
    """Kopiert die ISO und haengt die Dateien ins Wurzelverzeichnis ein.

    dateien: {"AUTOUNATTEND.XML": b"..."} - Name in Grossbuchstaben.
    """
    if hat_udf(quelle):
        return _mit_udf(quelle, ziel, dateien, fortschritt)
    quelle, ziel = os.path.abspath(quelle), os.path.abspath(ziel)
    if quelle == ziel:
        raise PatchFehler("Quelle und Ziel duerfen nicht dieselbe Datei sein")
    gesamt = os.path.getsize(quelle)

    # 1. Kopieren - die ISO bleibt dabei Byte fuer Byte erhalten
    kopiert = 0
    with open(quelle, "rb") as q, open(ziel, "wb") as z:
        while True:
            block = q.read(8 * 1024 * 1024)
            if not block:
                break
            z.write(block)
            kopiert += len(block)
            if fortschritt:
                fortschritt(int(85 * kopiert / max(1, gesamt)),
                            f"Kopieren: {kopiert / 1024**3:.2f} / {gesamt / 1024**3:.2f} GB")

    with open(ziel, "r+b") as f:
        if fortschritt:
            fortschritt(88, "Verzeichnis umbiegen ...")
        deskriptoren = _deskriptoren(f)
        ende = os.path.getsize(ziel)
        if ende % SEKTOR:
            f.seek(0, 2)
            f.write(b"\x00" * (SEKTOR - ende % SEKTOR))
            ende = os.path.getsize(ziel)
        naechste_lba = ende // SEKTOR

        # 2. Dateiinhalte anhaengen
        lage = {}
        f.seek(0, 2)
        for name, inhalt in dateien.items():
            sektoren = max(1, (len(inhalt) + SEKTOR - 1) // SEKTOR)
            lage[name] = (naechste_lba, len(inhalt))
            f.write(inhalt.ljust(sektoren * SEKTOR, b"\x00"))
            naechste_lba += sektoren

        # 3. Fuer jeden Deskriptor das Wurzelverzeichnis neu schreiben
        for offset, roh, joliet in deskriptoren:
            wurzel = bytearray(roh[156:190])
            alt_lba = struct.unpack_from("<I", wurzel, 2)[0]
            alt_groesse = struct.unpack_from("<I", wurzel, 10)[0]
            f.seek(alt_lba * SEKTOR)
            eintraege = _records(f.read(alt_groesse))
            if len(eintraege) < 2:
                raise PatchFehler("Wurzelverzeichnis unvollstaendig - ISO unbrauchbar?")

            neu_namen = {name: (name.encode("utf-16-be") if joliet
                                else (name + ";1").encode("ascii"))
                         for name in dateien}
            ersetzt = set(neu_namen.values())
            behalten = [e for e in eintraege if _name_von(e) not in ersetzt]
            for name, (dlba, groesse) in lage.items():
                behalten.append(_neuer_record(neu_namen[name], dlba, groesse,
                                              eintraege[0]))
            inhalt = _sektorweise(behalten)

            if len(inhalt) <= alt_groesse:
                # Der Normalfall: der neue Eintrag passt in den vorhandenen
                # Platz. Dann bleibt das Verzeichnis, wo es ist - keine Adresse
                # aendert sich, und "." und ".." stimmen weiterhin.
                f.seek(alt_lba * SEKTOR)
                f.write(inhalt.ljust(alt_groesse, b"\x00"))
                continue

            # Sonst muss das Verzeichnis ans Ende umziehen. Dann zeigen seine
            # eigenen Eintraege "." und ".." noch auf die alte Stelle - und ein
            # Leser, der ihnen folgt (xorriso tut das), saehe den alten Stand.
            f.seek(0, 2)
            neu_lba = f.tell() // SEKTOR
            inhalt = bytearray(inhalt)
            for start in (0, len(eintraege[0])):
                struct.pack_into("<I", inhalt, start + 2, neu_lba)
                struct.pack_into(">I", inhalt, start + 6, neu_lba)
                struct.pack_into("<I", inhalt, start + 10, len(inhalt))
                struct.pack_into(">I", inhalt, start + 14, len(inhalt))
            f.write(bytes(inhalt))

            # Die Unterverzeichnisse der ersten Ebene tragen ebenfalls ein
            # ".." auf das Wurzelverzeichnis - auch das muss mitwandern.
            for e in _records(bytes(inhalt))[2:]:
                if not (e[25] & 0x02):
                    continue
                unter_lba = struct.unpack_from("<I", e, 2)[0]
                unter_groesse = struct.unpack_from("<I", e, 10)[0]
                f.seek(unter_lba * SEKTOR)
                unter = bytearray(f.read(unter_groesse))
                punkt = unter[0]                      # Laenge des "."-Eintrags
                struct.pack_into("<I", unter, punkt + 2, neu_lba)
                struct.pack_into(">I", unter, punkt + 6, neu_lba)
                struct.pack_into("<I", unter, punkt + 10, len(inhalt))
                struct.pack_into(">I", unter, punkt + 14, len(inhalt))
                f.seek(unter_lba * SEKTOR)
                f.write(bytes(unter))

            # Deskriptor und Pfadtabellen auf die neue Stelle zeigen lassen
            struct.pack_into("<I", wurzel, 2, neu_lba)
            struct.pack_into(">I", wurzel, 6, neu_lba)
            struct.pack_into("<I", wurzel, 10, len(inhalt))
            struct.pack_into(">I", wurzel, 14, len(inhalt))
            f.seek(offset + 156)
            f.write(bytes(wurzel))

            for feld, gross in ((140, False), (144, False), (148, True), (152, True)):
                f.seek(offset + feld)
                tab = struct.unpack(">I" if gross else "<I", f.read(4))[0]
                if tab:
                    _pfadtabelle_umbiegen(f, tab, gross, alt_lba, neu_lba)

        # 6. Neue Gesamtgroesse in alle Deskriptoren eintragen
        f.flush()
        sektoren_gesamt = (os.path.getsize(ziel) + SEKTOR - 1) // SEKTOR
        for offset, _roh, _j in deskriptoren:
            f.seek(offset + 80)
            f.write(_both32(sektoren_gesamt))
        f.flush()
        os.fsync(f.fileno())

    if fortschritt:
        fortschritt(100, "Fertig")
    return {"ziel": ziel, "groesse": os.path.getsize(ziel)}
