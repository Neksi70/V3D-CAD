"""Mail- und Kalender-Werkzeuge für den MCP-Connector.

Alles hier baut auf den Funktionen von V3D Mail auf (siehe core.py). Die
Rückgabewerte sind einfache Dicts; app.py macht daraus MCP-Antworten.
Passwörter tauchen in keiner Rückgabe auf — Konten werden nur mit ID, Name
und Adresse beschrieben.
"""
import base64
import datetime
import email.utils
import html
import imaplib
import json
import mimetypes
import os
import re
import secrets
import subprocess
import time
import zoneinfo
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser
from urllib.parse import quote, urljoin

from .core import MailError, vm

BERLIN = zoneinfo.ZoneInfo('Europe/Berlin')
MAX_TEXT = 50_000                 # Zeichen je Nachrichtentext
MAX_ANHANG = 10 * 1024 * 1024     # Bytes je Anhang (get_attachment)
MAX_ANHAENGE_SENDEN = 20 * 1024 * 1024   # Bytes aller Anhänge einer ausgehenden Mail
MAX_ANHAENGE_ANZAHL = 20
DATEI_ORDNER = os.path.realpath(os.environ.get('V3DMCP_FILES_DIR') or '/srv/v3dmail/files')
LIMIT_STANDARD, LIMIT_MAX = 20, 50
PRAEFIX_VORLAEUFIG = 'vorläufig: '
ALLE = ('', 'alle', 'all', '*')


# --- Konten -----------------------------------------------------------------

def standard_konto():
    return (os.environ.get('DEFAULT_ACCOUNT') or '').strip()


def konto(arg=None):
    """Konto per E-Mail-Adresse (ohne Groß/Klein) oder ID finden."""
    wunsch = (arg or standard_konto() or '').strip().lower()
    konten = vm.CFG.get('accounts', [])
    if not wunsch and len(konten) == 1:
        return konten[0]
    for a in konten:
        if (a.get('email') or '').lower() == wunsch or (a.get('id') or '').lower() == wunsch:
            return a
    raise MailError('Postfach "%s" nicht gefunden. Verfügbar: %s'
                    % (arg or wunsch, ', '.join(a.get('email', '') for a in konten)))


def list_accounts():
    std = standard_konto().lower()
    return {'accounts': [{
        'id': a['id'], 'email': a.get('email'), 'name': a.get('name') or a.get('email'),
        'calendar': bool((a.get('dav') or {}).get('calendars')),
        'default': (a.get('email') or '').lower() == std,
    } for a in vm.CFG.get('accounts', [])]}


# --- Ordner -----------------------------------------------------------------

def list_folders(account=None):
    acc = konto(account)
    box = vm.get_box(acc)
    return {'account': acc['email'], 'folders': [
        {'path': f['path'], 'name': f['name'], 'kind': f['kind'] or None}
        for f in vm.list_folders(box)]}


def ordner_aufloesen(box, ordner):
    """Ordner finden: exakter Pfad (wie ihn search_messages liefert) → Art
    (inbox/sent/drafts/trash/junk/archive; bei Dubletten wie Sent/"Gesendete
    Elemente" derselbe Ordner, den V3D Mail nimmt) → Pfad/Name ohne Groß/Klein."""
    ziel = (ordner or '').strip()
    alle = vm.list_folders(box)
    for f in alle:
        if f['path'] == ziel:
            return f['path']
    for f in alle:                      # list_folders ist wie in V3D Mail sortiert
        if f['kind'] and f['kind'] == ziel.lower():
            return f['path']
    for feld in ('path', 'name'):
        for f in alle:
            if (f[feld] or '').lower() == ziel.lower():
                return f['path']
    raise MailError('Ordner "%s" nicht gefunden (list_folders zeigt alle)' % ordner)


# --- Suche ------------------------------------------------------------------

def _imap_datum(wert, feld):
    try:
        d = datetime.date.fromisoformat(str(wert).strip()[:10])
    except ValueError:
        raise MailError('%s: Datum als JJJJ-MM-TT angeben' % feld)
    return d.strftime('%d-%b-%Y')     # IMAP will englische Monatskürzel


def _ascii(s):
    try:
        s.encode('ascii')
        return True
    except UnicodeEncodeError:
        return False


def _uid_suche(box, ordner, basis, frei):
    """UID SEARCH mit ASCII-Kriterien `basis`; `frei` sind (Schlüssel, Wert)-
    Paare mit Umlauten o. Ä. Die gehen als IMAP-Literal raus — imaplib kann nur
    eines je Befehl, also eine Suche je Umlaut-Kriterium und Schnittmenge."""
    def eine(krit, literal=None):
        with box.lock:
            box.select(ordner, readonly=True)
            if literal is not None:
                box.conn.literal = literal
                typ, data = box.conn.uid('SEARCH', 'CHARSET', 'UTF-8', *krit)
            else:
                typ, data = box.conn.uid('SEARCH', None, *(krit or ['ALL']))
            box.last_used = time.time()
        if typ != 'OK':
            raise MailError('Suche in "%s" fehlgeschlagen' % ordner)
        return {int(x) for x in (data[0] or b'').split()}

    if not frei:
        return eine(basis)
    ergebnis = None
    for schluessel, wert in frei:
        treffer = eine(basis + [schluessel], wert.encode('utf-8'))
        ergebnis = treffer if ergebnis is None else ergebnis & treffer
    return ergebnis


def _kriterien(query=None, from_=None, to_=None, subject=None, since=None, before=None,
               unread_only=False):
    basis, frei = [], []
    for schluessel, wert in (('TEXT', query), ('FROM', from_), ('TO', to_), ('SUBJECT', subject)):
        wert = (wert or '').strip()
        if not wert:
            continue
        if _ascii(wert):
            basis += [schluessel, vm._q(wert)]
        else:
            frei.append((schluessel, wert))
    if since:
        basis += ['SINCE', _imap_datum(since, 'since')]
    if before:
        basis += ['BEFORE', _imap_datum(before, 'before')]
    if unread_only:
        basis.append('UNSEEN')
    return basis, frei


