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
import select
import socket
import base64
import tempfile
import threading
import http.client
import urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# Serverseitige Anmeldung: Firebase-ID-Token pruefen, eigenes Sitzungs-
# Cookie ausstellen. Ohne das war das Login-Fenster reine Kosmetik.
import v3d_auth
# Nutzungsmessung pro Konto (Beta): Grundlage fuer die spaeteren Tarife.
import v3d_nutzung

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
KI_MAX_PER_DAY = 100     # eigene Bremse VOR dem ZeroGPU-Tageslimit (HF PRO seit 2026-08: ~25 min GPU/Tag)
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


def _ki_user_quota_ok(uid):
    """Zweite Bremse neben dem Tageslimit: einer allein soll das freie
    GPU-Kontingent nicht fuer alle anderen leerlaufen."""
    today = time.strftime('%Y-%m-%d')
    with _ki_user_lock:
        rec = _ki_user_day.get(uid)
        if not rec or rec[0] != today:
            rec = [today, 0]
            _ki_user_day[uid] = rec
        if rec[1] >= KI_MAX_PER_USER:
            return False
        rec[1] += 1
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
        # gradio_client >=1.x nennt den Parameter 'token', aeltere 'hf_token'
        if token:
            import inspect
            pname = 'token' if 'token' in inspect.signature(Client.__init__).parameters else 'hf_token'
            kw = {pname: token}
        else:
            kw = {}
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
# Export-Ablage fuer Safari: Der Browser laedt blob:-Adressen je nach Kontext nicht
# herunter, sondern navigiert hin und zeigt "Safari kann die Seite nicht oeffnen"
# (Josy, Mac, 14.9.2026). Deshalb legt der Client die Datei kurz hier ab und laedt
# sie ueber eine echte URL mit Content-Disposition: attachment. Token = Dateiname,
# Aufraeumen nach EXPORT_TTL Sekunden. Nur mit Sitzung.
EXPORT_DIR = '/tmp/v3d-exports'
EXPORT_TTL = 900
EXPORT_MAX = 300 * 1024 * 1024
EXPORT_TOKEN_RE = re.compile(r'^[0-9a-f]{32}$')
EXPORT_TYPES = {'stl': 'model/stl', '3mf': 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
                'obj': 'text/plain; charset=utf-8', 'svg': 'image/svg+xml', 'json': 'application/json',
                'v3d': 'application/octet-stream', 'html': 'text/html; charset=utf-8', 'zip': 'application/zip'}


def _export_cleanup():
    try:
        now = time.time()
        for fn in os.listdir(EXPORT_DIR):
            fp = os.path.join(EXPORT_DIR, fn)
            if now - os.path.getmtime(fp) > EXPORT_TTL:
                os.unlink(fp)
    except OSError:
        pass
WASM_GZ = 'volme3d-occt.wasm.gz'
# Gehaertete Auslieferungs-Version (von build.js erzeugt). Liegt sie vor,
# wird sie statt der Arbeitskopie volme3d.html ausgeliefert.
DIST_HTML = 'volme3d.dist.html'


_VER_CACHE = {'key': None, 'ver': ''}


def _ausgelieferte_version():
    """VOLME3D_VERSION der Datei, die gerade ausgeliefert wird (nach mtime gecacht)."""
    fname = 'volme3d.html' if DEV_MODE or not os.path.isfile(DIST_HTML) else DIST_HTML
    try:
        st = os.stat(fname)
    except OSError:
        return ''
    key = (fname, st.st_mtime_ns, st.st_size)
    if _VER_CACHE['key'] != key:
        ver = ''
        try:
            with open(fname, 'rb') as f:
                m = re.search(rb'VOLME3D_VERSION\s*=\s*[\'"]([0-9.]+)[\'"]', f.read())
            ver = m.group(1).decode() if m else ''
        except OSError:
            pass
        _VER_CACHE.update(key=key, ver=ver)
    return _VER_CACHE['ver']
