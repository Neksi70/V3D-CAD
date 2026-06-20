#!/usr/bin/env python3
"""HTTP server for Volme3D — liefert NUR die App + benoetigte Dateien aus
(Allowlist), nicht das ganze Verzeichnis. POST /volme3d-export.stl fuer Slicer."""

import os
import sys
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

TMP_STL = '/tmp/volme3d-export.stl'
WASM_GZ = 'volme3d-occt.wasm.gz'
# Gehaertete Auslieferungs-Version (von build.js erzeugt). Liegt sie vor,
# wird sie statt der Arbeitskopie volme3d.html ausgeliefert.
DIST_HTML = 'volme3d.dist.html'
APP_PATHS = ('/', '/volme3d.html')
# Dev-Modus (--dev): liefert IMMER die rohe Arbeitskopie volme3d.html aus,
# nie die dist. Fuer lokale Vorschau der WIP-Aenderungen, ohne Testern
# (die ueber 8765/Funnel die dist sehen) etwas Halbfertiges zu schicken.
DEV_MODE = False

# Erlaubte oeffentliche Pfade -> (Datei, Content-Type). Alles andere: 404.
ALLOW = {
    '/':                                  ('volme3d.html', 'text/html; charset=utf-8'),
    '/volme3d.html':                      ('volme3d.html', 'text/html; charset=utf-8'),
    '/abstimmung.html':                   ('abstimmung.html', 'text/html; charset=utf-8'),
    '/ansehen.html':                      ('ansehen.html', 'text/html; charset=utf-8'),
    '/favicon.svg':                       ('favicon.svg', 'image/svg+xml'),
    '/logo.svg':                          ('logo.svg', 'image/svg+xml'),
    '/volme3d-occt.js':                   ('volme3d-occt.js', 'text/javascript; charset=utf-8'),
    '/lib/three.min.js':                  ('lib/three.min.js', 'text/javascript; charset=utf-8'),
    '/lib/RoundedBoxGeometry.js':         ('lib/RoundedBoxGeometry.js', 'text/javascript; charset=utf-8'),
    '/lib/GLTFLoader.js':                 ('lib/GLTFLoader.js', 'text/javascript; charset=utf-8'),
    '/lib/SVGLoader.js':                  ('lib/SVGLoader.js', 'text/javascript; charset=utf-8'),
    '/lib/BufferGeometryUtils.js':        ('lib/BufferGeometryUtils.js', 'text/javascript; charset=utf-8'),
    '/lib/fflate.min.js':                 ('lib/fflate.min.js', 'text/javascript; charset=utf-8'),
    '/lib/SimplifyModifier.js':           ('lib/SimplifyModifier.js', 'text/javascript; charset=utf-8'),
    '/lib/qrcode.min.js':                 ('lib/qrcode.min.js', 'text/javascript; charset=utf-8'),
    '/lib/leaflet.js':                    ('lib/leaflet.js', 'text/javascript; charset=utf-8'),
    '/lib/leaflet.css':                   ('lib/leaflet.css', 'text/css; charset=utf-8'),
    '/lib/leaflet-marker-icon.png':       ('lib/leaflet-marker-icon.png', 'image/png'),
    '/lib/leaflet-marker-icon-2x.png':    ('lib/leaflet-marker-icon-2x.png', 'image/png'),
    '/lib/leaflet-marker-shadow.png':     ('lib/leaflet-marker-shadow.png', 'image/png'),
    '/Volme3D-Druck-Helfer.bat':          ('Volme3D-Druck-Helfer.bat', 'application/octet-stream'),
    '/volme3d-print-helper-LIESMICH.txt': ('volme3d-print-helper-LIESMICH.txt', 'text/plain; charset=utf-8'),
}


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path != '/volme3d-export.stl':
            self.send_error(404)
            return
        length = int(self.headers.get('Content-Length', 0))
        data = self.rfile.read(length)
        with open(TMP_STL, 'wb') as f:
            f.write(data)
        self.send_response(200)
        self._cors()
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(b'ok')

    def _send_file(self, fname, ctype, disposition=None):
        if not os.path.isfile(fname):
            self.send_error(404)
            return
        with open(fname, 'rb') as f:
            data = f.read()
        self.send_response(200)
        self._cors()
        self.send_header('Content-Type', ctype)
        # HTML nie cachen: sonst zeigt der Browser nach einem Deploy weiter alten
        # Code (war Ursache fuer den wiederkehrenden newGeo-Crash aus dem Cache).
        if ctype.startswith('text/html'):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        if disposition:
            self.send_header('Content-Disposition', disposition)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split('?', 1)[0]

        if path == '/volme3d-export.stl':
            if not os.path.exists(TMP_STL):
                self.send_error(404, 'Kein STL vorhanden')
                return
            self._send_file(TMP_STL, 'model/stl', 'attachment; filename="volme3d.stl"')
            return

        if path == '/volme3d-occt.wasm' and os.path.exists(WASM_GZ):
            with open(WASM_GZ, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self._cors()
            self.send_header('Content-Type', 'application/wasm')
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        # App-Auslieferung: dist bevorzugen, sonst Arbeitskopie (Fallback).
        if path in APP_PATHS:
            if DEV_MODE:
                # Dev: rohe Arbeitskopie ausliefern und das Firebase-Login-Gate
                # ausschalten (USE_FIREBASE=false -> Editor startet ohne Login).
                # Nur die ausgelieferten Bytes werden veraendert; Datei auf
                # Platte und die dist bleiben unberuehrt.
                try:
                    with open('volme3d.html', 'rb') as f:
                        data = f.read()
                except OSError:
                    self.send_error(404)
                    return
                data = data.replace(b'const USE_FIREBASE = true;',
                                    b'const USE_FIREBASE = false;')
                self.send_response(200)
                self._cors()
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            fname = DIST_HTML if os.path.isfile(DIST_HTML) else 'volme3d.html'
            self._send_file(fname, 'text/html; charset=utf-8')
            return

        entry = ALLOW.get(path)
        if entry:
            self._send_file(entry[0], entry[1])
            return

        # Alles andere ist nicht oeffentlich.
        self.send_error(404, 'Not found')

    def log_message(self, fmt, *args):
        pass  # suppress access log spam


if __name__ == '__main__':
    args = sys.argv[1:]
    DEV_MODE = '--dev' in args
    ports = [int(a) for a in args if a.isdigit()]
    port = ports[0] if ports else 8080
    if DEV_MODE:
        print(f'[DEV] Vorschau: rohe Arbeitskopie volme3d.html auf Port {port}, '
              f'ohne Login (USE_FIREBASE=false). Nur lokal, nicht im Funnel.',
              file=sys.stderr)
    # ThreadingHTTPServer: jede Verbindung in eigenem Thread, damit eine
    # haengende/Keep-Alive-Verbindung nicht den ganzen Server blockiert
    # (daemon_threads=True ist Default in 3.7+).
    ThreadingHTTPServer(('', port), Handler).serve_forever()
