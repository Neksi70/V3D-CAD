"""Aufträge aus Claude Chat an Claude Code auf V3DA übergeben (headless, asynchron).

code_auftrag legt einen Job unter ~/code-auftraege/<id>/ an und startet ihn als eigene
systemd-User-Unit (`systemd-run --user`): so überlebt er einen Neustart des MCP-Dienstes,
hat ein hartes Zeitlimit (RuntimeMaxSec) und lässt sich mit `systemctl --user stop` abbrechen.
Gleichzeitig laufen höchstens MAX_PARALLEL Jobs, der Rest wartet; jeder fertige Job startet
den nächsten (zusätzlich räumen code_status/code_liste auf, falls ein Läufer hart beendet wurde).

Je Job-Ordner: auftrag.md (Text), meta.json (Zustand), ausgabe.jsonl (stream-json von Claude),
ergebnis.md (Abschlussbericht), stderr.txt. Kurzbericht zusätzlich ins gemeinsame Gedächtnis
(eine feste Datei code-auftraege-protokoll.md, nicht als „eingang-…“).

Sicherheit: nur über den OAuth-geschützten MCP-Server erreichbar (kein eigener Endpunkt);
Claude läuft im Modus "auto" (Klassifizierer blockt Riskantes) mit Sperrliste und einer
angehängten Systemvorgabe, folgenreiche Schritte nur aufzulisten statt auszuführen.
"""
import fcntl
import json
import os
import re
import secrets
import subprocess
import sys
import time

if __name__ == '__main__':      # Läufer: Mail-Kern (mit Kontodaten) gar nicht erst laden
    MailError = RuntimeError
else:
    from .core import MailError

HOME = os.path.expanduser('~')
BASIS = os.path.expanduser(os.environ.get('CODE_AUFTRAG_DIR') or '~/code-auftraege')
CLAUDE = os.environ.get('CODE_AUFTRAG_CLAUDE') or os.path.join(HOME, '.npm-global/bin/claude')
MAX_PARALLEL = int(os.environ.get('CODE_AUFTRAG_PARALLEL') or 1)
MAX_MINUTEN = int(os.environ.get('CODE_AUFTRAG_MINUTEN') or 60)
MAX_ZEICHEN = 20000
GEDAECHTNIS = os.path.join(os.path.expanduser(os.environ.get('GEDAECHTNIS_DIR')
                                              or '~/.claude/projects/-home-v3da/memory'),
                           'code-auftraege-protokoll.md')
PYTHON = sys.executable
_ID = re.compile(r'^[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$')

REGELN = """\
Dieser Auftrag kommt aus Claude Chat über das Werkzeug code_auftrag (V3D-Mail-MCP). Volker sieht \
deine Arbeit NICHT live und kann keine Rückfragen beantworten – arbeite selbstständig, triff sinnvolle \
Annahmen und nenne sie im Bericht. Antworte auf Deutsch.

Zerstörerische oder folgenreiche Schritte führst du NICHT aus, sondern listest sie am Ende unter der \
Überschrift „Wartet auf Bestätigung“ (genauer Befehl/Schritt + Grund). Dazu gehören: Dateien oder \
Daten löschen/überschreiben ohne Sicherung, Drucker-Neustart/FIRMWARE_RESTART/SAVE_CONFIG, einen Druck \
starten, Mails senden, Dienste oder Dateien auf netcup ändern, git push, sudo, Ausrollen an Tester. \
Volker bestätigt dann per neuem code_auftrag.

Ende deiner Antwort = Abschlussbericht: was erledigt ist, was geprüft wurde (geprüft vs. vermutet \
trennen), geänderte Dateien, offene Punkte, „Wartet auf Bestätigung“."""

