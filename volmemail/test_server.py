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

# HOME hart umbiegen, BEVOR server importiert wird: die Tests schreiben Konfiguration,
# und das darf niemals die echten Konten in ~/.config/v3dmail überschreiben.
os.environ['HOME'] = tempfile.mkdtemp(prefix='v3dmail-test-')
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

    def test_meta_tag_does_not_swallow_body(self):
        """<meta> hat kein Endtag — es darf den Überspringen-Zähler nicht hochsetzen."""
        out, _ = server.sanitize_html(
            '<html><head><meta http-equiv="Content-Type" content="text/html">'
            '<meta name="Generator" content="Word"></head>'
            '<body><p>Sichtbarer Text</p></body></html>')
        self.assertIn('Sichtbarer Text', out)

    def test_link_and_base_do_not_swallow_body(self):
        out, _ = server.sanitize_html('<head><link rel="x" href="y"><base href="z"></head>'
                                      '<body><p>Bleibt sichtbar</p></body>')
        self.assertIn('Bleibt sichtbar', out)

    def test_outlook_mail_survives_filter(self):
        """Typisches Outlook-HTML: meta, style-Block, o:p-Tags, span mit style."""
        roh = ('<html><head><meta http-equiv=Content-Type content="text/html; charset=utf-8">'
               '<meta name=Generator content="Microsoft Word 15">'
               '<style><!-- p.MsoNormal {margin:0cm} --></style></head>'
               '<body lang=DE><div class=WordSection1>'
               '<p class=MsoNormal><span style="font-size:11.0pt">Moin Volker,<o:p></o:p></span></p>'
               '<p class=MsoNormal><span style="font-size:11.0pt">anbei die Unterlagen.<o:p></o:p></span></p>'
               '</div></body></html>')
        out, _ = server.sanitize_html(roh)
        self.assertIn('Moin Volker', out)
        self.assertIn('anbei die Unterlagen', out)
        self.assertNotIn('MsoNormal {margin', out, 'CSS-Inhalt gehört nicht in den Text')

    def test_style_content_still_removed(self):
        out, _ = server.sanitize_html('<style>body{color:red}</style><p>Text</p>')
        self.assertNotIn('color:red', out)
        self.assertIn('Text', out)

    def test_unknown_cid_dropped(self):
        out, _ = server.sanitize_html('<img src="cid:fehlt">', cid_map={})
        self.assertNotIn('cid:', out)

    def test_unresolvable_image_leaves_no_alt_text(self):
        """Outlook setzt alt="id:image001.jpg@..." — das darf nicht als Text stehenbleiben."""
        out, _ = server.sanitize_html('<img src="cid:fehlt" alt="id:image001.jpg@01D62229.FD1825B0">',
                                      cid_map={})
        self.assertNotIn('image001', out)
        self.assertNotIn('<img', out)

    def test_cid_matching_ignores_case(self):
        """Die Content-ID im Kopf und der Verweis im HTML sind oft unterschiedlich geschrieben."""
        out, _ = server.sanitize_html('<img src="cid:IMAGE001.jpg@01D62229.FD1825B0">',
                                      cid_map={'image001.jpg@01d62229.fd1825b0': 'cid-part:4'})
        self.assertIn('cid-part:4', out)


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

    def status(self, folder, items):
        self.status_calls = getattr(self, 'status_calls', []) + [folder]
        return ('OK', [b'"INBOX" (MESSAGES 42 UNSEEN 7)'])

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


class TestEmptyHtmlFallback(unittest.TestCase):
    def test_falls_back_to_plain_when_html_unusable(self):
        """Wenn der HTML-Teil nichts Lesbares hergibt, muss der Textteil einspringen."""
        msg = EmailMessage()
        msg['From'] = 'a@b.de'
        msg['Subject'] = 'Test'
        msg.set_content('Das ist der eigentliche Inhalt.')
        msg.add_alternative('<html><head><style>p{color:red}</style></head><body></body></html>',
                            subtype='html')
        box = fake_box(msg.as_bytes())
        m = server.load_message(box, 'INBOX', 7)
        self.assertIn('Das ist der eigentliche Inhalt', m['html'])

    def test_outlook_style_mail_keeps_html(self):
        msg = EmailMessage()
        msg['From'] = 'a@b.de'
        msg['Subject'] = 'Test'
        msg.set_content('Nur-Text-Fassung')
        msg.add_alternative('<html><head><meta name=Generator content="Microsoft Word 15">'
                            '</head><body><p>HTML-Fassung mit <b>Formatierung</b></p></body></html>',
                            subtype='html')
        box = fake_box(msg.as_bytes())
        m = server.load_message(box, 'INBOX', 7)
        self.assertIn('HTML-Fassung mit <b>Formatierung</b>', m['html'])
        self.assertNotIn('Nur-Text-Fassung', m['html'])


