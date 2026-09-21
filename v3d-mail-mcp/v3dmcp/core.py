"""Brücke zur vorhandenen V3D-Mail-Serverlogik.

Es gibt KEIN zweites Mailsystem: Konten, IMAP-Verbindung, Ordnererkennung,
Nachrichtenaufbau, SMTP-Versand und CalDAV kommen unverändert aus
~/volmemail/server.py. Dieses Modul lädt die Datei unter eigenem Namen (damit
sie nicht mit anderen "server"-Modulen kollidiert) und reicht sie weiter.

Die Konten (inkl. Passwörter) liest volmemail beim Import aus
~/.config/v3dmail/config.json — sie verlassen diesen Prozess nie.
"""
import importlib.util
import os
import sys

VOLMEMAIL_DIR = os.environ.get('VOLMEMAIL_DIR') or os.path.expanduser('~/volmemail')


def _lade():
    name = 'v3dmail_core'
    if name in sys.modules:
        return sys.modules[name]
    pfad = os.path.join(VOLMEMAIL_DIR, 'server.py')
    spec = importlib.util.spec_from_file_location(name, pfad)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


vm = _lade()
MailError = vm.MailError
