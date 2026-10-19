"""OAuth 2.1 (Authorization Code + PKCE, Dynamic Client Registration) für alle
angemeldeten V3D-CAD-Nutzer. Protokoll-Endpunkte (/authorize, /token, /register,
/revoke, Metadaten) stellt das MCP-SDK; hier liegen Speicherung, Regeln und die
Freigabe-Seite. Gerüst übernommen vom V3D-Mail-Connector.

Anmeldung: keine eigenen Passwörter. Die Freigabe-Seite liegt am selben Host wie
V3D CAD und fragt mit dem Sitzungs-Cookie des Browsers bei volme3d_server.py
(/auth/me) nach dem Konto. Nicht angemeldet → weiter zur V3D-CAD-Anmeldung und
zurück. Jedes Token trägt das Konto (subject); der Hub lässt Claude nur Tabs
desselben Kontos steuern.
"""
import asyncio
import html
import json
import secrets
import urllib.parse
import urllib.request

from pydantic import AnyUrl
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response

from mcp.server.auth.provider import (AccessToken, AuthorizationCode, AuthorizationParams,
                                      AuthorizeError, RefreshToken, RegistrationError,
                                      TokenError, construct_redirect_uri)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

from . import audit, settings, store
from .netz import client_ip

COOKIE = 'v3dsess'


def _resource_ok(resource):
    if not resource:
        return True
    return resource.rstrip('/') == settings.RESOURCE_URL.rstrip('/')


class Provider:
    # --- Clients (Dynamic Client Registration) ---

    async def get_client(self, client_id):
        info = store.client_laden(client_id)
        return OAuthClientInformationFull.model_validate_json(info) if info else None

    async def register_client(self, client_info: OAuthClientInformationFull):
        uris = [str(u) for u in (client_info.redirect_uris or [])]
        fremd = [u for u in uris if u not in settings.REDIRECT_URIS]
        if not uris or fremd:
            audit.log('register_denied', reason='redirect_uri', count=len(fremd))
            raise RegistrationError('invalid_redirect_uri',
                                    'Nur die Rücksprungadressen von Claude sind zugelassen.')
        store.aufraeumen()
        if store.client_anzahl() >= settings.MAX_CLIENTS:
            audit.log('register_denied', reason='max_clients')
            raise RegistrationError('invalid_client_metadata', 'Zu viele registrierte Clients.')
        store.client_speichern(client_info.client_id, client_info.model_dump_json())
        audit.log('client_registered', client_id=client_info.client_id,
                  client_name=(client_info.client_name or '')[:60])

    # --- Autorisierung ---

    async def authorize(self, client, params: AuthorizationParams):
        if not _resource_ok(params.resource):
            raise AuthorizeError('invalid_target', 'Unbekannte Ressource')
        scopes = params.scopes or [settings.SCOPE]
        if any(s != settings.SCOPE for s in scopes):
            raise AuthorizeError('invalid_scope', 'Nur der Bereich "cad" ist verfügbar')
        pid = store.pending_neu(client.client_id, {
            'state': params.state, 'scopes': scopes, 'code_challenge': params.code_challenge,
            'redirect_uri': str(params.redirect_uri),
            'redirect_uri_provided_explicitly': params.redirect_uri_provided_explicitly,
            'resource': settings.RESOURCE_URL,
        })
        return settings.ISSUER_URL + '/login?req=' + pid

    async def load_authorization_code(self, client, authorization_code):
        r = store.code_laden(authorization_code)
        if not r or r[0] != client.client_id:
            return None
        _, d, ablauf = r
        return AuthorizationCode(code=authorization_code, scopes=d['scopes'], expires_at=ablauf,
                                 client_id=client.client_id, code_challenge=d['code_challenge'],
                                 redirect_uri=AnyUrl(d['redirect_uri']),
                                 redirect_uri_provided_explicitly=d['redirect_uri_provided_explicitly'],
                                 resource=d['resource'], subject=d['subject'])

    async def exchange_authorization_code(self, client, authorization_code):
        if not store.code_verbrauchen(authorization_code.code):
            raise TokenError('invalid_grant', 'Code bereits eingelöst')
        family = secrets.token_hex(12)
        tok = self._ausgeben(client.client_id, family, authorization_code.scopes, authorization_code.subject)
        audit.log('token_issued', client_id=client.client_id, konto=authorization_code.subject, grant='authorization_code')
        return tok

    def _ausgeben(self, client_id, family, scopes, subject):
        access, _ = store.token_neu('access', client_id, family, scopes, settings.RESOURCE_URL,
                                    settings.ACCESS_TTL, subject)
        refresh, _ = store.token_neu('refresh', client_id, family, scopes, settings.RESOURCE_URL,
                                     settings.REFRESH_TTL, subject)
        store.client_benutzt(client_id)
        return OAuthToken(access_token=access, token_type='Bearer', expires_in=settings.ACCESS_TTL,
                          scope=' '.join(scopes), refresh_token=refresh)

    # --- Refresh (rotierend) ---

    async def load_refresh_token(self, client, refresh_token):
        d = store.token_laden(refresh_token, 'refresh')
        if not d or d['client_id'] != client.client_id:
            return None
        if d['used']:
            # Schon rotiertes Token kommt noch einmal → vermutlich gestohlen: Familie sperren
            store.familie_sperren(d['family'])
            audit.log('refresh_reuse_detected', client_id=client.client_id)
            return None
        return RefreshToken(token=refresh_token, client_id=d['client_id'], scopes=d['scopes'],
                            expires_at=d['expires'], resource=d['resource'], subject=d['subject'])

    async def exchange_refresh_token(self, client, refresh_token, scopes):
        if not store.refresh_verbrauchen(refresh_token.token):
            fam = store.familie_von(refresh_token.token)
            if fam:
                store.familie_sperren(fam)
            raise TokenError('invalid_grant', 'Refresh-Token ungültig')
        fam = store.familie_von(refresh_token.token)
        tok = self._ausgeben(client.client_id, fam, scopes or refresh_token.scopes, refresh_token.subject)
        audit.log('token_issued', client_id=client.client_id, konto=refresh_token.subject, grant='refresh_token')
        return tok

    # --- Prüfen und Widerrufen ---

    async def load_access_token(self, token):
        d = store.token_laden(token, 'access')
        if not d:
            return None
        return AccessToken(token=token, client_id=d['client_id'], scopes=d['scopes'],
                           expires_at=d['expires'], resource=d['resource'], subject=d['subject'])

    async def revoke_token(self, token):
        fam = store.familie_von(token.token)
        if fam:
            store.familie_sperren(fam)
            audit.log('token_revoked', client_id=token.client_id)