class TestSendenEmpfangen(unittest.TestCase):
    """Zustandsabfrage für den Senden/Empfangen-Knopf."""

    def setUp(self):
        self.acc = {'id': 'k1', 'email': 'a@volme3dakademie.de', 'imapHost': 'h', 'password': 'p'}
        self.box = fake_box(build_mail().as_bytes())
        self.box.acc = self.acc
        server._boxes['k1'] = self.box

    def tearDown(self):
        server._boxes.pop('k1', None)

    def test_counts_read_from_status(self):
        st = server.account_status(self.acc)
        self.assertEqual(st['unread'], 7)
        self.assertEqual(st['total'], 42)
        self.assertEqual(st['email'], 'a@volme3dakademie.de')
        self.assertNotIn('error', st)

    def test_uses_special_use_inbox(self):
        server.account_status(self.acc)
        self.assertIn('"INBOX"', self.box.conn.status_calls[0])

    def test_does_not_change_selected_folder(self):
        """STATUS darf die offene Ordnerauswahl nicht umbiegen."""
        self.box.select('Gesendet', readonly=True)
        vorher = self.box.selected
        server.account_status(self.acc)
        self.assertEqual(self.box.selected, vorher)

    def test_broken_account_reports_error_instead_of_raising(self):
        def kaputt(*a, **kw):
            raise OSError('Verbindung abgelehnt')
        self.box.conn.status = kaputt
        st = server.account_status(self.acc)
        self.assertIn('error', st)
        self.assertEqual(st['id'], 'k1')

    def test_check_all_returns_one_entry_per_account(self):
        zweit = {'id': 'k2', 'email': 'b@volme3dakademie.de', 'imapHost': 'h', 'password': 'p'}
        box2 = fake_box(build_mail().as_bytes())
        box2.acc = zweit
        server._boxes['k2'] = box2
        try:
            res = server.check_all([self.acc, zweit])
            self.assertEqual([r['id'] for r in res], ['k1', 'k2'])
            self.assertEqual([r['unread'] for r in res], [7, 7])
        finally:
            server._boxes.pop('k2', None)

    def test_check_all_empty(self):
        self.assertEqual(server.check_all([]), [])


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


AUTODISCOVER_ANTWORT = """<?xml version="1.0"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006">
  <Response>
    <Account>
      <AccountType>email</AccountType>
      <Protocol>
        <Type>IMAP</Type><Server>imap.goneo.de</Server><Port>993</Port>
        <SSL>on</SSL><AuthRequired>on</AuthRequired>
        <LoginName>volker.isken@volme3dakademie.de</LoginName>
      </Protocol>
      <Protocol>
        <Type>SMTP</Type><Server>smtp.goneo.de</Server><Port>465</Port>
        <SSL>on</SSL><AuthRequired>on</AuthRequired>
      </Protocol>
    </Account>
  </Response>
</Autodiscover>"""

AUTODISCOVER_STARTTLS = """<Autodiscover><Response><Account>
  <Protocol><Type>IMAP</Type><Server>imap.beispiel.de</Server><Port>143</Port>
  <SSL>on</SSL><Encryption>TLS</Encryption></Protocol>
  <Protocol><Type>SMTP</Type><Server>smtp.beispiel.de</Server><Port>587</Port>
  <SSL>on</SSL><Encryption>TLS</Encryption></Protocol>
</Account></Response></Autodiscover>"""

MOZILLA_ANTWORT = """<clientConfig version="1.1"><emailProvider id="beispiel.de">
  <incomingServer type="imap">
    <hostname>imap.beispiel.de</hostname><port>143</port>
    <socketType>STARTTLS</socketType><username>%EMAILADDRESS%</username>
  </incomingServer>
  <outgoingServer type="smtp">
    <hostname>smtp.beispiel.de</hostname><port>587</port>
    <socketType>STARTTLS</socketType><username>%EMAILADDRESS%</username>
  </outgoingServer>
</emailProvider></clientConfig>"""


