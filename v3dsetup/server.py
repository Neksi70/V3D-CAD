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

from katalog import Katalog, UA, normname

HIER = Path(__file__).resolve().parent
DATEN = Path(os.environ.get('V3DSETUP_DATEN', HIER / 'daten'))
PORT = int(os.environ.get('V3DSETUP_PORT', '8819'))
for d in ('inventare', 'profile', 'depot', 'treiber', 'katalog'):
    (DATEN / d).mkdir(parents=True, exist_ok=True)

KATALOG = Katalog(DATEN / 'katalog')
LOCK = threading.Lock()
JOB = {'laeuft': False, 'log': [], 'fertig': 0, 'gesamt': 0, 'profil': None}

WINDOWS_TEIL = re.compile(
    r'^(Microsoft Edge|Microsoft OneDrive|Microsoft Update Health Tools|Windows |Update for |'
    r'Microsoft \.NET (Host|Runtime|AppHost)|Microsoft Windows Desktop Runtime|Microsoft ASP\.NET Core|'
    r'Microsoft GameInput|Microsoft Teams Meeting Add-in|Teams Machine-Wide|Microsoft Intune|'
    r'Realtek |Intel\(R\) |Intel® |AMD Software|NVIDIA (Grafiktreiber|Graphics Driver|HD-Audio|PhysX|FrameView|USBC))', re.I)


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


def inventar_ansicht(datei):
    inv = lies(DATEN / 'inventare' / sicher(datei))
    if inv is None:
        return None
    progs = inv.get('programme') or []
    manuell = zuordnungen()
    try:
        auto = KATALOG.zuordnen(progs)
    except RuntimeError:
        auto = [None] * len(progs)
    for p, a in zip(progs, auto):
        nn = normname(p.get('name'))
        p['id'] = manuell.get(nn, a)
        p['manuell'] = nn in manuell
        p['windows'] = bool(WINDOWS_TEIL.match(p.get('name') or ''))
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
    if eintrag.get('quelle') == 'eigen':
        return 'eigener Installer – liegt schon im Depot' if depot_info(pid) else 'eigener Installer fehlt!'
    ins = KATALOG.installer(pid)
    if not ins.get('url'):
        raise RuntimeError(ins.get('fehler') or 'keine Installer-URL')
    ziel = DATEN / 'depot' / sicher(pid)
    alt = lies(ziel / 'info.json')
    if alt and alt.get('version') == ins['version'] and (ziel / alt['datei']).exists():
        return f'aktuell ({ins["version"]})'
    ziel.mkdir(parents=True, exist_ok=True)
    pfad_url = urllib.parse.urlparse(ins['url']).path
    dname = sicher(urllib.parse.unquote(os.path.basename(pfad_url))) or 'installer'
    ext = {'msi': '.msi', 'wix': '.msi', 'msix': '.msix', 'appx': '.appx', 'zip': '.zip'}
    if not os.path.splitext(dname)[1]:
        dname += '.zip' if ins.get('nested') else ext.get(ins['typ'], '.exe')
    if ins.get('nested') and not dname.lower().endswith('.zip'):
        dname += '.zip'
    tmp = ziel / (dname + '.laden')
    h = hashlib.sha256()
    req = urllib.request.Request(ins['url'], headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r, open(tmp, 'wb') as f:
        while True:
            block = r.read(1 << 20)
            if not block:
                break
            h.update(block)
            f.write(block)
    if ins.get('sha256') and h.hexdigest() != ins['sha256']:
        tmp.unlink(missing_ok=True)
        raise RuntimeError('SHA-256 stimmt nicht mit dem winget-Manifest ueberein')
    for alte in ziel.iterdir():
        if alte.name not in ('info.json', tmp.name):
            alte.unlink()
    tmp.replace(ziel / dname)
    info = {k: ins.get(k) for k in ('id', 'name', 'version', 'typ', 'args', 'nested', 'codes', 'arch', 'scope', 'url', 'fehler')}
    info.update({'datei': dname, 'sha256': h.hexdigest(), 'groesse': (ziel / dname).stat().st_size,
                 'quelle': 'winget', 'geladen': time.strftime('%Y-%m-%d %H:%M')})
    schreib(ziel / 'info.json', info)
    return f'geladen {ins["version"]} ({info["groesse"] // 1048576} MB, {ins["typ"]})' + (
        f' – {ins["fehler"]}' if ins.get('fehler') else '')


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
            return self.antwort(200, KATALOG.suche(q.get('q', '')))
        if pfad == '/api/inventare':
            return self.antwort(200, inventare_liste())
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
        if pfad.startswith('/depot/') or pfad.startswith('/treiber/'):
            wurzel = (DATEN / pfad.split('/')[1]).resolve()
            ziel = (DATEN / pfad.lstrip('/')).resolve()
            if wurzel not in ziel.parents or ziel.name.endswith('.json'):
                return self.fehler(403, 'nein')
            return self.datei_senden(ziel)
        self.fehler(404, 'unbekannt')

    # --- POST/PUT/DELETE ---
    def do_POST(self):
        try:
            self._post()
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
            host = sicher(inv.get('host') or 'unbekannt')
            inv['zeit'] = inv.get('zeit') or time.strftime('%Y-%m-%d %H:%M')
            datei = f'{host}_{time.strftime("%Y%m%d-%H%M%S")}.json'
            schreib(DATEN / 'inventare' / datei, inv)
            return self.antwort(200, {'ok': True, 'datei': datei,
                                      'link': f'{self.basis()}/#inv={urllib.parse.quote(datei)}'})
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
                        if e.get('an', True):
                            alt = pr['pakete'].get(e['id'], {})
                            pr['pakete'][e['id']] = {**alt, 'name': e.get('name') or alt.get('name') or e['id'],
                                                     'quelle': e.get('quelle', alt.get('quelle', 'winget')),
                                                     'aus': e.get('aus') or alt.get('aus')}
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
            # eigener Installer (nicht in winget): Rohdaten im Koerper, Angaben in der Adresse
            name = (q.get('name') or '').strip()
            datei = sicher(q.get('datei') or 'installer.exe')
            if not name:
                raise ValueError('Name fehlt')
            pid = 'eigen.' + sicher(re.sub(r'\s+', '-', name.lower()))
            ziel = DATEN / 'depot' / sicher(pid)
            ziel.mkdir(parents=True, exist_ok=True)
            for alt in ziel.iterdir():
                alt.unlink()
            n = self.koerper_in_datei(ziel / datei)
            h = hashlib.sha256()
            with open(ziel / datei, 'rb') as f:
                for block in iter(lambda: f.read(1 << 20), b''):
                    h.update(block)
            endung = datei.lower().rsplit('.', 1)[-1]
            typ = {'msi': 'msi', 'msix': 'msix', 'appx': 'appx', 'msixbundle': 'msix'}.get(endung, 'exe')
            args = q.get('args')
            if args is None or args == '':
                args = '/quiet /norestart' if typ == 'msi' else '' if typ in ('msix', 'appx') else None
            info = {'id': pid, 'name': name, 'version': q.get('version') or time.strftime('%Y-%m-%d'),
                    'typ': typ, 'args': args, 'datei': datei, 'sha256': h.hexdigest(), 'groesse': n,
                    'codes': [0, 3010, 1641], 'quelle': 'eigen', 'geladen': time.strftime('%Y-%m-%d %H:%M')}
            schreib(ziel / 'info.json', info)
            with LOCK:
                pr = profil(q.get('profil', 'standard'))
                pr['pakete'][pid] = {'name': name, 'quelle': 'eigen', 'args': None}
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
