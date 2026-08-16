#!/usr/bin/env python3
# VolmeStick - Minimaler ISO9660/Joliet-Leser.
#
# Warum selbstgebaut: Zum Hineinschauen in eine Windows-ISO braucht man sonst
# entweder root (mount -o loop) oder 7z. Beides ist auf dem Zielrechner nicht
# garantiert. ISO9660 ist einfach genug, um es direkt zu lesen - und derselbe
# Code laeuft dann auch in der Windows-EXE ohne Adminrechte.
#
# Unterstuetzt: Joliet (lange Dateinamen) und Multi-Extent (Dateien > 4 GiB,
# genau der Fall install.wim bei Windows 11).

import struct

SEKTOR = 2048


class IsoFehler(Exception):
    pass


class Eintrag:
    __slots__ = ("name", "pfad", "ist_verzeichnis", "extents", "groesse")

    def __init__(self, name, pfad, ist_verzeichnis, extents, groesse):
        self.name = name
        self.pfad = pfad
        self.ist_verzeichnis = ist_verzeichnis
        self.extents = extents        # Liste (lba, laenge) - mehrere bei > 4 GiB
        self.groesse = groesse

    def __repr__(self):
        art = "DIR " if self.ist_verzeichnis else "%10d" % self.groesse
        return f"<{art} {self.pfad}>"


