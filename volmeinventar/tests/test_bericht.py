#!/usr/bin/env python3
# Tests fuer die Berichtserzeugung.

import datetime
import html.parser
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bericht  # noqa: E402
import inventar  # noqa: E402


def beispiel(programme=None, verweise=None, hinweise=None):
    bestand = {
        "angaben": {
            "rechner": "KURS-PC-03", "benutzer": "kurs",
            "system": "Windows 11", "system_name": "Windows 11 Pro 24H2",
            "aufbau": "10.0.26100", "architektur": "AMD64",
            "zeitpunkt": datetime.datetime(2026, 8, 19, 14, 30),
            "fassung": "1.0", "administrator": False,
        },
        "programme": programme if programme is not None else [{
            "name": "V3D CAD", "fassung": "2.1", "hersteller": "Volme3D",
            "installiert_am": datetime.date(2026, 3, 17), "groesse_kb": 51200,
            "quelle": "Rechner", "bitheit": "64-Bit",
            "ordner": r"C:\Program Files\V3D CAD", "art": "Programm",
        }],
        "verknuepfungen": verweise if verweise is not None else [{
            "anzeigename": "V3D CAD", "bereich": "Startmenue (alle Benutzer)",
            "gruppe": "Volme3D", "ziel": r"C:\Program Files\V3D CAD\cad.exe",
            "argumente": None, "angelegt": datetime.datetime(2026, 3, 17, 9, 0),
            "ziel_fehlt": False, "fehler": None, "art": "Programm",
        }],
        "hinweise": hinweise or [],
    }
    bestand["kennzahlen"] = inventar.kennzahlen(bestand)
    return bestand


class HtmlPruefer(html.parser.HTMLParser):
    """Prueft, dass die Tags sauber verschachtelt schliessen."""

    LEER = {"meta", "br", "hr", "img", "input", "link"}

    def __init__(self):
        super().__init__()
        self.stapel = []
        self.fehler = []
        self.texte = []

    def handle_starttag(self, tag, attrs):
        if tag not in self.LEER:
            self.stapel.append(tag)

    def handle_endtag(self, tag):
        if tag in self.LEER:
            return
        if not self.stapel:
            self.fehler.append(f"</{tag}> ohne Anfang")
        elif self.stapel[-1] != tag:
            self.fehler.append(f"</{tag}> schliesst <{self.stapel[-1]}>")
            if tag in self.stapel:
                while self.stapel and self.stapel.pop() != tag:
                    pass
        else:
            self.stapel.pop()

    def handle_data(self, data):
        self.texte.append(data)


def pruefen(quelltext):
    p = HtmlPruefer()
    p.feed(quelltext)
    return p