def _cursor_lesen(cursor, fingerabdruck):
    if not cursor:
        return {}
    try:
        roh = json.loads(base64.urlsafe_b64decode(cursor.encode('ascii') + b'==='))
        if roh.get('q') != fingerabdruck:
            raise ValueError
        return {k: int(v) for k, v in roh['f'].items()}
    except Exception:
        raise MailError('cursor passt nicht zu dieser Suche — ohne cursor neu beginnen')


def _cursor_bauen(grenzen, fingerabdruck):
    roh = json.dumps({'q': fingerabdruck, 'f': grenzen}, separators=(',', ':'))
    return base64.urlsafe_b64encode(roh.encode('utf-8')).decode('ascii').rstrip('=')


def search_messages(account=None, query=None, from_=None, to_=None, subject=None,
                    since=None, before=None, folder='alle', unread_only=False,
                    has_attachment=False, limit=LIMIT_STANDARD, cursor=None):
    acc = konto(account)
    box = vm.get_box(acc)
    limit = max(1, min(LIMIT_MAX, int(limit or LIMIT_STANDARD)))
    if (folder or '').strip().lower() in ALLE:
        ordnerliste = [f['path'] for f in vm.list_folders(box)]
    else:
        ordnerliste = [ordner_aufloesen(box, folder)]
    basis, frei = _kriterien(query, from_, to_, subject, since, before, unread_only)
    fingerabdruck = vm.hashlib.sha256(json.dumps(
        [acc['id'], basis, frei, ordnerliste, bool(has_attachment)], ensure_ascii=False)
        .encode('utf-8')).hexdigest()[:16]
    grenzen = _cursor_lesen(cursor, fingerabdruck)

    # Je Ordner die Treffer-UIDs, neueste zuerst; der cursor merkt sich je
    # Ordner die kleinste schon gelieferte UID (exklusive Grenze).
    offen, gesamt = {}, 0
    for pfad in ordnerliste:
        uids = sorted(_uid_suche(box, pfad, basis, frei), reverse=True)
        gesamt += len(uids)
        if pfad in grenzen:
            uids = [u for u in uids if u < grenzen[pfad]]
        if uids:
            offen[pfad] = uids

    # Mischen über die Ordner nach Datum. Kopfzeilen werden stückweise geholt,
    # damit eine breite Suche nicht tausende Köpfe auf einmal lädt.
    puffer = {p: [] for p in offen}
    stueck = max(limit, 20)
    treffer = []
    while len(treffer) < limit:
        for p in list(offen):
            if not puffer[p] and offen[p]:
                teil, offen[p] = offen[p][:stueck], offen[p][stueck:]
                puffer[p] = vm.fetch_list(box, p, teil)
        kandidaten = [p for p in puffer if puffer[p]]
        if not kandidaten:
            break
        p = max(kandidaten, key=lambda k: puffer[k][0]['ts'])
        m = puffer[p].pop(0)
        grenzen[p] = m['uid']
        if has_attachment and not m['hasAttachments']:
            continue
        treffer.append((p, m))

    # Vorschauzeilen je Ordner in einem Abruf
    vorschau = {}
    for p in {p for p, _ in treffer}:
        uids = [m['uid'] for q, m in treffer if q == p]
        for uid, s in vm.fetch_previews(box, p, uids).items():
            vorschau[(p, uid)] = s

    weitere = any(puffer[p] for p in puffer) or any(offen.get(p) for p in offen)
    # Nicht verbrauchte Pufferreste zählen als offen: Grenze zeigt auf die zuletzt
    # gelieferte UID, der Rest (kleinere UIDs) kommt auf der nächsten Seite.
    return {
        'account': acc['email'],
        'folders_searched': len(ordnerliste),
        'total_matches': gesamt,
        'messages': [{
            'folder': p, 'uid': m['uid'], 'date': m['date'],
            'from': _adressen(m['from']), 'to': _adressen(m['to']),
            'subject': _zeile(m['subject']),
            'preview': _zeile(UNSICHTBAR.sub('', vorschau.get((p, m['uid']), ''))),
            'unread': not m['seen'], 'flagged': m['flagged'],
            'has_attachment': m['hasAttachments'], 'size': m['size'],
        } for p, m in treffer],
        'next_cursor': _cursor_bauen(grenzen, fingerabdruck) if weitere else None,
    }


def _adressen(liste):
    out = []
    for a in liste or []:
        if isinstance(a, dict):
            name, adr = a.get('name') or '', a.get('email') or a.get('address') or ''
            out.append('%s <%s>' % (name, adr) if name and name != adr else adr)
        else:
            out.append(str(a))
    return ', '.join(out)


# --- Nachricht lesen --------------------------------------------------------

# Füllzeichen, mit denen Newsletter die Vorschauzeile auffüllen
UNSICHTBAR = re.compile('[\u200b\u200c\u200d\u2060\ufeff\u034f\u00ad\u2007\u180e]')


