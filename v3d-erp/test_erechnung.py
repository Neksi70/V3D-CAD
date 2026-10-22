"""Tests E-Rechnung (XRechnung/ZUGFeRD erzeugen + einlesen): .venv/bin/python -m unittest test_erechnung -v
ZUGFeRD-Teile brauchen factur-x (.venv). Liegt der KoSIT-Prüfer unter ~/tools/kosit, wird zusätzlich offiziell validiert."""
import glob
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import erechnung  # noqa: E402
import erp  # noqa: E402

try:
    import facturx  # noqa: F401
    FX = True
except ImportError:
    FX = False

KOSIT = os.path.expanduser("~/tools/kosit")

FIRMA = dict(firma_name="Testbetrieb Sinterbearbeitung GmbH", strasse="Werkstraße 1", plz="58135", ort="Hagen", telefon="02331 000000",
             email="info@testbetrieb.example", ust_id="DE123456789", iban="DE02 1203 0000 0000 2020 51", bic="BYLADEM1001", bank_name="Testbank")

UBL = b"""<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
 xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
 xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
 <cbc:ID>UBL-4711</cbc:ID><cbc:IssueDate>2026-10-01</cbc:IssueDate><cbc:DueDate>2026-10-31</cbc:DueDate><cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
 <cac:OrderReference><cbc:ID>BE-26-0007</cbc:ID></cac:OrderReference>
 <cac:AccountingSupplierParty><cac:Party><cbc:EndpointID schemeID="EM">rechnung@stahl.example</cbc:EndpointID>
  <cac:PostalAddress><cbc:StreetName>Hafenweg 3</cbc:StreetName><cbc:CityName>Duisburg</cbc:CityName><cbc:PostalZone>47051</cbc:PostalZone><cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
  <cac:PartyTaxScheme><cbc:CompanyID>DE 987 654 321</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
  <cac:PartyLegalEntity><cbc:RegistrationName>Stahlhandel Beispiel GmbH</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
 <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">38.00</cbc:TaxAmount></cac:TaxTotal>
 <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">200.00</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="EUR">200.00</cbc:TaxExclusiveAmount>
  <cbc:TaxInclusiveAmount currencyID="EUR">238.00</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">238.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
 <cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="KGM">100</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">200.00</cbc:LineExtensionAmount>
  <cac:Item><cbc:Name>Rundstahl 42CrMo4</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent></cac:ClassifiedTaxCategory></cac:Item>
  <cac:Price><cbc:PriceAmount currencyID="EUR">2.00</cbc:PriceAmount></cac:Price></cac:InvoiceLine>
</Invoice>"""