APP_PATHS = ('/volme3d.html',)
# Dev-Modus (--dev): liefert IMMER die rohe Arbeitskopie volme3d.html aus,
# nie die dist. Fuer lokale Vorschau der WIP-Aenderungen, ohne Testern
# (die ueber 8765/Funnel die dist sehen) etwas Halbfertiges zu schicken.
DEV_MODE = False

# Geschuetzte Pfade: nur der Editor. start.html (Werbeseite), ansehen.html
# (geteilte Modelle), abstimmung.html und mitsehen.html bleiben bewusst
# oeffentlich — die brauchen kein Konto.
GATED_PATHS = {'/volme3d.html'}

# Auf dem reinen CAD-Server (netcup) gibt es nur V3D CAD: Startseite und die
# Nebenwerkzeuge leiten direkt in den Editor. Die Bibliotheken unter
# /volmedraw/lib/ bleiben erreichbar, der Editor laedt dort opentype.js nach.
CAD_ONLY_HOSTS = {'v3dcad.volme3dakademie.de'}
CAD_ONLY_REDIRECT = {'/', '/start.html', '/volmedraw/volmedraw.html',
                     '/volmeslice/volmeslice.html'}
KI_MAX_PER_USER = 10     # KI-Generierungen pro Nutzer und Tag
_ki_user_day = {}        # uid -> [YYYY-MM-DD, Zaehler]
_ki_user_lock = threading.Lock()

# Howto-Videos (videos/make.mjs). Eigener Zweig statt ALLOW-Eintraegen, weil
# pro Generator eine Datei dazukommt.
VIDEO_DIR = 'videos/out'
VIDEO_RE = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}\.(mp4|vtt|json)$')

# Erlaubte oeffentliche Pfade -> (Datei, Content-Type). Alles andere: 404.
ALLOW = {
    '/':                                  ('start.html', 'text/html; charset=utf-8'),
    '/volme3d.html':                      ('volme3d.html', 'text/html; charset=utf-8'),
    '/start.html':                        ('start.html', 'text/html; charset=utf-8'),
    '/beta':                              ('beta.html', 'text/html; charset=utf-8'),
    '/beta.html':                         ('beta.html', 'text/html; charset=utf-8'),
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
    # Bestaetigt Android, dass Links auf /familie von der V3D-Familie-App
    # geoeffnet werden duerfen (App Links, sonst landet alles im Browser).
    '/.well-known/assetlinks.json':       ('assetlinks.json', 'application/json'),
    # Druckerliste fuer die Druck-Vorschau (aus den V3D-Slicer-Profilen, tools/bau_druckerliste.py)
    '/druckerliste.json':                 ('druckerliste.json', 'application/json; charset=utf-8'),
    # Hilfe-Inhalte (Seite „📖 Hilfe" laedt sie erst beim Oeffnen) + fertiges PDF fuer Kurse
    '/hilfe-daten.js':                    ('hilfe-daten.js', 'text/javascript; charset=utf-8'),
    '/V3D-CAD-Hilfe.pdf':                 ('V3D-CAD-Hilfe.pdf', 'application/pdf'),
    '/favicon.svg':                       ('favicon.svg', 'image/svg+xml'),
    '/logo.svg':                          ('logo.svg', 'image/svg+xml'),
    '/volme3d-occt.js':                   ('volme3d-occt.js', 'text/javascript; charset=utf-8'),
    '/cam-kern.js':                       ('cam-kern.js', 'text/javascript; charset=utf-8'),
    '/lib/three.min.js':                  ('lib/three.min.js', 'text/javascript; charset=utf-8'),
    # Liest TTF/OTF, die Nutzer selbst laden ("Eigene Schrift") — wird erst bei Bedarf geholt
    '/lib/opentype.min.js':               ('lib/opentype.min.js', 'text/javascript; charset=utf-8'),
    '/lib/RoundedBoxGeometry.js':         ('lib/RoundedBoxGeometry.js', 'text/javascript; charset=utf-8'),
    '/lib/GLTFLoader.js':                 ('lib/GLTFLoader.js', 'text/javascript; charset=utf-8'),
    '/lib/SVGLoader.js':                  ('lib/SVGLoader.js', 'text/javascript; charset=utf-8'),
    '/lib/BufferGeometryUtils.js':        ('lib/BufferGeometryUtils.js', 'text/javascript; charset=utf-8'),
    '/lib/fflate.min.js':                 ('lib/fflate.min.js', 'text/javascript; charset=utf-8'),
    '/lib/three-mesh-bvh.min.js':         ('lib/three-mesh-bvh.min.js', 'text/javascript; charset=utf-8'),
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
    # Testfassung 1.4.9 (Installer + portabel). Nicht verlinkt, nur zum Pruefen
    # auf frischen Rechnern. Nach bestandenem Test wird daraus die regulaere Datei.
    '/V3D-Remote-test.msi':               ('V3D-Remote-149-signiert.msi', 'application/octet-stream'),
    '/V3D-Remote-test.exe':               ('V3D-Remote-149-signiert.exe', 'application/octet-stream'),
    # MeshCentral-Agent als eine Datei: signierte IExpress-Huelle (Herausgeber
    # Volker Isken), darin der fertig konfigurierte Agent. Direktes Signieren des
    # Agenten geht NICHT — signtool loescht die im Signaturblock eingebettete
    # Serveradresse. Neu bauen nur noch bei Server-/Gruppenwechsel.
    '/V3D-Fernwartung-Setup.exe':         ('V3D-Fernwartung-Setup.exe', 'application/octet-stream'),
}


