#!/usr/bin/env python3
"""Ablauf-Test gegen einen laufenden Server (Standard: Testport 18819).
Simuliert, was V3D-Setup.ps1 auf Windows tut. Laedt echte, kleine Installer
(7-Zip, Notepad++) aus dem Internet. Nicht gegen die echten Daten laufen lassen.

  V3DSETUP_NETZ=0 V3DSETUP_DATEN=/tmp/x V3DSETUP_PORT=18819 python3 server.py &
  python3 test_ablauf.py
"""
import hashlib
import json
import os
import sys
import time
import urllib.request

B = os.environ.get('BASIS', 'http://127.0.0.1:18819')


def req(pfad, daten=None, methode=None, roh=None):
    body = roh if roh is not None else (json.dumps(daten).encode() if daten is not None else None)
    r = urllib.request.Request(B + pfad, data=body, method=methode or ('POST' if body is not None else 'GET'))
    if daten is not None:
        r.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(r, timeout=300) as a:
        inhalt = a.read()
    try:
        return json.loads(inhalt)
    except ValueError:
        return inhalt


def pruefe(bed, text):
    print(('OK   ' if bed else 'FEHL ') + text)
    if not bed:
        pruefe.fehler += 1


pruefe.fehler = 0

# 1) Inventar wie vom Windows-Skript (mit UTF-8-BOM wie PowerShell es manchmal schickt)
inv = {'host': 'ALT-PC', 'os': 'Windows 11 Pro 10.0.26100', 'modell': 'Dell XPS 15',
       'programme': [
           {'name': '7-Zip 24.08 (x64)', 'version': '24.08', 'publisher': 'Igor Pavlov', 'key': '7-Zip', 'scope': 'Rechner 64-Bit'},
           {'name': 'Notepad++ (64-bit x64)', 'version': '8.6', 'publisher': 'Notepad++ Team', 'key': 'Notepad++', 'scope': 'Rechner 64-Bit'},
           {'name': 'Microsoft Edge', 'version': '130', 'publisher': 'Microsoft', 'key': 'Microsoft Edge', 'scope': 'Rechner 32-Bit'},
           {'name': 'Hausinterne Software Müller', 'version': '1.0', 'publisher': 'ich', 'key': 'xyz', 'scope': 'Benutzer'},
       ],
       'winget_ids': ['VideoLAN.VLC', '7zip.7zip']}
r = req('/api/inventar', roh=b'\xef\xbb\xbf' + json.dumps(inv, ensure_ascii=False).encode())
pruefe(r.get('ok') and '#inv=' in r['link'], 'Inventar angenommen: ' + r['datei'])
v = req('/api/inventar?datei=' + r['datei'])
ids = {p['name']: p.get('id') for p in v['programme']}
pruefe(ids['7-Zip 24.08 (x64)'] == '7zip.7zip', '7-Zip erkannt')
pruefe(ids['Notepad++ (64-bit x64)'] == 'Notepad++.Notepad++', 'Notepad++ erkannt')
pruefe(ids['Hausinterne Software Müller'] is None, 'Eigenes Programm nicht erkannt (Umlaut ok)')
pruefe(any(p['id'] == 'VideoLAN.VLC' for p in v['programme']), 'VLC aus winget export ergaenzt')
pruefe([p for p in v['programme'] if p['name'] == 'Microsoft Edge'][0]['windows'], 'Edge als Windows-Teil markiert')
pruefe(sum(1 for p in v['programme'] if p.get('id') == '7zip.7zip') == 1, '7-Zip nicht doppelt (export + Registry)')

# 2) Abhaken + manuelle Zuordnung
req('/api/zuordnung', {'name': 'Hausinterne Software Müller', 'id': 'Gyan.FFmpeg'})
v = req('/api/inventar?datei=' + r['datei'])
pruefe([p for p in v['programme'] if p['name'].startswith('Hausintern')][0]['id'] == 'Gyan.FFmpeg', 'manuelle Zuordnung greift')
req('/api/zuordnung', {'name': 'Hausinterne Software Müller', 'id': None})
p = req('/api/profil?name=test', {'aktion': 'setzen', 'pakete': [
    {'id': '7zip.7zip', 'name': '7-Zip', 'an': True, 'aus': 'ALT-PC'},
    {'id': 'Notepad++.Notepad++', 'name': 'Notepad++', 'an': True}]})