GESPERRT = [
    'Bash(sudo *)', 'Bash(git push*)', 'Bash(rm -rf *)', 'Bash(ssh *)', 'Bash(scp *)', 'Bash(rsync *)',
    'Bash(*ausrollen*)', 'Bash(*FIRMWARE_RESTART*)', 'Bash(*SAVE_CONFIG*)', 'Bash(*printer/print/start*)',
    'Bash(*shutdown*)', 'Bash(*reboot*)',
    # keine Rekursion und keine folgenreichen Connector-Werkzeuge
    'mcp__claude_ai_V3D_Mail__code_auftrag', 'mcp__claude_ai_V3D_Mail__code_abbrechen',
    'mcp__claude_ai_V3D_Mail__send_message', 'mcp__claude_ai_V3D_Mail__drucker_druck',
    'mcp__claude_ai_V3D_Mail__drucker_gcode', 'mcp__claude_ai_V3D_Mail__drucker_datei_loeschen',
    'mcp__claude_ai_V3D_Mail__move_message', 'mcp__claude_ai_V3D_Mail__delete_event',
    'mcp__claude_ai_V3D_Mail__familie_delete_event', 'mcp__claude_ai_Gmail__send_message',
    'mcp__claude_ai_Gmail__forward', 'mcp__claude_ai_Gmail__reply',
    'mcp__claude-code-remote__send_message', 'mcp__claude-code-remote__create_session',
    'mcp__claude-code-remote__create_trigger',
]


def _jetzt():
    return time.strftime('%Y-%m-%dT%H:%M:%S')


def _ordner(job_id):
    if not _ID.match(job_id or ''):
        raise MailError('Unbekannte Job-ID "%s" (Form JJJJMMTT-HHMMSS-xxxx, siehe code_liste).' % job_id)
    d = os.path.join(BASIS, job_id)
    if not os.path.isdir(d):
        raise MailError('Job %s gibt es nicht (code_liste zeigt die letzten).' % job_id)
    return d


def _meta_lesen(d):
    with open(os.path.join(d, 'meta.json'), encoding='utf-8') as fh:
        return json.load(fh)


def _meta_schreiben(d, meta):
    tmp = os.path.join(d, 'meta.json.tmp')
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, os.path.join(d, 'meta.json'))


class _Sperre:
    def __enter__(self):
        os.makedirs(BASIS, mode=0o700, exist_ok=True)
        self.fh = open(os.path.join(BASIS, '.sperre'), 'w')
        fcntl.flock(self.fh, fcntl.LOCK_EX)
        return self

    def __exit__(self, *a):
        fcntl.flock(self.fh, fcntl.LOCK_UN)
        self.fh.close()


def _alle_ids():
    if not os.path.isdir(BASIS):
        return []
    return sorted((n for n in os.listdir(BASIS) if _ID.match(n)), reverse=True)


def _unit(job_id):
    return 'code-auftrag-' + job_id


def _unit_aktiv(job_id):
    r = subprocess.run(['systemctl', '--user', 'is-active', _unit(job_id)],
                       capture_output=True, text=True)
    return r.stdout.strip() in ('active', 'activating', 'deactivating')


def _pruefen_ordner(ordner):
    pfad = os.path.realpath(os.path.expanduser(ordner or '~'))
    if not (pfad == HOME or pfad.startswith(HOME + os.sep)):
        raise MailError('Arbeitsordner muss unter %s liegen.' % HOME)
    if any(t.startswith('.') for t in os.path.relpath(pfad, HOME).split(os.sep) if t != '.'):
        raise MailError('Versteckte Ordner (z. B. ~/.ssh, ~/.config) sind als Arbeitsordner nicht erlaubt.')
    if not os.path.isdir(pfad):
        raise MailError('Ordner %s gibt es nicht.' % pfad)
    return pfad


# --- Aufräumen + Warteschlange -------------------------------------------------

def _aufraeumen():
    """Hart beendete Läufer (Zeitlimit, Absturz) als Fehler markieren, wartende Jobs starten.
    Muss unter _Sperre laufen."""
    laufend, wartend = 0, []
    for job_id in _alle_ids():
        d = os.path.join(BASIS, job_id)
        try:
            meta = _meta_lesen(d)
        except (OSError, ValueError):
            continue
        if meta['status'] == 'läuft':
            if _unit_aktiv(job_id):
                laufend += 1
            else:
                meta.update(status='fehler', ende=_jetzt(),
                            fehler=meta.get('fehler') or 'Läufer beendet ohne Abschluss '
                            '(Zeitlimit %d min oder Absturz).' % MAX_MINUTEN)
                _meta_schreiben(d, meta)
        elif meta['status'] == 'wartet':
            wartend.append((job_id, d, meta))
    for job_id, d, meta in sorted(wartend, key=lambda x: x[0]):
        if laufend >= MAX_PARALLEL:
            break
        _starten(job_id, d, meta)
        laufend += 1