# --- Freigabe-Seite ----------------------------------------------------------

SEITE = """<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>V3D CAD – Claude verbinden</title>
<style>
:root{{--bg:#f4f5f8;--card:#fff;--fg:#1c2030;--mute:#5b6172;--acc:#EA6000;--err:#b3261e;--line:#e3e6ef}}
@media (prefers-color-scheme:dark){{:root{{--bg:#14161c;--card:#1e2129;--fg:#e8eaf0;--mute:#9aa0b0;--line:#2e323d;--err:#ff8a80}}}}
*{{box-sizing:border-box}}
body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px}}
main{{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px;width:100%;max-width:400px}}
h1{{font-size:20px;margin:0 0 6px}} p{{color:var(--mute);margin:0 0 14px;font-size:14px}}
ul{{color:var(--mute);font-size:14px;padding-left:18px;margin:0 0 16px}}
.konto{{font-weight:600;color:var(--fg)}}
button,.knopf{{display:block;text-align:center;text-decoration:none;margin-top:12px;width:100%;padding:12px;border:0;border-radius:9px;background:var(--acc);color:#fff;font-size:16px;font-weight:600;cursor:pointer}}
.err{{color:var(--err);font-size:14px;margin:12px 0 0}}
</style></head><body><main>
<h1>V3D CAD mit Claude verbinden</h1>
{inhalt}
</main></body></html>"""

