#!/usr/bin/env python3
"""V3D Setup – Neuinstallation von Windows-Rechnern vorbereiten.

Inventar eines Rechners ansehen, Programme fuer die naechste Installation
abhaken, Installer auf V3DA laden (Depot) und von dort silent installieren.
Dazu Treiber-Sicherungen je Rechner. Nur Heimnetz/Tailnet, nicht im Funnel.
"""
import hashlib
import json
import os
import re
import shutil
import sys
import threading
import time
import traceback
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from choco import Choco
import hersteller
from netzsuche import Netzsuche, anzeigename, schluessel
from katalog import ALIAS, Katalog, UA, normname, woerter, zerlegt

HIER = Path(__file__).resolve().parent
DATEN = Path(os.environ.get('V3DSETUP_DATEN', HIER / 'daten'))
PORT = int(os.environ.get('V3DSETUP_PORT', '8819'))
for d in ('inventare', 'profile', 'depot', 'treiber', 'katalog', 'rechner', 'notfall'):
    (DATEN / d).mkdir(parents=True, exist_ok=True)

KATALOG = Katalog(DATEN / 'katalog')
CHOCO = Choco(DATEN / 'katalog')
NETZ = Netzsuche(DATEN / 'katalog')
VORSCHLAG_LAEUFT = set()
LOCK = threading.Lock()
JOB = {'laeuft': False, 'log': [], 'fertig': 0, 'gesamt': 0, 'profil': None}

WINDOWS_TEIL = re.compile(
    r'^(Microsoft Edge|Microsoft OneDrive|Microsoft Update Health Tools|Windows |Update for |'
    r'Microsoft \.NET (Host|Runtime|AppHost)|Microsoft Windows Desktop Runtime|Microsoft ASP\.NET Core|'
    r'Microsoft GameInput|Microsoft Teams Meeting Add-in|Teams Machine-Wide|Microsoft Intune|'
    r'Realtek |Intel\(R\) |Intel® |AMD Software|NVIDIA (Grafiktreiber|Graphics Driver|HD-Audio|PhysX|FrameView|USBC)|'
    r'Windows-Treiberpaket|Windows Driver Package|Mozilla Maintenance Service|Microsoft Windows Application Compatibility)'
    r'|.*(Printer Uninstall|Drucker deinstallieren)$', re.I)


def sicher(name):
    return re.sub(r'[^A-Za-z0-9._+-]', '_', name)[:120] or '_'


