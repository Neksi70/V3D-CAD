"""V3D-CAD-Connector: Streamable HTTP unter /mcp, OAuth 2.1 davor.

Für alle angemeldeten V3D-CAD-Nutzer mit eigenem Claude (claude.ai-Connector).
Gebaut wird ausschließlich im Browser-Tab des Nutzers: Er öffnet in V3D CAD
☰ Menü → 🤖 Claude live, nennt Claude den Code, und live_connect bindet sein
Konto an diesen Tab. Alle Befehle laufen über den Agent-Hub (127.0.0.1:8830,
/live/*), der bei jedem Aufruf prüft, dass der Tab zum selben Konto gehört.

Start: `v3d-cad-connector serve` (systemd-Dienst v3d-cad-connector.service).
"""
import asyncio
import functools
import json
import os
import sys
import time
import urllib.error
import urllib.request
import warnings
from typing import Annotated, Any, Literal

from pydantic import Field
from starlette.requests import Request
from starlette.responses import JSONResponse

from . import settings  # zuerst: lädt .env
from . import audit
from .netz import RateLimit
from .oauth import Provider, login

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.settings import AuthSettings, ClientRegistrationOptions, RevocationOptions
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import CallToolResult, ImageContent, TextContent, ToolAnnotations

ANLEITUNG_DATEI = os.path.join(os.path.dirname(settings.APP_DIR), 'v3d-cad-mcp', 'ANLEITUNG.md')

HINWEISE = (
    'V3D CAD (Browser-CAD von Volme 3D) per Befehl steuern — im eigenen Browser-Tab des Nutzers. '
    'ZUERST verbinden: Der Nutzer öffnet in V3D CAD (https://v3dcad.volme3dakademie.de) ☰ Menü → 🤖 Claude live; '
    'dort steht ein 6-stelliger Code. Den nennt er dir → live_connect {code}. Ohne Verbindung scheitern alle Bauwerkzeuge '
    'mit diesem Hinweis. Im Tab liegt SEIN Modell: nicht ungefragt leeren (scene.new) oder löschen. '
    'Maße in mm, Z oben, Bauplatte bei Z=0, "center" = Mitte der Bounding-Box. Bool-Operationen liefern neue ids (aus "created"). '
    'Vorgehen: planen (Maße, erwartetes Volumen), mit batch in wenigen Schritten bauen, mit measure prüfen. '
    'Ein execute/batch = ein Undo-Schritt, bei Fehler unverändert. list_commands zeigt alle Befehle; '
    'Formeln mit Parametern (param.set) sind überall erlaubt, param.set mit neuem Wert baut neu. '
    'Fertige Teile (Schraube, Mutter, Zahnrad, Gehäuse, Vase …): starter.list → starter.inspect → starter.run. '
    'Dateien: export legt die Datei als Download im Tab des Nutzers ab. '
    'Vor dem ersten Bauen einmal das Werkzeug anleitung lesen. Für kurze Antworten verbose:false.'
)

mcp = MCPServer(
    name='V3D CAD',
    instructions=HINWEISE,
    version='1.0',
    auth_server_provider=Provider(),
    auth=AuthSettings(
        issuer_url=settings.ISSUER_URL,
        resource_server_url=settings.RESOURCE_URL,
        validate_token_resource=True,
        required_scopes=[settings.SCOPE],
        client_registration_options=ClientRegistrationOptions(
            enabled=True, valid_scopes=[settings.SCOPE], default_scopes=[settings.SCOPE]),
        revocation_options=RevocationOptions(enabled=True),
    ),
)

LESEN = ToolAnnotations(read_only_hint=True, open_world_hint=False)
AENDERN = ToolAnnotations(read_only_hint=False, destructive_hint=False, open_world_hint=False)


class CadFehler(Exception):
    pass


# Konto → verbundener Tab (im Speicher; nach einem Neustart einfach neu verbinden)
TABS: dict[str, str] = {}


