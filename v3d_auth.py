#!/usr/bin/env python3
"""Serverseitige Anmeldung fuer V3D CAD.

Bisher war das Login-Fenster reine Kosmetik: die komplette App wurde an jeden
ausgeliefert, der die URL kannte, und ein beliebiges "?sitzung=irgendwas"
liess das Overlay gar nicht erst aufgehen. Auf einer oeffentlichen Domain ist
das kein Schutz.

Hier passiert deshalb dreierlei:
  1. Firebase-ID-Token pruefen (RS256 gegen Googles oeffentliche Zertifikate,
     lokal — kein Admin-SDK, keine neue Abhaengigkeit: PyJWT + cryptography
     sind bereits im System-Python).
  2. Daraus ein eigenes, HMAC-signiertes Sitzungs-Cookie machen. Das Cookie
     traegt der Browser auch bei einer normalen Seitennavigation mit — ein
     Authorization-Header koennte das nicht, und genau die Navigation ist es,
     die die App-HTML holt.
  3. Gaeste einer gemeinsamen Sitzung (?sitzung=<id>) bekommen ein eigenes,
     schwaecheres Gast-Cookie — aber nur, wenn die Sitzungs-ID in Firestore
     wirklich existiert und nicht abgelaufen ist. Erfundene IDs fliegen raus.
"""

import os
import json
import time
import hmac
import base64
import hashlib
import threading
import urllib.error
import urllib.request

import jwt
from cryptography.x509 import load_pem_x509_certificate

PROJECT_ID = 'volme3d'
ISSUER = 'https://securetoken.google.com/' + PROJECT_ID
CERT_URL = ('https://www.googleapis.com/robot/v1/metadata/x509/'
            'securetoken@system.gserviceaccount.com')
FS_DOC = ('https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
          '/databases/(default)/documents/sessions/')

COOKIE_NAME = 'v3dsess'
SESSION_TTL = 14 * 24 * 3600    # angemeldeter Nutzer: 14 Tage
GUEST_TTL = 12 * 3600           # Gast einer gemeinsamen Sitzung: 12 Stunden
CERT_TTL = 6 * 3600             # Googles Zertifikate wechseln taeglich
SECRET_FILE = os.path.expanduser('~/.config/volme3d/session_secret')

_certs = {'ts': 0.0, 'keys': {}}
_cert_lock = threading.Lock()
_secret_cache = [None]


# ── Cookie-Signatur ───────────────────────────────────────────────────

def _secret():
    """HMAC-Schluessel fuer die Sitzungs-Cookies. Beim ersten Start erzeugt.

    Liegt bewusst NICHT im Repo: geht die Datei verloren, sind nur alle
    Sitzungen ungueltig — jeder meldet sich einmal neu an, sonst nichts.
    """
    if _secret_cache[0]:
        return _secret_cache[0]
    try:
        with open(SECRET_FILE, 'rb') as f:
            data = f.read().strip()
        if len(data) >= 32:
            _secret_cache[0] = data
            return data
    except OSError:
        pass
    data = base64.urlsafe_b64encode(os.urandom(48))
    os.makedirs(os.path.dirname(SECRET_FILE), exist_ok=True)
    fd = os.open(SECRET_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(data)
    _secret_cache[0] = data
    return data


def _b64e(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def _b64d(txt):
    pad = '=' * (-len(txt) % 4)
    return base64.urlsafe_b64decode(txt + pad)


def make_cookie(uid, email='', guest=False, ttl=None):
    """Signiertes Sitzungs-Cookie: base64(payload).base64(hmac)."""
    if ttl is None:
        ttl = GUEST_TTL if guest else SESSION_TTL
    payload = {'u': uid, 'e': email or '', 'g': 1 if guest else 0,
               'x': int(time.time()) + ttl}
    body = _b64e(json.dumps(payload, separators=(',', ':')).encode())
    sig = hmac.new(_secret(), body.encode(), hashlib.sha256).digest()
    return body + '.' + _b64e(sig)


def read_cookie(value):
    """Cookie pruefen -> Payload-dict oder None (ungueltig/abgelaufen)."""
    if not value or '.' not in value:
        return None
    body, _, sig = value.partition('.')
    want = hmac.new(_secret(), body.encode(), hashlib.sha256).digest()
    try:
        if not hmac.compare_digest(want, _b64d(sig)):
            return None
        data = json.loads(_b64d(body))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or data.get('x', 0) < time.time():
        return None
    return data


# ── Firebase-ID-Token ─────────────────────────────────────────────────

def _google_keys():
    """Googles Signaturzertifikate, 6 h gecacht. {} wenn nicht erreichbar."""
    now = time.time()
    if _certs['keys'] and now - _certs['ts'] < CERT_TTL:
        return _certs['keys']
    with _cert_lock:
        if _certs['keys'] and time.time() - _certs['ts'] < CERT_TTL:
            return _certs['keys']
        try:
            with urllib.request.urlopen(CERT_URL, timeout=10) as r:
                raw = json.loads(r.read())
            keys = {}
            for kid, pem in raw.items():
                cert = load_pem_x509_certificate(pem.encode())
                keys[kid] = cert.public_key()
            _certs['keys'] = keys
            _certs['ts'] = time.time()
        except Exception as e:
            # Alte Schluessel weiterbenutzen ist besser als alle auszusperren,
            # nur weil Google gerade kurz nicht antwortet.
            print('[auth] Zertifikate nicht abrufbar:', e, flush=True)
        return _certs['keys']


def verify_id_token(token):
    """Firebase-ID-Token pruefen -> Claims-dict oder None."""
    if not token or token.count('.') != 2:
        return None
    try:
        kid = jwt.get_unverified_header(token).get('kid')
    except Exception:
        return None
    keys = _google_keys()
    key = keys.get(kid)
    if key is None:
        # Unbekannte kid: evtl. frisch rotiert -> Cache verwerfen, einmal neu.
        _certs['ts'] = 0
        key = _google_keys().get(kid)
    if key is None:
        return None
    try:
        claims = jwt.decode(token, key=key, algorithms=['RS256'],
                            audience=PROJECT_ID, issuer=ISSUER, leeway=30)
    except Exception:
        return None
    if not claims.get('sub'):
        return None
    return claims


# ── Gemeinsame Sitzungen ──────────────────────────────────────────────

def session_alive(sid):
    """Existiert die Sitzung <sid> und laeuft sie noch?

    Die Firestore-Regeln geben unangemeldeten Lesern nur nicht-abgelaufene
    Sitzungen heraus (siehe firestore.rules) — ein 200 genuegt uns deshalb
    als Beweis. Alles andere, auch ein Netzfehler, gilt als "nein".
    """
    if not sid or len(sid) > 128 or not sid.replace('-', '').replace('_', '').isalnum():
        return False
    try:
        with urllib.request.urlopen(FS_DOC + sid, timeout=8) as r:
            if r.status != 200:
                return False
            doc = json.loads(r.read())
    except (urllib.error.URLError, urllib.error.HTTPError, ValueError, OSError):
        return False
    # Doppelter Boden: Ablauf selbst nachrechnen, falls die Regeln je lockern.
    try:
        exp = int(doc['fields']['expiresAt']['integerValue'])
        return exp > time.time() * 1000
    except (KeyError, TypeError, ValueError):
        return bool(doc.get('fields'))
