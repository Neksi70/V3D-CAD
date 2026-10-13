"""Gemeinsames Gedächtnis: das Auto-Gedächtnis von Claude Code (Markdown-Dateien
mit Frontmatter + Übersicht MEMORY.md) für Claude Chat/Cowork lesbar machen.

Lesen liefert alles mit ausgeblendeten Geheimnissen (PINs, Codes, Tokens).
Schreiben legt nur NEUE Dateien „eingang-…" an und hängt eine Zeile unter
einem eigenen Abschnitt an MEMORY.md — bestehende Einträge bleiben unberührt.
"""
import os
import re
import threading
import time

from .core import MailError

DIR = os.path.expanduser(os.environ.get('GEDAECHTNIS_DIR')
                         or '~/.claude/projects/-home-v3da/memory')
INDEX = 'MEMORY.md'
EINGANG_KOPF = '## Eingang aus Claude Chat/Cowork'
MAX_EINGANG = 100
_lock = threading.Lock()
_NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$')

# --- Geheimnisse ausblenden ----------------------------------------------------

AUS = '[ausgeblendet]'
# Wert hinter einem Stichwort: „PIN 1234", „Code: 0705", „Einladungscode 73FDC4"
_STICHWORT = re.compile(
    r'(\b(?:PIN|Pin|[Cc]ode|(?:Einladungs|Zahlen|Zugangs|Sicherheits|Geheim)code|Passwort|Kennwort'
    r'|[Pp]assword|[Tt]oken|Schlüssel|[Kk]ey|[Ss]ecret)\b'
    r'(?:[ \t]+(?:ist|lautet|ist jetzt))?[ \t]*[:=]?[ \t]*[`"„]?)([A-Za-z0-9]{4,})')
# Lange Zufallsketten (Tokens, API-Schlüssel, Abo-Links): Buchstaben UND Ziffern
_LANG = re.compile(r'[A-Za-z0-9_\-]{16,}')
# Bekannte Schlüssel-Formen
_PRAEFIX = re.compile(r'\b(?:sk-[A-Za-z0-9_\-]{10,}|hf_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{10,}'
                      r'|xox[abprs]-[A-Za-z0-9\-]{10,}|AKIA[A-Z0-9]{12,})')


def _lang_ersetzen(m):
    s = m.group(0)
    teile = re.split(r'[-_]', s)
    # Zufällig aussehend: Groß + Klein + ≥2 Ziffern, keine längeren Wortstücke;
    # oder reiner Hex-Schlüssel ab 32 Zeichen. Dateinamen/Rechnernamen bleiben.
    zufall = (re.search(r'[A-Z]', s) and re.search(r'[a-z]', s)
              and sum(c.isdigit() for c in s) >= 2
              and not re.search(r'[a-z]{7,}|[A-Z][a-z]{5,}', s)
              and max(len(t) for t in teile) >= 12)
    if zufall or re.fullmatch(r'[0-9a-fA-F]{32,}', s):
        return AUS
    return s


def ausblenden(text):
    text = _PRAEFIX.sub(AUS, text)
    text = _STICHWORT.sub(lambda m: m.group(1) + AUS if re.search(r'\d', m.group(2)) else m.group(0), text)
    return _LANG.sub(_lang_ersetzen, text)


# --- Dateien -----------------------------------------------------------------------

def _pfad(name):
    name = (name or '').strip()
    if not name.endswith('.md'):
        name += '.md'
    if not _NAME.match(name):
        raise MailError('Ungültiger Name.')
    pfad = os.path.join(DIR, name)
    if os.path.dirname(os.path.realpath(pfad)) != os.path.realpath(DIR) or not os.path.isfile(pfad):
        raise MailError('Eintrag „%s" gibt es nicht — gedaechtnis_suchen nutzen.' % name[:-3])
    return pfad


def _lesen(pfad):
    with open(pfad, encoding='utf-8', errors='replace') as fh:
        return fh.read()


def _kopf(text):
    """Frontmatter → (name, description, Rumpf)."""
    m = re.match(r'^---\n(.*?)\n---\n?', text, re.S)
    if not m:
        return None, None, text
    fm = m.group(1)
    def feld(k):
        f = re.search(r'^%s:\s*(.*)$' % k, fm, re.M)
        return f.group(1).strip().strip('"\'') if f else None
    return feld('name'), feld('description'), text[m.end():]


def _alle():
    for datei in sorted(os.listdir(DIR)):
        if datei.endswith('.md') and datei != INDEX:
            yield datei, os.path.join(DIR, datei)


