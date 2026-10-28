"""Tests Mahnwesen, Zahlungsabgleich, Kundenpreise, Kennzeichen, Diagramme: python3 -m unittest test_finanzen -v"""
import datetime as dt
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bericht  # noqa: E402
import erp  # noqa: E402
import finanzen  # noqa: E402
import zusatz  # noqa: E402


def d(n):
    return (dt.date.today() + dt.timedelta(days=n)).isoformat()


class Basis(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = erp.verbinden(os.path.join(self.tmp.name, "t.db"))
        erp.schema_anlegen(self.db)
        zb = self.db.execute("SELECT id FROM zahlungsbedingung WHERE skonto_pct>0").fetchone()["id"]
        self.kunde = erp.adresse_speichern(self.db, dict(name1="Muster Antriebstechnik GmbH", strasse="Testweg 7", plz="44135", ort="Dortmund", kunde=dict(zahlungsbed_id=zb, rabatt_pct=3)))
        self.k2 = erp.adresse_speichern(self.db, dict(name1="Beispielwerk Nord AG", kunde=dict(zahlungsbed_id=1)))
        self.lief = erp.adresse_speichern(self.db, dict(name1="Stahlhandel Muster", lieferant=dict(zahlungsbed_id=1)))
        self.art = erp.artikel_speichern(self.db, dict(bezeichnung="Lagerdeckel bearbeiten", vk_preis=0.80, gruppe="Lohnbearbeitung"))

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def rechnung(self, kunde, betrag, datum, zb=None):
        b = erp.beleg_speichern(self.db, dict(belegart="RE", adresse_id=kunde["id"], datum=datum, zahlungsbed_id=zb,
                                              positionen=[dict(text="Leistung", menge=1, einzelpreis=betrag)]))
        return erp.beleg_verarbeiten(self.db, b["id"])["beleg"]


class TestMahnwesen(Basis):
    def test_stufen_nacheinander(self):
        re1 = self.rechnung(self.k2, 100, d(-40), 1)           # 14 Tage netto → 26 Tage überfällig
        self.rechnung(self.k2, 50, d(-10), 1)                  # erst fällig in 4 Tagen → nicht mahnen
        v = finanzen.mahnvorschlag(self.db)
        self.assertEqual(len(v), 1)
        self.assertEqual([p["nummer"] for p in v[0]["posten"]], [re1["nummer"]])
        self.assertEqual(v[0]["stufe_name"], "Zahlungserinnerung")
        m = finanzen.mahnungen_erstellen(self.db, [self.k2["id"]])[0]
        self.assertRegex(m["nummer"], r"^MA-\d\d-0001$")
        self.assertEqual(m["summe"], 119.0)
        self.assertEqual(finanzen.mahnvorschlag(self.db), [])   # gleich danach nicht nochmal
        # 14 Tage später → 1. Mahnung mit Gebühr
        v = finanzen.mahnvorschlag(self.db, d(14))
        self.assertEqual((v[0]["stufe_name"], v[0]["gebuehr"]), ("1. Mahnung", 5.0))
        m2 = finanzen.mahnungen_erstellen(self.db, [self.k2["id"]], d(14))[0]
        self.assertEqual(len(m2["posten"]), 2)                 # zweite Rechnung ist inzwischen auch überfällig
        self.assertEqual(m2["summe"], round(119 + 59.5 + 5, 2))
        pdf, name = bericht.mahnung_pdf(self.db, m2["id"])
        self.assertTrue(pdf.startswith(b"%PDF") and name.startswith("MA-"))

    def test_mahnsperre_und_bezahlt(self):
        r = self.rechnung(self.k2, 100, d(-40), 1)
        op = erp.op_liste(self.db)[0]
        finanzen.mahnsperre(self.db, op["id"], True)
        self.assertEqual(finanzen.mahnvorschlag(self.db), [])
        finanzen.mahnsperre(self.db, op["id"], False)
        erp.zahlung_buchen(self.db, op["id"], op["offen"])
        self.assertEqual(finanzen.mahnvorschlag(self.db), [])


SPARKASSE = '''"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"
"DE00";"{tag}";"{tag}";"GUTSCHR. UEBERWEISUNG";"Rechnung {nr1} danke";"MUSTER ANTRIEBSTECHNIK";"DE11";"X";"{b1}";"EUR";"Umsatz gebucht"
"DE00";"{tag}";"{tag}";"GUTSCHR. UEBERWEISUNG";"Zahlung";"Beispielwerk Nord";"DE22";"X";"{b2}";"EUR";"Umsatz gebucht"
"DE00";"{tag}";"{tag}";"LASTSCHRIFT";"Strom";"STADTWERKE";"DE33";"X";"-312,00";"EUR";"Umsatz gebucht"
'''


class TestKontoauszug(Basis):
    def test_csv_import_vorschlag_und_zuordnung(self):
        r1 = self.rechnung(self.kunde, 1000, d(-5))         # 10 Tage 2 % Skonto → Kunde zahlt 1.166,20 statt 1.190
        r2 = self.rechnung(self.k2, 200, d(-20), 1)
        tag = dt.date.today().strftime("%d.%m.%y")
        csv_ = SPARKASSE.format(tag=tag, nr1=r1["nummer"].replace("-", ""), b1="1.166,20", b2="238,00").encode("cp1252")
        erg = finanzen.kontoauszug_importieren(self.db, "auszug.csv", csv_)
        self.assertEqual((erg["format"], erg["neu"]), ("CSV", 3))
        self.assertEqual(finanzen.kontoauszug_importieren(self.db, "auszug.csv", csv_)["doppelt"], 3)   # kein Doppelimport
        u = {x["name"]: x for x in finanzen.umsaetze(self.db)}
        v1 = u["MUSTER ANTRIEBSTECHNIK"]["vorschlaege"][0]
        self.assertEqual(v1["nummer"], r1["nummer"])
        self.assertTrue(v1["sicher"])
        self.assertAlmostEqual(v1["skonto"], 23.80)
        v2 = u["Beispielwerk Nord"]["vorschlaege"][0]
        self.assertEqual(v2["nummer"], r2["nummer"])                      # Betrag + Name
        self.assertEqual(u["STADTWERKE"]["vorschlaege"], [])
        self.assertEqual(finanzen.alle_sicheren_zuordnen(self.db)["zugeordnet"], 2)
        self.assertEqual(erp.op_liste(self.db), [])                       # beide ausgeglichen (inkl. Skonto)
        # rückgängig
        z = [x for x in finanzen.umsaetze(self.db, "zugeordnet") if x["name"] == "Beispielwerk Nord"][0]
        finanzen.ignorieren(self.db, z["id"], zurueck=True)
        self.assertEqual(erp.op_liste(self.db)[0]["offen"], 238.0)

    def test_camt053(self):
        r = self.rechnung(self.k2, 100, d(-3), 1)
        xml = f'''<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
          <Ntry><Amt Ccy="EUR">119.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>{d(0)}</Dt></BookgDt>
            <NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Beispielwerk Nord AG</Nm></Dbtr><DbtrAcct><Id><IBAN>DE99</IBAN></Id></DbtrAcct></RltdPties>
            <RmtInf><Ustrd>{r["nummer"]}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
          <Ntry><Amt Ccy="EUR">50.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>{d(0)}</Dt></BookgDt></Ntry>
        </Stmt></BkToCstmrStmt></Document>'''.encode()
        erg = finanzen.kontoauszug_importieren(self.db, "camt.xml", xml)
        self.assertEqual((erg["format"], erg["neu"]), ("CAMT.053", 2))
        u = [x for x in finanzen.umsaetze(self.db) if x["betrag"] > 0][0]
        self.assertEqual((u["name"], u["iban"], u["vorschlaege"][0]["nummer"]), ("Beispielwerk Nord AG", "DE99", r["nummer"]))

    def test_ausgang_an_lieferant_und_falsche_richtung(self):
        be = erp.beleg_speichern(self.db, dict(belegart="ER", adresse_id=self.lief["id"], positionen=[dict(text="Stahl", menge=1, einzelpreis=100)]))
        erp.beleg_verarbeiten(self.db, be["id"])
        self.rechnung(self.k2, 100, d(-3), 1)
        csv_ = f'Buchungstag;Verwendungszweck;Name;Betrag\n{dt.date.today():%d.%m.%Y};Rg Stahl;Stahlhandel Muster;-119,00\n'.encode()
        finanzen.kontoauszug_importieren(self.db, "a.csv", csv_)
        u = finanzen.umsaetze(self.db)[0]
        self.assertEqual(u["vorschlaege"][0]["kurz"], "STAHLHANDEL MUSTER")
        deb = erp.op_liste(self.db, "debitor")[0]
        with self.assertRaises(erp.Fehler):
            finanzen.zuordnen(self.db, u["id"], deb["id"])

    def test_unbekanntes_format(self):
        with self.assertRaises(erp.Fehler):
            finanzen.kontoauszug_importieren(self.db, "x.csv", b"foo;bar\n1;2\n")

    def test_beispieldatei_passt(self):
        self.rechnung(self.k2, 100, d(-3), 1)
        erg = finanzen.kontoauszug_importieren(self.db, "beispiel.csv", finanzen.beispiel_kontoauszug(self.db))
        self.assertGreaterEqual(erg["neu"], 3)
        self.assertGreaterEqual(finanzen.alle_sicheren_zuordnen(self.db)["zugeordnet"], 1)


class TestKundenpreise(Basis):
    def test_staffel_gueltigkeit_vorrang(self):
        k, a = self.kunde["id"], self.art["id"]
        self.assertEqual(zusatz.preis_finden(self.db, k, a, 100), dict(preis=0.80, rabatt_pct=3, quelle="Listenpreis"))
        zusatz.kundenpreis_speichern(self.db, dict(adresse_id=k, artikel_id=a, ab_menge=1, preis=0.70))
        zusatz.kundenpreis_speichern(self.db, dict(adresse_id=k, artikel_id=a, ab_menge=5000, preis=0.62))
        zusatz.kundenpreis_speichern(self.db, dict(adresse_id=k, artikel_id=a, ab_menge=1, preis=0.50, gueltig_ab=d(30)))   # erst künftig
        self.assertEqual(zusatz.preis_finden(self.db, k, a, 100)["preis"], 0.70)
        self.assertEqual(zusatz.preis_finden(self.db, k, a, 5000)["preis"], 0.62)
        self.assertEqual(zusatz.preis_finden(self.db, k, a, 100)["rabatt_pct"], 0)       # Kundenpreis = netto, kein Zusatzrabatt
        self.assertEqual(zusatz.preis_finden(self.db, self.k2["id"], a, 100)["preis"], 0.80)
        self.assertEqual(len(zusatz.kundenpreise(self.db, adresse_id=k)), 3)
        with self.assertRaises(erp.Fehler):
            zusatz.kundenpreis_speichern(self.db, dict(adresse_id=k, artikel_id=a, preis=-1))


class TestKennzeichen(Basis):
    def test_definieren_fuellen_filtern(self):
        defs = zusatz.kz_defs_speichern(self.db, "adresse", [dict(name="IATF-zertifiziert", typ="janein"),
                                                              dict(name="Branche", typ="auswahl", optionen="Automobil; Maschinenbau"),
                                                              dict(name="Erstkontakt", typ="datum")])
        ids = {x["name"]: x["id"] for x in defs}
        zusatz.kz_werte_speichern(self.db, "adresse", self.kunde["id"], {ids["IATF-zertifiziert"]: "ja", ids["Branche"]: "Automobil", ids["Erstkontakt"]: "2026-03-01"})
        w = {x["name"]: x["wert"] for x in zusatz.kz_werte(self.db, "adresse", self.kunde["id"])}
        self.assertEqual(w, {"IATF-zertifiziert": "1", "Branche": "Automobil", "Erstkontakt": "2026-03-01"})
        self.assertEqual(zusatz.kz_filter(self.db, "adresse", ids["Branche"], "Automobil"), [self.kunde["id"]])
        self.assertIn(self.k2["id"], zusatz.kz_filter(self.db, "adresse", ids["IATF-zertifiziert"], "0"))
        with self.assertRaises(erp.Fehler):
            zusatz.kz_werte_speichern(self.db, "adresse", self.kunde["id"], {ids["Branche"]: "Bäckerei"})
        with self.assertRaises(erp.Fehler):
            zusatz.kz_defs_speichern(self.db, "adresse", [dict(name="A"), dict(name="a")])
        # Feld entfernen löscht seine Werte
        zusatz.kz_defs_speichern(self.db, "adresse", [dict(id=ids["Branche"], name="Branche", typ="auswahl", optionen="Automobil; Maschinenbau")])
        self.assertEqual([x["name"] for x in zusatz.kz_werte(self.db, "adresse", self.kunde["id"])], ["Branche"])


class TestDiagramme(Basis):
    def test_umsatz_und_auftragsbestand(self):
        self.rechnung(self.k2, 100, d(0), 1)
        ab = erp.beleg_speichern(self.db, dict(belegart="AB", adresse_id=self.kunde["id"], positionen=[dict(artikel_id=self.art["id"], menge=1000, einzelpreis=0.70)]))
        ab = erp.beleg_verarbeiten(self.db, ab["id"])["beleg"]
        ls = erp.beleg_weiterverarbeiten(self.db, ab["id"], "LS")
        ls["positionen"][1]["menge"] = 400
        erp.beleg_verarbeiten(self.db, erp.beleg_speichern(self.db, ls)["id"])
        dg = erp.diagrammdaten(self.db)
        self.assertEqual(len(dg["umsatz_monate"]), 12)
        self.assertEqual(dg["umsatz_monate"][-1]["netto"], 100)
        self.assertAlmostEqual(dg["auftragsbestand_summe"], 600 * 0.70, places=2)
        self.assertEqual(dg["top_kunden"][0]["netto"], 100)


if __name__ == "__main__":
    unittest.main()
