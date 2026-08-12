#!/usr/bin/env python3
"""Tests für V3D Mail — ohne echtes Postfach.

Deckt die fehleranfälligen Stellen ab: Ordnernamen-Kodierung, HTML-Säuberung,
MIME-Zerlegung und den HTTP-/Anmeldepfad. IMAP wird durch einen Stub ersetzt.
"""

import http.client
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from email.message import EmailMessage

os.environ.setdefault('HOME', tempfile.mkdtemp(prefix='v3dmail-test-'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import server  # noqa: E402


class TestUtf7(unittest.TestCase):
    CASES = [
        ('INBOX', 'INBOX'),
        ('Entwürfe', 'Entw&APw-rfe'),
        ('Gelöschte Elemente', 'Gel&APY-schte Elemente'),
        ('R&D', 'R&-D'),
        ('Ordner/Unterordner', 'Ordner/Unterordner'),
        ('日本', '&ZeVnLA-'),
    ]

    def test_encode(self):
        for plain, wire in self.CASES:
            self.assertEqual(server.utf7_encode(plain), wire, plain)

    def test_decode(self):
        for plain, wire in self.CASES:
            self.assertEqual(server.utf7_decode(wire), plain, wire)

    def test_roundtrip(self):
        for name in ['Posteingang', 'Küche & Bad', 'Ärger/Späße', 'a&b&c', 'ÄÖÜ']:
            self.assertEqual(server.utf7_decode(server.utf7_encode(name)), name)

    def test_decode_broken_input(self):
        # Kaputte Kodierung darf nicht die Ordnerliste sprengen
        self.assertIsInstance(server.utf7_decode('&&&'), str)
        self.assertIsInstance(server.utf7_decode('&ZZZZ'), str)


class TestFolderList(unittest.TestCase):
    def test_special_use_attribute(self):
        f = server.parse_list_line(rb'(\HasNoChildren \Sent) "/" "INBOX/Sent"')
        self.assertEqual(f['kind'], 'sent')
        self.assertEqual(f['path'], 'INBOX/Sent')
        self.assertEqual(f['name'], 'Sent')

    def test_german_name_fallback(self):
        f = server.parse_list_line(rb'(\HasNoChildren) "/" "Gel&APY-schte Elemente"')
        self.assertEqual(f['path'], 'Gelöschte Elemente')
        self.assertEqual(f['kind'], 'trash')

    def test_inbox(self):
        f = server.parse_list_line(rb'(\HasNoChildren) "." "INBOX"')
        self.assertEqual(f['kind'], 'inbox')

    def test_noselect_marked(self):
        f = server.parse_list_line(rb'(\Noselect \HasChildren) "/" "Archiv"')
        self.assertFalse(f['selectable'])


class TestSanitizer(unittest.TestCase):
    def test_script_removed(self):
        out, _ = server.sanitize_html('<p>hallo</p><script>alert(1)</script><p>welt</p>')
        self.assertNotIn('alert', out)
        self.assertIn('hallo', out)
        self.assertIn('welt', out)

    def test_event_handlers_removed(self):
        out, _ = server.sanitize_html('<img src="data:image/png;base64,AAA" onerror="alert(1)">')
        self.assertNotIn('onerror', out)

    def test_javascript_href_removed(self):
        out, _ = server.sanitize_html('<a href="javascript:alert(1)">klick</a>')
        self.assertNotIn('javascript:', out)
        self.assertIn('klick', out)

    def test_remote_images_blocked(self):
        out, n = server.sanitize_html('<img src="https://tracker.example/pixel.gif?id=42">')
        self.assertEqual(n, 1)
        self.assertIn('data-blocked-src', out)
        self.assertNotIn('<img src="https://tracker', out)

    def test_remote_images_allowed_on_request(self):
        out, n = server.sanitize_html('<img src="https://example.org/bild.png">', allow_remote=True)
        self.assertEqual(n, 0)
        self.assertIn('src="https://example.org/bild.png"', out)

    def test_iframe_and_form_dropped(self):
        out, _ = server.sanitize_html('<iframe src="https://x.de"></iframe><form><input></form>ok')
        self.assertNotIn('iframe', out)
        self.assertNotIn('<form', out)
        self.assertIn('ok', out)

    def test_links_get_noopener(self):
        out, _ = server.sanitize_html('<a href="https://volme3d.de">V3D</a>')
        self.assertIn('rel="noopener noreferrer nofollow"', out)
        self.assertIn('target="_blank"', out)

    def test_style_expression_stripped(self):
        out, _ = server.sanitize_html('<div style="width:expression(alert(1))">x</div>')
        self.assertNotIn('expression', out)

    def test_table_layout_kept(self):
        out, _ = server.sanitize_html('<table><tr><td bgcolor="#fff">Zelle</td></tr></table>')
        self.assertIn('<table>', out)
        self.assertIn('bgcolor="#fff"', out)

    def test_cid_becomes_placeholder(self):
        out, _ = server.sanitize_html('<img src="cid:bild1">', cid_map={'bild1': 'cid-part:3'})
        self.assertIn('cid-part:3', out)

    def test_unknown_cid_dropped(self):
        out, _ = server.sanitize_html('<img src="cid:fehlt">', cid_map={})
        self.assertNotIn('cid:', out)


# --- IMAP-Stub --------------------------------------------------------------

def build_mail():
    msg = EmailMessage()
    msg['From'] = 'Anna Beispiel <anna@beispiel.de>'
    msg['To'] = 'v3d@volme3d.de'
    msg['Subject'] = '=?utf-8?B?R3LDvMOfZSB2b20gTcO8bnN0ZXI=?='
    msg['Date'] = 'Tue, 11 Aug 2026 09:15:00 +0200'
    msg['Message-ID'] = '<abc123@beispiel.de>'
    msg.set_content('Hallo Welt\nZeile zwei')
    msg.add_alternative('<p>Hallo <b>Welt</b></p><img src="https://t.example/p.gif">'
                        '<img src="cid:logo1">', subtype='html')
    msg.get_payload()[1].add_related(b'\x89PNG-fake', maintype='image', subtype='png', cid='<logo1>')
    msg.add_attachment(b'Rechnungsdaten', maintype='application', subtype='pdf',
                       filename='Rechnung Mai.pdf')
    return msg


class FakeConn:
    """Minimaler imaplib-Ersatz für die Lesepfade."""

    capabilities = ('IMAP4REV1', 'MOVE')

    def __init__(self, raw):
        self.raw = raw
        self.stored = []

    def noop(self):
        return ('OK', [b'NOOP'])

    def select(self, folder, readonly=True):
        return ('OK', [b'1'])

    def uid(self, cmd, *args):
        if cmd == 'FETCH':
            return ('OK', [(b'1 (UID 7 FLAGS (\\Seen) RFC822.SIZE 4096 BODYSTRUCTURE ("attachment")',
                            self.raw), b')'])
        if cmd == 'SEARCH':
            return ('OK', [b'1 2 3 7'])
        if cmd == 'STORE':
            self.stored.append(args)
            return ('OK', [b''])
        return ('OK', [b''])

    def list(self):
        return ('OK', [rb'(\HasNoChildren) "/" "INBOX"',
                       rb'(\HasNoChildren \Sent) "/" "Gesendet"',
                       rb'(\HasNoChildren \Trash) "/" "Papierkorb"'])

    def logout(self):
        return ('BYE', [b''])


def fake_box(raw):
    acc = {'id': 'x', 'email': 'v3d@volme3d.de', 'imapHost': 'h', 'password': 'p'}
    box = server.Mailbox(acc)
    box.conn = FakeConn(raw)
    box.last_used = time.time()
    return box


class TestMessageParsing(unittest.TestCase):
    def setUp(self):
        self.raw = build_mail().as_bytes()
        self.box = fake_box(self.raw)

    def test_load_message_decodes_subject(self):
        m = server.load_message(self.box, 'INBOX', 7)
        self.assertEqual(m['subject'], 'Grüße vom Münster')
        self.assertEqual(m['from'][0]['email'], 'anna@beispiel.de')
        self.assertEqual(m['from'][0]['name'], 'Anna Beispiel')

    def test_remote_image_blocked_by_default(self):
        m = server.load_message(self.box, 'INBOX', 7)
        self.assertEqual(m['blockedImages'], 1)
        # URL bleibt zur Anzeige erhalten, aber nicht als ladbares src-Attribut
        self.assertNotIn(' src="https://t.example', m['html'])
        self.assertIn('data-blocked-src="https://t.example/p.gif"', m['html'])

    def test_inline_image_gets_placeholder(self):
        m = server.load_message(self.box, 'INBOX', 7)
        self.assertIn('cid-part:', m['html'])

    def test_attachment_listed(self):
        m = server.load_message(self.box, 'INBOX', 7)
        names = [a['filename'] for a in m['attachments']]
        self.assertIn('Rechnung Mai.pdf', names)
        pdf = [a for a in m['attachments'] if a['filename'] == 'Rechnung Mai.pdf'][0]
        self.assertEqual(pdf['size'], len(b'Rechnungsdaten'))
        self.assertFalse(pdf['inline'])

    def test_plain_part_available_for_quoting(self):
        m = server.load_message(self.box, 'INBOX', 7)
        self.assertIn('Hallo Welt', m['plain'])

    def test_attachment_download(self):
        m = server.load_message(self.box, 'INBOX', 7)
        pdf = [a for a in m['attachments'] if a['filename'] == 'Rechnung Mai.pdf'][0]
        payload, ctype, name = server.load_attachment(self.box, 'INBOX', 7, pdf['part'])
        self.assertEqual(payload, b'Rechnungsdaten')
        self.assertEqual(ctype, 'application/pdf')
        self.assertEqual(name, 'Rechnung Mai.pdf')

    def test_fetch_list_headers(self):
        msgs = server.fetch_list(self.box, 'INBOX', [7])
        self.assertEqual(len(msgs), 1)
        self.assertEqual(msgs[0]['uid'], 7)
        self.assertEqual(msgs[0]['subject'], 'Grüße vom Münster')
        self.assertTrue(msgs[0]['seen'])
        self.assertTrue(msgs[0]['hasAttachments'])
        self.assertGreater(msgs[0]['ts'], 0)

    def test_folder_list_sorted_and_typed(self):
        folders = server.list_folders(self.box)
        self.assertEqual(folders[0]['kind'], 'inbox')
        kinds = [f['kind'] for f in folders]
        self.assertIn('sent', kinds)
        self.assertIn('trash', kinds)

    def test_find_special(self):
        self.assertEqual(server.find_special(self.box, 'trash'), 'Papierkorb')


class TestHtmlFromPlainOnly(unittest.TestCase):
    def test_plain_mail_is_escaped(self):
        msg = EmailMessage()
        msg['From'] = 'a@b.de'
        msg['Subject'] = 'Test'
        msg.set_content('<nicht als html> & mehr\nhttps://volme3d.de')
        box = fake_box(msg.as_bytes())
        m = server.load_message(box, 'INBOX', 7)
        self.assertIn('&lt;nicht als html&gt;', m['html'])
        self.assertIn('<a href="https://volme3d.de"', m['html'])


# --- HTTP -------------------------------------------------------------------

class TestHttp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from http.server import ThreadingHTTPServer
        server.CFG['adminKey'] = 'test-schluessel'
        cls.srv = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.srv.daemon_threads = True
        cls.port = cls.srv.server_address[1]
        cls.t = threading.Thread(target=cls.srv.serve_forever, daemon=True)
        cls.t.start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def req(self, method, path, body=None, cookie=None):
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        headers = {'Content-Type': 'application/json'}
        if cookie:
            headers['Cookie'] = cookie
        c.request(method, path, json.dumps(body) if body is not None else None, headers)
        r = c.getresponse()
        data = r.read()
        out = (r.status, r.getheader('Set-Cookie'), data)
        c.close()
        return out

    def test_state_unauthed(self):
        status, _, data = self.req('GET', '/api/state')
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(data)['authed'])

    def test_wrong_key_rejected(self):
        status, _, _ = self.req('POST', '/api/login', {'key': 'falsch'})
        self.assertEqual(status, 401)

    def test_login_and_session(self):
        status, cookie, _ = self.req('POST', '/api/login', {'key': 'test-schluessel'})
        self.assertEqual(status, 200)
        self.assertIn('HttpOnly', cookie)
        sid = cookie.split(';')[0]
        status, _, data = self.req('GET', '/api/state', cookie=sid)
        self.assertTrue(json.loads(data)['authed'])

    def test_api_requires_auth(self):
        status, _, _ = self.req('GET', '/api/folders?acc=x')
        self.assertEqual(status, 401)

    def test_index_served(self):
        status, _, data = self.req('GET', '/')
        self.assertEqual(status, 200)
        self.assertIn(b'V3D Mail', data)

    def test_funnel_path_prefix(self):
        status, _, data = self.req('GET', '/mail/')
        self.assertEqual(status, 200)
        self.assertIn(b'V3D Mail', data)

    def test_no_path_traversal(self):
        status, _, _ = self.req('GET', '/../../etc/passwd')
        self.assertIn(status, (400, 404))

    def test_unknown_endpoint(self):
        status, cookie, _ = self.req('POST', '/api/login', {'key': 'test-schluessel'})
        sid = cookie.split(';')[0]
        status, _, _ = self.req('GET', '/api/gibtsnicht', cookie=sid)
        self.assertEqual(status, 404)


class TestReadableError(unittest.TestCase):
    def test_bytes_repr_unwrapped(self):
        e = Exception("b'[AUTHENTICATIONFAILED] Authentication failed.'")
        msg = server.readable_error(e, 'IMAP')
        self.assertNotIn("b'", msg)
        self.assertIn('Passwort', msg)

    def test_unknown_error_kept_but_labelled(self):
        msg = server.readable_error(Exception('SELECT kaputt'), 'IMAP')
        self.assertIn('IMAP-Fehler', msg)
        self.assertIn('SELECT kaputt', msg)


class TestAccountStorage(unittest.TestCase):
    def test_public_account_hides_password(self):
        a = {'id': '1', 'email': 'a@b.de', 'password': 'geheim', 'smtpPassword': 'auch',
             'imapHost': 'imap.b.de'}
        pub = server.public_account(a)
        self.assertNotIn('password', pub)
        self.assertNotIn('smtpPassword', pub)
        self.assertEqual(pub['email'], 'a@b.de')

    def test_config_file_is_private(self):
        server.save_conf({'adminKey': 'x', 'port': 1, 'accounts': []})
        mode = os.stat(server.CONF_FILE).st_mode & 0o777
        self.assertEqual(mode, 0o600, 'config.json muss 0600 sein — enthält Klartext-Passwörter')


if __name__ == '__main__':
    unittest.main(verbosity=2)
