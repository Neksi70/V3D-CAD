"""End-to-End: offizieller MCP-SDK-Client mit OAuth gegen eine laufende Instanz.

Der Browser-Schritt (Login-Seite) wird hier per HTTP nachgespielt: der Client
bekommt die /authorize-Adresse, wir folgen bis /login, schicken das Passwort
und fangen die Weiterleitung auf die Claude-Rücksprungadresse ab (ohne ihr zu
folgen) — daraus stammt der Code.

Aufruf: oauth_flow.py <basis-url> <passwortdatei> [werkzeug json-args]...
Ohne Werkzeuge: nur Verbindungsaufbau + tools/list.
"""
import asyncio
import json
import sys
from urllib.parse import parse_qs, urljoin, urlparse

import httpx2
from mcp.client.auth import OAuthClientProvider
from mcp.client.session import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.auth import AuthorizationCodeResult, OAuthClientMetadata

BASIS = sys.argv[1].rstrip('/')
PASSWORT = open(sys.argv[2]).read().strip()
AUFRUFE = [(sys.argv[i], json.loads(sys.argv[i + 1])) for i in range(3, len(sys.argv) - 1, 2)]
REDIRECT = 'https://claude.ai/api/mcp/auth_callback'


class Speicher:
    def __init__(self):
        self.tokens = self.client = None

    async def get_tokens(self):
        return self.tokens

    async def set_tokens(self, t):
        self.tokens = t

    async def get_client_info(self):
        return self.client

    async def set_client_info(self, c):
        self.client = c


ergebnis = {}


async def redirect_handler(url):
    async with httpx2.AsyncClient(follow_redirects=False) as c:
        r = await c.get(url)
        assert r.status_code in (302, 307), ('authorize', r.status_code, r.text[:200])
        login_url = urljoin(url, r.headers['location'])
        r = await c.get(login_url)
        assert r.status_code == 200 and 'Passwort' in r.text, ('login-GET', r.status_code)
        req = parse_qs(urlparse(login_url).query)['req'][0]
        r = await c.post(urljoin(login_url, 'login'), data={'req': req, 'password': PASSWORT})
        assert r.status_code == 302, ('login-POST', r.status_code)
        ziel = r.headers['location']
        assert ziel.startswith(REDIRECT), ziel
        q = parse_qs(urlparse(ziel).query)
        ergebnis['code'] = AuthorizationCodeResult(code=q['code'][0], state=q.get('state', [None])[0])


async def callback_handler():
    return ergebnis['code']


async def main():
    auth = OAuthClientProvider(
        server_url=BASIS + '/mcp',
        client_metadata=OAuthClientMetadata(client_name='Testclient', redirect_uris=[REDIRECT],
                                            grant_types=['authorization_code', 'refresh_token'],
                                            response_types=['code']),
        storage=Speicher(), redirect_handler=redirect_handler, callback_handler=callback_handler)
    async with httpx2.AsyncClient(auth=auth, timeout=120) as http:
        async with streamable_http_client(BASIS + '/mcp', http_client=http) as streams:
            async with ClientSession(streams[0], streams[1]) as s:
                await s.initialize()
                tools = await s.list_tools()
                print('TOOLS', sorted(t.name for t in tools.tools))
                for name, args in AUFRUFE:
                    r = await s.call_tool(name, args)
                    teile = []
                    for c in r.content:
                        if c.type == 'text':
                            teile.append(c.text)
                        elif c.type == 'resource':
                            teile.append('[resource %s %d b64-Zeichen]' % (c.resource.mime_type, len(c.resource.blob)))
                        else:
                            teile.append('[%s]' % c.type)
                    print('==>', name, 'ERROR' if r.is_error else 'ok')
                    print('\n'.join(teile)[:6000])


asyncio.run(main())
