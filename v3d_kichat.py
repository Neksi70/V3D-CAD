"""KI-Chat in V3D CAD: „Sag Claude, was er bauen soll“ (vorerst nur Admins).

Der Tab schickt den Gesprächsverlauf an POST /ki-chat/turn. Der Server ergänzt
Modell, Systemtext (Anleitung) und Werkzeuge, hängt den API-Schlüssel an und
reicht die Antwort von Anthropic als Datenstrom (SSE) unverändert durch.
Claudes Werkzeugaufrufe führt der Tab selbst über v3dApi aus und schickt die
Ergebnisse mit dem nächsten Zug — der Server baut nichts.

Schlüssel: Umgebung ANTHROPIC_API_KEY oder Datei ~/.config/volme3d/anthropic_key
(eine Zeile, chmod 600). Kostenbremse: Tageslimit je Konto in US-Dollar,
Standard 5, änderbar in ~/.config/volme3d/kichat.json {"tageslimit_usd": 5}.
Verbrauch: ~/.config/volme3d/kichat-verbrauch.json (Tag → Konto → Dollar).
"""
import os
import json
import time
import threading
import http.client
import urllib.parse

CONF_DIR = os.environ.get('V3D_KICHAT_DIR') or os.path.expanduser('~/.config/volme3d')
KEY_FILE = os.path.join(CONF_DIR, 'anthropic_key')
CONF_FILE = os.path.join(CONF_DIR, 'kichat.json')
VERBRAUCH_FILE = os.path.join(CONF_DIR, 'kichat-verbrauch.json')
ANLEITUNG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              'v3d-cad-mcp', 'ANLEITUNG.md')

MODELL = 'claude-opus-5-5'
# Dollar je Million Token (Opus 5.5): Eingabe, Ausgabe, Cache schreiben, Cache lesen
PREIS = {'in': 4.0, 'out': 20.0, 'cache_w': 5.0, 'cache_r': 0.20}
# Nur für Tests umstellbar (nachgebauter Claude-Server, siehe tests/kichat_test.mjs)
API = urllib.parse.urlparse(os.environ.get('V3D_KICHAT_API', 'https://api.anthropic.com'))
MAX_BODY = 12 * 1024 * 1024       # Verlauf samt Bildschirmfotos
_lock = threading.Lock()


def schluessel():
    k = os.environ.get('ANTHROPIC_API_KEY', '').strip()
    if k:
        return k
    try:
        with open(KEY_FILE, encoding='utf-8') as f:
            return f.read().strip()
    except OSError:
        return ''


def tageslimit():
    try:
        with open(CONF_FILE, encoding='utf-8') as f:
            return float(json.load(f).get('tageslimit_usd', 5))
    except (OSError, ValueError, TypeError):
        return 5.0


def _heute():
    return time.strftime('%Y-%m-%d')


