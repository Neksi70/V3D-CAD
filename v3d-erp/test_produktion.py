"""Tests Produktion (Rückmeldung je Palette/Charge): python3 -m unittest test_produktion -v"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import erp  # noqa: E402
import produktion  # noqa: E402


class TestProduktion(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = erp.verbinden(os.path.join(self.tmp.name, "t.db"))
        erp.schema_anlegen(self.db)
        self.kunde = erp.adresse_speichern(self.db, dict(name1="Sinterwerk Muster", kunde=dict(zahlungsbed_id=1)))
        self.art = erp.artikel_speichern(self.db, dict(bezeichnung="Lagerdeckel bohren", vk_preis=0.6, lagerfuehrung=0, arbeitsplan="Bohren; Gewinde schneiden"))
        # Wareneingang Kundenmaterial über die normale Belegkette
        ab = erp.beleg_speichern(self.db, dict(belegart="AB", adresse_id=self.kunde["id"],
                                               positionen=[dict(artikel_id=self.art["id"], text="LD", menge=1000, einzelpreis=0.6)]))
        ab = erp.beleg_verarbeiten(self.db, ab["id"])["beleg"]
        wk = erp.beleg_weiterverarbeiten(self.db, ab["id"], "WK")
        for p in wk["positionen"]:
            p["charge_nr"] = "CH-77"
        wk = erp.beleg_speichern(self.db, wk)
        erp.beleg_verarbeiten(self.db, wk["id"])
        self.charge = self.db.execute("SELECT id FROM charge WHERE chargennr='CH-77'").fetchone()["id"]

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def test_arbeitsplan_vom_artikel(self):
        self.assertEqual(produktion.arbeitsgaenge(self.db, self.art["id"]), ["Bohren", "Gewinde schneiden"])
        self.assertIn("Bohren", produktion.grundlagen(self.db)["arbeitsgaenge"])
        treffer = produktion.charge_suchen(self.db, "ch-77")
        self.assertEqual(treffer[0]["id"], self.charge)
        self.assertEqual(treffer[0]["arbeitsgaenge"], ["Bohren", "Gewinde schneiden"])

    def test_start_pause_ende_und_ausschuss(self):
        f = produktion.starten(self.db, dict(charge_id=self.charge, palette="1", arbeitsgang="Bohren", maschine="BZ 1", mitarbeiter="Mama", menge_plan=600), "werkstatt")
        self.assertEqual(f["status"], "laeuft")
        with self.assertRaises(erp.Fehler):     # derselbe Gang auf derselben Palette doppelt
            produktion.starten(self.db, dict(charge_id=self.charge, palette="1", arbeitsgang="Bohren"))
        self.assertEqual(produktion.pause(self.db, f["id"], True)["status"], "pause")
        self.assertEqual(produktion.pause(self.db, f["id"], False)["status"], "laeuft")
        with self.assertRaises(erp.Fehler):
            produktion.beenden(self.db, f["id"], {})
        f = produktion.beenden(self.db, f["id"], dict(menge_gut=590, menge_ausschuss=10, grund="Bohrer gebrochen"))
        self.assertEqual(f["status"], "fertig")
        self.assertAlmostEqual(erp.charge_rest(self.db, self.charge), 990)
        p = produktion.fortschritt(self.db, [self.charge])[0]
        bohren = p["schritte"][0]
        self.assertEqual((bohren["gut"], bohren["ausschuss"], bohren["pct"]), (590, 10, 60))
        self.assertEqual(p["status"], "in Arbeit")
        # Palette 2 fertig bohren, dann Gewinde für alles
        f2 = produktion.starten(self.db, dict(charge_id=self.charge, palette="2", arbeitsgang="Bohren"))
        produktion.beenden(self.db, f2["id"], dict(menge_gut=400))
        f3 = produktion.starten(self.db, dict(charge_id=self.charge, arbeitsgang="Gewinde schneiden"))
        produktion.beenden(self.db, f3["id"], dict(menge_gut=990))
        p = produktion.fortschritt(self.db, [self.charge])[0]
        self.assertTrue(all(x["fertig"] for x in p["schritte"]), p)
        self.assertEqual(p["status"], "fertig")
        self.assertEqual(p["schritte"][1]["soll"], 990)       # Ausschuss beim Bohren kommt beim Gewinde nicht mehr an

    def test_zuruecknehmen_storniert_ausschuss(self):
        f = produktion.starten(self.db, dict(charge_id=self.charge, arbeitsgang="Bohren"))
        produktion.beenden(self.db, f["id"], dict(menge_gut=0, menge_ausschuss=5))
        self.assertAlmostEqual(erp.charge_rest(self.db, self.charge), 995)
        f = produktion.zuruecknehmen(self.db, f["id"])
        self.assertEqual(f["status"], "laeuft")
        self.assertAlmostEqual(erp.charge_rest(self.db, self.charge), 1000)
        produktion.loeschen(self.db, f["id"])
        self.assertEqual(produktion.liste(self.db, charge_id=self.charge), [])

    def test_zu_viel_ausschuss(self):
        f = produktion.starten(self.db, dict(charge_id=self.charge, arbeitsgang="Bohren"))
        with self.assertRaises(erp.Fehler):
            produktion.beenden(self.db, f["id"], dict(menge_ausschuss=5000))
        self.assertEqual(produktion.lesen(self.db, f["id"])["status"], "laeuft")

    def test_projektzuordnung(self):
        f = produktion.starten(self.db, dict(charge_id=self.charge, arbeitsgang="Bohren"))
        self.assertIsNone(f["projekt_id"])
        self.assertEqual(len(produktion.fortschritt(self.db)), 1)


if __name__ == "__main__":
    unittest.main()
