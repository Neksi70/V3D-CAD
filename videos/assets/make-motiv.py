#!/usr/bin/env python3
"""Erzeugt das Vorführ-Motiv für das Bild-Box-Video.

Ein Schmetterling ist als Vorlage ideal: klare Silhouette (die Box bekommt
ihre Form daraus) und mehrere klar getrennte Farbflächen (damit der
Farben-Regler im Video etwas zu tun hat). PNG mit Transparenz, weil der
Generator daraus direkt die Kontur nimmt.

  python3 videos/assets/make-motiv.py
"""
from PIL import Image, ImageDraw

S = 4          # Supersampling gegen Treppchen
W = H = 900
FLUEGEL_OBEN = (232, 93, 45, 255)     # Orange
FLUEGEL_UNTEN = (247, 181, 56, 255)   # Gelb
KOERPER = (58, 46, 62, 255)           # Dunkelbraun
PUNKTE = (252, 240, 227, 255)         # Creme


def fluegel(d, cx, cy, rx, ry, farbe, spiegel=False):
    """Ein Flügelpaar-Teil als Ellipse, leicht nach außen gekippt."""
    box = [cx - rx, cy - ry, cx + rx, cy + ry]
    d.ellipse(box, fill=farbe)


def main():
    img = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    mx = W * S // 2
    sc = S

    # obere Flügel
    for vz in (-1, 1):
        fluegel(d, mx + vz * 175 * sc, 330 * sc, 168 * sc, 205 * sc, FLUEGEL_OBEN)
    # untere Flügel
    for vz in (-1, 1):
        fluegel(d, mx + vz * 140 * sc, 600 * sc, 132 * sc, 158 * sc, FLUEGEL_UNTEN)

    # Musterpunkte auf den oberen Flügeln
    for vz in (-1, 1):
        d.ellipse([mx + vz * 205 * sc - 42 * sc, 268 * sc - 42 * sc,
                   mx + vz * 205 * sc + 42 * sc, 268 * sc + 42 * sc], fill=PUNKTE)
        d.ellipse([mx + vz * 160 * sc - 26 * sc, 400 * sc - 26 * sc,
                   mx + vz * 160 * sc + 26 * sc, 400 * sc + 26 * sc], fill=PUNKTE)

    # Körper
    d.ellipse([mx - 30 * sc, 250 * sc, mx + 30 * sc, 700 * sc], fill=KOERPER)
    d.ellipse([mx - 42 * sc, 205 * sc, mx + 42 * sc, 300 * sc], fill=KOERPER)

    # Fühler
    for vz in (-1, 1):
        d.line([(mx + vz * 12 * sc, 235 * sc), (mx + vz * 110 * sc, 105 * sc)],
               fill=KOERPER, width=int(11 * sc))
        d.ellipse([mx + vz * 110 * sc - 22 * sc, 105 * sc - 22 * sc,
                   mx + vz * 110 * sc + 22 * sc, 105 * sc + 22 * sc], fill=KOERPER)

    img = img.resize((W, H), Image.LANCZOS)
    ziel = __file__.rsplit('/', 1)[0] + '/schmetterling.png'
    img.save(ziel)
    print('geschrieben:', ziel, img.size)


if __name__ == '__main__':
    main()