class FakeResponse:
    def __init__(self, text):
        self.text = text.encode('utf-8')

    def read(self):
        return self.text

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class TestServerLookup(unittest.TestCase):
    """Serversuche ohne Netzzugriff — urlopen wird ersetzt."""

    def setUp(self):
        import urllib.request
        self.orig = urllib.request.urlopen
        self.mod = urllib.request

    def tearDown(self):
        self.mod.urlopen = self.orig

    def serve(self, text):
        self.mod.urlopen = lambda *a, **kw: FakeResponse(text)

    def test_autodiscover_parsed(self):
        self.serve(AUTODISCOVER_ANTWORT)
        r = server.try_autodiscover('https://autodiscover.goneo.de/autodiscover/autodiscover.xml',
                                    'volker.isken@volme3dakademie.de')
        self.assertEqual(r['imapHost'], 'imap.goneo.de')
        self.assertEqual(r['imapPort'], 993)
        self.assertTrue(r['imapSSL'])
        self.assertEqual(r['smtpHost'], 'smtp.goneo.de')
        self.assertEqual(r['smtpPort'], 465)
        self.assertEqual(r['smtpMode'], 'ssl')
        self.assertEqual(r['user'], 'volker.isken@volme3dakademie.de')

    def test_autodiscover_starttls_recognised(self):
        self.serve(AUTODISCOVER_STARTTLS)
        r = server.try_autodiscover('https://autodiscover.beispiel.de/autodiscover/autodiscover.xml',
                                    'a@beispiel.de')
        self.assertFalse(r['imapSSL'], 'Encryption=TLS auf 143 ist STARTTLS, nicht direktes SSL')
        self.assertEqual(r['smtpMode'], 'starttls')

    def test_autodiscover_ignores_html_error_page(self):
        self.serve('<!DOCTYPE html><html><body>404</body></html>')
        self.assertIsNone(server.try_autodiscover('https://x.de/autodiscover/autodiscover.xml', 'a@x.de'))

    def test_autodiscover_refuses_plain_http(self):
        self.serve(AUTODISCOVER_ANTWORT)
        self.assertIsNone(server.try_autodiscover('http://x.de/autodiscover/autodiscover.xml', 'a@x.de'))

    def test_mozilla_autoconfig_parsed(self):
        self.serve(MOZILLA_ANTWORT)
        r = server.try_mozilla_autoconfig('https://autoconfig.beispiel.de/mail/config-v1.1.xml', 'a@beispiel.de')
        self.assertEqual(r['imapHost'], 'imap.beispiel.de')
        self.assertFalse(r['imapSSL'])
        self.assertEqual(r['user'], 'a@beispiel.de', 'Platzhalter %EMAILADDRESS% muss ersetzt werden')

    def test_autoconfig_uses_first_hit(self):
        self.serve(AUTODISCOVER_ANTWORT)
        r = server.autoconfig('volker.isken@volme3dakademie.de')
        self.assertEqual(r['imapHost'], 'imap.goneo.de')
        self.assertIn('source', r)

    def test_autoconfig_reports_nothing_found(self):
        def boom(*a, **kw):
            raise OSError('kein Netz')
        self.mod.urlopen = boom
        orig_dns, orig_probe = server.dns_query, server.probe
        server.dns_query = lambda *a, **kw: []
        server.probe = lambda *a, **kw: False
        try:
            r = server.autoconfig('a@gibtsnicht.invalid')
            self.assertIn('nichts gefunden', r['source'])
            self.assertTrue(r['tried'], 'Versuchsprotokoll hilft beim Nachvollziehen')
        finally:
            server.dns_query, server.probe = orig_dns, orig_probe

    def test_incomplete_address_rejected(self):
        with self.assertRaises(server.MailError):
            server.autoconfig('volker.isken')


class TestBaseDomain(unittest.TestCase):
    def test_hoster_domain_from_mx(self):
        self.assertEqual(server.base_domain('mx01.goneo.de'), 'goneo.de')
        self.assertEqual(server.base_domain('aspmx.l.google.com'), 'google.com')
        self.assertEqual(server.base_domain('goneo.de'), 'goneo.de')

    def test_two_part_suffix(self):
        self.assertEqual(server.base_domain('mail.firma.co.uk'), 'firma.co.uk')


class TestDnsParser(unittest.TestCase):
    def test_name_with_compression_pointer(self):
        # "goneo.de" ab Position 12, danach ein Zeiger darauf
        buf = b'\x00' * 12 + b'\x05goneo\x02de\x00' + b'\xc0\x0c'
        name, end = server._dns_name(buf, 12)
        self.assertEqual(name, 'goneo.de')
        ptr_name, _ = server._dns_name(buf, end)
        self.assertEqual(ptr_name, 'goneo.de')

    def test_query_survives_dead_nameserver(self):
        orig = server._nameservers
        server._nameservers = lambda: ['127.0.0.1']   # dort lauscht kein DNS
        try:
            self.assertEqual(server.dns_query('beispiel.de', 15, timeout=1), [])
        finally:
            server._nameservers = orig


def png_bytes():
    return (b'\x89PNG\r\n\x1a\n' + b'\x00' * 64)


