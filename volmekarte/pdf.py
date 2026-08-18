#!/usr/bin/env python3
"""VolmeKarte - minimaler PDF-Schreiber, ohne Fremdpakete.

Warum selbst geschrieben: die Karte muss millimetergenau aus dem Drucker
kommen. Ein PDF mit exakter Seitengroesse ist der einzige Weg, der ohne
Browser-Skalierung auskommt - und reportlab & Co. waeren neue Abhaengigkeiten.

Koennen muss das Ding nur vier Dinge:
  * Seiten in exakter mm-Groesse
  * JPEG einbetten (durchgereicht als DCTDecode, kein Neucodieren)
  * Text mit den 14 Standardschriften (metrisch gleich zu Arial/Times/Courier,
    darum passt die Vorschau im Browser dazu)
  * Linien und Flaechen (Falzmarke, Schnittmarken, Hintergrundfarbe)

Das Textlayout (Umbruch, Zentrierung) macht der Browser und schickt fertige
Zeilen mit Position - deshalb braucht es hier keine Schriftbreiten-Tabellen.
"""

import zlib

# 1 Punkt = 1/72 Zoll
def mm2pt(wert):
    return float(wert) * 72.0 / 25.4


SCHRIFTEN = {
    "Helvetica": "Helvetica",
    "Helvetica-Bold": "Helvetica-Bold",
    "Helvetica-Oblique": "Helvetica-Oblique",
    "Helvetica-BoldOblique": "Helvetica-BoldOblique",
    "Times-Roman": "Times-Roman",
    "Times-Bold": "Times-Bold",
    "Times-Italic": "Times-Italic",
    "Times-BoldItalic": "Times-BoldItalic",
    "Courier": "Courier",
    "Courier-Bold": "Courier-Bold",
    "Courier-Oblique": "Courier-Oblique",
    "Courier-BoldOblique": "Courier-BoldOblique",
}


def jpeg_kennwerte(daten):
    """Breite, Hoehe, Farbkanaele und Bittiefe aus dem JPEG-Kopf lesen.

    Wir codieren das Bild nicht um - PDF kann JPEG unveraendert aufnehmen.
    Dafuer muessen aber die Masse bekannt sein.
    """
    if len(daten) < 4 or daten[0] != 0xFF or daten[1] != 0xD8:
        raise ValueError("Das ist keine JPEG-Datei.")
    i = 2
    laenge = len(daten)
    rahmen = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
              0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    while i < laenge - 1:
        if daten[i] != 0xFF:
            i += 1
            continue
        marke = daten[i + 1]
        if marke == 0xFF:
            i += 1
            continue
        if marke in (0xD8, 0x01) or 0xD0 <= marke <= 0xD7:
            i += 2
            continue
        if marke == 0xD9 or marke == 0xDA:
            break
        if i + 4 > laenge:
            break
        seg = int.from_bytes(daten[i + 2:i + 4], "big")
        if marke in rahmen:
            tiefe = daten[i + 4]
            hoehe = int.from_bytes(daten[i + 5:i + 7], "big")
            breite = int.from_bytes(daten[i + 7:i + 9], "big")
            kanaele = daten[i + 9]
            return breite, hoehe, kanaele, tiefe
        i += 2 + seg
    raise ValueError("Im JPEG ist kein Bildrahmen (SOF) zu finden.")


def _pdf_text(zeichen):
    """Text nach WinAnsi (cp1252) wandeln und PDF-gerecht maskieren."""
    roh = zeichen.encode("cp1252", "replace")
    aus = bytearray(b"(")
    for b in roh:
        if b in (0x28, 0x29, 0x5C):      # ( ) \
            aus += b"\\" + bytes([b])
        elif b < 32 or b > 126:
            aus += ("\\%03o" % b).encode("ascii")
        else:
            aus.append(b)
    aus += b")"
    return bytes(aus)


def _zahl(w):
    """Kurz und ohne Exponentialschreibweise - PDF mag kein 1e-05."""
    t = "%.4f" % float(w)
    t = t.rstrip("0").rstrip(".")
    return t if t not in ("", "-0") else "0"


