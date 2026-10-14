#!/usr/bin/env python3
"""Baut V3D Druckcheck als EINE HTML-Datei aus app.html (three.js + Prüfkern inline).

Der Prüfkern (print-check.js) kommt aus dem V3D Slicer — eine Quelle für beide.
Nach Änderungen an ~/orca-wasm/web/print-check.js hier neu bauen: python3 bauen.py
Die fertige index.html läuft auch offline (Doppelklick) — der Server bietet sie als Download an.
"""
import json, os, re, sys

BASE = os.path.dirname(os.path.abspath(__file__))
KERN = os.path.expanduser('~/orca-wasm/web/print-check.js')
PARAMS = os.path.expanduser('~/orca-wasm/web/params.json')   # deutsche Einstellungsnamen (aus Orca de.po)


def lies(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


app = lies(os.path.join(BASE, 'app.html'))
three = lies(os.path.join(BASE, 'lib', 'three.min.js'))
kern = lies(KERN)
# ES-Modul → Block mit Namensraum PC (gleiche Namen wie beim import * as PC)
namen = re.findall(r'^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)', kern, flags=re.M)
kern = re.sub(r'^export\s+(?=(async\s+)?function|const|let|class)', '', kern, flags=re.M)
if re.search(r'^\s*(export|import)\b', kern, flags=re.M) or not namen:
    sys.exit('Prüfkern enthält noch import/export — bauen.py anpassen')

tag = '<script src="three.min.js"></script>'
imp = "import * as PC from './print-check.js';\n"
if app.count(tag) != 1 or app.count(imp) != 1:
    sys.exit('Platzhalter in app.html nicht gefunden')
inline = lambda code: '<script>' + code.replace('</script', '<\\/script') + '</script>'
P = json.load(open(PARAMS, encoding='utf-8'))
labels = {'pages': [{'groups': [{'name': g['name'], 'options': g['options']} for g in pg['groups']]} for pg in P['pages']],
          'options': {k: {'label': v['label']} for k, v in P['options'].items() if v.get('label')}}
block = ('// ---- Prüfkern (aus ~/orca-wasm/web/print-check.js) ----\nconst PC = (() => {\n' + kern
         + '\nreturn { ' + ', '.join(namen) + ' };\n})();\nPC.setKeyLabels(PC.labelsFromParams(' + json.dumps(labels, ensure_ascii=False, separators=(',', ':')) + '));\n// ---- Ende Prüfkern ----\n')
out = app.replace(tag, inline(three)).replace(imp, block)
with open(os.path.join(BASE, 'index.html'), 'w', encoding='utf-8') as f:
    f.write(out)
print('index.html %d KB, %d Kern-Funktionen' % (len(out.encode()) // 1024, len(namen)))
