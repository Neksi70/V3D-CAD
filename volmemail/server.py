#!/usr/bin/env python3
"""V3D Mail — eigener Mail-Client (Web) für Volme 3D.

Reiner Standardbibliotheks-Dienst: imaplib/smtplib/email, keine Abhängigkeiten.
Die Postfächer bleiben beim Hoster; dieser Dienst ist nur der Client.

Zugangsdaten liegen in ~/.config/v3dmail/config.json (Modus 0600, außerhalb
des Repos). Es ist bewusst KEINE Verschlüsselung im Spiel: der Dienst muss die
Passwörter im Klartext an IMAP/SMTP weiterreichen. Wer die Datei lesen kann,
kann auch Mail lesen — der Schutz ist die Dateiberechtigung, nicht Krypto.

Start:  python3 server.py [port]
"""

import base64
import binascii
import concurrent.futures
import email.header
import email.utils
import hmac
import html
import imaplib
import json
import mimetypes
import os
import re
import secrets
import smtplib
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
CONF_DIR = os.path.join(os.path.expanduser('~'), '.config', 'v3dmail')
CONF_FILE = os.path.join(CONF_DIR, 'config.json')
CERT_FILE = '/home/v3da/v3da.tailf05fe9.ts.net.crt'
KEY_FILE = '/home/v3da/v3da.tailf05fe9.ts.net.key'
BASE = '/mail'          # öffentlicher Funnel-Pfad; direkt auf dem Port läuft alles unter /
DEFAULT_PORT = 8783

# Große Mails nicht komplett in den Speicher ziehen (Anhänge holen wir separat).
MAX_BODY_BYTES = 25 * 1024 * 1024
PAGE_SIZE = 50

imaplib._MAXLINE = 10 * 1024 * 1024


# --- Konfiguration ----------------------------------------------------------

_conf_lock = threading.Lock()


def load_conf():
    conf = {}
    try:
        with open(CONF_FILE, 'r', encoding='utf-8') as fh:
            conf = json.load(fh)
    except Exception:
        pass
    changed = False
    if not conf.get('adminKey'):
        conf['adminKey'] = secrets.token_urlsafe(16)
        changed = True
    if 'port' not in conf:
        conf['port'] = DEFAULT_PORT
        changed = True
    if 'accounts' not in conf:
        conf['accounts'] = []
        changed = True
    if changed:
        save_conf(conf)
    return conf


def save_conf(conf):
    os.makedirs(CONF_DIR, mode=0o700, exist_ok=True)
    tmp = CONF_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(conf, fh, indent=2, ensure_ascii=False)
    os.chmod(tmp, 0o600)
    os.replace(tmp, CONF_FILE)


CFG = load_conf()


def account_by_id(acc_id):
    for a in CFG.get('accounts', []):
        if a.get('id') == acc_id:
            return a
    return None


def public_account(a):
    """Konto ohne Passwörter, für die Oberfläche."""
    return {
        'id': a['id'],
        'name': a.get('name') or a.get('email'),
        'email': a.get('email'),
        'imapHost': a.get('imapHost'),
        'imapPort': a.get('imapPort'),
        'imapSSL': a.get('imapSSL', True),
        'smtpHost': a.get('smtpHost'),
        'smtpPort': a.get('smtpPort'),
        'smtpMode': a.get('smtpMode', 'starttls'),
        'user': a.get('user'),
        'smtpUser': a.get('smtpUser') or a.get('user'),
        'signature': a.get('signature', ''),
        'signatureHtml': a.get('signatureHtml', ''),
        'signatureData': a.get('signatureData') or {},
        'davReady': bool((a.get('dav') or {}).get('calendars')),
    }


# VolmeRechnung pflegt dieselben Absenderdaten bereits — von dort übernehmen
# statt abtippen zu lassen. Bank- und Steuerdaten bleiben bewusst außen vor,
# die gehören nicht in eine Signatur.
RECHNUNG_SETTINGS = os.path.join(os.path.expanduser('~'), 'volmerechnung', 'data', 'settings.json')


def firmendaten():
    try:
        with open(RECHNUNG_SETTINGS, 'r', encoding='utf-8') as fh:
            firma = (json.load(fh) or {}).get('firma') or {}
    except Exception:
        return {}
    erlaubt = ('name', 'inhaber', 'strasse', 'plz', 'ort', 'telefon', 'email', 'web', 'slogan')
    return {k: firma.get(k, '') for k in erlaubt if firma.get(k)}


# --- Sitzungen --------------------------------------------------------------

SESSIONS = {}           # sid -> ablaufzeit
SESSION_TTL = 30 * 24 * 3600
_login_fails = {}       # ip -> (anzahl, letzter_versuch)
_sess_lock = threading.Lock()


def new_session():
    sid = secrets.token_urlsafe(24)
    with _sess_lock:
        now = time.time()
        for k, exp in list(SESSIONS.items()):
            if exp < now:
                del SESSIONS[k]
        SESSIONS[sid] = now + SESSION_TTL
    return sid


def session_valid(sid):
    if not sid:
        return False
    with _sess_lock:
        exp = SESSIONS.get(sid)
        if not exp:
            return False
        if exp < time.time():
            del SESSIONS[sid]
            return False
        return True


def login_blocked(ip):
    """Nach 5 Fehlversuchen 5 Minuten Sperre pro IP."""
    n, last = _login_fails.get(ip, (0, 0))
    if n >= 5 and time.time() - last < 300:
        return True
    return False


def login_fail(ip):
    n, last = _login_fails.get(ip, (0, 0))
    if time.time() - last > 300:
        n = 0
    _login_fails[ip] = (n + 1, time.time())


# --- IMAP-Hilfen ------------------------------------------------------------

def utf7_encode(name):
    """Ordnernamen nach modifiziertem UTF-7 (RFC 3501)."""
    out = []
    i = 0
    while i < len(name):
        ch = name[i]
        if ch == '&':
            out.append('&-')
            i += 1
        elif 0x20 <= ord(ch) <= 0x7e:
            out.append(ch)
            i += 1
        else:
            j = i
            while j < len(name) and not (0x20 <= ord(name[j]) <= 0x7e):
                j += 1
            chunk = name[i:j].encode('utf-16-be')
            b64 = base64.b64encode(chunk).decode('ascii').rstrip('=').replace('/', ',')
            out.append('&' + b64 + '-')
            i = j
    return ''.join(out)


def utf7_decode(raw):
    if isinstance(raw, bytes):
        raw = raw.decode('ascii', 'replace')
    out = []
    i = 0
    while i < len(raw):
        ch = raw[i]
        if ch != '&':
            out.append(ch)
            i += 1
            continue
        end = raw.find('-', i + 1)
        if end == -1:
            out.append(ch)
            i += 1
            continue
        chunk = raw[i + 1:end]
        if chunk == '':
            out.append('&')
        else:
            b64 = chunk.replace(',', '/')
            b64 += '=' * (-len(b64) % 4)
            try:
                out.append(base64.b64decode(b64).decode('utf-16-be'))
            except (binascii.Error, UnicodeDecodeError):
                out.append(raw[i:end + 1])
        i = end + 1
    return ''.join(out)


class Mailbox:
    """Eine IMAP-Verbindung pro Konto, serialisiert über ein Lock.

    imaplib ist nicht thread-sicher und der HTTP-Server ist threaded, deshalb
    hält jedes Konto genau eine Verbindung, die unter Lock benutzt wird.
    """

    def __init__(self, acc):
        self.acc = acc
        self.lock = threading.RLock()
        self.conn = None
        self.selected = None
        self.last_used = 0

    def _connect(self):
        host = self.acc['imapHost']
        port = int(self.acc.get('imapPort') or 993)
        if self.acc.get('imapSSL', True):
            conn = imaplib.IMAP4_SSL(host, port, ssl_context=ssl.create_default_context(), timeout=30)
        else:
            conn = imaplib.IMAP4(host, port, timeout=30)
            conn.starttls(ssl.create_default_context())
        conn.login(self.acc.get('user') or self.acc['email'], self.acc['password'])
        self.conn = conn
        self.selected = None

    def _alive(self):
        if not self.conn:
            return False
        try:
            self.conn.noop()
            return True
        except Exception:
            return False

    def ensure(self):
        # Bei kurz zurückliegender Nutzung sparen wir uns das NOOP.
        if self.conn and time.time() - self.last_used < 60:
            return
        if not self._alive():
            try:
                if self.conn:
                    self.conn.logout()
            except Exception:
                pass
            self.conn = None
            self._connect()

    def select(self, folder, readonly=True):
        self.ensure()
        key = (folder, readonly)
        if self.selected != key:
            typ, data = self.conn.select('"%s"' % utf7_encode(folder), readonly=readonly)
            if typ != 'OK':
                raise MailError('Ordner nicht gefunden: %s' % folder)
            self.selected = key
        self.last_used = time.time()

    def close(self):
        with self.lock:
            try:
                if self.conn:
                    self.conn.logout()
            except Exception:
                pass
            self.conn = None
            self.selected = None


class MailError(Exception):
    pass


_boxes = {}
_boxes_lock = threading.Lock()


def get_box(acc):
    with _boxes_lock:
        box = _boxes.get(acc['id'])
        if box is None or box.acc is not acc:
            box = Mailbox(acc)
            _boxes[acc['id']] = box
        return box


def drop_box(acc_id):
    with _boxes_lock:
        box = _boxes.pop(acc_id, None)
    if box:
        box.close()


# Sonderordner an ihren SPECIAL-USE-Attributen erkennen, sonst am Namen.
SPECIAL_ATTRS = {
    '\\inbox': 'inbox', '\\sent': 'sent', '\\drafts': 'drafts',
    '\\trash': 'trash', '\\junk': 'junk', '\\archive': 'archive',
}
NAME_HINTS = [
    (('sent', 'gesendet', 'gesendete elemente', 'gesendete objekte'), 'sent'),
    (('drafts', 'entwürfe', 'entwuerfe'), 'drafts'),
    (('trash', 'papierkorb', 'gelöschte elemente', 'deleted items', 'geloeschte elemente'), 'trash'),
    (('junk', 'spam', 'junk-e-mail', 'werbung'), 'junk'),
    (('archive', 'archiv'), 'archive'),
]

LIST_RE = re.compile(r'^\((?P<flags>[^)]*)\) "?(?P<delim>[^" ]*)"? (?P<name>.*)$')