def lies(p, standard=None):
    try:
        return json.loads(Path(p).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return standard


def schreib(p, daten):
    p = Path(p)
    tmp = p.with_suffix(p.suffix + '.tmp')
    tmp.write_text(json.dumps(daten, ensure_ascii=False, indent=1), encoding='utf-8')
    tmp.replace(p)


# ---------------- Profile (die abgehakte Liste) ----------------
def profil_pfad(name):
    return DATEN / 'profile' / (sicher(name or 'standard') + '.json')


def profil(name):
    return lies(profil_pfad(name), {'name': name or 'standard', 'pakete': {}})


def profil_namen():
    namen = sorted(p.stem for p in (DATEN / 'profile').glob('*.json'))
    return namen or ['standard']


def depot_info(pid):
    return lies(DATEN / 'depot' / sicher(pid) / 'info.json')


def reihenfolge(pid):
    p = pid.lower()
    # Laufzeitumgebungen zuerst, damit Programme sie vorfinden
    return (0 if any(w in p for w in ('vcredist', 'dotnet', 'directx', 'java', 'temurin')) else 1, p)


def profil_ansicht(name):
    pr = profil(name)
    liste = []
    for pid, e in sorted(pr['pakete'].items(), key=lambda kv: reihenfolge(kv[0])):
        d = depot_info(pid)
        liste.append({**e, 'id': pid, 'depot': d})
    return {'name': pr['name'], 'pakete': liste}


# ---------------- Inventare ----------------
def zuordnungen():
    return lies(DATEN / 'zuordnung.json', {})


def vorschlaege_berechnen(datei):
    """Fuer nicht erkannte Programme Kandidaten suchen: winget unscharf, dann Chocolatey.
    Laeuft im Hintergrund (Chocolatey ist ein Web-Dienst), Ergebnis landet im Inventar."""
    pfad = DATEN / 'inventare' / sicher(datei)
    try:
        inv = lies(pfad)
        progs = inv.get('programme') or []
        auto = KATALOG.zuordnen(progs)
        manuell = zuordnungen()
        erg = {}
        rest = []
        for p, a in zip(progs, auto):
            if a or normname(p.get('name')) in manuell or WINDOWS_TEIL.match(p.get('name') or ''):
                continue
            name = p.get('name') or ''
            alias = hersteller.erkennen(name) or next((ziel for muster, ziel in ALIAS if muster.search(name)), None)
            if alias:
                erg[name] = [{'id': alias, 'name': name, 'sicher': True,
                              'quelle': 'hersteller' if alias.startswith('herst.') else 'choco' if alias.startswith('choco:') else 'winget'}]
                continue
            kand = [dict(k, quelle='winget') for k in KATALOG.unscharf(p)]
            if not any(k['sicher'] for k in kand):
                toks = woerter(name)
                teile = [w for w in zerlegt(name) if w not in toks]
                treffer = CHOCO.kandidaten(toks) + (CHOCO.kandidaten(teile) if teile else [])
                quellen = [{'id': 'choco:' + r['id'], 'name': r['name']} for r in treffer]
                kand += [dict(k, quelle='choco') for k in KATALOG.unscharf(p, quellen=quellen)]
                kand.sort(key=lambda k: (not k['sicher'], -k['punkte']))
            if kand:
                erg[name] = kand[:3]
            else:
                rest.append(p)
        with LOCK:
            inv = lies(pfad)
            inv['vorschlaege'] = erg
            inv['netzhinweise'] = {}
            schreib(pfad, inv)
        # Phase 2: was nirgends als Paket steht, im Netz suchen (Claude, je Programm nur einmal)
        def netz(p):
            r = NETZ.suchen(p)
            if not r:
                return
            with LOCK:
                inv = lies(pfad)
                if r.get('ok'):
                    inv.setdefault('vorschlaege', {})[p['name']] = [netz_vorschlag(p['name'], r)]
                else:
                    inv.setdefault('netzhinweise', {})[p['name']] = r.get('hinweis') or 'nichts Offizielles gefunden'
                schreib(pfad, inv)
        threads = [threading.Thread(target=netz, args=(p,)) for p in rest]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
    except Exception:
        traceback.print_exc()
    finally:
        VORSCHLAG_LAEUFT.discard(datei)


def netz_vorschlag(name, r):
    return {'id': 'netz.' + schluessel(name), 'name': f"{anzeigename(name)} {r.get('version') or ''}".strip(), 'quelle': 'netz',
            'sicher': False, 'punkte': 0, 'url': r['url'], 'version': r.get('version'), 'seite': r.get('quelle'),
            'groesse': r.get('groesse'), 'hinweis': r.get('hinweis'),
            'domain': urllib.parse.urlparse(r['url']).hostname}


def vorschlaege_starten(datei):
    if datei in VORSCHLAG_LAEUFT:
        return
    VORSCHLAG_LAEUFT.add(datei)
    threading.Thread(target=vorschlaege_berechnen, args=(datei,), daemon=True).start()


def inventar_ansicht(datei):
    laeuft = sicher(datei) in VORSCHLAG_LAEUFT   # VOR dem Lesen, sonst Rennen mit dem Schreiben
    inv = lies(DATEN / 'inventare' / sicher(datei))
    if inv is None:
        return None
    progs = inv.get('programme') or []
    manuell = zuordnungen()
    try:
        auto = KATALOG.zuordnen(progs)
    except RuntimeError:
        auto = [None] * len(progs)
    vorschl = inv.get('vorschlaege')
    if vorschl is None:
        vorschlaege_starten(sicher(datei))
    for p, a in zip(progs, auto):
        nn = normname(p.get('name'))
        p['id'] = manuell.get(nn, a)
        p['manuell'] = nn in manuell
        p['windows'] = bool(WINDOWS_TEIL.match(p.get('name') or ''))
        kand = (vorschl or {}).get(p.get('name') or '') or []
        nh = (inv.get('netzhinweise') or {}).get(p.get('name') or '')
        if nh:
            p['netzhinweis'] = nh
        if not p['id'] and not p['windows'] and kand:
            if kand[0]['sicher']:
                p['id'] = kand[0]['id']
                p['auto'] = kand[0]['quelle']
            else:
                p['vorschlag'] = kand
    # winget export liefert IDs, die ueber den Namen nicht gefunden wurden
    bekannt = {p['id'] for p in progs if p.get('id')}
    extra = []
    for wid in inv.get('winget_ids') or []:
        if wid not in bekannt:
            try:
                inf = KATALOG.info(wid)
            except RuntimeError:
                inf = None
            if inf:
                extra.append({'name': inf['name'], 'version': '', 'publisher': '', 'id': wid,
                              'quelle': 'winget export', 'windows': False})
    inv['programme'] = progs + extra
    inv['vorschlaege_laeuft'] = laeuft or sicher(datei) in VORSCHLAG_LAEUFT and vorschl is None
    inv.pop('vorschlaege', None)
    inv.pop('netzhinweise', None)
    return inv


def inventare_liste():
    out = []
    for p in sorted((DATEN / 'inventare').glob('*.json'), key=lambda x: x.stat().st_mtime, reverse=True):
        inv = lies(p, {})
        out.append({'datei': p.name, 'host': inv.get('host'), 'zeit': inv.get('zeit'),
                    'os': inv.get('os'), 'anzahl': len(inv.get('programme') or [])})
    return out


# ---------------- Depot laden ----------------
def jlog(t):
    with LOCK:
        JOB['log'].append(time.strftime('%H:%M:%S ') + t)
        del JOB['log'][:-400]


def lade_paket(pid, eintrag):
    if pid in hersteller.HERSTELLER:
        a = hersteller.abfragen(pid)      # frischer, signierter Link bei jedem Laden
        ziel = DATEN / 'depot' / sicher(pid)
        alt = lies(ziel / 'info.json')
        if alt and alt.get('version') == a['version'] and (ziel / alt['datei']).exists():
            return f'aktuell ({a["version"]})'
        ziel.mkdir(parents=True, exist_ok=True)
        datei, n = link_laden(a['url'], ziel)
        if a.get('datei') and datei != sicher(a['datei']):
            (ziel / datei).replace(ziel / sicher(a['datei']))
            datei = sicher(a['datei'])
        if a.get('hash'):
            algo, soll = a['hash']
            h = hashlib.new(algo)
            with open(ziel / datei, 'rb') as f:
                for block in iter(lambda: f.read(1 << 20), b''):
                    h.update(block)
            if h.hexdigest() != soll:
                (ziel / datei).unlink()
                raise RuntimeError(f'{algo.upper()} stimmt nicht mit der Angabe des Herstellers ueberein')
        info = eigen_info(pid, a['name'], ziel / datei, n, None, None, a['version'], None)
        info.update(quelle='hersteller', seite=a.get('seite'))
        schreib(ziel / 'info.json', info)
        return f'geladen {a["version"]} ({n // 1048576} MB, {info.get("art") or info["typ"]}) über die Hersteller-Schnittstelle' + (
            f' – {info["fehler"]}' if info.get('fehler') else '')
    if pid.startswith('netz.'):
        if not eintrag.get('url'):
            raise RuntimeError('kein Download-Link gespeichert')
        ziel = DATEN / 'depot' / sicher(pid)
        alt = lies(ziel / 'info.json')
        if alt and alt.get('url') == eintrag['url'] and (ziel / alt['datei']).exists():
            return f'aktuell ({alt.get("version")})'
        ziel.mkdir(parents=True, exist_ok=True)
        datei, n = link_laden(eintrag['url'], ziel)
        hinweis = 'inno' if re.search(r'_is1$', eintrag.get('key') or '', re.I) else None
        info = eigen_info(pid, eintrag.get('name') or pid, ziel / datei, n, None, hinweis, eintrag.get('version'), eintrag['url'])
        info['quelle'] = 'netz'
        info['seite'] = eintrag.get('seite')
        schreib(ziel / 'info.json', info)
        return f'geladen {info["version"]} ({n // 1048576} MB, {info.get("art") or info["typ"]}) von {urllib.parse.urlparse(eintrag["url"]).hostname}' + (
            f' – {info["fehler"]}' if info.get('fehler') else '')
    if eintrag.get('quelle') == 'eigen':
        return 'eigener Installer – liegt schon im Depot' if depot_info(pid) else 'eigener Installer fehlt!'
    ins = CHOCO.installer(pid.split(':', 1)[1]) if pid.startswith('choco:') else KATALOG.installer(pid)
    if not ins.get('url') and not ins.get('eingebettet'):
        raise RuntimeError(ins.get('fehler') or 'keine Installer-URL')
    ziel = DATEN / 'depot' / sicher(pid)
    alt = lies(ziel / 'info.json')
    if alt and alt.get('version') == ins['version'] and (ziel / alt['datei']).exists():
        return f'aktuell ({ins["version"]})'
    ziel.mkdir(parents=True, exist_ok=True)
    pfad_url = urllib.parse.urlparse(ins['url']).path if ins.get('url') else ins['eingebettet']
    dname = sicher(urllib.parse.unquote(os.path.basename(pfad_url))) or 'installer'
    ext = {'msi': '.msi', 'wix': '.msi', 'msix': '.msix', 'appx': '.appx', 'zip': '.zip'}
    if not os.path.splitext(dname)[1]:
        dname += '.zip' if ins.get('nested') else ext.get(ins['typ'], '.exe')
    if ins.get('nested') and not dname.lower().endswith('.zip'):
        dname += '.zip'
    tmp = ziel / (dname + '.laden')
    h = hashlib.sha256()
    if ins.get('eingebettet'):   # Installer steckt im Chocolatey-Paket selbst
        daten = CHOCO.eingebettet_holen(pid, ins['eingebettet'])
        h.update(daten)
        tmp.write_bytes(daten)
    else:
        req = urllib.request.Request(ins['url'], headers=UA)
        with urllib.request.urlopen(req, timeout=120) as r, open(tmp, 'wb') as f:
            while True:
                block = r.read(1 << 20)
                if not block:
                    break
                h.update(block)
                f.write(block)
    hinweis_sha = ''
    if ins.get('sha256') and h.hexdigest() != ins['sha256']:
        # „latest“-Links ohne Version im Pfad (z. B. Chrome) liefern oft schon eine neuere Datei als das
        # Manifest kennt – dann ist die Abweichung erwartbar. Bei Links mit fester Version bleibt es ein Fehler.
        pfad_teil = urllib.parse.urlparse(ins.get('url') or '').path
        if ins.get('url') and not re.search(r'\d+\.\d+', pfad_teil):
            hinweis_sha = ' – neuere Datei als im Katalog (Hersteller-Link ohne Version), Prüfsumme neu berechnet'
        else:
            tmp.unlink(missing_ok=True)
            raise RuntimeError('SHA-256 stimmt nicht mit dem Paket-Manifest ueberein')
    for alte in ziel.iterdir():
        if alte.name not in ('info.json', tmp.name):
            alte.unlink()
    tmp.replace(ziel / dname)
    info = {k: ins.get(k) for k in ('id', 'name', 'version', 'typ', 'args', 'nested', 'codes', 'arch', 'scope', 'url', 'fehler')}
    info.update({'datei': dname, 'sha256': h.hexdigest(), 'groesse': (ziel / dname).stat().st_size,
                 'quelle': 'choco' if pid.startswith('choco:') else 'winget', 'geladen': time.strftime('%Y-%m-%d %H:%M')})
    schreib(ziel / 'info.json', info)
    return f'geladen {ins["version"]} ({info["groesse"] // 1048576} MB, {ins["typ"]})' + hinweis_sha + (
        f' – {ins["fehler"]}' if ins.get('fehler') else '')


def netz_ersatz(profilname, pid, e):
    """Chocolatey-Link tot -> offiziellen Download im Netz suchen und das Paket in der Liste ersetzen."""
    titel = e.get('name') or pid
    jlog(f'{titel}: suche offiziellen Download im Netz …')
    r = NETZ.suchen({'name': titel, 'publisher': '', 'version': ''})
    if not r or not r.get('ok'):
        jlog(f'{titel}: auch im Netz nichts – {(r or {}).get("hinweis") or "keine Antwort"}')
        return
    neu = netz_vorschlag(titel, r)
    eintrag = {'name': titel, 'quelle': 'netz', 'aus': e.get('aus'), 'key': e.get('key'),
               'url': r['url'], 'version': r.get('version'), 'seite': r.get('quelle')}
    with LOCK:
        pr = profil(profilname)
        pr['pakete'].pop(pid, None)
        pr['pakete'][neu['id']] = eintrag
        schreib(profil_pfad(profilname), pr)
    try:
        jlog(f'{titel}: {lade_paket(neu["id"], eintrag)} (ersetzt Chocolatey)')
    except Exception as ex:
        jlog(f'{titel}: Netz-Download ging auch nicht: {ex}')


def lade_job(name):
    try:
        try:
            if KATALOG.aktualisieren(wenn_aelter_als=12 * 3600):
                jlog('winget-Katalog aktualisiert')
        except Exception as e:  # Katalog alt ist besser als keiner
            jlog(f'Katalog-Aktualisierung fehlgeschlagen: {e}')
        pakete = profil(name)['pakete']
        with LOCK:
            JOB['gesamt'] = len(pakete)
        for pid, e in sorted(pakete.items(), key=lambda kv: reihenfolge(kv[0])):
            try:
                jlog(f'{e.get("name") or pid}: {lade_paket(pid, e)}')
            except Exception as ex:
                jlog(f'{e.get("name") or pid}: FEHLER {ex}')
                if pid.startswith('choco:'):
                    netz_ersatz(name, pid, e)
            with LOCK:
                JOB['fertig'] += 1
        jlog('fertig.')
    finally:
        with LOCK:
            JOB['laeuft'] = False


def plan(name, basis):
    """Was der Windows-Client installiert – in Reihenfolge."""
    pr = profil(name)
    out = []
    for pid, e in sorted(pr['pakete'].items(), key=lambda kv: reihenfolge(kv[0])):
        d = depot_info(pid) or {}
        args = e.get('args') if e.get('args') not in (None, '') else d.get('args')
        eintrag = {'id': pid, 'name': e.get('name') or d.get('name') or pid, 'quelle': e.get('quelle', 'winget'),
                   'version': d.get('version'), 'typ': d.get('typ'), 'args': args, 'nested': d.get('nested'),
                   'codes': d.get('codes') or [0, 3010, 1641], 'sha256': d.get('sha256'),
                   'datei': f'{sicher(pid)}/{d["datei"]}' if d.get('datei') else None}
        eintrag['url'] = f'{basis}/depot/{urllib.parse.quote(eintrag["datei"])}' if eintrag['datei'] else None
        if not eintrag['datei']:
            eintrag['problem'] = 'nicht im Depot – erst „Herunterladen“ auf V3DA'
        elif args is None:
            eintrag['problem'] = 'kein Silent-Schalter – Parameter in der Liste eintragen'
        out.append(eintrag)
    return {'profil': pr['name'], 'pakete': out}


# ---------------- Eigene Installer ----------------
SILENT = {
    'inno': '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
    'nullsoft': '/S',
    'burn': '/quiet /norestart',
    'msi': '/quiet /norestart',
    'squirrel': '--silent',
    'installshield': '/s /v"/qn /norestart"',
    'advanced': '/exenoui /qn /norestart',
}
# Erkennungsmerkmale im Installer (Reihenfolge = Vorrang)
MERKMALE = [
    (b'Inno Setup Setup Data', 'inno'), (b'JR.Inno.Setup', 'inno'),
    (b'Nullsoft.NSIS', 'nullsoft'), (b'NullsoftInst', 'nullsoft'),
    (b'.wixburn', 'burn'),
    (b'SquirrelSetup', 'squirrel'), (b'Squirrel', 'squirrel'),
    (b'InstallShield', 'installshield'),
    (b'Advanced Installer', 'advanced'),
]


def installer_art(pfad):
    """Installer-Bauart am Inhalt erkennen -> (art, silent-args) oder (None, None)."""
    pfad = Path(pfad)
    if pfad.suffix.lower() == '.msi':
        return 'msi', SILENT['msi']
    if pfad.suffix.lower() in ('.msix', '.appx', '.msixbundle', '.appxbundle'):
        return pfad.suffix.lower().lstrip('.').replace('bundle', ''), ''
    try:
        with open(pfad, 'rb') as f:
            kopf = f.read(16 << 20)   # Merkmale stehen im Manifest/Anfang des Stubs
            f.seek(max(0, pfad.stat().st_size - (4 << 20)))
            kopf += f.read()
    except OSError:
        return None, None
    for merkmal, art in MERKMALE:
        if merkmal in kopf:
            return art, SILENT[art]
    return None, None


def link_laden(url, ziel):
    if not re.match(r'^https?://', url or ''):
        raise ValueError('Link muss mit http:// oder https:// beginnen')
    for alt in ziel.iterdir():
        if alt.name != 'info.json':
            alt.unlink()
    # erst wie ein Download-Programm fragen (manche Seiten schicken Browsern eine Zwischenseite),
    # dann wie ein Browser (manche Seiten sperren alles andere)
    for ua in ('V3D-Setup/1.0 (curl-kompatibel)', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36'):
        r = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': ua}), timeout=120)
        if 'text/html' not in (r.headers.get('Content-Type') or ''):
            break
        r.close()
    else:
        raise ValueError('Der Link liefert eine Webseite, keinen Installer – bitte den direkten Download-Link nehmen '
                         '(Rechtsklick auf den Download-Knopf → Link kopieren)')
    with r:
        cd = r.headers.get('Content-Disposition') or ''
        m = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)', cd)
        datei = urllib.parse.unquote(m.group(1)) if m else os.path.basename(urllib.parse.urlparse(r.geturl()).path)
        datei = sicher(urllib.parse.unquote(datei)) or 'installer.exe'
        n = 0
        with open(ziel / (datei + '.laden'), 'wb') as f:
            while True:
                block = r.read(1 << 20)
                if not block:
                    break
                f.write(block)
                n += len(block)
    (ziel / (datei + '.laden')).replace(ziel / datei)
    return datei, n


def eigen_info(pid, name, pfad, groesse, args, hinweis, version, url):
    h = hashlib.sha256()
    with open(pfad, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    art, erkannt = installer_art(pfad)
    if not art and hinweis == 'inno':           # Registry-Schluessel *_is1 = Inno Setup (MSI erkennt die Endung)
        art, erkannt = hinweis, SILENT[hinweis]
    typ = {'msi': 'msi', 'msix': 'msix', 'appx': 'appx'}.get(art or '', 'exe')
    if args in (None, ''):
        args = erkannt
    return {'id': pid, 'name': name, 'version': version or time.strftime('%Y-%m-%d'), 'typ': typ, 'art': art,
            'args': args, 'datei': pfad.name, 'sha256': h.hexdigest(), 'groesse': groesse, 'url': url,
            'codes': [0, 3010, 1641], 'quelle': 'eigen', 'geladen': time.strftime('%Y-%m-%d %H:%M'),
            'fehler': None if args is not None else 'Bauart nicht erkannt – bitte Silent-Parameter eintragen'}


# ---------------- Treiber ----------------
def treiber_liste():
    out = []
    for host in sorted((DATEN / 'treiber').iterdir()):
        if not host.is_dir():
            continue
        for z in sorted(host.glob('*.zip'), reverse=True):
            meta = lies(z.with_suffix('.json'), {})
            out.append({'host': host.name, 'datei': z.name, 'groesse': z.stat().st_size,
                        'zeit': time.strftime('%Y-%m-%d %H:%M', time.localtime(z.stat().st_mtime)), **meta})
    return out


# ---------------- Rechner (Agent auf dem Windows-PC) ----------------
# Der Starter meldet den PC an und fragt alle paar Sekunden nach Auftraegen ("Puls").
# Dabei schickt er neue Protokollzeilen, Schritte, Fortschritt und Ergebnisse mit.
RECHNER = {}
for _p in (DATEN / 'rechner').glob('*.json'):
    _r = lies(_p)
    if _r:
        RECHNER[_r['host']] = _r
AKTIONEN = {
    'Inventar': ['Inventar'],
    'TreiberSichern': ['TreiberSichern'],
    'AlterRechner': ['Inventar', 'TreiberSichern'],
    'Alles': ['TreiberZurueck', 'Installieren', 'Updates'],
    'Installieren': ['Installieren'],
    'TreiberZurueck': ['TreiberZurueck'],
    'Updates': ['Updates'],
    'Beenden': [],
}


def rechner_speichern(r):
    schreib(DATEN / 'rechner' / (sicher(r['host']) + '.json'), r)


def gesichert(host):
    """Was von diesem PC schon auf V3DA liegt: neuestes Inventar + neueste Treiber-Sicherung."""
    inv = next((i for i in inventare_liste() if i.get('host') == host), None)
    tr = next((t for t in treiber_liste() if t['host'] == host), None)
    return {'inventar': {'zeit': inv['zeit'], 'anzahl': inv['anzahl'], 'datei': inv['datei']} if inv else None,
            'treiber': {'zeit': tr['zeit'], 'anzahl': tr.get('anzahl'), 'groesse': tr['groesse'], 'datei': tr['datei']} if tr else None}


def rechner_ansicht(r, mit_gesichert=None):
    alter = time.time() - r.get('zuletzt', 0)
    # lange Windows-Update-/Installer-Laeufe blockieren den Puls -> beim Arbeiten grosszuegiger
    grenze = 1800 if r.get('status') == 'arbeitet' else 600 if r.get('status') == 'neustart' else 20
    return {**{k: v for k, v in r.items() if k != 'log'}, 'log': r.get('log', [])[-250:],
            'online': alter < grenze, 'alter': int(alter), 'gesichert': mit_gesichert or gesichert(r['host'])}


def agent_puls(b):
    host = sicher(b.get('host') or 'unbekannt')
    with LOCK:
        r = RECHNER.setdefault(host, {'host': host, 'log': [], 'auftraege': []})
        for k in ('modell', 'os', 'benutzer', 'status', 'aufgabe', 'schritte', 'fortschritt', 'ip', 'installer'):
            if k in b:
                r[k] = b[k]
        if 'ergebnisse' in b:
            r['ergebnisse'] = b['ergebnisse']
        neu = b.get('log') or []
        if neu:
            r['log'] = (r.get('log', []) + neu)[-600:]
        r['zuletzt'] = time.time()
        if 'installer' not in b:
            r['installer'] = None
        # Steuerbefehle (z. B. Ueberspringen) gehen auch waehrend der Arbeit raus - nur solange ein Installer laeuft
        steuer = r.get('steuer') if b.get('installer') else None
        if steuer:
            r['steuer'] = None
            rechner_speichern(r)
            return {'auftrag': steuer}
        r['steuer'] = None
        auftrag = r['auftraege'].pop(0) if r.get('auftraege') and b.get('status') == 'bereit' else None
        if auftrag:
            r['status'] = 'arbeitet'
            r['aufgabe'] = auftrag['titel']
            r['ergebnisse'] = []
            r['fortschritt'] = None
        rechner_speichern(r)
    return {'auftrag': auftrag}


TITEL = {'Inventar': 'Inventar senden', 'TreiberSichern': 'Treiber sichern', 'AlterRechner': 'Inventar + Treiber sichern',
         'Alles': 'Neu einrichten', 'Installieren': 'Programme installieren', 'TreiberZurueck': 'Treiber zurückspielen',
         'Updates': 'Updates', 'Beenden': 'Verbindung beenden'}


# ---------------- Notfall-Treiber (WLAN + Touchpad) ----------------
# Kleines Paket fuer den USB-Stick: damit ein frisch installiertes Windows sofort WLAN und
# Touchpad hat und danach die V3D-Setup-Seite oeffnen kann. pnputil installiert nur Treiber,
# zu denen passende Hardware da ist - deshalb duerfen alle Kandidaten mit.
NOTFALL_REGELN = [
    ('WLAN/LAN', r'^(netwtw|netwlv|netrtwl|rtwlan|mtkwl|bcmwl|athw|qcamain|netr28|mrvlpcie|rtu53cx|rtucx|rtwu|netrtl)'),
    ('Touchpad', r'^(asusptp|ialpss|iaLPSS|hid_pci|hideventfilter|elan|synp|smbusdrv|ptp|hpptp|lenovoptp|dellptp|msptp)'),
    ('Bluetooth', r'^(ibtusb|rtkfilter|btfilter|mtkbt|bcbtums|qcbtuart)'),
]

EINSPIELEN_CMD = r'''@echo off
title V3D Treiber - WLAN, Touchpad, Bluetooth
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
echo.
echo  V3D Treiber: spiele WLAN-, Touchpad- und Bluetooth-Treiber ein ...
echo.
pnputil /add-driver "%~dp0treiber\*.inf" /subdirs /install
echo.
echo  Fertig. Jetzt bitte mit dem WLAN verbinden (Auswahl oeffnet sich) ...
start "" ms-availablenetworks:
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0warten.ps1"
'''

WARTEN_PS1 = r'''# wartet, bis V3DA erreichbar ist, und oeffnet dann V3D Setup
$Server = '__SERVER__'
Write-Host ''
Write-Host "  Warte auf Verbindung zu V3DA ($Server) " -NoNewline
for ($i = 0; $i -lt 600; $i++) {
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "$Server/api/status" -TimeoutSec 3 | Out-Null
        Write-Host ' verbunden!' -ForegroundColor Green
        Start-Process $Server
        Start-Sleep -Seconds 3
        exit
    } catch { Write-Host '.' -NoNewline; Start-Sleep -Seconds 2 }
}
Write-Host ''
Write-Host '  V3DA nicht erreichbar. WLAN verbunden? Seite von Hand oeffnen:' -ForegroundColor Yellow
Write-Host "  $Server"
Read-Host '  Enter zum Schliessen'
'''


def notfall_treiber(host, datei, basis):
    """Baut (oder liefert gemerkt) das Notfall-ZIP aus einer Treiber-Sicherung."""
    quelle = DATEN / 'treiber' / sicher(host) / sicher(datei)
    if not quelle.is_file():
        raise FileNotFoundError('Treiber-Sicherung fehlt')
    ziel = DATEN / 'notfall' / f'{sicher(host)}_{quelle.stem}_{hashlib.md5(basis.encode()).hexdigest()[:6]}.zip'
    if ziel.exists() and ziel.stat().st_mtime >= quelle.stat().st_mtime:
        return ziel, lies(ziel.with_suffix('.json'), {})
    import zipfile
    gewaehlt = {}
    with zipfile.ZipFile(quelle) as z:
        for info in z.infolist():
            if '\\' not in info.filename and '/' not in info.filename:
                continue
            ordner = re.split(r'[\\/]', info.filename)[0]
            for kat, rx in NOTFALL_REGELN:
                if re.match(rx, ordner, re.I):
                    gewaehlt.setdefault(ordner, kat)
        tmp = ziel.with_suffix('.laden')
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, compresslevel=1) as aus:
            for info in z.infolist():
                teile = re.split(r'[\\/]', info.filename)
                if teile[0] in gewaehlt and not info.is_dir():
                    aus.writestr('V3D-Treiber/treiber/' + '/'.join(teile), z.read(info))
            aus.writestr('V3D-Treiber/Einspielen.cmd', EINSPIELEN_CMD.replace('\n', '\r\n'))
            aus.writestr('V3D-Treiber/warten.ps1', '\ufeff' + WARTEN_PS1.replace('__SERVER__', basis).replace('\n', '\r\n'))
            liste = '\r\n'.join(f'  {k:10} {o}' for o, k in sorted(gewaehlt.items(), key=lambda x: (x[1], x[0])))
            aus.writestr('V3D-Treiber/LIESMICH.txt', (
                f'V3D Treiber fuer {host} (Sicherung {datei})\r\n\r\n'
                '1. Ordner V3D-Treiber auf einen USB-Stick kopieren (ZIP vorher entpacken!).\r\n'
                '2. Am frisch installierten PC Einspielen.cmd doppelklicken (Adminrechte bestaetigen).\r\n'
                '3. Mit dem WLAN verbinden - danach oeffnet sich V3D Setup von selbst.\r\n\r\n'
                f'Enthaltene Treiber:\r\n{liste}\r\n'))
    tmp.replace(ziel)
    meta = {'anzahl': len(gewaehlt), 'kategorien': sorted(set(gewaehlt.values())), 'groesse': ziel.stat().st_size}
    schreib(ziel.with_suffix('.json'), meta)
    return ziel, meta


# ---------------- Windows-Skripte ----------------
def skript(name, basis):
    roh = (HIER / 'windows' / name).read_text(encoding='utf-8')
    roh = roh.replace('__SERVER__', basis)
    if name.endswith('.cmd'):
        roh = roh.replace('\r\n', '\n').replace('\n', '\r\n')
        return roh.encode('ascii', 'replace')
    return b'\xef\xbb\xbf' + roh.replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8')


class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'V3DSetup/1.0'

    def log_message(self, fmt, *a):
        sys.stderr.write('%s %s\n' % (self.address_string(), fmt % a))

    # --- Hilfen ---
    def basis(self):
        return 'http://' + (self.headers.get('Host') or f'192.168.178.254:{PORT}')

    def antwort(self, code, daten, typ='application/json; charset=utf-8', extra=None):
        if not isinstance(daten, (bytes, bytearray)):
            daten = json.dumps(daten, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', typ)
        self.send_header('Content-Length', str(len(daten)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(daten)

    def fehler(self, code, text):
        self.antwort(code, {'fehler': text})

    def datei_senden(self, pfad, name=None):
        pfad = Path(pfad)
        if not pfad.is_file():
            return self.fehler(404, 'Datei fehlt')
        groesse = pfad.stat().st_size
        self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Length', str(groesse))
        self.send_header('Content-Disposition', f'attachment; filename="{name or pfad.name}"')
        self.end_headers()
        if self.command == 'HEAD':
            return
        with open(pfad, 'rb') as f:
            shutil.copyfileobj(f, self.wfile, 1 << 20)

    def koerper_json(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > 64 << 20:
            raise ValueError('zu gross')
        roh = self.rfile.read(n) if n else b'{}'
        self._rest = 0
        if roh.startswith(b'\xef\xbb\xbf'):
            roh = roh[3:]
        try:
            return json.loads(roh.decode('utf-8'))
        except UnicodeDecodeError:
            return json.loads(roh.decode('utf-16'))

    def koerper_in_datei(self, ziel):
        n = int(self.headers.get('Content-Length') or -1)
        if n < 0:
            raise ValueError('Content-Length fehlt')
        tmp = Path(str(ziel) + '.laden')
        rest = n
        with open(tmp, 'wb') as f:
            while rest > 0:
                block = self.rfile.read(min(rest, 1 << 20))
                if not block:
                    raise ValueError('Upload abgebrochen')
                f.write(block)
                rest -= len(block)
        tmp.replace(ziel)
        self._rest = 0
        return n

    def pfad_q(self):
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        return urllib.parse.unquote(u.path), q

    # --- GET ---
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        try:
            self._get()
        except Exception as e:
            traceback.print_exc()
            self.fehler(500, str(e))

    def _get(self):
        pfad, q = self.pfad_q()
        if pfad in ('/', '/index.html'):
            return self.antwort(200, (HIER / 'ui.html').read_bytes(), 'text/html; charset=utf-8')
        if pfad == '/logo.svg' and (HIER / 'logo.svg').exists():
            return self.antwort(200, (HIER / 'logo.svg').read_bytes(), 'image/svg+xml')
        if pfad == '/V3D-Setup.ps1':
            return self.antwort(200, skript('V3D-Setup.ps1', self.basis()), 'text/plain; charset=utf-8')
        if pfad == '/s':  # fuer den Einzeiler: ohne BOM, sonst stolpert der Parser
            return self.antwort(200, skript('V3D-Setup.ps1', self.basis())[3:], 'text/plain; charset=utf-8')
        if pfad == '/V3D-Setup.cmd':
            return self.antwort(200, skript('V3D-Setup.cmd', self.basis()), 'application/octet-stream',
                                {'Content-Disposition': 'attachment; filename="V3D-Setup.cmd"'})
        if pfad == '/api/status':
            return self.antwort(200, {'katalog': KATALOG.stand(), 'profile': profil_namen(),
                                      'basis': self.basis(), 'job': JOB['laeuft']})
        if pfad == '/api/suche':
            erg = [dict(r, quelle='winget') for r in KATALOG.suche(q.get('q', ''))]
            if q.get('choco'):
                toks = woerter(q.get('q', '')) or [q.get('q', '').lower()]
                erg += [{'id': 'choco:' + r['id'], 'name': r['name'], 'version': r['version'], 'quelle': 'choco'}
                        for r in CHOCO.kandidaten(toks)]
            return self.antwort(200, erg)
        if pfad == '/api/netzsuche':
            prog = {'name': q.get('name', ''), 'publisher': q.get('publisher', ''), 'version': q.get('version', '')}
            if len(prog['name'].strip()) < 2:
                return self.fehler(400, 'Name fehlt')
            r = NETZ.suchen(prog, neu=bool(q.get('neu')))
            if r is None:
                return self.fehler(409, 'Suche fuer dieses Programm laeuft schon')
            return self.antwort(200, {**r, 'vorschlag': netz_vorschlag(prog['name'], r) if r.get('ok') else None})
        if pfad == '/api/inventare':
            return self.antwort(200, inventare_liste())
        if pfad == '/api/rechner':
            with LOCK:
                liste = [rechner_ansicht(r) for r in RECHNER.values()]
            liste.sort(key=lambda r: (not r['online'], -r.get('zuletzt', 0)))
            return self.antwort(200, liste)
        if pfad == '/api/inventar':
            inv = inventar_ansicht(q.get('datei', ''))
            return self.antwort(200, inv) if inv else self.fehler(404, 'Inventar nicht gefunden')
        if pfad == '/api/profile':
            return self.antwort(200, profil_namen())
        if pfad == '/api/profil':
            return self.antwort(200, profil_ansicht(q.get('name', 'standard')))
        if pfad == '/api/plan':
            return self.antwort(200, plan(q.get('profil', 'standard'), self.basis()))
        if pfad == '/api/job':
            with LOCK:
                return self.antwort(200, dict(JOB, log=JOB['log'][-200:]))
        if pfad == '/api/treiber':
            return self.antwort(200, treiber_liste())
        if pfad == '/api/notfalltreiber':
            ziel, meta = notfall_treiber(q.get('host', ''), q.get('datei', ''), self.basis())
            return self.datei_senden(ziel, f"V3D-Treiber-{sicher(q.get('host', ''))}.zip")
        if pfad.startswith('/depot/') or pfad.startswith('/treiber/'):
            wurzel = (DATEN / pfad.split('/')[1]).resolve()
            ziel = (DATEN / pfad.lstrip('/')).resolve()
            if wurzel not in ziel.parents or ziel.name.endswith('.json'):
                return self.fehler(403, 'nein')
            return self.datei_senden(ziel)
        self.fehler(404, 'unbekannt')

    # --- POST/PUT/DELETE ---
    def do_POST(self):
        self._rest = int(self.headers.get('Content-Length') or 0)
        try:
            self._post()
            if self._rest > 0:  # ungelesenen Rest verwerfen, sonst klebt er vor der naechsten Anfrage
                self.rfile.read(self._rest)
                self._rest = 0
        except ValueError as e:
            self.fehler(400, str(e))
        except Exception as e:
            traceback.print_exc()
            self.fehler(500, str(e))

    do_PUT = do_POST

    def _post(self):
        pfad, q = self.pfad_q()
        if pfad == '/api/inventar':
            inv = self.koerper_json()
            for prog in inv.get('programme') or []:   # Registry-Werte haben manchmal ein Null-Zeichen am Ende
                for k, v in list(prog.items()):
                    if isinstance(v, str):
                        prog[k] = v.replace('\x00', '').strip()
            host = sicher(inv.get('host') or 'unbekannt')
            inv['zeit'] = inv.get('zeit') or time.strftime('%Y-%m-%d %H:%M')
            datei = f'{host}_{time.strftime("%Y%m%d-%H%M%S")}.json'
            schreib(DATEN / 'inventare' / datei, inv)
            vorschlaege_starten(datei)
            return self.antwort(200, {'ok': True, 'datei': datei,
                                      'link': f'{self.basis()}/#inv={urllib.parse.quote(datei)}'})
        if pfad == '/api/agent/puls':
            return self.antwort(200, agent_puls(self.koerper_json()))
        if pfad == '/api/rechner/auftrag':
            b = self.koerper_json()
            host = sicher(q.get('host', ''))
            if b.get('aktion') not in AKTIONEN and b.get('aktion') != 'Ueberspringen':
                raise ValueError('unbekannte Aktion')
            with LOCK:
                r = RECHNER.get(host)
                if not r:
                    return self.fehler(404, 'Rechner unbekannt')
                if b['aktion'] == 'Ueberspringen':
                    if not r.get('installer'):
                        return self.fehler(409, 'Gerade laeuft kein Installer')
                    r['steuer'] = {'aktion': 'Ueberspringen', 'programm': r['installer'].get('programm')}
                    rechner_speichern(r)
                    return self.antwort(200, {'ok': True})
                if b['aktion'] != 'Beenden' and (r.get('status') == 'arbeitet' or r.get('auftraege')):
                    return self.fehler(409, 'Der Rechner ist noch beschaeftigt')
                auftrag = {'aktion': b['aktion'], 'schritte': AKTIONEN[b['aktion']], 'titel': TITEL[b['aktion']],
                           'profil': b.get('profil') or '', 'treiber': b.get('treiber') or None,
                           'neustart': b.get('neustart', True), 'zeit': time.time()}
                r.setdefault('auftraege', []).append(auftrag)
                rechner_speichern(r)
                # Programme im Auftrag, aber noch nicht alle im Depot -> gleich herunterladen
                starte_laden = 'Installieren' in auftrag['schritte'] and not JOB['laeuft'] and any(
                    not depot_info(pid) for pid in profil(auftrag['profil'] or 'standard')['pakete'])
                if starte_laden:
                    JOB.update(laeuft=True, log=[], fertig=0, gesamt=0, profil=auftrag['profil'] or 'standard')
            if starte_laden:
                threading.Thread(target=lade_job, args=(auftrag['profil'] or 'standard',), daemon=True).start()
            return self.antwort(200, {'ok': True, 'laden': starte_laden})
        if pfad == '/api/vorschlaege':
            d = sicher(q.get('datei', ''))
            with LOCK:
                inv = lies(DATEN / 'inventare' / d)
                if inv is None:
                    return self.fehler(404, 'Inventar nicht gefunden')
                inv.pop('vorschlaege', None)
                schreib(DATEN / 'inventare' / d, inv)
            vorschlaege_starten(d)
            return self.antwort(200, {'ok': True})
        if pfad == '/api/katalog/aktualisieren':
            KATALOG.aktualisieren()
            return self.antwort(200, {'ok': True, 'katalog': KATALOG.stand()})
        if pfad == '/api/profil':
            name = q.get('name', 'standard')
            b = self.koerper_json()
            with LOCK:
                pr = profil(name)
                akt = b.get('aktion')
                if akt == 'setzen':
                    for e in b.get('pakete') or [b]:
                        if e.get('an', True) and e['id'].startswith('netz.') and not e.get('url'):
                            gemerkt = NETZ._cache.get(e['id'][5:]) or {}
                            e = {**e, 'url': gemerkt.get('url'), 'version': gemerkt.get('version'), 'seite': gemerkt.get('quelle')}
                        if e.get('an', True):
                            alt = pr['pakete'].get(e['id'], {})
                            pr['pakete'][e['id']] = {**alt, 'name': e.get('name') or alt.get('name') or e['id'],
                                                     'quelle': e.get('quelle') or alt.get('quelle') or (
                                                         'choco' if e['id'].startswith('choco:') else
                                                         'netz' if e['id'].startswith('netz.') else
                                                         'hersteller' if e['id'].startswith('herst.') else
                                                         'eigen' if e['id'].startswith('eigen.') else 'winget'),
                                                     'aus': e.get('aus') or alt.get('aus'),
                                                     **{k: e.get(k) or alt.get(k) for k in ('url', 'version', 'key', 'seite')
                                                        if e.get(k) or alt.get(k)}}
                        else:
                            pr['pakete'].pop(e['id'], None)
                elif akt == 'args':
                    if b['id'] in pr['pakete']:
                        pr['pakete'][b['id']]['args'] = b.get('args') or None
                elif akt == 'kopieren':
                    pr = {**pr, 'name': b['ziel']}
                    name = b['ziel']
                elif akt == 'loeschen':
                    profil_pfad(name).unlink(missing_ok=True)
                    return self.antwort(200, {'ok': True})
                else:
                    raise ValueError('unbekannte Aktion')
                pr['name'] = name
                schreib(profil_pfad(name), pr)
            return self.antwort(200, profil_ansicht(name))
        if pfad == '/api/zuordnung':
            b = self.koerper_json()
            with LOCK:
                z = zuordnungen()
                nn = normname(b.get('name'))
                if b.get('id'):
                    z[nn] = b['id']
                else:
                    z.pop(nn, None)
                schreib(DATEN / 'zuordnung.json', z)
            return self.antwort(200, {'ok': True})
        if pfad == '/api/laden':
            with LOCK:
                if JOB['laeuft']:
                    return self.fehler(409, 'Es laeuft schon ein Download')
                JOB.update(laeuft=True, log=[], fertig=0, gesamt=0, profil=q.get('name', 'standard'))
            threading.Thread(target=lade_job, args=(q.get('name', 'standard'),), daemon=True).start()
            return self.antwort(200, {'ok': True})
        if pfad == '/api/eigen':
            # eigener Installer (nicht in winget/Chocolatey): Datei im Koerper ODER Download-Link (?url=)
            name = (q.get('name') or '').strip()
            if not name:
                raise ValueError('Name fehlt')
            pid = 'eigen.' + sicher(re.sub(r'\s+', '-', name.lower()))
            ziel = DATEN / 'depot' / sicher(pid)
            ziel.mkdir(parents=True, exist_ok=True)
            if q.get('url'):
                datei, n = link_laden(q['url'], ziel)
            else:
                datei = sicher(q.get('datei') or 'installer.exe')
                for alt in ziel.iterdir():
                    if alt.name != 'info.json':
                        alt.unlink()
                n = self.koerper_in_datei(ziel / datei)
            info = eigen_info(pid, name, ziel / datei, n, q.get('args'), q.get('hinweis'), q.get('version'), q.get('url'))
            schreib(ziel / 'info.json', info)
            with LOCK:
                pr = profil(q.get('profil', 'standard'))
                pr['pakete'][pid] = {'name': name, 'quelle': 'eigen', 'args': None, 'aus': q.get('aus')}
                schreib(profil_pfad(pr['name']), pr)
            return self.antwort(200, info)
        if pfad == '/api/treiber':
            host = sicher(q.get('host') or 'unbekannt')
            name = sicher(q.get('name') or time.strftime('%Y%m%d-%H%M%S'))
            if not name.endswith('.zip'):
                name += '.zip'
            ziel = DATEN / 'treiber' / host
            ziel.mkdir(parents=True, exist_ok=True)
            n = self.koerper_in_datei(ziel / name)
            meta = {k: q[k] for k in ('anzahl', 'os', 'modell') if k in q}
            schreib((ziel / name).with_suffix('.json'), meta)
            return self.antwort(200, {'ok': True, 'datei': f'{host}/{name}', 'groesse': n})
        self.fehler(404, 'unbekannt')

    def do_DELETE(self):
        pfad, q = self.pfad_q()
        if pfad == '/api/inventar':
            (DATEN / 'inventare' / sicher(q.get('datei', ''))).unlink(missing_ok=True)
            return self.antwort(200, {'ok': True})
        if pfad == '/api/treiber':
            z = DATEN / 'treiber' / sicher(q.get('host', '')) / sicher(q.get('datei', ''))
            z.unlink(missing_ok=True)
            z.with_suffix('.json').unlink(missing_ok=True)
            return self.antwort(200, {'ok': True})
        if pfad == '/api/rechner':
            with LOCK:
                RECHNER.pop(sicher(q.get('host', '')), None)
                (DATEN / 'rechner' / (sicher(q.get('host', '')) + '.json')).unlink(missing_ok=True)
            return self.antwort(200, {'ok': True})
        if pfad == '/api/depot':
            pid = q.get('id', '')
            shutil.rmtree(DATEN / 'depot' / sicher(pid), ignore_errors=True)
            return self.antwort(200, {'ok': True})
        self.fehler(404, 'unbekannt')


def main():
    if not KATALOG.db.exists():
        print('Lade winget-Katalog …', flush=True)
        try:
            KATALOG.aktualisieren()
        except Exception as e:
            print('Katalog nicht geladen:', e, flush=True)
    srv = ThreadingHTTPServer(('0.0.0.0', PORT), H)
    srv.daemon_threads = True
    print(f'V3D Setup auf :{PORT}', flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
