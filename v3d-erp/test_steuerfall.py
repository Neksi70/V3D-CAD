"""Tests Umsatzsteuer-Sonderfälle (EU-Lieferung, EU-Leistung/Reverse Charge, § 13b, Drittland, § 19):
.venv/bin/python -m unittest test_steuerfall -v   (mit KoSIT-Prüfer unter ~/tools/kosit wird jede Variante offiziell validiert)"""
import glob
import os
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bericht  # noqa: E402
import erechnung  # noqa: E402
import erp  # noqa: E402
from test_erechnung import KOSIT, Basis  # noqa: E402


def kosit(tmp, xml, name):
    datei = os.path.join(tmp, name + ".xml")
    with open(datei, "wb") as f:
        f.write(xml)
    aus = os.path.join(tmp, "bericht_" + name)
    os.makedirs(aus, exist_ok=True)
    jar = glob.glob(os.path.join(KOSIT, "validator*.jar"))[0]
    p = subprocess.run([os.path.join(KOSIT, "jre/bin/java"), "-jar", jar, "-s", os.path.join(KOSIT, "conf/scenarios.xml"), "-r", os.path.join(KOSIT, "conf"),
                        "-o", aus, "-h", datei], capture_output=True, text=True, timeout=180)
    return p.stdout + p.stderr


class TestSteuerfall(Basis):
    def kunde_mit(self, steuerfall, land="AT", ust_id="ATU12345678"):
        return erp.adresse_speichern(self.db, dict(name1=f"Kunde {steuerfall}", strasse="Ring 1", plz="1010", ort="Wien", land=land, ust_id=ust_id,
                                                   email="ap@kunde.example", kunde=dict(steuerfall=steuerfall)))

    def test_inland_unveraendert(self):
        re_ = self.rechnung()
        self.assertIsNone(re_["steuerfall"])
        self.assertGreater(re_["steuer"], 0)

    def test_eu_lieferung_null_prozent_und_hinweis(self):
        re_ = self.rechnung(kunde=self.kunde_mit("eu_lieferung"))
        self.assertEqual(re_["steuerfall"], "eu_lieferung")
        self.assertEqual(re_["steuer"], 0)
        self.assertEqual(re_["netto"], re_["brutto"])
        self.assertTrue(all(p["steuer_pct"] == 0 for p in re_["positionen"]))
        xml, _ = erechnung.xrechnung(self.db, re_["id"])
        self.assertIn(b"<ram:CategoryCode>K</ram:CategoryCode>", xml)
        self.assertIn(b"VATEX-EU-IC", xml)
        self.assertIn(b"<ram:ShipToTradeParty>", xml)
        pdf, _ = bericht.beleg_pdf(self.db, re_["id"])
        self.assertTrue(pdf.startswith(b"%PDF"))

    def test_gutschrift_uebernimmt_steuerfall(self):
        re_ = self.rechnung(kunde=self.kunde_mit("eu_leistung"))
        gs = erp.beleg_weiterverarbeiten(self.db, re_["id"], "GS")
        self.assertEqual(gs["steuerfall"], "eu_leistung")
        self.assertEqual(gs["steuer"], 0)

    def test_ohne_ust_id_gesperrt(self):
        k = self.kunde_mit("eu_leistung", ust_id="")
        with self.assertRaisesRegex(erp.Fehler, "USt-IdNr"):
            self.rechnung(kunde=k)

    def test_ausland_mit_land_de_gesperrt(self):
        k = self.kunde_mit("drittland", land="DE", ust_id="")
        with self.assertRaisesRegex(erp.Fehler, "Deutschland"):
            self.rechnung(kunde=k)

    def test_steuerfall_am_beleg_ueberschreibbar(self):
        k = self.kunde_mit("eu_lieferung")
        b = erp.beleg_speichern(self.db, dict(belegart="RE", adresse_id=k["id"], steuerfall="",
                                              positionen=[dict(text="Muster", menge=1, einzelpreis=100)]))
        self.assertIsNone(b["steuerfall"])
        self.assertEqual(b["steuer"], 19)
        b = erp.beleg_speichern(self.db, dict(id=b["id"], belegart="RE", adresse_id=k["id"], positionen=[dict(text="Muster", menge=1, einzelpreis=100)]))
        self.assertIsNone(b["steuerfall"], "Beim Ändern bleibt der Steuerfall des Belegs")

    def test_einkauf_bleibt_mit_steuer(self):
        lf = erp.adresse_speichern(self.db, dict(name1="Lieferant", land="AT", lieferant={}, kunde=dict(steuerfall="eu_lieferung")))
        b = erp.beleg_speichern(self.db, dict(belegart="ER", adresse_id=lf["id"], positionen=[dict(text="Material", menge=1, einzelpreis=100)]))
        self.assertIsNone(b["steuerfall"])
        self.assertEqual(b["steuer"], 19)

    def test_kleinunternehmer(self):
        erp.einstellungen_speichern(self.db, dict(kleinunternehmer="1", ust_id="", steuernr="321/5722/0000"))
        re_ = self.rechnung()
        self.assertEqual(re_["steuerfall"], "kleinunternehmer")
        self.assertEqual(re_["steuer"], 0)
        xml, _ = erechnung.xrechnung(self.db, re_["id"])
        self.assertIn(b"<ram:CategoryCode>E</ram:CategoryCode>", xml)
        self.assertIn(b'schemeID="FC"', xml)

    def test_unbekannt(self):
        with self.assertRaises(erp.Fehler):
            erp.adresse_speichern(self.db, dict(name1="X", kunde=dict(steuerfall="quatsch")))

    @unittest.skipUnless(os.path.exists(os.path.join(KOSIT, "validator.jar")), "KoSIT-Prüfer nicht installiert")
    def test_kosit_alle_faelle(self):
        faelle = [("eu_lieferung", "AT", "ATU12345678"), ("eu_leistung", "NL", "NL123456789B01"), ("13b", "DE", "DE987654321"), ("drittland", "CH", "")]
        for sf, land, ust in faelle:
            with self.subTest(sf):
                re_ = self.rechnung(kunde=self.kunde_mit(sf, land=land, ust_id=ust))
                xml, _ = erechnung.xrechnung(self.db, re_["id"])
                out = kosit(self.tmp.name, xml, sf)
                self.assertIn("Acceptable", out, out[-2500:])
        erp.einstellungen_speichern(self.db, dict(kleinunternehmer="1", ust_id="", steuernr="321/5722/0000"))
        re_ = self.rechnung()
        xml, _ = erechnung.xrechnung(self.db, re_["id"])
        out = kosit(self.tmp.name, xml, "klein")
        self.assertIn("Acceptable", out, out[-2500:])


if __name__ == "__main__":
    unittest.main()
