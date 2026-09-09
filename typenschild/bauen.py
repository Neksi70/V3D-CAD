#!/usr/bin/env python3
"""Baut index.html aus app.html: opentype.js und die Schrift-Subsets werden
inline eingebettet, damit die Seite als EINE Datei laeuft (auch hinter dem
Funnel, der das Pfad-Praefix abschneidet, und direkt von der Festplatte).
Aufruf: python3 bauen.py"""
import base64, os
BASE = os.path.dirname(os.path.abspath(__file__))
LIB = "/home/v3da/lib/opentype.min.js"
SCHRIFTEN = {
    "Liberation Serif": "schriften/LiberationSerif-Regular.subset.ttf",
    "Liberation Serif Fett": "schriften/LiberationSerif-Bold.subset.ttf",
}

def b64(pfad):
    with open(os.path.join(BASE, pfad), "rb") as f:
        return base64.b64encode(f.read()).decode()

src = open(os.path.join(BASE, "app.html"), encoding="utf-8").read()
lib = open(LIB, encoding="utf-8").read()
assert "</script" not in lib
fonts = "const SCHRIFT_B64 = " + str({k: b64(v) for k, v in SCHRIFTEN.items()}).replace("'", '"') + ";"
out = src.replace('<script src="lib/opentype.min.js"></script>', "<script>" + lib + "</script>")
out = out.replace('<script src="schriften.js"></script>', "<script>" + fonts + "</script>")
assert out != src
open(os.path.join(BASE, "index.html"), "w", encoding="utf-8").write(out)
# Dev-Dateien fuer app.html direkt (ohne Bau): lib/ und schriften.js
os.makedirs(os.path.join(BASE, "lib"), exist_ok=True)
open(os.path.join(BASE, "lib/opentype.min.js"), "w", encoding="utf-8").write(lib)
open(os.path.join(BASE, "schriften.js"), "w", encoding="utf-8").write(fonts)
print("index.html:", os.path.getsize(os.path.join(BASE, "index.html")), "Bytes")
