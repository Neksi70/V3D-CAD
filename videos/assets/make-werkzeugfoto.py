#!/usr/bin/env python3
"""Erzeugt das Vorführ-Foto für das Werkzeug-Einleger-Video.

Der Generator erwartet: Werkzeug auf einem weißen DIN-A4-Blatt, von oben
fotografiert; das Blatt ist der Maßstab. Statt ein echtes Foto zu hinterlegen,
wird die Szene hier gezeichnet — dadurch kennen wir die Blattecken auf den
Pixel genau und das Drehbuch kann sie im Video zuverlässig anklicken.

Damit es nicht nach Screenshot aussieht, wird das Blatt leicht schräg in die
Ansicht projiziert, so wie ein aus der Hand geschossenes Foto.

Schreibt neben dem PNG eine .json mit den vier Blattecken in Bildpixeln.

  python3 videos/assets/make-werkzeugfoto.py
"""
import json
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
FOTO_W, FOTO_H = 1600, 2000          # "Kamerabild"
MM = 6.6                              # Pixel pro mm auf dem Blatt
A4_W, A4_H = int(210 * MM), int(297 * MM)

TISCH = (108, 112, 120)
BLATT = (250, 250, 248)
STAHL = (58, 62, 70)

# Zielecken des Blattes im Kamerabild (leicht schräg, wie freihand fotografiert)
ECKEN = [(214, 176), (1402, 128), (1454, 1852), (166, 1806)]


def perspektiv_koeff(ziel, quelle):
    """Koeffizienten für Image.transform(PERSPECTIVE) — Ziel -> Quelle."""
    matrix = []
    for (x, y), (u, v) in zip(ziel, quelle):
        matrix.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        matrix.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    # kleines Gleichungssystem (8x8) ohne numpy lösen
    a = [row[:] + [w] for row, w in zip(matrix, [p for pt in quelle for p in pt])]
    n = 8
    for i in range(n):
        p = max(range(i, n), key=lambda r: abs(a[r][i]))
        a[i], a[p] = a[p], a[i]
        piv = a[i][i]
        a[i] = [v / piv for v in a[i]]
        for r in range(n):
            if r != i and a[r][i]:
                f = a[r][i]
                a[r] = [v - f * w for v, w in zip(a[r], a[i])]
    return [a[i][n] for i in range(n)]


def ringschluessel(d, x, y, laenge, r_gross, r_klein):
    """Ringschlüssel: zwei Ringe, verbunden durch einen Schaft."""
    d.rounded_rectangle([x - laenge / 2, y - 13 * MM, x + laenge / 2, y + 13 * MM],
                        radius=13 * MM, fill=STAHL)
    for vz, r in ((-1, r_gross), (1, r_klein)):
        cx = x + vz * laenge / 2
        d.ellipse([cx - r, y - r, cx + r, y + r], fill=STAHL)
        loch = r * 0.58
        d.ellipse([cx - loch, y - loch, cx + loch, y + loch], fill=BLATT)


def schraubendreher(d, x, y, laenge):
    """Schraubendreher: Griff, Schaft, Klinge."""
    griff = laenge * 0.38
    d.rounded_rectangle([x - laenge / 2, y - 15 * MM, x - laenge / 2 + griff, y + 15 * MM],
                        radius=9 * MM, fill=STAHL)
    d.rounded_rectangle([x - laenge / 2 + griff, y - 4.5 * MM, x + laenge / 2 - 12 * MM, y + 4.5 * MM],
                        radius=3 * MM, fill=STAHL)
    d.polygon([(x + laenge / 2 - 12 * MM, y - 7 * MM), (x + laenge / 2, y - 4 * MM),
               (x + laenge / 2, y + 4 * MM), (x + laenge / 2 - 12 * MM, y + 7 * MM)], fill=STAHL)


def main():
    # 1) Blatt in Aufsicht zeichnen
    blatt = Image.new('RGB', (A4_W, A4_H), BLATT)
    d = ImageDraw.Draw(blatt)
    ringschluessel(d, A4_W * 0.5, A4_H * 0.30, 150 * MM, 22 * MM, 18 * MM)
    schraubendreher(d, A4_W * 0.5, A4_H * 0.62, 175 * MM)

    # 2) perspektivisch ins Kamerabild legen
    foto = Image.new('RGB', (FOTO_W, FOTO_H), TISCH)
    quelle = [(0, 0), (A4_W, 0), (A4_W, A4_H), (0, A4_H)]
    koeff = perspektiv_koeff(ECKEN, quelle)
    warp = blatt.transform((FOTO_W, FOTO_H), Image.PERSPECTIVE, koeff,
                           Image.BICUBIC, fillcolor=None)
    maske = Image.new('L', (FOTO_W, FOTO_H), 0)
    ImageDraw.Draw(maske).polygon(ECKEN, fill=255)
    # weicher Blattschatten, damit die Kante nicht wie ausgeschnitten wirkt
    schatten = maske.filter(ImageFilter.GaussianBlur(14)).point(lambda v: v // 3)
    foto.paste((70, 74, 82), (0, 0), schatten)
    foto.paste(warp, (0, 0), maske)
    foto = foto.filter(ImageFilter.GaussianBlur(0.6))

    png = os.path.join(HERE, 'werkzeug-a4.png')
    foto.save(png, quality=92)
    with open(os.path.join(HERE, 'werkzeug-a4.json'), 'w') as fh:
        json.dump({'groesse': [FOTO_W, FOTO_H], 'ecken': ECKEN}, fh, indent=1)
    print('geschrieben:', png, foto.size)
    print('Blattecken :', ECKEN)


if __name__ == '__main__':
    main()
