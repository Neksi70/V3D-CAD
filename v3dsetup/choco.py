"""Chocolatey als zweite Quelle – fuer Programme, die winget nicht kennt.

Ein Chocolatey-Paket (.nupkg = ZIP) enthaelt tools/chocolateyInstall.ps1. Die
meisten folgen derselben Vorlage: Variablen ($url64 = '...') und eine
Hashtable (url64 = $url64, silentArgs = '/S', fileType = 'exe').
Daraus lesen wir Download-URL, Pruefsumme, Typ und Silent-Parameter – ohne
PowerShell. Pakete, die das Installer-Programm selbst mitbringen
(tools/*.exe), liefern die Datei direkt aus dem ZIP.
"""
import io
import json
import re
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

API = 'https://community.chocolatey.org/api/v2/'
UA = {'User-Agent': 'V3D-Setup/1.0'}
NS = {'a': 'http://www.w3.org/2005/Atom',
      'd': 'http://schemas.microsoft.com/ado/2007/08/dataservices',
      'm': 'http://schemas.microsoft.com/ado/2007/08/dataservices/metadata'}


class Choco:
    def __init__(self, ordner):
        self.ordner = Path(ordner)
        self.ordner.mkdir(parents=True, exist_ok=True)
        self.cache_datei = self.ordner / 'choco_suche.json'
        self._lock = threading.Lock()
        try:
            self._cache = json.loads(self.cache_datei.read_text())
        except (OSError, ValueError):
            self._cache = {}

    def _holen(self, url, timeout=60):
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
            return r.read()

    # ---------- Suche (mit Cache, 7 Tage) ----------
    def suche(self, text, top=8):
        text = (text or '').strip().lower()
        if len(text) < 3:
            return []
        alt = self._cache.get(text)
        if alt and time.time() - alt['t'] < 7 * 86400:
            return alt['r']
        q = urllib.parse.quote(f"'{text}'")
        url = f"{API}Search()?searchTerm={q}&targetFramework=''&includePrerelease=false&$top={top}"
        try:
            xml = self._holen(url, timeout=30)
        except Exception:
            return []
        out = []
        for e in ET.fromstring(xml).findall('a:entry', NS):
            pid = (e.findtext('a:title', '', NS) or '').strip()
            p = e.find('m:properties', NS)
            if not pid or p is None:
                continue
            out.append({'id': pid, 'name': p.findtext('d:Title', '', NS) or pid,
                        'version': p.findtext('d:Version', '', NS),
                        'downloads': int(p.findtext('d:DownloadCount', '0', NS) or 0)})
        with self._lock:
            self._cache[text] = {'t': time.time(), 'r': out}
            tmp = self.cache_datei.with_suffix('.tmp')
            tmp.write_text(json.dumps(self._cache))
            tmp.replace(self.cache_datei)
        return out

    def per_id(self, pid):
        """Paket direkt ueber den Namen – findet auch Pakete, die die Suche nicht listet."""
        schl = 'id:' + pid
        alt = self._cache.get(schl)
        if alt and time.time() - alt['t'] < 7 * 86400:
            return alt['r']
        url = f"{API}FindPackagesById()?id={urllib.parse.quote(repr(pid).replace(chr(34), chr(39)))}"
        try:
            xml = self._holen(url, timeout=30)
            out = []
            for e in ET.fromstring(xml).findall('a:entry', NS):
                p = e.find('m:properties', NS)
                if p is not None and (p.findtext('d:IsLatestVersion', '', NS) == 'true'):
                    out.append({'id': (e.findtext('a:title', '', NS) or pid).strip(),
                                'name': p.findtext('d:Title', '', NS) or pid, 'version': p.findtext('d:Version', '', NS)})
            out = out[:1]
        except Exception:
            return []
        with self._lock:
            self._cache[schl] = {'t': time.time(), 'r': out}
        return out

    def kandidaten(self, toks):
        """Suchbegriffe aus den Woertern eines Programms -> Chocolatey-Pakete."""
        if not toks:
            return []
        gefunden = {}
        for q in dict.fromkeys([' '.join(toks[:2]), toks[0]]):
            for r in self.suche(q):
                gefunden.setdefault(r['id'], r)
        for pid in dict.fromkeys(['-'.join(toks[:3]), ''.join(toks[:3]), toks[0]]):
            if len(pid) >= 4 and pid not in gefunden:
                for r in self.per_id(pid):
                    gefunden.setdefault(r['id'], r)
        return list(gefunden.values())

    # ---------- Paket lesen ----------
    def _nupkg(self, pid):
        return zipfile.ZipFile(io.BytesIO(self._holen(API + 'package/' + urllib.parse.quote(pid), timeout=300)))

    @staticmethod
    def _lies_skript(text, version):
        """Variablen + Hashtable-Eintraege aus chocolateyInstall.ps1."""
        werte = {'env:chocolateypackageversion': version, 'version': version}

        def aufloesen(v):
            v = v.strip().rstrip(',;').strip()
            if v.startswith('$') and re.fullmatch(r'\$[\w:]+', v):
                return werte.get(v[1:].lower())
            m = re.fullmatch(r"'(.*)'", v)
            if m:
                return m.group(1)
            m = re.fullmatch(r'"(.*)"', v)
            if m:
                s = m.group(1)
                s = re.sub(r'\$\{?([\w:]+)\}?', lambda x: str(werte.get(x.group(1).lower(), x.group(0))), s)
                return s.replace('`"', '"')
            return None

        for zeile in text.splitlines():
            zeile = re.sub(r'\s+#.*$', '', zeile).strip()
            m = re.match(r'^\$?([\w]+)\s*=\s*(.+)$', zeile)
            if not m or m.group(2).startswith('@{'):
                continue
            wert = aufloesen(m.group(2))
            if wert is not None:
                werte[m.group(1).lower()] = wert
        return werte

    def installer(self, pid, tiefe=0):
        z = self._nupkg(pid)
        namen = z.namelist()
        nuspec = next((n for n in namen if n.endswith('.nuspec')), None)
        meta = z.read(nuspec).decode('utf-8', 'replace') if nuspec else ''
        version = (re.search(r'<version>([^<]+)</version>', meta) or [None, ''])[1]
        titel = (re.search(r'<title>([^<]+)</title>', meta) or [None, pid])[1]
        skript_name = next((n for n in namen if n.lower() == 'tools/chocolateyinstall.ps1'), None)
        basis = {'id': 'choco:' + pid, 'name': titel, 'version': version, 'quelle': 'choco'}
        skript = z.read(skript_name).decode('utf-8-sig', 'replace') if skript_name else ''
        hat_inhalt = bool(re.search(r'^\s*[^#\s]', skript, re.M)) and (
            'url' in skript.lower() or any(n.lower().endswith(('.exe', '.msi')) for n in namen))
        if not hat_inhalt:
            # virtuelles Paket (z. B. rustdesk -> rustdesk.install): der Abhaengigkeit folgen
            deps = re.findall(r'<dependency id="([^"]+)"', meta)
            deps = [d for d in deps if not d.startswith('chocolatey')]
            deps.sort(key=lambda d: (not d.endswith('.install'), len(d)))
            if deps and tiefe < 2:
                r = self.installer(deps[0], tiefe + 1)
                return {**r, 'id': 'choco:' + pid, 'name': titel}
            return {**basis, 'fehler': 'Chocolatey-Paket ohne Installationsskript'}
        w = self._lies_skript(skript, version)
        url = w.get('url64bit') or w.get('url64') or w.get('url')
        sha = (w.get('checksum64') or w.get('checksum') or '') if (w.get('url64bit') or w.get('url64')) else (w.get('checksum') or '')
        if w.get('checksumtype64', w.get('checksumtype', 'sha256')).lower() not in ('sha256', ''):
            sha = ''
        eingebettet = None
        if not url or not url.startswith('http'):
            url = None
            datei = w.get('file64') or w.get('file') or ''
            kand = [n for n in namen if n.startswith('tools/') and n.lower().endswith(('.exe', '.msi'))]
            treffer = [n for n in kand if datei and n.split('/')[-1].lower() == datei.replace('\\', '/').split('/')[-1].lower()]
            eingebettet = (treffer or sorted(kand, key=lambda n: ('64' not in n, n)) or [None])[0]
            if not eingebettet:
                return {**basis, 'fehler': 'keine Download-Adresse im Chocolatey-Skript gefunden'}
        typ = (w.get('filetype') or (url or eingebettet or '').rsplit('.', 1)[-1]).lower()
        typ = 'msi' if typ == 'msi' else 'exe'
        args = w.get('silentargs')
        if args is not None:
            # Teile mit PowerShell-Variablen (meist Log-Pfade) koennen wir nicht nachbilden
            args = ' '.join(t for t in re.findall(r'(?:[^\s"]+|"[^"]*")+', args) if '$' not in t).strip()
            if typ == 'msi':
                args = args or '/qn /norestart'
        if args == '' and typ != 'msi':
            args = None   # leer = Paket installiert bewusst interaktiv
        codes = [0, 3010, 1641]
        for c in re.findall(r'-?\d+', w.get('validexitcodes', '')):
            codes.append(int(c))
        return {**basis, 'url': url, 'eingebettet': eingebettet, 'sha256': sha.lower(), 'typ': typ,
                'args': args, 'nested': None, 'codes': sorted(set(codes)), 'arch': 'x64' if 'url64' in ''.join(w) else None,
                'fehler': None if args is not None else 'Chocolatey kennt keinen Silent-Schalter – bitte Parameter eintragen'}

    def eingebettet_holen(self, pid, pfad):
        z = self._nupkg(pid.split(':', 1)[-1])
        return z.read(pfad)