class TestNachrichtenaufbau(unittest.TestCase):
    """Aufbau der versendeten Nachricht — besonders das eingebettete Logo."""

    def setUp(self):
        import base64
        self.b64 = base64.b64encode(png_bytes()).decode()
        self.acc = {'email': 'a@volme3dakademie.de', 'name': 'Volker Isken',
                    'signatureData': {'logo': 'data:image/png;base64,' + self.b64}}

    def typen(self, msg):
        return [p.get_content_type() for p in msg.walk()]

    def test_nur_text(self):
        msg = server.baue_nachricht(self.acc, {'to': 'x@y.de', 'text': 'Moin'})
        self.assertEqual(msg.get_content_type(), 'text/plain')

    def test_text_und_html(self):
        msg = server.baue_nachricht(self.acc, {'to': 'x@y.de', 'text': 'Moin',
                                               'html': '<p>Moin</p>'})
        self.assertIn('multipart/alternative', self.typen(msg))
        self.assertIn('text/html', self.typen(msg))

    def test_logo_wird_eingebettet(self):
        msg = server.baue_nachricht(self.acc, {
            'to': 'x@y.de', 'text': 'Moin',
            'html': '<p>Moin</p><img src="cid:v3dsiglogo">',
            'inlineImages': [{'cid': 'v3dsiglogo', 'data': self.b64, 'type': 'image/png'}]})
        self.assertIn('multipart/related', self.typen(msg))
        bilder = [p for p in msg.walk() if p.get_content_type() == 'image/png']
        self.assertEqual(len(bilder), 1)
        self.assertEqual(bilder[0].get('Content-ID'), '<v3dsiglogo>')
        self.assertEqual(bilder[0].get_payload(decode=True), png_bytes())

    def test_logo_wird_aus_dem_konto_ergaenzt(self):
        """Ein alter Browserstand schickt das Bild nicht mit — dann muss der
        Server es selbst anhängen, sonst kommt ein kaputtes Bild an."""
        msg = server.baue_nachricht(self.acc, {
            'to': 'x@y.de', 'text': 'Moin',
            'html': '<p>Moin</p><img src="cid:v3dsiglogo" width="150">'})
        bilder = [p for p in msg.walk() if p.get_content_type() == 'image/png']
        self.assertEqual(len(bilder), 1, 'Logo fehlt in der Nachricht')
        self.assertEqual(bilder[0].get('Content-ID'), '<v3dsiglogo>')

    def test_verweis_ohne_bild_wird_entfernt(self):
        """Kein Logo am Konto: dann darf auch kein toter Verweis übrig bleiben."""
        acc = {'email': 'a@b.de'}
        msg = server.baue_nachricht(acc, {
            'to': 'x@y.de', 'text': 'Moin',
            'html': '<p>Moin</p><img src="cid:v3dsiglogo" width="150" alt="Logo">'})
        html = msg.get_body(preferencelist=('html',)).get_content()
        self.assertNotIn('cid:v3dsiglogo', html)
        self.assertIn('Moin', html)

    def test_anhang_neben_logo(self):
        msg = server.baue_nachricht(self.acc, {
            'to': 'x@y.de', 'text': 'Moin', 'html': '<img src="cid:v3dsiglogo">',
            'attachments': [{'name': 'Angebot.pdf', 'type': 'application/pdf',
                             'data': self.b64}]})
        typen = self.typen(msg)
        self.assertIn('multipart/mixed', typen)
        self.assertIn('multipart/related', typen)
        self.assertIn('application/pdf', typen)

    def test_absendername_im_kopf(self):
        msg = server.baue_nachricht(self.acc, {'to': 'x@y.de', 'text': 'Moin'})
        self.assertIn('Volker Isken', msg['From'])
        self.assertIn('a@volme3dakademie.de', msg['From'])

    def test_antwortbezug_wird_gesetzt(self):
        msg = server.baue_nachricht(self.acc, {
            'to': 'x@y.de', 'text': 'Moin', 'inReplyTo': '<abc@x.de>',
            'references': '<vorher@x.de>'})
        self.assertEqual(msg['In-Reply-To'], '<abc@x.de>')
        self.assertIn('<vorher@x.de>', msg['References'])
        self.assertIn('<abc@x.de>', msg['References'])


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


class TestMultipleAccounts(unittest.TestCase):
    """Mehrere Postfächer nebeneinander — Anlegen, Ändern, Wechseln, Entfernen."""

    @classmethod
    def setUpClass(cls):
        from http.server import ThreadingHTTPServer
        server.CFG['adminKey'] = 'mehrkonten-test'
        server.CFG['accounts'] = []
        cls.srv = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.srv.daemon_threads = True
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def setUp(self):
        server.CFG['accounts'] = []
        # Anmeldung am Mailserver überspringen — hier geht es um die Verwaltung.
        self.orig_test = server.test_account
        server.test_account = lambda a: True
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        c.request('POST', '/api/login', json.dumps({'key': 'mehrkonten-test'}),
                  {'Content-Type': 'application/json'})
        r = c.getresponse()
        r.read()
        self.sid = r.getheader('Set-Cookie').split(';')[0]
        c.close()

    def tearDown(self):
        server.test_account = self.orig_test
        server.CFG['accounts'] = []

    def call(self, method, path, body=None):
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        c.request(method, path, json.dumps(body) if body is not None else None,
                  {'Content-Type': 'application/json', 'Cookie': self.sid})
        r = c.getresponse()
        data = json.loads(r.read() or b'{}')
        status = r.status
        c.close()
        return status, data

    def add(self, mail, host):
        return self.call('POST', '/api/account/save', {
            'email': mail, 'password': 'geheim-' + mail, 'imapHost': host,
            'imapPort': 993, 'imapSSL': True, 'smtpHost': host.replace('imap', 'smtp'),
            'smtpPort': 465, 'smtpMode': 'ssl', 'name': mail.split('@')[0]})

    def test_two_accounts_side_by_side(self):
        s1, a = self.add('erste@volme3dakademie.de', 'imap.goneo.de')
        s2, b = self.add('zweite@beispiel.de', 'imap.beispiel.de')
        self.assertEqual((s1, s2), (200, 200))
        self.assertNotEqual(a['account']['id'], b['account']['id'], 'jedes Konto braucht eine eigene Kennung')
        _, st = self.call('GET', '/api/state')
        self.assertEqual(len(st['accounts']), 2)
        self.assertEqual({x['email'] for x in st['accounts']},
                         {'erste@volme3dakademie.de', 'zweite@beispiel.de'})

    def test_passwords_never_leave_the_server(self):
        self.add('erste@volme3dakademie.de', 'imap.goneo.de')
        self.add('zweite@beispiel.de', 'imap.beispiel.de')
        _, st = self.call('GET', '/api/state')
        self.assertNotIn('password', json.dumps(st))
        self.assertNotIn('geheim', json.dumps(st))

    def test_edit_keeps_password_when_left_empty(self):
        _, a = self.add('erste@volme3dakademie.de', 'imap.goneo.de')
        acc_id = a['account']['id']
        status, _ = self.call('POST', '/api/account/save',
                              {'id': acc_id, 'email': 'erste@volme3dakademie.de',
                               'imapHost': 'imap.goneo.de', 'password': '', 'name': 'Neuer Name'})
        self.assertEqual(status, 200)
        stored = server.account_by_id(acc_id)
        self.assertEqual(stored['password'], 'geheim-erste@volme3dakademie.de')
        self.assertEqual(stored['name'], 'Neuer Name')

    def test_delete_removes_only_that_account(self):
        _, a = self.add('erste@volme3dakademie.de', 'imap.goneo.de')
        _, b = self.add('zweite@beispiel.de', 'imap.beispiel.de')
        self.call('POST', '/api/account/delete', {'id': a['account']['id']})
        _, st = self.call('GET', '/api/state')
        self.assertEqual([x['email'] for x in st['accounts']], ['zweite@beispiel.de'])

    def test_each_account_has_its_own_connection(self):
        _, a = self.add('erste@volme3dakademie.de', 'imap.goneo.de')
        _, b = self.add('zweite@beispiel.de', 'imap.beispiel.de')
        box_a = server.get_box(server.account_by_id(a['account']['id']))
        box_b = server.get_box(server.account_by_id(b['account']['id']))
        self.assertIsNot(box_a, box_b)
        self.assertEqual(box_a.acc['imapHost'], 'imap.goneo.de')
        self.assertEqual(box_b.acc['imapHost'], 'imap.beispiel.de')

    def test_unknown_account_rejected(self):
        status, data = self.call('GET', '/api/folders?acc=gibtsnicht')
        self.assertEqual(status, 400)
        self.assertIn('Konto', data['error'])


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