def parse_list_line(line):
    if isinstance(line, bytes):
        line = line.decode('utf-8', 'replace')
    m = LIST_RE.match(line.strip())
    if not m:
        return None
    name = m.group('name').strip()
    if name.startswith('"') and name.endswith('"'):
        name = name[1:-1]
    flags = m.group('flags').lower().split()
    kind = ''
    for f in flags:
        if f in SPECIAL_ATTRS:
            kind = SPECIAL_ATTRS[f]
    decoded = utf7_decode(name)
    if not kind:
        low = decoded.lower().split(m.group('delim') or '/')[-1]
        if low == 'inbox':
            kind = 'inbox'
        else:
            for names, k in NAME_HINTS:
                if low in names:
                    kind = k
                    break
    return {
        'path': decoded,
        'name': decoded.split(m.group('delim') or '/')[-1] if m.group('delim') else decoded,
        'delim': m.group('delim') or '/',
        'kind': kind,
        'selectable': '\\noselect' not in flags,
    }


def list_folders(box):
    with box.lock:
        box.ensure()
        typ, data = box.conn.list()
        box.last_used = time.time()
    if typ != 'OK':
        raise MailError('Ordnerliste fehlgeschlagen')
    out = []
    for line in data:
        f = parse_list_line(line)
        if f and f['selectable']:
            out.append(f)
    order = {'inbox': 0, 'drafts': 1, 'sent': 2, 'archive': 3, 'junk': 4, 'trash': 5}
    out.sort(key=lambda f: (order.get(f['kind'], 9), f['path'].lower()))
    return out


STATUS_RE = re.compile(r'MESSAGES (\d+).*?UNSEEN (\d+)|UNSEEN (\d+).*?MESSAGES (\d+)', re.S)


def account_status(acc):
    """Ungelesene und Gesamtzahl im Posteingang — per STATUS, ohne den Ordner
    zu wechseln, damit eine offene Ansicht nicht durcheinandergerät."""
    try:
        box = get_box(acc)
        inbox = find_special(box, 'inbox') or 'INBOX'
        with box.lock:
            box.ensure()
            typ, data = box.conn.status('"%s"' % utf7_encode(inbox), '(MESSAGES UNSEEN)')
            box.last_used = time.time()
        if typ != 'OK' or not data:
            raise MailError('Postfach meldet keinen Zustand')
        raw = data[0].decode('utf-8', 'replace') if isinstance(data[0], bytes) else str(data[0])
        gesamt = re.search(r'MESSAGES (\d+)', raw)
        ungelesen = re.search(r'UNSEEN (\d+)', raw)
        return {'id': acc['id'], 'email': acc.get('email'), 'inbox': inbox,
                'total': int(gesamt.group(1)) if gesamt else 0,
                'unread': int(ungelesen.group(1)) if ungelesen else 0}
    except Exception as e:
        return {'id': acc['id'], 'email': acc.get('email'),
                'error': readable_error(e, 'IMAP')}


def check_all(accounts):
    """Alle Postfächer gleichzeitig abfragen — nacheinander dauert es sonst
    so lange wie die Summe aller Verbindungen."""
    if not accounts:
        return []
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(6, len(accounts))) as pool:
        return list(pool.map(account_status, accounts))


def find_special(box, kind):
    for f in list_folders(box):
        if f['kind'] == kind:
            return f['path']
    return None


def decode_header(value):
    if not value:
        return ''
    try:
        parts = email.header.decode_header(value)
    except Exception:
        return str(value)
    out = []
    for text, enc in parts:
        if isinstance(text, bytes):
            try:
                out.append(text.decode(enc or 'utf-8', 'replace'))
            except LookupError:
                out.append(text.decode('utf-8', 'replace'))
        else:
            out.append(text)
    return ''.join(out).strip()


def addr_list(value):
    """'A B <a@b.de>, c@d.de' -> [{name, email}]"""
    out = []
    for name, addr in email.utils.getaddresses([value or '']):
        if not addr and not name:
            continue
        out.append({'name': decode_header(name), 'email': addr})
    return out


FETCH_UID_RE = re.compile(rb'UID (\d+)')
FETCH_FLAGS_RE = re.compile(rb'FLAGS \(([^)]*)\)')
FETCH_SIZE_RE = re.compile(rb'RFC822\.SIZE (\d+)')


def fetch_list(box, folder, uids):
    """Kopfzeilen einer UID-Liste holen (eine Runde, ohne Rumpf)."""
    if not uids:
        return []
    hdr = 'BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID)]'
    with box.lock:
        box.select(folder, readonly=True)
        typ, data = box.conn.uid('FETCH', ','.join(str(u) for u in uids),
                                 '(UID FLAGS RFC822.SIZE BODYSTRUCTURE %s)' % hdr)
        box.last_used = time.time()
    if typ != 'OK':
        raise MailError('Nachrichten konnten nicht geladen werden')

    msgs = {}
    for item in data:
        if not isinstance(item, tuple) or len(item) < 2:
            continue
        meta, raw = item[0], item[1]
        m = FETCH_UID_RE.search(meta)
        if not m:
            continue
        uid = int(m.group(1))
        flags = FETCH_FLAGS_RE.search(meta)
        flags = flags.group(1).decode('ascii', 'replace').split() if flags else []
        size = FETCH_SIZE_RE.search(meta)
        head = BytesParser(policy=policy.compat32).parsebytes(raw or b'')
        # Anhänge grob aus der BODYSTRUCTURE ableiten, ohne die Mail zu laden.
        has_att = b'"attachment"' in meta.lower() or b'"ATTACHMENT"' in meta
        date = decode_header(head.get('Date'))
        try:
            ts = email.utils.parsedate_to_datetime(date).timestamp()
        except Exception:
            ts = 0
        msgs[uid] = {
            'uid': uid,
            'subject': decode_header(head.get('Subject')) or '(kein Betreff)',
            'from': addr_list(head.get('From')),
            'to': addr_list(head.get('To')),
            'date': date,
            'ts': ts,
            'size': int(size.group(1)) if size else 0,
            'seen': '\\Seen' in flags,
            'flagged': '\\Flagged' in flags,
            'answered': '\\Answered' in flags,
            'draft': '\\Draft' in flags,
            'hasAttachments': has_att,
        }
    return [msgs[u] for u in uids if u in msgs]


def search_uids(box, folder, query):
    with box.lock:
        box.select(folder, readonly=True)
        if query:
            # Serverseitige Volltextsuche über Kopf und Rumpf.
            crit = ['OR', 'OR', 'FROM', _q(query), 'SUBJECT', _q(query), 'BODY', _q(query)]
            typ, data = box.conn.uid('SEARCH', 'CHARSET', 'UTF-8', *crit)
            if typ != 'OK':
                typ, data = box.conn.uid('SEARCH', None, 'TEXT', _q(query))
        else:
            typ, data = box.conn.uid('SEARCH', None, 'ALL')
        box.last_used = time.time()
    if typ != 'OK':
        raise MailError('Suche fehlgeschlagen')
    ids = (data[0] or b'').split()
    return [int(i) for i in ids]


def _q(s):
    return '"%s"' % s.replace('\\', '\\\\').replace('"', '\\"')


# --- HTML-Säuberung ---------------------------------------------------------

ALLOWED_TAGS = {
    'a', 'b', 'blockquote', 'br', 'caption', 'center', 'code', 'col', 'colgroup',
    'dd', 'div', 'dl', 'dt', 'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'small', 'span', 'strike',
    'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
    'tr', 'u', 'ul', 'wbr',
}
ALLOWED_ATTRS = {
    'href', 'src', 'alt', 'title', 'width', 'height', 'align', 'valign',
    'colspan', 'rowspan', 'border', 'cellpadding', 'cellspacing', 'color',
    'face', 'size', 'style', 'bgcolor', 'dir',
}
VOID_TAGS = {'br', 'hr', 'img', 'col', 'wbr'}
# Verworfen SAMT Inhalt. Nur Tags, die auch wirklich ein Endtag haben: der
# Zähler unten wartet darauf. Leere Elemente wie <meta> oder <link> gehören hier
# NICHT hinein — sie kämen nie zurück, der Zähler bliebe oben und die restliche
# Mail verschwände. (Outlook setzt zwei <meta> in jeden Kopf.)
# Alles andere, was nicht in ALLOWED_TAGS steht, verliert nur sein Tag; der Text
# darin bleibt erhalten — auch bei <form>, dessen Eingabefelder ohnehin fallen.
SKIP_TAGS = {'script', 'style', 'iframe', 'object', 'embed', 'svg', 'applet'}
STYLE_BAD = re.compile(r'(expression|javascript:|@import|behavior\s*:|position\s*:\s*fixed)', re.I)


class Sanitizer(HTMLParser):
    """Allowlist-Filter: entfernt Skripte, Ereignis-Attribute und externe Bilder.

    Externe Bilder werden nach data-blocked-src verschoben — Zähl-Pixel dürfen
    nicht ungefragt melden, dass die Mail geöffnet wurde.
    """

    def __init__(self, allow_remote=False, cid_map=None):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.skip_depth = 0
        self.allow_remote = allow_remote
        self.cid_map = cid_map or {}
        self.blocked = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in SKIP_TAGS:
            self.skip_depth += 1
            return
        if self.skip_depth or tag not in ALLOWED_TAGS:
            return
        parts = []
        src_ok = False
        for k, v in attrs:
            k = (k or '').lower()
            v = v or ''
            if k.startswith('on') or k not in ALLOWED_ATTRS:
                continue
            if k == 'style' and STYLE_BAD.search(v):
                continue
            if k == 'href':
                if re.match(r'^\s*(javascript|data|vbscript):', v, re.I):
                    continue
            if k == 'src':
                low = v.strip().lower()
                if low.startswith('cid:'):
                    part = self.cid_map.get(low[4:].strip('<>'))
                    if part is None:
                        continue
                    v = part
                    src_ok = True
                elif low.startswith('data:image/'):
                    src_ok = True
                elif low.startswith('http://') or low.startswith('https://'):
                    if not self.allow_remote:
                        self.blocked += 1
                        parts.append('data-blocked-src="%s"' % html.escape(v, quote=True))
                        continue
                    src_ok = True
                else:
                    continue
            parts.append('%s="%s"' % (k, html.escape(v, quote=True)))
        # Ein Bild ohne brauchbare Quelle würde nur seinen Alternativtext als
        # kryptischen Textschnipsel hinterlassen — dann lieber ganz weglassen.
        if tag == 'img' and not src_ok and not any(p.startswith('data-blocked-src') for p in parts):
            return
        if tag == 'a':
            parts.append('target="_blank"')
            parts.append('rel="noopener noreferrer nofollow"')
        self.out.append('<%s%s>' % (tag, (' ' + ' '.join(parts)) if parts else ''))

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in SKIP_TAGS:
            if self.skip_depth:
                self.skip_depth -= 1
            return
        if self.skip_depth or tag not in ALLOWED_TAGS or tag in VOID_TAGS:
            return
        self.out.append('</%s>' % tag)

    def handle_data(self, data):
        if not self.skip_depth:
            self.out.append(html.escape(data, quote=False))

    def result(self):
        return ''.join(self.out)


