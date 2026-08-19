#!/usr/bin/env python3
# Tests fuer den Verknuepfungs-Scanner und die Programm-Auswertung.
#
# Der Scanner wird gegen einen nachgebauten Windows-Ordnerbaum geprueft, in
# dem echte .lnk-Proben liegen.  Die Programm-Auswertung wird ohne Registry
# geprueft - dafuer sind Filter, Datum und Paketnamen als eigene Funktionen
# herausgeloest.

import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import programme  # noqa: E402
import verknuepfungen  # noqa: E402

PROBEN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "proben")


class ScannerBaum(unittest.TestCase):
    """Baut ProgramData/AppData/Desktop nach und legt Proben hinein."""

    def setUp(self):
        self.wurzel = tempfile.mkdtemp(prefix="inventar-test-")
        self.umgebung = {
            "PROGRAMDATA": os.path.join(self.wurzel, "ProgramData"),
            "APPDATA": os.path.join(self.wurzel, "AppData"),
            "USERPROFILE": os.path.join(self.wurzel, "Benutzer"),
            "PUBLIC": os.path.join(self.wurzel, "Public"),
        }
        self.startmenue = self._ordner("PROGRAMDATA",
                                       "Microsoft/Windows/Start Menu/Programs")
        self.autostart = self._ordner(
            "PROGRAMDATA", "Microsoft/Windows/Start Menu/Programs/StartUp")
        self.desktop = self._ordner("USERPROFILE", "Desktop")
        self.gruppe = os.path.join(self.startmenue, "Volme Werkzeuge")
        os.makedirs(self.gruppe)

    def tearDown(self):
        shutil.rmtree(self.wurzel, ignore_errors=True)

    def _ordner(self, variable, unterpfad):
        pfad = os.path.join(self.umgebung[variable], *unterpfad.split("/"))
        os.makedirs(pfad, exist_ok=True)
        return pfad

    def _probe(self, name, ziel_ordner, neuer_name=None):
        ziel = os.path.join(ziel_ordner, neuer_name or name)
        shutil.copy(os.path.join(PROBEN, name), ziel)
        return ziel

    def scan(self):
        return verknuepfungen.scannen(verknuepfungen.orte(self.umgebung))

    def test_findet_verknuepfung_im_startmenue(self):
        self._probe("Editor.lnk", self.startmenue)
        e = self.scan()
        self.assertEqual(len(e), 1)
        self.assertEqual(e[0]["anzeigename"], "Editor")
        self.assertEqual(e[0]["bereich"], "Startmenue (alle Benutzer)")
        self.assertEqual(e[0]["ziel"], r"C:\windows\system32\notepad.exe")

    def test_unterordner_wird_als_gruppe_gefuehrt(self):
        self._probe("Editor.lnk", self.gruppe)
        e = self.scan()[0]
        self.assertEqual(e["gruppe"], "Volme Werkzeuge")

    def test_autostart_zaehlt_nicht_doppelt(self):
        """Der Autostart-Ordner liegt IM Startmenue.  Ohne Ausnahme erschiene
        jeder Autostart-Eintrag zweimal - und ein Bericht, der Autostart-
        Programme doppelt zeigt, ist fuer die Fehlersuche wertlos."""
        self._probe("Editor.lnk", self.autostart)
        e = self.scan()
        self.assertEqual(len(e), 1, [x["bereich"] for x in e])
        self.assertEqual(e[0]["bereich"], "Autostart (alle Benutzer)")

    def test_mehrere_bereiche(self):
        self._probe("Editor.lnk", self.startmenue)
        self._probe("Kuerzel.lnk", self.desktop)
        bereiche = {e["bereich"] for e in self.scan()}
        self.assertEqual(bereiche, {"Startmenue (alle Benutzer)",
                                    "Desktop (Benutzer)"})

    def test_fehlende_ordner_stoeren_nicht(self):
        """Auf einem frischen Windows fehlt z. B. der Schnellstart-Ordner."""
        self.assertTrue(verknuepfungen.orte(self.umgebung))
        leer = verknuepfungen.orte({"APPDATA": "/gibt/es/nicht"})
        self.assertEqual(leer, [])

    def test_andere_dateien_werden_uebergangen(self):
        with open(os.path.join(self.startmenue, "liesmich.txt"), "w") as f:
            f.write("kein Verweis")
        with open(os.path.join(self.startmenue, "bild.ico"), "wb") as f:
            f.write(b"\x00")
        self._probe("Editor.lnk", self.startmenue)
        self.assertEqual(len(self.scan()), 1)

    def test_kaputte_datei_bricht_den_durchlauf_nicht_ab(self):
        """Eine unlesbare Verknuepfung darf nicht dazu fuehren, dass der Rest
        des Startmenues ungelesen bleibt."""
        with open(os.path.join(self.startmenue, "Kaputt.lnk"), "wb") as f:
            f.write(b"nicht wirklich eine Verknuepfung")
        self._probe("Editor.lnk", self.startmenue)
        e = self.scan()
        self.assertEqual(len(e), 2)
        kaputt = [x for x in e if x["anzeigename"] == "Kaputt"][0]
        self.assertIsNotNone(kaputt["fehler"])
        heil = [x for x in e if x["anzeigename"] == "Editor"][0]
        self.assertIsNone(heil["fehler"])

    def test_url_verknuepfung(self):
        with open(os.path.join(self.desktop, "Volme3D.url"), "w") as f:
            f.write("[InternetShortcut]\nURL=https://volme3d.de/\n"
                    "IconFile=C:\\icons\\v.ico\nIconIndex=0\n")
        e = self.scan()[0]
        self.assertEqual(e["art"], "Internet")
        self.assertEqual(e["ziel"], "https://volme3d.de/")
        self.assertEqual(e["symbol"], r"C:\icons\v.ico")

    def test_zeitstempel_vorhanden(self):
        self._probe("Editor.lnk", self.desktop)
        e = self.scan()[0]
        self.assertIsNotNone(e["angelegt"])
        self.assertIsNotNone(e["geaendert"])

    def test_fehlendes_ziel_wird_erkannt(self):
        """Der wichtigste Befund nach einer Deinstallation: die Kachel bleibt,
        das Programm ist weg."""
        vorhanden = os.path.join(self.wurzel, "da.exe")
        open(vorhanden, "w").close()
        eintraege = [
            {"ziel": vorhanden, "art": "Programm"},
            {"ziel": os.path.join(self.wurzel, "weg.exe"), "art": "Programm"},
            {"ziel": r"\\server\freigabe\x.exe", "art": "Programm"},
            {"ziel": None, "art": "Programm"},
            {"ziel": "https://volme3d.de/", "art": "Internet"},
        ]
        verknuepfungen.ziel_pruefen(eintraege)
        self.assertIs(eintraege[0]["ziel_fehlt"], False)
        self.assertIs(eintraege[1]["ziel_fehlt"], True)
        self.assertIsNone(eintraege[2]["ziel_fehlt"], "Netzpfad nicht pruefbar")
        self.assertIsNone(eintraege[3]["ziel_fehlt"])
        self.assertIsNone(eintraege[4]["ziel_fehlt"], "URL ist keine Datei")


