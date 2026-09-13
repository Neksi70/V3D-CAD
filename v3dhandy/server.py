#!/usr/bin/env python3
"""V3D Handy — Handy-Fernsteuerung fuer Claude (wie „Claude in Chrome", nur fuers Handy).

Zwei Seiten haengen an diesem Server:

* Das Handy (App „V3D Handy“) fragt per Long-Polling nach Befehlen
  (POST /api/geraet/warten, Geraete-Schluessel als Bearer) und liefert
  das Ergebnis des vorigen Befehls gleich mit („antwort").
* Claude spricht den MCP-Endpunkt an (POST /api/mcp/<mcpKey>, JSON-RPC
  wie bei V3D Mail). Jedes Werkzeug wird in die Warteschlange gelegt und
  wartet auf die Antwort des Handys.

Nur Python-Stdlib. Port als erstes Argument (Standard 8794), lauscht nur auf
127.0.0.1; nach aussen geht es ueber den Tailscale-Funnel (/agent).
"""
import base64
import hmac
import json
import os
import secrets
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HIER = os.path.dirname(os.path.abspath(__file__))
CFG_DATEI = os.path.join(HIER, 'config.json')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8794
FUNNEL = 'https://v3da.tailf05fe9.ts.net/handy'

WARTEN_MAX = 25          # Long-Poll-Dauer, unter dem 30-s-Ruhelimit mancher Mobilfunk-Proxys
ANTWORT_MAX = 45         # so lange wartet ein Werkzeug auf das Handy
OFFLINE_NACH = 70        # ohne Lebenszeichen gilt das Handy als getrennt
KOERPER_MAX = 12 * 1024 * 1024
MCP_VERSIONS = ('2025-06-18', '2025-03-26', '2024-11-05')


def cfg_laden():
    cfg = {}
    if os.path.exists(CFG_DATEI):
        with open(CFG_DATEI) as fh:
            cfg = json.load(fh)
    neu = False
    for k in ('geraeteKey', 'mcpKey'):
        if not cfg.get(k):
            cfg[k] = secrets.token_urlsafe(24)
            neu = True
    if neu:
        with open(CFG_DATEI, 'w') as fh:
            json.dump(cfg, fh, indent=1)
        os.chmod(CFG_DATEI, 0o600)
    return cfg


CFG = cfg_laden()


# ---------------------------------------------------------------- Warteschlange

