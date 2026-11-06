"""Tests für den myfactory-Import mit ERFUNDENEN Daten: python3 -m unittest test_import -v"""
import os
import sys
import tempfile
import unittest
import zipfile
from xml.sax.saxutils import escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import erp  # noqa: E402
import import_myfactory as im  # noqa: E402


def xlsx_schreiben(pfad, zeilen):
    """Minimales XLSX (inline strings) – genügt, um den Leser zu testen."""
    def zelle(r, c, v):
        ref = chr(65 + c) + str(r)
        if isinstance(v, (int, float)):
            return f'<c r="{ref}"><v>{v}</v></c>'
        return f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(v))}</t></is></c>'
    rows = "".join(f'<row r="{r}">' + "".join(zelle(r, c, v) for c, v in enumerate(z) if v != "") + "</row>" for r, z in enumerate(zeilen, 1))
    with zipfile.ZipFile(pfad, "w") as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("xl/worksheets/sheet1.xml", f'<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{rows}</sheetData></worksheet>')


class TestImport(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = erp.verbinden(os.path.join(self.tmp.name, "t.db"))
        erp.schema_anlegen(self.db)
        self.log = []

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def datei(self, name, inhalt, kodierung="cp1252"):
        p = os.path.join(self.tmp.name, name)
        with open(p, "w", encoding=kodierung, newline="") as f:
            f.write(inhalt)
        return p

    def imp(self, art, pfad, aus=True):
        return im.importieren(self.db, art, pfad, aus, self.log.append)

    def test_kunden_csv_cp1252_probelauf_und_ausfuehren(self):
        p = self.datei("kunden.csv",
                       "Kundennummer;Adressnummer;Kurzbezeichnung;Name;Straße;PLZ;Ort;Land;E-Mail;Zahlungskonditionen;Rabatt(%);Sonderfeld\n"
                       "10001;20001;TESTA;Testfirma Ä GmbH;Weg 1;12345;Örtchen;Deutschland;a@test.example;10 Tage 2 %, 30 Tage netto;3,5;x\n"
                       "10002;20002;TESTB;Testfirma B;;;;AT;;30 Tage netto;;\n"
                       ";;;;;;;;;;;\n"
                       "10003;;;;;;;;;;;\n")
        st = self.imp("kunden", p, aus=False)
        self.assertEqual(st["neu"], 2)
        self.assertEqual(self.db.execute("SELECT COUNT(*) c FROM kunde").fetchone()["c"], 0)   # Probelauf speichert nichts
        st = self.imp("kunden", p)
        self.assertEqual((st["neu"], st["fehler"]), (2, 1))
        a = erp.adresse_lesen(self.db, self.db.execute("SELECT adresse_id FROM kunde WHERE kundennr='10001'").fetchone()["adresse_id"])
        self.assertEqual(a["name1"], "Testfirma Ä GmbH")
        self.assertEqual(a["land"], "DE")
        self.assertEqual(a["kunde"]["rabatt_pct"], 3.5)
        zb = self.db.execute("SELECT * FROM zahlungsbedingung WHERE id=?", (a["kunde"]["zahlungsbed_id"],)).fetchone()
        self.assertEqual((zb["tage_netto"], zb["skonto_tage"], zb["skonto_pct"]), (30, 10, 2.0))
        self.assertIn("Sonderfeld", " ".join(self.log))
        # Protokoll enthält keine Inhalte
        self.assertNotIn("Testfirma", " ".join(self.log))
        self.assertNotIn("a@test.example", " ".join(self.log))
        # zweiter Lauf aktualisiert statt doppelt anzulegen
        st = self.imp("kunden", p)
        self.assertEqual(st["aktualisiert"], 2)

    def test_kunde_und_lieferant_selbe_adresse(self):
        self.imp("kunden", self.datei("k.csv", "Kundennummer;Adressnummer;Name\n10001;555;Doppelrolle GmbH\n"))
        self.imp("lieferanten", self.datei("l.csv", "Lieferantennummer;Adressnummer;Name\n70001;555;Doppelrolle GmbH\n"))
        self.assertEqual(self.db.execute("SELECT COUNT(*) c FROM adresse").fetchone()["c"], 1)
        a = erp.adressen_liste(self.db)[0]
        self.assertEqual((a["kundennr"], a["lieferantennr"]), ("10001", "70001"))

    def test_artikel_xlsx_mit_bestand(self):
        p = os.path.join(self.tmp.name, "artikel.xlsx")
        xlsx_schreiben(p, [["Artikelliste (Export)"], [],
                           ["Artikelnummer", "Kurzbezeichnung", "Bezeichnung", "Basismengeneinheit (BME)", "Artikelgruppe", "VK-Preis", "Letzter EK", "Gesamtlagerbestand"],
                           ["A-1", "PLATTE", "Platte 10 mm", "Stk", "Bleche", 12.5, "4,20", 30],
                           ["A-2", "", "Schraube M8", "Stk", "", "0,35", "", ""]])
        st = self.imp("artikel", p)
        self.assertEqual(st["neu"], 2)
        a = erp.artikel_lesen(self.db, self.db.execute("SELECT id FROM artikel WHERE artikelnr='A-1'").fetchone()["id"])
        self.assertEqual((a["vk_preis"], a["ek_preis"], a["bestand"]), (12.5, 4.2, 30))
        # erneuter Import mit anderem Bestand → Korrekturbuchung, kein doppelter Bestand
        xlsx_schreiben(p, [["Artikelnummer", "Bezeichnung", "Gesamtlagerbestand"], ["A-1", "Platte 10 mm", 25]])
        self.imp("artikel", p)
        self.assertEqual(erp.bestand(self.db, a["id"]), 25)

    def test_offene_posten(self):
        self.imp("kunden", self.datei("k.csv", "Kundennummer;Name\n10001;OP Kunde\n"))
        p = self.datei("op.csv", "Belegnummer;Kundennummer;Belegdatum;Fälligkeit;Betrag;Offen\n"
                                 "RE-2026-0815;10001;01.09.2026;01.10.2026;1.190,00;590,00\n"
                                 "RE-2026-0816;99999;01.09.2026;01.10.2026;100,00;100,00\n")
        st = self.imp("op-kunden", p)
        self.assertEqual((st["neu"], st["fehler"]), (1, 1))
        op = erp.op_liste(self.db, "debitor")
        self.assertEqual((op[0]["betrag"], op[0]["offen"], op[0]["faellig"]), (1190.0, 590.0, "2026-10-01"))
        self.assertIn("unbekannt", " ".join(self.log))

    def test_pflichtspalte_fehlt(self):
        with self.assertRaises(erp.Fehler):
            self.imp("kunden", self.datei("x.csv", "Name;Ort\nA;B\n"))

    def test_artikel_bericht_utf16_wie_myfactory(self):
        """Artikelbericht aus myfactory: UTF-16, „sep=;“, Kurzbezeichnung statt Bezeichnung, Artikeltyp, Steuerklasse, ein einzelnes \"."""
        lang = "Musterring verlesen und verpacken mit sehr langer Kurzbezeichnung"
        p = self.datei("report.csv",
                       "sep=;\r\n"
                       "Artikelnr.;Kurzbezeichnung;Artikeltyp;Artikelgruppe;BME;Steuerklasse;Preiseinheit;Hauptlager;Lagerbestand;Interner Wert;VME\r\n"
                       "M-100;Musterbuchse Ø10 honen;Stückliste;Honen;Stk;1;1,00;Standardlager;0,00;0,00;\r\n"
                       "RM-100;Musterbuchse Ø10 honen (Rohmaterial);Rohstoff;Honen;Stk;1;1,00;Standardlager;12.345,00;0,00;\r\n"
                       "E-1;Musterbohrer 5 mm;Eigenbedarf;Allgemein;Stk;1;1,00;Standardlager;5,00;19,90;\r\n"
                       "M-200;\"" + lang + "; 10% prüfen\";Stückliste;Verlesen;Stk;1;1,00;Standardlager;0,00;0,00;\r\n"
                       "WN 1;\"Musterwerkzeug 2,5 Linksdrall;Handelsartikel;Allgemein;Stk;1;1,00;Standardlager;0,00;0,00;\r\n"
                       "D-1;Konstruktion;Dienstleistung;Allgemein;Stk;1;1,00;Standardlager;0,00;0,00;\r\n", "utf-16")
        st = self.imp("artikel", p)
        self.assertEqual((st["neu"], st["fehler"]), (6, 0), self.log)
        a = lambda nr: erp.artikel_lesen(self.db, self.db.execute("SELECT id FROM artikel WHERE artikelnr=?", (nr,)).fetchone()["id"])
        lohn, roh, eigen, hub, wn, dl = a("M-100"), a("RM-100"), a("E-1"), a("M-200"), a("WN 1"), a("D-1")
        self.assertEqual((lohn["lagerfuehrung"], lohn["steuer_pct"], lohn["gruppe"]), (0, 19, "Honen"))
        self.assertEqual([x["text"] for x in lohn["arbeitsplan_liste"]], ["Honen"])            # Artikelgruppe = Arbeitsgang
        self.assertEqual((roh["lagerfuehrung"], roh["bestand"]), (0, 0))                        # Kundenmaterial nicht ins eigene Lager
        self.assertIn("12.345", roh["memo"])
        self.assertEqual(roh["arbeitsplan_liste"], [])
        self.assertEqual((eigen["lagerfuehrung"], eigen["bestand"], eigen["ek_preis"]), (1, 5, 19.9))
        self.assertEqual(eigen["arbeitsplan_liste"], [])                                         # „Allgemein“ ist kein Arbeitsgang
        self.assertEqual(hub["bezeichnung"], lang + "; 10% prüfen")
        self.assertEqual(len(hub["kurz"]), 30)
        self.assertEqual(wn["bezeichnung"], "Musterwerkzeug 2,5 Linksdrall")                      # einzelnes \" entfernt
        self.assertEqual((wn["lagerfuehrung"], dl["lagerfuehrung"]), (1, 0))
        self.assertNotIn("Musterbuchse", " ".join(self.log))
        # erneuter Import: von Hand gepflegter Arbeitsplan und Notiz bleiben
        erp.artikel_speichern(self.db, dict(lohn, arbeitsplan=[{"text": "Vorhonen"}, {"text": "Honen"}], memo="eigene Notiz"))
        st = self.imp("artikel", p)
        self.assertEqual(st["aktualisiert"], 6)
        l2 = a("M-100")
        self.assertEqual([x["text"] for x in l2["arbeitsplan_liste"]], ["Vorhonen", "Honen"])
        self.assertEqual(l2["memo"], "eigene Notiz")

    def test_adressen_ohne_kundennummer(self):
        """Adressbericht ohne Kunden-/Lieferantennummer: Nummer wird vergeben, Wiedererkennung über die Adressnummer."""
        inhalt = ("Adressnummer;Kurzbezeichnung;Name;Straße;PLZ;Ort;Land;Telefon;E-Mail;Notiz;Rolle;Prüfen\n"
                  "AD09990;TESTSINTER;Testsinter GmbH;Weg 1;12345;Musterstadt;DE;01234 5;info@testsinter.example;www.testsinter.example;kunde;\n"
                  "AD09991;ZWEITER;Zweiter Kunde;;;;DE;;;;kunde;\n")
        p = self.datei("kunden.csv", inhalt, "utf-8-sig")
        st = self.imp("kunden", p)
        self.assertEqual((st["neu"], st["fehler"]), (2, 0), self.log)
        a = erp.adressen_liste(self.db, "Testsinter")[0]
        self.assertEqual((a["kundennr"], a["adressnr"]), ("10000", "AD09990"))
        self.assertEqual(erp.adresse_lesen(self.db, a["id"])["notiz"], "www.testsinter.example")
        st = self.imp("kunden", p)
        self.assertEqual((st["neu"], st["aktualisiert"]), (0, 2))
        self.assertEqual(self.db.execute("SELECT COUNT(*) c FROM kunde").fetchone()["c"], 2)


if __name__ == "__main__":
    unittest.main()


class TestKundenpreise(TestImport):
    """myfactory „Artikel-Kunden-Preisliste“ (Aufbau wie Tommis Datei vom 06.11., erfundene Werte)."""

    def test_preisliste(self):
        k = erp.adresse_speichern(self.db, dict(name1="Sinterwerk Beispiel GmbH", kunde=dict(zahlungsbed_id=1)))
        erp.artikel_speichern(self.db, dict(artikelnr="9100001", bezeichnung="Exzenter bohren", lagerfuehrung=0))
        erp.artikel_speichern(self.db, dict(artikelnr="0612345", bezeichnung="Adapter", lagerfuehrung=0))
        p = os.path.join(self.tmp.name, "preise.xlsx")
        xlsx_schreiben(p, [["Artikelnummer", "Artikelbezeichnung", "Kunde", "Preis", "Gewicht (in kg)"],
                           ["9100001", "Exzenter", "Sinterwerk Beispiel GmbH", "0.16709499999999999", "0.03"],
                           ["612345", "Adapter", "Sinterwerk Beispiel GmbH", "0.69", "wird nachgereicht"],      # führende Null fehlt
                           ["9999999", "Unbekannt", "Sinterwerk Beispiel GmbH", "1.0", "0.1"],
                           ["9100001", "Exzenter", "Fremde Firma", "1.0", "0.1"],
                           ["", ""], ["Key", "Item"], ["", "Sum"]])
        st = im.importieren(self.db, "kundenpreise", p, False, self.log.append)        # Probelauf
        self.assertEqual((st["neu"], st["fehler"], st["leer"]), (2, 2, 2))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM kundenpreis").fetchone()[0], 0)
        st = im.importieren(self.db, "kundenpreise", p, True, self.log.append)
        self.assertEqual((st["neu"], st["gewichte"], st["ohne_gewicht"]), (2, 1, ["0612345"]))
        import zusatz
        a = self.db.execute("SELECT id, gewicht_kg FROM artikel WHERE artikelnr='9100001'").fetchone()
        self.assertEqual(zusatz.preis_finden(self.db, k["id"], a["id"])["preis"], 0.1671)          # auf 4 Stellen gerundet
        self.assertEqual(a["gewicht_kg"], 0.03)
        st = im.importieren(self.db, "kundenpreise", p, True, self.log.append)                    # zweimal → aktualisiert, nicht doppelt
        self.assertEqual((st["neu"], st["aktualisiert"]), (0, 2))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM kundenpreis").fetchone()[0], 2)