class TestICS(unittest.TestCase):
    def test_rundlauf_zeit_termin(self):
        ics = server.ics_build_event({'summary': 'Kurs, Reihe; 1', 'location': 'Hagen',
                                      'description': 'Zeile1\nZeile2',
                                      'start': '2026-08-20T09:00:00Z',
                                      'end': '2026-08-20T10:30:00Z'}, 'u1@v3d')
        ev = server.ics_parse_events(ics)[0]
        self.assertEqual(ev['summary'], 'Kurs, Reihe; 1')
        self.assertEqual(ev['start'], '2026-08-20T09:00:00Z')
        self.assertEqual(ev['end'], '2026-08-20T10:30:00Z')
        self.assertEqual(ev['description'], 'Zeile1\nZeile2')
        self.assertFalse(ev.get('allDay'))

    def test_rundlauf_ganztags(self):
        # DTEND ist exklusiv: 21.–22.8. ergibt DTEND 23.8.
        ics = server.ics_build_event({'summary': 'Messe', 'allDay': True,
                                      'start': '2026-08-21', 'end': '2026-08-22'}, 'u2@v3d')
        self.assertIn('DTSTART;VALUE=DATE:20260821', ics)
        self.assertIn('DTEND;VALUE=DATE:20260823', ics)
        ev = server.ics_parse_events(ics)[0]
        self.assertTrue(ev['allDay'])
        self.assertEqual((ev['start'], ev['end']), ('2026-08-21', '2026-08-23'))

    def test_tzid_wird_nach_utc_gerechnet(self):
        evs = server.ics_parse_events(
            'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\n'
            'DTSTART;TZID=Europe/Berlin:20260820T120000\r\nSUMMARY:M\r\n'
            'END:VEVENT\r\nEND:VCALENDAR')
        self.assertEqual(evs[0]['start'], '2026-08-20T10:00:00Z')     # Sommerzeit: −2 h

    def test_gefaltete_zeilen_und_escapes(self):
        lang = 'Sehr langer Termin ' + 'ä' * 100
        ics = server.ics_build_event({'summary': lang, 'start': '2026-08-20T09:00:00Z',
                                      'end': '2026-08-20T10:00:00Z'}, 'u3@v3d')
        for zeile in ics.split('\r\n'):
            self.assertLessEqual(len(zeile.encode('utf-8')), 76)      # 75 + Fortsetzungs-Leerzeichen
        self.assertEqual(server.ics_parse_events(ics)[0]['summary'], lang)

    def test_serie_wird_erkannt(self):
        evs = server.ics_parse_events(
            'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:s1\r\nDTSTART:20260820T090000Z\r\n'
            'RRULE:FREQ=WEEKLY\r\nSUMMARY:Kurs\r\nEND:VEVENT\r\nEND:VCALENDAR')
        self.assertTrue(evs[0].get('recurring'))