class Geraet:
    """Zustand des (einen) Handys und die Befehls-Warteschlange."""

    def __init__(self):
        self.lock = threading.Condition()
        self.info = {}
        self.zuletzt = 0.0           # letztes Lebenszeichen
        self.offen = []              # noch nicht abgeholte Befehle
        self.unterwegs = {}          # id -> Befehl, beim Handy
        self.naechste_id = 1
        self.screenshot_faktor = 1.0  # Bild-Pixel * Faktor = Bildschirm-Pixel
        self.letzter_baum = ''
        self.zaehler = 0

    def verbunden(self):
        return time.time() - self.zuletzt < OFFLINE_NACH

    def seit(self):
        if not self.zuletzt:
            return 'noch nie'
        s = int(time.time() - self.zuletzt)
        if s < 60:
            return 'vor %d s' % s
        if s < 3600:
            return 'vor %d min' % (s // 60)
        return 'vor %.1f h' % (s / 3600)

    # -- Seite Handy --
    def lebenszeichen(self, info, antwort):
        with self.lock:
            self.zuletzt = time.time()
            if isinstance(info, dict):
                self.info = info
            if isinstance(antwort, dict) and antwort.get('id') in self.unterwegs:
                b = self.unterwegs.pop(antwort['id'])
                b['ergebnis'] = antwort
                b['fertig'].set()
            self.lock.notify_all()

    def abholen(self, timeout):
        ende = time.time() + timeout
        with self.lock:
            while not self.offen:
                rest = ende - time.time()
                if rest <= 0:
                    return None
                self.lock.wait(rest)
            b = self.offen.pop(0)
            b['abgeholt'] = time.time()
            self.unterwegs[b['id']] = b
            return {'id': b['id'], 'cmd': b['cmd'], 'args': b['args']}

    # -- Seite Claude --
    def ausfuehren(self, cmd, args, timeout=ANTWORT_MAX):
        if not self.verbunden():
            raise AgentFehler('Handy nicht verbunden (letztes Lebenszeichen %s). '
                              'App „V3D Handy“ auf dem Handy oeffnen und Verbindung einschalten.'
                              % self.seit())
        b = {'id': self.naechste_id, 'cmd': cmd, 'args': args or {},
             'fertig': threading.Event(), 'ergebnis': None}
        with self.lock:
            self.naechste_id += 1
            self.offen.append(b)
            self.zaehler += 1
            self.lock.notify_all()
        if not b['fertig'].wait(timeout):
            with self.lock:
                if b in self.offen:
                    self.offen.remove(b)
                self.unterwegs.pop(b['id'], None)
            raise AgentFehler('Keine Antwort vom Handy innerhalb von %d s (Befehl %s). '
                              'Ist der Bildschirm an und die Bedienungshilfe aktiv?' % (timeout, cmd))
        erg = b['ergebnis']
        if not erg.get('ok', False):
            raise AgentFehler(erg.get('fehler') or 'Handy meldet Fehler bei %s' % cmd)
        return erg


class AgentFehler(Exception):
    pass


GERAET = Geraet()


# ---------------------------------------------------------------- MCP-Werkzeuge

MCP_ANLEITUNG = (
    'V3D Handy steuert das Android-Handy von Volme3D ueber die Bedienungshilfe, '
    'so wie Claude in Chrome den Browser steuert. Ablauf: bildschirm_lesen (liefert '
    'Elemente mit Nummern) -> tippen/text_eingeben/wischen mit der Element-Nummer -> '
    'wieder bildschirm_lesen. screenshot nur, wenn der Elementbaum nicht reicht '
    '(Bilder, Spiele, Karten). Koordinaten sind Bildschirm-Pixel; wer aus einem '
    'Screenshot abliest, setzt aus_screenshot=true. Nach jedem Tippen kurz warten '
    'oder direkt neu lesen — der Baum ist erst nach dem Umbau der Oberflaeche aktuell. '
    'Nichts Unumkehrbares (Kaufen, Senden, Loeschen) ohne ausdruecklichen Auftrag.'
)

MCP_TOOLS = [
    {'name': 'status',
     'description': 'Ist das Handy verbunden? Modell, Bildschirmgroesse, Bedienungshilfe an/aus, letztes Lebenszeichen.',
     'inputSchema': {'type': 'object', 'properties': {}}},
    {'name': 'bildschirm_lesen',
     'description': 'Aktuellen Bildschirm als Elementbaum lesen: jede Zeile ein Element mit Nummer [n], '
                    'Typ, Text, Position (Mitte x,y) und Eigenschaften (klickbar, editierbar, scrollbar). '
                    'Die Nummern gelten fuer tippen/text_eingeben/wischen bis zum naechsten Lesen.',
     'inputSchema': {'type': 'object', 'properties': {
         'alles': {'type': 'boolean', 'description': 'Auch Elemente ohne Text/Funktion auflisten (Standard false).'}}}},
    {'name': 'screenshot',
     'description': 'Foto des Bildschirms (JPEG, verkleinert). Antwort nennt den Faktor; Koordinaten aus dem '
                    'Bild bei tippen/wischen mit aus_screenshot=true uebergeben.',
     'inputSchema': {'type': 'object', 'properties': {}}},
    {'name': 'tippen',
     'description': 'Antippen: entweder element (Nummer aus bildschirm_lesen) oder x/y. lang=true fuer langes Druecken.',
     'inputSchema': {'type': 'object', 'properties': {
         'element': {'type': 'integer'},
         'x': {'type': 'number'}, 'y': {'type': 'number'},
         'lang': {'type': 'boolean'},
         'aus_screenshot': {'type': 'boolean', 'description': 'x/y stammen aus dem letzten Screenshot.'}}}},
    {'name': 'text_eingeben',
     'description': 'Text in ein Eingabefeld schreiben. Ohne element: in das Feld mit dem Fokus. '
                    'ersetzen=false haengt an, enter=true schickt danach Enter.',
     'inputSchema': {'type': 'object', 'properties': {
         'text': {'type': 'string'},
         'element': {'type': 'integer'},
         'ersetzen': {'type': 'boolean'},
         'enter': {'type': 'boolean'}}, 'required': ['text']}},
    {'name': 'wischen',
     'description': 'Wischen/Scrollen. richtung hoch/runter/links/rechts (Inhalt bewegt sich in diese Richtung; '
                    '„hoch" = weiter nach unten lesen), wahlweise innerhalb von element, oder frei mit x1,y1,x2,y2.',
     'inputSchema': {'type': 'object', 'properties': {
         'richtung': {'type': 'string', 'enum': ['hoch', 'runter', 'links', 'rechts']},
         'element': {'type': 'integer'},
         'x1': {'type': 'number'}, 'y1': {'type': 'number'},
         'x2': {'type': 'number'}, 'y2': {'type': 'number'},
         'dauer_ms': {'type': 'integer'},
         'aus_screenshot': {'type': 'boolean'}}}},
    {'name': 'taste',
     'description': 'Systemtaste: zurueck, home, uebersicht, benachrichtigungen, schnelleinstellungen, enter, sperren, wecken.',
     'inputSchema': {'type': 'object', 'properties': {
         'name': {'type': 'string', 'enum': ['zurueck', 'home', 'uebersicht', 'benachrichtigungen',
                                             'schnelleinstellungen', 'enter', 'sperren', 'wecken']}},
                     'required': ['name']}},
    {'name': 'app_oeffnen',
     'description': 'App starten, per Paketname (com.android.chrome) oder Anzeigename (Chrome, WhatsApp).',
     'inputSchema': {'type': 'object', 'properties': {'app': {'type': 'string'}}, 'required': ['app']}},
    {'name': 'apps_auflisten',
     'description': 'Installierte Apps mit Paketnamen, wahlweise gefiltert.',
     'inputSchema': {'type': 'object', 'properties': {'suche': {'type': 'string'}}}},
    {'name': 'warten',
     'description': 'Kurz warten (bis 10 s), z. B. bis eine Seite geladen ist; liefert danach den Elementbaum.',
     'inputSchema': {'type': 'object', 'properties': {'sekunden': {'type': 'number'}}}},
]

HANDY_BEFEHLE = {'bildschirm_lesen', 'screenshot', 'tippen', 'text_eingeben', 'wischen',
                 'taste', 'app_oeffnen', 'apps_auflisten'}


def text_out(s):
    return [{'type': 'text', 'text': s}]


def _koord(args, *namen):
    """Koordinaten ggf. vom Screenshot-Massstab auf Bildschirm-Pixel bringen."""
    f = GERAET.screenshot_faktor if args.get('aus_screenshot') else 1.0
    out = dict(args)
    for n in namen:
        if n in args and args[n] is not None:
            out[n] = int(round(float(args[n]) * f))
    out.pop('aus_screenshot', None)
    return out


def mcp_call(name, args):
    if name == 'status':
        i = GERAET.info
        return text_out(
            'Verbunden: %s (letztes Lebenszeichen %s)\nModell: %s, Android %s\nBildschirm: %s x %s px\n'
            'Bedienungshilfe aktiv: %s\nBefehle bisher: %d'
            % ('ja' if GERAET.verbunden() else 'nein', GERAET.seit(), i.get('modell', '?'),
               i.get('android', '?'), i.get('breite', '?'), i.get('hoehe', '?'),
               'ja' if i.get('bedienhilfe') else 'NEIN — in den Android-Einstellungen unter Bedienungshilfen einschalten',
               GERAET.zaehler))
    if name == 'warten':
        s = max(0.0, min(10.0, float(args.get('sekunden') or 2)))
        time.sleep(s)
        erg = GERAET.ausfuehren('bildschirm_lesen', {})
        return text_out(erg.get('baum') or '(leerer Bildschirm)')
    if name in ('tippen', 'wischen'):
        args = _koord(args, 'x', 'y', 'x1', 'y1', 'x2', 'y2')
    erg = GERAET.ausfuehren(name, args)
    if name == 'screenshot':
        b = erg.get('bild') or ''
        if not b:
            raise AgentFehler('Handy hat kein Bild geliefert (Bildschirm aus oder gesperrt?)')
        GERAET.screenshot_faktor = float(erg.get('faktor') or 1.0)
        return [{'type': 'image', 'data': b, 'mimeType': erg.get('mime') or 'image/jpeg'},
                {'type': 'text', 'text': 'Bild %sx%s px, Bildschirm %sx%s px, Faktor %.3f '
                                         '(Bildschirm = Bild x Faktor; oder aus_screenshot=true).'
                                         % (erg.get('bild_breite'), erg.get('bild_hoehe'),
                                            erg.get('breite'), erg.get('hoehe'), GERAET.screenshot_faktor)}]
    if name == 'bildschirm_lesen':
        GERAET.letzter_baum = erg.get('baum') or ''
        return text_out(GERAET.letzter_baum or '(leerer Bildschirm — Bildschirm aus?)')
    if name == 'apps_auflisten':
        return text_out(erg.get('text') or '(keine Apps)')
    return text_out(erg.get('text') or 'ok')


def _rpc_err(rid, code, msg):
    return {'jsonrpc': '2.0', 'id': rid, 'error': {'code': code, 'message': msg}}


def mcp_rpc(req):
    if not isinstance(req, dict):
        return _rpc_err(None, -32600, 'Ungueltige Anfrage')
    rid = req.get('id')
    method = req.get('method') or ''
    params = req.get('params') or {}
    if 'id' not in req or method.startswith('notifications/'):
        return None
    if method == 'initialize':
        gew = str(params.get('protocolVersion') or '')
        return {'jsonrpc': '2.0', 'id': rid, 'result': {
            'protocolVersion': gew if gew in MCP_VERSIONS else MCP_VERSIONS[0],
            'capabilities': {'tools': {'listChanged': False}},
            'serverInfo': {'name': 'V3D Handy', 'version': '1.0'},
            'instructions': MCP_ANLEITUNG}}
    if method == 'ping':
        return {'jsonrpc': '2.0', 'id': rid, 'result': {}}
    if method == 'tools/list':
        return {'jsonrpc': '2.0', 'id': rid, 'result': {'tools': MCP_TOOLS}}
    if method == 'tools/call':
        name = params.get('name') or ''
        if not any(t['name'] == name for t in MCP_TOOLS):
            return _rpc_err(rid, -32602, 'Unbekanntes Werkzeug: %s' % name)
        try:
            content = mcp_call(name, params.get('arguments') or {})
            out = {'content': content}
        except AgentFehler as e:
            out = {'content': text_out('Fehler: %s' % e), 'isError': True}
        except Exception as e:
            sys.stderr.write('MCP-Fehler bei %s: %r\n' % (name, e))
            out = {'content': text_out('Interner Fehler: %s' % e), 'isError': True}
        return {'jsonrpc': '2.0', 'id': rid, 'result': out}
    return _rpc_err(rid, -32601, 'Methode nicht unterstuetzt: %s' % method)


# ---------------------------------------------------------------- HTTP

SEITE = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>V3D Handy</title>
<style>body{font-family:system-ui,sans-serif;background:#0B1020;color:#e5e7eb;margin:0;padding:24px;max-width:640px}
h1{font-size:1.4em}.ok{color:#4ade80}.nein{color:#f87171}code{background:#151B2E;padding:2px 6px;border-radius:4px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px}</style>
<h1>V3D Handy</h1>
<p>Fernsteuerung des Handys f&uuml;r Claude &uuml;ber die Bedienungshilfe.</p>
<dl><dt>Handy</dt><dd class="%(kl)s">%(verb)s</dd>
<dt>Ger&auml;t</dt><dd>%(modell)s</dd>
<dt>Bedienungshilfe</dt><dd>%(bh)s</dd>
<dt>Befehle</dt><dd>%(n)d</dd></dl>
<p>Die Schl&uuml;ssel stehen auf dem Server in <code>~/v3dhandy/config.json</code>
(Ger&auml;te-Schl&uuml;ssel in die App, MCP-Schl&uuml;ssel in Claude).</p>
"""


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'V3DHandy/1.0'

    def _send(self, code, body, ctype='application/json', extra=()):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        elif isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype + ('; charset=utf-8' if ctype.startswith('text/') else ''))
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > KOERPER_MAX:
            raise ValueError('zu gross')
        roh = self.rfile.read(n) if n else b''
        if not roh:
            return {}
        return json.loads(roh.decode('utf-8'))

    def _route(self):
        p = self.path.split('?', 1)[0]
        if p.startswith('/agent/') or p == '/handy':
            p = p[len('/handy'):] or '/'
        return p

    def _bearer(self):
        a = self.headers.get('Authorization') or ''
        return a[7:].strip() if a.lower().startswith('bearer ') else ''

    def _schluessel_ok(self, ist, soll):
        return bool(ist) and bool(soll) and hmac.compare_digest(ist, soll)

    def log_message(self, fmt, *args):
        if os.environ.get('V3DAGENT_LOG'):
            sys.stderr.write('%s %s\n' % (self.log_date_time_string(), fmt % args))

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        p = self._route()
        if p == '/':
            i = GERAET.info
            return self._send(200, SEITE % {
                'kl': 'ok' if GERAET.verbunden() else 'nein',
                'verb': ('verbunden' if GERAET.verbunden() else 'nicht verbunden') + ' (Lebenszeichen %s)' % GERAET.seit(),
                'modell': '%s, Android %s, %sx%s px' % (i.get('modell', '?'), i.get('android', '?'),
                                                        i.get('breite', '?'), i.get('hoehe', '?')),
                'bh': 'aktiv' if i.get('bedienhilfe') else 'aus',
                'n': GERAET.zaehler}, 'text/html')
        if p == '/api/status':
            return self._send(200, {'verbunden': GERAET.verbunden(), 'seit': GERAET.seit(),
                                    'info': GERAET.info, 'befehle': GERAET.zaehler})
        if p == '/apk':
            for name in sorted(os.listdir(HIER), reverse=True):
                if name.endswith('.apk'):
                    with open(os.path.join(HIER, name), 'rb') as fh:
                        daten = fh.read()
                    return self._send(200, daten, 'application/vnd.android.package-archive',
                                      [('Content-Disposition', 'attachment; filename="%s"' % name)])
            return self._send(404, {'error': 'keine APK gebaut'})
        return self._send(404, {'error': 'unbekannt'})

    def do_DELETE(self):
        p = self._route()
        if p.startswith('/api/mcp'):
            return self._send(200, {'ok': True})
        return self._send(404, {'error': 'unbekannt'})

    def do_POST(self):
        p = self._route()
        try:
            if p.startswith('/api/mcp'):
                return self._mcp(p)
            if p == '/api/geraet/warten':
                return self._warten()
        except ValueError as e:
            return self._send(400, {'error': 'Ungueltige Anfrage: %s' % e})
        return self._send(404, {'error': 'unbekannt'})

    def _warten(self):
        if not self._schluessel_ok(self._bearer(), CFG['geraeteKey']):
            time.sleep(0.5)
            return self._send(401, {'error': 'Geraete-Schluessel fehlt oder falsch'})
        body = self._body()
        GERAET.lebenszeichen(body.get('geraet'), body.get('antwort'))
        warte = min(WARTEN_MAX, max(0, int(body.get('warten', WARTEN_MAX))))
        b = GERAET.abholen(warte)
        if b is None:
            return self._send(200, {'leer': True})
        return self._send(200, b)

    def _mcp(self, p):
        key = p[len('/api/mcp'):].strip('/').split('/')[0] or self._bearer()
        if not self._schluessel_ok(key, CFG['mcpKey']):
            time.sleep(0.5)
            return self._send(401, {'error': 'MCP-Schluessel fehlt oder falsch'},
                              extra=[('WWW-Authenticate', 'Bearer')])
        body = self._body()
        if isinstance(body, list):
            antworten = [a for a in (mcp_rpc(r) for r in body) if a is not None]
            return self._send(200, antworten) if antworten else self._send(202, b'')
        antwort = mcp_rpc(body)
        if antwort is None:
            return self._send(202, b'')
        return self._send(200, antwort)


def main():
    print('V3D Handy laeuft auf http://127.0.0.1:%d/ — MCP: %s/api/mcp/<mcpKey aus config.json>'
          % (PORT, FUNNEL), flush=True)
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    srv.daemon_threads = True
    srv.serve_forever()


if __name__ == '__main__':
    main()
