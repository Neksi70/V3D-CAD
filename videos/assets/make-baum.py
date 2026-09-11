#!/usr/bin/env python3
"""Erzeugt ein schlichtes Baum-SVG fuer das Howto-Video (asymmetrisch, damit man
Drehung und Spiegelung im Film sofort sieht)."""
import pathlib
svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm" height="100mm">
  <path d="M46,96 H54 V70 H46 Z"/>
  <path d="M50,6 L74,40 H60 L78,66 H22 L40,40 H26 Z"/>
  <path d="M63,74 h14 v7 h-14 Z"/>
</svg>'''
pathlib.Path(__file__).with_name('baum.svg').write_text(svg, encoding='utf-8')
print('baum.svg geschrieben')
