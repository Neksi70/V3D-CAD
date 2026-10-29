"""Dritte Quelle: offiziellen Download im Netz finden – per Claude (headless).

Fuer Programme, die weder winget noch Chocolatey kennen. Claude (claude -p,
nur WebSearch/WebFetch erlaubt) sucht den direkten Link zum Installer auf der
Hersteller-Domain. V3DA prueft danach selbst, dass der Link wirklich eine
Installationsdatei liefert (keine Webseite, sinnvolle Groesse).
Ergebnisse werden 30 Tage gemerkt – jedes Programm wird nur einmal gesucht.
"""
import json
import os
import re
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

CLAUDE = os.environ.get('V3DSETUP_CLAUDE', os.path.expanduser('~/.npm-global/bin/claude'))
MODELL = os.environ.get('V3DSETUP_MODELL', 'sonnet')
GLEICHZEITIG = threading.BoundedSemaphore(2)
UA_LISTE = ('V3D-Setup/1.0 (curl-kompatibel)',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36')
ENDUNGEN = ('.exe', '.msi', '.zip', '.msix', '.msixbundle', '.appx')

AUFTRAG = '''Finde den DIREKTEN Download-Link (eine URL, die sofort die Installationsdatei .exe/.msi/.zip liefert –
keine Webseite, kein Download-Knopf-Seite) des offiziellen Windows-64-Bit-Installers von:
  Programm: "{name}"
  Hersteller: "{hersteller}"
  zuletzt installierte Version: "{version}"
Regeln: Nur offizielle Quellen des Herstellers (eigene Domain, dessen CDN, dessen GitHub-Releases).
KEINE Download-Portale (chip, softonic, filehippo, uptodown, softpedia, majorgeeks …).
Nimm die neueste Version. Wenn es das Programm nicht mehr gibt oder nur nach Anmeldung/Kauf, sag das.
Antworte NUR mit JSON in einer Zeile:
{{"url": "...", "version": "...", "quelle": "<Seite, auf der der Link steht>", "hinweis": "<kurz, deutsch>"}}
Wenn nichts Offizielles zu finden ist: {{"url": null, "hinweis": "<warum, kurz, deutsch>"}}{nachtrag}'''
NACHTRAG = '''
WICHTIG: Diese Links wurden schon geprueft und funktionieren NICHT – such einen anderen (z. B. neuere Version,
andere offizielle Seite wie Wiki/Support/Hilfe-Center des Herstellers):
{liste}'''


def anzeigename(name):
    """'Split3r version 1.3.1' -> 'Split3r' (Version gehoert nicht zum Namen)."""
    n = re.sub(r'\s*\(?\b(version\s*)?v?\d+(\.\d+)+[\w.-]*\)?', ' ', name or '', flags=re.I)
    return re.sub(r'\s+', ' ', n).strip() or (name or '').strip()


def schluessel(name):
    return re.sub(r'[^a-z0-9]+', '', anzeigename(name).lower())


class Netzsuche:
    def __init__(self, ordner):
        self.datei = Path(ordner) / 'netzsuche.json'
        self._lock = threading.Lock()
        self.laeuft = set()
        try:
            self._cache = json.loads(self.datei.read_text())
        except (OSError, ValueError):
            self._cache = {}

    def _merken(self, k, wert):
        with self._lock:
            self._cache[k] = wert
            tmp = self.datei.with_suffix('.tmp')
            tmp.write_text(json.dumps(self._cache, ensure_ascii=False, indent=1))
            tmp.replace(self.datei)

    def bekannt(self, name):
        e = self._cache.get(schluessel(name))
        # Treffer und „gibt es nicht offiziell“ 30 Tage merken, tote Links nur 1 Tag
        frist = 86400 if (e and e.get('url') and not e.get('ok')) else 30 * 86400
        if e and time.time() - e.get('t', 0) < frist:
            return e
        return None

    # ---------- Link pruefen ----------
    @staticmethod
    def pruefen(url):
        """Liefert der Link wirklich einen Installer? -> (ok, groesse, dateiname, grund)"""
        if not re.match(r'^https?://', url or ''):
            return False, 0, None, 'keine Web-Adresse'
        letzter = 'nicht erreichbar'
        versuche = [(ua, rng) for ua in UA_LISTE for rng in (True, False)]   # manche CDNs verbieten Teil-Anfragen (403)
        for ua, rng in versuche:
            try:
                kopf = {'User-Agent': ua}
                if rng:
                    kopf['Range'] = 'bytes=0-1023'
                req = urllib.request.Request(url, headers=kopf)
                with urllib.request.urlopen(req, timeout=30) as r:
                    typ = (r.headers.get('Content-Type') or '').lower()
                    anfang = r.read(1024)
                    gesamt = r.headers.get('Content-Range', '').rsplit('/', 1)[-1]
                    groesse = int(gesamt) if gesamt.isdigit() else int(r.headers.get('Content-Length') or 0)
                    cd = r.headers.get('Content-Disposition') or ''
                    m = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)', cd)
                    name = urllib.parse.unquote(m.group(1) if m else os.path.basename(urllib.parse.urlparse(r.geturl()).path))
                if 'text/html' in typ or anfang.lstrip().lower().startswith((b'<!doctype', b'<html')):
                    letzter = 'Link fuehrt auf eine Webseite'
                    continue
                if not (anfang.startswith(b'MZ') or anfang.startswith(b'PK') or anfang.startswith(b'\xd0\xcf\x11\xe0')):
                    letzter = 'keine Installationsdatei (weder EXE, MSI noch ZIP)'
                    continue
                if groesse and groesse < 200_000:
                    letzter = 'Datei verdaechtig klein'
                    continue
                if not name.lower().endswith(ENDUNGEN):
                    name += '.msi' if anfang.startswith(b'\xd0\xcf\x11\xe0') else '.zip' if anfang.startswith(b'PK') else '.exe'
                return True, groesse, name, None
            except Exception as e:
                letzter = str(e)[:120]
        return False, 0, None, letzter

    # ---------- Claude fragen ----------
    def _claude(self, prog, schlecht=()):
        prog = {k: str(v or '').replace('\x00', '').strip() for k, v in prog.items()}
        nachtrag = NACHTRAG.format(liste='\n'.join(f'- {u} ({g})' for u, g in schlecht)) if schlecht else ''
        auftrag = AUFTRAG.format(name=prog.get('name', ''), hersteller=prog.get('publisher') or 'unbekannt',
                                 version=prog.get('version') or 'unbekannt', nachtrag=nachtrag)
        cmd = [CLAUDE, '-p', auftrag, '--output-format', 'json', '--model', MODELL,
               '--allowedTools', 'WebSearch,WebFetch',
               '--disallowedTools', 'Edit,Write,NotebookEdit,Bash,Read,Grep,Glob,Task']
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300, cwd='/tmp',
                           env={**os.environ, 'CLAUDE_CODE_ENTRYPOINT': 'v3dsetup'})
        if r.returncode != 0:
            raise RuntimeError((r.stderr or r.stdout or 'claude-Fehler')[-200:])
        text = json.loads(r.stdout).get('result') or ''
        m = re.search(r'\{.*\}', text, re.S)
        if not m:
            raise RuntimeError('Antwort ohne JSON: ' + text[:120])
        return json.loads(m.group(0))

    def suchen(self, prog, neu=False):
        """Sucht (oder liefert Gemerktes). Ergebnis: {url, version, quelle, hinweis, groesse, datei, ok}"""
        if os.environ.get('V3DSETUP_NETZ') == '0':   # fuer Tests: keine echten Claude-Laeufe
            return {'ok': False, 'hinweis': 'Netzsuche abgeschaltet', 't': time.time()}
        k = schluessel(prog.get('name'))
        if not neu:
            alt = self.bekannt(prog.get('name'))
            if alt:
                return alt
        if k in self.laeuft:
            return None
        self.laeuft.add(k)
        try:
            schlecht = []
            erg = None
            for versuch in range(3):          # taugt der Link nicht: mit Hinweis darauf neu suchen
                with GLEICHZEITIG:
                    try:
                        a = self._claude(prog, schlecht)
                    except Exception as e:
                        if erg:
                            break
                        # Fehler nicht 30 Tage merken – naechstes Mal neu versuchen
                        return {'ok': False, 'hinweis': 'Netzsuche ging nicht: ' + str(e)[:150], 't': time.time()}
                erg = {'url': a.get('url'), 'version': a.get('version'), 'quelle': a.get('quelle'),
                       'hinweis': a.get('hinweis'), 'name': prog.get('name'), 't': time.time(), 'versuche': versuch + 1}
                if not erg['url']:
                    erg['ok'] = False
                    break
                ok, groesse, datei, grund = self.pruefen(erg['url'])
                erg.update(ok=ok, groesse=groesse, datei=datei)
                if ok:
                    break
                schlecht.append((erg['url'], grund))
                erg['hinweis'] = f'gefundene Links taugen nicht ({grund})'
            self._merken(k, erg)
            return erg
        finally:
            self.laeuft.discard(k)
