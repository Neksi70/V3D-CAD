#!/usr/bin/env python3
"""HTTP server for Volme3D — liefert NUR die App + benoetigte Dateien aus
(Allowlist), nicht das ganze Verzeichnis. POST /volme3d-export.stl fuer Slicer."""

import os
import re
import sys
import ssl
import json
import uuid
import time
import base64
import tempfile
import threading
import http.client
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# OCCT-Backend (occt-server.js) laeuft lokal auf HTTPS:3001 (self-signed).
# Wir reichen /api/occt* + /occt-health dorthin durch, damit die Server-CAD-
# Funktionen ueber den oeffentlichen Funnel-Origin (443) erreichbar sind — der
# Port 3001/18790 ist NICHT im Funnel, nur im Tailnet (war Ursache fuer den
# "haengt bei 85%"-Bug bei externen Testern).
OCCT_HOST = '127.0.0.1'
OCCT_PORT = 3001
OCCT_TIMEOUT = 600   # Booleans mit vielen Tools (Wabenmuster) brauchen Minuten
_OCCT_CTX = ssl._create_unverified_context()

# ── KI-Generierung (Hugging Face ZeroGPU, kostenlos) ──────────────────
# Text→Bild ueber den FLUX.1-schnell-Space, Bild→3D ueber den offiziellen
# tencent/Hunyuan3D-2-Space. Kein API-Key beim Nutzer mehr: der Server
# spricht die Spaces selbst an (optionaler HF-Token hebt das ZeroGPU-Limit).
# gradio_client wird erst im Job-Thread importiert — der Server startet
# auch, wenn das Paket fehlt (dann liefert /ki/generate einen Fehler).
KI_TOKEN_FILE = os.path.expanduser('~/.config/volme3d/hf_token')
KI_FLUX_SPACE = 'black-forest-labs/FLUX.1-schnell'
KI_SHAPE_SPACE = 'tencent/Hunyuan3D-2'
KI_MAX_PER_DAY = 20      # eigene Bremse VOR dem ZeroGPU-Tageslimit
KI_JOB_TTL = 1800        # fertige Jobs nach 30 min vergessen
_ki_jobs = {}            # id -> {status, phase, file, error, ts}
_ki_gpu_lock = threading.Lock()   # nur 1 Generierung gleichzeitig (Quota!)
_ki_day = ['', 0]        # [YYYY-MM-DD, Zaehler]


def _ki_token():
    try:
        with open(KI_TOKEN_FILE) as f:
            return f.read().strip() or None
    except OSError:
        return None


def _ki_quota_ok():
    today = time.strftime('%Y-%m-%d')
    if _ki_day[0] != today:
        _ki_day[0], _ki_day[1] = today, 0
    if _ki_day[1] >= KI_MAX_PER_DAY:
        return False
    _ki_day[1] += 1
    return True


def _ki_cleanup():
    cutoff = time.time() - KI_JOB_TTL
    for jid in [j for j, d in _ki_jobs.items() if d['ts'] < cutoff]:
        del _ki_jobs[jid]


