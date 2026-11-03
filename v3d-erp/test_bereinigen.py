"""Tests Kundenmaterial-Bestandsaufnahme (Chargen ohne Wareneingang) und Import auf vorhandene Adressen:
.venv/bin/python -m unittest test_bereinigen -v   (nur erfundene Daten)"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import erp  # noqa: E402
import import_myfactory as im  # noqa: E402
import inventur  # noqa: E402


class Basis(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = erp.verbinden(os.path.join(self.tmp.name, "t.db"))
        erp.schema_anlegen(self.db)
        self.art = erp.artikel_speichern(self.db, dict(artikelnr="M-100", bezeichnung="Musterbuchse honen", vk_preis=0.5, lagerfuehrung=0))

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def verarbeitet(self, art, adr, pos, **kw):
        b = erp.beleg_speichern(self.db, dict(belegart=art, adresse_id=adr, positionen=pos, **kw))
        return erp.beleg_verarbeiten(self.db, b["id"])["beleg"]

    def wk(self, ab, charge, menge=None):
        w = erp.beleg_weiterverarbeiten(self.db, ab["id"], "WK")
        for p in w["positionen"]:
            p["charge_nr"] = charge
            if menge:
                p["menge"] = menge
        w = erp.beleg_speichern(self.db, w)
        return erp.beleg_verarbeiten(self.db, w["id"])["beleg"]


class TestKundenmaterial(Basis):
    def setUp(self):
        super().setUp()
        self.k = erp.adresse_speichern(self.db, dict(name1="Muster Sinter GmbH", kunde={}))

    def test_bestand_erfassen_und_per_ab_liefern(self):
        c = inventur.kundenmaterial_erfassen(self.db, self.k["id"], self.art["id"], "A1/P1/B1/P2/LS9", 5000, kunden_ls="LS9")
        self.assertEqual(c["rest"], 5000)
        ab = self.verarbeitet("AB", self.k["id"], [dict(artikel_id=self.art["id"], menge=3000, einzelpreis=0.5)])
        offen = erp.offene_auftragspositionen(self.db, self.k["id"])[0]
        self.assertEqual((offen["im_haus"], offen["chargen"]), (5000, ["A1/P1/B1/P2/LS9"]))
        ls = erp.beleg_weiterverarbeiten(self.db, ab["id"], "LS")
        pos = [p for p in ls["positionen"] if p["artikel_id"]]
        self.assertEqual([(p["menge"], p["charge_nr"]) for p in pos], [(3000, "A1/P1/B1/P2/LS9")])
        erp.beleg_verarbeiten(self.db, ls["id"])
        self.assertEqual(erp.charge_rest(self.db, c["id"]), 2000)

    def test_nachzaehlen_korrigiert_und_null_raeumt(self):
        c = inventur.kundenmaterial_erfassen(self.db, self.k["id"], self.art["id"], "CH-Z", 100)
        c = inventur.kundenmaterial_erfassen(self.db, self.k["id"], self.art["id"], "CH-Z", 90)
        self.assertEqual(c["rest"], 90)
        c = inventur.kundenmaterial_erfassen(self.db, self.k["id"], self.art["id"], "CH-Z", 0)
        self.assertEqual(c["rest"], 0)
        arten = [r["art"] for r in self.db.execute("SELECT art FROM charge_bewegung WHERE charge_id=? ORDER BY id", (c["id"],))]
        self.assertEqual(arten, ["eingang", "korrektur", "korrektur"])
        self.assertEqual(inventur.kundenmaterial(self.db, self.k["id"]), [])

    def test_rohstoffartikel_wird_auf_bearbeitungsartikel_umgestellt(self):
        roh = erp.artikel_speichern(self.db, dict(artikelnr="RM-100", bezeichnung="Musterbuchse (Rohmaterial)", lagerfuehrung=0))
        c = inventur.kundenmaterial_erfassen(self.db, self.k["id"], roh["id"], "CH-R", 10)
        self.assertEqual(c["artikel_id"], self.art["id"])

    def test_pruefungen(self):
        lf = erp.adresse_speichern(self.db, dict(name1="Nur Lieferant", lieferant={}))
        for args, text in [((lf["id"], self.art["id"], "C", 1), "kein Kunde"), ((self.k["id"], self.art["id"], " ", 1), "Charge"),
                           ((self.k["id"], self.art["id"], "C", -1), "negativ")]:
            with self.assertRaisesRegex(erp.Fehler, text):
                inventur.kundenmaterial_erfassen(self.db, *args)


class TestImportAufVorhandeneAdresse(Basis):
    def test_echte_kundennummer_ersetzt_vorlaeufige(self):
        a = erp.adresse_speichern(self.db, dict(adressnr="AD09990", name1="Muster Sinter GmbH", kunde={}))
        p = os.path.join(self.tmp.name, "k.csv")
        with open(p, "w", encoding="utf-8") as f:
            f.write("Kundennummer;Adressnummer;Name\nK4711;AD09990;Muster Sinter GmbH\n")
        st = im.importieren(self.db, "kunden", p, True, lambda *_: None)
        self.assertEqual((st["neu"], st["aktualisiert"], st["fehler"]), (0, 1, 0))
        self.assertEqual(erp.adresse_lesen(self.db, a["id"])["kunde"]["kundennr"], "K4711")


if __name__ == "__main__":
    unittest.main()