def sanitize_html(raw, allow_remote=False, cid_map=None):
    s = Sanitizer(allow_remote=allow_remote, cid_map=cid_map)
    try:
        s.feed(raw)
        s.close()
    except Exception:
        return html.escape(raw[:200000]), 0
    return s.result(), s.blocked


def text_to_html(text):
    esc = html.escape(text or '')
    esc = re.sub(r'(https?://[^\s<>"]+)', r'<a href="\1" target="_blank" rel="noopener noreferrer nofollow">\1</a>', esc)
    return '<pre class="plain">%s</pre>' % esc


# --- Nachricht lesen --------------------------------------------------------

def load_message(box, folder, uid, allow_remote=False):
    with box.lock:
        box.select(folder, readonly=True)
        typ, data = box.conn.uid('FETCH', str(uid), '(BODY.PEEK[])')
        box.last_used = time.time()
    if typ != 'OK' or not data or not isinstance(data[0], tuple):
        raise MailError('Nachricht nicht gefunden')
    raw = data[0][1]
    msg = BytesParser(policy=policy.default).parsebytes(raw)

    attachments = []
    cid_map = {}
    for idx, part in enumerate(msg.walk()):
        if part.get_content_maintype() == 'multipart':
            continue
        disp = (part.get_content_disposition() or '')
        cid = (part.get('Content-ID') or '').strip('<>')
        filename = part.get_filename()
        if filename:
            filename = decode_header(filename)
        is_body = disp != 'attachment' and part.get_content_type() in ('text/plain', 'text/html') and not filename
        if is_body:
            continue
        try:
            size = len(part.get_payload(decode=True) or b'')
        except Exception:
            size = 0
        item = {
            'part': part.get('X-V3D-Part') or str(idx),
            'filename': filename or (cid or 'anhang-%d' % idx),
            'type': part.get_content_type(),
            'size': size,
            'inline': disp == 'inline' or bool(cid),
            'cid': cid,
        }
        attachments.append(item)
        if cid:
            # Platzhalter — die Oberfläche ersetzt ihn durch eine data:-URL, weil
            # das Anzeige-iframe abgeschottet ist und keine Cookies mitschickt.
            # Schlüssel klein geschrieben: Outlook verweist im HTML gern in anderer
            # Schreibweise auf die Content-ID als im Kopf des Teils.
            cid_map[cid.lower()] = 'cid-part:%s' % item['part']

    body_html = ''
    blocked = 0
    try:
        best = msg.get_body(preferencelist=('html', 'plain'))
    except Exception:
        best = None
    if best is not None:
        content = best.get_content()
        if best.get_content_subtype() == 'html':
            body_html, blocked = sanitize_html(content, allow_remote, cid_map)
        else:
            body_html = text_to_html(content)
    else:
        try:
            payload = msg.get_payload(decode=True)
            body_html = text_to_html((payload or b'').decode('utf-8', 'replace'))
        except Exception:
            body_html = '<p><em>Inhalt konnte nicht dargestellt werden.</em></p>'

    plain = ''
    try:
        p = msg.get_body(preferencelist=('plain',))
        if p is not None:
            plain = p.get_content()
    except Exception:
        pass

    # Sicherheitsgurt: bleibt nach der Säuberung nichts Lesbares übrig, obwohl es
    # einen Textteil gibt, dann lieber den Text zeigen als eine leere Seite.
    if plain.strip() and not re.sub(r'<[^>]*>', '', body_html).strip():
        body_html = text_to_html(plain)
        blocked = 0

    return {
        'uid': uid,
        'subject': decode_header(msg.get('Subject')) or '(kein Betreff)',
        'from': addr_list(msg.get('From')),
        'to': addr_list(msg.get('To')),
        'cc': addr_list(msg.get('Cc')),
        'replyTo': addr_list(msg.get('Reply-To')),
        'date': decode_header(msg.get('Date')),
        'messageId': (msg.get('Message-ID') or '').strip(),
        'references': (msg.get('References') or '').strip(),
        'html': body_html,
        'plain': plain,
        'blockedImages': blocked,
        'attachments': attachments,
    }


def load_attachment(box, folder, uid, part_idx):
    with box.lock:
        box.select(folder, readonly=True)
        typ, data = box.conn.uid('FETCH', str(uid), '(BODY.PEEK[])')
        box.last_used = time.time()
    if typ != 'OK' or not data or not isinstance(data[0], tuple):
        raise MailError('Nachricht nicht gefunden')
    msg = BytesParser(policy=policy.default).parsebytes(data[0][1])
    for idx, p in enumerate(msg.walk()):
        if str(idx) != str(part_idx):
            continue
        payload = p.get_payload(decode=True) or b''
        name = p.get_filename()
        name = decode_header(name) if name else 'anhang'
        return payload, p.get_content_type(), name
    raise MailError('Anhang nicht gefunden')


# --- Autoconfig -------------------------------------------------------------

def probe(host, port, timeout=4):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False


# --- Minimaler DNS-Client (SRV/MX) ------------------------------------------
# Die Standardbibliothek löst nur A/AAAA auf. Für Autodiscover und RFC 6186
# brauchen wir SRV- und MX-Einträge, deshalb hier ein kleiner eigener Resolver.

def _nameservers():
    out = []
    try:
        with open('/etc/resolv.conf', 'r', encoding='utf-8') as fh:
            for line in fh:
                if line.startswith('nameserver'):
                    parts = line.split()
                    if len(parts) > 1:
                        out.append(parts[1])
    except Exception:
        pass
    out.extend(['1.1.1.1', '9.9.9.9'])
    return out[:3]


def _dns_name(buf, off):
    """Namen ab Position off lesen, Zeiger-Komprimierung auflösen."""
    labels = []
    jumped = False
    end = off
    for _ in range(64):
        if off >= len(buf):
            break
        n = buf[off]
        if n == 0:
            off += 1
            if not jumped:
                end = off
            break
        if n & 0xC0 == 0xC0:
            ptr = ((n & 0x3F) << 8) | buf[off + 1]
            if not jumped:
                end = off + 2
            off = ptr
            jumped = True
            continue
        labels.append(buf[off + 1:off + 1 + n].decode('ascii', 'replace'))
        off += 1 + n
        if not jumped:
            end = off
    return '.'.join(labels), end


def dns_query(name, qtype, timeout=3):
    """qtype 15 = MX, 33 = SRV. Liefert Liste von (prio, wert...)-Tupeln."""
    qname = b''.join(bytes([len(p)]) + p.encode('idna' if any(ord(c) > 127 for c in p) else 'ascii')
                     for p in name.split('.') if p) + b'\x00'
    tid = secrets.randbits(16)
    pkt = tid.to_bytes(2, 'big') + b'\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00' + \
        qname + qtype.to_bytes(2, 'big') + b'\x00\x01'
    for ns in _nameservers():
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(timeout)
            s.sendto(pkt, (ns, 53))
            data, _ = s.recvfrom(4096)
            s.close()
        except Exception:
            continue
        if len(data) < 12 or data[:2] != pkt[:2]:
            continue
        qd, an = int.from_bytes(data[4:6], 'big'), int.from_bytes(data[6:8], 'big')
        off = 12
        for _ in range(qd):
            _, off = _dns_name(data, off)
            off += 4
        out = []
        for _ in range(an):
            _, off = _dns_name(data, off)
            if off + 10 > len(data):
                break
            rtype = int.from_bytes(data[off:off + 2], 'big')
            rdlen = int.from_bytes(data[off + 8:off + 10], 'big')
            rdata = off + 10
            if rtype == 15 and qtype == 15:
                prio = int.from_bytes(data[rdata:rdata + 2], 'big')
                host, _ = _dns_name(data, rdata + 2)
                out.append((prio, host))
            elif rtype == 33 and qtype == 33:
                prio = int.from_bytes(data[rdata:rdata + 2], 'big')
                port = int.from_bytes(data[rdata + 4:rdata + 6], 'big')
                host, _ = _dns_name(data, rdata + 6)
                out.append((prio, host, port))
            off = rdata + rdlen
        if out:
            out.sort()
            return out
    return []


# --- Serversuche ------------------------------------------------------------

