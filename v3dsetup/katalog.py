"""winget-Katalog auf V3DA lesen – ohne Windows.

Microsoft verteilt den winget-Index als source.msix (ZIP) mit einer SQLite-
Datenbank (Public/index.db). Darin stehen alle Pakete, ihre Namen, ProductCodes
und der Pfad zum Manifest auf dem CDN. Das Manifest liefert Installer-URL,
SHA-256 und die Silent-Schalter.
"""
import io
import re
import sqlite3
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

import yaml

CDN = 'https://cdn.winget.microsoft.com/cache/'
UA = {'User-Agent': 'V3D-Setup/1.0'}

# Standard-Silent-Schalter je Installer-Typ (wie winget selbst)
STANDARD_SCHALTER = {
    'msi': '/quiet /norestart',
    'wix': '/quiet /norestart',
    'burn': '/quiet /norestart',
    'nullsoft': '/S',
    'inno': '/SP- /VERYSILENT /SUPPRESSMSGBOXES /NORESTART',
    'msix': '',
    'appx': '',
}
UNTERSTUETZT = set(STANDARD_SCHALTER) | {'exe', 'zip'}


def vkey(v):
    """Version sortierbar machen: '1.10.2' > '1.9'."""
    teile = re.split(r'[^0-9A-Za-z]+', str(v))
    out = []
    for t in teile:
        if t.isdigit():
            out.append((1, int(t), ''))
        elif t:
            out.append((0, 0, t.lower()))
    return out


_ARCH = re.compile(r'\b(x64|x86|x86_64|amd64|arm64|64[- ]?bit|32[- ]?bit|win64|win32)\b', re.I)
_VER = re.compile(r'\bv?\d+(\.\d+)+[a-z0-9.-]*\b', re.I)
_KLAMMER = re.compile(r'\([^)]*\)|\[[^\]]*\]')


def normname(name):
    """Name grob wie winget normieren: ohne Version, Architektur, Sprache, Satzzeichen."""
    n = _KLAMMER.sub(' ', name or '')
    n = _VER.sub(' ', n)
    n = _ARCH.sub(' ', n)
    n = re.sub(r'\b(version|ver)\b', ' ', n, flags=re.I)
    return re.sub(r'[^0-9a-zÀ-￿]', '', n.lower())