def _ki_run(job, prompt, img_path):
    """Job-Thread: (Text→Bild→)3D ueber die HF-Spaces, Ergebnis = GLB-Pfad."""
    try:
        from gradio_client import Client, handle_file
        token = _ki_token()
        kw = {'hf_token': token} if token else {}
        job['phase'] = 'Warten auf freie GPU…'
        with _ki_gpu_lock:
            if prompt:
                job['phase'] = 'Referenzbild wird erzeugt…'
                flux = Client(KI_FLUX_SPACE, verbose=False, **kw)
                r = flux.predict(
                    prompt + ', single object, product photo, '
                    'plain white background',
                    0, True, 1024, 1024, 4, api_name='/infer')
                img_path = r[0]
            job['phase'] = '3D-Modell wird berechnet…'
            shape = Client(KI_SHAPE_SPACE, verbose=False, **kw)
            r = shape.predict(image=handle_file(img_path),
                              api_name='/shape_generation')
        out = r[0]['value'] if isinstance(r[0], dict) else r[0]
        if not (out and os.path.isfile(out)):
            raise RuntimeError('Space lieferte keine Modelldatei')
        job['file'] = out
        job['status'] = 'fertig'
    except Exception as e:
        msg = str(e).replace('\n', ' ')[:300]
        low = msg.lower()
        if 'quota' in low or 'exceeded' in low:
            m = re.search(r'try again in (\d+):(\d+):(\d+)', low)
            wait = ''
            if m:
                h, mi = int(m.group(1)), int(m.group(2))
                mins = h * 60 + mi + 1
                wait = f' In ca. {mins} min geht es weiter.' if mins > 1 else \
                       ' Gleich noch einmal versuchen.'
            msg = ('Das kostenlose GPU-Kontingent ist gerade aufgebraucht.'
                   + wait)
        job['error'] = msg
        job['status'] = 'fehler'
    finally:
        job['ts'] = time.time()


TMP_STL = '/tmp/volme3d-export.stl'
WASM_GZ = 'volme3d-occt.wasm.gz'
# Gehaertete Auslieferungs-Version (von build.js erzeugt). Liegt sie vor,
# wird sie statt der Arbeitskopie volme3d.html ausgeliefert.
DIST_HTML = 'volme3d.dist.html'
APP_PATHS = ('/volme3d.html',)
# Dev-Modus (--dev): liefert IMMER die rohe Arbeitskopie volme3d.html aus,
# nie die dist. Fuer lokale Vorschau der WIP-Aenderungen, ohne Testern
# (die ueber 8765/Funnel die dist sehen) etwas Halbfertiges zu schicken.
DEV_MODE = False

# Howto-Videos (videos/make.mjs). Eigener Zweig statt ALLOW-Eintraegen, weil
# pro Generator eine Datei dazukommt.
VIDEO_DIR = 'videos/out'
VIDEO_RE = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}\.(mp4|vtt|json)$')