def _https_get(url, timeout=6):
    req = urllib.request.Request(url, headers={'User-Agent': 'V3DMail/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode('utf-8', 'replace')


def _tag(block, tag):
    m = re.search(r'<%s[^>]*>([^<]*)</%s>' % (tag, tag), block, re.I)
    return m.group(1).strip() if m else ''


def try_mozilla_autoconfig(url, address):
    """Thunderbird-Format — von der ISPDB und von Hostern selbst ausgeliefert."""
    xml = _https_get(url)
    imap = re.search(r'<incomingServer[^>]*type="imap".*?</incomingServer>', xml, re.S | re.I)
    smtp = re.search(r'<outgoingServer[^>]*type="smtp".*?</outgoingServer>', xml, re.S | re.I)
    if not (imap and smtp):
        return None
    i, o = imap.group(0), smtp.group(0)
    i_sock, o_sock = _tag(i, 'socketType').lower(), _tag(o, 'socketType').lower()
    user = _tag(i, 'username')
    return {
        'imapHost': _tag(i, 'hostname'),
        'imapPort': int(_tag(i, 'port') or 993),
        'imapSSL': i_sock != 'starttls',
        'smtpHost': _tag(o, 'hostname'),
        'smtpPort': int(_tag(o, 'port') or 587),
        'smtpMode': 'ssl' if o_sock == 'ssl' else 'starttls',
        'user': address if '%EMAILADDRESS%' in user.upper() or not user else user,
    }


AUTODISCOVER_REQ = """<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/outlook/requestschema/2006">
  <Request>
    <EMailAddress>%s</EMailAddress>
    <AcceptableResponseSchema>http://schemas.microsoft.com/exchange/autodiscover/outlook/responseschema/2006a</AcceptableResponseSchema>
  </Request>
</Autodiscover>"""


def try_autodiscover(url, address):
    """Microsofts Autodiscover — den Weg geht auch Outlook.

    Nur https, und ohne Passwort: viele Hoster (z.B. goneo) antworten auch
    unangemeldet mit den reinen Serverdaten.
    """
    if not url.startswith('https://'):
        return None
    body = (AUTODISCOVER_REQ % html.escape(address)).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST',
                                 headers={'Content-Type': 'text/xml; charset=utf-8',
                                          'User-Agent': 'V3DMail/1.0'})
    with urllib.request.urlopen(req, timeout=8) as resp:
        xml = resp.read().decode('utf-8', 'replace')
    if '<Protocol' not in xml:
        return None
    out = {}
    for block in re.findall(r'<Protocol>.*?</Protocol>', xml, re.S | re.I):
        typ = _tag(block, 'Type').upper()
        host, port = _tag(block, 'Server'), _tag(block, 'Port')
        ssl_on = _tag(block, 'SSL').lower() in ('on', 'true')
        enc = _tag(block, 'Encryption').upper()
        if not host or not port.isdigit():
            continue
        if typ == 'IMAP':
            # Encryption=TLS meint bei Autodiscover STARTTLS, SSL/leer meint direktes TLS
            direct_tls = int(port) == 993 or (ssl_on and enc != 'TLS')
            out.update({'imapHost': host, 'imapPort': int(port), 'imapSSL': direct_tls})
            login = _tag(block, 'LoginName')
            if login:
                out['user'] = login
        elif typ == 'SMTP':
            mode = 'ssl' if (int(port) == 465 or (ssl_on and enc == 'SSL')) else 'starttls'
            out.update({'smtpHost': host, 'smtpPort': int(port), 'smtpMode': mode})
    return out if out.get('imapHost') else None


def base_domain(host):
    """mx01.goneo.de -> goneo.de (grob, reicht für die Serversuche)."""
    parts = host.strip('.').split('.')
    if len(parts) <= 2:
        return '.'.join(parts)
    # zweistufige Endungen wie co.uk berücksichtigen
    if len(parts[-2]) <= 3 and len(parts[-1]) <= 3 and len(parts) >= 3:
        return '.'.join(parts[-3:])
    return '.'.join(parts[-2:])


def probe_hosts(domain):
    """Letzter Ausweg: übliche Servernamen antasten."""
    found = {}
    for prefix in ('imap.', 'mail.', 'imap.mail.', 'secure.', ''):
        host = prefix + domain
        if probe(host, 993):
            found.update({'imapHost': host, 'imapPort': 993, 'imapSSL': True})
            break
        if probe(host, 143):
            found.update({'imapHost': host, 'imapPort': 143, 'imapSSL': False})
            break
    for prefix in ('smtp.', 'mail.', 'smtp.mail.', 'secure.', ''):
        host = prefix + domain
        if probe(host, 587):
            found.update({'smtpHost': host, 'smtpPort': 587, 'smtpMode': 'starttls'})
            break
        if probe(host, 465):
            found.update({'smtpHost': host, 'smtpPort': 465, 'smtpMode': 'ssl'})
            break
    return found if found.get('imapHost') else None


def autoconfig(address):
    """Serverdaten suchen — dieselben Wege, die auch Outlook und Thunderbird gehen.

    Reihenfolge: Anbieterdatenbank, Autodiscover (auch per SRV-Eintrag),
    Autoconfig beim Hoster, RFC-6186-SRV, dann der Mailserver aus dem
    MX-Eintrag, zuletzt Servernamen abtasten.
    """
    if '@' not in address:
        raise MailError('Bitte vollständige E-Mail-Adresse angeben')
    domain = address.split('@', 1)[1].strip().lower()
    tried = []

    def attempt(label, fn):
        try:
            r = fn()
            if r and r.get('imapHost'):
                r.setdefault('user', address)
                r.setdefault('smtpHost', r['imapHost'].replace('imap.', 'smtp.', 1))
                r.setdefault('smtpPort', 587)
                r.setdefault('smtpMode', 'starttls')
                r['source'] = label
                r['domain'] = domain
                r['tried'] = tried
                return r
        except Exception as e:
            tried.append('%s: %s' % (label, type(e).__name__))
            return None
        tried.append('%s: nichts' % label)
        return None

    steps = [
        ('Anbieterdatenbank (Thunderbird)',
         lambda: try_mozilla_autoconfig('https://autoconfig.thunderbird.net/v1.1/' + domain, address)),
        ('Autodiscover (wie Outlook)',
         lambda: try_autodiscover('https://autodiscover.%s/autodiscover/autodiscover.xml' % domain, address)),
        ('Autoconfig beim Hoster',
         lambda: try_mozilla_autoconfig(
             'https://autoconfig.%s/mail/config-v1.1.xml?emailaddress=%s' % (domain, address), address)),
        ('Autoconfig (.well-known)',
         lambda: try_mozilla_autoconfig(
             'https://%s/.well-known/autoconfig/mail/config-v1.1.xml' % domain, address)),
    ]
    for label, fn in steps:
        r = attempt(label, fn)
        if r:
            return r

    # Autodiscover per SRV-Eintrag — so findet Outlook fremdgehostete Domains.
    for _, host, port in dns_query('_autodiscover._tcp.' + domain, 33):
        r = attempt('Autodiscover über SRV-Eintrag (%s)' % host,
                    lambda h=host: try_autodiscover('https://%s/autodiscover/autodiscover.xml' % h, address))
        if r:
            return r

    # RFC 6186: der Hoster verrät seine Mailserver direkt im DNS.
    srv_imap = dns_query('_imaps._tcp.' + domain, 33) or dns_query('_imap._tcp.' + domain, 33)
    if srv_imap:
        prio, host, port = srv_imap[0]
        if host and host != '.':
            found = {'imapHost': host, 'imapPort': port, 'imapSSL': port == 993}
            sub = dns_query('_submissions._tcp.' + domain, 33) or dns_query('_submission._tcp.' + domain, 33)
            if sub and sub[0][1] != '.':
                found.update({'smtpHost': sub[0][1], 'smtpPort': sub[0][2],
                              'smtpMode': 'ssl' if sub[0][2] == 465 else 'starttls'})
            r = attempt('SRV-Einträge im DNS', lambda: found)
            if r:
                return r

    # Über den MX-Eintrag zum Hoster: mx01.goneo.de -> goneo.de
    for _, mx in dns_query(domain, 15):
        bd = base_domain(mx)
        if not bd or bd == domain:
            continue
        for label, fn in [
            ('Anbieterdatenbank über MX (%s)' % bd,
             lambda b=bd: try_mozilla_autoconfig('https://autoconfig.thunderbird.net/v1.1/' + b, address)),
            ('Autodiscover über MX (%s)' % bd,
             lambda b=bd: try_autodiscover('https://autodiscover.%s/autodiscover/autodiscover.xml' % b, address)),
            ('Mailserver des Hosters (%s)' % bd, lambda b=bd: probe_hosts(b)),
        ]:
            r = attempt(label, fn)
            if r:
                return r
        break

    r = attempt('Servernamen abgetastet', lambda: probe_hosts(domain))
    if r:
        return r
    return {'source': 'nichts gefunden — bitte manuell eintragen', 'domain': domain, 'tried': tried}


def test_account(a):
    """IMAP- und SMTP-Zugang prüfen, bevor wir das Konto speichern."""
    ctx = ssl.create_default_context()
    if a.get('imapSSL', True):
        conn = imaplib.IMAP4_SSL(a['imapHost'], int(a.get('imapPort') or 993), ssl_context=ctx, timeout=20)
    else:
        conn = imaplib.IMAP4(a['imapHost'], int(a.get('imapPort') or 143), timeout=20)
        conn.starttls(ctx)
    conn.login(a.get('user') or a['email'], a['password'])
    conn.logout()

    if a.get('smtpHost'):
        sm_user = a.get('smtpUser') or a.get('user') or a['email']
        sm_pass = a.get('smtpPassword') or a['password']
        if a.get('smtpMode') == 'ssl':
            s = smtplib.SMTP_SSL(a['smtpHost'], int(a.get('smtpPort') or 465), context=ctx, timeout=20)
        else:
            s = smtplib.SMTP(a['smtpHost'], int(a.get('smtpPort') or 587), timeout=20)
            s.ehlo()
            if a.get('smtpMode') != 'plain':
                s.starttls(context=ctx)
                s.ehlo()
        s.login(sm_user, sm_pass)
        s.quit()
    return True


# --- Senden -----------------------------------------------------------------

SIG_LOGO_CID = 'v3dsiglogo'


def logo_aus_konto(acc):
    """Das Signaturlogo liegt als data:-URL am Konto — daraus die Rohdaten."""
    roh = (acc.get('signatureData') or {}).get('logo') or ''
    if not roh.startswith('data:'):
        return None
    kopf, _, b64 = roh.partition(',')
    if not b64:
        return None
    typ = kopf[5:].split(';')[0] or 'image/png'
    return {'cid': SIG_LOGO_CID, 'data': b64, 'type': typ, 'name': 'logo.png'}


def ergaenze_signaturbild(acc, html, bilder):
    """Sicherstellen, dass zu jedem cid-Verweis im HTML auch ein Bild gehört.

    Die Oberfläche schickt das Logo normalerweise mit. Tut sie es nicht — etwa
    weil in einem alten Browserfenster noch eine frühere Fassung läuft —, holen
    wir es hier aus dem Konto. Sonst verschickt man ein kaputtes Bild, ohne es
    zu merken. Bleibt ein Verweis übrig, fliegt das Bild ganz aus dem HTML.
    """
    verweise = set(re.findall(r'cid:([A-Za-z0-9._-]+)', html))
    if not verweise:
        return html, bilder
    vorhanden = {b.get('cid') for b in bilder}
    if SIG_LOGO_CID in verweise and SIG_LOGO_CID not in vorhanden:
        logo = logo_aus_konto(acc)
        if logo:
            bilder = bilder + [logo]
            vorhanden.add(SIG_LOGO_CID)
    for fehlt in verweise - vorhanden:
        html = re.sub(r'<img[^>]*cid:%s[^>]*>' % re.escape(fehlt), '', html)
    return html, bilder


def baue_nachricht(acc, data):
    """Die Nachricht zusammensetzen — getrennt vom Versand, damit der Aufbau
    (besonders eingebettete Bilder) ohne SMTP prüfbar ist."""
    msg = EmailMessage()
    from_name = acc.get('name') or ''
    msg['From'] = email.utils.formataddr((from_name, acc['email'])) if from_name else acc['email']
    for field in ('to', 'cc', 'bcc'):
        val = (data.get(field) or '').strip()
        if val and field != 'bcc':
            msg[field.capitalize()] = val
    msg['Subject'] = data.get('subject') or ''
    msg['Date'] = email.utils.formatdate(localtime=True)
    msg['Message-ID'] = email.utils.make_msgid(domain=acc['email'].split('@')[1])
    if data.get('inReplyTo'):
        msg['In-Reply-To'] = data['inReplyTo']
        refs = ' '.join(x for x in [data.get('references', ''), data['inReplyTo']] if x)
        msg['References'] = refs.strip()

    text = data.get('text') or ''
    msg.set_content(text)
    html = data.get('html') or ''
    if html:
        bilder = [b for b in (data.get('inlineImages') or []) if b.get('cid') and b.get('data')]
        html, bilder = ergaenze_signaturbild(acc, html, bilder)
        msg.add_alternative(html, subtype='html')
        # Bilder der Signatur fest in die Nachricht legen (Content-ID). Extern
        # verlinkte Bilder blockieren Mailprogramme, und data:-URLs zeigt
        # Outlook gar nicht an.
        for bild in bilder:
            try:
                roh = base64.b64decode(bild.get('data', ''))
            except Exception:
                continue
            if not roh or not bild.get('cid'):
                continue
            maintype, _, subtype = (bild.get('type') or 'image/png').partition('/')
            msg.get_payload()[-1].add_related(
                roh, maintype=maintype or 'image', subtype=subtype or 'png',
                cid='<%s>' % bild['cid'], disposition='inline',
                filename=bild.get('name') or 'logo.png')

    for att in data.get('attachments') or []:
        raw = base64.b64decode(att.get('data', ''))
        ctype = att.get('type') or mimetypes.guess_type(att.get('name', ''))[0] or 'application/octet-stream'
        maintype, _, subtype = ctype.partition('/')
        msg.add_attachment(raw, maintype=maintype, subtype=subtype or 'octet-stream',
                           filename=att.get('name') or 'anhang')
    return msg


def send_mail(acc, data):
    msg = baue_nachricht(acc, data)

    recipients = []
    for field in ('to', 'cc', 'bcc'):
        for _, addr in email.utils.getaddresses([data.get(field) or '']):
            if addr:
                recipients.append(addr)
    if not recipients:
        raise MailError('Kein Empfänger angegeben')

    ctx = ssl.create_default_context()
    sm_user = acc.get('smtpUser') or acc.get('user') or acc['email']
    sm_pass = acc.get('smtpPassword') or acc['password']
    if acc.get('smtpMode') == 'ssl':
        s = smtplib.SMTP_SSL(acc['smtpHost'], int(acc.get('smtpPort') or 465), context=ctx, timeout=60)
    else:
        s = smtplib.SMTP(acc['smtpHost'], int(acc.get('smtpPort') or 587), timeout=60)
        s.ehlo()
        if acc.get('smtpMode') != 'plain':
            s.starttls(context=ctx)
            s.ehlo()
    try:
        s.login(sm_user, sm_pass)
        s.send_message(msg, from_addr=acc['email'], to_addrs=recipients)
    finally:
        try:
            s.quit()
        except Exception:
            pass

    # Kopie in "Gesendet" ablegen, damit andere Geräte sie auch sehen.
    saved = False
    try:
        box = get_box(acc)
        sent = find_special(box, 'sent')
        if sent:
            with box.lock:
                box.ensure()
                box.conn.append('"%s"' % utf7_encode(sent), '(\\Seen)',
                                imaplib.Time2Internaldate(time.time()), msg.as_bytes())
                box.last_used = time.time()
            saved = True
    except Exception:
        saved = False
    return {'ok': True, 'savedToSent': saved, 'messageId': msg['Message-ID']}


# --- KI (Anthropic-API) -----------------------------------------------------
# Direkter HTTPS-Aufruf statt SDK-Paket: der Dienst bleibt bewusst reine
# Standardbibliothek. Der API-Schlüssel steht in der Config (Abschnitt "ai"),
# er wird in der Oberfläche unter ✨ KI hinterlegt.

ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
AI_DEFAULT_MODEL = 'claude-haiku-4-5'
AI_MAX_INPUT = 60000    # Zeichen; längere Mails lehnen wir mit klarer Meldung ab

AI_SYSTEM = (
    'Du bist der Schreibassistent in V3D Mail, dem Mail-Programm von Volme 3D '
    '(Volker Isken, 3D-Druck-Dienstleistungen und Kurse in Hagen). '
    'Antworte auf Deutsch, außer die Mail ist eindeutig in einer anderen Sprache. '
    'Gib nur das gewünschte Ergebnis aus — keine Vorrede, keine Erklärungen, '
    'keine Anführungszeichen um das Ganze.'
)


def ai_conf():
    return CFG.get('ai') or {}


def ai_call(user_text, max_tokens=2000):
    key = (ai_conf().get('key') or '').strip()
    if not key:
        raise MailError('Kein KI-Schlüssel hinterlegt — in der Seitenleiste unter ✨ KI einrichten.')
    body = json.dumps({
        'model': ai_conf().get('model') or AI_DEFAULT_MODEL,
        'max_tokens': max_tokens,
        'system': AI_SYSTEM,
        'messages': [{'role': 'user', 'content': user_text}],
    }).encode('utf-8')
    req = urllib.request.Request(ANTHROPIC_URL, data=body, headers={
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'User-Agent': 'V3DMail/1.0',
    })
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        detail = ''
        try:
            detail = ((json.loads(e.read().decode('utf-8')) or {}).get('error') or {}).get('message') or ''
        except Exception:
            pass
        if e.code == 401:
            raise MailError('KI-Schlüssel abgelehnt — stimmt der API-Schlüssel?')
        if e.code == 429:
            raise MailError('KI-Kontingent erschöpft — kurz warten oder Limit in der Anthropic-Konsole prüfen.')
        raise MailError('KI-Anfrage fehlgeschlagen (%s): %s' % (e.code, detail or e.reason))
    except (socket.timeout, TimeoutError):
        raise MailError('KI-Anfrage: Zeitüberschreitung')
    if data.get('stop_reason') == 'refusal':
        raise MailError('Die KI hat diese Anfrage abgelehnt.')
    out = ''.join(b.get('text', '') for b in (data.get('content') or []) if b.get('type') == 'text')
    if not out.strip():
        raise MailError('Leere KI-Antwort')
    return out.strip()


def _ai_mailkopf(b):
    kopf = 'Betreff: %s\nVon: %s\n\n' % ((b.get('subject') or '(ohne Betreff)').strip(),
                                         (b.get('from') or 'unbekannt').strip())
    text = (b.get('text') or '').strip()
    if not text:
        raise MailError('Kein Mail-Text übergeben')
    if len(text) > AI_MAX_INPUT:
        raise MailError('Diese Mail ist zu lang für die KI (%d Zeichen, Grenze %d).' % (len(text), AI_MAX_INPUT))
    return kopf + text


def ai_task(b):
    task = b.get('task')
    if task == 'summary':
        prompt = ('Fasse die folgende E-Mail knapp zusammen: 2 bis 5 Stichpunkte mit dem Wesentlichen. '
                  'Wenn eine Antwort oder Handlung erwartet wird, nenne sie in einer letzten Zeile, die mit '
                  '"Zu tun:" beginnt.\n\n' + _ai_mailkopf(b))
        return ai_call(prompt, 1000)
    if task == 'draft':
        hint = (b.get('hint') or '').strip()
        prompt = ('Entwirf eine Antwort auf die folgende E-Mail. Nur den Antworttext, ohne Betreff, '
                  'ohne Grußformel-Signatur (die hängt das Programm selbst an), mit passender Anrede. '
                  'Freundlich, klar, geschäftlich-locker.\n')
        if hint:
            prompt += 'Inhaltliche Vorgabe des Nutzers: %s\n' % hint
        prompt += '\n' + _ai_mailkopf(b)
        return ai_call(prompt, 1500)
    if task == 'polish':
        text = (b.get('text') or '').strip()
        if not text:
            raise MailError('Kein Text übergeben')
        if len(text) > AI_MAX_INPUT:
            raise MailError('Der Text ist zu lang für die KI.')
        betreff = (b.get('subject') or '').strip()
        if b.get('mode') == 'ausformulieren':
            prompt = ('Formuliere aus den folgenden Stichpunkten eine fertige E-Mail aus '
                      '(nur den Text, ohne Betreff, ohne Signatur). '
                      + ('Betreff der Mail: %s. ' % betreff if betreff else '')
                      + 'Stichpunkte:\n\n' + text)
        else:
            prompt = ('Verbessere den folgenden E-Mail-Text: Rechtschreibung, Grammatik und Ton glätten, '
                      'Inhalt und Sprache beibehalten, nichts dazuerfinden. Gib nur den überarbeiteten '
                      'Text aus.\n\n' + text)
        return ai_call(prompt, 1500)
    raise MailError('Unbekannte KI-Aufgabe')


# --- Kalender (CalDAV) ------------------------------------------------------
# Termine liegen beim Mail-Hoster (goneo: Host goneo.email, Voraussetzung
# "Webmail Plus") und werden per CalDAV gelesen/geschrieben — damit sind sie
# auch am Handy und in Thunderbird dieselben. Eigener Mini-Client, weil der
# Dienst ohne Fremdpakete auskommt.

DAV_NS = {'d': 'DAV:', 'c': 'urn:ietf:params:xml:ns:caldav'}


def _dav_http(acc, method, url, body=None, ctype=None, depth=None, extra=None,
              follow=True, anon=False):
    """Eine DAV-Anfrage; folgt Umleitungen selbst (urllib kann kein PROPFIND-Redirect)."""
    import http.client
    from urllib.parse import urlsplit, urljoin
    dav = acc.get('dav') or {}
    user = dav.get('user') or acc.get('user') or acc.get('email')
    pw = dav.get('password') or acc.get('password') or ''
    auth = base64.b64encode(('%s:%s' % (user, pw)).encode('utf-8')).decode('ascii')
    for _ in range(4):
        u = urlsplit(url)
        conn = http.client.HTTPSConnection(u.hostname, u.port or 443, timeout=25)
        hdrs = {'User-Agent': 'V3DMail/1.0'}
        if not anon:
            hdrs['Authorization'] = 'Basic ' + auth
        if depth is not None:
            hdrs['Depth'] = str(depth)
        if ctype:
            hdrs['Content-Type'] = ctype
        hdrs.update(extra or {})
        try:
            conn.request(method, (u.path or '/') + (('?' + u.query) if u.query else ''),
                         body=body, headers=hdrs)
            resp = conn.getresponse()
            data = resp.read()
        finally:
            conn.close()
        if follow and resp.status in (301, 302, 307, 308) and resp.getheader('Location'):
            url = urljoin(url, resp.getheader('Location'))
            continue
        return resp.status, dict(resp.getheaders()), data
    raise MailError('Kalender-Server leitet endlos um')


def _dav_check(status, was):
    if status == 401:
        raise MailError('Kalender-Anmeldung abgelehnt — für goneo muss "Webmail Plus" '
                        'im Tarif aktiv sein; Zugangsdaten sind die des Postfachs.')
    if status >= 400:
        raise MailError('%s fehlgeschlagen (HTTP %d)' % (was, status))


def _xml_findall(data, path):
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        raise MailError('Unverständliche Kalender-Antwort')
    return root.findall(path, DAV_NS)


def dav_discover(acc):
    """CalDAV-Wurzel finden: SRV der Mail-Domain, .well-known, bekannte Hoster."""
    from urllib.parse import urljoin
    domain = (acc.get('email') or '').split('@')[-1].strip().lower()
    kandidaten = []
    for row in dns_query('_caldavs._tcp.' + domain, 33):
        host, port = row[1], row[2]
        kandidaten.append('https://%s%s/.well-known/caldav' % (host, '' if port in (0, 443) else ':%d' % port))
    kandidaten.append('https://%s/.well-known/caldav' % domain)
    hoster = base_domain(acc.get('imapHost') or '')
    if hoster and hoster != domain:
        kandidaten.append('https://%s/.well-known/caldav' % hoster)
    if 'goneo' in (acc.get('imapHost') or ''):
        kandidaten.append('https://goneo.email/.well-known/caldav')
    tried = []
    for url in kandidaten:
        # Die Umleitung der well-known-Adresse verrät die DAV-Wurzel. Per GET
        # erfragen — auf ein PROPFIND antworten manche Server dort mit 500
        # (goneo.email), die Umleitung schicken sie nur bei GET.
        wurzeln = []
        try:
            status, hdrs, _ = _dav_http(acc, 'GET', url, follow=False)
            ort = next((v for k, v in hdrs.items() if k.lower() == 'location'), None)
            if status in (301, 302, 307, 308) and ort:
                from urllib.parse import urljoin as _uj
                wurzeln.append(_uj(url, ort))
        except (OSError, MailError) as e:
            tried.append('%s: %s' % (url, e))
            continue
        wurzeln.append(url)
        for wurzel in wurzeln:
            try:
                status, _, _ = _dav_http(acc, 'PROPFIND', wurzel, body=PROPFIND_PRINCIPAL,
                                         ctype='application/xml; charset=utf-8', depth=0)
            except (OSError, MailError) as e:
                tried.append('%s: %s' % (wurzel, e))
                continue
            if status in (207, 401):    # 401 = Endpunkt existiert, nur Anmeldung fehlt
                _dav_check(status, 'Kalender-Suche')
                return wurzel
            if status == 500:
                # goneo-Eigenart: verworfene Zugangsdaten quittiert der Server
                # mit 500 statt 401. Ohne Anmeldung gegenprüfen — kommt dann
                # 401, existiert der Endpunkt und es liegt an der Anmeldung.
                try:
                    s2, _, _ = _dav_http(acc, 'PROPFIND', wurzel, body=PROPFIND_PRINCIPAL,
                                         ctype='application/xml; charset=utf-8', depth=0, anon=True)
                except (OSError, MailError):
                    s2 = None
                if s2 == 401:
                    raise MailError('Kalender gefunden (%s), aber der Server verwirft die '
                                    'Postfach-Zugangsdaten. Bei goneo muss „Webmail Plus" im '
                                    'Tarif aktiv sein — danach hier erneut verbinden.' % wurzel)
            tried.append('%s: HTTP %d' % (wurzel, status))
    raise MailError('Kein CalDAV-Server gefunden. Versucht: ' + '; '.join(tried))


PROPFIND_PRINCIPAL = (b'<?xml version="1.0"?><d:propfind xmlns:d="DAV:">'
                      b'<d:prop><d:current-user-principal/></d:prop></d:propfind>')
PROPFIND_HOME = (b'<?xml version="1.0"?><d:propfind xmlns:d="DAV:" '
                 b'xmlns:c="urn:ietf:params:xml:ns:caldav">'
                 b'<d:prop><c:calendar-home-set/></d:prop></d:propfind>')
PROPFIND_CALS = (b'<?xml version="1.0"?><d:propfind xmlns:d="DAV:" '
                 b'xmlns:c="urn:ietf:params:xml:ns:caldav">'
                 b'<d:prop><d:displayname/><d:resourcetype/>'
                 b'<c:supported-calendar-component-set/></d:prop></d:propfind>')


def dav_setup(acc):
    """Kalenderliste des Kontos ermitteln und im Konto speichern."""
    from urllib.parse import urljoin
    wurzel = dav_discover(acc)
    status, _, data = _dav_http(acc, 'PROPFIND', wurzel, body=PROPFIND_PRINCIPAL,
                                ctype='application/xml; charset=utf-8', depth=0)
    _dav_check(status, 'Kalender-Suche')
    hrefs = [h.text for h in _xml_findall(data, './/d:current-user-principal/d:href') if h.text]
    if not hrefs:
        raise MailError('Kalender-Server nennt kein Benutzerkonto (principal)')
    principal = urljoin(wurzel, hrefs[0])
    status, _, data = _dav_http(acc, 'PROPFIND', principal, body=PROPFIND_HOME,
                                ctype='application/xml; charset=utf-8', depth=0)
    _dav_check(status, 'Kalender-Suche')
    hrefs = [h.text for h in _xml_findall(data, './/c:calendar-home-set/d:href') if h.text]
    if not hrefs:
        raise MailError('Kalender-Server nennt keinen Kalender-Ordner')
    home = urljoin(wurzel, hrefs[0])
    status, _, data = _dav_http(acc, 'PROPFIND', home, body=PROPFIND_CALS,
                                ctype='application/xml; charset=utf-8', depth=1)
    _dav_check(status, 'Kalenderliste')
    cals = []
    for resp in _xml_findall(data, './/d:response'):
        href = resp.findtext('d:href', '', DAV_NS)
        if resp.find('.//d:resourcetype/c:calendar', DAV_NS) is None:
            continue
        comps = [c.get('name') for c in resp.findall('.//c:supported-calendar-component-set/c:comp', DAV_NS)]
        if comps and 'VEVENT' not in comps:
            continue
        name = resp.findtext('.//d:displayname', '', DAV_NS) or href.rstrip('/').rsplit('/', 1)[-1]
        cals.append({'href': urljoin(home, href), 'name': name})
    if not cals:
        raise MailError('Keine Kalender im Konto gefunden')
    with _conf_lock:
        acc['dav'] = {'base': wurzel, 'home': home, 'calendars': cals}
        save_conf(CFG)
    return cals


# -- iCalendar: kleiner Parser/Schreiber --

def _ics_unfold(text):
    return re.sub(r'\r?\n[ \t]', '', text.replace('\r\n', '\n'))


def _ics_unescape(v):
    return v.replace('\\n', '\n').replace('\\N', '\n').replace('\\,', ',') \
            .replace('\\;', ';').replace('\\\\', '\\')


def _ics_escape(v):
    return v.replace('\\', '\\\\').replace(';', '\\;').replace(',', '\\,') \
            .replace('\r\n', '\\n').replace('\n', '\\n')


def _ics_dt(value, params):
    """DTSTART/DTEND → (ISO-UTC-String, allDay). Naive Zeiten gelten als Europe/Berlin."""
    import datetime
    if params.get('VALUE') == 'DATE' or (len(value) == 8 and value.isdigit()):
        return value[0:4] + '-' + value[4:6] + '-' + value[6:8], True
    try:
        naiv = datetime.datetime.strptime(value.rstrip('Z'), '%Y%m%dT%H%M%S')
    except ValueError:
        raise MailError('Unverständliche Termin-Zeit: %s' % value)
    if value.endswith('Z'):
        dt = naiv.replace(tzinfo=datetime.timezone.utc)
    else:
        import zoneinfo
        try:
            tz = zoneinfo.ZoneInfo(params.get('TZID') or 'Europe/Berlin')
        except Exception:
            tz = zoneinfo.ZoneInfo('Europe/Berlin')
        dt = naiv.replace(tzinfo=tz)
    return dt.astimezone(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), False


def ics_parse_events(text):
    """Alle VEVENTs einer ICS-Datei als flache Dicts."""
    out = []
    ev = None
    for line in _ics_unfold(text).split('\n'):
        if line == 'BEGIN:VEVENT':
            ev = {}
            continue
        if line == 'END:VEVENT':
            if ev is not None and ev.get('uid') and ev.get('start'):
                ev.setdefault('end', ev['start'])
                ev.setdefault('endAllDay', ev.get('allDay', False))
                out.append(ev)
            ev = None
            continue
        if ev is None or ':' not in line:
            continue
        kopf, wert = line.split(':', 1)
        teile = kopf.split(';')
        name = teile[0].upper()
        params = {}
        for p in teile[1:]:
            if '=' in p:
                k, v = p.split('=', 1)
                params[k.upper()] = v
        if name == 'UID':
            ev['uid'] = wert
        elif name == 'SUMMARY':
            ev['summary'] = _ics_unescape(wert)
        elif name == 'LOCATION':
            ev['location'] = _ics_unescape(wert)
        elif name == 'DESCRIPTION':
            ev['description'] = _ics_unescape(wert)
        elif name == 'DTSTART':
            ev['start'], ev['allDay'] = _ics_dt(wert, params)
        elif name == 'DTEND':
            ev['end'], ev['endAllDay'] = _ics_dt(wert, params)
        elif name in ('RRULE', 'RECURRENCE-ID'):
            ev['recurring'] = True
    return out


def _ics_fold(line):
    """Zeilen nach RFC 5545 auf 75 Oktette falten."""
    raw = line.encode('utf-8')
    if len(raw) <= 75:
        return line
    out = []
    while raw:
        cut = min(75 if not out else 74, len(raw))
        # UTF-8-Fortsetzungsbytes nicht zerschneiden
        while 1 < cut < len(raw) and (raw[cut] & 0xC0) == 0x80:
            cut -= 1
        out.append(raw[:cut].decode('utf-8'))
        raw = raw[cut:]
    return '\r\n '.join(out)


def ics_build_event(ev, uid):
    """Aus dem Oberflächen-Dict eine VCALENDAR-Datei bauen (Zeiten kommen als ISO-UTC)."""
    import datetime
    zeilen = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Volme3D//V3DMail//DE',
              'BEGIN:VEVENT', 'UID:' + uid,
              'DTSTAMP:' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')]
    if ev.get('allDay'):
        start = (ev.get('start') or '').replace('-', '')[:8]
        ende = (ev.get('end') or ev.get('start') or '').replace('-', '')[:8]
        if not (len(start) == 8 and start.isdigit()):
            raise MailError('Ungültiges Termin-Datum')
        # DTEND ist bei Ganztags-Terminen exklusiv → letzter Tag + 1
        d = datetime.date(int(ende[0:4]), int(ende[4:6]), int(ende[6:8])) + datetime.timedelta(days=1)
        zeilen.append('DTSTART;VALUE=DATE:' + start)
        zeilen.append('DTEND;VALUE=DATE:' + d.strftime('%Y%m%d'))
    else:
        def utc(iso):
            try:
                dt = datetime.datetime.strptime(iso, '%Y-%m-%dT%H:%M:%SZ')
            except (ValueError, TypeError):
                raise MailError('Ungültige Termin-Zeit')
            return dt.strftime('%Y%m%dT%H%M%SZ')
        zeilen.append('DTSTART:' + utc(ev.get('start')))
        zeilen.append('DTEND:' + utc(ev.get('end') or ev.get('start')))
    if ev.get('summary'):
        zeilen.append('SUMMARY:' + _ics_escape(ev['summary']))
    if ev.get('location'):
        zeilen.append('LOCATION:' + _ics_escape(ev['location']))
    if ev.get('description'):
        zeilen.append('DESCRIPTION:' + _ics_escape(ev['description']))
    zeilen += ['END:VEVENT', 'END:VCALENDAR']
    return '\r\n'.join(_ics_fold(z) for z in zeilen) + '\r\n'


def _report_query(start, end, expand):
    innen = '<c:calendar-data/>'
    if expand:
        innen = '<c:calendar-data><c:expand start="%s" end="%s"/></c:calendar-data>' % (start, end)
    return ('<?xml version="1.0"?>'
            '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
            '<d:prop><d:getetag/>%s</d:prop>'
            '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">'
            '<c:time-range start="%s" end="%s"/>'
            '</c:comp-filter></c:comp-filter></c:filter>'
            '</c:calendar-query>' % (innen, start, end)).encode('utf-8')


def dav_events(acc, start, end):
    """Termine aller Kalender des Kontos im Zeitraum (ISO-UTC-Grenzen)."""
    from urllib.parse import urljoin
    dav = acc.get('dav') or {}
    if not dav.get('calendars'):
        raise MailError('Kalender ist für dieses Konto noch nicht verbunden')
    z_start = start.replace('-', '').replace(':', '')
    z_end = end.replace('-', '').replace(':', '')
    out = []
    for cal in dav['calendars']:
        # Wiederkehrende Termine lässt der Server aufklappen (expand); können
        # nicht alle Server — dann unaufgeklappt noch einmal.
        for expand in (True, False):
            status, _, data = _dav_http(acc, 'REPORT', cal['href'],
                                        body=_report_query(z_start, z_end, expand),
                                        ctype='application/xml; charset=utf-8', depth=1)
            if status == 207:
                break
        _dav_check(status, 'Terminabruf')
        for resp in _xml_findall(data, './/d:response'):
            href = resp.findtext('d:href', '', DAV_NS)
            ics = resp.findtext('.//c:calendar-data', '', DAV_NS)
            if not ics:
                continue
            for ev in ics_parse_events(ics):
                ev['href'] = urljoin(cal['href'], href)
                ev['calendar'] = cal['href']
                ev['calendarName'] = cal['name']
                out.append(ev)
    # Aufgeklappte Serien erkennt man am mehrfachen UID — die Instanzen dürfen
    # nicht einzeln überschrieben werden, sonst zerlegt es die ganze Serie.
    anzahl = {}
    for ev in out:
        anzahl[ev['uid']] = anzahl.get(ev['uid'], 0) + 1
    for ev in out:
        if anzahl[ev['uid']] > 1:
            ev['recurring'] = True
    out.sort(key=lambda e: e.get('start') or '')
    return out


def dav_save_event(acc, b):
    from urllib.parse import quote
    dav = acc.get('dav') or {}
    ev = b.get('ev') or {}
    href = b.get('href')
    uid = b.get('uid') or ('v3dmail-%s@volme3d' % secrets.token_hex(8))
    ics = ics_build_event(ev, uid)
    if not href:
        cal = b.get('calendar') or (dav.get('calendars') or [{}])[0].get('href')
        if not cal:
            raise MailError('Kein Kalender ausgewählt')
        href = cal.rstrip('/') + '/' + quote(uid) + '.ics'
        extra = {'If-None-Match': '*'}      # nie versehentlich überschreiben
    else:
        extra = {}
    status, _, data = _dav_http(acc, 'PUT', href, body=ics.encode('utf-8'),
                                ctype='text/calendar; charset=utf-8', extra=extra)
    _dav_check(status, 'Termin speichern')
    return {'ok': True, 'uid': uid, 'href': href}


def dav_delete_event(acc, href):
    if not href:
        raise MailError('Kein Termin angegeben')
    status, _, _ = _dav_http(acc, 'DELETE', href)
    if status not in (200, 204, 404):
        _dav_check(status, 'Termin löschen')
    return {'ok': True}


# --- HTTP -------------------------------------------------------------------

def json_bytes(obj):
    return json.dumps(obj, ensure_ascii=False).encode('utf-8')


# Serverantworten kommen als bytes-Darstellung ("b'[AUTHENTICATIONFAILED] …'")
# aus imaplib — das gehört so nicht in die Oberfläche.
ERROR_HINTS = [
    ('authenticationfailed', 'Anmeldung abgelehnt — Benutzername oder Passwort stimmt nicht.'),
    ('authentication failed', 'Anmeldung abgelehnt — Benutzername oder Passwort stimmt nicht.'),
    ('invalid credentials', 'Anmeldung abgelehnt — Benutzername oder Passwort stimmt nicht.'),
    ('login failed', 'Anmeldung abgelehnt — Benutzername oder Passwort stimmt nicht.'),
    ('authenticate first', 'Der Server verlangt eine andere Anmeldeart (evtl. OAuth2).'),
    ('too many', 'Der Server bremst uns aus (zu viele Verbindungen). Kurz warten.'),
    ('5.7.', 'Der Server hat den Versand abgelehnt — Absenderadresse und SMTP-Zugang prüfen.'),
]


def readable_error(exc, kind):
    text = str(exc)
    m = re.match(r"^b?['\"](.*)['\"]$", text.strip(), re.S)
    if m:
        text = m.group(1)
    low = text.lower()
    for needle, hint in ERROR_HINTS:
        if needle in low:
            return hint
    return '%s-Fehler: %s' % (kind, text)


class Handler(BaseHTTPRequestHandler):
    server_version = 'V3DMail'
    sys_version = ''
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (self.address_string(), fmt % args))

    # -- Grundgerüst --
    def _send(self, code, body, ctype='application/json; charset=utf-8', extra=None):
        if isinstance(body, (dict, list)):
            body = json_bytes(body)
        elif isinstance(body, str):
            body = body.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        for k, v in (extra or {}):
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _cookies(self):
        raw = self.headers.get('Cookie') or ''
        out = {}
        for part in raw.split(';'):
            if '=' in part:
                k, v = part.split('=', 1)
                out[k.strip()] = v.strip()
        return out

    def _authed(self):
        return session_valid(self._cookies().get('v3dmail_sid'))

    def _client_ip(self):
        """Hinter dem Tailscale-Funnel kommt jede Verbindung als 127.0.0.1 an;
        die echte Adresse steht in X-Forwarded-For. Der Header zählt nur bei
        Loopback-Verbindungen — von außen wäre er fälschbar."""
        ip = self.client_address[0]
        if ip in ('127.0.0.1', '::1', '::ffff:127.0.0.1'):
            fwd = (self.headers.get('X-Forwarded-For') or '').split(',')[0].strip()
            if fwd:
                return fwd
        return ip

    def _read_body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0:
            return {}
        if n > MAX_BODY_BYTES:
            raise MailError('Anfrage zu groß')
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode('utf-8'))
        except Exception:
            raise MailError('Ungültige Anfrage')

    def _path(self):
        from urllib.parse import urlparse, parse_qs
        u = urlparse(self.path)
        path = u.path
        if path == BASE:
            return None, None       # Umleitung auf BASE + '/'
        if path.startswith(BASE + '/'):
            path = path[len(BASE):] or '/'
        return path, {k: v[0] for k, v in parse_qs(u.query).items()}

    def do_GET(self):
        self._dispatch('GET')

    def do_POST(self):
        self._dispatch('POST')

    def _dispatch(self, method):
        path, q = self._path()
        if path is None:
            self.send_response(301)
            self.send_header('Location', BASE + '/')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        try:
            if method == 'POST':
                self._body()    # immer lesen, sonst hängt die nächste Anfrage
            if path.startswith('/api/'):
                return self._api(method, path, q)
            return self._static(path)
        except MailError as e:
            self._send(400, {'error': str(e)})
        except imaplib.IMAP4.error as e:
            self._send(502, {'error': readable_error(e, 'IMAP')})
        except smtplib.SMTPException as e:
            self._send(502, {'error': readable_error(e, 'SMTP')})
        except ssl.SSLError as e:
            self._send(502, {'error': 'Verschlüsselung fehlgeschlagen — passen Port und '
                                      'Verschlüsselungsart zum Server? (%s)' % e})
        except socket.gaierror:
            self._send(502, {'error': 'Server nicht gefunden — stimmt der Servername?'})
        except (socket.timeout, TimeoutError, ConnectionRefusedError, OSError) as e:
            self._send(502, {'error': 'Keine Verbindung zum Server: %s' % e})
        except Exception as e:
            sys.stderr.write('Fehler bei %s: %r\n' % (path, e))
            self._send(500, {'error': 'Interner Fehler: %s' % e})

    # -- statische Dateien --
    def _static(self, path):
        if path in ('/', '/index.html'):
            path = '/mail.html'
        name = os.path.normpath(path).lstrip('/')
        full = os.path.join(ROOT, name)
        if not full.startswith(ROOT) or not os.path.isfile(full):
            return self._send(404, {'error': 'nicht gefunden'})
        ctype = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        with open(full, 'rb') as fh:
            data = fh.read()
        extra = [('Cache-Control', 'no-cache')]
        self._send(200, data, ctype + ('; charset=utf-8' if ctype.startswith('text/') else ''), extra)

    # -- API --
    def _api(self, method, path, q):
        route = path[len('/api'):]

        if route == '/login' and method == 'POST':
            ip = self._client_ip()
            if login_blocked(ip):
                return self._send(429, {'error': 'Zu viele Versuche. Bitte 5 Minuten warten.'})
            key = (self._body().get('key') or '').strip()
            time.sleep(0.3)     # Bremse gegen Durchprobieren
            if not hmac.compare_digest(key, CFG['adminKey']):
                login_fail(ip)
                return self._send(401, {'error': 'Falscher Schlüssel'})
            _login_fails.pop(ip, None)
            sid = new_session()
            secure = '; Secure' if USE_TLS else ''
            cookie = 'v3dmail_sid=%s; Path=/; HttpOnly; SameSite=Lax; Max-Age=%d%s' % (sid, SESSION_TTL, secure)
            return self._send(200, {'ok': True}, extra=[('Set-Cookie', cookie)])

        if route == '/logout':
            sid = self._cookies().get('v3dmail_sid')
            with _sess_lock:
                SESSIONS.pop(sid, None)
            return self._send(200, {'ok': True},
                              extra=[('Set-Cookie', 'v3dmail_sid=; Path=/; Max-Age=0')])

        if route == '/state' and method == 'GET':
            if not self._authed():
                return self._send(200, {'authed': False})
            return self._send(200, {
                'authed': True,
                'accounts': [public_account(a) for a in CFG.get('accounts', [])],
            })

        if not self._authed():
            return self._send(401, {'error': 'nicht angemeldet'})

        # --- Konten ---
        if route == '/autoconfig' and method == 'POST':
            return self._send(200, autoconfig((self._body().get('email') or '').strip()))

        if route == '/account/test' and method == 'POST':
            a = self._body()
            if not a.get('password') and a.get('id'):
                old = account_by_id(a['id'])
                if old:
                    a['password'] = old['password']
            test_account(a)
            return self._send(200, {'ok': True})

        if route == '/account/save' and method == 'POST':
            a = self._body()
            with _conf_lock:
                if a.get('id'):
                    old = account_by_id(a['id'])
                    if not old:
                        raise MailError('Konto nicht gefunden')
                    if not a.get('password'):
                        a['password'] = old['password']
                    if not a.get('smtpPassword'):
                        a['smtpPassword'] = old.get('smtpPassword', '')
                    old.update(a)
                    acc = old
                else:
                    a['id'] = secrets.token_hex(6)
                    CFG.setdefault('accounts', []).append(a)
                    acc = a
                save_conf(CFG)
            drop_box(acc['id'])
            return self._send(200, {'ok': True, 'account': public_account(acc)})

        if route == '/account/delete' and method == 'POST':
            acc_id = self._body().get('id')
            with _conf_lock:
                CFG['accounts'] = [a for a in CFG.get('accounts', []) if a.get('id') != acc_id]
                save_conf(CFG)
            drop_box(acc_id)
            return self._send(200, {'ok': True})

        if route == '/firma' and method == 'GET':
            return self._send(200, {'firma': firmendaten()})

        if route == '/firmenlogo' and method == 'GET':
            # Das SVG wandelt die Oberfläche selbst in ein PNG um — hier liegt
            # kein Rasterer, und der Browser kann es ohnehin besser.
            for p in (os.path.join(os.path.expanduser('~'), 'volmerechnung', 'logo.svg'),
                      os.path.join(ROOT, 'logo.svg')):
                try:
                    with open(p, 'r', encoding='utf-8') as fh:
                        return self._send(200, {'svg': fh.read(), 'quelle': os.path.basename(p)})
                except Exception:
                    continue
            return self._send(200, {'svg': ''})

        # Senden/Empfangen: alle Postfächer auf einmal prüfen
        if route == '/check':
            return self._send(200, {'accounts': check_all(CFG.get('accounts', []))})

        # --- KI ---
        if route == '/ai/settings' and method == 'GET':
            return self._send(200, {'hasKey': bool((ai_conf().get('key') or '').strip()),
                                    'model': ai_conf().get('model') or AI_DEFAULT_MODEL})

        if route == '/ai/settings' and method == 'POST':
            b = self._body()
            with _conf_lock:
                ai = CFG.setdefault('ai', {})
                if (b.get('key') or '').strip():
                    ai['key'] = b['key'].strip()
                if b.get('clearKey'):
                    ai['key'] = ''
                if (b.get('model') or '').strip():
                    ai['model'] = b['model'].strip()
                save_conf(CFG)
            return self._send(200, {'ok': True, 'hasKey': bool((ai.get('key') or '').strip())})

        if route == '/ai' and method == 'POST':
            return self._send(200, {'text': ai_task(self._body())})

        # --- Kalender ---
        if route.startswith('/cal/') and method == 'POST':
            b = self._body()
            cal_acc = account_by_id(b.get('acc'))
            if not cal_acc:
                raise MailError('Kein Konto ausgewählt')
            if route == '/cal/setup':
                return self._send(200, {'ok': True, 'calendars': dav_setup(cal_acc)})
            if route == '/cal/events':
                return self._send(200, {'events': dav_events(cal_acc, b.get('start') or '',
                                                             b.get('end') or ''),
                                        'calendars': (cal_acc.get('dav') or {}).get('calendars') or []})
            if route == '/cal/save':
                return self._send(200, dav_save_event(cal_acc, b))
            if route == '/cal/delete':
                return self._send(200, dav_delete_event(cal_acc, b.get('href')))

        # --- Postfach ---
        acc = account_by_id((q or {}).get('acc') or (self._body_cached() or {}).get('acc'))
        if route.startswith('/folders') or route.startswith('/messages') or \
           route.startswith('/message') or route.startswith('/attachment') or \
           route in ('/flag', '/move', '/delete', '/send'):
            if not acc:
                raise MailError('Kein Konto ausgewählt')
            box = get_box(acc)

        if route == '/folders':
            return self._send(200, {'folders': list_folders(box)})

        if route == '/messages':
            folder = q.get('folder') or 'INBOX'
            page = max(0, int(q.get('page') or 0))
            query = (q.get('q') or '').strip()
            uids = search_uids(box, folder, query)
            uids.reverse()      # neueste zuerst
            total = len(uids)
            chunk = uids[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]
            msgs = fetch_list(box, folder, chunk)
            msgs.sort(key=lambda m: m['ts'], reverse=True)
            return self._send(200, {'messages': msgs, 'total': total, 'page': page,
                                    'pageSize': PAGE_SIZE, 'folder': folder})

        if route == '/message':
            folder = q.get('folder') or 'INBOX'
            uid = int(q.get('uid'))
            allow = q.get('images') == '1'
            msg = load_message(box, folder, uid, allow_remote=allow)
            if q.get('markSeen') != '0':
                try:
                    with box.lock:
                        box.select(folder, readonly=False)
                        box.conn.uid('STORE', str(uid), '+FLAGS', '(\\Seen)')
                        box.last_used = time.time()
                    msg['seen'] = True
                except Exception:
                    pass
            return self._send(200, msg)

        if route == '/attachment':
            folder = q.get('folder') or 'INBOX'
            uid = int(q.get('uid'))
            payload, ctype, name = load_attachment(box, folder, uid, q.get('part'))
            disp = 'inline' if q.get('inline') == '1' else 'attachment'
            from urllib.parse import quote
            return self._send(200, payload, ctype, extra=[
                ('Content-Disposition', "%s; filename*=UTF-8''%s" % (disp, quote(name))),
            ])

        if route == '/flag' and method == 'POST':
            b = self._body_cached()
            folder, uids = b.get('folder') or 'INBOX', b.get('uids') or []
            flag, on = b.get('flag') or '\\Seen', bool(b.get('on'))
            with box.lock:
                box.select(folder, readonly=False)
                box.conn.uid('STORE', ','.join(str(int(u)) for u in uids),
                             '+FLAGS' if on else '-FLAGS', '(%s)' % flag)
                box.last_used = time.time()
            return self._send(200, {'ok': True})

        if route == '/move' and method == 'POST':
            b = self._body_cached()
            folder, uids, target = b.get('folder') or 'INBOX', b.get('uids') or [], b.get('target')
            if not target:
                raise MailError('Kein Zielordner')
            self._move(box, folder, uids, target)
            return self._send(200, {'ok': True})

        if route == '/delete' and method == 'POST':
            b = self._body_cached()
            folder, uids = b.get('folder') or 'INBOX', b.get('uids') or []
            trash = find_special(box, 'trash')
            uid_set = ','.join(str(int(u)) for u in uids)
            if trash and folder != trash:
                self._move(box, folder, uids, trash)
            else:
                # Im Papierkorb (oder ohne Papierkorb) endgültig entfernen.
                with box.lock:
                    box.select(folder, readonly=False)
                    box.conn.uid('STORE', uid_set, '+FLAGS', '(\\Deleted)')
                    box.conn.expunge()
                    box.last_used = time.time()
            return self._send(200, {'ok': True, 'toTrash': bool(trash and folder != trash)})

        if route == '/send' and method == 'POST':
            return self._send(200, send_mail(acc, self._body_cached()))

        return self._send(404, {'error': 'unbekannter Endpunkt'})

    def _move(self, box, folder, uids, target):
        uid_set = ','.join(str(int(u)) for u in uids)
        if not uid_set:
            return
        with box.lock:
            box.select(folder, readonly=False)
            enc = '"%s"' % utf7_encode(target)
            typ = 'NO'
            if 'MOVE' in (box.conn.capabilities or ()):
                typ, _ = box.conn.uid('MOVE', uid_set, enc)
            if typ != 'OK':
                typ, _ = box.conn.uid('COPY', uid_set, enc)
                if typ != 'OK':
                    raise MailError('Verschieben fehlgeschlagen')
                box.conn.uid('STORE', uid_set, '+FLAGS', '(\\Deleted)')
                box.conn.expunge()
            box.last_used = time.time()

    _body_cache = None

    def _body(self):
        """Rumpf nur einmal von der Leitung lesen — Routen greifen mehrfach zu.

        Zweimal lesen würde bei Keep-Alive blockieren, weil die Bytes schon weg sind.
        """
        if self._body_cache is None:
            self._body_cache = self._read_body() if self.command == 'POST' else {}
        return self._body_cache

    _body_cached = _body

    def handle_one_request(self):
        self._body_cache = None
        return BaseHTTPRequestHandler.handle_one_request(self)


USE_TLS = False


def main():
    global USE_TLS
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(CFG.get('port') or DEFAULT_PORT)
    srv = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    srv.daemon_threads = True
    try:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT_FILE, KEY_FILE)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
        USE_TLS = True
    except Exception as e:
        sys.stderr.write('Kein TLS-Zertifikat (%s) — starte unverschlüsselt.\n' % e)
    scheme = 'https' if USE_TLS else 'http'
    print('V3D Mail läuft auf %s://127.0.0.1:%d/  (Schlüssel in %s)' % (scheme, port, CONF_FILE), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