class Basis(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.alt_dok = erp.DOK_ORDNER
        erp.DOK_ORDNER = os.path.join(self.tmp.name, "dok")
        self.db = erp.verbinden(os.path.join(self.tmp.name, "t.db"))
        erp.schema_anlegen(self.db)
        erp.einstellungen_speichern(self.db, FIRMA)
        zb = self.db.execute("SELECT id FROM zahlungsbedingung WHERE skonto_pct>0").fetchone()["id"]
        self.kunde = erp.adresse_speichern(self.db, dict(name1="Muster Antriebstechnik GmbH", strasse="Testweg 7", plz="44135", ort="Dortmund",
                                                         email="einkauf@muster.example", kunde=dict(zahlungsbed_id=zb)))
        self.art = erp.artikel_speichern(self.db, dict(artikelnr="300400", bezeichnung="Lagerdeckel bohren + Gewinde M8", vk_preis=0.62, lagerfuehrung=0))

    def tearDown(self):
        self.db.close()
        erp.DOK_ORDNER = self.alt_dok
        self.tmp.cleanup()

    def rechnung(self, verarbeiten=True, kunde=None):
        b = erp.beleg_speichern(self.db, dict(belegart="RE", adresse_id=(kunde or self.kunde)["id"], ihre_referenz="4500012345",
                                              positionen=[dict(artikel_id=self.art["id"], text=self.art["bezeichnung"], menge=2500, me="Stk", einzelpreis=0.62, charge_nr="SW-1"),
                                                          dict(text="Konstruktion", menge=1.5, me="Std", einzelpreis=95, rabatt_pct=10),
                                                          dict(text="Fachbuch", menge=1, me="Stk", einzelpreis=39.90, steuer_pct=7)]))
        return erp.beleg_verarbeiten(self.db, b["id"])["beleg"] if verarbeiten else b


class TestErzeugen(Basis):
    def test_xrechnung_summen_und_kopf(self):
        re_ = self.rechnung()
        xml, name = erechnung.xrechnung(self.db, re_["id"])
        self.assertTrue(name.startswith("XRechnung_RE-"))
        self.assertIn(erechnung.XRECHNUNG_ID.encode(), xml)
        r = erechnung.xml_auslesen(xml)
        self.assertEqual(r["nummer"], re_["nummer"])
        self.assertAlmostEqual(r["netto"], re_["netto"], places=2)
        self.assertAlmostEqual(r["brutto"], re_["brutto"], places=2)
        self.assertEqual(len(r["positionen"]), 3)
        self.assertEqual(r["verkaeufer"]["ust_id"], "DE123456789")
        self.assertIn(b"SW-1", xml)                     # Charge steht an der Position
        self.assertIn(b"#SKONTO#", xml)

    def test_gutschrift_verweist_auf_rechnung(self):
        re_ = self.rechnung()
        gs = erp.beleg_weiterverarbeiten(self.db, re_["id"], "GS")
        gs["positionen"] = gs["positionen"][1:2]
        gs = erp.beleg_verarbeiten(self.db, erp.beleg_speichern(self.db, gs)["id"])["beleg"]
        xml, _ = erechnung.xrechnung(self.db, gs["id"])
        self.assertIn(b"<ram:TypeCode>381</ram:TypeCode>", xml)
        self.assertIn(re_["nummer"].encode(), xml)

    def test_fehlende_angaben(self):
        ohne = erp.adresse_speichern(self.db, dict(name1="Ohne Mail AG", kunde=dict(zahlungsbed_id=1)))
        re_ = self.rechnung(kunde=ohne)
        with self.assertRaises(erp.Fehler) as f:
            erechnung.xrechnung(self.db, re_["id"])
        self.assertIn("E-Mail", str(f.exception))
        self.assertIn("Straße", str(f.exception))

    def test_entwurf_und_falsche_belegart(self):
        with self.assertRaises(erp.Fehler):
            erechnung.xrechnung(self.db, self.rechnung(verarbeiten=False)["id"])
        an = erp.beleg_speichern(self.db, dict(belegart="AN", adresse_id=self.kunde["id"], positionen=[dict(text="x", menge=1, einzelpreis=1)]))
        with self.assertRaises(erp.Fehler):
            erechnung.xrechnung(self.db, an["id"])

    def test_fehlende_firmendaten(self):
        erp.einstellungen_speichern(self.db, dict(iban=""))
        with self.assertRaises(erp.Fehler) as f:
            erechnung.xrechnung(self.db, self.rechnung()["id"])
        self.assertIn("IBAN", str(f.exception))

    @unittest.skipUnless(FX, "factur-x fehlt")
    def test_zugferd_pdf(self):
        from facturx import get_xml_from_pdf
        pdf, name = erechnung.zugferd(self.db, self.rechnung()["id"])
        self.assertTrue(pdf.startswith(b"%PDF-"))
        self.assertIn(b"/OutputIntents", pdf)
        _n, xml = get_xml_from_pdf(pdf, check_xsd=True)
        self.assertIn(b"<ram:ID>urn:cen.eu:en16931:2017</ram:ID>", xml)       # Factur-X-Profil EN 16931

    @unittest.skipUnless(os.path.exists(os.path.join(KOSIT, "validator.jar")), "KoSIT-Prüfer nicht installiert")
    def test_kosit(self):
        re_ = self.rechnung()
        xml, _ = erechnung.xrechnung(self.db, re_["id"])
        datei = os.path.join(self.tmp.name, "r.xml")
        with open(datei, "wb") as f:
            f.write(xml)
        aus = os.path.join(self.tmp.name, "bericht")
        os.makedirs(aus)
        jar = glob.glob(os.path.join(KOSIT, "validator*.jar"))[0]
        p = subprocess.run([os.path.join(KOSIT, "jre/bin/java"), "-jar", jar, "-s", os.path.join(KOSIT, "conf/scenarios.xml"), "-r", os.path.join(KOSIT, "conf"),
                            "-o", aus, "-h", datei], capture_output=True, text=True, timeout=180)
        self.assertIn("Acceptable", p.stdout + p.stderr, (p.stdout + p.stderr)[-2000:])


class TestEinlesen(Basis):
    def test_eigene_xrechnung_einlesen_und_doppelt(self):
        re_ = self.rechnung()
        xml, _ = erechnung.xrechnung(self.db, re_["id"])
        erg = erechnung.einlesen(self.db, "r.xml", xml)
        er = erg["beleg"]
        self.assertEqual(er["belegart"], "ER")
        self.assertEqual(er["status"], "entwurf")
        self.assertAlmostEqual(er["brutto"], re_["brutto"], places=2)
        self.assertEqual(er["ihre_referenz"], re_["nummer"])
        self.assertFalse([h for h in erg["hinweise"] if "weicht" in h])
        self.assertEqual(len(erp.dokumente_beleg(self.db, er["id"])) if hasattr(erp, "dokumente_beleg") else 1, 1)
        with self.assertRaises(erp.Fehler):
            erechnung.einlesen(self.db, "r.xml", xml)

    def test_ubl_legt_lieferant_an(self):
        erg = erechnung.einlesen(self.db, "ubl.xml", UBL)
        er = erg["beleg"]
        self.assertEqual(erg["daten"]["syntax"], "UBL")
        self.assertAlmostEqual(er["brutto"], 238.0, places=2)
        self.assertEqual(er["positionen"][0]["me"], "kg")
        lief = erp.adresse_lesen(self.db, er["adresse_id"])
        self.assertEqual(lief["name1"], "Stahlhandel Beispiel GmbH")
        # zweite Rechnung desselben Lieferanten → kein neuer Lieferant
        erg2 = erechnung.einlesen(self.db, "ubl2.xml", UBL.replace(b"UBL-4711", b"UBL-4712"))
        self.assertEqual(erg2["beleg"]["adresse_id"], er["adresse_id"])

    @unittest.skipUnless(FX, "factur-x fehlt")
    def test_zugferd_einlesen(self):
        re_ = self.rechnung()
        pdf, _ = erechnung.zugferd(self.db, re_["id"])
        erg = erechnung.einlesen(self.db, "r.pdf", pdf)
        self.assertEqual(erg["daten"]["syntax"], "CII")
        self.assertAlmostEqual(erg["beleg"]["brutto"], re_["brutto"], places=2)

    def test_muell(self):
        with self.assertRaises(erp.Fehler):
            erechnung.einlesen(self.db, "x.xml", b"<kaputt")
        with self.assertRaises(erp.Fehler):
            erechnung.einlesen(self.db, "x.xml", b"<foo/>")


if __name__ == "__main__":
    unittest.main()
