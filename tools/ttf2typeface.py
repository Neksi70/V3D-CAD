# TTF/OTF -> three.js typeface.json (facetype.js-Konvention).
# WICHTIG (three.js r128): bei q/b kommt der ENDPUNKT ZUERST, dann Kontrollpunkte.
# Y wird NICHT gespiegelt, resolution = unitsPerEm.
import json, sys
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen

class TFPen(BasePen):
    def __init__(self, gs):
        super().__init__(gs)
        self.o = []
    def f(self, v): return str(int(round(v)))
    def _moveTo(self, pt):
        self.o += ['m', self.f(pt[0]), self.f(pt[1])]
    def _lineTo(self, pt):
        self.o += ['l', self.f(pt[0]), self.f(pt[1])]
    def _qCurveToOne(self, c, pt):
        self.o += ['q', self.f(pt[0]), self.f(pt[1]), self.f(c[0]), self.f(c[1])]
    def _curveToOne(self, c1, c2, pt):
        self.o += ['b', self.f(pt[0]), self.f(pt[1]),
                   self.f(c1[0]), self.f(c1[1]), self.f(c2[0]), self.f(c2[1])]
    def _closePath(self): pass

ttf_path, out_path, family = sys.argv[1], sys.argv[2], sys.argv[3]
font = TTFont(ttf_path)
upem = font['head'].unitsPerEm
cmap = font.getBestCmap()
gs = font.getGlyphSet()
hmtx = font['hmtx']

chars = [chr(c) for c in range(32, 127)] + list('ÄÖÜäöüßéèêàáâçñ„“”‚‘’–—°')
glyphs = {}
for ch in chars:
    cp = ord(ch)
    if cp not in cmap:
        continue
    gname = cmap[cp]
    pen = TFPen(gs)
    gs[gname].draw(pen)
    ha = hmtx[gname][0]
    glyphs[ch] = {"ha": ha, "x_min": 0, "x_max": ha,
                  "o": (" ".join(pen.o) + " ") if pen.o else ""}

out = {
    "glyphs": glyphs,
    "familyName": family,
    "ascender": font['hhea'].ascent,
    "descender": font['hhea'].descent,
    "underlinePosition": font['post'].underlinePosition,
    "underlineThickness": font['post'].underlineThickness,
    "boundingBox": {"yMin": font['head'].yMin, "xMin": font['head'].xMin,
                    "yMax": font['head'].yMax, "xMax": font['head'].xMax},
    "resolution": upem,
    "original_font_information": {"format": 0, "fontFamily": family}
}
with open(out_path, 'w') as fh:
    fh.write(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
print(family, '->', out_path, 'glyphs:', len(glyphs))
