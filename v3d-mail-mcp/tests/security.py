"""Negativ- und Regeltests gegen eine laufende TEST-Instanz (nicht die echte:
revoke-all und Fehl-Logins wirken sich aus).

Aufruf: security.py <basis-url> <passwortdatei> <DATA_DIR der Instanz>
"""
import base64
import hashlib
import os
import secrets
import subprocess
import sys
from urllib.parse import parse_qs, urlparse

import httpx2

BASIS = sys.argv[1].rstrip('/')
PW = open(sys.argv[2]).read().strip()
DATA = sys.argv[3]
CB = 'https://claude.ai/api/mcp/auth_callback'
ok = True


def pruefe(name, bedingung, info=''):
    global ok
    print(('PASS ' if bedingung else 'FAIL ') + name + ('' if bedingung else '  → %s' % info))
    ok &= bool(bedingung)


c = httpx2.Client(follow_redirects=False, timeout=30)

# 1. Registrierung nur mit Claude-Rücksprung
r = c.post(BASIS + '/register', json={'redirect_uris': ['https://evil.example/cb'], 'client_name': 'x'})
pruefe('DCR lehnt fremde redirect_uri ab', r.status_code == 400, r.text)
r = c.post(BASIS + '/register', json={'redirect_uris': [CB], 'client_name': 'Sicherheitstest',
                                      'token_endpoint_auth_method': 'none'})
pruefe('DCR mit Claude-redirect_uri', r.status_code == 201, r.text)
client = r.json()
cid = client['client_id']


def pkce():
    v = secrets.token_urlsafe(48)
    return v, base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).decode().rstrip('=')


def login_req(ip='10.9.9.1'):
    v, ch = pkce()
    r = c.get(BASIS + '/authorize', params={'response_type': 'code', 'client_id': cid, 'redirect_uri': CB,
                                             'code_challenge': ch, 'code_challenge_method': 'S256',
                                             'state': 'st', 'resource': BASIS + '/mcp'},
              headers={'X-Forwarded-For': ip})
    assert r.status_code in (302, 307), r.text
    req = parse_qs(urlparse(r.headers['location']).query)['req'][0]
    return req, v


def login(req, pw, ip='10.9.9.1'):
    return c.post(BASIS + '/login', data={'req': req, 'password': pw}, headers={'X-Forwarded-For': ip})


# 2. authorize mit fremder redirect_uri
r = c.get(BASIS + '/authorize', params={'response_type': 'code', 'client_id': cid,
                                         'redirect_uri': 'https://evil.example/cb', 'code_challenge': 'x' * 43,
                                         'code_challenge_method': 'S256'})
pruefe('authorize lehnt fremde redirect_uri ab', r.status_code == 400 and 'location' not in r.headers, r.status_code)

# 3. authorize ohne PKCE
r = c.get(BASIS + '/authorize', params={'response_type': 'code', 'client_id': cid, 'redirect_uri': CB})
loc = r.headers.get('location', '')
pruefe('authorize ohne PKCE abgelehnt', 'error=' in loc or r.status_code == 400, (r.status_code, loc))

# 4. Login-Seite: CSP gesetzt
req, v = login_req()
r = c.get(BASIS + '/login', params={'req': req})
csp = r.headers.get('content-security-policy', '')
pruefe('Login-Seite mit CSP', "frame-ancestors 'none'" in csp and 'https://claude.ai' in csp, csp)

# 5. falsches Passwort → 401, Sperre nach 5 Versuchen je IP
for i in range(5):
    r = login(req, 'falsch-%d' % i, ip='10.9.9.66')
pruefe('Fehl-Login liefert 401', r.status_code == 401, r.status_code)
r = login(req, PW, ip='10.9.9.66')
pruefe('nach 5 Fehlversuchen gesperrt (auch mit richtigem PW)', r.status_code == 429, r.status_code)

# 6. andere IP: richtiges Passwort → Code
r = login(req, PW, ip='10.9.9.1')
pruefe('Login andere IP ok → 302 auf Claude', r.status_code == 302 and r.headers['location'].startswith(CB),
       r.status_code)
code = parse_qs(urlparse(r.headers['location']).query)['code'][0]