class Katalog:
    def __init__(self, ordner):
        self.ordner = Path(ordner)
        self.ordner.mkdir(parents=True, exist_ok=True)
        self.db = self.ordner / 'index.db'
        self._lock = threading.Lock()
        self._mcache = {}

    # ---------- Laden ----------
    def stand(self):
        return self.db.stat().st_mtime if self.db.exists() else 0

    def aktualisieren(self, wenn_aelter_als=0):
        if self.db.exists() and time.time() - self.stand() < wenn_aelter_als:
            return False
        with urllib.request.urlopen(urllib.request.Request(CDN + 'source.msix', headers=UA), timeout=120) as r:
            daten = r.read()
        with zipfile.ZipFile(io.BytesIO(daten)) as z:
            inhalt = z.read('Public/index.db')
        tmp = self.db.with_suffix('.neu')
        tmp.write_bytes(inhalt)
        with self._lock:
            tmp.replace(self.db)
            self._mcache.clear()
        return True

    def _c(self):
        if not self.db.exists():
            raise RuntimeError('winget-Katalog noch nicht geladen')
        c = sqlite3.connect(f'file:{self.db}?mode=ro', uri=True)
        return c

    # ---------- Abfragen ----------
    def _neueste(self, c, rowid_liste):
        """Je Paket-ID die neueste Version: {id: (name, version, pathpart)}."""
        out = {}
        for pid, name, ver, pp in rowid_liste:
            alt = out.get(pid)
            if alt is None or vkey(ver) > vkey(alt[1]):
                out[pid] = (name, ver, pp)
        return out

    _SQL = '''select i.id, n.name, v.version, m.pathpart from manifest m
              join ids i on m.id=i.rowid join names n on m.name=n.rowid
              join versions v on m.version=v.rowid'''

    def info(self, pid):
        with self._c() as c:
            rows = c.execute(self._SQL + ' where i.id=?', (pid,)).fetchall()
        if not rows:
            return None
        name, ver, pp = self._neueste(None, rows)[rows[0][0]]
        return {'id': rows[0][0], 'name': name, 'version': ver, 'pp': pp}

    def suche(self, text, limit=40):
        text = (text or '').strip()
        if len(text) < 2:
            return []
        # „AnycubicPhotonWorkshop“ -> Wörter; alle Wörter müssen in ID oder Name vorkommen
        woerter = re.sub(r'([a-z])([A-Z])', r'\1 \2', text).replace('.', ' ').replace('-', ' ').split()
        woerter = [w for w in woerter if len(w) >= 2] or [text]
        bed = ' and '.join(['(i.id like ? or n.name like ?)'] * len(woerter))
        werte = [x for w in woerter for x in (f'%{w}%', f'%{w}%')]
        with self._c() as c:
            rows = c.execute(self._SQL + ' where ' + bed + ' limit 3000', werte).fetchall()
            if not rows and len(woerter) > 1:  # sonst: irgendein Wort (das längste zuerst)
                w = max(woerter, key=len)
                rows = c.execute(self._SQL + ' where i.id like ? or n.name like ? limit 3000',
                                 (f'%{w}%', f'%{w}%')).fetchall()
        best = self._neueste(None, rows)
        t = text.lower()

        def rang(pid):
            name = best[pid][0].lower()
            pl = pid.lower()
            nebenpaket = any(w in pl for w in ('beta', 'nightly', 'preview', 'dev', 'canary', 'insider', 'esr', 'msix'))
            return (nebenpaket,
                    0 if name == t or pl == t or pl.split('.')[-1] == t else
                    1 if name.startswith(t) or pl.split('.')[-1].startswith(t) else 2, len(pid))
        return [{'id': p, 'name': best[p][0], 'version': best[p][1]}
                for p in sorted(best, key=rang)[:limit]]

    def zuordnen(self, programme):
        """Inventar-Einträge winget-IDs zuordnen. programme: [{name, key, ...}].
        Liefert je Eintrag die ID oder None (über ProductCode, sonst normierter Name)."""
        with self._c() as c:
            def ids_fuer(sql, wert):
                return [r[0] for r in c.execute(sql, (wert,)).fetchall()]
            sql_pc = '''select distinct i.id from productcodes pc join productcodes_map pm on pm.productcode=pc.rowid
                        join manifest m on pm.manifest=m.rowid join ids i on m.id=i.rowid where pc.productcode=?'''
            sql_nn = '''select distinct i.id from norm_names nn join norm_names_map nm on nm.norm_name=nn.rowid
                        join manifest m on nm.manifest=m.rowid join ids i on m.id=i.rowid where nn.norm_name in (?, ?||'(X64)', ?||'(X86)')'''
            ergebnis = []
            for p in programme:
                key = (p.get('key') or '').strip().lower()
                treffer = ids_fuer(sql_pc, key) if key else []
                pc_treffer = set(treffer)
                nn = normname(p.get('name'))
                if len(nn) >= 3:
                    treffer += [r[0] for r in c.execute(sql_nn, (nn, nn, nn)).fetchall()]
                ohne_ziffern = re.sub(r'\d', '', nn)
                if not treffer and ohne_ziffern != nn and len(ohne_ziffern) >= 8:
                    treffer = [r[0] for r in c.execute(sql_nn, (ohne_ziffern,) * 3).fetchall()]
                name_l = (p.get('name') or '').lower()
                will = 'x86' if re.search(r'x86|32[- ]?bit', name_l) else 'x64' if re.search(r'x64|64[- ]?bit', name_l) else ''
                anders = {'x64': 'x86', 'x86': 'x64'}.get(will, '#')
                # bei mehreren: ProductCode-Treffer, Hauptpaket (nicht Beta/Nightly), passende Architektur, kürzeste ID
                treffer = sorted(set(treffer), key=lambda x: (
                    x not in pc_treffer,
                    any(w in x.lower() for w in ('beta', 'nightly', 'preview', 'dev', 'canary', 'insider')),
                    anders in x.lower(), len(x), x))
                ergebnis.append(treffer[0] if treffer else None)
        return ergebnis

    # ---------- Manifest + Installer ----------
    def _pfad(self, c, pp):
        teile = []
        while pp:
            parent, s = c.execute('select parent, pathpart from pathparts where rowid=?', (pp,)).fetchone()
            teile.append(s)
            pp = parent
        return '/'.join(reversed(teile))

    def manifest(self, pid):
        inf = self.info(pid)
        if not inf:
            raise KeyError(pid)
        schl = (pid, inf['version'])
        if schl not in self._mcache:
            with self._c() as c:
                url = CDN + self._pfad(c, inf['pp'])
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                self._mcache[schl] = yaml.safe_load(r.read().decode('utf-8', 'replace'))
        return inf, self._mcache[schl]

    def installer(self, pid):
        """Besten Installer wählen + Silent-Aufruf bestimmen."""
        inf, man = self.manifest(pid)
        oben = {k: v for k, v in man.items() if k != 'Installers'}
        kandidaten = []
        for ins in man.get('Installers') or []:
            e = dict(oben)
            e.update(ins)
            sw = dict(oben.get('InstallerSwitches') or {})
            sw.update(ins.get('InstallerSwitches') or {})
            e['InstallerSwitches'] = sw
            kandidaten.append(e)

        def typ_von(e):
            t = (e.get('InstallerType') or '').lower()
            return t

        def rang(e):
            arch = (e.get('Architecture') or '').lower()
            scope = (e.get('Scope') or '').lower()
            loc = (e.get('InstallerLocale') or '').lower()
            t = typ_von(e)
            return (
                0 if t in UNTERSTUETZT else 1,
                {'x64': 0, 'neutral': 1, 'x86': 2}.get(arch, 9),
                {'machine': 0, '': 1, 'user': 2}.get(scope, 1),
                0 if loc.startswith('de') else 1 if loc in ('', 'en-us', 'en') else 2,
            )
        kandidaten = [k for k in kandidaten if (k.get('Architecture') or '').lower() != 'arm64' and k.get('InstallerUrl')]
        if not kandidaten:
            return {**inf, 'fehler': 'kein passender Installer (nur Store/ARM?)'}
        e = sorted(kandidaten, key=rang)[0]
        typ = typ_von(e)
        nested = None
        lauf_typ = typ
        if typ == 'zip':
            nt = (e.get('NestedInstallerType') or '').lower()
            files = e.get('NestedInstallerFiles') or []
            if nt in ('portable',) or not files:
                return {**inf, 'fehler': 'ZIP ohne Installer (portable) – nur per winget'}
            nested = files[0].get('RelativeFilePath')
            lauf_typ = nt
        if lauf_typ not in UNTERSTUETZT or lauf_typ == 'zip':
            return {**inf, 'fehler': f'Installer-Typ {lauf_typ} wird nicht unterstützt'}
        sw = e.get('InstallerSwitches') or {}
        silent = sw.get('Silent')
        if silent is None:
            silent = STANDARD_SCHALTER.get(lauf_typ)
        args = None if silent is None else ' '.join(x for x in (str(silent), str(sw.get('Custom') or '')) if x).strip()
        codes = [0, 3010, 1641] + [int(x) for x in (e.get('InstallerSuccessCodes') or []) if str(x).lstrip('-').isdigit()]
        return {
            **inf,
            'url': e['InstallerUrl'],
            'sha256': (e.get('InstallerSha256') or '').lower(),
            'typ': lauf_typ,
            'nested': nested,
            'args': args,
            'arch': e.get('Architecture'),
            'scope': e.get('Scope'),
            'codes': sorted(set(codes)),
            'fehler': None if args is not None else 'kein Silent-Schalter bekannt – bitte Parameter eintragen',
        }
