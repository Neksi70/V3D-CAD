"""V3D Notebook-Agent auf Volkers Notebook (DESKTOP-T4DI2AS) — Dateien laden, Befehle, Programme.

Gegenstück: notebook-agent/agent.js (Node, Aufgabenplanung „bei Anmeldung“, höchste Rechte),
eingerichtet mit ~/Ablage/v3d-notebook-agent-einrichten.ps1. Weg: V3DA → Tailscale →
NOTEBOOK_AGENT_URL (Standard http://100.79.71.92:8933), Firewall dort nur für 100.125.34.44.

Token: entsteht beim Einrichten auf dem Notebook (das Skript liegt öffentlich in der Ablage und
darf ihn nicht enthalten). Fehlt er hier oder passt er nicht mehr, holt _token() ihn einmalig per
POST /kopplung (nur ungekoppelt und ≤ 24 h nach dem Einrichten) und schreibt ihn als
NOTEBOOK_AGENT_TOKEN in die .env (Rechte 600).

netcup kappt Antworten nach 180 s → download/winget warten höchstens WARTEN s; läuft es länger,
kommt status „laeuft“, und derselbe Aufruf holt das Ergebnis später ab.
"""
import json
import os
import re
import socket
import threading
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from . import settings
from .core import MailError

URL = (os.environ.get('NOTEBOOK_AGENT_URL') or 'http://100.79.71.92:8933').rstrip('/')
WARTEN = 150
MAX_BEFEHL = 150
_lock = threading.Lock()


class NotebookFehler(MailError):
    """Wird von app.werkzeug als lesbare Fehlermeldung ausgegeben."""


def _erreichbar():
    u = urlsplit(URL)
    try:
        socket.create_connection((u.hostname, u.port or 80), timeout=4).close()
    except OSError:
        raise NotebookFehler('Notebook nicht erreichbar (%s:%s) — ist es an, mit Tailscale verbunden und '
                             'Volker angemeldet? Der Agent startet erst bei der Windows-Anmeldung (noch nie eingerichtet? '
                             '~/Ablage/v3d-notebook-agent-einrichten.ps1 im Admin-PowerShell).'
                             % (u.hostname, u.port)) from None


def _env_setzen(name, wert):
    pfad = settings.ENV_FILE
    try:
        with open(pfad, encoding='utf-8') as fh:
            zeilen = fh.read().splitlines()
    except FileNotFoundError:
        zeilen = []
    zeilen = [z for z in zeilen if not z.startswith(name + '=')] + ['%s=%s' % (name, wert)]
    neu = pfad + '.neu'
    fd = os.open(neu, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(zeilen) + '\n')
    os.replace(neu, pfad)
    os.environ[name] = wert


def _post(pfad, daten, timeout, token=None):
    kopf = {'Content-Type': 'application/json'}
    if token:
        kopf['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(URL + pfad, data=json.dumps(daten).encode(), method='POST', headers=kopf)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'{}')
        except ValueError:
            return e.code, {'fehler': 'HTTP %s' % e.code}
    except (TimeoutError, socket.timeout):
        raise NotebookFehler('Keine Antwort vom Notebook innerhalb von %d s' % timeout) from None
    except urllib.error.URLError as e:
        raise NotebookFehler('Notebook nicht erreichbar: %s' % e.reason) from None


def _koppeln():
    code, daten = _post('/kopplung', {}, 15)
    if code != 200 or not daten.get('token'):
        raise NotebookFehler('Kein gültiger Token für den Notebook-Agenten und Kopplung abgelehnt (%s). '
                             'Volker muss das Einrichtungsskript auf dem Notebook erneut ausführen.'
                             % daten.get('fehler', code))
    _env_setzen('NOTEBOOK_AGENT_TOKEN', daten['token'])
    return daten['token']


def _token():
    # frisch aus der .env (wie passwort_hash), Umgebung nur als Rückfall für Tests
    return settings.env_lesen().get('NOTEBOOK_AGENT_TOKEN') or os.environ.get('NOTEBOOK_AGENT_TOKEN') or ''


def rufe(aktion, daten, timeout):
    _erreichbar()
    with _lock:
        token = _token() or _koppeln()
    code, antwort = _post('/' + aktion, daten, timeout, token)
    if code == 401:                       # Skript neu ausgeführt → neuer Token
        with _lock:
            token = _koppeln()
        code, antwort = _post('/' + aktion, daten, timeout, token)
    if code != 200:
        raise NotebookFehler(antwort.get('fehler') or 'HTTP %s' % code)
    return antwort


def status():
    _erreichbar()
    with _lock:
        token = _token() or _koppeln()
    req = urllib.request.Request(URL + '/status', headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def download(url, ordner, entpacken):
    if not re.match(r'^https?://', url or '', re.I):
        raise NotebookFehler('Nur http(s)-Adressen')
    return rufe('download', {'url': url, 'ordner': ordner, 'entpacken': entpacken, 'warten': WARTEN}, WARTEN + 20)


def befehl(powershell, timeout, ordner):
    timeout = max(1, min(int(timeout or 120), MAX_BEFEHL))
    return rufe('befehl', {'powershell': powershell, 'timeout': timeout, 'ordner': ordner}, timeout + 20)


def starten(pfad, argumente):
    r = rufe('starten', {'pfad': pfad, 'argumente': argumente}, 75)
    # PowerShell 5.1 macht aus $null in ConvertTo-Json ein {} → leere Felder weglassen
    return {k: v for k, v in r.items() if v not in ({}, [], None, '')}


def dateien(pfad, anzahl):
    return rufe('dateien', {'pfad': pfad, 'max': anzahl}, 30)


def winget(paket_id):
    return rufe('winget', {'paket_id': paket_id, 'warten': WARTEN}, WARTEN + 20)