# 7. Token mit falschem PKCE-Verifier
r = c.post(BASIS + '/token', data={'grant_type': 'authorization_code', 'code': code, 'redirect_uri': CB,
                                   'client_id': cid, 'code_verifier': 'falsch' * 8})
pruefe('Token mit falschem code_verifier abgelehnt', r.status_code == 400, r.text)

# 8. richtiger Verifier
r = c.post(BASIS + '/token', data={'grant_type': 'authorization_code', 'code': code, 'redirect_uri': CB,
                                   'client_id': cid, 'code_verifier': v})
pruefe('Token mit richtigem code_verifier', r.status_code == 200, r.text)
tok = r.json()
pruefe('Access-Token 1 h', tok.get('expires_in') == 3600, tok.get('expires_in'))

# 9. Code nur einmal einlösbar
r = c.post(BASIS + '/token', data={'grant_type': 'authorization_code', 'code': code, 'redirect_uri': CB,
                                   'client_id': cid, 'code_verifier': v})
pruefe('Code kein zweites Mal', r.status_code == 400, r.text)

H = {'Authorization': 'Bearer ' + tok['access_token'], 'Content-Type': 'application/json',
     'Accept': 'application/json, text/event-stream'}
INIT = {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
        'params': {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 't', 'version': '1'}}}
r = c.post(BASIS + '/mcp', json=INIT, headers=H)
pruefe('/mcp mit Token → 200', r.status_code == 200, r.status_code)
r = c.post(BASIS + '/mcp', json=INIT, headers=dict(H, Authorization='Bearer quatsch'))
pruefe('/mcp mit falschem Token → 401', r.status_code == 401, r.status_code)
r = c.post(BASIS + '/mcp', json=INIT, headers=dict(H, Host='evil.example'))
pruefe('/mcp mit fremdem Host abgelehnt', r.status_code in (400, 421), r.status_code)

# 10. Refresh rotiert, Wiederverwendung sperrt die Familie
r = c.post(BASIS + '/token', data={'grant_type': 'refresh_token', 'refresh_token': tok['refresh_token'],
                                   'client_id': cid})
pruefe('Refresh → neues Paar', r.status_code == 200 and r.json()['refresh_token'] != tok['refresh_token'], r.text)
neu = r.json()
r = c.post(BASIS + '/mcp', json=INIT, headers=dict(H, Authorization='Bearer ' + neu['access_token']))
pruefe('neues Access-Token gilt', r.status_code == 200, r.status_code)
r = c.post(BASIS + '/token', data={'grant_type': 'refresh_token', 'refresh_token': tok['refresh_token'],
                                   'client_id': cid})
pruefe('altes Refresh-Token abgelehnt', r.status_code == 400, r.text)
r = c.post(BASIS + '/mcp', json=INIT, headers=dict(H, Authorization='Bearer ' + neu['access_token']))
pruefe('Wiederverwendung → ganze Familie gesperrt', r.status_code == 401, r.status_code)

# 11. revoke-all per CLI
req, v = login_req()
r = login(req, PW)
code = parse_qs(urlparse(r.headers['location']).query)['code'][0]
tok = c.post(BASIS + '/token', data={'grant_type': 'authorization_code', 'code': code, 'redirect_uri': CB,
                                     'client_id': cid, 'code_verifier': v}).json()
H2 = dict(H, Authorization='Bearer ' + tok['access_token'])
pruefe('frisches Token gilt', c.post(BASIS + '/mcp', json=INIT, headers=H2).status_code == 200)
env = dict(os.environ, DATA_DIR=DATA, V3DMCP_ENV='/nonexistent')
out = subprocess.run([os.path.expanduser('~/v3d-mail-mcp/bin/v3d-mail-mcp'), 'revoke-all'],
                     env=env, capture_output=True, text=True)
print('     CLI:', out.stdout.strip() or out.stderr.strip())
pruefe('nach revoke-all → 401', c.post(BASIS + '/mcp', json=INIT, headers=H2).status_code == 401)
r = c.post(BASIS + '/token', data={'grant_type': 'refresh_token', 'refresh_token': tok['refresh_token'],
                                   'client_id': cid})
pruefe('nach revoke-all Refresh ungültig', r.status_code == 400, r.text)

print('\nALLES GRÜN' if ok else '\nES GIBT FEHLER')
sys.exit(0 if ok else 1)
