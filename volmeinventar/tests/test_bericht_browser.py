#!/usr/bin/env python3
# Prueft Suche und Sortierung des HTML-Berichts in einem echten Browser.
#
# Ohne diese Tests faellt nicht auf, wenn die Sortierung zwar Zeilen bewegt,
# aber in die falsche Reihenfolge - genau das war der Fall, als der
# Datumsschluessel "2026-03-17" von parseFloat zur Jahreszahl 2026 verkuerzt
# wurde und alle Datumsangaben eines Jahres als gleichwertig galten.

import datetime
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bericht  # noqa: E402
import inventar  # noqa: E402

try:
    from playwright.sync_api import sync_playwright
    HAT_BROWSER = True
except ImportError:
    HAT_BROWSER = False


def bestand():
    programme = [
        # Absichtlich unsortiert, gemischte Jahre und Luecken.
        dict(name="Zeta", fassung="1", hersteller="Z", quelle="Rechner",
             bitheit="64-Bit", ordner=None, art="Programm",
             installiert_am=datetime.date(2026, 8, 2), groesse_kb=612000),
        dict(name="Alpha", fassung="2", hersteller="A", quelle="Rechner",
             bitheit="64-Bit", ordner=None, art="Programm",
             installiert_am=datetime.date(2026, 3, 17), groesse_kb=900),
        dict(name="Mitte", fassung="3", hersteller="M", quelle="Rechner",
             bitheit="64-Bit", ordner=None, art="Programm",
             installiert_am=datetime.date(2026, 1, 9), groesse_kb=17800),
        dict(name="Alt", fassung="4", hersteller="X", quelle="Rechner",
             bitheit="64-Bit", ordner=None, art="Programm",
             installiert_am=datetime.date(2024, 5, 1), groesse_kb=5600),
        dict(name="Ohne Angaben", fassung="5", hersteller="O",
             quelle="Store (Benutzer)", bitheit="x64", ordner=None,
             art="Store-App", installiert_am=None, groesse_kb=None),
    ]
    b = {"angaben": {"rechner": "PRUEF-PC", "benutzer": "kurs",
                     "system": "Windows 11", "system_name": "Windows 11 Pro",
                     "aufbau": "1", "architektur": "AMD64",
                     "zeitpunkt": datetime.datetime(2026, 8, 19, 14, 30),
                     "fassung": "1.0", "administrator": True},
         "programme": programme, "verknuepfungen": [], "hinweise": []}
    b["kennzahlen"] = inventar.kennzahlen(b)
    return b


@unittest.skipUnless(HAT_BROWSER, "playwright nicht vorhanden")
class BerichtImBrowser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ordner = tempfile.mkdtemp(prefix="inventar-browser-")
        cls.datei = os.path.join(cls.ordner, "bericht.html")
        bericht.schreiben(bestand(), cls.datei)
        cls.spiel = sync_playwright().start()
        cls.browser = cls.spiel.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.spiel.stop()

    def setUp(self):
        self.seite = self.browser.new_page()
        self.jsfehler = []
        self.seite.on("pageerror", lambda e: self.jsfehler.append(str(e)))
        self.seite.on("console", lambda m: self.jsfehler.append(m.text)
                      if m.type == "error" else None)
        self.seite.goto("file://" + self.datei)

    def tearDown(self):
        self.assertEqual(self.jsfehler, [], "JavaScript-Fehler im Bericht")
        self.seite.close()

    def spalte(self, nummer):
        return self.seite.eval_on_selector_all(
            f"#programme tbody tr td:nth-child({nummer})",
            "z => z.map(x => x.textContent.trim())")

    def sichtbare(self):
        return self.seite.eval_on_selector_all(
            "#programme tbody tr",
            'z => z.filter(r => r.style.display !== "none").length')

    def klick(self, nummer):
        self.seite.click(f"#programme thead th:nth-child({nummer})")
        self.seite.wait_for_timeout(80)

    # ------------------------------------------------------------ Sortierung
    def test_datum_sortiert_chronologisch(self):
        self.klick(4)
        gezeigt = [d for d in self.spalte(4) if d]
        self.assertEqual(gezeigt, ["01.05.2024", "09.01.2026", "17.03.2026",
                                   "02.08.2026"])

    def test_datum_umgekehrt(self):
        self.klick(4)
        self.klick(4)
        gezeigt = [d for d in self.spalte(4) if d]
        self.assertEqual(gezeigt, ["02.08.2026", "17.03.2026", "09.01.2026",
                                   "01.05.2024"])

    def test_leere_zellen_bleiben_unten(self):
        """In beide Richtungen - sonst beginnt die Tabelle beim Umdrehen
        mit lauter Leerzeilen."""
        for _ in range(2):
            self.klick(4)
            self.assertEqual(self.spalte(4)[-1], "", "Leerzeile nicht unten")

    def test_groesse_sortiert_nach_menge_nicht_nach_text(self):
        """'900 KB' ist kleiner als '5,5 MB', obwohl 9 groesser als 5 ist."""
        self.klick(5)
        gezeigt = [g for g in self.spalte(5) if g]
        self.assertEqual(gezeigt, ["900 KB", "5,5 MB", "17,4 MB", "597,7 MB"])

    def test_name_alphabetisch(self):
        self.klick(1)
        self.assertEqual(self.spalte(1)[0], "Alpha")
        self.klick(1)
        self.assertEqual(self.spalte(1)[0], "Zeta")

    def test_sortierpfeil_nur_an_einer_spalte(self):
        self.klick(1)
        self.klick(4)
        markiert = self.seite.eval_on_selector_all(
            "#programme thead th.auf, #programme thead th.ab", "z => z.length")
        self.assertEqual(markiert, 1)

    # ----------------------------------------------------------------- Suche
    def test_suche_filtert(self):
        self.seite.fill("input[data-ziel=programme]", "alpha")
        self.seite.wait_for_timeout(80)
        self.assertEqual(self.sichtbare(), 1)
        self.assertIn("1 von 5", self.seite.inner_text("#programme-zahl"))

    def test_suche_ohne_treffer(self):
        self.seite.fill("input[data-ziel=programme]", "gibtesnicht")
        self.seite.wait_for_timeout(80)
        self.assertEqual(self.sichtbare(), 0)

    def test_suche_zuruecksetzen(self):
        self.seite.fill("input[data-ziel=programme]", "alpha")
        self.seite.wait_for_timeout(80)
        self.seite.fill("input[data-ziel=programme]", "")
        self.seite.wait_for_timeout(80)
        self.assertEqual(self.sichtbare(), 5)

    def test_suche_findet_auch_hersteller(self):
        self.seite.fill("input[data-ziel=programme]", "store")
        self.seite.wait_for_timeout(80)
        self.assertEqual(self.sichtbare(), 1)

    def test_suche_und_sortierung_vertragen_sich(self):
        """Nach dem Sortieren muss die Suche weiter greifen - die Zeilen
        sind dann neu einsortiert worden."""
        self.klick(4)
        self.seite.fill("input[data-ziel=programme]", "alt")
        self.seite.wait_for_timeout(80)
        self.assertEqual(self.sichtbare(), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
