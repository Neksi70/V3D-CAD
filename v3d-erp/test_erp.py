"""Tests der Geschäftslogik: python3 -m unittest test_erp -v"""
import datetime as dt
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import erp  # noqa: E402
import seed  # noqa: E402


def d(n):
    return (dt.date.today() + dt.timedelta(days=n)).isoformat()


class Basis(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = erp.verbinden(os.path.join(self.tmp.name, "t.db"))
        erp.schema_anlegen(self.db)
        self.kunde = erp.adresse_speichern(self.db, dict(name1="Test Kunde GmbH", kunde=dict(zahlungsbed_id=1)))
        self.lief = erp.adresse_speichern(self.db, dict(name1="Test Lieferant", lieferant={}))
        self.art = erp.artikel_speichern(self.db, dict(bezeichnung="Platte", vk_preis=100, ek_preis=40, meldebestand=5))

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def beleg(self, art, adr, menge=10, projekt=None, datum=None):
        return erp.beleg_speichern(self.db, dict(belegart=art, adresse_id=adr["id"], projekt_id=projekt, datum=datum,
                                                 positionen=[dict(artikel_id=self.art["id"], menge=menge, einzelpreis=100)]))


class TestBelegkette(Basis):
    def test_summen_und_nummer_erst_beim_verarbeiten(self):
        b = self.beleg("AN", self.kunde)
        self.assertIsNone(b["nummer"])
        self.assertEqual(b["netto"], 1000)
        self.assertEqual(b["brutto"], 1190)
        v = erp.beleg_verarbeiten(self.db, b["id"])["beleg"]
        self.assertRegex(v["nummer"], r"^AN-\d\d-0001$")
        self.assertEqual(v["status"], "verarbeitet")

    def test_verarbeiteter_beleg_gesperrt(self):
        b = self.beleg("AN", self.kunde)
        erp.beleg_verarbeiten(self.db, b["id"])
        with self.assertRaises(erp.Fehler):
            erp.beleg_speichern(self.db, dict(b, positionen=[]))
        with self.assertRaises(erp.Fehler):
            erp.beleg_loeschen(self.db, b["id"])

    def test_kette_an_ab_ls_re_mit_teillieferung(self):
        an = self.beleg("AN", self.kunde)
        erp.beleg_verarbeiten(self.db, an["id"])
        ab = erp.beleg_weiterverarbeiten(self.db, an["id"], "AB")
        erp.beleg_verarbeiten(self.db, ab["id"])
        # Lager auffüllen
        we = erp.beleg_weiterverarbeiten(self.db, erp.beleg_verarbeiten(self.db, self.beleg("BE", self.lief, 20)["id"])["beleg"]["id"], "WE")
        erp.beleg_verarbeiten(self.db, we["id"])
        self.assertEqual(erp.artikel_lesen(self.db, self.art["id"])["bestand"], 20)
        self.assertEqual(erp.artikel_lesen(self.db, self.art["id"])["reserviert"], 10)
        # Teillieferung 4 Stück
        ls1 = erp.beleg_weiterverarbeiten(self.db, ab["id"], "LS")
        ls1["positionen"][0]["menge"] = 4
        ls1 = erp.beleg_speichern(self.db, ls1)
        erp.beleg_verarbeiten(self.db, ls1["id"])
        # Rest muss 6 sein
        ls2 = erp.beleg_weiterverarbeiten(self.db, ab["id"], "LS")
        self.assertEqual(ls2["positionen"][0]["menge"], 6)
        erp.beleg_verarbeiten(self.db, ls2["id"])
        with self.assertRaises(erp.Fehler):
            erp.beleg_weiterverarbeiten(self.db, ab["id"], "LS")
        a = erp.artikel_lesen(self.db, self.art["id"])
        self.assertEqual(a["bestand"], 10)
        self.assertEqual(a["reserviert"], 0)
        # Rechnung erzeugt OP
        re_ = erp.beleg_weiterverarbeiten(self.db, ls1["id"], "RE")
        erp.beleg_verarbeiten(self.db, re_["id"])
        op = erp.op_liste(self.db, "debitor")
        self.assertEqual(len(op), 1)
        self.assertEqual(op[0]["offen"], 476.0)   # 4 × 100 + 19 %
        # Kette vollständig
        kette = [k["belegart"] for k in erp.belegkette(self.db, ab["id"])]
        self.assertEqual(kette.count("LS"), 2)
        self.assertIn("AN", kette)
        self.assertIn("RE", kette)

    def test_unerlaubte_folge(self):
        an = self.beleg("AN", self.kunde)
        erp.beleg_verarbeiten(self.db, an["id"])
        with self.assertRaises(erp.Fehler):
            erp.beleg_weiterverarbeiten(self.db, an["id"], "RE")

    def test_entwurf_nicht_weiterverarbeiten(self):
        an = self.beleg("AN", self.kunde)
        with self.assertRaises(erp.Fehler):
            erp.beleg_weiterverarbeiten(self.db, an["id"], "AB")

    def test_gutschrift_negativer_op(self):
        re_ = self.beleg("RE", self.kunde)
        erp.beleg_verarbeiten(self.db, re_["id"])
        gs = erp.beleg_weiterverarbeiten(self.db, re_["id"], "GS")
        erp.beleg_verarbeiten(self.db, gs["id"])
        summe = sum(o["offen"] for o in erp.op_liste(self.db, "debitor"))
        self.assertEqual(summe, 0)

    def test_falsche_rolle(self):
        with self.assertRaises(erp.Fehler):
            self.beleg("BE", self.kunde)

    def test_rechnungseingang_kreditor(self):
        be = erp.beleg_verarbeiten(self.db, self.beleg("BE", self.lief)["id"])["beleg"]
        er = erp.beleg_weiterverarbeiten(self.db, be["id"], "ER")
        erp.beleg_verarbeiten(self.db, er["id"])
        self.assertEqual(len(erp.op_liste(self.db, "kreditor")), 1)

    def test_nummernkreis_fortlaufend(self):
        n = [erp.beleg_verarbeiten(self.db, self.beleg("RE", self.kunde)["id"])["beleg"]["nummer"] for _ in range(3)]
        self.assertEqual([x[-4:] for x in n], ["0001", "0002", "0003"])


class TestProjekt(Basis):
    def projekt(self):
        return erp.projekt_speichern(self.db, dict(titel="Testprojekt", kunde_id=self.kunde["id"], meilensteine=[
            dict(titel="Auftrag", plan_start=d(-10), plan_ende=d(-10), ausloeser="AB", ist_meilenstein=1),
            dict(titel="Fertigung", plan_start=d(-5), plan_ende=d(5)),
            dict(titel="Lieferung", plan_start=d(10), plan_ende=d(10), ausloeser="LS"),
        ]))

    def test_automatisch_erledigt_durch_beleg(self):
        p = self.projekt()
        ab = self.beleg("AB", self.kunde, projekt=p["id"], datum=d(-9))
        erg = erp.beleg_verarbeiten(self.db, ab["id"])
        self.assertTrue(any("Auftrag" in m for m in erg["meldungen"]))
        p = erp.projekt_lesen(self.db, p["id"])
        self.assertEqual(p["meilensteine"][0]["ist_ende"], d(-9))
        self.assertEqual(p["meilensteine"][0]["status"], "late")     # 1 Tag nach Zusage
        self.assertEqual(p["kennzahlen"]["termintreue"], 0)

    def test_verschieben_braucht_grund_und_schiebt_folgen(self):
        p = self.projekt()
        mid = p["meilensteine"][1]["id"]
        with self.assertRaises(erp.Fehler):
            erp.meilenstein_verschieben(self.db, mid, d(8), "")
        p = erp.meilenstein_verschieben(self.db, mid, d(8), "Kapazität Fertigung")
        m = p["meilensteine"]
        self.assertEqual(m[1]["plan_ende"], d(8))
        self.assertEqual(m[1]["zugesagt"], d(5))          # Zusage bleibt sichtbar
        self.assertEqual(m[2]["plan_ende"], d(13))         # Folge mitgeschoben
        self.assertIn("Folge aus Schritt 2", m[2]["grund"])
        self.assertEqual(p["kennzahlen"]["endverzug"], 3)

    def test_status(self):
        p = self.projekt()
        st = [m["status"] for m in p["meilensteine"]]
        self.assertEqual(st, ["over", "open", "fut"])
        p = erp.meilenstein_erledigt(self.db, p["meilensteine"][0]["id"], d(-11))
        self.assertEqual(p["meilensteine"][0]["status"], "ok")
        self.assertEqual(p["kennzahlen"]["termintreue"], 100)

    def test_plan_fixieren(self):
        p = self.projekt()
        mid = p["meilensteine"][1]["id"]
        erp.meilenstein_verschieben(self.db, mid, d(8), "Sonstiges", folge=False)
        p = erp.plan_fixieren(self.db, p["id"])
        self.assertEqual(p["meilensteine"][1]["zugesagt"], d(8))


class TestEinstellungen(Basis):
    def test_standard_und_speichern(self):
        e = erp.einstellungen(self.db)
        self.assertEqual(e["firma_name"], "Muster Fertigung GmbH")
        e = erp.einstellungen_speichern(self.db, dict(firma_name="Neue Firma", logo="data:image/png;base64,AAAA"))
        self.assertEqual((e["firma_name"], e["logo"]), ("Neue Firma", "data:image/png;base64,AAAA"))
        self.assertEqual(e["ort"], "Hagen")                       # nicht übergebene Felder bleiben
        with self.assertRaises(erp.Fehler):
            erp.einstellungen_speichern(self.db, dict(logo="javascript:alert(1)"))


class TestSeed(unittest.TestCase):
    def test_testdaten_laufen_durch(self):
        with tempfile.TemporaryDirectory() as t:
            db = erp.verbinden(os.path.join(t, "s.db"))
            erp.schema_anlegen(db)
            self.assertTrue(seed.befuellen(db))
            u = erp.uebersicht(db)
            self.assertEqual(len(u["projekte"]), 3)
            p1 = [p for p in erp.projekte_liste(db) if "Schweißzelle" in p["titel"]][0]
            ms = erp.projekt_lesen(db, p1["id"])["meilensteine"]
            self.assertIsNotNone(ms[0]["ist_ende"])                 # AB hat „Auftrag bestätigt“ erledigt
            self.assertEqual(ms[4]["status"], "over")               # Material überfällig
            # Wareneingang-Entwurf verarbeiten → Material automatisch erledigt
            we = [b for b in erp.belege_liste(db, "EK", status="entwurf") if b["belegart"] == "WE"][0]
            erp.beleg_verarbeiten(db, we["id"])
            self.assertIsNotNone(erp.projekt_lesen(db, p1["id"])["meilensteine"][4]["ist_ende"])
            db.close()


if __name__ == "__main__":
    unittest.main()