class Iso:
    def __init__(self, pfad):
        self.pfad = pfad
        self.f = open(pfad, "rb")
        self.volid = ""
        self.joliet = False
        self._wurzel = None
        self._lies_deskriptoren()

    # -- Aufbau ---------------------------------------------------------
    def _sektor(self, lba, anzahl=1):
        self.f.seek(lba * SEKTOR)
        d = self.f.read(SEKTOR * anzahl)
        if len(d) < SEKTOR:
            raise IsoFehler(f"Sektor {lba} nicht lesbar - ISO unvollstaendig?")
        return d

    def _lies_deskriptoren(self):
        primaer = None
        supplement = None
        for lba in range(16, 96):
            d = self._sektor(lba)
            typ = d[0]
            if d[1:6] != b"CD001":
                raise IsoFehler("Keine ISO9660-Datei (Kennung CD001 fehlt)")
            if typ == 1:
                primaer = d
            elif typ == 2:
                # Joliet erkennt man an der Escape-Sequenz %/@ %/C %/E
                if d[88:91] in (b"%/@", b"%/C", b"%/E"):
                    supplement = d
            elif typ == 255:
                break
        if primaer is None:
            raise IsoFehler("Kein Primaerer Volume-Deskriptor gefunden")

        genutzt = supplement if supplement is not None else primaer
        self.joliet = supplement is not None
        roh = genutzt[40:72]
        if self.joliet:
            self.volid = roh.decode("utf-16-be", "ignore").strip().strip("\x00")
        else:
            self.volid = roh.decode("latin-1").strip()
        self._wurzel_record = genutzt[156:190]

    # -- Verzeichnisse --------------------------------------------------
    def _dekodiere_name(self, roh):
        if self.joliet:
            name = roh.decode("utf-16-be", "ignore")
        else:
            name = roh.decode("latin-1")
        if ";" in name:
            name = name.split(";")[0]
        return name

    def _lies_verzeichnis(self, lba, laenge, elternpfad):
        daten = self._sektor(lba, max(1, (laenge + SEKTOR - 1) // SEKTOR))[:laenge]
        pos = 0
        eintraege = []
        offen = None            # laufender Multi-Extent-Eintrag
        while pos < len(daten):
            reclen = daten[pos]
            if reclen == 0:
                # Rest des Sektors ist Fuellmaterial
                pos = (pos // SEKTOR + 1) * SEKTOR
                continue
            rec = daten[pos:pos + reclen]
            pos += reclen
            if len(rec) < 33:
                continue
            e_lba = struct.unpack_from("<I", rec, 2)[0]
            e_len = struct.unpack_from("<I", rec, 10)[0]
            flags = rec[25]
            namelen = rec[32]
            rohname = rec[33:33 + namelen]
            if namelen == 1 and rohname in (b"\x00", b"\x01"):
                continue                      # . und ..
            name = self._dekodiere_name(rohname)
            ist_dir = bool(flags & 0x02)
            pfad = (elternpfad.rstrip("/") + "/" + name) if elternpfad else "/" + name

            if offen is not None and offen.name == name:
                offen.extents.append((e_lba, e_len))
                offen.groesse += e_len
            else:
                offen = Eintrag(name, pfad, ist_dir, [(e_lba, e_len)], e_len)
                eintraege.append(offen)
            if not (flags & 0x80):            # kein weiterer Extent
                offen = None
        return eintraege

    def liste(self, pfad="/"):
        """Eintraege eines Verzeichnisses."""
        if pfad in ("", "/"):
            lba = struct.unpack_from("<I", self._wurzel_record, 2)[0]
            laenge = struct.unpack_from("<I", self._wurzel_record, 10)[0]
            return self._lies_verzeichnis(lba, laenge, "")
        e = self.finde(pfad)
        if e is None or not e.ist_verzeichnis:
            raise IsoFehler(f"Kein Verzeichnis: {pfad}")
        return self._lies_verzeichnis(e.extents[0][0], e.extents[0][1], e.pfad)

    def finde(self, pfad):
        """Eintrag zu einem Pfad, Gross-/Kleinschreibung egal. None wenn weg."""
        teile = [t for t in pfad.replace("\\", "/").split("/") if t]
        aktuell = self.liste("/")
        treffer = None
        for i, teil in enumerate(teile):
            treffer = None
            for e in aktuell:
                if e.name.lower() == teil.lower():
                    treffer = e
                    break
            if treffer is None:
                return None
            if i < len(teile) - 1:
                if not treffer.ist_verzeichnis:
                    return None
                aktuell = self._lies_verzeichnis(
                    treffer.extents[0][0], treffer.extents[0][1], treffer.pfad)
        return treffer

    def existiert(self, pfad):
        return self.finde(pfad) is not None

    def lies(self, eintrag, offset=0, laenge=None):
        """Bytes aus einer Datei - auch ueber Extent-Grenzen hinweg."""
        if isinstance(eintrag, str):
            e = self.finde(eintrag)
            if e is None:
                raise IsoFehler(f"Datei nicht in der ISO: {eintrag}")
            eintrag = e
        if laenge is None:
            laenge = eintrag.groesse - offset
        ergebnis = bytearray()
        pos = 0
        for lba, ext_len in eintrag.extents:
            if pos + ext_len <= offset:
                pos += ext_len
                continue
            start = max(0, offset - pos)
            wieviel = min(ext_len - start, laenge - len(ergebnis))
            self.f.seek(lba * SEKTOR + start)
            ergebnis += self.f.read(wieviel)
            pos += ext_len
            if len(ergebnis) >= laenge:
                break
        return bytes(ergebnis)

    def alle(self, pfad="/", tiefe=0):
        """Rekursiv alle Eintraege (fuer Statistik/Kopieren)."""
        if tiefe > 12:
            return
        for e in self.liste(pfad):
            yield e
            if e.ist_verzeichnis:
                yield from self.alle(e.pfad, tiefe + 1)


    def kopiere(self, eintrag, ziel, fortschritt=None, block=4 * 1024 * 1024):
        """Datei stromweise aus der ISO in eine Zieldatei schreiben.
        Muss stromen: install.wim ist gern 5 GB gross."""
        if isinstance(eintrag, str):
            e = self.finde(eintrag)
            if e is None:
                raise IsoFehler(f"Datei nicht in der ISO: {eintrag}")
            eintrag = e
        geschrieben = 0
        with open(ziel, "wb") as z:
            for lba, ext_len in eintrag.extents:
                self.f.seek(lba * SEKTOR)
                rest = ext_len
                while rest > 0:
                    d = self.f.read(min(block, rest))
                    if not d:
                        raise IsoFehler(f"ISO endet vorzeitig bei {eintrag.pfad}")
                    z.write(d)
                    rest -= len(d)
                    geschrieben += len(d)
                    if fortschritt:
                        fortschritt(geschrieben, eintrag.groesse)
        return geschrieben

    def entpacke(self, zielordner, fortschritt=None, ueberspringen=()):
        """Kompletten ISO-Inhalt in einen Ordner schreiben.
        ueberspringen: Pfade (klein, mit /) die ausgelassen werden."""
        import os
        aus = set(p.lower() for p in ueberspringen)
        eintraege = [e for e in self.alle()]
        gesamt = sum(e.groesse for e in eintraege if not e.ist_verzeichnis
                     and e.pfad.lower() not in aus) or 1
        fertig = 0
        ausgelassen = []
        for e in eintraege:
            ziel = os.path.join(zielordner, e.pfad.lstrip("/").replace("/", os.sep))
            if e.ist_verzeichnis:
                os.makedirs(ziel, exist_ok=True)
                continue
            if e.pfad.lower() in aus:
                ausgelassen.append(e)
                continue
            os.makedirs(os.path.dirname(ziel), exist_ok=True)
            self.kopiere(e, ziel)
            fertig += e.groesse
            if fortschritt:
                fortschritt(fertig, gesamt, e.pfad)
        return ausgelassen

    def close(self):
        try:
            self.f.close()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()