class TestKI(unittest.TestCase):
    def test_ohne_schluessel_klare_meldung(self):
        server.CFG.pop('ai', None)
        with self.assertRaises(server.MailError) as cm:
            server.ai_task({'task': 'summary', 'subject': 'x', 'text': 'Hallo'})
        self.assertIn('KI-Schlüssel', str(cm.exception))

    def test_leerer_text_wird_abgelehnt(self):
        with self.assertRaises(server.MailError):
            server.ai_task({'task': 'summary', 'subject': 'x', 'text': ''})

    def test_zu_lange_mail_wird_abgelehnt(self):
        server.CFG['ai'] = {'key': 'sk-test'}
        try:
            with self.assertRaises(server.MailError) as cm:
                server.ai_task({'task': 'summary', 'text': 'x' * (server.AI_MAX_INPUT + 1)})
            self.assertIn('zu lang', str(cm.exception))
        finally:
            server.CFG.pop('ai', None)

    def test_unbekannte_aufgabe(self):
        with self.assertRaises(server.MailError):
            server.ai_task({'task': 'hex'})

    def test_prompt_bau(self):
        # ai_call stubben — es darf keine echte Anfrage rausgehen
        server.CFG['ai'] = {'key': 'sk-test'}
        gesehen = {}
        echt = server.ai_call
        server.ai_call = lambda text, max_tokens=2000: (gesehen.setdefault('text', text), 'OK')[1]
        try:
            out = server.ai_task({'task': 'draft', 'subject': 'Anfrage', 'from': 'k@d.de',
                                  'text': 'Haben Sie Donnerstag Zeit?', 'hint': 'zusagen'})
            self.assertEqual(out, 'OK')
            self.assertIn('Betreff: Anfrage', gesehen['text'])
            self.assertIn('zusagen', gesehen['text'])
        finally:
            server.ai_call = echt
            server.CFG.pop('ai', None)


class TestKalenderRouten(unittest.TestCase):
    """Kalender-Routen: Kontoprüfung und Fehlerbilder ohne echten DAV-Server."""

    def test_events_ohne_dav_klare_meldung(self):
        acc = {'id': 'k1', 'email': 'a@b.de'}
        with self.assertRaises(server.MailError) as cm:
            server.dav_events(acc, '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z')
        self.assertIn('nicht verbunden', str(cm.exception))

    def test_delete_ohne_href(self):
        with self.assertRaises(server.MailError):
            server.dav_delete_event({'id': 'k1'}, '')


class TestBildWeiterleitung(unittest.TestCase):
    """Bilder aus dem Netz holt der Server — aber nur oeffentliche Adressen."""

    def test_eigenes_netz_gesperrt(self):
        for host in ('localhost', '127.0.0.1', '10.0.0.5', '192.168.1.10', '169.254.1.1'):
            self.assertFalse(server._adresse_erlaubt(host), host)

    def test_fremdes_schema_gesperrt(self):
        for url in ('file:///etc/passwd', 'ftp://beispiel.de/x.png', 'data:image/png;base64,AA', ''):
            with self.assertRaises(server.MailError):
                server.fetch_remote_image(url)

    def test_interne_adresse_wird_abgewiesen(self):
        with self.assertRaises(server.MailError) as cm:
            server.fetch_remote_image('http://127.0.0.1:1/logo.png')
        self.assertIn('nicht erlaubt', str(cm.exception))

    def test_bildtyp_aus_kennung(self):
        self.assertEqual(server._bildtyp(b'\x89PNG\r\n\x1a\n rest'), 'image/png')
        self.assertEqual(server._bildtyp(b'GIF89a...'), 'image/gif')
        self.assertEqual(server._bildtyp(b'\xff\xd8\xff\xe0'), 'image/jpeg')
        self.assertEqual(server._bildtyp(b'RIFF????WEBPVP8 '), 'image/webp')
        self.assertEqual(server._bildtyp(b'nur Text'), 'application/octet-stream')


class McpConn(FakeConn):
    """FakeConn mit Entwürfe-Ordner und APPEND — für die Claude-Anbindung."""

    def list(self):
        return ('OK', [rb'(\HasNoChildren) "/" "INBOX"',
                       rb'(\HasNoChildren \Drafts) "/" "Entw&APw-rfe"',
                       rb'(\HasNoChildren \Sent) "/" "Gesendet"',
                       rb'(\HasNoChildren \Trash) "/" "Papierkorb"'])

    def append(self, folder, flags, date, data):
        self.appended = getattr(self, 'appended', []) + [(folder, flags, data)]
        return ('OK', [b''])