pruefe(len(p['pakete']) == 2, 'Liste hat 2 Pakete')

# 3) eigener Installer
eig = req('/api/eigen?name=Hausinterne%20Software&datei=setup.exe&args=%2Fsilent&profil=test', roh=b'MZ' + b'\0' * 1000)
pruefe(eig['args'] == '/silent' and eig['id'] == 'eigen.hausinterne-software', 'eigener Installer im Depot')

# 4) Depot laden (echter Download)
req('/api/laden?name=test', {})
for _ in range(240):
    j = req('/api/job')
    if not j['laeuft']:
        break
    time.sleep(1)
print('\n'.join('     ' + z for z in j['log']))
pl = req('/api/plan?profil=test')
pakete = {x['id']: x for x in pl['pakete']}
pruefe(set(pakete) == {'7zip.7zip', 'Notepad++.Notepad++', 'eigen.hausinterne-software'}, 'Plan enthaelt alle 3')
for pid in ('7zip.7zip', 'Notepad++.Notepad++', 'eigen.hausinterne-software'):
    x = pakete[pid]
    pruefe(x['url'] and x['args'] is not None and not x.get('problem'), f'{pid}: {x.get("typ")} "{x.get("args")}" {x.get("version")}')
    daten = req('/' + x['url'].split('/', 3)[3])
    pruefe(hashlib.sha256(daten).hexdigest() == x['sha256'], f'{pid}: Download vom Depot, Pruefsumme stimmt ({len(daten)} B)')

# zweiter Lauf laedt nicht erneut
req('/api/laden?name=test', {})
while req('/api/job')['laeuft']:
    time.sleep(0.5)
pruefe(any('aktuell' in z for z in req('/api/job')['log']), 'zweiter Lauf: schon aktuell')

# 5) Parameter ueberschreiben
req('/api/profil?name=test', {'aktion': 'args', 'id': '7zip.7zip', 'args': '/S /D=C:\\7z'})
pruefe(req('/api/plan?profil=test')['pakete'][0]['args'] in ('/S /D=C:\\7z',) or
       any(x['args'] == '/S /D=C:\\7z' for x in req('/api/plan?profil=test')['pakete']), 'eigene Parameter im Plan')

# 6) Treiber hoch + Liste + runter
zipdaten = b'PK\x05\x06' + b'\0' * 18
t = req('/api/treiber?host=ALT-PC&name=20261029-120000&anzahl=42&modell=Dell%20XPS%2015', roh=zipdaten, methode='PUT')
pruefe(t['ok'] and t['groesse'] == len(zipdaten), 'Treiber-ZIP hochgeladen')
tl = req('/api/treiber')
pruefe(tl and tl[0]['modell'] == 'Dell XPS 15' and tl[0]['anzahl'] == '42', 'Treiberliste mit Modell')
pruefe(req('/treiber/ALT-PC/20261029-120000.zip') == zipdaten, 'Treiber-ZIP herunterladbar')
try:
    req('/treiber/../server.py')
    pruefe(False, 'Pfad-Ausbruch abgewehrt')
except urllib.error.HTTPError as e:
    pruefe(e.code in (403, 404), 'Pfad-Ausbruch abgewehrt')

# 7) Skripte
ps = req('/V3D-Setup.ps1')
pruefe(ps[:3] == b'\xef\xbb\xbf' and b'__SERVER__' not in ps and b'\r\n' in ps, 'PS1 mit BOM, CRLF, Server eingesetzt')
pruefe(req('/s')[:3] != b'\xef\xbb\xbf', 'Einzeiler-Variante ohne BOM')
cmd = req('/V3D-Setup.cmd')
pruefe(b'__SERVER__' not in cmd and b'\r\n' in cmd, 'CMD mit CRLF + Server')

print('\nFehler:', pruefe.fehler)
sys.exit(1 if pruefe.fehler else 0)