def _konto():
    tok = get_access_token()
    if not tok or not tok.subject:
        raise CadFehler('Kein Konto zur Anmeldung — Connector in Claude neu verbinden')
    return tok.subject


def _hub(pfad, body):
    req = urllib.request.Request(settings.HUB_URL + pfad, data=json.dumps(body).encode('utf-8'),
                                 headers={'content-type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=620) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode('utf-8')).get('error')
        except Exception:
            msg = None
        raise CadFehler(msg or 'Agent-Hub antwortet mit %d' % e.code)
    except OSError:
        raise CadFehler('V3D-CAD-Live-Dienst gerade nicht erreichbar — bitte später erneut')


OHNE_TAB = ('Kein V3D-CAD-Tab verbunden. Bitte den Nutzer: V3D CAD öffnen → ☰ Menü → 🤖 Claude live, '
            'dann den 6-stelligen Code nennen → live_connect {code}.')


async def _api(op, args):
    k = _konto()
    tab = TABS.get(k)
    if not tab:
        raise CadFehler(OHNE_TAB)
    try:
        r = await asyncio.to_thread(_hub, '/live/call', {'tab': tab, 'op': op, 'args': args, 'owner': k})
    except CadFehler as e:
        if 'nicht verbunden' in str(e) or 'unbekannt' in str(e):
            TABS.pop(k, None)
            raise CadFehler('Die Live-Verbindung zum Tab ist weg (Tab geschlossen oder „Beenden“). ' + OHNE_TAB)
        raise
    return r.get('result')


def _kompakt(r, verbose):
    if verbose is not False or not r:
        return r
    def slim(o):
        if isinstance(o, dict) and 'id' in o and 'bbox' in o:
            out = {'id': o['id'], 'name': o.get('name'), 'size': o.get('size'), 'center': o.get('center')}
            if 'volume_mm3' in o:
                out['volume_mm3'] = o['volume_mm3']
            if o.get('hole'):
                out['hole'] = True
            return out
        return o
    def walk(v):
        if isinstance(v, list):
            return [walk(x) for x in v]
        if isinstance(v, dict):
            return slim({k: walk(x) for k, x in v.items()})
        return v
    return walk(r)


def _text(wert, fehler=False):
    return CallToolResult(content=[TextContent(type='text', text=json.dumps(wert, ensure_ascii=False, indent=1))],
                          is_error=fehler)


def _engine(r):
    return _text(r, fehler=isinstance(r, dict) and r.get('ok') is False)


def werkzeug(annotations):
    """Tool registrieren: Audit (Konto, Werkzeug, Dauer — keine Inhalte), Fehler als isError-Antwort."""
    def deko(fn):
        @functools.wraps(fn)
        async def wrapper(**kw):
            tok = get_access_token()
            start = time.monotonic()
            meta = {'tool': fn.__name__, 'konto': tok.subject if tok else None,
                    'command': kw.get('command') if isinstance(kw.get('command'), str) else None}
            try:
                wert = await fn(**kw)
            except CadFehler as e:
                audit.log('tool_error', error='CadFehler', ms=int((time.monotonic() - start) * 1000), **meta)
                return CallToolResult(content=[TextContent(type='text', text='Fehler: ' + str(e))], is_error=True)
            except Exception as e:
                audit.log('tool_error', error=type(e).__name__, ms=int((time.monotonic() - start) * 1000), **meta)
                sys.stderr.write('Werkzeugfehler %s: %s\n' % (fn.__name__, type(e).__name__))
                return CallToolResult(content=[TextContent(type='text', text='Fehler: interner Fehler (%s)' % type(e).__name__)],
                                      is_error=True)
            audit.log('tool_call', ms=int((time.monotonic() - start) * 1000), **meta)
            return wert
        mcp.tool(annotations=annotations)(wrapper)
        return fn
    return deko


# --- Verbindung ------------------------------------------------------------------

@werkzeug(LESEN)
async def anleitung() -> CallToolResult:
    """Anleitung zum Modellieren in V3D CAD: Koordinaten, Vorgehen, Skizzen, Runden-Grenzen, Parametrik, Rezepte. Vor dem ersten Bauen lesen."""
    try:
        with open(ANLEITUNG_DATEI, encoding='utf-8') as fh:
            t = fh.read()
    except OSError:
        t = HINWEISE
    t = ('Hinweis für diesen Connector: Gebaut wird im Tab des Nutzers (live_connect). Werkzeuge mit Dateipfaden '
         '(save, open, import) gibt es hier nicht; export liefert einen Download im Tab.\n\n') + t
    return CallToolResult(content=[TextContent(type='text', text=t)])


@werkzeug(AENDERN)
async def live_connect(code: Annotated[str, Field(description='6-stelliger Code aus dem V3D-CAD-Tab (☰ Menü → 🤖 Claude live)')]) -> CallToolResult:
    """Mit dem V3D-CAD-Tab des Nutzers verbinden. Geht nur mit Tabs desselben V3D-CAD-Kontos."""
    k = _konto()
    ziffern = ''.join(ch for ch in code if ch.isdigit())
    r = await asyncio.to_thread(_hub, '/live/connect', {'code': ziffern, 'owner': k})
    TABS[k] = r['tab']
    probe = await _api('execute', ['scene.inspect', {}])
    return _text({'verbunden': True, 'koerper_im_tab': len(probe['result']['bodies']) if probe and probe.get('ok') else None,
                  'hinweis': 'Alle Befehle laufen jetzt sichtbar im Tab. Sein Modell nicht ungefragt leeren.'})


@werkzeug(LESEN)
async def live_status() -> CallToolResult:
    """Ist ein V3D-CAD-Tab verbunden?"""
    k = _konto()
    tab = TABS.get(k)
    if not tab:
        return _text({'live': False, 'hinweis': OHNE_TAB})
    r = await asyncio.to_thread(_hub, '/live/status', {'tab': tab, 'owner': k})
    return _text({'live': bool(r.get('verbunden')), **{x: r[x] for x in ('offen',) if x in r}})


@werkzeug(AENDERN)
async def live_disconnect() -> CallToolResult:
    """Verbindung zum Tab beenden."""
    k = _konto()
    tab = TABS.pop(k, None)
    if tab:
        try:
            await asyncio.to_thread(_hub, '/live/disconnect', {'tab': tab, 'owner': k})
        except CadFehler:
            pass
    return _text({'getrennt': bool(tab)})


# --- Bauen -----------------------------------------------------------------------

Params = Annotated[dict[str, Any] | None, Field(description='Parameter des Befehls (siehe list_commands)')]
Verbose = Annotated[bool | None, Field(description='false = kompakte Antwort (nur id, Name, Größe, Mitte, Volumen je Körper)')]


@werkzeug(LESEN)
async def list_commands(filter: Annotated[str | None, Field(description='Teilstring in Befehl oder Beschreibung')] = None) -> CallToolResult:
    """Alle V3D-CAD-Befehle mit Parametern (für execute/batch)."""
    return _text(await _api('commands', [filter or '']))


@werkzeug(AENDERN)
async def execute(command: str, params: Params = None, verbose: Verbose = None) -> CallToolResult:
    """Einen Befehl ausführen (z. B. shape.add, sketch.extrude, bool.subtract, param.set, starter.run). Ein Undo-Schritt; bei Fehler unverändert."""
    return _engine(_kompakt(await _api('execute', [command, params or {}]), verbose))


@werkzeug(AENDERN)
async def batch(commands: Annotated[list[dict[str, Any]], Field(description='[{command, params}] der Reihe nach')],
                rollback: Annotated[bool, Field(description='bei Fehler alles zurück (Standard true)')] = True,
                verbose: Verbose = None) -> CallToolResult:
    """Mehrere Befehle der Reihe nach, Stopp beim ersten Fehler, standardmäßig alles oder nichts. Zusammen EIN Undo-Schritt."""
    schritte = [{'command': c.get('command'), 'params': c.get('params') or {}} for c in commands]
    return _engine(_kompakt(await _api('batch', [schritte, {'rollback': rollback}]), verbose))


@werkzeug(LESEN)
async def inspect_scene(measure: bool = False, verbose: Verbose = None) -> CallToolResult:
    """Alle Körper im Tab: id, Name, Typ, Bohrung?, Mitte/Größe/BBox (mm); optional mit Volumen/Fläche."""
    return _engine(_kompakt(await _api('execute', ['scene.inspect', {'measure': measure}]), verbose))


@werkzeug(LESEN)
async def measure(id: int | None = None, a: int | None = None, b: int | None = None) -> CallToolResult:
    """Volumen (mm³), Oberfläche (mm²), BBox je Körper und gesamt. Mit a+b: echter kleinster Abstand (0 = berühren/überlappen) und BBox-Lücke."""
    if a is not None and b is not None:
        d = await _api('execute', ['measure.distance', {'a': a, 'b': b}])
        m = await _api('execute', ['measure.min_distance', {'a': a, 'b': b}])
        if d.get('ok') and m.get('ok'):
            return _engine({'ok': True, 'result': {**d['result'], **m['result']}})
        return _engine(d if not d.get('ok') else m)
    return _engine(await _api('execute', ['measure', {'id': id} if id is not None else {}]))


@werkzeug(LESEN)
async def screenshot(view: Literal['iso', 'front', 'back', 'top', 'bottom', 'left', 'right'] | None = None,
                     camera: Annotated[dict[str, Any] | None, Field(description='{target:[x,y,z], yaw: ° (0 vorn, 90 rechts), pitch: ° (90 oben), distance: mm, fov?: ° (0 = orthografisch)} statt view')] = None,
                     section: Annotated[dict[str, Any] | None, Field(description='{axis: X|Y|Z, at: mm, keep?: "-"|"+"} Schnittansicht')] = None,
                     width: int = 640, height: int = 400,
                     ids: Annotated[list[int] | None, Field(description='nur diese Körper zeigen')] = None) -> CallToolResult:
    """Bild der Szene im Tab (PNG)."""
    p = {k: v for k, v in {'view': view, 'camera': camera, 'section': section, 'width': width, 'height': height, 'ids': ids}.items() if v is not None}
    r = await _api('execute', ['view.screenshot', p])
    if not r or not r.get('ok'):
        return _engine(r)
    b64 = r['result']['png'].split(',', 1)[1]
    return CallToolResult(content=[ImageContent(type='image', mime_type='image/png', data=b64),
                                   TextContent(type='text', text=json.dumps({k: r['result'][k] for k in ('width', 'height', 'view')}))])


@werkzeug(AENDERN)
async def export(format: Literal['stl', '3mf', 'step'] = '3mf',
                 ids: Annotated[list[int] | None, Field(description='nur diese Körper (Standard: alle sichtbaren)')] = None,
                 name: Annotated[str | None, Field(description='Dateiname ohne Endung')] = None) -> CallToolResult:
    """Datei exportieren (mm, Z oben) — landet als Download im Tab des Nutzers. Bohrungen werden nicht exportiert."""
    p = {'format': format, **({'ids': ids} if ids else {}), **({'name': name} if name else {})}
    return _engine(await _api('download', [p]))


@werkzeug(AENDERN)
async def undo() -> CallToolResult:
    """Einen Schritt zurück."""
    return _engine(await _api('execute', ['edit.undo', {}]))


@werkzeug(AENDERN)
async def redo() -> CallToolResult:
    """Einen Schritt vor."""
    return _engine(await _api('execute', ['edit.redo', {}]))


# --- HTTP ------------------------------------------------------------------------

@mcp.custom_route('/login', methods=['GET', 'POST'])
async def _login(request: Request):
    return await login(request)


@mcp.custom_route('/anleitung', methods=['GET'])
async def _anleitung_seite(request: Request):
    # Öffentliche Anleitung für Nutzer: Umzug nach netcup + Claude verbinden
    from starlette.responses import HTMLResponse
    with open(os.path.join(os.path.dirname(__file__), 'anleitung.html'), encoding='utf-8') as fh:
        return HTMLResponse(fh.read(), headers={'Cache-Control': 'no-cache'})


@mcp.custom_route('/health', methods=['GET'])
async def _health(request: Request):
    return JSONResponse({'ok': True})


def build_app():
    warnings.filterwarnings('ignore', category=DeprecationWarning)
    sicherheit = TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=settings.ALLOWED_HOSTS,
        allowed_origins=['https://claude.ai', 'https://claude.com',
                         'http://127.0.0.1:*', 'http://localhost:*'])
    app = mcp.streamable_http_app(streamable_http_path='/mcp', stateless_http=True,
                                  json_response=True, transport_security=sicherheit,
                                  host=settings.BIND_HOST)
    return app, RateLimit(BrowserHinweis(app))


HILFE = """<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>V3D CAD für Claude</title>
<style>body{margin:0;font:16px/1.55 system-ui,sans-serif;background:#f4f5f8;color:#1c2030;display:flex;justify-content:center;padding:20px}
main{background:#fff;border:1px solid #e3e6ef;border-radius:14px;padding:26px;max-width:560px}h1{font-size:21px;margin:0 0 8px}
code{background:#f0f2f7;padding:2px 6px;border-radius:6px;word-break:break-all}ol{padding-left:20px}li{margin:6px 0}.m{color:#5b6172;font-size:14px}
@media (prefers-color-scheme:dark){body{background:#14161c;color:#e8eaf0}main{background:#1e2129;border-color:#2e323d}code{background:#2a2e38}.m{color:#9aa0b0}}</style></head>
<body><main><h1>🤖 V3D CAD für Claude</h1>
<p>Diese Adresse ist für <b>Claude</b> gedacht, nicht zum Öffnen im Browser.</p>
<ol><li>Am Computer <b>claude.ai</b> öffnen → Einstellungen → <b>Connectors</b> → <b>Eigenen Connector hinzufügen</b>.</li>
<li>Name <code>V3D CAD</code>, URL <code>%s</code> → Hinzufügen → <b>Verbinden</b> → auf der V3D-CAD-Seite <b>Erlauben</b>.</li>
<li>In V3D CAD <b>☰ Menü → 🤖 Claude live</b> öffnen und Claude den angezeigten Code nennen.</li></ol>
<p class="m">Claude baut dann sichtbar in deinem V3D-CAD-Tab, mit deinem eigenen Claude-Abo. <a href="anleitung">Ausführliche Anleitung</a></p></main></body></html>"""


class BrowserHinweis:
    """Wer die Connector-Adresse im Browser öffnet, bekommt eine Anleitung statt einer JSON-Fehlermeldung."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'http' and scope.get('method') == 'GET' and scope.get('path') == '/mcp':
            kopf = dict(scope.get('headers') or [])
            if b'text/html' in kopf.get(b'accept', b'') and b'authorization' not in kopf:
                from starlette.responses import HTMLResponse
                return await HTMLResponse(HILFE % settings.RESOURCE_URL, headers={'Cache-Control': 'no-store'})(scope, receive, send)
        return await self.app(scope, receive, send)


def serve():
    import uvicorn
    if settings.TEST_SUBJECT:
        sys.stderr.write('WARNUNG: V3DCAD_TEST_SUBJECT gesetzt — nur für Tests!\n')
    starlette_app, app = build_app()
    uvicorn.run(app, host=settings.BIND_HOST, port=settings.PORT, access_log=False,
                proxy_headers=False, server_header=False, log_level='warning', lifespan='on')
