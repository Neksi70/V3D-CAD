"""Einstellungen aus ~/v3d-mail-mcp/.env (Rechte 600). Umgebungsvariablen,
die schon gesetzt sind, gewinnen — so können Tests eine eigene Instanz fahren.
"""
import os

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.environ.get('V3DMCP_ENV') or os.path.join(APP_DIR, '.env')


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


ISSUER_URL = (os.environ.get('ISSUER_URL') or 'https://mcp.volme3dakademie.de').rstrip('/')
RESOURCE_URL = ISSUER_URL + '/mcp'
BIND_HOST = os.environ.get('BIND_HOST') or '127.0.0.1'
PORT = int(os.environ.get('PORT') or 8802)
DATA_DIR = os.path.expanduser(os.environ.get('DATA_DIR') or '~/.local/share/v3d-mail-mcp')


def passwort_hash():
    """Bei jedem Login frisch aus der .env — set-password wirkt ohne Neustart."""
    if os.environ.get('V3DMCP_TEST_HASH'):
        return os.environ['V3DMCP_TEST_HASH']
    return env_lesen().get('LOGIN_PASSWORD_HASH', '')

# Erlaubte Rücksprung-Adressen nach dem Login. Fest: nur Claude.
REDIRECT_URIS = ['https://claude.ai/api/mcp/auth_callback',
                 'https://claude.com/api/mcp/auth_callback'] + _liste('EXTRA_REDIRECT_URIS')

# Host-Kopfzeilen, die der Dienst annimmt (Schutz gegen DNS-Rebinding).
ALLOWED_HOSTS = _liste('ALLOWED_HOSTS', 'mcp.volme3dakademie.de,127.0.0.1:*,localhost:*')

ACCESS_TTL = 3600               # 1 h
REFRESH_TTL = 30 * 86400        # 30 Tage, rotierend
SCOPE = 'mail'

# Sperren nach Fehl-Logins
FAIL_MAX_IP = 5                 # je IP …
FAIL_MAX_GLOBAL = 10            # … und insgesamt (ein einziger Benutzer)
FAIL_WINDOW = 3600
LOCK_SECONDS = 15 * 60
MAX_CLIENTS = 50                # Deckel für Dynamic Client Registration
