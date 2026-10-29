"""Vierte Quelle: Update-Schnittstellen einzelner Hersteller.

Manche Hersteller geben keinen festen Download-Link heraus, sondern erzeugen
bei jedem Klick einen frisch signierten (nur Stunden gueltigen). Deshalb findet
weder winget noch Chocolatey noch die Netzsuche etwas Dauerhaftes. Fuer solche
Programme fragt V3DA die Schnittstelle direkt – bei jedem Herunterladen neu.

Jeder Eintrag liefert: name, version, url (frisch), datei, hash (algo, wert).
"""
import json
import re
import urllib.parse
import urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) V3D-Setup'}


def _json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))


def cricut():
    api = 'https://apis.cricut.com/desktopdownload/'
    info = _json(_json(api + 'UpdateJson?operatingSystem=win32native&shard=a')['result'])
    datei = info['latestInstallFile']
    url = _json(api + 'InstallerFile?shard=a&operatingSystem=win32native&fileName=' + urllib.parse.quote(datei))['result']
    return {'name': 'Cricut Design Space', 'version': info['latestVersion'], 'url': url, 'datei': datei,
            'hash': ('sha512', (info.get('latestUpdateFileHash') or '').lower()) if info.get('latestUpdateFile') == datei else None,
            'seite': 'https://design.cricut.com/'}


# id -> (Abfrage, Erkennungsmuster fuer den Programmnamen im Inventar)
HERSTELLER = {
    'herst.cricut': (cricut, re.compile(r'^cricut design space', re.I)),
}


def erkennen(name):
    for pid, (_, muster) in HERSTELLER.items():
        if muster.search(name or ''):
            return pid
    return None


def abfragen(pid):
    return HERSTELLER[pid][0]()
