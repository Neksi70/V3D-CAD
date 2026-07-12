#!/usr/bin/env python3
"""Mini-Server für den Orca-WASM-Browser-Test.
COOP/COEP-Header sind Pflicht: ohne crossOriginIsolated kein SharedArrayBuffer,
ohne SharedArrayBuffer keine WASM-Threads. Bind 0.0.0.0 (Tailnet-intern,
Port 8778 ist NICHT im Funnel — nur für Tests vom Desktop aus).
"""
import http.server
import os

PORT = 8778
DIR = os.path.dirname(os.path.abspath(__file__))
WASM_BUILD = os.path.join(DIR, '..', 'OrcaSlicer', 'build-wasm-main', 'src', 'wasm')
PROFILES = os.path.join(DIR, '..', 'profiles-merged')  # Orca-main + BambuStudio-BBL (H2C/H2D/H2S)
WEB = os.path.join(DIR, '..', 'web')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DIR, **kw)

    def do_GET(self):
        # Vendor-Liste dynamisch (kein echtes Verzeichnis-Listing nötig)
        if self.path.split('?')[0] == '/profiles/index.json':
            import json
            vendors = sorted(f[:-5] for f in os.listdir(PROFILES)
                             if f.endswith('.json') and not f.startswith('OrcaFilamentLibrary'))
            body = json.dumps(vendors).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        # Debug-Upload: Modell, das im WASM crasht, zur lokalen Analyse ablegen
        if self.path.split('?')[0] == '/debug-upload':
            from urllib.parse import urlparse, parse_qs, unquote
            name = parse_qs(urlparse(self.path).query).get('name', ['modell.bin'])[0]
            name = os.path.basename(unquote(name)) or 'modell.bin'
            length = int(self.headers.get('Content-Length', 0))
            if 0 < length <= 200 * 1024 * 1024:
                updir = os.path.join(DIR, 'debug-uploads')
                os.makedirs(updir, exist_ok=True)
                with open(os.path.join(updir, name), 'wb') as f:
                    remaining = length
                    while remaining > 0:
                        chunk = self.rfile.read(min(65536, remaining))
                        if not chunk:
                            break
                        f.write(chunk)
                        remaining -= len(chunk)
                self.send_response(200)
            else:
                self.send_response(400)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        self.send_response(404)
        self.end_headers()

    def translate_path(self, path):
        clean = path.split('?')[0]
        # orca-slicer.js/.wasm/.worker.js direkt aus dem Build-Verzeichnis
        name = os.path.basename(clean)
        if name.startswith('orca-slicer.'):
            return os.path.join(WASM_BUILD, name)
        # Die App (M5) aus ../web
        if clean == '/app' or clean == '/app/':
            return os.path.join(WEB, 'index.html')
        if clean.startswith('/app/'):
            rel = os.path.normpath(clean[len('/app/'):])
            if not rel.startswith('..'):
                return os.path.join(WEB, rel)
        # Orca-Profildatenbank: /profiles/<vendor>.json + Unterdateien
        if clean.startswith('/profiles/'):
            from urllib.parse import unquote
            rel = os.path.normpath(unquote(clean[len('/profiles/'):]))
            if not rel.startswith('..'):
                return os.path.join(PROFILES, rel)
        return super().translate_path(path)

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    with http.server.ThreadingHTTPServer(('0.0.0.0', PORT), Handler) as srv:
        print(f'Orca-WASM-Test: http://0.0.0.0:{PORT}/')
        srv.serve_forever()
