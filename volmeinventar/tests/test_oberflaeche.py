#!/usr/bin/env python3
# Tests fuer das Fenster.  Laufen unter Xvfb (siehe pruefen.sh) - ohne
# Bildschirm wird uebersprungen.
#
# Geprueft wird das, was beim blossen Lesen des Quelltextes nicht auffaellt:
# ob die Tabelle nach dem Sortieren noch dieselben Zeilen enthaelt, ob die
# Suche wirklich filtert, und ob die Aufnahme aus dem Arbeitsfaden heraus
# ueberhaupt in der Anzeige ankommt.

import datetime
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import tkinter as tk
    PROBE = tk.Tk()
    PROBE.destroy()
    HAT_BILDSCHIRM = True
except Exception:                                      # noqa: BLE001
    HAT_BILDSCHIRM = False

if HAT_BILDSCHIRM:
    import oberflaeche


def zeilen():
    return [
        dict(name="Zeta", fassung="1", hersteller="Z", quelle="Rechner",
             bitheit="64-Bit", ordner=r"C:\z", art="Programm",
             installiert_am=datetime.date(2026, 8, 2), groesse_kb=612000,
             groesse="597,7 MB"),
        dict(name="Alpha", fassung="2", hersteller="A", quelle="Rechner",
             bitheit="64-Bit", ordner=r"C:\a", art="Programm",
             installiert_am=datetime.date(2024, 5, 1), groesse_kb=900,
             groesse="900 KB"),
        dict(name="Ohne", fassung="3", hersteller="O", quelle="Store (Benutzer)",
             bitheit="x64", ordner=None, art="Store-App",
             installiert_am=None, groesse_kb=None, groesse=""),
    ]


@unittest.skipUnless(HAT_BILDSCHIRM, "kein Bildschirm (Xvfb fehlt)")
class Tabelle(unittest.TestCase):
    def setUp(self):
        self.wurzel = tk.Tk()
        self.wurzel.withdraw()
        self.liste = oberflaeche.Liste(self.wurzel,
                                       oberflaeche.PROGRAMM_SPALTEN)
        self.liste.fuellen(zeilen())

    def tearDown(self):
        self.wurzel.destroy()

    def sichtbar(self, spalte=0):
        return [self.liste.baum.item(k, "values")[spalte]
                for k in self.liste.baum.get_children()]

    def test_zeilen_erscheinen(self):
        self.assertEqual(sorted(self.sichtbar()), ["Alpha", "Ohne", "Zeta"])

    def test_zaehler(self):
        self.assertIn("3", self.liste.zaehler.cget("text"))

    def test_suche_filtert(self):
        self.liste.suchtext.set("alpha")
        self.assertEqual(self.sichtbar(), ["Alpha"])
        self.assertIn("1 von 3", self.liste.zaehler.cget("text"))

    def test_suche_sucht_in_allen_spalten(self):
        self.liste.suchtext.set("store")
        self.assertEqual(self.sichtbar(), ["Ohne"])

    def test_suche_zuruecksetzen(self):
        self.liste.suchtext.set("alpha")
        self.liste.suchtext.set("")
        self.assertEqual(len(self.sichtbar()), 3)

    def test_sortieren_nach_name(self):
        self.liste.sortieren("name")
        self.assertEqual(self.sichtbar(), ["Alpha", "Ohne", "Zeta"])
        self.liste.sortieren("name")
        self.assertEqual(self.sichtbar(), ["Zeta", "Ohne", "Alpha"])

    def test_sortieren_verliert_keine_zeile(self):
        """Ein Sortierlauf, der Zeilen verschluckt, faellt beim Draufschauen
        kaum auf - hier schon."""
        for feld in ("name", "installiert_am", "groesse", "ordner", "quelle"):
            for _ in range(2):
                self.liste.sortieren(feld)
                self.assertEqual(len(self.sichtbar()), 3, feld)

    def test_sortieren_nach_groesse_ist_numerisch(self):
        self.liste.sortieren("groesse")
        self.assertEqual(self.sichtbar(4)[:2], ["900 KB", "597,7 MB"])

    def test_leerwerte_bleiben_unten(self):
        """Auch beim Umdrehen der Richtung - sonst steht die Tabelle beim
        zweiten Klick voller Leerzeilen."""
        for _ in range(2):
            self.liste.sortieren("installiert_am")
            self.assertEqual(self.sichtbar()[-1], "Ohne")

    def test_sortieren_wirkt_auch_gefiltert(self):
        self.liste.suchtext.set("a")
        self.liste.sortieren("name")
        self.assertEqual(self.sichtbar(), ["Alpha", "Zeta"])

    def test_warnung_wird_markiert(self):
        self.liste.fuellen([
            dict(name="Kaputt", fehler="zu kurz", art="Programm"),
            dict(name="Heil", art="Programm"),
        ])
        marken = [self.liste.baum.item(k, "tags")
                  for k in self.liste.baum.get_children()]
        self.assertIn("warnung", marken[0])
        self.assertEqual(marken[1], "")


