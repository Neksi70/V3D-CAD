# E57-Punktwolken (ASTM E2807) lesen und - minimal, fuer Tests - schreiben.
#
# Ohne libE57/pye57: nur numpy + Standardbibliothek, damit es auch in der
# PyInstaller-EXE ohne weitere DLLs laeuft.
#
# Aufbau einer E57-Datei:
#   - 48-Byte-Kopf: "ASTM-E57", Version, filePhysicalLength, xmlPhysicalOffset,
#     xmlLogicalLength, pageSize (alles little-endian).
#   - Die Datei besteht aus physischen Seiten (meist 1024 Byte); die letzten
#     4 Byte jeder Seite sind eine CRC-32C. Logische Bytes = physische ohne CRC.
#     Offsets in Kopf/XML/Abschnittskoepfen sind PHYSISCH, Laengen LOGISCH.
#   - XML-Teil: /data3D/vectorChild je Scan mit pose und points
#     (CompressedVector: fileOffset, recordCount, prototype).
#   - Binaerteil je Scan: Abschnittskopf (sectionId 1), dann Datenpakete.
#     Jedes Paket enthaelt je Prototyp-Feld einen Puffer; die Puffer eines
#     Feldes ergeben aneinandergehaengt einen durchgehenden Bitstrom.
#
# Bitpackung (Integer/ScaledInteger): Breite = ceil(log2(max-min+1)) Bit,
# LSB-zuerst lueckenlos hintereinander; gespeichert wird (wert - minimum).

import math
import struct
import uuid
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

import numpy as np

SIGNATUR = b"ASTM-E57"
NAMENSRAUM = "http://www.astm.org/COMMITTEE/E57/2010-e57-v1.0"
KOPF = struct.Struct("<8sIIQQQQ")          # 48 Byte
ABSCHNITT = struct.Struct("<B7xQQQ")       # 32 Byte
SEITE = 1024


# --- CRC-32C (Castagnoli) ---------------------------------------------------------------

def _crc_tabelle():
    t = np.zeros(256, dtype=np.uint32)
    for i in range(256):
        c = i
        for _ in range(8):
            c = (c >> 1) ^ 0x82F63B78 if c & 1 else c >> 1
        t[i] = c
    return t


_CRC_TAB = None


def _crc32c_seiten(seiten):
    """CRC-32C fuer alle Zeilen (Seiten) gleichzeitig: vektorisiert ueber die Seiten,
    Schleife nur ueber die Byte-Position (pageSize-4 Durchlaeufe)."""
    global _CRC_TAB
    if _CRC_TAB is None:
        _CRC_TAB = _crc_tabelle()
    crc = np.full(len(seiten), 0xFFFFFFFF, dtype=np.uint32)
    for j in range(seiten.shape[1]):
        crc = _CRC_TAB[(crc ^ seiten[:, j]) & 0xFF] ^ (crc >> np.uint32(8))
    return crc ^ np.uint32(0xFFFFFFFF)


# --- Datei mit Seiten -------------------------------------------------------------------

class _Datei:
    """Liest logische Bytebereiche aus der seitenweise aufgebauten Datei."""

    def __init__(self, pfad):
        try:
            self.roh = np.fromfile(pfad, dtype=np.uint8)
        except OSError as e:
            raise ValueError("E57-Datei kann nicht gelesen werden: %s" % e)
        if len(self.roh) < KOPF.size:
            raise ValueError("Keine gueltige E57-Datei: zu kurz (%d Byte)." % len(self.roh))
        sig, self.major, self.minor, self.laenge, self.xml_off, self.xml_len, self.seite = \
            KOPF.unpack(self.roh[:KOPF.size].tobytes())
        if sig != SIGNATUR:
            raise ValueError("Keine E57-Datei: Signatur \"ASTM-E57\" fehlt am Dateianfang.")
        if self.major != 1:
            raise ValueError("E57-Version %d.%d wird nicht unterstuetzt (nur 1.x)." % (self.major, self.minor))
        if self.seite < 64 or self.seite > (1 << 24) or self.seite % 4:
            raise ValueError("E57-Kopf beschaedigt: unplausible Seitengroesse %d." % self.seite)
        if self.laenge > len(self.roh):
            raise ValueError("E57-Datei abgeschnitten: %d Byte erwartet, %d vorhanden."
                             % (self.laenge, len(self.roh)))
        self.nutz = self.seite - 4

    def logisch(self, phys):
        """Physischen Offset in logischen umrechnen."""
        s, r = divmod(int(phys), self.seite)
        if r >= self.nutz:
            raise ValueError("E57-Datei beschaedigt: Offset %d zeigt in eine Pruefsumme." % phys)
        return s * self.nutz + r

    def lesen(self, log_start, n):
        """n logische Bytes ab logischem Offset (Kopie ohne CRC-Luecken)."""
        n = int(n)
        if n <= 0:
            return np.zeros(0, dtype=np.uint8)
        s0, r0 = divmod(int(log_start), self.nutz)
        s1 = (int(log_start) + n - 1) // self.nutz
        a, b = s0 * self.seite, (s1 + 1) * self.seite
        if b > len(self.roh):
            raise ValueError("E57-Datei beschaedigt oder abgeschnitten: Bereich hinter dem Dateiende.")
        blk = self.roh[a:b].reshape(-1, self.seite)[:, :self.nutz].reshape(-1)
        return blk[r0:r0 + n]


