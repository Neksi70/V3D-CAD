#!/usr/bin/env python3
"""Baut index.html = EINE Datei (offline lauffähig): app.html + three.js + Rechenkern.

Der Rechenkern (adaptive-layers.js) kommt aus dem V3D Slicer — eine Quelle für beide.
Start: python3 bauen.py
"""
import os, re, sys

BASE = os.path.dirname(os.path.abspath(__file__))
KERN = os.path.expanduser('~/orca-wasm/web/adaptive-layers.js')


def lies(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


app = lies(os.path.join(BASE, 'app.html'))
three = lies(os.path.join(BASE, 'lib', 'three.min.js'))
kern = lies(KERN)
# ES-Modul → Inline-Code im selben <script type="module">
kern = re.sub(r'^export\s+(?=(async\s+)?function|const|let|class)', '', kern, flags=re.M)
if re.search(r'^\s*(export|import)\b', kern, flags=re.M):
    sys.exit('Rechenkern enthält noch import/export — bauen.py anpassen')

tag = '<script src="three.min.js"></script>'
imp = re.compile(r"^import \{[^}]*\} from '\./adaptive-layers\.js';\n", re.M)
if app.count(tag) != 1 or len(imp.findall(app)) != 1:
    sys.exit('Platzhalter in app.html nicht gefunden')
three = three.replace('</script', '<\\/script')
out = app.replace(tag, '<script>' + three + '</script>')
out = imp.sub(lambda m: '// ---- Rechenkern (aus ~/orca-wasm/web/adaptive-layers.js) ----\n' + kern + '\n// ---- Ende Rechenkern ----\n', out)

with open(os.path.join(BASE, 'index.html'), 'w', encoding='utf-8') as f:
    f.write(out)
print('index.html gebaut: %d KB' % (len(out.encode()) // 1024))