class TestMcp(unittest.TestCase):
    """MCP-Endpunkt für Claude/Cowork: Schlüssel, JSON-RPC-Gerüst, Werkzeuge."""

    @classmethod
    def setUpClass(cls):
        from http.server import ThreadingHTTPServer
        server.CFG['mcpKey'] = 'mcp-test-schluessel'
        server.CFG['adminKey'] = 'admin-test'
        server.CFG['accounts'] = [{'id': 'x', 'email': 'v3d@volme3d.de', 'name': 'V3D',
                                   'imapHost': 'h', 'password': 'p'}]
        msg = EmailMessage()
        msg['From'] = 'Frank <frank@iserlohn.de>'
        msg['To'] = 'v3d@volme3d.de'
        msg['Subject'] = 'Unser Termin'
        msg['Message-ID'] = '<abc@iserlohn.de>'
        msg['Date'] = 'Thu, 03 Sep 2026 11:24:28 +0200'
        msg.set_content('Hallo Volker,\n\nbis Donnerstag.')
        msg.add_attachment(b'Name;Ort\nA;B\n', maintype='text', subtype='csv', filename='liste.csv')
        msg.add_attachment(b'\x89PNG\r\n\x1a\n' + b'\0' * 20, maintype='image', subtype='png',
                           filename='foto.png')
        cls.conn = McpConn(bytes(msg))
        cls.box = server.Mailbox(server.CFG['accounts'][0])
        cls.box.conn = cls.conn
        cls.box.last_used = time.time()
        cls.orig_get_box = server.get_box
        server.get_box = lambda acc: cls.box
        cls.srv = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.srv.daemon_threads = True
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        server.get_box = cls.orig_get_box
        server.CFG['accounts'] = []
        cls.srv.shutdown()

    def raw(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        h = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'}
        h.update(headers or {})
        c.request(method, path, json.dumps(body) if body is not None else None, h)
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, (json.loads(data) if data else None)

    def rpc(self, method, params=None, rid=1):
        status, data = self.raw('POST', '/api/mcp/mcp-test-schluessel',
                                {'jsonrpc': '2.0', 'id': rid, 'method': method, 'params': params or {}})
        self.assertEqual(status, 200, data)
        return data

    def tool(self, name, **args):
        r = self.rpc('tools/call', {'name': name, 'arguments': args})
        self.assertIn('result', r, r)
        return r['result']

    def test_ohne_schluessel_abgewiesen(self):
        status, _ = self.raw('POST', '/api/mcp', {'jsonrpc': '2.0', 'id': 1, 'method': 'ping'})
        self.assertEqual(status, 401)
        status, _ = self.raw('POST', '/api/mcp/falsch', {'jsonrpc': '2.0', 'id': 1, 'method': 'ping'})
        self.assertEqual(status, 401)

    def test_schluessel_auch_als_bearer(self):
        status, data = self.raw('POST', '/api/mcp', {'jsonrpc': '2.0', 'id': 1, 'method': 'ping'},
                                {'Authorization': 'Bearer mcp-test-schluessel'})
        self.assertEqual(status, 200)
        self.assertEqual(data['result'], {})

    def test_schluessel_gilt_trotz_offenem_zugang(self):
        alt = server.CFG.get('offenerZugang')
        server.CFG['offenerZugang'] = True
        try:
            status, _ = self.raw('POST', '/api/mcp', {'jsonrpc': '2.0', 'id': 1, 'method': 'ping'})
            self.assertEqual(status, 401)
        finally:
            server.CFG['offenerZugang'] = alt

    def test_funnel_praefix(self):
        status, data = self.raw('POST', '/mail/api/mcp/mcp-test-schluessel',
                                {'jsonrpc': '2.0', 'id': 1, 'method': 'ping'})
        self.assertEqual(status, 200)
        self.assertEqual(data['id'], 1)

    def test_get_liefert_405(self):
        status, _ = self.raw('GET', '/api/mcp/mcp-test-schluessel')
        self.assertEqual(status, 405)

    def test_initialize(self):
        r = self.rpc('initialize', {'protocolVersion': '2025-03-26', 'capabilities': {},
                                    'clientInfo': {'name': 'test', 'version': '0'}})
        self.assertEqual(r['result']['protocolVersion'], '2025-03-26')
        self.assertIn('tools', r['result']['capabilities'])
        self.assertEqual(r['result']['serverInfo']['name'], 'V3D Mail')
        r = self.rpc('initialize', {'protocolVersion': '1999-01-01'})
        self.assertEqual(r['result']['protocolVersion'], '2025-06-18')

    def test_benachrichtigung_ohne_antwort(self):
        status, data = self.raw('POST', '/api/mcp/mcp-test-schluessel',
                                {'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        self.assertEqual(status, 202)
        self.assertIsNone(data)

    def test_unbekannte_methode(self):
        r = self.rpc('gibtsnicht')
        self.assertEqual(r['error']['code'], -32601)

    def test_werkzeugliste(self):
        r = self.rpc('tools/list')
        namen = [t['name'] for t in r['result']['tools']]
        for n in ('konten', 'ordner', 'nachrichten', 'nachricht', 'anhang', 'entwurf_ablegen',
                  'verschieben', 'markieren', 'termine', 'termin_anlegen'):
            self.assertIn(n, namen)
        self.assertNotIn('senden', namen)      # Senden bleibt bewusst beim Menschen
        for t in r['result']['tools']:
            self.assertEqual(t['inputSchema']['type'], 'object')

    def test_unbekanntes_werkzeug(self):
        r = self.rpc('tools/call', {'name': 'senden', 'arguments': {}})
        self.assertEqual(r['error']['code'], -32602)

    def test_konten(self):
        res = self.tool('konten')
        self.assertEqual(res['structuredContent']['konten'][0]['email'], 'v3d@volme3d.de')
        self.assertNotIn('password', json.dumps(res))

    def test_ordner(self):
        res = self.tool('ordner')
        arten = {o['pfad']: o['art'] for o in res['structuredContent']['ordner']}
        self.assertEqual(arten['Entwürfe'], 'drafts')

    def test_nachrichten(self):
        res = self.tool('nachrichten', anzahl=5)
        sc = res['structuredContent']
        self.assertEqual(sc['gesamt'], 4)
        self.assertEqual(sc['nachrichten'][0]['subject'], 'Unser Termin')
        self.assertTrue(sc['nachrichten'][0]['hasAttachments'])
        self.assertNotIn('ts', sc['nachrichten'][0])
        self.assertIn('Unser Termin', res['content'][0]['text'])

    def test_nachrichten_nur_ungelesen(self):
        res = self.tool('nachrichten', nur_ungelesen=True)
        self.assertFalse(res.get('isError'))   # Stub antwortet gleich — der Aufruf muss durchlaufen

    def test_nachricht_liest_text_und_anhaenge(self):
        vorher = len(self.conn.stored)
        res = self.tool('nachricht', uid=7)
        sc = res['structuredContent']
        self.assertIn('bis Donnerstag', sc['text'])
        self.assertEqual(sc['from'][0]['email'], 'frank@iserlohn.de')
        namen = [a['filename'] for a in sc['anhaenge']]
        self.assertEqual(namen, ['liste.csv', 'foto.png'])
        self.assertEqual(len(self.conn.stored), vorher, 'darf nicht als gelesen markieren')

    def test_nachricht_als_gelesen(self):
        vorher = len(self.conn.stored)
        self.tool('nachricht', uid=7, als_gelesen=True)
        self.assertEqual(len(self.conn.stored), vorher + 1)
        self.assertIn('\\Seen', self.conn.stored[-1][-1])

    def test_anhang_text_und_bild(self):
        sc = self.tool('nachricht', uid=7)['structuredContent']
        teile = {a['filename']: a['part'] for a in sc['anhaenge']}
        res = self.tool('anhang', uid=7, teil=teile['liste.csv'])
        self.assertEqual(res['content'][1]['type'], 'text')
        self.assertIn('Name;Ort', res['content'][1]['text'])
        res = self.tool('anhang', uid=7, teil=teile['foto.png'])
        self.assertEqual(res['content'][1]['type'], 'image')
        self.assertEqual(res['content'][1]['mimeType'], 'image/png')

    def test_entwurf_ablegen(self):
        res = self.tool('entwurf_ablegen', an='frank@iserlohn.de', betreff='Re: Unser Termin',
                        text='Hallo Frank,\n\npasst.', antwort_auf_uid=7)
        sc = res['structuredContent']
        self.assertTrue(sc['ok'])
        self.assertEqual(sc['ordner'], 'Entwürfe')
        folder, flags, data = self.conn.appended[-1]
        self.assertEqual(folder, '"Entw&APw-rfe"')
        self.assertIn('\\Draft', flags)
        from email import policy as _pol
        from email.parser import BytesParser as _BP
        m = _BP(policy=_pol.default).parsebytes(data)
        self.assertEqual(m['To'], 'frank@iserlohn.de')
        self.assertEqual(m['Subject'], 'Re: Unser Termin')
        self.assertEqual(m['In-Reply-To'], '<abc@iserlohn.de>')
        self.assertEqual(m['X-V3D-Quelle'], 'Claude')
        self.assertIn('passt.', m.get_body(preferencelist=('plain',)).get_content())

    def test_entwurf_ohne_empfaenger(self):
        res = self.tool('entwurf_ablegen', an='', betreff='x', text='y')
        self.assertTrue(res.get('isError'))
        self.assertIn('Empfaenger', res['content'][0]['text'])

    def test_verschieben_nach_art(self):
        res = self.tool('verschieben', uids=[7], ziel='trash')
        self.assertEqual(res['structuredContent']['nach'], 'Papierkorb')
        res = self.tool('verschieben', uids=[7], ziel='Gibtsnicht')
        self.assertTrue(res.get('isError'))

    def test_markieren(self):
        res = self.tool('markieren', uids=[7, 3], markiert=True)
        self.assertEqual(res['structuredContent']['gesetzt'], {'markiert': True})
        self.assertIn('\\Flagged', self.conn.stored[-1][-1])
        res = self.tool('markieren', uids=[7])
        self.assertTrue(res.get('isError'))

    def test_unbekanntes_konto(self):
        res = self.tool('ordner', konto='fremd@example.org')
        self.assertTrue(res.get('isError'))
        self.assertIn('nicht gefunden', res['content'][0]['text'])

    def test_konto_per_adresse(self):
        res = self.tool('ordner', konto='V3D@volme3d.de')
        self.assertFalse(res.get('isError'))

    def test_termin_anlegen_ganztags_aus_datum(self):
        aufrufe = []
        orig = server.dav_save_event
        server.dav_save_event = lambda acc, b: aufrufe.append(b) or {'ok': True, 'uid': 'u', 'href': 'h'}
        try:
            res = self.tool('termin_anlegen', titel='Kurs', start='2026-09-10', ort='Hagen')
        finally:
            server.dav_save_event = orig
        self.assertTrue(res['structuredContent']['ok'])
        self.assertTrue(aufrufe[0]['ev']['allDay'])
        self.assertEqual(aufrufe[0]['ev']['summary'], 'Kurs')
        self.assertEqual(aufrufe[0]['ev']['location'], 'Hagen')

    def test_stapel(self):
        status, data = self.raw('POST', '/api/mcp/mcp-test-schluessel', [
            {'jsonrpc': '2.0', 'id': 1, 'method': 'ping'},
            {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
        ])
        self.assertEqual(status, 200)
        self.assertEqual(len(data), 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
