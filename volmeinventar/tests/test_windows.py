#!/usr/bin/env python3
# Tests fuer die Abgrenzung "gehoert zu Windows" gegen "wurde installiert".
#
# Der teuerste Fehler waere hier ein FALSCH POSITIVER: was faelschlich als
# Windows-Bestandteil gilt, verschwindet aus der Liste, ohne dass es jemand
# merkt.  Entsprechend viele Tests sichern die Gegenrichtung ab.

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import inventar  # noqa: E402
import programme  # noqa: E402
import verknuepfungen  # noqa: E402
import windowsteile as w  # noqa: E402

UMG = {"SystemRoot": r"C:\Windows", "ProgramFiles": r"C:\Program Files"}


def prog(**k):
    grund = {"name": "Irgendwas", "ordner": None, "store_kennung": None,
             "art": "Programm"}
    grund.update(k)
    return grund


class WindowsProgramme(unittest.TestCase):
    def test_im_windows_ordner(self):
        self.assertTrue(w.ist_windows_programm(
            prog(name="Editor", ordner=r"C:\Windows\System32"), UMG))

    def test_windows_ordner_mit_variable(self):
        self.assertTrue(w.ist_windows_programm(
            prog(ordner=r"%SystemRoot%\System32\etwas"), UMG))

    def test_gross_kleinschreibung_egal(self):
        """Windows unterscheidet sie nicht - die Tests laufen aber auf Linux,
        wo os.path das sehr wohl tut."""
        self.assertTrue(w.ist_windows_programm(
            prog(ordner=r"c:\WINDOWS\system32"), UMG))

    def test_schraegstrich_statt_backslash(self):
        self.assertTrue(w.ist_windows_programm(
            prog(ordner="C:/Windows/System32"), UMG))

    def test_store_app_von_microsoft(self):
        self.assertTrue(w.ist_windows_programm(
            prog(name="Rechner", store_kennung="8wekyb3d8bbwe"), UMG))

    def test_windows_systemkomponente(self):
        self.assertTrue(w.ist_windows_programm(
            prog(name="Suche", store_kennung="cw5n1h2txyewy"), UMG))

    def test_mitgeliefertes_edge(self):
        for name in ("Microsoft Edge", "Microsoft Edge Update",
                     "Microsoft Edge WebView2 Runtime"):
            self.assertTrue(w.ist_windows_programm(
                prog(name=name, ordner=r"C:\Program Files (x86)\Microsoft\Edge"),
                UMG), name)

    def test_onedrive(self):
        self.assertTrue(w.ist_windows_programm(prog(name="Microsoft OneDrive"),
                                               UMG))


class KeinWindowsProgramm(unittest.TestCase):
    """Die wichtigere Haelfte: was faelschlich hier landet, verschwindet."""

    def test_normales_programm(self):
        self.assertFalse(w.ist_windows_programm(
            prog(name="V3D CAD", ordner=r"C:\Program Files\V3D CAD"), UMG))

    def test_office_ist_kein_windows_bestandteil(self):
        """'Von Microsoft' taugt NICHT als Merkmal - sonst fielen Office,
        Teams, Visual Studio und der SQL Server aus der Liste."""
        for name, ordner in (
                ("Microsoft Office Professional Plus 2021",
                 r"C:\Program Files\Microsoft Office"),
                ("Microsoft Teams", r"C:\Program Files\Teams"),
                ("Microsoft Visual Studio Code", r"C:\Program Files\VS Code"),
                ("Microsoft SQL Server 2022", r"C:\Program Files\SQL Server")):
            self.assertFalse(w.ist_windows_programm(
                prog(name=name, hersteller="Microsoft Corporation",
                     ordner=ordner), UMG), name)

    def test_msi_deinstallation_zaehlt_nicht(self):
        """MsiExec.exe liegt in C:\\Windows\\System32.  Wuerde der
        Deinstallations-Befehl mitgeprueft, waere schlagartig JEDES
        MSI-Programm ein Windows-Bestandteil."""
        self.assertFalse(w.ist_windows_programm(
            prog(name="Fremdprogramm", ordner=r"C:\Program Files\Fremd",
                 deinstallation=r"C:\Windows\System32\MsiExec.exe /X{ABC}"),
            UMG))

    def test_aehnlich_benannter_ordner(self):
        """'C:\\Windows Alt' faengt zwar mit 'C:\\Windows' an, liegt aber
        nicht darin."""
        self.assertFalse(w.ist_windows_programm(
            prog(ordner=r"C:\Windows Alt\Programm"), UMG))
        self.assertFalse(w.ist_windows_programm(
            prog(ordner=r"C:\WindowsApps\Fremd"), UMG))

    def test_fremde_store_app(self):
        self.assertFalse(w.ist_windows_programm(
            prog(name="Spotify", store_kennung="zpdnekdrzrea0"), UMG))

    def test_name_nur_aehnlich(self):
        self.assertFalse(w.ist_windows_programm(
            prog(name="Edge Diagrammer", ordner=r"C:\Program Files\Edge"), UMG))

    def test_ohne_angaben(self):
        self.assertFalse(w.ist_windows_programm(prog(), UMG))
        self.assertFalse(w.ist_windows_programm({}, UMG))


