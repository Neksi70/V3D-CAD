"""Server-Browser: reicht ausgewählte Werkzeuge an Playwright MCP weiter.

Playwright MCP läuft als eigener Dienst (v3d-browser.service, 127.0.0.1:8812),
Chrome dahinter nur über den Sperr-Proxy (v3d-browser-proxy.service) — interne
Adressen sind gesperrt, siehe browser/sperrproxy.py.

Die MCP-Sitzung zu Playwright bleibt dauerhaft offen (eigener Thread mit eigener
Ereignisschleife): Playwright hängt Tabs an die Sitzung, eine Sitzung je Aufruf
stünde jedes Mal wieder auf about:blank. Bricht sie ab, wird einmal neu verbunden.

Ziel "notebook": derselbe Weg zu Playwright MCP auf Volkers Notebook (über Tailscale,
--extension → sein echter Chrome mit Anmeldungen). Dort gibt es keinen Sperr-Proxy.

Bewusst NICHT weitergereicht: Datei-Upload/-Drop (läse Serverdateien),
browser_run_code_unsafe (Node-Code auf dem Server), evaluate, Netzwerk-/Konsolen-
Mitschnitte und alle filename-Parameter (schrieben auf die Platte).
"""
import asyncio
import contextlib
import logging
import os
import re
import threading
from urllib.parse import urlsplit

from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult, TextContent

ZIELE = {
    'server': os.environ.get('BROWSER_MCP_URL') or 'http://127.0.0.1:8812/mcp',
    'notebook': os.environ.get('NOTEBOOK_MCP_URL') or 'http://100.66.252.89:8931/mcp',
}
HILFE = {
    'server': 'systemctl --user status v3d-browser',
    'notebook': 'ist das Notebook an, im Tailnet und läuft „V3D Browser-Brücke"?',
}
FRIST = 90
VERBINDEN_FRIST = 15  # Notebook aus → nicht 90 s warten

# Hinweise auf Dateien in Playwrights Ausgabeordner sind für Claude Chat wertlos
_DATEI_ZEILE = re.compile(r'^.*\]\(\.\./ausgabe/[^)]*\).*$\n?', re.M)

logging.getLogger('httpx').setLevel(logging.WARNING)
logging.getLogger('httpx2').setLevel(logging.WARNING)


class BrowserFehler(Exception):
    pass


class _Verbindung:
    def __init__(self, ziel):
        self.url, self.hilfe = ZIELE[ziel], HILFE[ziel]
        self.loop = asyncio.new_event_loop()
        threading.Thread(target=self.loop.run_forever, name='v3d-browser-' + ziel, daemon=True).start()
        self.stapel = None
        self.sitzung = None
        self.lock = None

    async def _trennen(self):
        stapel, self.stapel, self.sitzung = self.stapel, None, None
        if stapel:
            with contextlib.suppress(BaseException):
                await stapel.aclose()

    async def _erreichbar(self):
        # kurzer TCP-Test vorab; wait_for um _verbinden ginge nicht (anyio-Kontexte
        # müssen in derselben Aufgabe betreten und verlassen werden)
        u = urlsplit(self.url)
        _, w = await asyncio.wait_for(asyncio.open_connection(u.hostname, u.port or 80), VERBINDEN_FRIST)
        w.close()

    async def _verbinden(self):
        stapel = contextlib.AsyncExitStack()
        try:
            streams = await stapel.enter_async_context(streamable_http_client(self.url))
            sitzung = await stapel.enter_async_context(ClientSession(streams[0], streams[1]))
            await sitzung.initialize()
        except BaseException:
            with contextlib.suppress(BaseException):
                await stapel.aclose()
            raise
        self.stapel, self.sitzung = stapel, sitzung

    async def _rufe(self, name, argumente):
        if self.lock is None:
            self.lock = asyncio.Lock()
        async with self.lock:  # ein Browser, eine Aktion nach der anderen
            for versuch in (1, 2):
                try:
                    if self.sitzung is None:
                        await self._erreichbar()
                        await self._verbinden()
                    return await asyncio.wait_for(self.sitzung.call_tool(name, argumente), FRIST)
                except asyncio.TimeoutError:
                    await self._trennen()
                    raise BrowserFehler('Zeitüberschreitung — %s' % self.hilfe)
                # CancelledError: anyio bricht bei Verbindungsfehlern die eigene Aufgabe ab;
                # in dieser Schleife bricht sonst niemand ab → wie ein Fehler behandeln
                except (Exception, asyncio.CancelledError) as e:
                    await self._trennen()
                    if versuch == 2:
                        raise BrowserFehler('Browser-Dienst nicht erreichbar (%s) — %s'
                                        % (type(e).__name__, self.hilfe))

    async def rufe(self, name, argumente):
        fut = asyncio.run_coroutine_threadsafe(self._rufe(name, argumente), self.loop)
        return await asyncio.wrap_future(fut)


_verbindungen = {}


async def rufe(name, argumente, ziel='server'):
    if ziel not in ZIELE:
        raise BrowserFehler('unbekanntes Ziel %r (server oder notebook)' % ziel)
    if ziel not in _verbindungen:
        _verbindungen[ziel] = _Verbindung(ziel)
    _verbindung = _verbindungen[ziel]
    argumente = {k: v for k, v in argumente.items() if v is not None}
    r = await _verbindung.rufe(name, argumente)
    inhalt = []
    for c in r.content:
        if c.type == 'text':
            text = _DATEI_ZEILE.sub('', c.text)
            # Nach Aktionen legt Playwright (HTTP-Modus) den Snapshot nur als Datei ab
            # → hier frisch holen, damit Claude die Element-Referenzen direkt hat.
            if not r.is_error and re.search(r'### Snapshot\s*(\n###|$)', text):
                snap = await _verbindung.rufe('browser_snapshot', {})
                teil = snap.content[0].text if snap.content and snap.content[0].type == 'text' else ''
                i = teil.find('### Snapshot')
                if i >= 0:
                    text = re.sub(r'### Snapshot\s*(?=\n###|$)', lambda _: teil[i:].rstrip(), text, count=1)
            c = TextContent(type='text', text=text)
        inhalt.append(c)
    return CallToolResult(content=inhalt or [TextContent(type='text', text='ok')],
                          is_error=bool(r.is_error))