class HtmlBericht(unittest.TestCase):
    def test_wohlgeformt(self):
        p = pruefen(bericht.als_html(beispiel()))
        self.assertEqual(p.fehler, [])
        self.assertEqual(p.stapel, [], "nicht geschlossene Tags")

    def test_inhalte_stehen_drin(self):
        text = bericht.als_html(beispiel())
        for erwartet in ("KURS-PC-03", "V3D CAD", "Volme3D",
                         "Windows 11 Pro 24H2", "19.08.2026", "17.03.2026",
                         "50,0 MB", "kurs"):
            self.assertIn(erwartet, text, erwartet)

    def test_sonderzeichen_zerlegen_den_bericht_nicht(self):
        """Ein Programmname darf HTML nicht ausbrechen lassen - Hersteller
        schreiben durchaus '<' oder '&' in ihre Eintraege, und ein Bericht,
        der daran zerbricht, zeigt ab dort nichts mehr an."""
        boese = beispiel(programme=[{
            "name": '<script>alert("weg")</script>',
            "fassung": "1 & 2", "hersteller": 'Firma "Anfuehrung" <GmbH>',
            "ordner": r"C:\a&b\<c>", "quelle": "Rechner",
            "bitheit": "64-Bit", "installiert_am": None, "groesse_kb": None,
            "art": "Programm",
        }])
        text = bericht.als_html(boese)
        self.assertNotIn("<script>alert", text)
        self.assertIn("&lt;script&gt;", text)
        p = pruefen(text)
        self.assertEqual(p.fehler, [])
        # Der Name muss trotzdem LESBAR im Bericht stehen.
        self.assertIn('<script>alert("weg")</script>', "".join(p.texte))

    def test_leerer_bestand(self):
        text = bericht.als_html(beispiel(programme=[], verweise=[]))
        self.assertIn("Nichts aufgenommen", text)
        self.assertEqual(pruefen(text).fehler, [])

    def test_ausgeblendete_werden_beziffert(self):
        """Eine um Windows gekuerzte Liste muss sagen, dass sie gekuerzt ist -
        sonst haelt der Leser sie fuer den vollstaendigen Bestand."""
        b = beispiel()
        b["ausgeblendet"] = {"programme": 37, "verknuepfungen": 12}
        b["kennzahlen"] = inventar.kennzahlen(b)
        text = bericht.als_html(b)
        self.assertIn("37 Programme", text)
        self.assertIn("12 Verknuepfungen", text)
        self.assertIn("Nicht mitgezaehlt", text)
        self.assertEqual(pruefen(text).fehler, [])

    def test_ohne_ausgeblendete_keine_fussnote(self):
        self.assertNotIn("Nicht mitgezaehlt", bericht.als_html(beispiel()))

    def test_hinweise_erscheinen(self):
        text = bericht.als_html(beispiel(hinweise=["Ohne Adminrechte gelesen"]))
        self.assertIn("Ohne Adminrechte gelesen", text)

    def test_fehlendes_ziel_wird_hervorgehoben(self):
        b = beispiel(verweise=[{
            "anzeigename": "Altes Programm", "bereich": "Desktop (Benutzer)",
            "gruppe": "", "ziel": r"C:\weg\alt.exe", "ziel_fehlt": True,
            "fehler": None, "angelegt": None, "art": "Programm",
        }])
        text = bericht.als_html(b)
        self.assertIn("Ziel fehlt", text)
        self.assertIn("marke warn", text)

    def test_unlesbare_verknuepfung_wird_gezeigt(self):
        b = beispiel(verweise=[{
            "anzeigename": "Kaputt", "bereich": "Desktop (Benutzer)",
            "gruppe": "", "ziel": None, "fehler": "zu kurz",
            "ziel_fehlt": None, "angelegt": None, "art": "Programm",
        }])
        self.assertIn("unlesbar", bericht.als_html(b))

    def test_zahlen_stimmen(self):
        b = beispiel(verweise=[
            {"anzeigename": "A", "bereich": "Autostart (Benutzer)",
             "ziel": "x", "ziel_fehlt": True, "fehler": None, "gruppe": "",
             "angelegt": None, "art": "Programm"},
            {"anzeigename": "B", "bereich": "Desktop (Benutzer)",
             "ziel": "y", "ziel_fehlt": False, "fehler": None, "gruppe": "",
             "angelegt": None, "art": "Programm"},
        ])
        self.assertEqual(b["kennzahlen"]["autostart"], 1)
        self.assertEqual(b["kennzahlen"]["ziel_fehlt"], 1)
        self.assertEqual(b["kennzahlen"]["verknuepfungen"], 2)

    def test_datum_deutsche_schreibweise(self):
        self.assertEqual(bericht._text(datetime.date(2026, 3, 7)), "07.03.2026")

    def test_groessen(self):
        self.assertEqual(bericht._groesse(512), "512 KB")
        self.assertEqual(bericht._groesse(2048), "2,0 MB")
        self.assertEqual(bericht._groesse(5 * 1024 * 1024), "5,00 GB")
        self.assertEqual(bericht._groesse(None), "")
        self.assertEqual(bericht._groesse(0), "")


class Dateien(unittest.TestCase):
    def setUp(self):
        self.ordner = tempfile.mkdtemp(prefix="inventar-bericht-")

    def test_html_datei(self):
        ziel = os.path.join(self.ordner, "b.html")
        self.assertEqual(bericht.schreiben(beispiel(), ziel), [ziel])
        with open(ziel, encoding="utf-8") as f:
            self.assertIn("V3D CAD", f.read())

    def test_csv_wird_geteilt(self):
        """Programme und Verknuepfungen haben andere Spalten - in einer
        gemeinsamen Tabelle waere die Haelfte der Zellen leer."""
        ziel = os.path.join(self.ordner, "b.csv")
        dateien = bericht.schreiben(beispiel(), ziel, "csv")
        self.assertEqual(len(dateien), 2)
        self.assertTrue(any("programme" in d for d in dateien))
        self.assertTrue(any("verknuepfungen" in d for d in dateien))

    def test_csv_mit_excel_lesbar(self):
        ziel = os.path.join(self.ordner, "b.csv")
        datei = [d for d in bericht.schreiben(beispiel(), ziel, "csv")
                 if "programme" in d][0]
        with open(datei, "rb") as f:
            roh = f.read()
        self.assertTrue(roh.startswith(b"\xef\xbb\xbf"), "BOM fuer Excel fehlt")
        self.assertIn(b";", roh, "Semikolon als Trenner")

    def test_json_ist_ladbar(self):
        import json
        ziel = os.path.join(self.ordner, "b.json")
        bericht.schreiben(beispiel(), ziel, "json")
        with open(ziel, encoding="utf-8") as f:
            wieder = json.load(f)
        self.assertEqual(wieder["programme"][0]["name"], "V3D CAD")
        self.assertEqual(wieder["angaben"]["rechner"], "KURS-PC-03")

    def test_dateiname_enthaelt_rechner_und_zeit(self):
        name = bericht.name_vorschlagen(beispiel(), "html")
        self.assertIn("KURS-PC-03", name)
        self.assertIn("2026-08-19", name)
        self.assertTrue(name.endswith(".html"))

    def test_dateiname_ohne_verbotene_zeichen(self):
        b = beispiel()
        b["angaben"]["rechner"] = 'PC/mit\\bösen:Zeichen'
        name = bericht.name_vorschlagen(b, "html")
        for zeichen in '/\\:<>"|?*':
            self.assertNotIn(zeichen, name)


if __name__ == "__main__":
    unittest.main(verbosity=2)
