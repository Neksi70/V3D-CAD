#!/usr/bin/env python3
"""Erzeugt die PNG-Symbole für das Manifest (Umschlag auf dunklem Grund).

Windows bietet die Installation als App nur an, wenn ein PNG ab 192 px im
Manifest steht — ein SVG allein genügt nicht. Aufruf aus dem Projektordner:

    python3 werkzeug/icons_bauen.py
"""
import os

from PIL import Image, ImageDraw, ImageFont

ZIEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIDE = '#1c2030'
ACC = '#F97316'
ACC_L = '#FB923C'
SCHRIFTEN = ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
             '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf')


def schrift(px):
    for p in SCHRIFTEN:
        if os.path.exists(p):
            return ImageFont.truetype(p, px)
    return None


def icon(groesse, rand=0.0):
    """rand: zusätzlicher Sicherheitsabstand — zugeschnittene (maskable)
    Symbole werden von Android und Windows an den Rändern beschnitten."""
    b = Image.new('RGBA', (groesse, groesse), (0, 0, 0, 0))
    d = ImageDraw.Draw(b)
    d.rounded_rectangle([0, 0, groesse - 1, groesse - 1],
                        radius=int(groesse * 0.20), fill=SIDE)
    m = groesse * (0.22 + rand)
    br = groesse - 2 * m
    ho = br * 0.68
    oben = groesse * (0.30 + rand * 0.6)
    dick = max(2, int(groesse * 0.052))
    d.rounded_rectangle([m, oben, m + br, oben + ho],
                        radius=int(groesse * 0.035), outline=ACC, width=dick)
    d.line([(m + dick * 0.4, oben + dick * 0.5),
            (m + br / 2, oben + ho * 0.62),
            (m + br - dick * 0.4, oben + dick * 0.5)],
           fill=ACC, width=dick, joint='curve')
    f = schrift(int(groesse * 0.15))
    if f:
        kasten = d.textbbox((0, 0), 'V3D', font=f)
        d.text(((groesse - (kasten[2] - kasten[0])) / 2, groesse * (0.80 - rand * 0.8)),
               'V3D', font=f, fill=ACC_L)
    return b


def main():
    for g in (192, 512):
        p = os.path.join(ZIEL, 'icon-%d.png' % g)
        icon(g).save(p)
        print('geschrieben:', p)
    p = os.path.join(ZIEL, 'icon-512-maskable.png')
    icon(512, rand=0.06).save(p)
    print('geschrieben:', p)


if __name__ == '__main__':
    main()
