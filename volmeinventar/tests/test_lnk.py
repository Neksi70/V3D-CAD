#!/usr/bin/env python3
# Tests fuer den Verknuepfungsleser.
#
# Die Beispieldateien unter proben/ sind ECHTE .lnk-Dateien: erzeugt ueber
# IShellLink (WScript.Shell unter Wine), nicht von Hand zusammengebaut.  Nur
# so faellt auf, wenn unsere Vorstellung vom Format von der Wirklichkeit
# abweicht.  Was IShellLink dort nicht kann (Tastenkuerzel), wird zusaetzlich
# aus einzeln gesetzten Kopf-Feldern geprueft.

import os
import struct
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import lnk  # noqa: E402

PROBEN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "proben")


def probe(name):
    return lnk.lesen(os.path.join(PROBEN, name))


class EchteDateien(unittest.TestCase):
    def test_programm_mit_allen_feldern(self):
        e = probe("Editor.lnk")
        self.assertIsNone(e["fehler"])
        self.assertEqual(e["ziel"], r"C:\windows\system32\notepad.exe")
        self.assertEqual(e["argumente"], '/A "C:\\Temp\\Meine Datei.txt"')
        self.assertEqual(e["arbeitsordner"], r"C:\Temp")
        self.assertEqual(e["beschreibung"],
                         "Editor mit Umlauten: Ae Oe Ue und Zeichen")
        self.assertEqual(e["symbol"], r"C:\windows\system32\shell32.dll")
        self.assertEqual(e["symbolnummer"], 12)
        self.assertEqual(e["fenster"], "maximiert")

    def test_keine_null_am_ende(self):
        """Wine haengt an jede Zeichenkette eine Null und zaehlt sie mit -
        bliebe sie stehen, waere jeder Vergleich zweier Ziele falsch."""
        e = probe("Editor.lnk")
        for feld in ("ziel", "argumente", "arbeitsordner", "beschreibung",
                     "symbol"):
            self.assertFalse(e[feld].endswith("\x00"), feld)
            self.assertEqual(e[feld], e[feld].strip(), feld)

    def test_ordner_ziel(self):
        e = probe("Ordner Programme.lnk")
        self.assertEqual(e["ziel"], r"C:\Program Files")

    def test_leeres_attributfeld_heisst_unbekannt(self):
        """Wine schreibt gar keine Dateiattribute.  Daraus darf nicht
        'ist eine Datei' werden - sonst steht im Bericht bei jedem
        Ordner-Verweis die falsche Art."""
        self.assertIsNone(probe("Ordner Programme.lnk")["ordner"])
        self.assertIsNone(probe("Editor.lnk")["ordner"])

    def test_gesetztes_attributfeld_wird_ausgewertet(self):
        self.assertIs(lnk._deuten(kopf(attribute=0x10), "x.lnk")["ordner"], True)
        self.assertIs(lnk._deuten(kopf(attribute=0x20), "x.lnk")["ordner"], False)

    def test_netzpfad(self):
        e = probe("Netzlaufwerk.lnk")
        self.assertEqual(e["ziel"], r"\\server\freigabe\werkzeug.exe")

    def test_leerzeichen_im_ziel(self):
        e = probe("Umlaut Zieldatei.lnk")
        self.assertEqual(
            e["ziel"], r"C:\Temp\Grosse Datei mit Leerzeichen und Umlaut.txt")

    def test_ohne_argumente_bleibt_leer(self):
        e = probe("Kuerzel.lnk")
        self.assertIsNone(e["argumente"])
        self.assertEqual(e["ziel"], r"C:\windows\regedit.exe")

    def test_alle_proben_ohne_fehler(self):
        dateien = [d for d in os.listdir(PROBEN) if d.endswith(".lnk")]
        self.assertGreaterEqual(len(dateien), 5)
        for d in dateien:
            with self.subTest(datei=d):
                self.assertIsNone(probe(d)["fehler"])
                self.assertTrue(probe(d)["ziel"], "kein Ziel erkannt")


def kopf(flags=0, fenster=1, kuerzel=0, attribute=0, zeiten=(0, 0, 0)):
    """Nackter 76-Byte-Kopf ohne alle Folgeteile - gueltiges Minimal-.lnk."""
    roh = bytearray(76)
    struct.pack_into("<I", roh, 0, 0x4C)
    roh[4:20] = bytes.fromhex("01140200000000C000000000000046")[:15] + b"\x00"
    struct.pack_into("<II", roh, 20, flags, attribute)
    struct.pack_into("<QQQ", roh, 28, *zeiten)
    struct.pack_into("<iii", roh, 52, 0, 0, fenster)
    struct.pack_into("<H", roh, 64, kuerzel)
    return bytes(roh)