def _nutzung_html(b, monate):
    """Auswertungsseite der Nutzungsmessung (schlicht, auch am Handy lesbar)."""
    from html import escape as e
    s = b['summe']
    def zahl(x):
        return f'{x:,}'.replace(',', '.') if isinstance(x, int) else \
            f'{x:,.1f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    wahl = ''.join(
        f'<option{" selected" if m == b["monat"] else ""}>{e(m)}</option>'
        for m in (monate or [b['monat']]))
    zeilen = ''.join(
        '<tr><td>' + (e(k['email']) if k['email'] else '<i>Gast</i>') +
        '</td><td>' + zahl(k['tage']) + '</td><td>' + zahl(k['starts']) +
        '</td><td>' + zahl(k['occt']) + '</td><td>' + zahl(k['occt_s']) +
        '</td><td>' + zahl(k['occt_fehler']) + '</td><td>' + zahl(k['ki']) +
        '</td><td>' + zahl(k['exporte']) + '</td><td>' +
        time.strftime('%d.%m. %H:%M', time.localtime(k['zuletzt'])) +
        '</td></tr>' for k in b['konten']) or \
        '<tr><td colspan="9">Noch keine Daten in diesem Monat.</td></tr>'
    ops = ''.join(
        f'<tr><td>{e(o["art"])}</td><td>{zahl(o["anzahl"])}</td>'
        f'<td>{zahl(o["sekunden"])}</td></tr>' for o in b['operationen']) or \
        '<tr><td colspan="3">—</td></tr>'
    kacheln = ''.join(
        f'<div class="k"><b>{zahl(w)}</b><span>{t}</span></div>' for w, t in (
            (s['konten'], 'Konten aktiv'), (s['gaeste'], 'Gäste'),
            (s['starts'], 'Editor-Starts'), (s['occt'], 'Server-Operationen'),
            (s['occt_s'], 'Rechenzeit (s)'), (s['ki'], 'KI-Aufträge'),
            (s['exporte'], 'Exporte')))
    return f"""<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>V3D CAD – Nutzung</title>
<style>
:root{{color-scheme:dark;--bg:#0f1115;--card:#171a21;--line:#2a2f3a;--mut:#9aa3b2;--acc:#F97316}}
body{{margin:0;background:var(--bg);color:#e6e8ec;font:14px/1.5 system-ui,sans-serif}}
main{{max-width:1100px;margin:0 auto;padding:20px 16px}}
h1{{font-size:20px;margin:0 0 4px}} h2{{font-size:15px;margin:24px 0 8px}}
p.m{{color:var(--mut);margin:0 0 16px}}
form{{margin:0 0 16px}} select{{background:var(--card);color:inherit;border:1px solid var(--line);border-radius:6px;padding:4px 8px}}
.ks{{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}}
.k{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}}
.k b{{display:block;font-size:20px;color:var(--acc)}} .k span{{color:var(--mut);font-size:12px}}
.t{{overflow-x:auto;border:1px solid var(--line);border-radius:10px}}
table{{border-collapse:collapse;width:100%;min-width:640px}}
th,td{{padding:6px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}}
th:first-child,td:first-child{{text-align:left}} th{{color:var(--mut);font-weight:600;background:var(--card)}}
</style></head><body><main>
<h1>V3D CAD – Nutzung</h1>
<p class="m">Beta-Messung pro Konto. Rechenzeit = Wartezeit der Server-Operationen (OCCT).
Exporte meldet der Browser selbst.</p>
<form><select name="monat" onchange="this.form.submit()">{wahl}</select></form>
<div class="ks">{kacheln}</div>
<h2>Konten</h2>
<div class="t"><table><tr><th>Konto</th><th>Tage aktiv</th><th>Starts</th>
<th>Server-Op.</th><th>Rechenzeit (s)</th><th>davon Fehler</th><th>KI</th>
<th>Exporte</th><th>zuletzt</th></tr>{zeilen}</table></div>
<h2>Server-Operationen nach Art</h2>
<div class="t"><table><tr><th>Operation</th><th>Anzahl</th><th>Rechenzeit (s)</th></tr>{ops}</table></div>
</main></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def _proxy_occt(self, method, sess=None):
        """Reicht die Anfrage an das lokale OCCT-Backend (HTTPS:3001) durch.

        Mit sess wird der Aufruf samt Rechenzeit fuer das Konto gezaehlt.
        """
        path = self.path.split('?', 1)[0]
        t0 = time.monotonic()
        gezaehlt = []
        def zaehlen(ok):
            # Ein Fehler beim Zurueckschreiben darf nicht doppelt zaehlen
            if sess and not gezaehlt:
                gezaehlt.append(1)
                v3d_nutzung.erfassen(
                    sess, 'occt', path.rsplit('/', 1)[-1],
                    (time.monotonic() - t0) * 1000, ok)
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
            antwort = self._occt_wait(conn)
            if antwort is None:
                # Browser hat aufgelegt (✕ Abbrechen): Verbindung zum Backend
                # schliessen — der Arbeiterpool raeumt den Auftrag dann ab,
                # statt minutenlang fuer niemanden weiterzurechnen.
                conn.close()
                self.close_connection = True
                zaehlen(False)
                return
            resp, data = antwort
            # Das Backend meldet manche Fehler mit 200 + {"error": ...}
            zaehlen(resp.status < 400 and b'"error"' not in data[:300])
            self.send_response(resp.status)
            self._cors()
            self.send_header('Content-Type',
                             resp.getheader('Content-Type', 'application/json'))
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            conn.close()
        except Exception as e:
            zaehlen(False)
            msg = ('{"error":"OCCT-Backend nicht erreichbar: '
                   + str(e).replace('"', "'") + '"}').encode()
            self.send_response(502)
            self._cors()
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

    def _occt_wait(self, conn):
        """Holt die Backend-Antwort und achtet dabei auf den Browser.
        Rueckgabe (resp, data) oder None, wenn der Browser aufgelegt hat.
        Gelesen wird in einem Nebenfaden: select() auf dem TLS-Socket taugt
        nicht, TLS 1.3 schickt nach dem Handshake Session-Tickets, und die
        sahen wie der Antwortbeginn aus."""
        box = {}
        def lesen():
            try:
                r = conn.getresponse()
                box['ok'] = (r, r.read())
            except Exception as e:
                box['err'] = e
        t = threading.Thread(target=lesen, daemon=True)
        t.start()
        while t.is_alive():
            t.join(0.5)
            if not t.is_alive():
                break
            r, _, _ = select.select([self.connection], [], [], 0)
            if not r:
                continue
            try:
                daten = self.connection.recv(1, socket.MSG_PEEK)
            except OSError:
                daten = b''
            if not daten:
                try:
                    conn.sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                t.join(5)
                return None
            t.join()   # Browser schickt schon Neues hinterher → normal warten
        if 'err' in box:
            raise box['err']
        return box['ok']

    def _json(self, code, obj, cookie=None):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        if cookie is not None:
            self.send_header('Set-Cookie', cookie)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ── Anmeldung ────────────────────────────────────────────────────

    def _cookies(self):
        out = {}
        for part in (self.headers.get('Cookie') or '').split(';'):
            k, _, v = part.strip().partition('=')
            if k:
                out[k] = v
        return out

    def _cookie_header(self, value, max_age):
        # Secure faellt im Dev-Modus weg, sonst nimmt der Browser das Cookie
        # ueber http://localhost:8766 nicht an.
        secure = '' if DEV_MODE else '; Secure'
        return (v3d_auth.COOKIE_NAME + '=' + value +
                '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + str(max_age) + secure)

    def _session(self):
        """Sitzung aus dem Cookie — oder None. Im Dev-Modus immer offen."""
        if DEV_MODE:
            return {'u': 'dev', 'e': 'dev@lokal', 'g': 0}
        return v3d_auth.read_cookie(self._cookies().get(v3d_auth.COOKIE_NAME))

    def _need_session(self, ki=False):
        """True = weitermachen. Sonst steht die Fehlerantwort schon."""
        sess = self._session()
        if not sess:
            self._json(401, {'error': 'Bitte anmelden.', 'login': '/login'})
            return False
        if ki and sess.get('g'):
            self._json(403, {'error': 'Die KI-Generierung steht nur '
                                      'angemeldeten Nutzern offen.'})
            return False
        return True

    def _auth_session(self):
        """POST /auth/session — Firebase-ID-Token gegen Sitzungs-Cookie."""
        length = int(self.headers.get('Content-Length', 0))
        if length > 16 * 1024:
            self._json(413, {'error': 'Anfrage zu gross'})
            return
        try:
            body = json.loads(self.rfile.read(length) or b'{}')
        except ValueError:
            self._json(400, {'error': 'Ungueltige Anfrage'})
            return
        claims = v3d_auth.verify_id_token((body.get('idToken') or '').strip())
        if not claims:
            self._json(401, {'error': 'Anmeldung nicht gueltig — bitte neu '
                                      'anmelden.'})
            return
        cookie = v3d_auth.make_cookie(claims['sub'], claims.get('email', ''))
        self._json(200, {'ok': True, 'email': claims.get('email', '')},
                   cookie=self._cookie_header(cookie, v3d_auth.SESSION_TTL))

    def _auth_logout(self):
        self._json(200, {'ok': True}, cookie=self._cookie_header('', 0))

    def _gate_app(self, path):
        """Editor nur fuer Angemeldete. True = ausliefern.

        Gaeste einer gemeinsamen Sitzung kommen ohne Konto rein — aber nur
        mit einer Sitzungs-ID, die es in Firestore wirklich gibt und die
        noch laeuft. Vorher genuegte ein beliebiger Text hinter ?sitzung=.
        """
        if self._session():
            return True
        query = self.path.split('?', 1)[1] if '?' in self.path else ''
        sid = (urllib.parse.parse_qs(query).get('sitzung') or [''])[0]
        if sid and v3d_auth.session_alive(sid):
            cookie = v3d_auth.make_cookie('gast:' + sid[:32], guest=True)
            self.send_response(302)
            self._cors()
            self.send_header('Set-Cookie',
                             self._cookie_header(cookie, v3d_auth.GUEST_TTL))
            self.send_header('Location', self.path)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return False
        ziel = '/login?weiter=' + urllib.parse.quote(self.path, safe='')
        if sid:
            ziel += '&grund=sitzung'
        self.send_response(302)
        self._cors()
        self.send_header('Location', ziel)
        self.send_header('Content-Length', '0')
        self.end_headers()
        return False

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
        uid = (self._session() or {}).get('u', '?')
        if not _ki_user_quota_ok(uid):
            self._json(429, {'error': f'Dein Tageslimit von {KI_MAX_PER_USER} '
                                      'Generierungen ist erreicht — morgen '
                                      'geht es kostenlos weiter.'})
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
        v3d_nutzung.erfassen(self._session(), 'ki',
                             'bild' if img_path else 'text')
        self._json(200, {'job': jid})

    def do_POST(self):
        if self.path == '/auth/session':
            self._auth_session()
            return
        if self.path == '/auth/logout':
            self._auth_logout()
            return
        if self.path.startswith('/api/occt'):
            if not self._need_session():
                return
            self._proxy_occt('POST', self._session())
            return
        if self.path == '/api/nutzung':
            if not self._need_session():
                return
            self._nutzung_melden()
            return
        if self.path == '/ki/generate':
            if not self._need_session(ki=True):
                return
            self._ki_generate()
            return
        if self.path == '/api/export-file':
            if not self._need_session():
                return
            self._export_store()
            return
        if self.path != '/volme3d-export.stl':
            self.send_error(404)
            return
        if not self._need_session():
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

    def _export_store(self):
        """POST /api/export-file: rohe Bytes + X-Filename -> {url}."""
        length = int(self.headers.get('Content-Length', 0) or 0)
        if length <= 0 or length > EXPORT_MAX:
            self._json(413, {'error': 'Datei fehlt oder ist zu gross'})
            return
        name = urllib.parse.unquote(self.headers.get('X-Filename', '') or '')
        name = os.path.basename(name).strip()[:120] or 'export.bin'
        os.makedirs(EXPORT_DIR, exist_ok=True)
        _export_cleanup()
        token = uuid.uuid4().hex
        data = self.rfile.read(length)
        with open(os.path.join(EXPORT_DIR, token + '.bin'), 'wb') as f:
            f.write(data)
        with open(os.path.join(EXPORT_DIR, token + '.name'), 'w', encoding='utf-8') as f:
            f.write(name)
        self._json(200, {'url': '/api/export-file/' + token})

    def _export_send(self, token):
        """GET /api/export-file/<token>: als Anhang ausliefern (Safari-Download)."""
        if not EXPORT_TOKEN_RE.match(token):
            self.send_error(404)
            return
        fp = os.path.join(EXPORT_DIR, token + '.bin')
        if not os.path.isfile(fp):
            self.send_error(404, 'Export abgelaufen')
            return
        try:
            with open(os.path.join(EXPORT_DIR, token + '.name'), encoding='utf-8') as f:
                name = f.read().strip() or 'export.bin'
        except OSError:
            name = 'export.bin'
        ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
        ctype = EXPORT_TYPES.get(ext, 'application/octet-stream')
        ascii_name = re.sub(r'[^A-Za-z0-9._-]', '_', name) or 'export.bin'
        disp = ('attachment; filename="%s"; filename*=UTF-8\'\'%s'
                % (ascii_name, urllib.parse.quote(name)))
        self._send_file(fp, ctype, disp)

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

    def _nutzung_melden(self):
        """POST /api/nutzung — {art, detail}: was nur der Browser sieht (Exporte)."""
        length = int(self.headers.get('Content-Length', 0) or 0)
        if length > 2048:
            self._json(413, {'error': 'Anfrage zu gross'})
            return
        try:
            body = json.loads(self.rfile.read(length) or b'{}')
        except ValueError:
            body = {}
        art = body.get('art')
        if art not in v3d_nutzung.CLIENT_ARTEN:
            self._json(400, {'error': 'Unbekannte Art'})
            return
        detail = re.sub(r'[^a-z0-9._-]', '', str(body.get('detail', '')).lower())
        v3d_nutzung.erfassen(self._session(), art, detail[:16])
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _nutzung_bericht(self, als_json):
        """GET /nutzung[.json]?monat=YYYY-MM — nur fuer Admins (Liste in
        ~/.config/volme3d/admins). Allen anderen: 404, die Seite gibt es nicht."""
        sess = self._session()
        if not sess:
            self.send_response(302)
            self.send_header('Location', '/login?weiter=' +
                             urllib.parse.quote(self.path, safe=''))
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if not v3d_nutzung.ist_admin(sess):
            self.send_error(404, 'Not found')
            return
        query = self.path.split('?', 1)[1] if '?' in self.path else ''
        monat = (urllib.parse.parse_qs(query).get('monat') or [''])[0]
        alle = v3d_nutzung.monate()
        if not re.fullmatch(r'\d{4}-\d{2}', monat):
            monat = alle[0] if alle else time.strftime('%Y-%m')
        b = v3d_nutzung.bericht(monat)
        if als_json:
            self._json(200, b)
            return
        data = _nutzung_html(b, alle).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split('?', 1)[0]

        host = (self.headers.get('Host') or '').split(':', 1)[0].lower()
        if host in CAD_ONLY_HOSTS and path in CAD_ONLY_REDIRECT:
            query = self.path[len(path):]
            self.send_response(302)
            self.send_header('Location', '/volme3d.html' + query)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return

        # V3D Kids: eigener Einstieg in dieselbe App (Kachelseite fuer Kinder)
        if path in ('/kids', '/kids/'):
            query = self.path[len(path):].lstrip('?')
            self.send_response(302)
            self.send_header('Location', '/volme3d.html?kids=1' + ('&' + query if query else ''))
            self.send_header('Content-Length', '0')
            self.end_headers()
            return

        if path in ('/login', '/login.html'):
            self._send_file('login.html', 'text/html; charset=utf-8')
            return

        if path == '/auth/me':
            sess = self._session()
            self._json(200, {'angemeldet': bool(sess),
                             'gast': bool(sess and sess.get('g')),
                             'email': (sess or {}).get('e', '')})
            return

        if path == '/occt-health':
            self._proxy_occt('GET')
            return

        if path == '/api/version':
            # Welche Version liefert der Server gerade aus? Die App fragt das, wenn
            # man zum Tab zurückkehrt — ein über Nacht offener Tab lief sonst mit dem
            # alten Stand weiter (Josy 4.10.: Fix vom Vorabend nie geladen).
            self._json(200, {'version': _ausgelieferte_version()})
            return

        if path in ('/nutzung', '/nutzung.json'):
            self._nutzung_bericht(path.endswith('.json'))
            return

        if path.startswith('/ki/status/') or path.startswith('/ki/result/'):
            if not self._need_session():
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

        if path.startswith('/api/export-file/'):
            if not self._need_session():
                return
            self._export_send(path[len('/api/export-file/'):])
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
            if path in GATED_PATHS and not self._gate_app(path):
                return
            if not DEV_MODE:
                v3d_nutzung.erfassen(self._session(), 'start')
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
    # Dev-Modus hat KEIN Login → nur auf localhost lauschen (sonst aus LAN/Tailnet
    # offen). Produktion bleibt wie gehabt (Funnel/nginx davor).
    host = '127.0.0.1' if DEV_MODE else ''
    ThreadingHTTPServer((host, port), Handler).serve_forever()
