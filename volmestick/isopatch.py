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
# bleibt die ISO startfaehig. Aus demselben Grund wird auch das UDF nur ergaenzt
# und nicht neu geschrieben: Ein frueherer Anlauf hat die ISO dafuer komplett neu
# gebaut (pycdlib) - danach war die Antwortdatei zwar sichtbar, das Abbild aber
# nicht mehr startfaehig.

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


# ------------------------------------------------------------------ UDF
# Windows liest bei diesen Abbildern ausschliesslich das UDF-Dateisystem.
# Frueher wurde dafuer die ganze ISO mit pycdlib neu geschrieben - dabei
# verschieben sich saemtliche Adressen, und das Abbild startet hinterher nicht
# mehr. Deshalb wird auch das UDF nur noch an Ort und Stelle ergaenzt:
# Dateiinhalt und Dateieintrag hinten anhaengen, im Wurzelverzeichnis einen
# Eintrag einfuegen. Kein bestehender Sektor wandert.

def _crc16(daten):
    """CRC-16/CCITT, wie ihn UDF fuer jeden Deskriptor verlangt."""
    crc = 0
    for b in daten:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def _udf_etikett_setzen(puffer, versatz, lba, crc_laenge):
    """Erneuert Pruefsumme und CRC eines Deskriptor-Etiketts. Beides muss
    stimmen, sonst verwirft Windows die Struktur wortlos."""
    # Etikett-Aufbau: 0 Kennung, 2 Fassung, 4 Pruefsumme, 5 frei, 6 Seriennummer,
    # 8 CRC, 10 CRC-Laenge, 12 Lage. Die beiden letzten Felder sind leicht zu
    # verwechseln - schreibt man sie vier Bytes zu weit hinten, landen sie in den
    # Nutzdaten und der Deskriptor ist unbrauchbar.
    struct.pack_into("<H", puffer, versatz + 10, crc_laenge)
    struct.pack_into("<I", puffer, versatz + 12, lba)
    crc = _crc16(bytes(puffer[versatz + 16:versatz + 16 + crc_laenge]))
    struct.pack_into("<H", puffer, versatz + 8, crc)
    puffer[versatz + 4] = 0
    puffer[versatz + 4] = sum(puffer[versatz:versatz + 16]) % 256


