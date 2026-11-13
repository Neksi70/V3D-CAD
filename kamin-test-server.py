#!/usr/bin/env python3
"""Test-Server fuer die Testversion „Kamin-Adventskalender“ (Branch feature/kamin-advent:
Generator _kak* nach v3d_kamin_adventskalender.scad).

Liefert NUR /volme3d-test-kamin.html (= volme3d.html dieses Worktrees) aus (mit demselben
Login-Gate wie der Editor); alles andere (Login, Libs, OCCT-Proxy, Export) kommt
unveraendert aus volme3d_server.py. Die Produktivdatei wird nur importiert,
nicht veraendert.

Oeffentlich ueber den Funnel-Pfad /cad-kamin:
    tailscale funnel --bg --https=443 --set-path=/cad-kamin http://127.0.0.1:8821/cad-kamin

    python3 kamin-test-server.py            # Port 8821
    python3 kamin-test-server.py 18821 --dev  # Headless-Tests: ohne Login/Firebase
"""
import os
import re
import sys
import urllib.parse
from http.server import ThreadingHTTPServer

HIER = os.path.dirname(os.path.abspath(__file__))
PROD = os.path.expanduser('~')          # Libs, WASM, Secrets wie im Produktivbetrieb
TEST_HTML = os.path.join(HIER, 'volme3d.html')   # Arbeitskopie dieses Worktrees
SEITE = '/volme3d-test-kamin.html'

os.chdir(PROD)
sys.path.insert(0, PROD)
# Eigene Nutzungsstatistik, damit Testklicks die Beta-Auswertung nicht verfaelschen
os.environ.setdefault('V3D_NUTZUNG_DB', os.path.expanduser('~/.config/volme3d/nutzung-test.db'))
import volme3d_server as vs              # noqa: E402  (nur lesen, nichts patchen auf Platte)
vs.TMP_STL = '/tmp/volme3d-kamin-export.stl'
DIENST_PORT = 8821
PFAD = '/cad-kamin'


class TestHandler(vs.Handler):
    def parse_request(self):
        ok = super().parse_request()
        self.uin_pfad = ''
        if ok and (self.path == PFAD or self.path.startswith(PFAD + '/') or self.path.startswith(PFAD + '?')):
            self.uin_pfad = PFAD
            self.path = self.path[len(PFAD):] or '/'
            if self.path.startswith('?'):
                self.path = '/' + self.path
        return ok

    def send_header(self, name, value):
        if name.lower() == 'location' and getattr(self, 'uin_pfad', '') and value.startswith('/') and not value.startswith('//'):
            if value.startswith('/login'):
                # Anmeldung laeuft ueber die Live-Adresse (gleiches Cookie),
                # zurueck geht es auf die Testseite hinter dem Pfad.
                value = re.sub(r'([?&]weiter=)(%2F|/)', lambda m: m.group(1) + urllib.parse.quote(PFAD, safe='') + m.group(2), value, count=1)
            else:
                value = self.uin_pfad + value
        super().send_header(name, value)

    def _umleiten(self, ziel):
        self.send_response(302)
        self.send_header('Location', ziel)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        query = self.path[len(path):]
        sauber = path.rstrip('.,;:!)»"\'')
        if sauber != path and sauber in (SEITE, '/volme3d.html', '/login'):
            return self._umleiten(sauber + query)
        # Die Produktiv-App gibt es auf diesem Port nicht → Testversion
        if path == '/' or path in vs.APP_PATHS:
            return self._umleiten(SEITE + query)
        if path == SEITE:
            if 'sitzung=' in query:
                self.send_error(403, 'Gemeinsame Sitzungen sind in der Testversion gesperrt')
                return
            if not DEV and not self._gate_app(path):
                return
            try:
                with open(TEST_HTML, 'rb') as f:
                    data = f.read()
            except OSError:
                self.send_error(404)
                return
            if DEV:   # nur fuer Headless-Tests: ohne Login/Firebase (wie volme3d_server --dev)
                data = data.replace(b'const USE_FIREBASE = true;', b'const USE_FIREBASE = false;')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('X-Robots-Tag', 'noindex')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()


DEV = False

if __name__ == '__main__':
    DEV = '--dev' in sys.argv
    vs.DEV_MODE = DEV
    ports = [int(a) for a in sys.argv[1:] if a.isdigit()]
    port = ports[0] if ports else DIENST_PORT
    if DEV and port == DIENST_PORT:
        sys.exit('--dev (ohne Login) ist auf dem Funnel-Port 8821 verboten – nur fuer lokale Tests auf anderem Port.')
    print(f'[LASER-IDEEN] Testversion auf 127.0.0.1:{port} → {TEST_HTML}', file=sys.stderr)
    ThreadingHTTPServer(('127.0.0.1', port), TestHandler).serve_forever()