class ProgrammFilter(unittest.TestCase):
    def test_echtes_programm_bleibt(self):
        self.assertFalse(programme.ist_nebeneintrag({
            "DisplayName": "Volme CAD", "UninstallString": "C:\\x\\uni.exe"}))

    def test_namenlos_faellt_weg(self):
        self.assertTrue(programme.ist_nebeneintrag(
            {"UninstallString": "x"}))
        self.assertTrue(programme.ist_nebeneintrag(
            {"DisplayName": "   ", "UninstallString": "x"}))

    def test_systembestandteil_faellt_weg(self):
        self.assertTrue(programme.ist_nebeneintrag(
            {"DisplayName": "Irgendwas", "SystemComponent": 1,
             "UninstallString": "x"}))

    def test_update_faellt_weg(self):
        """Ohne diesen Filter besteht die Liste zur Haelfte aus Updates."""
        for art in ("Security Update", "Hotfix", "Update Rollup"):
            self.assertTrue(programme.ist_nebeneintrag(
                {"DisplayName": "KB5001234", "ReleaseType": art,
                 "UninstallString": "x"}), art)

    def test_bestandteil_eines_pakets_faellt_weg(self):
        self.assertTrue(programme.ist_nebeneintrag(
            {"DisplayName": "Teilstueck", "ParentKeyName": "Hauptpaket",
             "UninstallString": "x"}))

    def test_ohne_deinstallationsweg_faellt_weg(self):
        self.assertTrue(programme.ist_nebeneintrag({"DisplayName": "Leiche"}))

    def test_stille_deinstallation_reicht_aus(self):
        self.assertFalse(programme.ist_nebeneintrag(
            {"DisplayName": "Programm", "QuietUninstallString": "x /S"}))