class Inhalt:
    """Sammelt die Zeichenbefehle einer Seite (Koordinaten in mm)."""

    def __init__(self):
        self._z = []
        self.bilder = {}        # name -> jpeg-bytes

    # --- Zustand -----------------------------------------------------
    def sichern(self):
        self._z.append(b"q")

    def zuruecksetzen(self):
        self._z.append(b"Q")

    def matrix(self, a, b, c, d, e_mm, f_mm):
        self._z.append(("%s %s %s %s %s %s cm" % (
            _zahl(a), _zahl(b), _zahl(c), _zahl(d),
            _zahl(mm2pt(e_mm)), _zahl(mm2pt(f_mm)))).encode("ascii"))

    def drehen180(self, breite_mm, hoehe_mm):
        """Panel um 180 Grad drehen, Ursprung bleibt links unten."""
        self.matrix(-1, 0, 0, -1, breite_mm, hoehe_mm)

    def verschieben(self, x_mm, y_mm):
        self.matrix(1, 0, 0, 1, x_mm, y_mm)

    def beschneiden(self, x_mm, y_mm, b_mm, h_mm):
        """Alles Folgende nur innerhalb dieses Rechtecks zeichnen."""
        self._z.append(("%s %s %s %s re W n" % (
            _zahl(mm2pt(x_mm)), _zahl(mm2pt(y_mm)),
            _zahl(mm2pt(b_mm)), _zahl(mm2pt(h_mm)))).encode("ascii"))

    # --- Zeichnen ----------------------------------------------------
    def flaeche(self, x_mm, y_mm, b_mm, h_mm, farbe):
        r, g, b = _farbe(farbe)
        self._z.append(("%s %s %s rg %s %s %s %s re f" % (
            _zahl(r), _zahl(g), _zahl(b),
            _zahl(mm2pt(x_mm)), _zahl(mm2pt(y_mm)),
            _zahl(mm2pt(b_mm)), _zahl(mm2pt(h_mm)))).encode("ascii"))

    def linie(self, x1, y1, x2, y2, farbe="#000000", staerke_mm=0.2,
              gestrichelt=False):
        r, g, b = _farbe(farbe)
        muster = b"[1.5 1.5] 0 d" if gestrichelt else b"[] 0 d"
        self._z.append((("%s %s %s RG %s w " % (
            _zahl(r), _zahl(g), _zahl(b), _zahl(mm2pt(staerke_mm)))
        ).encode("ascii") + muster + (" %s %s m %s %s l S" % (
            _zahl(mm2pt(x1)), _zahl(mm2pt(y1)),
            _zahl(mm2pt(x2)), _zahl(mm2pt(y2)))).encode("ascii")))

    def rahmen(self, x_mm, y_mm, b_mm, h_mm, farbe="#000000", staerke_mm=0.3):
        r, g, b = _farbe(farbe)
        self._z.append(("%s %s %s RG %s w [] 0 d %s %s %s %s re S" % (
            _zahl(r), _zahl(g), _zahl(b), _zahl(mm2pt(staerke_mm)),
            _zahl(mm2pt(x_mm)), _zahl(mm2pt(y_mm)),
            _zahl(mm2pt(b_mm)), _zahl(mm2pt(h_mm)))).encode("ascii"))

    def bild(self, name, jpeg, x_mm, y_mm, b_mm, h_mm):
        """JPEG einsetzen. b_mm/h_mm sind die Zielmasse auf dem Papier."""
        self.bilder[name] = jpeg
        self._z.append(("q %s 0 0 %s %s %s cm /%s Do Q" % (
            _zahl(mm2pt(b_mm)), _zahl(mm2pt(h_mm)),
            _zahl(mm2pt(x_mm)), _zahl(mm2pt(y_mm)), name)).encode("ascii"))

    def text(self, zeichen, x_mm, y_mm, groesse_pt, schrift="Helvetica",
             farbe="#000000", zeichenabstand_pt=0.0):
        if not zeichen:
            return
        r, g, b = _farbe(farbe)
        schrift = schrift if schrift in SCHRIFTEN else "Helvetica"
        teile = [("BT /F_%s %s Tf %s %s %s rg" % (
            schrift.replace("-", "_"), _zahl(groesse_pt),
            _zahl(r), _zahl(g), _zahl(b))).encode("ascii")]
        if zeichenabstand_pt:
            teile.append(("%s Tc" % _zahl(zeichenabstand_pt)).encode("ascii"))
        teile.append(("%s %s Td" % (
            _zahl(mm2pt(x_mm)), _zahl(mm2pt(y_mm)))).encode("ascii"))
        teile.append(_pdf_text(zeichen) + b" Tj ET")
        self._z.append(b" ".join(teile))

    def datenstrom(self):
        return b"\n".join(self._z)


