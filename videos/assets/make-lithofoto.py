#!/usr/bin/env python3
"""Erzeugt das Vorführ-Motiv für das Lithophane-Video.

Ein Lithophane lebt von weichen Helligkeitsverläufen — je heller die Stelle,
desto dünner das Material. Ein Foto mit klaren Flächen taugt dafür nicht,
deshalb wird hier eine Bergszene im Gegenlicht gezeichnet: durchgehender
Himmelsverlauf, Sonne mit Glanz, gestaffelte Bergrücken und Dunst dazwischen.

  python3 videos/assets/make-lithofoto.py
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 1200, 1600
HORIZONT = int(H * 0.62)


def himmel(img):
    """Vertikaler Verlauf von dunklem Blaugrau oben zu hellem Dunst unten."""
    d = ImageDraw.Draw(img)
    for y in range(HORIZONT):
        t = y / HORIZONT
        v = int(42 + 208 * (t ** 1.05))
        d.line([(0, y), (W, y)], fill=(v, int(v * 0.97), int(v * 0.92)))


def sonne(img, cx, cy, r):
    """Sonnenscheibe mit weichem Hof — der hellste Punkt im Bild."""
    hof = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(hof)
    for i in range(28, 0, -1):
        rr = r * (1 + i * 0.42)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=int(120 / i))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    hof = hof.filter(ImageFilter.GaussianBlur(18))
    img.paste((255, 253, 246), (0, 0), hof)


def bergkette(img, basis, hoehe, zacken, helligkeit, versatz):
    """Ein Bergrücken als Polygon; hintere Ketten sind heller (Dunst)."""
    punkte = []
    for i in range(zacken + 1):
        x = W * i / zacken
        h = hoehe * (0.45 + 0.55 * abs(math.sin(i * 1.7 + versatz)))
        h *= 0.75 + 0.25 * math.sin(i * 0.6 + versatz * 2)
        punkte.append((x, basis - h))
    punkte += [(W, H), (0, H)]
    schicht = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(schicht).polygon(
        punkte, fill=(helligkeit, helligkeit, int(helligkeit * 1.05), 255))
    img.paste(schicht, (0, 0), schicht)


def main():
    img = Image.new('RGB', (W, H), (30, 30, 34))
    himmel(img)
    sonne(img, W * 0.62, HORIZONT * 0.5, 96)

    # von hinten nach vorn: je näher, desto dunkler
    bergkette(img, HORIZONT + 40, 250, 7, 150, 0.0)
    bergkette(img, HORIZONT + 130, 300, 5, 104, 1.3)
    bergkette(img, HORIZONT + 250, 340, 4, 62, 2.6)
    bergkette(img, H * 0.94, 300, 3, 28, 4.1)

    # Dunstband über dem Horizont, damit die Ketten ineinander übergehen
    dunst = Image.new('L', (W, H), 0)
    dd = ImageDraw.Draw(dunst)
    for y in range(HORIZONT - 60, HORIZONT + 220):
        a = 1 - abs(y - (HORIZONT + 80)) / 160
        if a > 0:
            dd.line([(0, y), (W, y)], fill=int(135 * a))
    img.paste((225, 222, 214), (0, 0), dunst.filter(ImageFilter.GaussianBlur(26)))

    img = img.filter(ImageFilter.GaussianBlur(1.1))
    ziel = os.path.join(HERE, 'berge.jpg')
    img.save(ziel, quality=92)

    grau = img.convert('L')
    hist = grau.histogram()
    dunkel = sum(hist[:70]) / (W * H)
    hell = sum(hist[190:]) / (W * H)
    print('geschrieben:', ziel, img.size)
    print(f'Tonwerte: {dunkel:.0%} dunkel, {hell:.0%} hell '
          f'(beides > 5% = brauchbarer Kontrast fuers Lithophane)')


if __name__ == '__main__':
    main()