# --- XML-Hilfen -------------------------------------------------------------------------

def _ohne_ns(knoten):
    for k in knoten.iter():
        if isinstance(k.tag, str) and "}" in k.tag:
            k.tag = k.tag.split("}", 1)[1]
    return knoten


def _kind(k, name):
    return None if k is None else k.find(name)


def _zahl(k, name, vorgabe=None):
    c = _kind(k, name)
    if c is None or c.text is None or not c.text.strip():
        return vorgabe
    return float(c.text)


def _attr(k, name, vorgabe=None):
    v = k.get(name)
    return vorgabe if v is None else float(v)


def _quat_matrix(w, x, y, z):
    n = math.sqrt(w * w + x * x + y * y + z * z) or 1.0
    w, x, y, z = w / n, x / n, y / n, z / n
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]])


# --- Bitentpackung ----------------------------------------------------------------------

def _bitbreite(mn, mx):
    spanne = int(mx) - int(mn)
    if spanne < 0:
        raise ValueError("E57: Integer-Feld mit minimum > maximum.")
    return spanne.bit_length()          # = ceil(log2(spanne+1))


def _entpacken(daten, n, bits):
    """n Werte zu je 'bits' Bit (LSB zuerst) aus dem Bytestrom -> uint64."""
    if bits == 0:
        return np.zeros(n, dtype=np.uint64)
    noetig = (n * bits + 7) // 8
    if len(daten) < noetig:
        raise ValueError("E57-Datei unvollstaendig: Bitstrom zu kurz (%d von %d Byte)." % (len(daten), noetig))
    if bits <= 57:
        # je Wert 8 Byte ab dem Startbyte holen, schieben, maskieren
        puffer = np.zeros(noetig + 8, dtype=np.uint8)
        puffer[:noetig] = daten[:noetig]
        off = np.arange(n, dtype=np.uint64) * np.uint64(bits)
        idx = (off >> np.uint64(3)).astype(np.int64)
        schieb = off & np.uint64(7)
        wort = np.zeros(n, dtype=np.uint64)
        for k in range(8):
            wort |= puffer[idx + k].astype(np.uint64) << np.uint64(8 * k)
        return (wort >> schieb) & np.uint64((1 << bits) - 1)
    # sehr breite Felder (selten): ueber Einzelbits
    einz = np.unpackbits(np.asarray(daten[:noetig]), bitorder="little")[:n * bits].reshape(n, bits)
    wert = np.zeros(n, dtype=np.uint64)
    for b in range(bits):
        wert |= einz[:, b].astype(np.uint64) << np.uint64(b)
    return wert


def _feld_werte(feld, daten, n):
    """Ein Prototyp-Feld aus seinem zusammengesetzten Bytestrom dekodieren -> float64."""
    typ = feld.get("type")
    if typ == "Float":
        prec = feld.get("precision", "double")
        dt, gr = (np.float32, 4) if prec == "single" else (np.float64, 8)
        if len(daten) < n * gr:
            raise ValueError("E57-Datei unvollstaendig: Feld \"%s\" hat zu wenig Daten." % feld.tag)
        return np.frombuffer(np.ascontiguousarray(daten[:n * gr]).tobytes(), dtype="<" + np.dtype(dt).str[1:]).astype(np.float64)
    if typ in ("Integer", "ScaledInteger"):
        # Vorgaben laut Norm: voller int64-Bereich
        mn = int(feld.get("minimum", str(-(1 << 63))))
        mx = int(feld.get("maximum", str((1 << 63) - 1)))
        roh = _entpacken(daten, n, _bitbreite(mn, mx))
        wert = roh.astype(np.float64) + float(mn)
        if typ == "ScaledInteger":
            wert = wert * _attr(feld, "scale", 1.0) + _attr(feld, "offset", 0.0)
        return wert
    raise ValueError("E57: Feldtyp \"%s\" (Feld \"%s\") wird nicht unterstuetzt." % (typ, feld.tag))


