"""Kommandozeile: serve | revoke-all | status"""
import sys

from . import settings


def revoke_all():
    from . import audit, store
    n = store.alles_widerrufen()
    audit.log('revoke_all', tokens=n)
    print('%d Token widerrufen. Alle Nutzer müssen den Connector in Claude neu verbinden.' % n)


def status():
    from . import store
    print('Issuer:     ', settings.ISSUER_URL)
    print('Endpunkt:   ', settings.RESOURCE_URL)
    print('Lauscht auf:', '%s:%d' % (settings.BIND_HOST, settings.PORT))
    print('V3D CAD:    ', settings.CAD_URL, '| Hub:', settings.HUB_URL)
    print('Clients:    ', store.client_anzahl())
    print('Tokens:     ', store.token_anzahl() or 'keine')


def main():
    befehl = sys.argv[1] if len(sys.argv) > 1 else ''
    if befehl == 'serve':
        from .app import serve
        serve()
    elif befehl == 'revoke-all':
        revoke_all()
    elif befehl == 'status':
        status()
    else:
        sys.exit('Aufruf: v3d-cad-connector serve | revoke-all | status')
