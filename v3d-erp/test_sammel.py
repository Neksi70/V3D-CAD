"""Tests Mengenabgleich WK→AB und Sammel-Lieferschein: python3 -m unittest test_sammel -v"""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import erp  # noqa: E402


class Basis(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = erp.verbinden(os.path.join(self.tmp.name, "t.db"))
        erp.schema_anlegen(self.db)
        self.kunde = erp.adresse_speichern(self.db, dict(name1="Sinterwerk Muster", kunde=dict(zahlungsbed_id=1)))
        self.a1 = erp.artikel_speichern(self.db, dict(bezeichnung="Ventilgehäuse Nut fräsen", vk_preis=0.6325, lagerfuehrung=0))
        self.a2 = erp.artikel_speichern(self.db, dict(bezeichnung="Ritzel honen", vk_preis=0.0742, lagerfuehrung=0))

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def ab(self, positionen, ref=None):
        b = erp.beleg_speichern(self.db, dict(belegart="AB", adresse_id=self.kunde["id"], ihre_referenz=ref, positionen=positionen))
        return erp.beleg_verarbeiten(self.db, b["id"])["beleg"]

    def wk(self, ab, mengen, charge):
        w = erp.beleg_weiterverarbeiten(self.db, ab["id"], "WK")
        for p, m in zip(w["positionen"], mengen):
            p["menge"], p["charge_nr"] = m, charge
        w = erp.beleg_speichern(self.db, w)
        return erp.beleg_verarbeiten(self.db, w["id"])


class TestMengenabgleich(Basis):
    def test_weniger_eingegangen_ab_angleichen(self):
        ab = self.ab([dict(artikel_id=self.a1["id"], text="Ventilgehäuse", menge=3830, einzelpreis=0.6325)])
        r = self.wk(ab, [3750], "400003572/50/160022690/10/74548")
        self.assertEqual(len(r["abweichungen"]), 1)
        a = r["abweichungen"][0]
        self.assertEqual((a["ab_menge"], a["eingang"], a["moeglich"]), (3830, 3750, True))
        erp.ab_angleichen(self.db, r["beleg"]["id"], "test")
        neu = erp.beleg_lesen(self.db, ab["id"])
        self.assertEqual(neu["positionen"][0]["menge"], 3750)
        self.assertAlmostEqual(neu["netto"], round(3750 * 0.6325, 2))
        self.assertEqual(erp.mengen_abweichung(self.db, r["beleg"]["id"]), [])
        # LS übernimmt jetzt genau die eingegangene Menge, nichts bleibt offen
        ls = erp.beleg_weiterverarbeiten(self.db, ab["id"], "LS")
        self.assertEqual(sum(p["menge"] for p in ls["positionen"]), 3750)

    def test_teillieferung_keine_abweichung_wenn_gleich(self):
        ab = self.ab([dict(artikel_id=self.a1["id"], text="V", menge=1000, einzelpreis=1)])
        r = self.wk(ab, [1000], "C1")
        self.assertEqual(r["abweichungen"], [])
        with self.assertRaises(erp.Fehler):
            erp.ab_angleichen(self.db, r["beleg"]["id"])

    def test_nicht_unter_gelieferte_menge(self):
        ab = self.ab([dict(artikel_id=self.a1["id"], text="V", menge=1000, einzelpreis=1)])
        r1 = self.wk(ab, [600], "C1")
        ls = erp.beleg_weiterverarbeiten(self.db, ab["id"], "LS")
        erp.beleg_verarbeiten(self.db, ls["id"])           # 600 geliefert
        # zweiter WK bringt 300 → Eingang 900 < AB 1000, aber ≥ geliefert 600 → möglich
        r2 = self.wk(ab, [300], "C2")
        self.assertTrue(r2["abweichungen"][0]["moeglich"])
        self.assertEqual(r2["abweichungen"][0]["eingang"], 900)
        self.assertTrue(r1["abweichungen"][0]["moeglich"])


class TestSammelLieferschein(Basis):
    def test_mehrere_auftraege_ein_ls(self):
        ab1 = self.ab([dict(artikel_id=self.a1["id"], text="Ventilgehäuse", menge=3750, einzelpreis=0.6325)], ref="400003572")
        ab2 = self.ab([dict(artikel_id=self.a2["id"], text="Ritzel", menge=62850, einzelpreis=0.0742)], ref="100075656")
        self.wk(ab1, [3750], "CH-A")
        self.wk(ab2, [36850], "CH-B")
        kunden = erp.offene_auftragspositionen(self.db)
        self.assertEqual(kunden[0]["anzahl"], 2)
        offen = erp.offene_auftragspositionen(self.db, self.kunde["id"])
        self.assertEqual([(p["ab_nummer"], p["offen"], p["im_haus"], p["vorschlag"]) for p in offen],
                         [(ab1["nummer"], 3750, 3750, 3750), (ab2["nummer"], 62850, 36850, 36850)])
        self.assertEqual(offen[1]["chargen"], ["CH-B"])
        with self.assertRaises(erp.Fehler):        # mehr als im Haus
            erp.sammel_lieferschein(self.db, self.kunde["id"], [dict(pos_id=offen[1]["pos_id"], menge=40000)])
        ls = erp.sammel_lieferschein(self.db, self.kunde["id"], [dict(pos_id=p["pos_id"], menge=p["vorschlag"]) for p in offen], "test")
        self.assertEqual(ls["belegart"], "LS")
        texte = [p["text"] for p in ls["positionen"]]
        self.assertTrue(texte[0].startswith(f"aus Auftragsbestätigung {ab1['nummer']}"))
        ware = [p for p in ls["positionen"] if p["menge"] > 0]
        self.assertEqual([(p["menge"], p["charge_nr"]) for p in ware], [(3750, "CH-A"), (36850, "CH-B")])
        kette = {b["nummer"] for b in ls["kette"]}
        self.assertTrue({ab1["nummer"], ab2["nummer"]} <= kette)
        # Entwurf verplant das Material: kein zweites Mal anbietbar
        offen2 = erp.offene_auftragspositionen(self.db, self.kunde["id"])
        self.assertTrue(all(p["im_haus"] == 0 for p in offen2))
        r = erp.beleg_verarbeiten(self.db, ls["id"])
        self.assertTrue(r["beleg"]["nummer"].startswith("LS"))
        offen3 = erp.offene_auftragspositionen(self.db, self.kunde["id"])
        self.assertEqual([(p["offen"], p["im_haus"]) for p in offen3], [(26000, 0)])
        # Rechnung aus dem Sammel-LS: Textzeilen fallen weg, Mengen stimmen
        re_ = erp.beleg_weiterverarbeiten(self.db, ls["id"], "RE")
        self.assertEqual(sorted(p["menge"] for p in re_["positionen"]), [3750, 36850])

    def test_ohne_kundenmaterial(self):
        ab = self.ab([dict(text="Konstruktion Vorrichtung", menge=2, einzelpreis=95)])
        offen = erp.offene_auftragspositionen(self.db, self.kunde["id"])
        self.assertFalse(offen[0]["kundenmaterial"])
        ls = erp.sammel_lieferschein(self.db, self.kunde["id"], [dict(pos_id=offen[0]["pos_id"], menge=2)])
        self.assertEqual(len(ls["positionen"]), 1)            # nur ein Auftrag → keine Kopfzeile
        self.assertEqual(ls["positionen"][0]["vorgaenger_pos_id"], ab["positionen"][0]["id"])


if __name__ == "__main__":
    unittest.main()


class TestTommi28(Basis):
    """Rückmeldung 28.10.: LS ohne Preise, Verpackung, Sammelrechnung, kein Lager-Minus durch Kundenmaterial."""

    def ls_aus(self, ab, menge=None):
        ls = erp.beleg_weiterverarbeiten(self.db, ab["id"], "LS")
        if menge:
            ls["positionen"][0]["menge"] = menge
            ls = erp.beleg_speichern(self.db, ls)
        return erp.beleg_verarbeiten(self.db, ls["id"])["beleg"]

    def test_kundenmaterial_kein_lagerminus(self):
        art = erp.artikel_speichern(self.db, dict(bezeichnung="Komfortventilkörper", vk_preis=0.092, lagerfuehrung=1))
        ab = self.ab([dict(artikel_id=art["id"], text="KVK", menge=11800, einzelpreis=0.092)])
        self.wk(ab, [11800], "100075790/60")
        r = erp.beleg_weiterverarbeiten(self.db, ab["id"], "LS")
        r = erp.beleg_verarbeiten(self.db, r["id"])
        self.assertFalse([m for m in r["meldungen"] if "Bestand" in m or "Lager" in m], r["meldungen"])
        self.assertEqual(erp.bestand(self.db, art["id"]), 0)

    def test_formular_und_verpackung(self):
        self.assertEqual(erp.formular(self.db, "LS"), {"preise": False, "charge": True, "verpackung": True})
        self.assertTrue(erp.formular(self.db, "RE")["preise"])
        erp.einstellungen_speichern(self.db, dict(formular='{"LS": {"preise": true}}'))
        self.assertTrue(erp.formular(self.db, "LS")["preise"])
        ab = self.ab([dict(artikel_id=self.a1["id"], text="V", menge=100, einzelpreis=1)])
        ls = self.ls_aus(ab)
        v = erp.verpackung_speichern(self.db, ls["id"], [dict(art="Europalette", anzahl="2"), dict(art="Lochkiste SMB", anzahl=40), dict(art="", anzahl=3)])
        self.assertEqual(v, [{"art": "Europalette", "anzahl": 2.0}, {"art": "Lochkiste SMB", "anzahl": 40.0}])
        self.assertEqual(erp.beleg_lesen(self.db, ls["id"])["verpackung"][1]["anzahl"], 40)
        import bericht
        pdf, _ = bericht.beleg_pdf(self.db, ls["id"])
        self.assertTrue(pdf.startswith(b"%PDF"))

    def test_sammelrechnung(self):
        ab1 = self.ab([dict(artikel_id=self.a1["id"], text="Ventilgehäuse", menge=3750, einzelpreis=0.6325)], ref="400003572")
        ab2 = self.ab([dict(artikel_id=self.a2["id"], text="Ritzel", menge=5000, einzelpreis=0.0742)])
        ls1 = self.ls_aus(ab1, 2000)
        ls2 = self.ls_aus(ab1)                                  # Rest 1750
        ls3 = self.ls_aus(ab2)
        kunden = erp.offene_lieferscheine(self.db)
        self.assertEqual(kunden[0]["anzahl"], 3)
        l = erp.offene_lieferscheine(self.db, self.kunde["id"])
        self.assertEqual([b["nummer"] for b in l], [ls1["nummer"], ls2["nummer"], ls3["nummer"]])
        re_ = erp.sammel_rechnung(self.db, self.kunde["id"], [ls3["id"], ls1["id"]], "test")
        ware = [p for p in re_["positionen"] if not erp.ist_textzeile(p)]
        self.assertEqual([p["menge"] for p in ware], [2000, 5000])            # nach LS-Datum/Nummer sortiert
        self.assertTrue(re_["positionen"][0]["text"].startswith(f"Lieferschein {ls1['nummer']}"))
        self.assertAlmostEqual(re_["netto"], round(2000 * 0.6325, 2) + 5000 * 0.0742, places=2)
        # Entwurf zählt schon als berechnet? Nein – erst verarbeitete/angelegte RE-Positionen; offene_menge zählt alle nicht stornierten
        rest = erp.offene_lieferscheine(self.db, self.kunde["id"])
        self.assertEqual([b["nummer"] for b in rest], [ls2["nummer"]])
        with self.assertRaises(erp.Fehler):
            erp.sammel_rechnung(self.db, self.kunde["id"], [ls1["id"]])
        r = erp.beleg_verarbeiten(self.db, re_["id"])
        self.assertTrue(r["beleg"]["nummer"].startswith("RE"))
        kette = {b["nummer"] for b in erp.beleg_lesen(self.db, re_["id"])["kette"]}
        self.assertTrue({ls1["nummer"], ls3["nummer"]} <= kette)