def _farbe(wert):
    """#rrggbb -> (r, g, b) im Bereich 0..1."""
    if isinstance(wert, (list, tuple)) and len(wert) == 3:
        return tuple(max(0.0, min(1.0, float(k))) for k in wert)
    t = str(wert or "#000000").strip().lstrip("#")
    if len(t) == 3:
        t = "".join(z * 2 for z in t)
    if len(t) != 6:
        return (0.0, 0.0, 0.0)
    try:
        return tuple(int(t[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError:
        return (0.0, 0.0, 0.0)


class Dokument:
    def __init__(self, titel="VolmeKarte"):
        self.seiten = []          # (breite_mm, hoehe_mm, Inhalt)
        self.titel = titel

    def seite(self, breite_mm, hoehe_mm):
        inh = Inhalt()
        self.seiten.append((float(breite_mm), float(hoehe_mm), inh))
        return inh

    def bytes(self):
        objekte = [None]          # Index 0 bleibt leer (PDF zaehlt ab 1)

        def neu(inhalt):
            objekte.append(inhalt)
            return len(objekte) - 1

        # Schriften einmal fuer alle Seiten
        schrift_ids = {}
        for name in SCHRIFTEN:
            schrift_ids[name] = neu(
                ("<< /Type /Font /Subtype /Type1 /BaseFont /%s "
                 "/Encoding /WinAnsiEncoding >>" % name).encode("ascii"))

        seiten_baum = neu(None)   # Platzhalter, wird spaeter gefuellt
        seiten_ids = []

        for breite, hoehe, inh in self.seiten:
            bild_ids = {}
            for name, jpeg in inh.bilder.items():
                bw, bh, kanaele, tiefe = jpeg_kennwerte(jpeg)
                raum = {1: "/DeviceGray", 3: "/DeviceRGB",
                        4: "/DeviceCMYK"}.get(kanaele, "/DeviceRGB")
                kopf = ("<< /Type /XObject /Subtype /Image /Width %d /Height %d "
                        "/ColorSpace %s /BitsPerComponent %d /Filter /DCTDecode "
                        "/Length %d >>" % (bw, bh, raum, tiefe, len(jpeg)))
                bild_ids[name] = neu((kopf.encode("ascii"), jpeg))

            roh = inh.datenstrom()
            gepackt = zlib.compress(roh, 9)
            inhalt_id = neu((("<< /Filter /FlateDecode /Length %d >>"
                              % len(gepackt)).encode("ascii"), gepackt))

            fonts = " ".join("/F_%s %d 0 R" % (n.replace("-", "_"), i)
                             for n, i in schrift_ids.items())
            xobj = " ".join("/%s %d 0 R" % (n, i) for n, i in bild_ids.items())
            quellen = "<< /Font << %s >>" % fonts
            if xobj:
                quellen += " /XObject << %s >>" % xobj
            quellen += " /ProcSet [/PDF /Text /ImageC /ImageB] >>"

            seiten_ids.append(neu(
                ("<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %s %s] "
                 "/Resources %s /Contents %d 0 R >>" % (
                     seiten_baum, _zahl(mm2pt(breite)), _zahl(mm2pt(hoehe)),
                     quellen, inhalt_id)).encode("ascii")))

        objekte[seiten_baum] = (
            "<< /Type /Pages /Count %d /Kids [%s] >>" % (
                len(seiten_ids),
                " ".join("%d 0 R" % i for i in seiten_ids))).encode("ascii")

        katalog = neu(("<< /Type /Catalog /Pages %d 0 R >>"
                       % seiten_baum).encode("ascii"))
        info = neu(b"<< /Producer (VolmeKarte) /Creator (VolmeKarte) >>")

        # --- Zusammenbauen -------------------------------------------
        aus = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        versatz = [0] * (len(objekte))
        for nr in range(1, len(objekte)):
            versatz[nr] = len(aus)
            aus += ("%d 0 obj\n" % nr).encode("ascii")
            koerper = objekte[nr]
            if isinstance(koerper, tuple):
                aus += koerper[0] + b"\nstream\n" + koerper[1] + b"\nendstream"
            else:
                aus += koerper
            aus += b"\nendobj\n"

        start = len(aus)
        aus += ("xref\n0 %d\n" % len(objekte)).encode("ascii")
        aus += b"0000000000 65535 f \n"
        for nr in range(1, len(objekte)):
            aus += ("%010d 00000 n \n" % versatz[nr]).encode("ascii")
        aus += ("trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\n"
                "startxref\n%d\n%%%%EOF\n" % (
                    len(objekte), katalog, info, start)).encode("ascii")
        return bytes(aus)