@unittest.skipUnless(HAT_BILDSCHIRM, "kein Bildschirm (Xvfb fehlt)")
class GanzesFenster(unittest.TestCase):
    def setUp(self):
        self.fenster = oberflaeche.Fenster()
        self.fenster.withdraw()

    def tearDown(self):
        self.fenster.destroy()

    def test_startet_mit_leeren_listen(self):
        self.assertEqual(self.fenster.programme.zeilen, [])
        for k in self.fenster.speicherknoepfe:
            self.assertEqual(str(k.cget("state")), "disabled",
                             "Speichern darf vor der Aufnahme nicht gehen")

    def test_ergebnis_landet_in_der_anzeige(self):
        """Der Arbeitsfaden schiebt das Ergebnis nur in eine Schlange; erst
        das Fenster zeigt es an.  Genau diese Uebergabe wird hier geprueft."""
        bestand = {
            "angaben": {"rechner": "PC", "benutzer": "u", "system": "Win",
                        "system_name": "Windows 11", "aufbau": "1",
                        "architektur": "AMD64", "fassung": "1.0",
                        "zeitpunkt": datetime.datetime(2026, 8, 19, 12, 0),
                        "administrator": True},
            "programme": zeilen(),
            "verknuepfungen": [dict(anzeigename="A", bereich="Desktop (Benutzer)",
                                    gruppe="", ziel=r"C:\x.exe", ziel_fehlt=True,
                                    fehler=None, art="Programm")],
            "hinweise": [],
        }
        import inventar
        bestand["kennzahlen"] = inventar.kennzahlen(bestand)
        self.fenster.meldungen.put(("fertig", bestand))
        self.fenster._meldungen_holen()
        self.assertEqual(len(self.fenster.programme.baum.get_children()), 3)
        self.assertEqual(len(self.fenster.verweise.baum.get_children()), 1)
        self.assertIn("3 Programme", self.fenster.zustand.get())
        self.assertIn("1 mit fehlendem Ziel", self.fenster.zustand.get())
        for k in self.fenster.speicherknoepfe:
            self.assertEqual(str(k.cget("state")), "normal")
        self.assertIn("(3)", self.fenster.reiter.tab(0, "text"))

    def test_fortschritt_erscheint_in_der_leiste(self):
        self.fenster.meldungen.put(("hinweis", "Suche Verknuepfungen ..."))
        self.fenster._meldungen_holen()
        self.assertEqual(self.fenster.zustand.get(), "Suche Verknuepfungen ...")

    def test_zustandsspalte_bei_verknuepfungen(self):
        import bericht
        zeile = bericht._verweis_zeile(
            {"anzeigename": "X", "ziel": r"C:\weg.exe", "ziel_fehlt": True,
             "fehler": None})
        self.assertEqual(zeile["zustand"], "Ziel fehlt")


if __name__ == "__main__":
    unittest.main(verbosity=2)
