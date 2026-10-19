"""Einstellungen aus ~/v3d-cad-connector/.env (Rechte 600). Umgebungsvariablen,
die schon gesetzt sind, gewinnen — so können Tests eine eigene Instanz fahren.
"""
import os

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.environ.get('V3DCAD_ENV') or os.path.join(APP_DIR, '.env')


def env_lesen(pfad=ENV_FILE):
    werte = {}
    try:
        with open(pfad, encoding='utf-8') as fh:
            for zeile in fh:
                zeile = zeile.strip()
                if not zeile or zeile.startswith('#') or '=' not in zeile:
                    continue
                k, v = zeile.split('=', 1)
                v = v.strip()
                if len(v) >= 2 and v[0] == v[-1] and v[0] in '"\'':
                    v = v[1:-1]
                werte[k.strip()] = v
    except FileNotFoundError:
        pass
    return werte


for _k, _v in env_lesen().items():
    os.environ.setdefault(_k, _v)


def _liste(name, standard=''):
    return [x.strip() for x in (os.environ.get(name) or standard).split(',') if x.strip()]


# Öffentliche Adresse: der Connector hängt unter /cad-mcp am selben Host wie V3D CAD —
# so sieht die Anmeldeseite das V3D-CAD-Sitzungs-Cookie und braucht kein eigenes Passwort.
ISSUER_URL = (os.environ.get('ISSUER_URL') or 'https://v3dcad.volme3dakademie.de/cad-mcp').rstrip('/')
RESOURCE_URL = ISSUER_URL + '/mcp'
# Öffentlicher Ursprung von V3D CAD (für die Weiterleitung zur Anmeldung)
CAD_PUBLIC = (os.environ.get('CAD_PUBLIC') or ISSUER_URL.rsplit('/', 1)[0]).rstrip('/')
# Interne Adressen auf diesem Rechner
CAD_URL = (os.environ.get('CAD_URL') or 'http://127.0.0.1:8765').rstrip('/')    # volme3d_server.py (/auth/me)
HUB_URL = (os.environ.get('HUB_URL') or 'http://127.0.0.1:8830').rstrip('/')    # Agent-Hub (/live/*)
BIND_HOST = os.environ.get('BIND_HOST') or '127.0.0.1'
PORT = int(os.environ.get('PORT') or 8840)
DATA_DIR = os.path.expanduser(os.environ.get('DATA_DIR') or '~/.local/share/v3d-cad-connector')

# Nur zum Testen: festes Konto statt Sitzungs-Prüfung (nie in Produktion setzen)
TEST_SUBJECT = os.environ.get('V3DCAD_TEST_SUBJECT', '')

# Erlaubte Rücksprung-Adressen nach dem Login. Fest: nur Claude.
REDIRECT_URIS = ['https://claude.ai/api/mcp/auth_callback',
                 'https://claude.com/api/mcp/auth_callback'] + _liste('EXTRA_REDIRECT_URIS')

# Host-Kopfzeilen, die der Dienst annimmt (Schutz gegen DNS-Rebinding).
ALLOWED_HOSTS = _liste('ALLOWED_HOSTS', 'v3dcad.volme3dakademie.de,v3da.tailf05fe9.ts.net,127.0.0.1:*,localhost:*')

ACCESS_TTL = 3600               # 1 h
REFRESH_TTL = 30 * 86400        # 30 Tage, rotierend
SCOPE = 'cad'
MAX_CLIENTS = 2000              # Deckel für Dynamic Client Registration (viele Nutzer)
