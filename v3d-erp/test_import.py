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


if __name__ == "__main__":
    unittest.main()
