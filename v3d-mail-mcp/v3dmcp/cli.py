"""Kommandozeile: serve | set-password | revoke-all | status"""
import getpass
import os
import re
import sys

from . import settings


def set_password():
    from argon2 import PasswordHasher
    if not sys.stdin.isatty():
        sys.exit('set-password braucht ein Terminal (Passwort wird ohne Echo abgefragt).')
    pw = getpass.getpass('Neues Login-Passwort für den Claude-Connector: ')
    if len(pw) < 12:
        sys.exit('Zu kurz — mindestens 12 Zeichen.')
    if getpass.getpass('Wiederholen: ') != pw:
        sys.exit('Stimmt nicht überein, nichts geändert.')
    hashwert = PasswordHasher().hash(pw)
    zeilen = []
    if os.path.exists(settings.ENV_FILE):
        with open(settings.ENV_FILE, encoding='utf-8') as fh:
            zeilen = [z for z in fh.read().splitlines() if not re.match(r'\s*LOGIN_PASSWORD_HASH\s*=', z)]
    zeilen.append("LOGIN_PASSWORD_HASH='%s'" % hashwert)
    tmp = settings.ENV_FILE + '.tmp'
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(zeilen) + '\n')
    os.replace(tmp, settings.ENV_FILE)
    from . import audit
    audit.log('password_set')
    print('Passwort gesetzt (argon2-Hash in %s). Gilt sofort, kein Neustart nötig.' % settings.ENV_FILE)


def revoke_all():
    from . import audit, store
    n = store.alles_widerrufen()
    audit.log('revoke_all', tokens=n)
    print('%d Token widerrufen. Claude muss sich neu verbinden (Passwort-Login).' % n)


def status():
    from . import store
    print('Issuer:     ', settings.ISSUER_URL)
    print('Endpunkt:   ', settings.RESOURCE_URL)
    print('Lauscht auf:', '%s:%d' % (settings.BIND_HOST, settings.PORT))
    print('Passwort:   ', 'gesetzt' if settings.passwort_hash() else 'FEHLT (set-password)')
    print('Clients:    ', store.client_anzahl())
    print('Tokens:     ', store.token_anzahl() or 'keine')


def main():
    befehl = sys.argv[1] if len(sys.argv) > 1 else ''
    if befehl == 'serve':
        from .app import serve
        serve()
    elif befehl == 'set-password':
        set_password()
    elif befehl == 'revoke-all':
        revoke_all()
    elif befehl == 'status':
        status()
    else:
        sys.exit('Aufruf: v3d-mail-mcp serve | set-password | revoke-all | status')
