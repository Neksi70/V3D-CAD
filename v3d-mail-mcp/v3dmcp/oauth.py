"""OAuth 2.1 (Authorization Code + PKCE, Dynamic Client Registration) für
genau einen Benutzer. Die Protokoll-Endpunkte (/authorize, /token, /register,
/revoke, Metadaten) stellt das MCP-SDK; hier liegen Speicherung, Regeln und
die Login-Seite.

Ablauf: Claude registriert sich (/register, nur mit den zwei Claude-
Rücksprungadressen) → /authorize leitet auf /login?req=… → Passwort (argon2)
→ Code → Claude tauscht ihn mit PKCE gegen Access- (1 h) und Refresh-Token
(rotierend, Wiederverwendung sperrt die ganze Token-Familie).
"""
import asyncio
import html
import json
import secrets
import time

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from pydantic import AnyUrl
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response

from mcp.server.auth.provider import (AccessToken, AuthorizationCode, AuthorizationParams,
                                      AuthorizeError, RefreshToken, RegistrationError,
                                      TokenError, construct_redirect_uri)
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

from . import audit, settings, store
from .netz import client_ip

PH = PasswordHasher()


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
            raise AuthorizeError('invalid_scope', 'Nur der Bereich "mail" ist verfügbar')
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
                                 resource=d['resource'], subject='owner')

    async def exchange_authorization_code(self, client, authorization_code):
        if not store.code_verbrauchen(authorization_code.code):
            raise TokenError('invalid_grant', 'Code bereits eingelöst')
        family = secrets.token_hex(12)
        tok = self._ausgeben(client.client_id, family, authorization_code.scopes)
        audit.log('token_issued', client_id=client.client_id, grant='authorization_code')
        return tok

    def _ausgeben(self, client_id, family, scopes):
        access, _ = store.token_neu('access', client_id, family, scopes, settings.RESOURCE_URL,
                                    settings.ACCESS_TTL)
        refresh, _ = store.token_neu('refresh', client_id, family, scopes, settings.RESOURCE_URL,
                                     settings.REFRESH_TTL)
        store.client_benutzt(client_id)
        return OAuthToken(access_token=access, token_type='Bearer', expires_in=settings.ACCESS_TTL,
                          scope=' '.join(scopes), refresh_token=refresh)

    # --- Refresh (rotierend) ---

    async def load_refresh_token(self, client, refresh_token):
        d = store.token_laden(refresh_token, 'refresh')
        if not d or d['client_id'] != client.client_id:
            return None
        if d['used']:
            # Ein schon rotiertes Token kommt noch einmal → wahrscheinlich
            # gestohlen. Die ganze Familie (alle Tokens dieser Anmeldung) sperren.
            store.familie_sperren(d['family'])
            audit.log('refresh_reuse_detected', client_id=client.client_id)
            return None
        return RefreshToken(token=refresh_token, client_id=d['client_id'], scopes=d['scopes'],
                            expires_at=d['expires'], resource=d['resource'], subject='owner')

    async def exchange_refresh_token(self, client, refresh_token, scopes):
        if not store.refresh_verbrauchen(refresh_token.token):
            fam = store.familie_von(refresh_token.token)
            if fam:
                store.familie_sperren(fam)
            raise TokenError('invalid_grant', 'Refresh-Token ungültig')
        fam = store.familie_von(refresh_token.token)
        # Alte Access-Tokens der Familie bleiben bis zu ihrem Ablauf (≤ 1 h) gültig.
        tok = self._ausgeben(client.client_id, fam, scopes or refresh_token.scopes)
        audit.log('token_issued', client_id=client.client_id, grant='refresh_token')
        return tok

    # --- Prüfen und Widerrufen ---

    async def load_access_token(self, token):
        d = store.token_laden(token, 'access')
        if not d:
            return None
        return AccessToken(token=token, client_id=d['client_id'], scopes=d['scopes'],
                           expires_at=d['expires'], resource=d['resource'], subject='owner')

    async def revoke_token(self, token):
        fam = store.familie_von(token.token)
        if fam:
            store.familie_sperren(fam)
            audit.log('token_revoked', client_id=token.client_id)


# --- Login-Seite -------------------------------------------------------------