# --- Binaerabschnitt lesen --------------------------------------------------------------

def _bytestroeme(datei, cv, anzahl_felder):
    """Alle Datenpakete eines CompressedVector lesen -> Liste der Bytestroeme je Feld."""
    try:
        start = datei.logisch(int(cv.get("fileOffset")))
    except (TypeError, ValueError):
        raise ValueError("E57: points ohne gueltiges fileOffset.")
    kopf = datei.lesen(start, ABSCHNITT.size).tobytes()
    sid, sec_len, daten_phys, _index_phys = ABSCHNITT.unpack(kopf)
    if sid != 1:
        raise ValueError("E57-Datei beschaedigt: Abschnittskopf mit sectionId %d statt 1." % sid)
    ende = start + sec_len
    # Abschnitt am Stueck holen (eine Kopie je Scan)
    ende = min(ende, (len(datei.roh) // datei.seite) * datei.nutz)
    if ende <= start:
        raise ValueError("E57-Datei beschaedigt: leerer Punkte-Abschnitt.")
    block = datei.lesen(start, ende - start)
    pos = (datei.logisch(daten_phys) - start) if daten_phys else ABSCHNITT.size
    teile = [[] for _ in range(anzahl_felder)]
    while pos + 4 <= len(block):
        typ = int(block[pos])
        plen = int(block[pos + 2]) | (int(block[pos + 3]) << 8)
        plen += 1
        if pos + plen > len(block):
            raise ValueError("E57-Datei beschaedigt: Datenpaket ragt ueber das Abschnittsende.")
        if typ == 1:
            n_str = int(block[pos + 4]) | (int(block[pos + 5]) << 8)
            if n_str != anzahl_felder:
                raise ValueError("E57-Datei beschaedigt: Paket mit %d Bytestroemen, Prototyp hat %d Felder."
                                 % (n_str, anzahl_felder))
            laengen = np.frombuffer(block[pos + 6:pos + 6 + 2 * n_str].tobytes(), dtype="<u2")
            p = pos + 6 + 2 * n_str
            for i, L in enumerate(laengen):
                L = int(L)
                if p + L > pos + plen:
                    raise ValueError("E57-Datei beschaedigt: Bytestrom laenger als sein Paket.")
                if L:
                    teile[i].append(block[p:p + L])
                p += L
        elif typ not in (0, 2):
            raise ValueError("E57-Datei beschaedigt: unbekannter Pakettyp %d." % typ)
        pos += plen
    return [np.concatenate(t) if t else np.zeros(0, dtype=np.uint8) for t in teile]


# --- Lesen ------------------------------------------------------------------------------

def _scan_lesen(datei, eintrag, nummer):
    name_k = eintrag.find("name")
    name = (name_k.text or "").strip() if name_k is not None and name_k.text else "Scan %d" % (nummer + 1)
    pts = eintrag.find("points")
    if pts is None:
        raise ValueError("E57: Scan \"%s\" hat keine Punkte (points fehlt)." % name)
    if pts.get("type") != "CompressedVector":
        raise ValueError("E57: points von \"%s\" ist kein CompressedVector." % name)
    n = int(pts.get("recordCount", "0"))
    proto = pts.find("prototype")
    if proto is None:
        raise ValueError("E57: Scan \"%s\" ohne prototype." % name)
    felder = list(proto)
    namen = [f.tag for f in felder]
    if n == 0:
        return name, np.zeros((0, 3)), None, None

    hat_kart = all(k in namen for k in ("cartesianX", "cartesianY", "cartesianZ"))
    hat_sph = all(k in namen for k in ("sphericalRange", "sphericalAzimuth", "sphericalElevation"))
    if not hat_kart and not hat_sph:
        raise ValueError("E57: Scan \"%s\" hat weder cartesianX/Y/Z noch sphericalRange/Azimuth/Elevation." % name)

    stroeme = _bytestroeme(datei, pts, len(felder))

    def wert(feldname):
        i = namen.index(feldname)
        return _feld_werte(felder[i], stroeme[i], n)

    if hat_kart:
        xyz = np.column_stack([wert("cartesianX"), wert("cartesianY"), wert("cartesianZ")])
        ungueltig = "cartesianInvalidState"
    else:
        r, az, el = wert("sphericalRange"), wert("sphericalAzimuth"), wert("sphericalElevation")
        ce = np.cos(el)
        xyz = np.column_stack([r * ce * np.cos(az), r * ce * np.sin(az), r * np.sin(el)])
        ungueltig = "sphericalInvalidState"
    gut = None
    if ungueltig in namen:
        gut = wert(ungueltig) == 0

    def grenzen(feldname, lim_k, lim_min, lim_max, w):
        lo, hi = _zahl(lim_k, lim_min), _zahl(lim_k, lim_max)
        f = felder[namen.index(feldname)]
        if lo is None:
            lo = _attr(f, "minimum")
        if hi is None:
            hi = _attr(f, "maximum")
        if lo is None or hi is None:      # Float ohne Angaben: aus den Daten
            lo = float(w.min()) if len(w) else 0.0
            hi = float(w.max()) if len(w) else 1.0
            if lo >= 0 and hi <= 1:
                lo, hi = 0.0, 1.0
        return lo, hi

    farben = None
    if all(k in namen for k in ("colorRed", "colorGreen", "colorBlue")):
        lim = eintrag.find("colorLimits")
        kan = []
        for k, kurz in (("colorRed", "Red"), ("colorGreen", "Green"), ("colorBlue", "Blue")):
            w = wert(k)
            lo, hi = grenzen(k, lim, "color%sMinimum" % kurz, "color%sMaximum" % kurz, w)
            kan.append((w - lo) / (hi - lo) if hi > lo else np.zeros_like(w))
        farben = np.clip(np.column_stack(kan), 0, 1).astype(np.float32)

    inten = None
    if "intensity" in namen:
        w = wert("intensity")
        lo, hi = grenzen("intensity", eintrag.find("intensityLimits"), "intensityMinimum", "intensityMaximum", w)
        inten = np.clip((w - lo) / (hi - lo) if hi > lo else np.zeros_like(w), 0, 1).astype(np.float32)

    if gut is not None and not gut.all():
        xyz = xyz[gut]
        farben = None if farben is None else farben[gut]
        inten = None if inten is None else inten[gut]

    pose = eintrag.find("pose")
    if pose is not None:
        rot, tr = pose.find("rotation"), pose.find("translation")
        if rot is not None:
            R = _quat_matrix(_zahl(rot, "w", 1.0), _zahl(rot, "x", 0.0), _zahl(rot, "y", 0.0), _zahl(rot, "z", 0.0))
            xyz = xyz @ R.T
        if tr is not None:
            xyz = xyz + np.array([_zahl(tr, "x", 0.0), _zahl(tr, "y", 0.0), _zahl(tr, "z", 0.0)])
    return name, xyz, farben, inten


def lesen(pfad):
    """E57-Datei einlesen. Alle Scans werden mit ihrer Pose in Weltkoordinaten
    zusammengefuehrt.

    Rueckgabe: {"xyz": float64 N x 3, "farben": float32 N x 3 (0..1) oder None,
                "intensitaet": float32 N oder None, "scans": Anzahl, "namen": [...]}"""
    datei = _Datei(pfad)
    try:
        xml_start = datei.logisch(datei.xml_off)
        xml = datei.lesen(xml_start, datei.xml_len).tobytes()
    except ValueError:
        raise ValueError("E57-Datei beschaedigt: XML-Teil liegt ausserhalb der Datei.")
    try:
        wurzel = _ohne_ns(ET.fromstring(xml.rstrip(b"\x00")))
    except ET.ParseError as e:
        raise ValueError("E57-Datei beschaedigt: XML-Teil nicht lesbar (%s)." % e)
    d3 = wurzel.find("data3D")
    eintraege = [] if d3 is None else list(d3)
    if not eintraege:
        raise ValueError("E57-Datei enthaelt keine Punktwolken (data3D ist leer).")

    teile_xyz, teile_f, teile_i, namen = [], [], [], []
    for i, e in enumerate(eintraege):
        name, xyz, f, it = _scan_lesen(datei, e, i)
        namen.append(name)
        teile_xyz.append(xyz)
        teile_f.append(f)
        teile_i.append(it)

    xyz = np.concatenate(teile_xyz) if teile_xyz else np.zeros((0, 3))

    def zusammen(teile, form):
        if all(t is None for t in teile):
            return None
        # Scans ohne Farbe/Intensitaet: grau bzw. 0 auffuellen
        return np.concatenate([t if t is not None else np.full((len(x),) + form, 0.5 if form else 0.0,
                                                               dtype=np.float32)
                               for t, x in zip(teile, teile_xyz)])

    return {"xyz": np.ascontiguousarray(xyz, dtype=np.float64),
            "farben": zusammen(teile_f, (3,)),
            "intensitaet": zusammen(teile_i, ()),
            "scans": len(eintraege),
            "namen": namen}


# --- Schreiben (minimal, fuer Tests) ----------------------------------------------------

def _packen(gespeichert, bits):
    """uint64-Werte (bereits minus minimum) LSB-zuerst zu Bytes packen."""
    if bits == 0 or len(gespeichert) == 0:
        return np.zeros(0, dtype=np.uint8)
    b = ((gespeichert[:, None] >> np.arange(bits, dtype=np.uint64)) & np.uint64(1)).astype(np.uint8)
    return np.packbits(b.reshape(-1), bitorder="little")


def _f(v):
    return repr(float(v))


def schreiben(pfad, scans, xyz_skala=None, punkte_je_paket=None):
    """Minimaler E57-Schreiber (1024er-Seiten, CRC-32C).

    scans: Liste von dicts {"xyz", "farben" (0..1, optional), "intensitaet" (optional),
           "pose" (optional: {"rotation": (w,x,y,z), "translation": (x,y,z)}), "name"}.
    xyz_skala: None -> xyz als Float double, sonst ScaledInteger mit dieser Skala.
    punkte_je_paket: Daten auf mehrere Pakete aufteilen (ungefaehr so viele Punkte je Paket)."""
    nutz = SEITE - 4
    log = bytearray(KOPF.size)              # Platz fuer den Kopf

    def phys(l):
        return (l // nutz) * SEITE + l % nutz

    xml_scans = []
    for nr, sc in enumerate(scans):
        xyz = np.asarray(sc["xyz"], dtype=np.float64).reshape(-1, 3)
        n = len(xyz)
        felder = []          # (xml, bytes)
        for a, k in enumerate(("cartesianX", "cartesianY", "cartesianZ")):
            if xyz_skala is None:
                felder.append(('<%s type="Float"/>' % k, xyz[:, a].astype("<f8").tobytes()))
            else:
                roh = np.round(xyz[:, a] / xyz_skala).astype(np.int64)
                mn, mx = (int(roh.min()), int(roh.max())) if n else (0, 0)
                bits = _bitbreite(mn, mx)
                felder.append(('<%s type="ScaledInteger" minimum="%d" maximum="%d" scale="%s" offset="0"/>'
                               % (k, mn, mx, _f(xyz_skala)),
                               _packen((roh - mn).astype(np.uint64), bits).tobytes()))
        extra = ""
        if sc.get("farben") is not None:
            f = np.clip(np.round(np.asarray(sc["farben"], dtype=np.float64).reshape(-1, 3) * 255), 0, 255)
            for a, k in enumerate(("colorRed", "colorGreen", "colorBlue")):
                felder.append(('<%s type="Integer" minimum="0" maximum="255"/>' % k,
                               _packen(f[:, a].astype(np.uint64), 8).tobytes()))
            extra += ('<colorLimits type="Structure"><colorRedMinimum type="Integer">0</colorRedMinimum>'
                      '<colorRedMaximum type="Integer">255</colorRedMaximum>'
                      '<colorGreenMinimum type="Integer">0</colorGreenMinimum>'
                      '<colorGreenMaximum type="Integer">255</colorGreenMaximum>'
                      '<colorBlueMinimum type="Integer">0</colorBlueMinimum>'
                      '<colorBlueMaximum type="Integer">255</colorBlueMaximum></colorLimits>')
        if sc.get("intensitaet") is not None:
            it = np.asarray(sc["intensitaet"], dtype=np.float32).reshape(-1)
            felder.append(('<intensity type="Float" precision="single"/>', it.astype("<f4").tobytes()))
            extra += ('<intensityLimits type="Structure"><intensityMinimum type="Float">0.0</intensityMinimum>'
                      '<intensityMaximum type="Float">1.0</intensityMaximum></intensityLimits>')

        # Pakete: jeden Bytestrom an Bytegrenzen in P Stuecke teilen (Bitstrom ist durchgehend)
        stroeme = [b for _, b in felder]
        P = 1
        if punkte_je_paket:
            P = max(1, -(-n // int(punkte_je_paket)))
        while True:
            grenzen = [[(k * len(s)) // P for k in range(P + 1)] for s in stroeme]
            gross = max((6 + 2 * len(stroeme) + sum(g[k + 1] - g[k] for g in grenzen) for k in range(P)), default=0)
            klein = all(g[k + 1] - g[k] <= 65535 for g in grenzen for k in range(P))
            if gross + 3 <= 65536 and klein:
                break
            P *= 2

        # Abschnitt: 4-Byte-ausgerichtet beginnen
        while len(log) % 4:
            log.append(0)
        start = len(log)
        pakete = bytearray()
        for k in range(P):
            stuecke = [s[g[k]:g[k + 1]] for s, g in zip(stroeme, grenzen)]
            inhalt = struct.pack("<%dH" % len(stuecke), *[len(x) for x in stuecke]) + b"".join(stuecke)
            laenge = 6 + len(inhalt)
            laenge += (-laenge) % 4
            pk = struct.pack("<BBHH", 1, 0, laenge - 1, len(stuecke)) + inhalt
            pk += b"\x00" * (laenge - len(pk))
            pakete += pk
        sec_len = ABSCHNITT.size + len(pakete)
        log += ABSCHNITT.pack(1, sec_len, phys(start + ABSCHNITT.size), 0)
        log += pakete

        pose = ""
        if sc.get("pose"):
            w, x, y, z = sc["pose"].get("rotation", (1, 0, 0, 0))
            tx, ty, tz = sc["pose"].get("translation", (0, 0, 0))
            pose = ('<pose type="Structure"><rotation type="Structure"><w type="Float">%s</w>'
                    '<x type="Float">%s</x><y type="Float">%s</y><z type="Float">%s</z></rotation>'
                    '<translation type="Structure"><x type="Float">%s</x><y type="Float">%s</y>'
                    '<z type="Float">%s</z></translation></pose>' % tuple(map(_f, (w, x, y, z, tx, ty, tz))))
        name = escape(str(sc.get("name", "Scan %d" % (nr + 1))))
        xml_scans.append(
            '<vectorChild type="Structure"><guid type="String">{%s}</guid><name type="String">%s</name>%s%s'
            '<points type="CompressedVector" fileOffset="%d" recordCount="%d"><prototype type="Structure">%s'
            '</prototype><codecs type="Vector" allowHeterogeneousChildren="1"/></points></vectorChild>'
            % (uuid.uuid4(), name, pose, extra, phys(start), n, "".join(x for x, _ in felder)))

    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n<e57Root type="Structure" xmlns="%s">'
           '<formatName type="String">ASTM E57 3D Imaging Data File</formatName>'
           '<guid type="String">{%s}</guid><versionMajor type="Integer">1</versionMajor>'
           '<versionMinor type="Integer">0</versionMinor><coordinateMetadata type="String"/>'
           '<data3D type="Vector" allowHeterogeneousChildren="1">%s</data3D>'
           '<images2D type="Vector" allowHeterogeneousChildren="1"/></e57Root>'
           % (NAMENSRAUM, uuid.uuid4(), "".join(xml_scans))).encode("utf-8")
    while len(log) % 4:
        log.append(0)
    xml_start = len(log)
    log += xml

    seiten = -(-len(log) // nutz)
    log += b"\x00" * (seiten * nutz - len(log))
    log[:KOPF.size] = KOPF.pack(SIGNATUR, 1, 0, seiten * SEITE, phys(xml_start), len(xml), SEITE)

    feld = np.frombuffer(bytes(log), dtype=np.uint8).reshape(seiten, nutz)
    crc = _crc32c_seiten(feld)
    voll = np.empty((seiten, SEITE), dtype=np.uint8)
    voll[:, :nutz] = feld
    voll[:, nutz:] = crc.astype(">u4").view(np.uint8).reshape(seiten, 4)
    with open(pfad, "wb") as f:
        f.write(voll.tobytes())