def _starten(job_id, d, meta):
    cmd = ['systemd-run', '--user', '--unit=' + _unit(job_id), '--collect', '--quiet',
           '--property=RuntimeMaxSec=%d' % (MAX_MINUTEN * 60 + 120),
           '--property=KillMode=control-group',
           '--working-directory=' + meta['ordner'],
           '--setenv=PATH=%s/.npm-global/bin:%s/.local/bin:/usr/local/bin:/usr/bin:/bin' % (HOME, HOME),
           '--setenv=HOME=' + HOME,
           '--setenv=PYTHONPATH=' + os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
           PYTHON, '-m', 'v3dmcp.code', 'laeufer', job_id]
    meta.update(status='läuft', start=_jetzt())
    _meta_schreiben(d, meta)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        meta.update(status='fehler', ende=_jetzt(), fehler='Start fehlgeschlagen: ' + (r.stderr or r.stdout)[-500:])
        _meta_schreiben(d, meta)


# --- Werkzeuge -------------------------------------------------------------------

def auftrag(text, ordner=None, titel=None):
    text = (text or '').strip()
    if not text:
        raise MailError('Auftragstext fehlt.')
    if len(text) > MAX_ZEICHEN:
        raise MailError('Auftrag zu lang (max. %d Zeichen).' % MAX_ZEICHEN)
    pfad = _pruefen_ordner(ordner)
    titel = re.sub(r'\s+', ' ', (titel or text.splitlines()[0])).strip()[:100]
    with _Sperre():
        job_id = time.strftime('%Y%m%d-%H%M%S-') + secrets.token_hex(2)
        d = os.path.join(BASIS, job_id)
        os.makedirs(d, mode=0o700)
        with open(os.path.join(d, 'auftrag.md'), 'w', encoding='utf-8') as fh:
            fh.write(text + '\n')
        meta = {'id': job_id, 'titel': titel, 'ordner': pfad, 'status': 'wartet',
                'angelegt': _jetzt(), 'start': None, 'ende': None}
        _meta_schreiben(d, meta)
        _aufraeumen()
        meta = _meta_lesen(d)
        vor = sum(1 for i in _alle_ids() if i < job_id and _status_kurz(i) in ('wartet', 'läuft'))
    return {'job_id': job_id, 'status': meta['status'], 'titel': titel, 'ordner': pfad,
            'auftraege_davor': vor,
            'hinweis': 'Läuft im Hintergrund (bis %d min). Später code_status("%s") bzw. code_ergebnis("%s") '
                       'aufrufen – nicht in einer Schleife warten.' % (MAX_MINUTEN, job_id, job_id)}


def _status_kurz(job_id):
    try:
        return _meta_lesen(os.path.join(BASIS, job_id))['status']
    except (OSError, ValueError):
        return '?'