class Feldnamen(unittest.TestCase):
    def test_keine_doppelten_feldnamen(self):
        """Zwei Registry-Werte auf denselben Feldnamen abzubilden heisst,
        dass einer still verschwindet - InstallSource lief so gegen die
        Angabe, ob das Programm fuer den Rechner oder den Benutzer gilt."""
        felder = list(programme.FELDER.values())
        self.assertEqual(len(felder), len(set(felder)), "Feldname doppelt")
        self.assertNotIn("quelle", felder,
                         "'quelle' ist fuer Rechner/Benutzer reserviert")

    def test_uwp_liefert_dieselben_felder_wie_registry(self):
        """Beide Quellen landen in einer Tabelle - fehlt einer Seite ein
        Feld, bleibt die Spalte fuer diese Zeilen unbesetzt."""
        aus_registry = set(programme.FELDER.values()) | {
            "schluessel", "quelle", "bitheit", "installiert_am",
            "groesse_kb", "msi_kennung", "art"}
        # Nachbau eines UWP-Eintrags, wie _uwp_lesen ihn erzeugt
        uwp = {"name", "fassung", "hersteller", "ordner", "schluessel",
               "quelle", "bitheit", "art", "installiert_am", "groesse_kb",
               "msi_kennung", "deinstallation", "deinstallation_still",
               "symbol", "hilfe", "webseite", "bemerkung", "quelle_pfad"}
        self.assertEqual(aus_registry - uwp, set(),
                         "Store-Apps fehlen Felder aus der Registry-Seite")


class Datum(unittest.TestCase):
    def test_windows_format(self):
        d = programme.datum_deuten("20240317")
        self.assertEqual((d.year, d.month, d.day), (2024, 3, 17))

    def test_landesschreibweise(self):
        self.assertEqual(programme.datum_deuten("17.03.2024").month, 3)

    def test_unsinn_gibt_nichts(self):
        """Lieber kein Datum als ein erfundenes."""
        for wert in ("", None, "abc", "20249999", "0", "2024-13-45"):
            self.assertIsNone(programme.datum_deuten(wert), repr(wert))


class Paketnamen(unittest.TestCase):
    def test_store_paket(self):
        t = programme.paketname_zerlegen(
            "Microsoft.WindowsCalculator_11.2210.0.0_x64__8wekyb3d8bbwe")
        self.assertEqual(t["name"], "Microsoft.WindowsCalculator")
        self.assertEqual(t["fassung"], "11.2210.0.0")
        self.assertEqual(t["architektur"], "x64")
        self.assertEqual(t["herausgeber"], "8wekyb3d8bbwe")

    def test_neutrale_architektur(self):
        t = programme.paketname_zerlegen(
            "Microsoft.UI.Xaml_8.2306.0.0_neutral__8wekyb3d8bbwe")
        self.assertIsNone(t["architektur"])

    def test_unerwarteter_name_stuerzt_nicht_ab(self):
        t = programme.paketname_zerlegen("KomischesPaket")
        self.assertEqual(t["name"], "KomischesPaket")
        self.assertIsNone(t["fassung"])


class Zusammenfassen(unittest.TestCase):
    def eintrag(self, **k):
        grund = {"schluessel": "{ABC}", "quelle": "Rechner", "name": "Test",
                 "bitheit": "64-Bit"}
        grund.update(k)
        return grund

    def test_gleicher_schluessel_in_beiden_sichten(self):
        """Gespiegelte Eintraege duerfen nicht doppelt gezaehlt werden."""
        e = programme.zusammenfassen([
            self.eintrag(bitheit="64-Bit"), self.eintrag(bitheit="32-Bit")])
        self.assertEqual(len(e), 1)
        self.assertEqual(e[0]["bitheit"], "32/64-Bit")

    def test_verschiedene_programme_bleiben(self):
        e = programme.zusammenfassen([
            self.eintrag(name="B", schluessel="{1}"),
            self.eintrag(name="A", schluessel="{2}")])
        self.assertEqual([x["name"] for x in e], ["A", "B"], "alphabetisch")

    def test_rechner_und_benutzer_bleiben_getrennt(self):
        """Dasselbe Programm kann fuer den Rechner UND fuer den Benutzer
        installiert sein - das sind zwei echte Installationen."""
        e = programme.zusammenfassen([
            self.eintrag(quelle="Rechner"), self.eintrag(quelle="Benutzer")])
        self.assertEqual(len(e), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
