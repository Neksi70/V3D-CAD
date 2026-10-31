"""Tests Rechnungstauglichkeit: Archiv (GoBD), Nummernkreise, Leistungsdatum, Echtbetrieb, Sicherung.
.venv/bin/python -m unittest test_archiv -v"""
import io
import os
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import archiv  # noqa: E402
import bericht  # noqa: E402
import erp  # noqa: E402

HIER = os.path.dirname(os.path.abspath(__file__))


class Basis(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.alt = (erp.DOK_ORDNER, erp.ARCHIV_ORDNER)
        erp.DOK_ORDNER = os.path.join(self.tmp.name, "dokumente")
        erp.ARCHIV_ORDNER = os.path.join(self.tmp.name, "archiv")
        self.db = erp.verbinden(os.path.join(self.tmp.name, "erp.db"))
        erp.schema_anlegen(self.db)
        erp.einstellungen_speichern(self.db, dict(firma_name="Testbetrieb GmbH", strasse="Werkstraße 1", plz="58135", ort="Hagen", telefon="02331 0",
                                                  email="info@test.example", ust_id="DE123456789", iban="DE02 1203 0000 0000 2020 51", bic="BYLADEM1001"))
        self.kunde = erp.adresse_speichern(self.db, dict(name1="Muster AG", strasse="Testweg 7", plz="44135", ort="Dortmund",
                                                         email="rechnung@muster.example", kunde=dict(zahlungsbed_id=1)))
        self.art = erp.artikel_speichern(self.db, dict(bezeichnung="Bohren", vk_preis=0.5, lagerfuehrung=0))

    def tearDown(self):
        self.db.close()
        erp.DOK_ORDNER, erp.ARCHIV_ORDNER = self.alt
        for w, _, fs in os.walk(self.tmp.name):          # schreibgeschützte Archivdateien aufräumbar machen
            for f in fs:
                os.chmod(os.path.join(w, f), 0o644)
        self.tmp.cleanup()

    def kette(self):
        ab = erp.beleg_verarbeiten(self.db, erp.beleg_speichern(self.db, dict(belegart="AB", adresse_id=self.kunde["id"], ihre_referenz="4711",
                                   positionen=[dict(artikel_id=self.art["id"], text="Bohren", menge=1000, einzelpreis=0.5)]))["id"])["beleg"]
        ls = erp.beleg_verarbeiten(self.db, erp.beleg_weiterverarbeiten(self.db, ab["id"], "LS")["id"])["beleg"]
        re_ = erp.beleg_verarbeiten(self.db, erp.beleg_weiterverarbeiten(self.db, ls["id"], "RE")["id"])
        return ab, ls, re_


class TestArchiv(Basis):
    def test_rechnung_wird_mit_erechnung_archiviert_und_bleibt_unveraendert(self):
        ab, ls, r = self.kette()
        re_ = r["beleg"]
        self.assertIn("archiviert (mit E-Rechnung)", r["meldungen"])
        arten = {a["art"] for a in re_["archiv"]}
        self.assertEqual(arten, {"pdf", "xrechnung"})
        pdf, zeile_ = archiv.holen(self.db, re_["id"], "pdf")
        self.assertTrue(pdf.startswith(b"%PDF"))
        pfad = os.path.join(erp.ARCHIV_ORDNER, zeile_["datei"])
        self.assertFalse(os.stat(pfad).st_mode & stat.S_IWUSR)          # schreibgeschützt
        # Firmendaten ändern → Archiv-PDF bleibt bytegleich
        erp.einstellungen_speichern(self.db, dict(firma_name="Ganz Andere GmbH"))
        pdf2, _ = archiv.holen(self.db, re_["id"], "pdf")
        self.assertEqual(pdf, pdf2)
        # Manipulation wird erkannt
        os.chmod(pfad, 0o644)
        with open(pfad, "ab") as f:
            f.write(b"x")
        with self.assertRaises(erp.Fehler):
            archiv.holen(self.db, re_["id"], "pdf")
        self.assertEqual(len(archiv.pruefen(self.db)["fehler"]), 1)

    def test_ohne_erechnungsdaten_trotzdem_pdf_archiv(self):
        erp.adresse_speichern(self.db, dict(self.kunde, email="", kunde=dict(zahlungsbed_id=1)))
        ab, ls, r = self.kette()
        self.assertTrue(any("ohne E-Rechnung archiviert" in m for m in r["meldungen"]))
        self.assertEqual({a["art"] for a in r["beleg"]["archiv"]}, {"pdf"})

    def test_lieferschein_neue_version_bei_verpackung_und_nachtraeglich(self):
        ab, ls, r = self.kette()
        self.assertEqual(len(archiv.versionen(self.db, ls["id"])), 1)
        erp.verpackung_speichern(self.db, ls["id"], [dict(art="Europalette", anzahl=1)])
        archiv.archivieren(self.db, ls["id"], "test", "Verpackung geändert")
        v = archiv.versionen(self.db, ls["id"])
        self.assertEqual([x["version"] for x in v], [1, 2])
        self.assertEqual(archiv.holen(self.db, ls["id"])[1]["version"], 2)
        # vor dem Archiv verarbeiteter Beleg: wird beim ersten Abruf nachgeholt
        alt = erp.ARCHIV_ORDNER
        erp.ARCHIV_ORDNER = None
        ab2 = erp.beleg_verarbeiten(self.db, erp.beleg_speichern(self.db, dict(belegart="AB", adresse_id=self.kunde["id"],
                                    positionen=[dict(text="x", menge=1, einzelpreis=1)]))["id"])["beleg"]
        erp.ARCHIV_ORDNER = alt
        self.assertEqual(archiv.versionen(self.db, ab2["id"]), [])
        self.assertIsNotNone(archiv.holen(self.db, ab2["id"]))
        self.assertEqual(archiv.versionen(self.db, ab2["id"])[0]["anlass"], "nachträglich archiviert")
        # Entwurf wird nicht archiviert
        e = erp.beleg_speichern(self.db, dict(belegart="AN", adresse_id=self.kunde["id"], positionen=[dict(text="x", menge=1, einzelpreis=1)]))
        self.assertIsNone(archiv.holen(self.db, e["id"]))


class TestNummernUndLeistung(Basis):
    def test_nummernformat_myfactory_anschluss(self):
        erp.nummernkreise_speichern(self.db, [dict(code="RE", muster="RG{JJ}{N5}", naechste=65), dict(code="LS", muster="LS{JJ}{N5}", naechste=330)])
        ab, ls, r = self.kette()
        jj = r["beleg"]["datum"][2:4]
        self.assertEqual(ls["nummer"], f"LS{jj}00330")
        self.assertEqual(r["beleg"]["nummer"], f"RG{jj}00065")
        with self.assertRaises(erp.Fehler):                     # schon vergebene Nummer nicht noch einmal
            erp.nummernkreise_speichern(self.db, [dict(code="RE", muster="RG{JJ}{N5}", naechste=65)])
        with self.assertRaises(erp.Fehler):                     # Format ohne laufende Nummer
            erp.nummernkreise_speichern(self.db, [dict(code="RE", muster="RG{JJ}", naechste=70)])
        nk = {x["code"]: x for x in erp.nummernkreise(self.db)}
        self.assertEqual(nk["RE"]["beispiel"], f"RG{jj}00066")

    def test_leistungsdatum(self):
        ab, ls, r = self.kette()
        self.assertIn(f"Lieferdatum gemäß Lieferschein {ls['nummer']}", bericht.leistungstext(self.db, r["beleg"]))
        frei = erp.beleg_speichern(self.db, dict(belegart="RE", adresse_id=self.kunde["id"], leistungsdatum="Oktober 2026",
                                                 positionen=[dict(text="Wartung", menge=1, einzelpreis=100)]))
        self.assertEqual(bericht.leistungstext(self.db, frei), "Leistungsdatum: Oktober 2026")
        frei = erp.beleg_speichern(self.db, dict(frei, leistungsdatum=""))
        self.assertIn("entspricht dem Rechnungsdatum", bericht.leistungstext(self.db, frei))


class TestBetrieb(Basis):
    def test_echtbetrieb_und_sicherung(self):
        self.kette()
        self.db.close()
        env = dict(os.environ, V3D_ERP_DATEN=self.tmp.name)
        ziel = os.path.join(self.tmp.name, "echt.db")
        p = subprocess.run([sys.executable, os.path.join(HIER, "echtbetrieb.py"), ziel, "--mit-stammdaten"], env=env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        d = sqlite3.connect(ziel)
        self.assertEqual(d.execute("SELECT COUNT(*) FROM beleg").fetchone()[0], 0)
        self.assertEqual(d.execute("SELECT COUNT(*) FROM nummernkreis").fetchone()[0], 0)
        self.assertEqual(d.execute("SELECT COUNT(*) FROM adresse").fetchone()[0], 1)
        self.assertEqual(d.execute("SELECT wert FROM einstellung WHERE schluessel='firma_name'").fetchone()[0], "Testbetrieb GmbH")
        d.close()
        kopie = os.path.join(self.tmp.name, "zweitplatte")
        p = subprocess.run([sys.executable, os.path.join(HIER, "sicherung.py"), "--name", "test", "--kopie", kopie], env=env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("Prüfung ok", p.stdout)
        self.assertTrue(os.listdir(os.path.join(kopie, "db")))
        self.assertTrue(any(f.endswith(".pdf") for _, _, fs in os.walk(os.path.join(kopie, "archiv")) for f in fs))
        self.db = erp.verbinden(os.path.join(self.tmp.name, "erp.db"))


if __name__ == "__main__":
    unittest.main()