SEITE = """<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>V3D Mail – Claude verbinden</title>
<style>
:root{{--bg:#f4f5f8;--card:#fff;--fg:#1c2030;--mute:#5b6172;--acc:#EA6000;--err:#b3261e;--line:#e3e6ef}}
@media (prefers-color-scheme:dark){{:root{{--bg:#14161c;--card:#1e2129;--fg:#e8eaf0;--mute:#9aa0b0;--line:#2e323d;--err:#ff8a80}}}}
*{{box-sizing:border-box}}
body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px}}
main{{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px;width:100%;max-width:380px}}
h1{{font-size:20px;margin:0 0 6px}} p{{color:var(--mute);margin:0 0 18px;font-size:14px}}
label{{display:block;font-size:14px;margin-bottom:6px}}
input{{width:100%;padding:12px;border:1px solid var(--line);border-radius:9px;font-size:16px;background:var(--bg);color:var(--fg)}}
button{{margin-top:16px;width:100%;padding:12px;border:0;border-radius:9px;background:var(--acc);color:#fff;font-size:16px;font-weight:600;cursor:pointer}}
.err{{color:var(--err);font-size:14px;margin:12px 0 0}}
</style></head><body><main>
<h1>V3D Mail mit Claude verbinden</h1>
<p>{client} möchte auf deine Postfächer und den Kalender zugreifen.</p>
{form}
</main></body></html>"""

FORM = """<form method="post" action="login" autocomplete="off">
<input type="hidden" name="req" value="{req}">
<label for="pw">Passwort</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Zugriff erlauben</button>
</form>{fehler}"""


def _csp():
    # form-action muss die Rücksprungziele enthalten: Chrome wendet die Regel
    # auch auf die Weiterleitung nach dem Absenden an.
    ziele = sorted({u.split('/api/')[0] for u in settings.REDIRECT_URIS if u.startswith('http')})
    return ("default-src 'none'; style-src 'unsafe-inline'; form-action 'self' %s; "
            "frame-ancestors 'none'; base-uri 'none'" % ' '.join(ziele))


def _seite(status, client, inhalt):
    return HTMLResponse(SEITE.format(client=html.escape(client), form=inhalt), status_code=status,
                        headers={'Content-Security-Policy': _csp(), 'X-Frame-Options': 'DENY',
                                 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'})


def _client_name(client_id):
    info = store.client_laden(client_id)
    if not info:
        return 'Ein Client'
    return (json.loads(info).get('client_name') or 'Claude')[:60]


def gesperrt_bis(ip):
    return max(store.fail_stand('ip:' + ip)[2], store.fail_stand('global')[2])


def _fehlversuch(ip):
    jetzt = time.time()
    for key, grenze in (('ip:' + ip, settings.FAIL_MAX_IP), ('global', settings.FAIL_MAX_GLOBAL)):
        n, erst, _ = store.fail_stand(key)
        if jetzt - erst > settings.FAIL_WINDOW:
            n, erst = 0, jetzt
        n += 1
        sperre = jetzt + settings.LOCK_SECONDS if n >= grenze else 0
        store.fail_setzen(key, n, erst, sperre)
        if sperre:
            audit.log('login_locked', scope=key.split(':')[0], ip=ip)


async def login(request: Request) -> Response:
    ip = client_ip(request.scope)
    if request.method == 'GET':
        pid = request.query_params.get('req', '')
        client_id, _ = store.pending_laden(pid)
        if not client_id:
            return _seite(400, 'Claude', '<p class="err">Anmeldung abgelaufen. Bitte in Claude neu verbinden.</p>')
        return _seite(200, _client_name(client_id), FORM.format(req=html.escape(pid), fehler=''))

    form = await request.form()
    pid = str(form.get('req') or '')
    pw = str(form.get('password') or '')
    client_id, params = store.pending_laden(pid)
    if not client_id:
        return _seite(400, 'Claude', '<p class="err">Anmeldung abgelaufen. Bitte in Claude neu verbinden.</p>')
    name = _client_name(client_id)

    if gesperrt_bis(ip) > time.time():
        audit.log('login_blocked', ip=ip)
        return _seite(429, name, FORM.format(req=html.escape(pid), fehler=(
            '<p class="err">Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen.</p>')))

    ok = False
    soll = settings.passwort_hash()
    if soll and pw:
        try:
            ok = PH.verify(soll, pw)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            ok = False
    if not ok:
        _fehlversuch(ip)
        audit.log('login_failed', ip=ip, client_id=client_id,
                  reason='no_password_set' if not soll else 'wrong_password')
        await asyncio.sleep(1.0)
        return _seite(401, name, FORM.format(req=html.escape(pid),
                                              fehler='<p class="err">Passwort falsch.</p>'))

    store.fail_loeschen('ip:' + ip)
    store.fail_loeschen('global')
    store.pending_loeschen(pid)
    code = store.code_neu(client_id, {k: params[k] for k in (
        'scopes', 'code_challenge', 'redirect_uri', 'redirect_uri_provided_explicitly', 'resource')})
    audit.log('login_ok', ip=ip, client_id=client_id)
    ziel = construct_redirect_uri(params['redirect_uri'], code=code, state=params.get('state'))
    return RedirectResponse(ziel, status_code=302, headers={'Cache-Control': 'no-store'})