FREIGABE = """<p>{client} möchte für dein V3D-CAD-Konto <span class="konto">{konto}</span> bauen.</p>
<ul><li>Claude baut nur in Tabs, in denen du <b>☰ Menü → 🤖 Claude live</b> geöffnet und ihm den Code genannt hast.</li>
<li>Es nutzt dein eigenes Claude-Abo; V3D CAD rechnet in deinem Browser.</li>
<li>Trennen kannst du jederzeit: im Tab „Beenden“ oder den Connector in Claude entfernen.</li></ul>
<form method="post" action="login"><input type="hidden" name="req" value="{req}">
<button type="submit">Erlauben</button></form>"""


def _csp():
    ziele = sorted({u.split('/api/')[0] for u in settings.REDIRECT_URIS if u.startswith('http')})
    return ("default-src 'none'; style-src 'unsafe-inline'; form-action 'self' %s; "
            "frame-ancestors 'none'; base-uri 'none'" % ' '.join(ziele))


def _seite(status, inhalt):
    return HTMLResponse(SEITE.format(inhalt=inhalt), status_code=status,
                        headers={'Content-Security-Policy': _csp(), 'X-Frame-Options': 'DENY',
                                 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})


def _client_name(client_id):
    info = store.client_laden(client_id)
    if not info:
        return 'Claude'
    return (json.loads(info).get('client_name') or 'Claude')[:60]


def _konto_sync(cookie):
    """Konto zur V3D-CAD-Sitzung (oder None). Fragt volme3d_server.py, statt das Cookie selbst zu prüfen."""
    if settings.TEST_SUBJECT:
        return settings.TEST_SUBJECT
    # Auch ohne Cookie fragen: dann antwortet V3D CAD „nicht angemeldet“ (im Dev-Modus mit dem Dev-Konto)
    req = urllib.request.Request(settings.CAD_URL + '/auth/me', headers={'Cookie': COOKIE + '=' + cookie} if cookie else {})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            me = json.loads(r.read().decode('utf-8'))
    except Exception:
        return None
    if not me.get('angemeldet') or me.get('gast') or not me.get('email'):
        return None
    return str(me['email']).strip().lower()


async def konto(request: Request):
    return await asyncio.to_thread(_konto_sync, request.cookies.get(COOKIE))


def _zur_anmeldung(pid):
    # zurück auf genau diese Seite; die V3D-CAD-Anmeldung lässt nur eigene Pfade zu
    pfad = urllib.parse.urlsplit(settings.ISSUER_URL).path + '/login?req=' + pid
    return RedirectResponse(settings.CAD_PUBLIC + '/login?weiter=' + urllib.parse.quote(pfad, safe=''),
                            status_code=302, headers={'Cache-Control': 'no-store'})


ABGELAUFEN = '<p class="err">Anmeldung abgelaufen. Bitte in Claude neu verbinden.</p>'


async def login(request: Request) -> Response:
    ip = client_ip(request.scope)
    if request.method == 'GET':
        pid = request.query_params.get('req', '')
        client_id, _ = store.pending_laden(pid)
        if not client_id:
            return _seite(400, ABGELAUFEN)
        k = await konto(request)
        if not k:
            return _zur_anmeldung(pid)
        return _seite(200, FREIGABE.format(client=html.escape(_client_name(client_id)), konto=html.escape(k),
                                           req=html.escape(pid)))

    form = await request.form()
    pid = str(form.get('req') or '')
    client_id, params = store.pending_laden(pid)
    if not client_id:
        return _seite(400, ABGELAUFEN)
    k = await konto(request)
    if not k:
        audit.log('login_ohne_sitzung', ip=ip, client_id=client_id)
        return _zur_anmeldung(pid)
    store.pending_loeschen(pid)
    code = store.code_neu(client_id, {**{x: params[x] for x in (
        'scopes', 'code_challenge', 'redirect_uri', 'redirect_uri_provided_explicitly', 'resource')}, 'subject': k})
    audit.log('login_ok', ip=ip, client_id=client_id, konto=k)
    ziel = construct_redirect_uri(params['redirect_uri'], code=code, state=params.get('state'))
    return RedirectResponse(ziel, status_code=302, headers={'Cache-Control': 'no-store'})
