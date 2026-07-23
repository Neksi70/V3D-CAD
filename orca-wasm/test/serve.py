#!/usr/bin/env python3
"""Mini-Server für den Orca-WASM-Browser-Test.
COOP/COEP-Header sind Pflicht: ohne crossOriginIsolated kein SharedArrayBuffer,
ohne SharedArrayBuffer keine WASM-Threads. Bind 0.0.0.0 (Tailnet-intern,
Port 8778 ist NICHT im Funnel — nur für Tests vom Desktop aus).
"""
import gzip as _gzip
import hashlib
import http.server
import os
import re
import shutil
import tempfile

PORT = 8778
DIR = os.path.dirname(os.path.abspath(__file__))
# Cache für vorkomprimierte Dateien — bewusst AUSSERHALB des Quellbaums,
# damit keine .gz-Artefakte neben den Quellen/im Repo landen.
GZ_CACHE = os.path.join(tempfile.gettempdir(), 'v3d-gzcache')
WASM_BUILD = os.path.join(DIR, '..', 'OrcaSlicer', 'build-wasm-main', 'src', 'wasm')
PROFILES = os.path.join(DIR, '..', 'profiles-merged')  # Orca-main + BambuStudio-BBL (H2C/H2D/H2S)
WEB = os.path.join(DIR, '..', 'web')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DIR, **kw)

    def do_GET(self):
        # /app ohne Slash → relative Pfade (slicer-worker.js, params.json …)
        # zeigen sonst auf die Root und laufen ins 404
        if self.path.split('?')[0] == '/app':
            self.send_response(301)
            self.send_header('Location', '/app/')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
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
        # Aggregierte Druckerliste eines Herstellers: EIN Request statt ~150
        # Einzel-Fetches der machine-Unterprofile (Herstellerwechsel/Seitenstart
        # dauerte sonst zweistellige Sekunden über den Tailscale-Proxy).
        m = re.match(r'^/profiles/([^/]+)\.machines\.json$', self.path.split('?')[0])
        if m:
            import json
            from urllib.parse import unquote
            vendor = os.path.basename(unquote(m.group(1)))
            body, ok = b'[]', False
            try:
                with open(os.path.join(PROFILES, vendor + '.json')) as f:
                    idx = json.load(f)
                # model_id (z. B. "O1C2") aus den machine_model-Profilen — die
                # Drucker melden ihren Typ als model_id über MQTT/Cloud
                model_ids = {}
                for e in idx.get('machine_model_list', []):
                    p = os.path.normpath(os.path.join(PROFILES, vendor, e.get('sub_path', '')))
                    if not p.startswith(os.path.normpath(PROFILES)):
                        continue
                    try:
                        with open(p) as f:
                            model_ids[e['name']] = json.load(f).get('model_id', '')
                    except (OSError, ValueError, KeyError):
                        continue
                out = []
                for e in idx.get('machine_list', []):
                    p = os.path.normpath(os.path.join(PROFILES, vendor, e.get('sub_path', '')))
                    if not p.startswith(os.path.normpath(PROFILES)):
                        continue
                    try:
                        with open(p) as f:
                            j = json.load(f)
                    except (OSError, ValueError):
                        continue
                    if str(j.get('instantiation')) == 'false':
                        continue
                    first = lambda v: (v[0] if isinstance(v, list) and v else v) or ''
                    model = j.get('printer_model') or e['name']
                    out.append({'name': e['name'], 'model': model,
                                'modelId': model_ids.get(model, ''),
                                'defProcess': first(j.get('default_print_profile')),
                                'defFilament': first(j.get('default_filament_profile'))})
                body, ok = json.dumps(out).encode(), True
            except (OSError, ValueError):
                pass
            self.send_response(200 if ok else 404)
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

    # ---- Vorkomprimierte Auslieferung ------------------------------------
    # Der Orca-Kern ist 37 MB und ging bisher UNKOMPRIMIERT raus — aus der Ferne
    # (Funnel) dauerte der erste Start dadurch ewig. gzip drückt ihn auf ~9 MB
    # (fast 4x). Komprimiert wird EINMAL auf Platte, danach nur ausgeliefert.
    GZIP_EXT = ('.wasm', '.js', '.mjs', '.html', '.json', '.css', '.svg')
    GZIP_MIN = 4096

    def _gz_for(self, path):
        """Pfad einer aktuellen gzip-Variante von *path* (wird bei Bedarf erzeugt)."""
        if not path.lower().endswith(self.GZIP_EXT):
            return None
        try:
            st = os.stat(path)
        except OSError:
            return None
        if st.st_size < self.GZIP_MIN:
            return None
        gz = os.path.join(GZ_CACHE, hashlib.sha1(os.path.abspath(path).encode()).hexdigest() + '.gz')
        try:                                   # vorhandene Variante noch frisch?
            if int(os.path.getmtime(gz)) == int(st.st_mtime):
                return gz
        except OSError:
            pass
        try:
            os.makedirs(GZ_CACHE, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=GZ_CACHE, delete=False) as tmp:
                tmpname = tmp.name
                with open(path, 'rb') as src, \
                     _gzip.GzipFile(fileobj=tmp, mode='wb', compresslevel=6) as dst:
                    shutil.copyfileobj(src, dst, 1 << 20)
            os.utime(tmpname, (int(st.st_mtime), int(st.st_mtime)))
            os.replace(tmpname, gz)             # atomar: nie halbe Dateien ausliefern
            return gz
        except Exception:
            return None

    def send_head(self):
        if 'gzip' not in self.headers.get('Accept-Encoding', ''):
            return super().send_head()
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        gz = self._gz_for(path)
        if not gz:
            return super().send_head()
        st = os.stat(path)
        # If-Modified-Since selbst beantworten — sonst käme das ~9-MB-gzip bei
        # JEDEM Aufruf neu statt als 304 (das macht sonst der Elternhandler).
        ims = self.headers.get('If-Modified-Since')
        if ims:
            try:
                from email.utils import parsedate_to_datetime
                import datetime
                t = parsedate_to_datetime(ims)
                if t.tzinfo is None:
                    t = t.replace(tzinfo=datetime.timezone.utc)
                if int(t.timestamp()) >= int(st.st_mtime):
                    self.send_response(304)
                    self.send_header('Vary', 'Accept-Encoding')
                    self.end_headers()
                    return None
            except Exception:
                pass
        try:
            f = open(gz, 'rb')
        except OSError:
            return super().send_head()
        self.send_response(200)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Encoding', 'gzip')
        self.send_header('Content-Length', str(os.path.getsize(gz)))
        self.send_header('Last-Modified', self.date_time_string(int(st.st_mtime)))
        self.send_header('Vary', 'Accept-Encoding')
        self.end_headers()
        return f

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        # no-cache statt no-store: Browser darf cachen, muss aber revalidieren.
        # SimpleHTTPRequestHandler beantwortet If-Modified-Since mit 304 —
        # das 37-MB-WASM und die Profile kommen so nur nach Änderungen neu.
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    with http.server.ThreadingHTTPServer(('0.0.0.0', PORT), Handler) as srv:
        print(f'Orca-WASM-Test: http://0.0.0.0:{PORT}/')
        srv.serve_forever()