# Erlaubte oeffentliche Pfade -> (Datei, Content-Type). Alles andere: 404.
ALLOW = {
    '/':                                  ('start.html', 'text/html; charset=utf-8'),
    '/volme3d.html':                      ('volme3d.html', 'text/html; charset=utf-8'),
    '/start.html':                        ('start.html', 'text/html; charset=utf-8'),
    '/volmedraw/volmedraw.html':          ('volmedraw/volmedraw.html', 'text/html; charset=utf-8'),
    '/volmedraw/lib/opentype.min.js':     ('volmedraw/lib/opentype.min.js', 'text/javascript; charset=utf-8'),
    '/volmedraw/lib/imagetracer.js':      ('volmedraw/lib/imagetracer.js', 'text/javascript; charset=utf-8'),
    '/volmedraw/lib/clipper.js':          ('volmedraw/lib/clipper.js', 'text/javascript; charset=utf-8'),
    '/volmedraw/lib/Poppins-Regular.ttf': ('volmedraw/lib/Poppins-Regular.ttf', 'font/ttf'),
    '/volmedraw/lib/GreatVibes-Regular.ttf': ('volmedraw/lib/GreatVibes-Regular.ttf', 'font/ttf'),
    '/volmeslice/volmeslice.html':        ('volmeslice/volmeslice.html', 'text/html; charset=utf-8'),
    '/abstimmung.html':                   ('abstimmung.html', 'text/html; charset=utf-8'),
    '/ansehen.html':                      ('ansehen.html', 'text/html; charset=utf-8'),
    '/mitsehen.html':                     ('mitsehen.html', 'text/html; charset=utf-8'),
    '/favicon.svg':                       ('favicon.svg', 'image/svg+xml'),
    '/logo.svg':                          ('logo.svg', 'image/svg+xml'),
    '/volme3d-occt.js':                   ('volme3d-occt.js', 'text/javascript; charset=utf-8'),
    '/lib/three.min.js':                  ('lib/three.min.js', 'text/javascript; charset=utf-8'),
    # Liest TTF/OTF, die Nutzer selbst laden ("Eigene Schrift") — wird erst bei Bedarf geholt
    '/lib/opentype.min.js':               ('lib/opentype.min.js', 'text/javascript; charset=utf-8'),
    '/lib/RoundedBoxGeometry.js':         ('lib/RoundedBoxGeometry.js', 'text/javascript; charset=utf-8'),
    '/lib/GLTFLoader.js':                 ('lib/GLTFLoader.js', 'text/javascript; charset=utf-8'),
    '/lib/SVGLoader.js':                  ('lib/SVGLoader.js', 'text/javascript; charset=utf-8'),
    '/lib/BufferGeometryUtils.js':        ('lib/BufferGeometryUtils.js', 'text/javascript; charset=utf-8'),
    '/lib/fflate.min.js':                 ('lib/fflate.min.js', 'text/javascript; charset=utf-8'),
    '/lib/SimplifyModifier.js':           ('lib/SimplifyModifier.js', 'text/javascript; charset=utf-8'),
    '/lib/qrcode.min.js':                 ('lib/qrcode.min.js', 'text/javascript; charset=utf-8'),
    '/lib/leaflet.js':                    ('lib/leaflet.js', 'text/javascript; charset=utf-8'),
    '/lib/manifold.js':                   ('lib/manifold.js', 'text/javascript; charset=utf-8'),
    '/lib/manifold.wasm':                 ('lib/manifold.wasm', 'application/wasm'),
    '/lib/leaflet.css':                   ('lib/leaflet.css', 'text/css; charset=utf-8'),
    '/lib/leaflet-marker-icon.png':       ('lib/leaflet-marker-icon.png', 'image/png'),
    '/lib/leaflet-marker-icon-2x.png':    ('lib/leaflet-marker-icon-2x.png', 'image/png'),
    '/lib/leaflet-marker-shadow.png':     ('lib/leaflet-marker-shadow.png', 'image/png'),
    '/Volme3D-Druck-Helfer.bat':          ('Volme3D-Druck-Helfer.bat', 'application/octet-stream'),
    '/volme3d-print-helper-LIESMICH.txt': ('volme3d-print-helper-LIESMICH.txt', 'text/plain; charset=utf-8'),
    '/V3D-Remote.exe':                    ('V3D-Remote.exe', 'application/octet-stream'),
    '/V3D-Remote.zip':                    ('V3D-Remote.zip', 'application/zip'),
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

    def _proxy_occt(self, method):
        """Reicht die Anfrage an das lokale OCCT-Backend (HTTPS:3001) durch."""
        path = self.path.split('?', 1)[0]
        backend_path = '/health' if path == '/occt-health' else self.path
        body = None
        if method == 'POST':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length) if length else b''
        try:
            conn = http.client.HTTPSConnection(
                OCCT_HOST, OCCT_PORT, timeout=OCCT_TIMEOUT, context=_OCCT_CTX)
            headers = {}
            ct = self.headers.get('Content-Type')
            if ct:
                headers['Content-Type'] = ct
            conn.request(method, backend_path, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
            self.send_response(resp.status)
            self._cors()
            self.send_header('Content-Type',
                             resp.getheader('Content-Type', 'application/json'))
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            conn.close()
        except Exception as e:
            msg = ('{"error":"OCCT-Backend nicht erreichbar: '
                   + str(e).replace('"', "'") + '"}').encode()
            self.send_response(502)
            self._cors()
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _ki_generate(self):
        """POST /ki/generate — {prompt} ODER {image: dataURL} -> {job}."""
        length = int(self.headers.get('Content-Length', 0))
        if length > 12 * 1024 * 1024:
            self._json(413, {'error': 'Bild zu gross (max. 12 MB)'})
            return
        try:
            body = json.loads(self.rfile.read(length) or b'{}')
        except ValueError:
            self._json(400, {'error': 'Ungueltige Anfrage'})
            return
        prompt = (body.get('prompt') or '').strip()[:500]
        img_data = body.get('image') or ''
        if not prompt and not img_data:
            self._json(400, {'error': 'Prompt oder Bild fehlt'})
            return
        if not _ki_quota_ok():
            self._json(429, {'error': 'Tageslimit erreicht — morgen geht es '
                                      'kostenlos weiter.'})
            return
        img_path = None
        if img_data:
            try:
                head, _, b64 = img_data.partition(',')
                ext = '.png' if 'png' in head else '.webp' \
                    if 'webp' in head else '.jpg'
                raw = base64.b64decode(b64 or img_data)
                fd, img_path = tempfile.mkstemp(prefix='ki-', suffix=ext)
                with os.fdopen(fd, 'wb') as f:
                    f.write(raw)
            except (ValueError, OSError):
                self._json(400, {'error': 'Bild nicht lesbar'})
                return
        _ki_cleanup()
        jid = uuid.uuid4().hex[:12]
        job = {'status': 'laeuft', 'phase': 'In Warteschlange…',
               'file': None, 'error': None, 'ts': time.time()}
        _ki_jobs[jid] = job
        threading.Thread(target=_ki_run, args=(job, prompt, img_path),
                         daemon=True).start()
        self._json(200, {'job': jid})

    def do_POST(self):
        if self.path.startswith('/api/occt'):
            self._proxy_occt('POST')
            return
        if self.path == '/ki/generate':
            self._ki_generate()
            return
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

    def _send_video(self, path):
        """Howto-Videos aus videos/out/ ausliefern.

        Eigener Zweig statt ALLOW-Eintraegen, weil pro Generator ein Video
        dazukommt. Der Dateiname wird streng geprueft (kein Pfad-Traversal).
        Range wird unterstuetzt, sonst kann man im Video nicht springen.
        """
        name = path[len('/videos/'):]
        if not VIDEO_RE.match(name):
            self.send_error(404)
            return
        fname = os.path.join(VIDEO_DIR, name)
        if not os.path.isfile(fname):
            self.send_error(404)
            return
        ctype = ('video/mp4' if name.endswith('.mp4')
                 else 'application/json; charset=utf-8' if name.endswith('.json')
                 else 'text/vtt; charset=utf-8')
        size = os.path.getsize(fname)
        start, end = 0, size - 1

        rng = self.headers.get('Range', '')
        partial = rng.startswith('bytes=')
        if partial:
            try:
                s, _, e = rng[6:].partition('-')
                start = int(s) if s else 0
                end = int(e) if e else size - 1
            except ValueError:
                partial = False
            if partial and (start >= size or start > end):
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.end_headers()
                return
        end = min(end, size - 1)
        length = end - start + 1

        self.send_response(206 if partial else 200)
        self._cors()
        self.send_header('Content-Type', ctype)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(length))
        if partial:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        with open(fname, 'rb') as f:
            f.seek(start)
            rest = length
            while rest > 0:
                chunk = f.read(min(262144, rest))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return  # Zuschauer hat weggeklickt
                rest -= len(chunk)

    def do_GET(self):
        path = self.path.split('?', 1)[0]

        if path == '/occt-health':
            self._proxy_occt('GET')
            return

        if path.startswith('/ki/status/'):
            job = _ki_jobs.get(path[len('/ki/status/'):])
            if not job:
                self._json(404, {'error': 'Unbekannter Job'})
            else:
                self._json(200, {'status': job['status'],
                                 'phase': job['phase'],
                                 'error': job['error']})
            return

        if path.startswith('/ki/result/'):
            job = _ki_jobs.get(path[len('/ki/result/'):])
            if not (job and job['status'] == 'fertig' and job['file']
                    and os.path.isfile(job['file'])):
                self.send_error(404, 'Kein Ergebnis')
                return
            self._send_file(job['file'], 'model/gltf-binary')
            return

        if path.startswith('/videos/'):
            self._send_video(path)
            return

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