class WindowsVerknuepfungen(unittest.TestCase):
    def test_ziel_im_windows_ordner(self):
        self.assertTrue(w.ist_windows_verknuepfung(
            {"ziel": r"C:\Windows\system32\notepad.exe", "art": "Programm"},
            UMG))

    def test_ziel_mit_variable(self):
        self.assertTrue(w.ist_windows_verknuepfung(
            {"ziel": r"%SystemRoot%\system32\mspaint.exe", "art": "Programm"},
            UMG))

    def test_store_app_ueber_app_kennung(self):
        """Store-Verknuepfungen haben keinen brauchbaren Zielpfad - erkennbar
        sind sie nur an der AppUserModelID."""
        self.assertTrue(w.ist_windows_verknuepfung(
            {"ziel": None, "art": "Programm",
             "app_kennung": "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"},
            UMG))

    def test_fremdes_programm_bleibt(self):
        self.assertFalse(w.ist_windows_verknuepfung(
            {"ziel": r"C:\Program Files\V3D CAD\cad.exe", "art": "Programm"},
            UMG))

    def test_fremde_store_app_bleibt(self):
        self.assertFalse(w.ist_windows_verknuepfung(
            {"ziel": None, "art": "Programm",
             "app_kennung": "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"},
            UMG))

    def test_internetverweis_ist_nie_windows(self):
        self.assertFalse(w.ist_windows_verknuepfung(
            {"ziel": "https://volme3d.de/", "art": "Internet"}, UMG))

    def test_netzpfad_bleibt(self):
        self.assertFalse(w.ist_windows_verknuepfung(
            {"ziel": r"\\server\freigabe\werkzeug.exe", "art": "Programm"},
            UMG))

    def test_kaputte_verknuepfung_bleibt_sichtbar(self):
        """Ohne Ziel ist nichts belegbar - und was nicht belegt ist, darf
        nicht verschwinden."""
        self.assertFalse(w.ist_windows_verknuepfung(
            {"ziel": None, "art": "Programm", "fehler": "zu kurz"}, UMG))


class Kennzeichnen(unittest.TestCase):
    def test_programme_bekommen_die_kennung(self):
        e = programme.kennzeichnen(
            [prog(name="Editor", ordner=r"C:\Windows"), prog(name="V3D CAD")],
            UMG)
        self.assertTrue(e[0]["windows_eigen"])
        self.assertFalse(e[1]["windows_eigen"])

    def test_verknuepfungen_bekommen_die_kennung(self):
        e = verknuepfungen.kennzeichnen(
            [{"ziel": r"C:\Windows\notepad.exe", "art": "Programm"},
             {"ziel": r"C:\Program Files\a.exe", "art": "Programm"}], UMG)
        self.assertTrue(e[0]["windows_eigen"])
        self.assertFalse(e[1]["windows_eigen"])


def bestand():
    return {
        "angaben": {}, "hinweise": [],
        "programme": [prog(name="V3D CAD", windows_eigen=False),
                      prog(name="Editor", windows_eigen=True),
                      prog(name="Rechner", windows_eigen=True,
                           art="Store-App")],
        "verknuepfungen": [
            {"anzeigename": "V3D CAD", "bereich": "Desktop (Benutzer)",
             "windows_eigen": False, "ziel_fehlt": False, "fehler": None},
            {"anzeigename": "Editor", "bereich": "Startmenue (alle Benutzer)",
             "windows_eigen": True, "ziel_fehlt": False, "fehler": None},
        ],
    }


class Anwenden(unittest.TestCase):
    def test_windows_faellt_standardmaessig_raus(self):
        s = inventar.anwenden(bestand())
        self.assertEqual([p["name"] for p in s["programme"]], ["V3D CAD"])
        self.assertEqual(len(s["verknuepfungen"]), 1)

    def test_zahl_der_ausgeblendeten_wird_genannt(self):
        """Sonst sieht eine gekuerzte Liste aus wie der ganze Bestand."""
        s = inventar.anwenden(bestand())
        self.assertEqual(s["kennzahlen"]["ausgeblendet_programme"], 2)
        self.assertEqual(s["kennzahlen"]["ausgeblendet_verknuepfungen"], 1)

    def test_kennzahlen_zaehlen_nur_das_sichtbare(self):
        s = inventar.anwenden(bestand())
        self.assertEqual(s["kennzahlen"]["programme"], 1)
        self.assertEqual(s["kennzahlen"]["store_apps"], 0,
                         "die Store-App war Windows-eigen")
        self.assertEqual(s["kennzahlen"]["verknuepfungen"], 1)

    def test_mit_windows_zeigt_alles(self):
        s = inventar.anwenden(bestand(), mit_windows=True)
        self.assertEqual(s["kennzahlen"]["programme"], 3)
        self.assertEqual(s["kennzahlen"]["ausgeblendet_programme"], 0)

    def test_rohaufnahme_bleibt_unveraendert(self):
        """Die Sicht darf die Aufnahme nicht beschneiden - sonst laesst sich
        der Schalter im Fenster nicht mehr zurueckstellen."""
        roh = bestand()
        inventar.anwenden(roh)
        self.assertEqual(len(roh["programme"]), 3)
        self.assertEqual(len(roh["verknuepfungen"]), 2)

    def test_umschalten_ist_umkehrbar(self):
        roh = bestand()
        self.assertEqual(len(inventar.anwenden(roh)["programme"]), 1)
        self.assertEqual(len(inventar.anwenden(roh, True)["programme"]), 3)
        self.assertEqual(len(inventar.anwenden(roh)["programme"]), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