class _HtmlZuText(HTMLParser):
    """HTML → lesbarer Text; Links bleiben als "Text (URL)" erhalten."""
    BLOCK = {'p', 'div', 'tr', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol',
             'blockquote', 'section', 'article', 'header', 'footer', 'hr', 'pre'}
    WEG = {'script', 'style', 'head', 'title', 'noscript'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.teile = []
        self.weg = 0
        self.link = None        # (href, Startindex in teile)

    def handle_starttag(self, tag, attrs):
        if tag in self.WEG:
            self.weg += 1
            return
        if tag == 'br':
            self.teile.append('\n')
        elif tag in self.BLOCK:
            self.teile.append('\n')
        elif tag == 'li':
            self.teile.append('\n- ')
        elif tag in ('td', 'th'):
            self.teile.append(' ')
        elif tag == 'a':
            href = (dict(attrs).get('href') or '').strip()
            self.link = (href, len(self.teile))
        elif tag == 'img':
            alt = (dict(attrs).get('alt') or '').strip()
            if alt:
                self.teile.append('[Bild: %s]' % alt)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag in self.WEG:
            self.weg = max(0, self.weg - 1)
            return
        if tag == 'a' and self.link:
            href, start = self.link
            self.link = None
            text = ''.join(self.teile[start:]).strip()
            if href and not href.startswith(('#', 'javascript:', 'cid:')):
                ziel = href[7:] if href.startswith('mailto:') else href
                if ziel.rstrip('/') != text.rstrip('/'):
                    self.teile.append(' (%s)' % href)
        elif tag in self.BLOCK:
            self.teile.append('\n')

    def handle_data(self, data):
        if not self.weg:
            self.teile.append(data)

    def text(self):
        t = UNSICHTBAR.sub('', ''.join(self.teile)).replace('\xa0', ' ')
        t = re.sub(r'[ \t\r\f\v]+', ' ', t)
        t = re.sub(r' *\n *', '\n', t)
        return re.sub(r'\n{3,}', '\n\n', t).strip()


def html_zu_text(roh):
    p = _HtmlZuText()
    try:
        p.feed(roh or '')
        p.close()
    except Exception:
        return vm._text_aus_html(roh or '')
    return p.text()


def _kappen(text, grenze=MAX_TEXT):
    if len(text) <= grenze:
        return text, False
    return text[:grenze] + '\n[… gekürzt, Nachricht hat %d Zeichen]' % len(text), True


def _roh_laden(box, ordner, uid):
    with box.lock:
        box.select(ordner, readonly=True)
        typ, data = box.conn.uid('FETCH', str(int(uid)), '(FLAGS BODY.PEEK[])')
        box.last_used = time.time()
    if typ != 'OK' or not data or not isinstance(data[0], tuple):
        raise MailError('Nachricht %s in "%s" nicht gefunden' % (uid, ordner))
    flags = vm.FETCH_FLAGS_RE.search(data[0][0])
    flags = flags.group(1).decode('ascii', 'replace').split() if flags else []
    return BytesParser(policy=policy.default).parsebytes(data[0][1]), flags


def _text_aus_nachricht(msg):
    """Bester lesbarer Text: HTML mit erhaltenen Links, sonst Reintext."""
    html_teil = plain = ''
    try:
        b = msg.get_body(preferencelist=('html',))
        if b is not None:
            html_teil = b.get_content()
    except Exception:
        pass
    try:
        b = msg.get_body(preferencelist=('plain',))
        if b is not None:
            plain = b.get_content()
    except Exception:
        pass
    if html_teil:
        text = html_zu_text(html_teil)
        if text.strip():
            return text
    if plain and vm.MARKUP_RE.search(plain):
        return html_zu_text(plain)
    return UNSICHTBAR.sub('', plain or '').strip()


def _anhaenge(msg):
    out = []
    for idx, part in enumerate(msg.walk()):
        if part.get_content_maintype() == 'multipart':
            continue
        disp = part.get_content_disposition() or ''
        name = part.get_filename()
        name = vm.decode_header(name) if name else ''
        if disp != 'attachment' and part.get_content_type() in ('text/plain', 'text/html') and not name:
            continue
        try:
            groesse = len(part.get_payload(decode=True) or b'')
        except Exception:
            groesse = 0
        cid = (part.get('Content-ID') or '').strip('<>')
        out.append({'part': part.get('X-V3D-Part') or str(idx),
                    'filename': name or cid or 'anhang-%d' % idx,
                    'type': part.get_content_type(), 'size': groesse,
                    'inline': disp == 'inline' or bool(cid)})
    return out


def _kopf(msg):
    return {'subject': _zeile(vm.decode_header(msg.get('Subject'))) or '(kein Betreff)',
            'from': _adressen(vm.addr_list(msg.get('From'))),
            'to': _adressen(vm.addr_list(msg.get('To'))),
            'cc': _adressen(vm.addr_list(msg.get('Cc'))),
            'reply_to': _adressen(vm.addr_list(msg.get('Reply-To'))),
            'date': vm.decode_header(msg.get('Date')),
            'message_id': (msg.get('Message-ID') or '').strip()}


def get_message(folder, uid, account=None, mark_read=False):
    acc = konto(account)
    box = vm.get_box(acc)
    pfad = ordner_aufloesen(box, folder)
    msg, flags = _roh_laden(box, pfad, uid)
    text, gekappt = _kappen(_text_aus_nachricht(msg))
    if mark_read:
        vm.set_flags(box, pfad, [int(uid)], '\\Seen', True)
    out = {'account': acc['email'], 'folder': pfad, 'uid': int(uid)}
    out.update(_kopf(msg))
    out.update({'unread': '\\Seen' not in flags and not mark_read,
                'flagged': '\\Flagged' in flags,
                'text': text, 'truncated': gekappt,
                'attachments': _anhaenge(msg)})
    return out


# --- Gesprächsfaden ---------------------------------------------------------

def _zeile(s):
    """Gefaltete Kopfzeilen (\\r\\n + Leerraum) auf eine Zeile bringen."""
    return re.sub(r'\s+', ' ', s or '').strip()


MID_RE = re.compile(r'<[^<>\s]+>')


def _oder(terme):
    """IMAP-OR ist zweistellig → verschachteln."""
    if len(terme) == 1:
        return terme[0]
    return ['OR'] + terme[0] + _oder(terme[1:]) if len(terme) > 1 else []


def _flach(x):
    for e in x:
        if isinstance(e, list):
            yield from _flach(e)
        else:
            yield e


def get_thread(folder, uid, account=None):
    acc = konto(account)
    box = vm.get_box(acc)
    pfad = ordner_aufloesen(box, folder)
    msg, _ = _roh_laden(box, pfad, uid)
    ids = []
    for kopf in ('Message-ID', 'In-Reply-To', 'References'):
        for mid in MID_RE.findall(str(msg.get(kopf) or '')):
            if mid not in ids and _ascii(mid):
                ids.append(mid)
    ids = ids[-15:]     # sehr lange Fäden: die jüngsten Bezüge reichen
    if not ids:
        return {'account': acc['email'], 'messages': [get_message(pfad, uid, acc['email'])]}

    terme = []
    for mid in ids:
        for kopf in ('Message-ID', 'In-Reply-To', 'References'):
            terme.append(['HEADER', kopf, vm._q(mid)])
    krit = list(_flach(_oder(terme)))

    gefunden = []
    for f in vm.list_folders(box):
        for u in _uid_suche(box, f['path'], krit, []):
            gefunden.append((f['path'], u))
    kopfdaten = []
    for p in {p for p, _ in gefunden}:
        kopfdaten += [(p, m) for m in vm.fetch_list(box, p, [u for q, u in gefunden if q == p])]
    kopfdaten.sort(key=lambda x: x[1]['ts'])

    je_nachricht = max(2000, MAX_TEXT // max(1, len(kopfdaten)))
    gesehen, out = set(), []
    for p, m in kopfdaten[-30:]:
        voll, _ = _roh_laden(box, p, m['uid'])
        mid = (voll.get('Message-ID') or '').strip()
        if mid and mid in gesehen:
            continue        # Kopie in "Gesendet" und im Posteingang
        gesehen.add(mid)
        text, gekappt = _kappen(_text_aus_nachricht(voll), je_nachricht)
        eintrag = {'folder': p, 'uid': m['uid']}
        eintrag.update(_kopf(voll))
        eintrag.update({'text': text, 'truncated': gekappt,
                        'attachments': [a['filename'] for a in _anhaenge(voll) if not a['inline']]})
        out.append(eintrag)
    return {'account': acc['email'], 'count': len(out), 'messages': out}


# --- Anhänge ----------------------------------------------------------------

def pdf_text(daten):
    try:
        r = subprocess.run(['pdftotext', '-layout', '-enc', 'UTF-8', '-', '-'], input=daten,
                           capture_output=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if r.returncode != 0:
        return None
    return r.stdout.decode('utf-8', 'replace').strip()


def get_attachment(folder, uid, part, account=None):
    """→ (Metadaten-Dict, Rohdaten, Text oder None)."""
    acc = konto(account)
    box = vm.get_box(acc)
    pfad = ordner_aufloesen(box, folder)
    daten, ctype, name = vm.load_attachment(box, pfad, int(uid), str(part))
    if ctype.startswith('multipart/'):
        raise MailError('Teil %s ist kein Anhang — "part" aus der Anhangsliste von get_message nehmen' % part)
    if len(daten) > MAX_ANHANG:
        raise MailError('Anhang ist %.1f MB groß, Grenze 10 MB' % (len(daten) / 1048576))
    text = None
    if ctype == 'application/pdf' or name.lower().endswith('.pdf'):
        text = pdf_text(daten)
        if text is not None:
            text, _ = _kappen(text)
    elif ctype.startswith('text/') or ctype in ('application/json', 'application/xml'):
        text, _ = _kappen(daten.decode('utf-8', 'replace'))
    meta = {'account': acc['email'], 'folder': pfad, 'uid': int(uid), 'part': str(part),
            'filename': name, 'type': ctype, 'size': len(daten)}
    return meta, daten, text


# --- Anhänge für ausgehende Mails ------------------------------------------------

MIME_RE = re.compile(r'[A-Za-z0-9][\w.+-]*/[A-Za-z0-9][\w.+-]*')


def _mb(n):
    return '%.2f MB' % (n / 1048576)


def _dateiname(name, ersatz='anhang'):
    """Nur der letzte Pfadteil, ohne Steuerzeichen — landet im MIME-Kopf."""
    name = re.split(r'[\\/]', str(name or ''))[-1]
    name = re.sub(r'[\x00-\x1f\x7f]', '', name).strip().strip('.')
    return name[:200] or ersatz


def _mime(typ, name):
    typ = (typ or '').strip().lower()
    if typ and MIME_RE.fullmatch(typ):
        return typ
    return mimetypes.guess_type(name)[0] or 'application/octet-stream'


def datei_aufloesen(pfad):
    """Pfad relativ zu (oder absolut in) DATEI_ORDNER → echter Pfad. Alles, was
    nach Auflösen von .. und Symlinks außerhalb liegt, wird abgelehnt."""
    roh = str(pfad or '').strip()
    if not roh or '\x00' in roh:
        raise MailError('path fehlt')
    if not os.path.isdir(DATEI_ORDNER):
        raise MailError('Dateiordner %s fehlt auf dem Server' % DATEI_ORDNER)
    # Absolute Pfade gewinnen bei join — die commonpath-Prüfung fängt sie ab.
    echt = os.path.realpath(os.path.join(DATEI_ORDNER, roh))
    if os.path.commonpath([echt, DATEI_ORDNER]) != DATEI_ORDNER or echt == DATEI_ORDNER:
        raise MailError('Nur Dateien aus %s sind erlaubt (Pfad: %s)' % (DATEI_ORDNER, roh))
    if not os.path.isfile(echt):
        raise MailError('Datei nicht gefunden: %s — list_files zeigt, was da ist' % roh)
    return echt


def list_files():
    if not os.path.isdir(DATEI_ORDNER):
        raise MailError('Dateiordner %s fehlt auf dem Server' % DATEI_ORDNER)
    out = []
    for wurzel, ordner, dateien in os.walk(DATEI_ORDNER):
        ordner[:] = sorted(o for o in ordner if not o.startswith('.'))
        for d in sorted(dateien):
            if d.startswith('.'):
                continue
            voll = os.path.join(wurzel, d)
            try:
                echt = datei_aufloesen(os.path.relpath(voll, DATEI_ORDNER))
                st = os.stat(echt)
            except (MailError, OSError):
                continue        # z. B. Symlink nach draußen
            out.append({'path': os.path.relpath(voll, DATEI_ORDNER), 'size': st.st_size,
                        'type': mimetypes.guess_type(d)[0] or 'application/octet-stream',
                        'modified': datetime.datetime.fromtimestamp(st.st_mtime, BERLIN)
                        .isoformat(timespec='seconds')})
            if len(out) >= 500:
                break
    return {'folder': DATEI_ORDNER, 'count': len(out), 'files': out,
            'hint': 'Als Anhang: attachments=[{"path": "<path>"}] bei send_message/create_draft.'}


def anhaenge_bauen(box, eintraege):
    """attachments-Parameter → Liste für baue_nachricht ({name, type, data(b64)}).
    Prüft die Gesamtgröße schon beim Einsammeln, damit nichts Unnötiges lädt."""
    eintraege = list(eintraege or [])
    if len(eintraege) > MAX_ANHAENGE_ANZAHL:
        raise MailError('Höchstens %d Anhänge je Mail' % MAX_ANHAENGE_ANZAHL)
    out, summe = [], 0

    def dazu(name, typ, daten, herkunft):
        nonlocal summe
        summe += len(daten)
        if summe > MAX_ANHAENGE_SENDEN:
            raise MailError('Anhänge zu groß: mit %s (%s) zusammen %s, Grenze %s. '
                            'Weniger/kleinere Dateien anhängen oder einen Link schicken.'
                            % (name, herkunft, _mb(summe), _mb(MAX_ANHAENGE_SENDEN)))
        out.append({'name': name, 'type': typ, 'data': base64.b64encode(daten).decode('ascii')})

    for i, e in enumerate(eintraege, 1):
        if hasattr(e, 'model_dump'):
            e = e.model_dump(exclude_none=True)
        if not isinstance(e, dict):
            raise MailError('Anhang %d: Objekt erwartet' % i)
        arten = [k for k in ('from_mail', 'path', 'content_base64') if e.get(k) is not None]
        if len(arten) != 1 or (arten[0] != 'content_base64'
                               and (e.get('filename') is not None or e.get('mime_type') is not None)):
            raise MailError('Anhang %d: genau eins von from_mail, path oder '
                            'filename+content_base64+mime_type angeben' % i)
        if arten[0] == 'from_mail':
            q = e['from_mail'] or {}
            if not isinstance(q, dict) or not q.get('folder') or q.get('uid') is None or q.get('part') in (None, ''):
                raise MailError('Anhang %d: from_mail braucht folder, uid und part' % i)
            pfad = ordner_aufloesen(box, q['folder'])
            daten, ctype, name = vm.load_attachment(box, pfad, int(q['uid']), str(q['part']))
            if ctype.startswith('multipart/'):
                raise MailError('Anhang %d: Teil %s ist kein Anhang — "part" aus get_message nehmen'
                                % (i, q['part']))
            name = _dateiname(name)
            dazu(name, _mime(ctype, name), daten, 'aus Mail %s/%s' % (pfad, q['uid']))
        elif arten[0] == 'path':
            echt = datei_aufloesen(e['path'])
            groesse = os.path.getsize(echt)
            if summe + groesse > MAX_ANHAENGE_SENDEN:
                raise MailError('Anhänge zu groß: %s ist %s, zusammen %s, Grenze %s. '
                                'Weniger/kleinere Dateien anhängen oder einen Link schicken.'
                                % (e['path'], _mb(groesse), _mb(summe + groesse), _mb(MAX_ANHAENGE_SENDEN)))
            with open(echt, 'rb') as fh:
                daten = fh.read()
            name = _dateiname(os.path.basename(echt))
            dazu(name, _mime(None, name), daten, 'Datei')
        else:
            b64 = re.sub(r'\s+', '', str(e['content_base64']))
            if len(b64) * 3 // 4 > MAX_ANHAENGE_SENDEN + 3:
                raise MailError('Anhang %d ist größer als %s' % (i, _mb(MAX_ANHAENGE_SENDEN)))
            try:
                daten = base64.b64decode(b64, validate=True)
            except Exception:
                raise MailError('Anhang %d: content_base64 ist kein gültiges Base64' % i)
            name = _dateiname(e.get('filename'))
            if name == 'anhang' and not e.get('filename'):
                raise MailError('Anhang %d: filename fehlt' % i)
            dazu(name, _mime(e.get('mime_type'), name), daten, 'Base64')
    return out, summe


# --- Schreiben: Entwurf und Versand ------------------------------------------

def _antwortbezug(box, reply_to_folder, reply_to_uid):
    if not reply_to_uid:
        return {}, None
    pfad = ordner_aufloesen(box, reply_to_folder or 'inbox')
    orig, _ = _roh_laden(box, pfad, reply_to_uid)
    mid = (orig.get('Message-ID') or '').strip()
    return {'inReplyTo': mid, 'references': (orig.get('References') or '').strip()}, (pfad, int(reply_to_uid))


def _daten(to_, subject, body, cc, bcc):
    if not (to_ or '').strip():
        raise MailError('Empfänger (to) fehlt')
    for feld, wert in (('to', to_), ('cc', cc), ('bcc', bcc)):
        for name, adr in email.utils.getaddresses([wert or '']):
            if (wert or '').strip() and not re.fullmatch(r'[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+', adr or ''):
                raise MailError('Ungültige Adresse in %s: %s' % (feld, adr or name))
    return {'to': to_.strip(), 'cc': (cc or '').strip(), 'bcc': (bcc or '').strip(),
            'subject': subject or '', 'text': body or ''}


def create_draft(to_, subject, body, cc=None, bcc=None, reply_to_folder=None,
                 reply_to_uid=None, account=None, attachments=None):
    acc = konto(account)
    box = vm.get_box(acc)
    daten = _daten(to_, subject, body, cc, bcc)
    bezug, _ = _antwortbezug(box, reply_to_folder, reply_to_uid)
    daten.update(bezug)
    daten['attachments'], summe = anhaenge_bauen(box, attachments)
    # Ohne Signatur: V3D Mail hängt sie beim Senden aus dem Entwurf selbst an.
    msg = vm.baue_nachricht(acc, daten)
    if daten['bcc']:
        msg['Bcc'] = daten['bcc']
    msg['X-V3D-Quelle'] = 'Claude'
    drafts = vm.find_special(box, 'drafts')
    if not drafts:
        raise MailError('Das Postfach hat keinen Entwürfe-Ordner')
    with box.lock:
        box.ensure()
        typ, _ = box.conn.append('"%s"' % vm.utf7_encode(drafts), '(\\Draft \\Seen)',
                                 imaplib.Time2Internaldate(time.time()), msg.as_bytes())
        box.last_used = time.time()
    if typ != 'OK':
        raise MailError('Entwurf konnte nicht abgelegt werden')
    return {'ok': True, 'account': acc['email'], 'folder': drafts,
            'message_id': msg['Message-ID'], 'to': daten['to'], 'subject': daten['subject'],
            'attachments': [a['name'] for a in daten['attachments']], 'attachments_size': summe,
            'hint': 'Liegt in V3D Mail im Ordner "%s" — dort öffnen, "Bearbeiten", prüfen, senden.' % drafts}


def _html_aus_text(text):
    t = html.escape(text or '')
    t = re.sub(r'(https?://[^\s<]+)', r'<a href="\1">\1</a>', t)
    return t.replace('\n', '<br>')


def send_message(to_, subject, body, cc=None, bcc=None, reply_to_folder=None,
                 reply_to_uid=None, account=None, attachments=None):
    acc = konto(account)
    box = vm.get_box(acc)
    daten = _daten(to_, subject, body, cc, bcc)
    bezug, orig = _antwortbezug(box, reply_to_folder, reply_to_uid)
    daten.update(bezug)
    # Vor dem Versand: ein ungültiger Anhang darf nicht zu einer Mail ohne ihn führen.
    daten['attachments'], summe = anhaenge_bauen(box, attachments)
    # Signatur wie beim Senden aus der Oberfläche (doSend in mail.html);
    # das Logo ergänzt baue_nachricht über ergaenze_signaturbild selbst.
    roh = daten['text']
    if acc.get('signature'):
        daten['text'] = roh.rstrip() + '\n\n-- \n' + acc['signature']
    if acc.get('signatureHtml'):
        daten['html'] = ('<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;'
                         'line-height:1.45">' + _html_aus_text(roh) + '<br>'
                         + acc['signatureHtml'] + '</div>')
    ergebnis = vm.send_mail(acc, daten)
    if orig:
        try:
            vm.set_flags(box, orig[0], [orig[1]], '\\Answered', True)
        except Exception:
            pass
    n = sum(1 for f in ('to', 'cc', 'bcc') for _, a in email.utils.getaddresses([daten[f]]) if a)
    return {'ok': True, 'account': acc['email'], 'message_id': ergebnis.get('messageId'),
            'recipients': n, 'saved_to_sent': ergebnis.get('savedToSent'),
            'attachments': [a['name'] for a in daten['attachments']], 'attachments_size': summe}


# --- Verschieben und Markieren -----------------------------------------------

def _uids(uids):
    if isinstance(uids, int):
        uids = [uids]
    try:
        out = [int(u) for u in uids or []]
    except (TypeError, ValueError):
        raise MailError('uids müssen Zahlen sein')
    if not out:
        raise MailError('uids fehlt')
    if len(out) > 200:
        raise MailError('Höchstens 200 Nachrichten auf einmal')
    return out


def move_message(folder, uids, target, account=None):
    """Verschieben per IMAP MOVE. Endgültiges Löschen gibt es nicht — "löschen"
    heißt in den Papierkorb (target="trash") verschieben."""
    acc = konto(account)
    box = vm.get_box(acc)
    quelle = ordner_aufloesen(box, folder)
    ziel = ordner_aufloesen(box, target)
    if quelle == ziel:
        raise MailError('Quelle und Ziel sind derselbe Ordner')
    liste = _uids(uids)
    with box.lock:
        box.select(quelle, readonly=False)
        if 'MOVE' not in (box.conn.capabilities or ()):
            # Kein COPY+EXPUNGE-Ersatz: EXPUNGE würde auch fremde, zum Löschen
            # markierte Nachrichten im Ordner endgültig entfernen.
            raise MailError('Mailserver kann kein MOVE — Verschieben nicht möglich')
        typ, _ = box.conn.uid('MOVE', ','.join(map(str, liste)), '"%s"' % vm.utf7_encode(ziel))
        box.last_used = time.time()
    if typ != 'OK':
        raise MailError('Verschieben fehlgeschlagen')
    return {'ok': True, 'account': acc['email'], 'from': quelle, 'to': ziel, 'moved': len(liste),
            'hint': 'Die UIDs sind im Zielordner neu vergeben — dort per search_messages suchen.'}


def set_flags(folder, uids, read=None, flagged=None, account=None):
    acc = konto(account)
    box = vm.get_box(acc)
    pfad = ordner_aufloesen(box, folder)
    liste = _uids(uids)
    getan = {}
    if read is not None:
        vm.set_flags(box, pfad, liste, '\\Seen', bool(read))
        getan['read'] = bool(read)
    if flagged is not None:
        vm.set_flags(box, pfad, liste, '\\Flagged', bool(flagged))
        getan['flagged'] = bool(flagged)
    if not getan:
        raise MailError('read oder flagged angeben')
    return {'ok': True, 'account': acc['email'], 'folder': pfad, 'uids': liste, 'set': getan}


# --- Kalender ---------------------------------------------------------------

def zeit_utc(wert, feld):
    """ISO-Zeit → 'JJJJ-MM-TTTHH:MM:SSZ'. Ohne Zeitzone gilt Europe/Berlin."""
    s = str(wert or '').strip()
    if not s:
        raise MailError('%s fehlt' % feld)
    try:
        dt = datetime.datetime.fromisoformat(s.replace('Z', '+00:00'))
    except ValueError:
        raise MailError('%s: ISO-Format erwartet, z. B. 2026-09-24T14:00 oder 2026-09-24' % feld)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=BERLIN)
    return dt.astimezone(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _datum(wert, feld):
    try:
        return datetime.date.fromisoformat(str(wert).strip()[:10]).isoformat()
    except ValueError:
        raise MailError('%s: Datum als JJJJ-MM-TT angeben' % feld)


def _lokal(iso_utc):
    if not iso_utc or len(iso_utc) <= 10:
        return iso_utc
    dt = datetime.datetime.strptime(iso_utc, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(BERLIN).strftime('%Y-%m-%d %H:%M')


def _kalender_konto(account):
    acc = konto(account)
    if not (acc.get('dav') or {}).get('calendars'):
        raise MailError('Für %s ist kein Kalender verbunden (goneo "Webmail Plus" nötig)' % acc['email'])
    return acc


def _href_pruefen(acc, href):
    """Nur Termine in den Kalendern dieses Kontos — sonst könnte eine fremde
    Adresse mit den Postfach-Zugangsdaten angesprochen werden."""
    href = (href or '').strip()
    for cal in acc['dav']['calendars']:
        basis = cal['href'].rstrip('/') + '/'
        if href.startswith(basis) and '..' not in href[len(basis):] and href.endswith('.ics'):
            return href
    raise MailError('href gehört zu keinem Kalender dieses Postfachs (href aus list_events nehmen)')


def list_events(start=None, end=None, account=None):
    acc = _kalender_konto(account)
    jetzt = datetime.datetime.now(datetime.timezone.utc)
    von = zeit_utc(start, 'start') if start else jetzt.strftime('%Y-%m-%dT%H:%M:%SZ')
    bis = zeit_utc(end, 'end') if end else (jetzt + datetime.timedelta(days=14)).strftime('%Y-%m-%dT%H:%M:%SZ')
    events = vm.dav_events(acc, von, bis)
    return {'account': acc['email'], 'from': von, 'to': bis, 'timezone_local': 'Europe/Berlin',
            'events': [{
                'title': e.get('summary') or '', 'start': e['start'], 'end': e.get('end'),
                'start_local': _lokal(e['start']), 'end_local': _lokal(e.get('end')),
                'all_day': bool(e.get('allDay')), 'location': e.get('location') or '',
                'description': _kappen(e.get('description') or '', 2000)[0],
                'recurring': bool(e.get('recurring')), 'calendar': e.get('calendarName'),
                'uid': e['uid'], 'href': e['href'],
            } for e in events]}


def _vorlaeufig(titel):
    titel = (titel or '').strip()
    if not titel:
        raise MailError('title fehlt')
    if titel.lower().startswith(PRAEFIX_VORLAEUFIG.strip().lower()):
        titel = titel.split(':', 1)[1].strip()
    return PRAEFIX_VORLAEUFIG + titel


def _ics(ev, uid, status, sequenz=0, frei=False):
    """VCALENDAR aus V3D Mail bauen und STATUS/SEQUENCE ergänzen."""
    ics = vm.ics_build_event(ev, uid)
    zusatz = ['STATUS:' + status, 'SEQUENCE:%d' % sequenz, 'X-V3D-QUELLE:Claude']
    if frei:
        zusatz.append('TRANSP:TRANSPARENT')     # blockiert keine Zeit mehr
    return ics.replace('END:VEVENT', '\r\n'.join(zusatz) + '\r\nEND:VEVENT', 1)


def _ev_dict(title, start, end, all_day, location, description):
    if all_day:
        s = _datum(start, 'start')
        e = _datum(end or start, 'end')
        if e < s:
            raise MailError('end liegt vor start')
    else:
        s = zeit_utc(start, 'start')
        e = zeit_utc(end, 'end') if end else s
        if e < s:
            raise MailError('end liegt vor start')
    return {'summary': title, 'start': s, 'end': e, 'allDay': bool(all_day),
            'location': location or '', 'description': description or ''}


def create_event(title, start, end=None, all_day=False, location=None, description=None,
                 account=None):
    acc = _kalender_konto(account)
    if not all_day and re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(start).strip()):
        all_day = True
    ev = _ev_dict(_vorlaeufig(title), start, end, all_day, location, description)
    uid = 'v3dmcp-%s@volme3d' % secrets.token_hex(8)
    cal = acc['dav']['calendars'][0]['href']
    href = cal.rstrip('/') + '/' + quote(uid) + '.ics'
    status, _, _ = vm._dav_http(acc, 'PUT', href, body=_ics(ev, uid, 'TENTATIVE').encode('utf-8'),
                                ctype='text/calendar; charset=utf-8', extra={'If-None-Match': '*'})
    vm._dav_check(status, 'Termin anlegen')
    return {'ok': True, 'account': acc['email'], 'uid': uid, 'href': href, 'title': ev['summary'],
            'status': 'TENTATIVE', 'start': ev['start'], 'end': ev['end'], 'all_day': ev['allDay']}


def _status_aus_ics(text):
    m = re.search(r'^STATUS:(\S+)', vm._ics_unfold(text), re.M)
    return m.group(1).upper() if m else ''


def _sequenz_aus_ics(text):
    m = re.search(r'^SEQUENCE:(\d+)', vm._ics_unfold(text), re.M)
    return int(m.group(1)) if m else 0


def update_event(href, title=None, start=None, end=None, all_day=None, location=None,
                 description=None, cancel=False, account=None):
    """Nur vorläufige Termine (Titel beginnt mit "vorläufig:") — echte Termine
    fasst der Connector nicht an.

    Absagen setzt NICHT STATUS:CANCELLED: goneo löscht einen Termin mit diesem
    Status sofort (am 21.09.2026 nachgestellt: PUT → danach GET 404). Der
    Termin bleibt stattdessen als "vorläufig: … (abgesagt)", TENTATIVE und
    TRANSP:TRANSPARENT (Zeit wieder frei) stehen — gelöscht wird nie."""
    acc = _kalender_konto(account)
    href = _href_pruefen(acc, href)
    status, kopf, daten = vm._dav_http(acc, 'GET', href)
    if status == 404:
        raise MailError('Termin nicht gefunden')
    vm._dav_check(status, 'Termin lesen')
    text = daten.decode('utf-8', 'replace')
    events = vm.ics_parse_events(text)
    if len(events) != 1 or events[0].get('recurring'):
        raise MailError('Serientermine werden nicht geändert')
    alt = events[0]
    if not (alt.get('summary') or '').lower().startswith(PRAEFIX_VORLAEUFIG.strip().lower()):
        raise MailError('Nur vorläufige Termine (Titel "vorläufig: …") dürfen geändert werden')

    ganz = alt.get('allDay', False) if all_day is None else bool(all_day)
    alt_ende = alt.get('end') or alt['start']
    if alt.get('allDay') and len(alt_ende) == 10 and alt_ende > alt['start']:
        # Ganztags-DTEND ist exklusiv gespeichert → letzter Tag einschließlich
        alt_ende = (datetime.date.fromisoformat(alt_ende) - datetime.timedelta(days=1)).isoformat()
    neu_ende = end
    if end is None:
        neu_ende = alt_ende
        if start is not None and not ganz and len(alt['start']) > 10:
            # Nur der Beginn verschoben → Dauer beibehalten
            f = '%Y-%m-%dT%H:%M:%SZ'
            dauer = datetime.datetime.strptime(alt_ende, f) - datetime.datetime.strptime(alt['start'], f)
            neu_ende = (datetime.datetime.strptime(zeit_utc(start, 'start'), f) + dauer).strftime(f)
        elif start is not None:
            neu_ende = None
    ev = _ev_dict('x', start if start is not None else alt['start'], neu_ende, ganz, None, None)
    titel = _vorlaeufig(title if title is not None else alt.get('summary'))
    if cancel and not titel.endswith('(abgesagt)'):
        titel += ' (abgesagt)'
    ev.update({'summary': titel,
               'location': alt.get('location') or '' if location is None else location,
               'description': alt.get('description') or '' if description is None else description})
    abgesagt = titel.endswith('(abgesagt)')
    ics = _ics(ev, alt['uid'], 'TENTATIVE', _sequenz_aus_ics(text) + 1, frei=abgesagt)
    extra = {}
    etag = kopf.get('ETag') or kopf.get('Etag') or kopf.get('etag')
    if etag:
        extra['If-Match'] = etag
    status, _, _ = vm._dav_http(acc, 'PUT', href, body=ics.encode('utf-8'),
                                ctype='text/calendar; charset=utf-8', extra=extra)
    vm._dav_check(status, 'Termin ändern')
    return {'ok': True, 'account': acc['email'], 'uid': alt['uid'], 'href': href, 'title': titel,
            'status': 'TENTATIVE', 'cancelled': abgesagt, 'start': ev['start'], 'end': ev['end'], 'all_day': ev['allDay']}


def delete_event(href, account=None):
    """Vorläufigen Termin endgültig löschen (CalDAV DELETE).

    Dieselbe Grenze wie update_event: nur Termine, deren Titel mit
    "vorläufig: " beginnt — von Claude angelegte also. Echte Termine des
    Postfachs bleiben unangetastet, Serientermine ebenso."""
    acc = _kalender_konto(account)
    href = _href_pruefen(acc, href)
    status, kopf, daten = vm._dav_http(acc, 'GET', href)
    if status == 404:
        raise MailError('Termin nicht gefunden')
    vm._dav_check(status, 'Termin lesen')
    events = vm.ics_parse_events(daten.decode('utf-8', 'replace'))
    if len(events) != 1 or events[0].get('recurring'):
        raise MailError('Serientermine werden nicht gelöscht')
    alt = events[0]
    titel = alt.get('summary') or ''
    if not titel.lower().startswith(PRAEFIX_VORLAEUFIG.strip().lower()):
        raise MailError('Nur vorläufige Termine (Titel "vorläufig: …") dürfen gelöscht werden')
    extra = {}
    etag = kopf.get('ETag') or kopf.get('Etag') or kopf.get('etag')
    if etag:
        extra['If-Match'] = etag       # nicht löschen, wenn inzwischen geändert
    status, _, _ = vm._dav_http(acc, 'DELETE', href, extra=extra)
    if status not in (200, 204, 404):
        vm._dav_check(status, 'Termin löschen')
    return {'ok': True, 'account': acc['email'], 'uid': alt['uid'], 'href': href,
            'title': titel, 'deleted': True}