def _dauer(meta):
    if not meta.get('start'):
        return None
    a = time.mktime(time.strptime(meta['start'], '%Y-%m-%dT%H:%M:%S'))
    e = time.mktime(time.strptime(meta['ende'], '%Y-%m-%dT%H:%M:%S')) if meta.get('ende') else time.time()
    s = int(e - a)
    return '%d min %02d s' % (s // 60, s % 60)


def _verlauf(d, anzahl=8):
    """Letzte Schritte aus ausgabe.jsonl: Werkzeugaufrufe und Textstücke, je eine Zeile."""
    zeilen = []
    try:
        with open(os.path.join(d, 'ausgabe.jsonl'), encoding='utf-8', errors='replace') as fh:
            for roh in fh:
                try:
                    ev = json.loads(roh)
                except ValueError:
                    continue
                if ev.get('type') != 'assistant':
                    continue
                for teil in ev.get('message', {}).get('content', []):
                    if teil.get('type') == 'text' and teil.get('text', '').strip():
                        zeilen.append('💬 ' + re.sub(r'\s+', ' ', teil['text']).strip()[:200])
                    elif teil.get('type') == 'tool_use':
                        e = teil.get('input') or {}
                        was = e.get('description') or e.get('file_path') or e.get('command') or e.get('pattern') or ''
                        zeilen.append('🔧 %s %s' % (teil.get('name'), re.sub(r'\s+', ' ', str(was))[:150]))
    except OSError:
        pass
    return zeilen[-anzahl:]


def status(job_id):
    d = _ordner(job_id)
    with _Sperre():
        _aufraeumen()
        meta = _meta_lesen(d)
    antwort = {'job_id': job_id, 'titel': meta['titel'], 'status': meta['status'],
               'angelegt': meta['angelegt'], 'start': meta.get('start'), 'ende': meta.get('ende'),
               'laufzeit': _dauer(meta), 'letzte_schritte': _verlauf(d)}
    if meta.get('fehler'):
        antwort['fehler'] = meta['fehler']
    if meta['status'] in ('fertig', 'fehler', 'abgebrochen'):
        antwort['hinweis'] = 'Bericht mit code_ergebnis("%s").' % job_id
    elif meta['status'] == 'wartet':
        antwort['hinweis'] = 'Wartet, bis der laufende Auftrag fertig ist.'
    return antwort


def ergebnis(job_id):
    d = _ordner(job_id)
    with _Sperre():
        _aufraeumen()
        meta = _meta_lesen(d)
    if meta['status'] in ('wartet', 'läuft'):
        return {'job_id': job_id, 'status': meta['status'], 'laufzeit': _dauer(meta),
                'hinweis': 'Noch nicht fertig – später erneut code_ergebnis bzw. code_status.'}
    try:
        with open(os.path.join(d, 'ergebnis.md'), encoding='utf-8') as fh:
            bericht = fh.read()
    except OSError:
        bericht = ''
    return {'job_id': job_id, 'titel': meta['titel'], 'status': meta['status'],
            'laufzeit': _dauer(meta), 'kosten_usd': meta.get('kosten_usd'),
            'geaenderte_dateien': meta.get('dateien') or [],
            'fehler': meta.get('fehler'), 'bericht': bericht[-30000:] or '(kein Bericht)'}


def liste(anzahl=10):
    with _Sperre():
        _aufraeumen()
        jobs = []
        for job_id in _alle_ids()[:max(1, min(anzahl, 50))]:
            try:
                meta = _meta_lesen(os.path.join(BASIS, job_id))
            except (OSError, ValueError):
                continue
            jobs.append({'job_id': job_id, 'titel': meta['titel'], 'status': meta['status'],
                         'angelegt': meta['angelegt'], 'laufzeit': _dauer(meta)})
    return {'jobs': jobs, 'max_parallel': MAX_PARALLEL, 'zeitlimit_min': MAX_MINUTEN}


def abbrechen(job_id):
    d = _ordner(job_id)
    with _Sperre():
        meta = _meta_lesen(d)
        if meta['status'] not in ('wartet', 'läuft'):
            return {'job_id': job_id, 'status': meta['status'], 'hinweis': 'War schon beendet.'}
        war = meta['status']
        meta.update(status='abgebrochen', ende=_jetzt(), fehler='Abgebrochen per code_abbrechen.')
        _meta_schreiben(d, meta)
        if war == 'läuft':
            subprocess.run(['systemctl', '--user', 'stop', _unit(job_id)], capture_output=True)
        _protokoll(meta, '')
        _aufraeumen()
    return {'job_id': job_id, 'status': 'abgebrochen', 'vorher': war}


# --- Läufer (eigener Prozess in der systemd-Unit) ---------------------------------

def _laeufer(job_id):
    d = os.path.join(BASIS, job_id)
    meta = _meta_lesen(d)
    with open(os.path.join(d, 'auftrag.md'), encoding='utf-8') as fh:
        text = fh.read()
    cmd = [CLAUDE, '-p', '--output-format', 'stream-json', '--verbose',
           '--permission-mode', 'auto', '--name', 'code_auftrag ' + job_id,
           '--append-system-prompt', REGELN, '--disallowedTools', *GESPERRT]
    fehler = None
    try:
        with open(os.path.join(d, 'ausgabe.jsonl'), 'w') as aus, \
                open(os.path.join(d, 'stderr.txt'), 'w') as err:
            p = subprocess.run(cmd, input=text, stdout=aus, stderr=err, text=True,
                               cwd=meta['ordner'], timeout=MAX_MINUTEN * 60)
        if p.returncode != 0:
            fehler = 'Claude Code endete mit Code %d.' % p.returncode
    except subprocess.TimeoutExpired:
        fehler = 'Zeitlimit von %d min erreicht – abgebrochen.' % MAX_MINUTEN

    bericht, kosten, dateien = '', None, []
    with open(os.path.join(d, 'ausgabe.jsonl'), encoding='utf-8', errors='replace') as fh:
        for roh in fh:
            try:
                ev = json.loads(roh)
            except ValueError:
                continue
            if ev.get('type') == 'result':
                bericht = ev.get('result') or bericht
                kosten = ev.get('total_cost_usd')
                if ev.get('is_error') and not fehler:
                    fehler = 'Claude Code meldet Fehler (%s).' % ev.get('subtype')
            elif ev.get('type') == 'assistant':
                for teil in ev.get('message', {}).get('content', []):
                    if teil.get('type') == 'tool_use' and teil.get('name') in ('Edit', 'Write', 'NotebookEdit', 'MultiEdit'):
                        f = (teil.get('input') or {}).get('file_path') or (teil.get('input') or {}).get('notebook_path')
                        if f and f not in dateien:
                            dateien.append(f)
    if not bericht and fehler:
        try:
            with open(os.path.join(d, 'stderr.txt'), encoding='utf-8', errors='replace') as fh:
                bericht = 'Fehlerausgabe:\n' + fh.read()[-3000:]
        except OSError:
            pass
    with open(os.path.join(d, 'ergebnis.md'), 'w', encoding='utf-8') as fh:
        fh.write(bericht + '\n')

    with _Sperre():
        meta = _meta_lesen(d)
        if meta['status'] != 'abgebrochen':
            meta.update(status='fehler' if fehler else 'fertig', fehler=fehler)
        meta.update(ende=meta.get('ende') or _jetzt(), kosten_usd=kosten, dateien=dateien)
        _meta_schreiben(d, meta)
        _protokoll(meta, bericht)
    # nächsten Job erst starten, wenn diese Unit gleich endet: kurz als eigener Schritt
    with _Sperre():
        _aufraeumen_ohne(job_id)


def _aufraeumen_ohne(eigene_id):
    """Wie _aufraeumen, zählt aber die eigene (gerade endende) Unit nicht als laufend."""
    laufend = sum(1 for i in _alle_ids() if i != eigene_id and _status_kurz(i) == 'läuft' and _unit_aktiv(i))
    for job_id in sorted(i for i in _alle_ids() if _status_kurz(i) == 'wartet'):
        if laufend >= MAX_PARALLEL:
            break
        d = os.path.join(BASIS, job_id)
        _starten(job_id, d, _meta_lesen(d))
        laufend += 1


def _protokoll(meta, bericht):
    """Kurzbericht ins gemeinsame Gedächtnis (eine Datei, neueste oben, max. 30 Einträge)."""
    kurz = re.sub(r'\s+', ' ', bericht).strip()[:600]
    eintrag = '### %s · %s · %s\n%s\nJob-Ordner: ~/code-auftraege/%s%s\n' % (
        meta['ende'][:16].replace('T', ' '), meta['status'], meta['titel'], kurz or '(kein Bericht)',
        meta['id'], ('\nGeändert: ' + ', '.join(meta['dateien'][:15])) if meta.get('dateien') else '')
    kopf = ('---\nname: code-auftraege-protokoll\ndescription: "Protokoll der Aufträge, die Claude Chat per '
            'code_auftrag an Claude Code (headless auf V3DA) gegeben hat – neueste oben"\nmetadata:\n'
            '  type: project\n---\n\n# code_auftrag – Protokoll\n\nVoller Bericht: ~/code-auftraege/<id>/ergebnis.md '
            'bzw. code_ergebnis(<id>).\n\n')
    alt = ''
    try:
        with open(GEDAECHTNIS, encoding='utf-8') as fh:
            alt = fh.read()
    except OSError:
        pass
    eintraege = re.split(r'(?m)^(?=### )', alt)
    eintraege = [e for e in eintraege if e.startswith('### ')][:29]
    with open(GEDAECHTNIS, 'w', encoding='utf-8') as fh:
        fh.write(kopf + eintrag + '\n' + '\n'.join(e.rstrip() + '\n' for e in eintraege))


if __name__ == '__main__' and len(sys.argv) == 3 and sys.argv[1] == 'laeufer':
    _laeufer(sys.argv[2])