def _norm(s):
    s = s.lower()
    for a, b in (('ä', 'ae'), ('ö', 'oe'), ('ü', 'ue'), ('ß', 'ss')):
        s = s.replace(a, b)
    return s


# --- Werkzeuge ---------------------------------------------------------------------

def index():
    return {'verzeichnis': 'Claude-Code-Gedächtnis (V3DA)',
            'index': ausblenden(_lesen(os.path.join(DIR, INDEX)))}


def suchen(stichwort, limit=8):
    woerter = [_norm(w) for w in re.split(r'\s+', stichwort or '') if len(w) >= 2]
    if not woerter:
        raise MailError('Bitte ein Stichwort angeben.')
    treffer = []
    for datei, pfad in _alle():
        text = _lesen(pfad)
        name, beschr, rumpf = _kopf(text)
        n_text, n_kopf = _norm(text), _norm(datei + ' ' + (beschr or ''))
        gefunden = [w for w in woerter if w in n_text or w in n_kopf]
        if not gefunden:
            continue
        punkte = len(gefunden) * 100 + sum(5 for w in gefunden if w in n_kopf) \
            + min(sum(n_text.count(w) for w in gefunden), 30)
        stellen = []
        for zeile in rumpf.splitlines():
            if any(w in _norm(zeile) for w in woerter) and zeile.strip():
                stellen.append(ausblenden(zeile.strip())[:300])
                if len(stellen) >= 3:
                    break
        treffer.append((punkte, {'name': datei[:-3], 'beschreibung': ausblenden(beschr or ''),
                                 'fundstellen': stellen,
                                 'alle_woerter': len(gefunden) == len(woerter)}))
    treffer.sort(key=lambda t: -t[0])
    return {'stichwort': stichwort, 'anzahl': len(treffer),
            'treffer': [t[1] for t in treffer[:max(1, min(limit, 25))]],
            'hinweis': 'Ganzen Eintrag mit gedaechtnis_lesen(name) holen.'}


def lesen(name):
    pfad = _pfad(name)
    text = _lesen(pfad)
    return {'name': os.path.basename(pfad)[:-3],
            'geaendert': time.strftime('%Y-%m-%d', time.localtime(os.path.getmtime(pfad))),
            'inhalt': ausblenden(text)}


def _slug(titel):
    s = _norm(titel)
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')[:50].strip('-')
    return s or 'notiz'


def merken(titel, inhalt, beschreibung=None, art='project'):
    titel = (titel or '').strip()[:100]
    inhalt = (inhalt or '').strip()
    beschreibung = re.sub(r'\s+', ' ', (beschreibung or inhalt.splitlines()[0] if inhalt else '')).strip()[:150]
    if not titel or not inhalt:
        raise MailError('Titel und Inhalt fehlen.')
    if len(inhalt) > 8000:
        raise MailError('Inhalt zu lang (max. 8000 Zeichen).')
    if art not in ('user', 'feedback', 'project', 'reference'):
        art = 'project'
    with _lock:
        if sum(1 for d, _ in _alle() if d.startswith('eingang-')) >= MAX_EINGANG:
            raise MailError('Eingang voll (%d Einträge) — erst in Claude Code einsortieren.' % MAX_EINGANG)
        basis = 'eingang-' + _slug(titel)
        name, i = basis, 2
        while os.path.exists(os.path.join(DIR, name + '.md')):
            name, i = '%s-%d' % (basis, i), i + 1
        datum = time.strftime('%Y-%m-%d')
        text = ('---\nname: %s\ndescription: "%s"\nmetadata:\n  type: %s\n  quelle: claude-chat-cowork\n'
                '  erstellt: %s\n---\n\n%s\n' % (name, beschreibung.replace('"', "'"), art, datum, inhalt))
        fd = os.open(os.path.join(DIR, name + '.md'), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as fh:
            fh.write(text)
        idx = os.path.join(DIR, INDEX)
        alt = _lesen(idx)
        zeile = '- [%s](%s.md) — %s (aus Chat/Cowork, %s)\n' % (
            titel.replace(']', ')'), name, beschreibung, datum)
        with open(idx, 'a', encoding='utf-8') as fh:
            if not alt.endswith('\n'):
                fh.write('\n')
            if EINGANG_KOPF not in alt:
                fh.write('\n' + EINGANG_KOPF + '\n')
            fh.write(zeile)
    return {'ok': True, 'name': name,
            'hinweis': 'Gespeichert; Claude Code sieht es ab der nächsten Sitzung.'}
