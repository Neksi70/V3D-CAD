"""Tests DATEV-Export, Liquiditätsplanung, Umsatzauswertung, Inventur, Arbeitsplan:
.venv/bin/python -m unittest test_auswertung -v"""
import datetime as dt
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import auswertung  # noqa: E402
import datev  # noqa: E402
import erp  # noqa: E402
import inventur  # noqa: E402
import produktion  # noqa: E402


class Basis(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = erp.verbinden(os.path.join(self.tmp.name, "t.db"))
        erp.schema_anlegen(self.db)
        self.kunde = erp.adresse_speichern(self.db, dict(name1="Kunde Inland GmbH", kunde={}))
        self.eu = erp.adresse_speichern(self.db, dict(name1="Kunde Wien GmbH", land="AT", ust_id="ATU12345678", kunde=dict(steuerfall="eu_leistung")))
        self.lief = erp.adresse_speichern(self.db, dict(name1="Stahl Lieferant", lieferant={}))
        self.art = erp.artikel_speichern(self.db, dict(bezeichnung="Schraube M8", gruppe="Normteile", vk_preis=1, ek_preis=0.4, lagerfuehrung=1))

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def beleg(self, art, adr, pos, datum=None, **kw):
        b = erp.beleg_speichern(self.db, dict(belegart=art, adresse_id=adr["id"], datum=datum or erp.heute(), positionen=pos, **kw))
        return erp.beleg_verarbeiten(self.db, b["id"])["beleg"]


class TestDatev(Basis):
    def test_buchungen_und_export(self):
        erp.einstellungen_speichern(self.db, dict(datev_berater="1234567", datev_mandant="10001"))
        h = erp.heute()
        re1 = self.beleg("RE", self.kunde, [dict(text="Bohren", menge=10, einzelpreis=10), dict(text="Buch", menge=1, einzelpreis=20, steuer_pct=7)], h)
        re2 = self.beleg("RE", self.eu, [dict(text="Fräsen", menge=1, einzelpreis=500)], h)
        gs = erp.beleg_weiterverarbeiten(self.db, re1["id"], "GS")
        gs = erp.beleg_verarbeiten(self.db, gs["id"])["beleg"]
        er = self.beleg("ER", self.lief, [dict(text="Material", menge=1, einzelpreis=100)], h, ihre_referenz="L-4711")
        v = datev.vorschau(self.db, h, h)
        self.assertEqual(v["fehler"], [])
        z = {(r["beleg_id"], r["gegenkonto"]): r for r in v["zeilen"]}
        self.assertEqual(z[(re1["id"], "8400")]["umsatz"], 119.0)
        self.assertEqual(z[(re1["id"], "8400")]["sh"], "S")
        self.assertEqual(z[(re1["id"], "8300")]["umsatz"], 21.4)
        self.assertEqual(z[(re2["id"], "8336")]["umsatz"], 500.0, "Reverse Charge: netto = brutto")
        self.assertEqual(z[(gs["id"], "8400")]["sh"], "H")
        self.assertEqual(z[(er["id"], "3400")]["sh"], "H")
        self.assertEqual(z[(er["id"], "3400")]["konto"], self.lief["lieferant"]["lieferantennr"])
        self.assertEqual(z[(er["id"], "3400")]["belegfeld1"], "L-4711")
        daten, name = datev.export(self.db, h, h)
        text = daten.decode("cp1252").splitlines()
        self.assertTrue(text[0].startswith('"EXTF";700;21;"Buchungsstapel"'))
        self.assertIn('"Umsatz (ohne Soll/Haben-Kz)"', text[1])
        self.assertEqual(len(text), 2 + len(v["zeilen"]))
        self.assertIn('119,00;"S";"EUR"', "\n".join(text))
        self.assertIn("schon exportiert", datev.vorschau(self.db, h, h)["hinweise"][0])
        self.assertEqual(len(datev.exporte(self.db)), 1)

    def test_ohne_beraternummer_und_falsche_kundennummer(self):
        k = erp.adresse_speichern(self.db, dict(name1="Altkunde", kunde=dict(kundennr="K0815")))
        self.beleg("RE", k, [dict(text="x", menge=1, einzelpreis=10)])
        v = datev.vorschau(self.db, erp.heute(), erp.heute())
        self.assertTrue(any("Berater" in f for f in v["fehler"]))
        self.assertTrue(any("K0815" in f for f in v["fehler"]))
        with self.assertRaises(erp.Fehler):
            datev.export(self.db, erp.heute(), erp.heute())

    def test_skr04_und_eigene_konten(self):
        e = datev.einstellungen_speichern(self.db, dict(berater="1", mandant="2", kontenrahmen="SKR04", konten={"erloes_19": "4401", "aufwand_19": "5400"}))
        k = {x["schluessel"]: x["konto"] for x in e["konten"]}
        self.assertEqual(k["erloes_19"], "4401")
        self.assertEqual(k["eu_lieferung"], "4125")
        with self.assertRaises(erp.Fehler):
            datev.einstellungen_speichern(self.db, dict(berater="1", mandant="2", konten={"erloes_19": "84a"}))


class TestLiquiditaet(Basis):
    def test_wochen(self):
        heute = dt.date.today()
        montag = heute - dt.timedelta(days=heute.weekday())
        auswertung.kontostand_speichern(self.db, 1000, heute.isoformat())
        re_ = self.beleg("RE", self.kunde, [dict(text="x", menge=1, einzelpreis=100)], (heute - dt.timedelta(days=60)).isoformat())   # überfällig
        self.beleg("ER", self.lief, [dict(text="y", menge=1, einzelpreis=50)], heute.isoformat())
        auswertung.liq_posten_speichern(self.db, [dict(text="Miete", betrag=-800, rhythmus="monatlich", erster=heute.isoformat())])
        l = auswertung.liquiditaet(self.db, wochen=13)
        self.assertEqual(l["kontostand"], 1000)
        self.assertEqual(l["wochen"][0]["von"], montag.isoformat())
        self.assertEqual(l["wochen"][0]["ein"], 119.0, "überfällige Forderung in Woche 1")
        self.assertEqual(l["ueberfaellig"]["anzahl"], 1)
        self.assertAlmostEqual(sum(w["aus"] for w in l["wochen"]), -59.5 - 800 * sum(1 for i in range(4) if auswertung._plus_monate(heute, i) <= montag + dt.timedelta(weeks=13, days=-1)), 2)
        self.assertEqual(l["wochen"][-1]["stand"], round(1000 + sum(w["saldo"] for w in l["wochen"]), 2))
        ohne = auswertung.liquiditaet(self.db, wochen=13, ueberfaellige="aus")
        self.assertEqual(ohne["wochen"][0]["ein"], 0)
        erp.zahlung_buchen(self.db, self.db.execute("SELECT id FROM offener_posten WHERE beleg_id=?", (re_["id"],)).fetchone()["id"], 119)
        self.assertEqual(auswertung.liquiditaet(self.db)["ueberfaellig"]["anzahl"], 0)

    def test_termine(self):
        p = dict(erster="2026-01-31", letzter=None, rhythmus="monatlich")
        t = auswertung._termine(p, dt.date(2026, 1, 1), dt.date(2026, 4, 30))
        self.assertEqual([x.isoformat() for x in t], ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"])
        p = dict(erster="2026-01-05", letzter="2026-01-20", rhythmus="woechentlich")
        self.assertEqual(len(auswertung._termine(p, dt.date(2026, 1, 1), dt.date(2026, 12, 31))), 3)
        with self.assertRaises(erp.Fehler):
            auswertung.liq_posten_speichern(self.db, [dict(text="x", betrag=1, rhythmus="taeglich", erster="2026-01-01")])


class TestUmsatz(Basis):
    def test_jahr_vorjahr(self):
        j = dt.date.today().year
        self.beleg("RE", self.kunde, [dict(artikel_id=self.art["id"], text="M8", menge=100, einzelpreis=1)], f"{j}-01-15")
        self.beleg("RE", self.kunde, [dict(text="frei", menge=1, einzelpreis=50)], f"{j - 1}-01-10")
        u = auswertung.umsatz(self.db, j)
        self.assertEqual(u["summe_jahr"], 100)
        self.assertEqual(u["summe_vorjahr"], 50)
        self.assertEqual(u["monate"][0]["jahr"], 100)
        g = {x["name"]: x for x in u["gruppen"]}
        self.assertEqual(g["Normteile"]["jahr"], 100)
        self.assertEqual(g["ohne Gruppe"]["vorjahr"], 50)
        self.assertEqual(u["kunden"][0]["diff_pct"], 100.0)
        self.assertEqual(u["artikel"][0]["artikelnr"], self.art["artikelnr"])


class TestInventur(Basis):
    def test_ablauf(self):
        self.beleg("WE", self.lief, [dict(artikel_id=self.art["id"], text="M8", menge=100, einzelpreis=0.4)])
        art2 = erp.artikel_speichern(self.db, dict(bezeichnung="Mutter M8", vk_preis=1, ek_preis=0.2, lagerfuehrung=1))
        i = inventur.eroeffnen(self.db, "Jahresinventur")
        self.assertEqual(i["summen"]["positionen"], 2)
        with self.assertRaisesRegex(erp.Fehler, "offene Inventur"):
            inventur.eroeffnen(self.db, "zweite")
        p = {x["artikel_id"]: x for x in i["positionen"]}
        self.assertEqual(p[self.art["id"]]["soll"], 100)
        # Bewegung nach Eröffnung bleibt erhalten
        self.beleg("LS", self.kunde, [dict(artikel_id=self.art["id"], text="M8", menge=10, einzelpreis=1)])
        i = inventur.zaehlen(self.db, i["id"], [dict(id=p[self.art["id"]]["id"], ist=97)])
        self.assertEqual(i["summen"]["differenzen"], 1)
        self.assertAlmostEqual(i["summen"]["wert_differenz"], -1.2)
        with self.assertRaisesRegex(erp.Fehler, "nicht gezählt"):
            inventur.abschliessen(self.db, i["id"], "stopp")
        i = inventur.abschliessen(self.db, i["id"])
        self.assertEqual(i["gebucht"], 1)
        self.assertEqual(erp.bestand(self.db, self.art["id"]), 87)
        self.assertEqual(erp.bestand(self.db, art2["id"]), 0)
        with self.assertRaises(erp.Fehler):
            inventur.zaehlen(self.db, i["id"], [dict(id=p[self.art["id"]]["id"], ist=1)])

    def test_abbrechen_und_eingaben(self):
        i = inventur.eroeffnen(self.db, "", gruppe="Normteile")
        self.assertEqual(i["summen"]["positionen"], 1)
        with self.assertRaises(erp.Fehler):
            inventur.zaehlen(self.db, i["id"], [dict(id=i["positionen"][0]["id"], ist=-1)])
        inventur.abbrechen(self.db, i["id"])
        self.assertEqual(erp.bestand(self.db, self.art["id"]), 0)
        inventur.eroeffnen(self.db, "neu")                     # nach Abbruch wieder möglich


class TestArbeitsplan(Basis):
    def test_alt_und_neu(self):
        self.assertEqual([x["text"] for x in erp.arbeitsplan("Bohren; Gewinde schneiden")], ["Bohren", "Gewinde schneiden"])
        a = erp.artikel_speichern(self.db, dict(bezeichnung="Ventilgehäuse", arbeitsplan=[
            dict(nr="AG000001", text="Wareneingangsprüfung", pruef=True), dict(nr="AG000019", text="Nut fräsen", toleranz="12 mm ±0,1"), dict(text="")]))
        self.assertEqual(len(a["arbeitsplan_liste"]), 2)
        self.assertEqual(erp.arbeitsplan_zeile(a["arbeitsplan_liste"][1]), "AG000019 Nut fräsen – 12 mm ±0,1")
        self.assertEqual(erp.arbeitsplan_zeile(a["arbeitsplan_liste"][0]), "AG000001 Wareneingangsprüfung (Prüfschritt)")
        self.assertEqual(produktion.arbeitsgaenge(self.db, a["id"]), ["Wareneingangsprüfung", "Nut fräsen"])
        a2 = erp.artikel_speichern(self.db, dict(bezeichnung="alt", arbeitsplan="Bohren"))
        self.assertEqual(produktion.arbeitsgaenge(self.db, a2["id"]), ["Bohren"])

    def test_druck(self):
        import bericht
        a = erp.artikel_speichern(self.db, dict(bezeichnung="Ventilgehäuse", vk_preis=1, lagerfuehrung=0,
                                                arbeitsplan=[dict(nr="AG000019", text="Nut fräsen", toleranz="12 mm ±0,1")]))
        b = erp.beleg_speichern(self.db, dict(belegart="AB", adresse_id=self.kunde["id"], positionen=[dict(artikel_id=a["id"], menge=10, einzelpreis=1)]))
        ohne, _ = bericht.beleg_pdf(self.db, b["id"])
        mit, _ = bericht.beleg_pdf(self.db, b["id"], fo=erp.formular(self.db, "AB", {"bloecke": {"arbeitsplan": True}}))
        self.assertGreater(len(mit), len(ohne))


if __name__ == "__main__":
    unittest.main()