def _lesen():
    try:
        with open(VERBRAUCH_FILE, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def verbrauch(konto):
    with _lock:
        return float(_lesen().get(_heute(), {}).get(konto, 0.0))


def buchen(konto, usd):
    with _lock:
        d = _lesen()
        tag = d.setdefault(_heute(), {})
        tag[konto] = round(tag.get(konto, 0.0) + usd, 6)
        # nur die letzten 60 Tage behalten
        for alt in sorted(d)[:-60]:
            d.pop(alt, None)
        os.makedirs(CONF_DIR, exist_ok=True)
        tmp = VERBRAUCH_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(d, f, indent=1)
        os.replace(tmp, VERBRAUCH_FILE)
        return tag[konto]


def kosten(u):
    return (u.get('input_tokens', 0) * PREIS['in'] +
            u.get('output_tokens', 0) * PREIS['out'] +
            u.get('cache_creation_input_tokens', 0) * PREIS['cache_w'] +
            u.get('cache_read_input_tokens', 0) * PREIS['cache_r']) / 1e6


def status(konto):
    return {'bereit': bool(schluessel()), 'modell': MODELL,
            'verbrauch_usd': round(verbrauch(konto), 4),
            'tageslimit_usd': tageslimit()}


SYSTEM = """Du bist Claude und arbeitest direkt in V3D CAD, einem Browser-CAD der Volme 3D Akademie. \
Der Nutzer sitzt vor dem Tab und sieht jeden deiner Schritte sofort in seiner Szene. Antworte auf Deutsch, kurz und freundlich.

So steuerst du V3D CAD:
- Maße in mm, Z zeigt nach oben, die Bauplatte liegt bei Z=0. "center" ist die Mitte der Bounding-Box.
- Körper haben eine numerische id. Bool-Operationen (bool.union/subtract/intersect) erzeugen einen NEUEN Körper mit NEUER id – die id aus "created" weiterverwenden.
- Erst planen (Maße, Positionen, erwartetes Volumen), dann mit batch in wenigen Schritten bauen, danach mit measure prüfen. "ok" allein heißt nicht, dass ein Schnitt getroffen hat.
- Ein execute oder ein ganzer batch ist EIN Undo-Schritt; bei Fehler bleibt die Szene unverändert.
- list_commands zeigt alle Befehle mit Parametern; shape.types die Grundformen.
- Kanten runden/fasen (body.fillet/body.chamfer) VOR Bool-Operationen und VOR dem Drehen.
- Parametrisch: erst param.set für änderbare Maße, dann Formeln in den Befehlen.
- Fertige Normteile/Generatoren (Schraube, Mutter, Zahnrad, Gehäuse, Vase …): starter.list → starter.inspect → starter.run; Kinder-/Spielmodelle über gen.list/gen.run.
- Die Szene gehört dem Nutzer: nichts ungefragt löschen oder leeren (scene.new). Bestehende Körper erst mit inspect_scene ansehen.
- Zum Schluss ein kleiner screenshot (z. B. 480×320) zur Sichtkontrolle und eine knappe Zusammenfassung, was du gebaut hast.
- Ist ein Wunsch unklar (Maße fehlen), triff eine sinnvolle Annahme, nenne sie und baue – frag nur nach, wenn es ohne Antwort nicht geht.

Anleitung (Vorgehen, Ebenen, Rezepte, Grenzen):
"""


def _obj(props, required=()):
    return {'type': 'object', 'properties': props, 'required': list(required),
            'additionalProperties': False}


TOOLS = [
    {'name': 'list_commands', 'description': 'Alle V3D-CAD-Befehle mit Parametern (für execute/batch).',
     'input_schema': _obj({'filter': {'type': 'string', 'description': 'Teilstring in Befehl oder Beschreibung'}})},
    {'name': 'execute', 'description': 'Einen Befehl ausführen (z. B. shape.add, body.transform, bool.subtract). Ein Undo-Schritt; bei Fehler unverändert.',
     'input_schema': _obj({'command': {'type': 'string'}, 'params': {'type': 'object'},
                           'verbose': {'type': 'boolean', 'description': 'false = kompakte Antwort'}}, ['command'])},
    {'name': 'batch', 'description': 'Mehrere Befehle der Reihe nach, Stopp beim ersten Fehler; standardmäßig alles oder nichts. Zusammen EIN Undo-Schritt.',
     'input_schema': _obj({'commands': {'type': 'array', 'items': {
         'type': 'object', 'properties': {'command': {'type': 'string'}, 'params': {'type': 'object'}}, 'required': ['command']}},
         'rollback': {'type': 'boolean', 'description': 'bei Fehler alles zurück (Standard true)'},
         'verbose': {'type': 'boolean', 'description': 'false = kompakte Antworten'}}, ['commands'])},
    {'name': 'inspect_scene', 'description': 'Alle Körper: id, Name, Typ, Bohrung?, Mitte/Größe/BBox (mm), Drehung (°); optional mit Volumen/Fläche.',
     'input_schema': _obj({'measure': {'type': 'boolean'}})},
    {'name': 'measure', 'description': 'Volumen (mm³), Oberfläche (mm²), BBox je Körper und gesamt. Mit a+b: kleinster Abstand zweier Körper.',
     'input_schema': _obj({'id': {'type': 'integer'}, 'a': {'type': 'integer'}, 'b': {'type': 'integer'}})},
    {'name': 'screenshot', 'description': 'Bild der Szene aus einer Standardansicht, optional als Schnittansicht. Klein halten (480×320).',
     'input_schema': _obj({'view': {'type': 'string', 'enum': ['iso', 'front', 'back', 'top', 'bottom', 'left', 'right']},
                           'section': {'type': 'object', 'description': '{axis: X|Y|Z, at: mm, keep?: "-"|"+"}'},
                           'width': {'type': 'integer'}, 'height': {'type': 'integer'},
                           'ids': {'type': 'array', 'items': {'type': 'integer'}, 'description': 'nur diese Körper zeigen'}})},
    {'name': 'export', 'description': 'STL, 3MF oder STEP als Download beim Nutzer. Nur auf Wunsch des Nutzers.',
     'input_schema': _obj({'format': {'type': 'string', 'enum': ['stl', '3mf', 'step']},
                           'name': {'type': 'string', 'description': 'Dateiname ohne Endung'},
                           'ids': {'type': 'array', 'items': {'type': 'integer'}}})},
    {'name': 'undo', 'description': 'Einen Schritt zurück.', 'input_schema': _obj({})},
    {'name': 'redo', 'description': 'Einen Schritt vor.', 'input_schema': _obj({})},
]
TOOL_NAMES = {t['name'] for t in TOOLS}


def _system():
    try:
        with open(ANLEITUNG_FILE, encoding='utf-8') as f:
            anl = f.read()
    except OSError:
        anl = '(Anleitung nicht gefunden)'
    return [{'type': 'text', 'text': SYSTEM + anl}]


def _messages_ok(msgs):
    """Nur die Form prüfen, die der Tab schickt: abwechselnd user/assistant."""
    if not isinstance(msgs, list) or not msgs or len(msgs) > 400:
        return False
    for i, m in enumerate(msgs):
        if not isinstance(m, dict) or m.get('role') not in ('user', 'assistant'):
            return False
        if m['role'] != ('user' if i % 2 == 0 else 'assistant'):
            return False
    return msgs[-1]['role'] == 'user'


def turn(handler, sess):
    """POST /ki-chat/turn — ein Zug: Verlauf rein, Anthropic-SSE raus."""
    konto = (sess.get('e') or sess.get('u') or '?').lower()
    length = int(handler.headers.get('Content-Length', 0) or 0)
    if length <= 0 or length > MAX_BODY:
        handler._json(413, {'error': 'Verlauf zu groß – bitte „Neu“ drücken.'})
        return
    try:
        body = json.loads(handler.rfile.read(length))
    except ValueError:
        handler._json(400, {'error': 'Ungültige Anfrage'})
        return
    msgs = body.get('messages')
    if not _messages_ok(msgs):
        handler._json(400, {'error': 'Ungültiger Verlauf'})
        return
    key = schluessel()
    if not key:
        handler._json(503, {'error': 'Kein API-Schlüssel hinterlegt (~/.config/volme3d/anthropic_key).'})
        return
    schon, limit = verbrauch(konto), tageslimit()
    if schon >= limit:
        handler._json(429, {'error': f'Tageslimit erreicht ({schon:.2f} von {limit:.2f} $). Morgen geht es weiter.'})
        return
    effort = body.get('effort') if body.get('effort') in ('low', 'medium', 'high') else 'medium'
    req = {
        'model': MODELL, 'max_tokens': 32000, 'stream': True,
        'system': _system(), 'tools': TOOLS, 'messages': msgs,
        'thinking': {'type': 'adaptive'},
        'output_config': {'effort': effort},
        'cache_control': {'type': 'ephemeral'},
        'fallbacks': 'default',
    }
    data = json.dumps(req).encode()
    try:
        cls = http.client.HTTPSConnection if API.scheme == 'https' else http.client.HTTPConnection
        conn = cls(API.hostname, API.port or (443 if API.scheme == 'https' else 80), timeout=600)
        conn.request('POST', '/v1/messages', body=data, headers={
            'content-type': 'application/json', 'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'server-side-fallback-2026-07-01'})
        resp = conn.getresponse()
    except Exception as e:
        handler._json(502, {'error': 'Claude nicht erreichbar: ' + str(e)[:200]})
        return
    if resp.status != 200:
        raw = resp.read()[:4000]
        try:
            msg = json.loads(raw).get('error', {}).get('message', '')
        except ValueError:
            msg = raw.decode('utf-8', 'replace')
        conn.close()
        handler._json(502 if resp.status >= 500 else 400,
                      {'error': f'Claude meldet {resp.status}: {msg[:300]}'})
        return

    handler.send_response(200)
    handler.send_header('Content-Type', 'text/event-stream; charset=utf-8')
    handler.send_header('Cache-Control', 'no-cache')
    handler.send_header('X-Accel-Buffering', 'no')
    handler.end_headers()
    handler.close_connection = True
    usage = {}
    try:
        while True:
            line = resp.readline()
            if not line:
                break
            handler.wfile.write(line)
            if line == b'\n':
                handler.wfile.flush()
            elif line.startswith(b'data: '):
                try:
                    ev = json.loads(line[6:])
                except ValueError:
                    continue
                t = ev.get('type')
                if t == 'message_start':
                    usage.update((ev.get('message') or {}).get('usage') or {})
                elif t == 'message_delta' and ev.get('usage'):
                    u = ev['usage']
                    usage.update({k: v for k, v in u.items() if isinstance(v, (int, float))})
                    # Nach einem Fallback zählt jeder Versuch einzeln (usage.iterations)
                    if isinstance(u.get('iterations'), list) and u['iterations']:
                        usage['_iter'] = u['iterations']
    except (BrokenPipeError, ConnectionResetError):
        pass   # Tab hat abgebrochen (Stopp) — Verbrauch trotzdem buchen
    finally:
        conn.close()
        usd = (sum(kosten(i) for i in usage['_iter'] if isinstance(i, dict))
               if usage.get('_iter') else kosten(usage))
        gesamt = buchen(konto, usd)
        try:
            extra = json.dumps({'type': 'v3d_kosten', 'usd': round(usd, 4),
                                'heute_usd': round(gesamt, 4), 'limit_usd': tageslimit()})
            handler.wfile.write(b'event: v3d_kosten\ndata: ' + extra.encode() + b'\n\n')
            handler.wfile.flush()
        except OSError:
            pass