class Kopffelder(unittest.TestCase):
    """Wine setzt kein Tastenkuerzel (E_FAIL) - deshalb hier von Hand."""

    def deuten(self, rohdaten):
        return lnk._deuten(rohdaten, "probe.lnk")

    def test_tastenkuerzel_strg_alt_buchstabe(self):
        # Untere Haelfte = Taste 'R', obere = Strg(2)|Alt(4)
        e = self.deuten(kopf(kuerzel=(0x06 << 8) | 0x52))
        self.assertEqual(e["tastenkuerzel"], "Strg+Alt+R")

    def test_tastenkuerzel_funktionstaste(self):
        e = self.deuten(kopf(kuerzel=(0x01 << 8) | 0x73))  # Umschalt + F4
        self.assertEqual(e["tastenkuerzel"], "Umschalt+F4")

    def test_ohne_kuerzel(self):
        self.assertIsNone(self.deuten(kopf())["tastenkuerzel"])

    def test_fensterstil(self):
        self.assertEqual(self.deuten(kopf(fenster=7))["fenster"], "7")
        self.assertEqual(self.deuten(kopf(fenster=2))["fenster"], "minimiert")

    def test_zeitstempel(self):
        # 1. Januar 2020, 00:00 UTC in FILETIME
        wert = 132223104000000000
        e = self.deuten(kopf(zeiten=(wert, 0, 0)))
        self.assertEqual(e["ziel_erstellt"].year, 2020)
        self.assertIsNone(e["ziel_zugriff"], "Null muss 'nicht gesetzt' heissen")

    def test_unsinnige_zeit_kippt_nicht_um(self):
        e = self.deuten(kopf(zeiten=(0xFFFFFFFFFFFFFFFF, 0, 0)))
        self.assertIsNone(e["ziel_erstellt"])


class Fehlerfaelle(unittest.TestCase):
    def test_zu_kurz(self):
        e = lnk._deuten.__wrapped__ if False else None
        ergebnis = lnk.lesen(os.path.join(PROBEN, "..", "test_lnk.py"))
        self.assertIsNotNone(ergebnis["fehler"])

    def test_falsche_kopfgroesse(self):
        roh = bytearray(kopf())
        struct.pack_into("<I", roh, 0, 0x99)
        with self.assertRaises(lnk.LnkFehler):
            lnk._deuten(bytes(roh), "x.lnk")

    def test_abgeschnittene_zeichenkette_wirft_sauber(self):
        """Haengt hinter dem Kopf nur ein halber String, darf das Werkzeug
        nicht abstuerzen - sonst reisst eine kaputte Datei den ganzen Scan ab."""
        roh = kopf(flags=lnk.HAT_NAME) + struct.pack("<H", 50) + b"ab"
        with self.assertRaises(lnk.LnkFehler):
            lnk._deuten(roh, "x.lnk")

    def test_nicht_vorhandene_datei(self):
        e = lnk.lesen("/gibt/es/nicht.lnk")
        self.assertIn("nicht lesbar", e["fehler"])

    def test_leere_datei(self):
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".lnk") as f:
            e = lnk.lesen(f.name)
        self.assertIsNotNone(e["fehler"])


class Rueckfallebenen(unittest.TestCase):
    def test_shell_ort_landet_nicht_im_zielfeld(self):
        """Eine Verknuepfung zur Systemsteuerung hat keinen Dateipfad.  Der
        Klartext gehoert nach 'idliste', nicht nach 'ziel' - sonst haelt der
        Bericht 'Systemsteuerung' fuer eine Programmdatei."""
        self.assertIsNone(lnk._als_pfad("Systemsteuerung"))
        self.assertEqual(lnk._als_pfad(r"C:\x\y.exe"), r"C:\x\y.exe")
        self.assertEqual(lnk._als_pfad(r"\\srv\a"), r"\\srv\a")
        self.assertEqual(lnk._als_pfad(r"%ProgramFiles%\a.exe"),
                         r"%ProgramFiles%\a.exe")
        self.assertIsNone(lnk._als_pfad(None))


if __name__ == "__main__":
    unittest.main(verbosity=2)
