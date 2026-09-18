#!/usr/bin/env python3
"""Baut V3D Schichthöhe als EINZELNE HTML-Dateien aus app.html:

  index.html    Online-Version (three.js + Rechenkern, ~640 KB) — STEP geht an den Server
  offline.html  Offline-Version = index.html + occt-import-js (STEP im Browser, ~11 MB);
                wird vom Server als „V3D-Schichthoehe.html" zum Download angeboten

Der Rechenkern (adaptive-layers.js) kommt aus dem V3D Slicer — eine Quelle für beide.
occt-import-js (LGPL-2.1) wird bei Bedarf per `npm pack` nach lib/occt/ geholt.
Start: python3 bauen.py
"""
import base64, glob, os, re, shutil, subprocess, sys, tarfile, tempfile

BASE = os.path.dirname(os.path.abspath(__file__))
KERN = os.path.expanduser('~/orca-wasm/web/adaptive-layers.js')
OCCT_VER = '0.0.23'
OCCT_DIR = os.path.join(BASE, 'lib', 'occt')


def lies(p, mode='r'):
    with open(p, mode, **({} if 'b' in mode else {'encoding': 'utf-8'})) as f:
        return f.read()


def schreib(name, text):
    with open(os.path.join(BASE, name), 'w', encoding='utf-8') as f:
        f.write(text)
    print('%-13s %6d KB' % (name, len(text.encode()) // 1024))


def hole_occt():
    js = os.path.join(OCCT_DIR, 'occt-import-js.js')
    if os.path.exists(js):
        return
    print('hole occt-import-js %s …' % OCCT_VER)
    tmp = tempfile.mkdtemp()
    try:
        subprocess.run(['npm', 'pack', 'occt-import-js@' + OCCT_VER, '--silent'], cwd=tmp, check=True,
                       stdout=subprocess.DEVNULL)
        with tarfile.open(glob.glob(os.path.join(tmp, '*.tgz'))[0]) as t:
            t.extractall(tmp)
        os.makedirs(OCCT_DIR, exist_ok=True)
        for f in glob.glob(os.path.join(tmp, 'package', 'dist', '*')):
            shutil.copy(f, OCCT_DIR)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


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
inline = lambda code: '<script>' + code.replace('</script', '<\\/script') + '</script>'
online = app.replace(tag, inline(three))
online = imp.sub(lambda m: '// ---- Rechenkern (aus ~/orca-wasm/web/adaptive-layers.js) ----\n' + kern
                 + '\n// ---- Ende Rechenkern ----\n', online)
schreib('index.html', online)

hole_occt()
wasm_b64 = base64.b64encode(lies(os.path.join(OCCT_DIR, 'occt-import-js.wasm'), 'rb')).decode()
occt_js = lies(os.path.join(OCCT_DIR, 'occt-import-js.js'))
hinweis = ('<!-- Enthält occt-import-js %s (LGPL-2.1, github.com/kovacsv/occt-import-js) und '
           'Open CASCADE Technology (LGPL-2.1, dev.opencascade.org) als WebAssembly -->\n' % OCCT_VER)
offline = online.replace(inline(three), hinweis + '<script>window.OCCT_WASM_B64="' + wasm_b64 + '";</script>\n'
                         + inline(occt_js) + '\n' + inline(three), 1)
schreib('offline.html', offline)
