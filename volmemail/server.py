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
    }


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

def send_mail(acc, data):
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
    if data.get('html'):
        msg.add_alternative(data['html'], subtype='html')

    for att in data.get('attachments') or []:
        raw = base64.b64decode(att.get('data', ''))
        ctype = att.get('type') or mimetypes.guess_type(att.get('name', ''))[0] or 'application/octet-stream'
        maintype, _, subtype = ctype.partition('/')
        msg.add_attachment(raw, maintype=maintype, subtype=subtype or 'octet-stream',
                           filename=att.get('name') or 'anhang')

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
            ip = self.client_address[0]
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
