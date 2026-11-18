#!/usr/bin/env python3
"""Tests ohne Netz und ohne Claude: Terminlogik, Blockier-Regeln, Prompt, HTTP-Schlüssel.
Aufruf: python3 test_server.py"""
import datetime
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.request
import urllib.error

os.environ['V3DANTWORT_CONF'] = os.path.join(tempfile.mkdtemp(), 'config.json')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server  # noqa: E402

B = server.BERLIN


def t(tag, h, m=0):
    return datetime.datetime(2026, 11, tag, h, m, tzinfo=B)


class Termine(unittest.TestCase):
    JETZT = t(18, 8)   # Mi. 18.11., 8 Uhr → frühestens Do. 4 Uhr (20 h Vorlauf)

    def frei(self, belegt):
        return server.freie_zeiten(self.JETZT, belegt)[0]

    def test_leer_drei_fenster_pro_werktag(self):
        k = self.frei([])
        self.assertEqual(k[:3], [t(19, 9), t(19, 14), t(19, 16)])
        self.assertTrue(all(x.weekday() < 5 for x in k))
        self.assertLessEqual(len(k), server.CONF['max_kandidaten'])

    def test_vorlauf(self):
        self.assertTrue(all(x >= self.JETZT + datetime.timedelta(hours=20) for x in self.frei([])))

    def test_belegt_mit_puffer(self):
        k = self.frei([(t(19, 9), t(19, 12), 'x')])
        self.assertNotIn(t(19, 9), k)
        self.assertNotIn(t(19, 11), k)          # 11–12 kollidiert
        self.assertNotIn(t(19, 12), k)          # 12:00 ist noch im 30-min-Puffer? nein: Ende 12 + 30 → ab 12:30
        tag19 = [x for x in k if x.day == 19]
        self.assertEqual(tag19[0], t(19, 14))

    def test_mindestabstand(self):
        k = self.frei([(t(19, 9), t(19, 15), 'x')])
        tag19 = [x for x in k if x.day == 19]
        self.assertEqual(tag19, [t(19, 15, 30)])   # 16:00 wäre zu nah

    def test_zeit_text(self):
        self.assertEqual(server.zeit_text(t(19, 14)), 'Do. 19.11. um 14:00 Uhr')


class Regeln(unittest.TestCase):
    def test_ganztags(self):
        self.assertFalse(server.ganztags_blockt('vorläufig: xTool O1 Omni – vsl. Versandwoche'))
        self.assertTrue(server.ganztags_blockt('Urlaub Ostsee'))
        self.assertTrue(server.ganztags_blockt('Formnext Messe'))
        self.assertTrue(server.ganztags_blockt('Allerheiligen', 'Feiertag NRW'))

    def test_person(self):
        self.assertTrue(server.betrifft_mich('Volker'))
        self.assertTrue(server.betrifft_mich(''))
        self.assertTrue(server.betrifft_mich('Volker, Sylvia'))
        self.assertFalse(server.betrifft_mich('Sylvia'))


class Prompt(unittest.TestCase):
    def test_inhalt(self):
        p = server.prompt_bauen({'absender': 'Anna', 'text': 'Wann passt es?',
                                 'verlauf': [{'von': 'Anna', 'text': 'Hallo'}]},
                                [t(19, 14)], server.CONF)
        self.assertIn('Do. 19.11. um 14:00 Uhr', p)
        self.assertIn('Wann passt es?', p)
        self.assertIn('- Anna: Hallo', p)

    def test_ohne_termine(self):
        p = server.prompt_bauen({'text': 'Danke!', 'termine': False}, [], server.CONF)
        self.assertIn('KEINE Terminvorschläge', p)

    def test_hinweis_abtrennen(self):
        a, h = server.hinweis_abtrennen('HINWEIS: 15:30 kollidiert mit X\n\nHi Sharron, 3:30 pm works!')
        self.assertEqual(a, 'Hi Sharron, 3:30 pm works!')
        self.assertEqual(h, '15:30 kollidiert mit X')
        self.assertEqual(server.hinweis_abtrennen('Hallo')[1], '')

    def test_anweisung_und_belegt(self):
        p = server.prompt_bauen({'text': 'See you at 3', 'wunsch': 'lieber 15:30'}, [], server.CONF,
                                [(t(19, 15), t(19, 18), 'Anycubic Salon')])
        self.assertIn('ANWEISUNG', p)
        self.assertIn('lieber 15:30', p)
        self.assertIn('Do. 19.11. 15:00–18:00 Anycubic Salon', p)

    def test_kurse_im_prompt(self):
        k = [{'titel': 'Schnupperkurs', 'preis_cent': 8900, 'frei': 6, 'voll': False, 'untertitel': '',
              'termine': [{'datum': '2026-11-24', 'beginn': '18:00', 'ende': '21:00'}],
              'url': 'https://kurse.example/k/schnupper'}]
        p = server.prompt_bauen({'text': 'Wie geht es mit der Bezahlung?', '_kurse': k}, [], server.CONF)
        self.assertIn('Schnupperkurs | Di. 24.11. 18:00–21:00 | 89 € | 6 Plätze frei', p)
        self.assertIn('https://kurse.example/k/schnupper', p)
        self.assertNotIn('Aktuelle Kurse', server.prompt_bauen({'text': 'Hi'}, [], server.CONF))

    def test_aufraeumen(self):
        self.assertEqual(server.aufraeumen('"Hallo **du**"'), 'Hallo du')


class Http(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.basis = 'http://127.0.0.1:%d' % cls.srv.server_port
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.alt = (server.claude_fragen, server.freie_zeiten, server.belegt_holen)
        server.claude_fragen = lambda prompt, conf: 'Hallo Anna!'
        server.freie_zeiten = lambda *a, **k: ([t(19, 14)], [])
        server.belegt_holen = lambda *a, **k: ([], [])
        server.kurse_holen = lambda *a, **k: []

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        server.claude_fragen, server.freie_zeiten, server.belegt_holen = cls.alt

    def post(self, pfad, daten, key):
        req = urllib.request.Request(self.basis + pfad, json.dumps(daten).encode(),
                                     {'Content-Type': 'application/json', 'X-Key': key})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            return e.code, json.load(e)

    def test_ohne_schluessel(self):
        self.assertEqual(self.post('/api/vorschlag', {'text': 'x'}, 'falsch')[0], 403)

    def test_vorschlag_mit_praefix(self):
        code, j = self.post('/antwort/api/vorschlag', {'text': 'Hi'}, server.CONF['key'])
        self.assertEqual(code, 200)
        self.assertEqual(j['antwort'], 'Hallo Anna!')
        self.assertEqual(j['frei'], ['Do. 19.11. um 14:00 Uhr'])

    def test_leerer_text(self):
        self.assertEqual(self.post('/api/vorschlag', {'text': ' '}, server.CONF['key'])[0], 400)

    def test_einrichten_link(self):
        with urllib.request.urlopen(self.basis + '/antwort/einrichten?key=' + server.CONF['key']) as r:
            self.assertIn('v3dantwort://einrichten', r.read().decode())


if __name__ == '__main__':
    unittest.main(verbosity=1)