def _udf_wegweiser(f):
    """Anker -> Partition, Dateisatz, Wurzelverzeichnis. Liefert die Orte,
    an denen spaeter geschrieben wird."""
    f.seek(256 * SEKTOR)
    anker = f.read(SEKTOR)
    if struct.unpack_from("<H", anker, 0)[0] != 2:
        raise PatchFehler("UDF-Anker bei Sektor 256 nicht gefunden")
    haupt_laenge, haupt_lba = struct.unpack_from("<II", anker, 16)

    partition = None
    fsd = None
    for i in range(haupt_laenge // SEKTOR):
        f.seek((haupt_lba + i) * SEKTOR)
        d = f.read(SEKTOR)
        kennung = struct.unpack_from("<H", d, 0)[0]
        if kennung == 0:
            break
        if kennung == 5:            # Partitionsbeschreibung
            start, laenge = struct.unpack_from("<II", d, 188)
            partition = {"lba": haupt_lba + i, "start": start, "laenge": laenge}
        elif kennung == 6:          # Logischer Datentraeger
            fsd = struct.unpack_from("<II", d, 248)[1]
    if partition is None or fsd is None:
        raise PatchFehler("UDF-Beschreibungen unvollstaendig")

    f.seek((partition["start"] + fsd) * SEKTOR)
    dateisatz = f.read(SEKTOR)
    if struct.unpack_from("<H", dateisatz, 0)[0] != 256:
        raise PatchFehler("UDF-Dateisatz nicht gefunden")
    wurzel_icb = struct.unpack_from("<II", dateisatz, 400)[1]
    return partition, wurzel_icb


def _udf_dateieintrag_lesen(f, partition, icb_lba):
    """Liest einen Dateieintrag und zerlegt ihn so weit, wie wir ihn brauchen."""
    f.seek((partition["start"] + icb_lba) * SEKTOR)
    roh = bytearray(f.read(SEKTOR))
    kennung = struct.unpack_from("<H", roh, 0)[0]
    if kennung not in (261, 266):
        raise PatchFehler(f"Kein UDF-Dateieintrag bei {icb_lba} (Tag {kennung})")
    kopf = 176 if kennung == 261 else 216
    ea_laenge, ad_laenge = struct.unpack_from("<II", roh, kopf - 8)
    return {"roh": roh, "tag": kennung, "kopf": kopf, "lba": icb_lba,
            "ea_laenge": ea_laenge, "ad_laenge": ad_laenge,
            "ad_versatz": kopf + ea_laenge}


def _udf_fids(daten, laenge):
    """Zerlegt einen Verzeichnisinhalt in seine Eintraege."""
    aus, pos = [], 0
    while pos + 38 <= laenge:
        namenlaenge = daten[pos + 19]
        iu_laenge = struct.unpack_from("<H", daten, pos + 36)[0]
        satz = 38 + iu_laenge + namenlaenge
        satz += (4 - satz % 4) % 4                 # auf 4 Bytes aufrunden
        if satz <= 0 or pos + satz > laenge:
            break
        aus.append((pos, satz, daten[pos:pos + satz]))
        pos += satz
    return aus


def _udf_ad_typ(eintrag):
    """Wie die Zuordnungen abgelegt sind: kurz (8 Bytes) oder lang (16)."""
    flaggen = struct.unpack_from("<H", eintrag["roh"], 16 + 18)[0]
    return flaggen & 0x07


def _udf_ad_schreiben(puffer, versatz, typ, laenge, lba):
    """Eine Zuordnung eintragen - je nach Bauart kurz oder lang."""
    if typ == 0:                                  # kurz
        struct.pack_into("<II", puffer, versatz, laenge, lba)
        return 8
    struct.pack_into("<IIH", puffer, versatz, laenge, lba, 0)
    puffer[versatz + 10:versatz + 16] = b"\x00" * 6
    return 16


def _udf_einhaengen(f, dateien, lage, fortschritt=None):
    """Haengt die bereits ans Ende geschriebenen Dateien zusaetzlich in den
    UDF-Baum ein - ohne einen einzigen bestehenden Sektor zu verschieben."""
    partition, wurzel_icb = _udf_wegweiser(f)
    wurzel = _udf_dateieintrag_lesen(f, partition, wurzel_icb)
    ad_typ = _udf_ad_typ(wurzel)
    if ad_typ not in (0, 1):
        raise PatchFehler("UDF legt die Zuordnungen in einer Form ab, die "
                          "hier nicht behandelt wird")

    # Verzeichnisinhalt einlesen
    zu = wurzel["ad_versatz"]
    inhalt_laenge, inhalt_lba = struct.unpack_from("<II", wurzel["roh"], zu)
    inhalt_laenge &= 0x3FFFFFFF
    f.seek((partition["start"] + inhalt_lba) * SEKTOR)
    sektoren = (inhalt_laenge + SEKTOR - 1) // SEKTOR
    verzeichnis = bytearray(f.read(sektoren * SEKTOR))
    eintraege = _udf_fids(verzeichnis, inhalt_laenge)
    if not eintraege:
        raise PatchFehler("UDF-Wurzelverzeichnis liess sich nicht zerlegen")

    # Eine gewoehnliche Datei als Vorlage - so uebernehmen wir Zeitstempel,
    # Kennungen und Bauart genau so, wie sie auf diesem Datentraeger ueblich sind.
    vorlage_fid = None
    for _pos, _laenge, roh in eintraege:
        merkmale = roh[18]
        if not (merkmale & 0x08) and not (merkmale & 0x02) and roh[19]:
            vorlage_fid = roh
            break
    if vorlage_fid is None:
        raise PatchFehler("Keine Vorlage im UDF-Wurzelverzeichnis gefunden")
    vorlage_icb = struct.unpack_from("<I", vorlage_fid, 24)[0]
    vorlage_fe = _udf_dateieintrag_lesen(f, partition, vorlage_icb)

    f.seek(0, 2)
    naechste = f.tell() // SEKTOR
    neue_fids = []

    for name, (daten_lba, groesse) in lage.items():
        klein = name.lower().encode("utf-16-be")

        # 1. Dateieintrag nach dem Muster der Vorlage
        fe = bytearray(vorlage_fe["roh"])
        struct.pack_into("<Q", fe, 56, groesse)                  # Laenge in Bytes
        bloecke = (groesse + SEKTOR - 1) // SEKTOR
        if vorlage_fe["tag"] == 266:
            struct.pack_into("<Q", fe, 64, groesse)              # Objektgroesse
            struct.pack_into("<Q", fe, 72, bloecke)
        else:
            struct.pack_into("<Q", fe, 64, bloecke)
        ad_versatz = vorlage_fe["ad_versatz"]
        breite = _udf_ad_schreiben(fe, ad_versatz, ad_typ, groesse,
                                   daten_lba - partition["start"])
        struct.pack_into("<I", fe, vorlage_fe["kopf"] - 4, breite)   # nur eine Zuordnung
        fe[ad_versatz + breite:] = b"\x00" * (len(fe) - ad_versatz - breite)
        fe_lba = naechste
        _udf_etikett_setzen(fe, 0, fe_lba - partition["start"],
                            vorlage_fe["kopf"] + breite - 16)
        f.seek(fe_lba * SEKTOR)
        f.write(bytes(fe))
        naechste += 1

        # 2. Verzeichniseintrag nach dem Muster der Vorlage
        iu_laenge = struct.unpack_from("<H", vorlage_fid, 36)[0]
        fid = bytearray(vorlage_fid[:38 + iu_laenge])
        fid[19] = len(klein) + 1                                 # Namenslaenge
        struct.pack_into("<I", fid, 24, fe_lba - partition["start"])
        struct.pack_into("<I", fid, 20, SEKTOR)                  # Laenge des ICB
        fid += b"\x10" + klein                                   # 0x10 = 16-Bit-Zeichen
        fuell = (4 - len(fid) % 4) % 4
        fid += b"\x00" * fuell
        _udf_etikett_setzen(fid, 0, inhalt_lba, len(fid) - 16)
        neue_fids.append((klein, bytes(fid)))

    # 3. Verzeichnis ergaenzen - alte Eintraege gleichen Namens fallen raus
    weg = {k for k, _ in neue_fids}
    behalten = []
    for _pos, _laenge, roh in eintraege:
        namenlaenge = roh[19]
        iu = struct.unpack_from("<H", roh, 36)[0]
        name = bytes(roh[38 + iu + 1:38 + iu + namenlaenge])
        if namenlaenge and name in weg:
            continue
        behalten.append(roh)
    neu = b"".join(behalten) + b"".join(f for _n, f in neue_fids)
    if len(neu) > sektoren * SEKTOR:
        raise PatchFehler("Im UDF-Wurzelverzeichnis ist kein Platz mehr - "
                          "dieser Fall wird noch nicht behandelt")

    f.seek((partition["start"] + inhalt_lba) * SEKTOR)
    f.write(neu.ljust(sektoren * SEKTOR, b"\x00"))

    # 4. Wurzeleintrag auf die neue Laenge bringen
    roh = wurzel["roh"]
    struct.pack_into("<Q", roh, 56, len(neu))
    if wurzel["tag"] == 266:
        struct.pack_into("<Q", roh, 64, len(neu))
    laenge_alt = struct.unpack_from("<I", roh, wurzel["ad_versatz"])[0]
    struct.pack_into("<I", roh, wurzel["ad_versatz"],
                     (laenge_alt & 0xC0000000) | len(neu))
    _udf_etikett_setzen(roh, 0, wurzel_icb,
                        wurzel["kopf"] + wurzel["ad_laenge"] - 16)
    f.seek((partition["start"] + wurzel_icb) * SEKTOR)
    f.write(bytes(roh))

    # 5. Die Partition muss die neuen Sektoren mit umfassen
    f.seek(partition["lba"] * SEKTOR)
    pd = bytearray(f.read(SEKTOR))
    ende = naechste - partition["start"]
    if ende > partition["laenge"]:
        struct.pack_into("<I", pd, 192, ende)
        _udf_etikett_setzen(pd, 0, partition["lba"], 496)
        f.seek(partition["lba"] * SEKTOR)
        f.write(bytes(pd))

    # 6. UDF verlangt einen zweiten Anker am ENDE des Datentraegers. Weil hinten
    #    Sektoren dazugekommen sind, steht der alte nicht mehr dort - ohne einen
    #    Anker an der neuen letzten Stelle verwirft ein Leser das ganze UDF
    #    ("Expected at least 2 UDF Anchors") und sieht damit auch die
    #    Antwortdatei nicht.
    f.seek(256 * SEKTOR)
    anker = bytearray(f.read(SEKTOR))
    f.seek(naechste * SEKTOR)
    _udf_etikett_setzen(anker, 0, naechste, 496)
    f.write(bytes(anker))
    f.flush()
    return True


def lege_datei_bei(quelle, ziel, dateien, fortschritt=None):
    """Kopiert die ISO und haengt die Dateien ins Wurzelverzeichnis ein.

    dateien: {"AUTOUNATTEND.XML": b"..."} - Name in Grossbuchstaben.
    """
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

        # 6. Dieselben Dateien in den UDF-Baum haengen. Windows liest bei
        #    diesen Abbildern ausschliesslich das UDF - eine Datei, die nur im
        #    ISO9660-Teil steht, ist fuer das Setup unsichtbar.
        if hat_udf(ziel):
            if fortschritt:
                fortschritt(92, "UDF ergaenzen ...")
            _udf_einhaengen(f, dateien, lage, fortschritt)

        # 7. Neue Gesamtgroesse in alle Deskriptoren eintragen
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
