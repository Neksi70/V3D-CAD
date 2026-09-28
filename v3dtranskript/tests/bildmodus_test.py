#!/usr/bin/env python3
"""Tests für den Bildmodus - mit selbst erzeugten Testvideos (tests/testvideo.py).

    python tests/bildmodus_test.py            # alles
    python tests/bildmodus_test.py -v Pipeline  # nur eine Gruppe

Läuft unter Windows und Ubuntu. Braucht ffmpeg + die Python-Pakete aus
requirements-bildmodus.txt; OCR-Tests werden übersprungen (mit Hinweis), wenn
Tesseract/deu fehlt. Tesseract an ungewöhnlichem Ort: TESSERACT_CMD setzen.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HIER = os.path.dirname(os.path.abspath(__file__))
PROJEKT = os.path.dirname(HIER)
sys.path.insert(0, PROJEKT)
sys.path.insert(0, HIER)

import bildmodus as bm  # noqa: E402
import testvideo as tv  # noqa: E402

VIDEOS = {}
TMP = None
OCR_PROBLEME = bm.abhaengigkeiten_pruefen(ocr=True)
OCR_DA = not OCR_PROBLEME
OHNE_OCR = "Tesseract/Sprachpaket fehlt - " + bm.anleitung(OCR_PROBLEME).replace("\n", " ")


def setUpModule():
    global TMP
    TMP = tempfile.mkdtemp(prefix="bildmodus_test_")
    VIDEOS.update(tv.alle(os.path.join(TMP, "videos")))


def tearDownModule():
    shutil.rmtree(TMP, ignore_errors=True)


def ausgabe(name):
    return os.path.join(TMP, "aus_" + name)


def nahe(zeit, erwartet, toleranz=0.35):
    return abs(zeit - erwartet) <= toleranz


class Hilfen(unittest.TestCase):
    def test_zeit_lesen(self):
        self.assertEqual(bm.zeit_lesen("90"), 90.0)
        self.assertEqual(bm.zeit_lesen("1:30"), 90.0)
        self.assertEqual(bm.zeit_lesen("01:02:03.5"), 3723.5)
        self.assertEqual(bm.zeit_lesen("2,5"), 2.5)
        self.assertIsNone(bm.zeit_lesen(""))
        self.assertIsNone(bm.zeit_lesen(None))
        for falsch in ("1:2:3:4", "abc", "-5", "1:-3"):
            with self.assertRaises(ValueError):
                bm.zeit_lesen(falsch)

    def test_zeit_text_ohne_doppelpunkt_im_dateinamen(self):
        self.assertEqual(bm.zeit_text(3723.456), "01:02:03.456")
        self.assertEqual(bm.zeit_text(83.45, datei=True), "00-01-23-450")
        self.assertNotIn(":", bm.zeit_text(99999, datei=True))

    def test_zaun_laenger_als_backticks_im_text(self):
        self.assertEqual(bm._zaun("normaler Text"), "```")
        self.assertEqual(bm._zaun("hier ``` drin"), "````")

    def test_tsv_auswertung_markiert_schwach_statt_verwerfen(self):
        kopf = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"
        zeilen = [kopf,
                  "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t35.0\tUnscharf",
                  "5\t1\t1\t1\t1\t2\t0\t0\t10\t10\t42.0\tText",
                  "5\t1\t1\t1\t1\t3\t0\t0\t10\t10\t12.0\t|",          # Rahmenlinie
                  "5\t1\t2\t1\t1\t1\t0\t0\t10\t10\t55.0\tzweiter"]
        o = bm._tsv_auswerten("\n".join(zeilen), 60)
        self.assertTrue(o["schwach"])
        self.assertEqual(o["text"], "Unscharf Text\n\nzweiter")    # Block-Abstand, | raus
        self.assertIn("Unscharf", o["unsichere_woerter"])
        self.assertLess(o["konfidenz"], 60)

    def test_textpruefung_nur_bei_sicher_erkannten_woertern(self):
        a = {"fehler": None, "_sicher": {"schichthöhe", "02", "mm"}, "_alle": {"schichthöhe", "02", "mm"}}
        b = {"fehler": None, "_sicher": {"schichthöhe", "03", "mm"}, "_alle": {"schichthöhe", "03", "mm"}}
        c = {"fehler": None, "_sicher": {"schichthöhe", "mm"}, "_alle": {"schichthöhe", "02", "mm"}}
        self.assertTrue(bm._text_unterscheidet(a, b))
        self.assertFalse(bm._text_unterscheidet(a, c))              # nur unsicher gelesen
        self.assertFalse(bm._text_unterscheidet(a, {"fehler": "x"}))


class Abhaengigkeiten(unittest.TestCase):
    def fehlt_alles(self, plattform):
        return bm.abhaengigkeiten_pruefen(
            ocr=True, plattform=plattform, which=lambda _: None, modul_da=lambda _: False,
            tesseract_suche=lambda _=None: None)

    def test_windows_anleitung_mit_winget(self):
        text = bm.anleitung(self.fehlt_alles("windows"))
        self.assertIn("winget install --id Gyan.FFmpeg", text)
        self.assertIn("winget install --id UB-Mannheim.TesseractOCR", text)
        self.assertIn("py -m pip install -r requirements-bildmodus.txt", text)

    def test_ubuntu_anleitung_mit_apt(self):
        text = bm.anleitung(self.fehlt_alles("linux"))
        self.assertIn("sudo apt install ffmpeg", text)
        self.assertIn("sudo apt install tesseract-ocr tesseract-ocr-deu", text)

    def test_deutsches_sprachpaket_fehlt(self):
        for plattform, erwartet in (("linux", "sudo apt install tesseract-ocr-deu"),
                                    ("windows", "deu.traineddata")):
            probleme = bm.abhaengigkeiten_pruefen(
                ocr=True, plattform=plattform, which=lambda p: "/x/" + p, modul_da=lambda _: True,
                tesseract_suche=lambda _=None: "/opt/t/tesseract",
                sprachliste=lambda _: {"eng", "osd"})
            self.assertEqual([p["was"] for p in probleme], ["tesseract-deu"])
            self.assertIn(erwartet, probleme[0]["abhilfe"])

    def test_ohne_ocr_kein_tesseract_noetig(self):
        probleme = bm.abhaengigkeiten_pruefen(
            ocr=False, plattform="linux", which=lambda p: "/x/" + p, modul_da=lambda _: True,
            tesseract_suche=lambda _=None: None)
        self.assertEqual(probleme, [])

    def test_hier_ist_alles_fuer_den_bildmodus_da(self):
        self.assertEqual(bm.abhaengigkeiten_pruefen(ocr=False), [])


class Erkennung(unittest.TestCase):
    def test_ohne_tonspur_bildmodus(self):
        modus, grund, info, _ = bm.modus_erkennen(VIDEOS["stumm"])
        self.assertEqual((modus, grund), ("bild", "keine Tonspur"))
        self.assertEqual(info["video"]["breite"], 1920)

    def test_stille_tonspur_bildmodus(self):
        modus, grund, _, ton = bm.modus_erkennen(VIDEOS["still"])
        self.assertEqual(modus, "bild")
        self.assertTrue(ton["hat_ton"] and ton["still"])
        self.assertIn("still", grund)

    def test_hoerbarer_ton_sprachmodus(self):
        modus, _, _, ton = bm.modus_erkennen(VIDEOS["ton"])
        self.assertEqual(modus, "ton")
        self.assertGreater(ton["max_db"], -30)

    def test_nur_ton_ohne_bildspur(self):
        modus, grund, _, _ = bm.modus_erkennen(VIDEOS["nur_ton"])
        self.assertEqual(modus, "ton")
        self.assertIn("keine Bildspur", grund)

    def test_kaputte_datei_klare_meldung(self):
        with self.assertRaises(bm.BildmodusFehler) as f:
            bm.modus_erkennen(VIDEOS["kaputt"])
        self.assertIn("kein lesbares Video", str(f.exception))

    def test_leere_und_fehlende_datei(self):
        leer = os.path.join(TMP, "leer.mp4")
        open(leer, "wb").close()
        with self.assertRaisesRegex(bm.BildmodusFehler, "leer"):
            bm.video_info(leer)
        with self.assertRaisesRegex(bm.BildmodusFehler, "nicht gefunden"):
            bm.video_info(os.path.join(TMP, "gibtsnicht.mp4"))


class Pipeline(unittest.TestCase):
    def lauf(self, name, video="stumm", **opts):
        opts.setdefault("ocr_an", False)
        return bm.ausfuehren(VIDEOS[video], ausgabe(name), ueberschreiben=True, **opts)

    def test_schluesselbilder_zeitstempel_und_duplikate(self):
        erg = self.lauf("grund")
        zeiten = [b["zeit"] for b in erg["bilder"]]
        # jeder sichtbare Schritt ist da (inkl. Rücksprung zur Übersicht bei 41 s) ...
        for w in tv.WECHSEL:
            self.assertTrue(any(nahe(t, w) for t in zeiten), f"Schritt bei {w} s fehlt: {zeiten}")
        # ... und die 25 s Stillstand (nur Mauszeiger) liefern nur das Bild vom
        # Anfang (~8 s) - die Intervallbilder bei 18/28 s sind Duplikate
        self.assertEqual(sum(1 for t in zeiten if 8.5 < t < 32.5), 0, zeiten)
        self.assertEqual(len(zeiten), len(tv.WECHSEL))
        self.assertGreaterEqual(erg["statistik"]["duplikate_entfernt"], 1)
        self.assertEqual(zeiten, sorted(zeiten))
        self.assertEqual(erg["bilder"][0]["grund"], "start")

    def test_dateien_png_max_1280_und_zeit_im_namen(self):
        from PIL import Image
        erg = self.lauf("dateien")
        for b in erg["bilder"]:
            pfad = os.path.join(ausgabe("dateien"), b["datei"])
            self.assertTrue(os.path.isfile(pfad), pfad)
            self.assertIn(bm.zeit_text(b["zeit"], datei=True), os.path.basename(pfad))
            with Image.open(pfad) as img:
                self.assertEqual(img.format, "PNG")
                self.assertLessEqual(img.width, 1280)
                self.assertEqual(img.width, b["breite"])
        self.assertEqual(erg["bilder"][0]["breite"], 1280)          # 1920 -> 1280

    def test_markdown_und_json_passen_zusammen(self):
        erg = self.lauf("md")
        with open(os.path.join(ausgabe("md"), "bildprotokoll.json"), encoding="utf-8") as f:
            daten = json.load(f)
        with open(os.path.join(ausgabe("md"), "bildprotokoll.md"), encoding="utf-8") as f:
            md = f.read()
        self.assertEqual(len(daten["bilder"]), len(erg["bilder"]))
        self.assertIn("Schritt für Schritt", md)
        for b in daten["bilder"]:
            self.assertIn(f"]({b['datei']})", md)                   # relativer Bildpfad
            self.assertIn(b["zeit_text"], md)
        self.assertTrue(os.path.isfile(os.path.join(ausgabe("md"), "bildmodus.log")))

    def test_obergrenze_hebt_schwellwert_und_protokolliert(self):
        erg = self.lauf("grenze", max_bilder=3)
        self.assertLessEqual(len(erg["bilder"]), 3)
        self.assertGreater(erg["einstellungen"]["schwelle"], erg["einstellungen"]["schwelle_start"])
        warnungen = " ".join(e["text"] for e in erg["log"] if e["stufe"] == "warnung")
        self.assertRegex(warnungen, r"Bildobergrenze 3 überschritten .* Schwellwert automatisch auf")

    def test_obergrenze_eins_greift_notfalls_ueber_intervall(self):
        erg = self.lauf("grenze1", max_bilder=1)
        self.assertEqual(len(erg["bilder"]), 1)
        self.assertIn("Mindestintervall", " ".join(e["text"] for e in erg["log"]))

    def test_ausschnitt_start_ende(self):
        erg = self.lauf("ausschnitt", start="0:30", ende="40")
        zeiten = [b["zeit"] for b in erg["bilder"]]
        self.assertTrue(all(29.9 <= t <= 40.0 for t in zeiten), zeiten)
        self.assertTrue(nahe(zeiten[0], 30.0), zeiten)                 # Zeit absolut, nicht ab 0
        self.assertTrue(any(nahe(t, 33.0) for t in zeiten), zeiten)
        self.assertTrue(any(nahe(t, 37.0) for t in zeiten), zeiten)
        self.assertEqual(erg["ausschnitt"], {"start": 30.0, "ende": 40.0})

    def test_ungueltige_eingaben(self):
        for opts, muster in (({"start": "50"}, "hinter dem Videoende"),
                             ({"start": "20", "ende": "10"}, "nach der Startzeit"),
                             ({"schwelle": 0}, "zwischen 0 und 1"),
                             ({"max_bilder": 0}, "mindestens 1")):
            with self.assertRaisesRegex(bm.BildmodusFehler, muster):
                self.lauf("falsch", **opts)

    def test_ende_hinter_video_wird_gekappt(self):
        erg = self.lauf("kappen", start="40", ende="99")
        self.assertIn("hinter dem Videoende", " ".join(e["text"] for e in erg["log"]))
        self.assertAlmostEqual(erg["ausschnitt"]["ende"], 44.9, delta=0.2)

    def test_kaputtes_video_und_reine_tonspur(self):
        with self.assertRaises(bm.BildmodusFehler):
            self.lauf("kaputt", video="kaputt")
        with self.assertRaisesRegex(bm.BildmodusFehler, "keine Bildspur"):
            self.lauf("nurton", video="nur_ton")

    def test_abgeschnittenes_video_nutzt_lesbaren_teil(self):
        quelle = VIDEOS["stumm"].replace("stumm.mp4", "stumm.mkv")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", VIDEOS["stumm"], "-c", "copy",
                        quelle], check=True)
        halb = quelle.replace(".mkv", "_halb.mkv")
        with open(quelle, "rb") as f, open(halb, "wb") as g:
            daten = f.read()
            g.write(daten[: len(daten) * 6 // 10])                 # Übertragung abgerissen
        erg = bm.ausfuehren(halb, ausgabe("halb"), ocr_an=False, ueberschreiben=True)
        self.assertGreaterEqual(len(erg["bilder"]), 2)

    def test_fremder_ausgabeordner_wird_nicht_ueberschrieben(self):
        ziel = ausgabe("fremd")
        os.makedirs(ziel, exist_ok=True)
        with open(os.path.join(ziel, "wichtig.docx"), "w") as f:
            f.write("x")
        with self.assertRaisesRegex(bm.BildmodusFehler, "nicht leer"):
            bm.ausfuehren(VIDEOS["stumm"], ziel, ocr_an=False)
        with self.assertRaisesRegex(bm.BildmodusFehler, "fremde Dateien"):
            bm.ausfuehren(VIDEOS["stumm"], ziel, ocr_an=False, ueberschreiben=True)

    def test_abbrechen_raeumt_arbeitsordner_weg(self):
        arbeit = os.path.join(TMP, "arbeit")
        os.makedirs(arbeit, exist_ok=True)

        class Weg(Exception):
            pass

        def abbrechen():
            raise Weg()
        with self.assertRaises(Weg):
            bm.ausfuehren(VIDEOS["stumm"], ausgabe("abbruch"), ocr_an=False, ueberschreiben=True,
                          abbrechen_pruefen=abbrechen, arbeitsordner=arbeit)
        self.assertEqual(os.listdir(arbeit), [])


class Entzerren(unittest.TestCase):
    def test_monitor_im_einzelbild_gefunden(self):
        import cv2
        import numpy as np
        cap = cv2.VideoCapture(VIDEOS["abgefilmt"])
        ok, bild = cap.read()
        cap.release()
        self.assertTrue(ok)
        quad = bm.monitor_finden(bild)
        self.assertIsNotNone(quad)
        # gefunden wird Gehäuse oder Bildfläche - beides liegt nahe an den Ecken
        abweichung = np.abs(quad - tv.MONITOR_ECKEN).max()
        self.assertLess(abweichung, 60, quad)
        gerade = bm.entzerren(bild, quad)
        h, w = gerade.shape[:2]
        self.assertAlmostEqual(w / h, 16 / 9, delta=0.12)
        self.assertGreater(gerade[:, :8].mean(), 120)               # Gehäuserand abgeschnitten
        self.assertGreater(gerade[h // 2, w // 2].mean(), 150)      # Mitte = heller Bildschirm

    def test_bildschirmaufnahme_wird_nicht_beschnitten(self):
        bild = tv.bildschirm(0)
        self.assertIsNone(bm.monitor_finden(bild))

    def test_abgefilmtes_video_ein_bild_je_schritt(self):
        erg = bm.ausfuehren(VIDEOS["abgefilmt"], ausgabe("abgefilmt"), entzerren_an=True,
                            ocr_an=False, ueberschreiben=True)
        zeiten = [b["zeit"] for b in erg["bilder"]]
        self.assertEqual(len(zeiten), 3, zeiten)                       # 3 Schritte à 4 s
        for w in (0.0, 4.0, 8.0):
            self.assertTrue(any(nahe(t, w, 0.5) for t in zeiten), zeiten)
        self.assertTrue(all(b["entzerrt"] for b in erg["bilder"]))
        for b in erg["bilder"]:
            self.assertAlmostEqual(b["breite"] / b["hoehe"], 16 / 9, delta=0.12)

    def test_entzerren_ohne_monitor_warnt(self):
        erg = bm.ausfuehren(VIDEOS["stumm"], ausgabe("ohne_monitor"), entzerren_an=True,
                            ocr_an=False, ueberschreiben=True, ende="6")
        self.assertIn("keine Monitorfläche gefunden",
                      " ".join(e["text"] for e in erg["log"]))
        self.assertTrue(all(b["entzerrt"] is False for b in erg["bilder"]))


@unittest.skipUnless(OCR_DA, OHNE_OCR)
class Texterkennung(unittest.TestCase):
    def test_ocr_text_pro_bild_und_textpruefung(self):
        erg = bm.ausfuehren(VIDEOS["stumm"], ausgabe("ocr"), ocr_an=True, ueberschreiben=True)
        texte = {round(b["zeit"]): b["ocr"]["text"] for b in erg["bilder"]}
        alles = "\n".join(texte.values())
        for wort in ("Schritt 2", "Halterung.stl", "Schritt 4", "42 mm", "Schichthöhe 0,2 mm"):
            self.assertIn(wort, alles)
        for b in erg["bilder"]:
            self.assertIsNotNone(b["ocr"]["konfidenz"])
            self.assertFalse(b["ocr"]["schwach"], b)
        # die geänderte Ziffer (0,2 -> 0,3 mm ab 23 s) hält nur die Textprüfung fest
        geaendert = [b for b in erg["bilder"] if b["text_geaendert"]]
        self.assertEqual(len(geaendert), 1, [(b["zeit"], b["text_geaendert"]) for b in erg["bilder"]])
        self.assertGreater(geaendert[0]["zeit"], tv.ZIFFER_AB)
        self.assertIn("0,3", geaendert[0]["ocr"]["text"])
        self.assertEqual(len(erg["bilder"]), len(tv.WECHSEL) + 1)
        md = open(os.path.join(ausgabe("ocr"), "bildprotokoll.md"), encoding="utf-8").read()
        self.assertIn("Erkannter Text", md)
        self.assertIn("Text geändert", md)

    def test_schwache_erkennung_wird_markiert_nicht_verworfen(self):
        import cv2
        import numpy as np
        # verwackelt, flau, verrauscht: Tesseract liest noch etwas, aber unsicher
        matsch = cv2.GaussianBlur(tv.bildschirm(3), (0, 0), 4)
        rng = np.random.default_rng(1)
        matsch = np.clip(matsch.astype(np.float32) * 0.3 + 150
                         + rng.normal(0, 10, matsch.shape), 0, 255).astype(np.uint8)
        o = bm.ocr(matsch, bm.tesseract_finden())
        self.assertIsNone(o["fehler"])
        self.assertTrue(o["text"], "Text soll trotz Schwäche erhalten bleiben")
        self.assertTrue(o["schwach"], o)
        self.assertLess(o["konfidenz"], bm.STANDARD["ocr_min_konfidenz"])
        sauber = bm.ocr(tv.bildschirm(3), bm.tesseract_finden())
        self.assertFalse(sauber["schwach"], sauber)

    def test_abgefilmt_mit_ocr(self):
        erg = bm.ausfuehren(VIDEOS["abgefilmt"], ausgabe("abgefilmt_ocr"), entzerren_an=True,
                            ocr_an=True, ueberschreiben=True)
        alles = " ".join(b["ocr"]["text"] for b in erg["bilder"])
        self.assertIn("Wert eingeben", alles)
        self.assertIn("Speichern", alles)


class Kommandozeile(unittest.TestCase):
    def cli(self, *args):
        return subprocess.run([sys.executable, os.path.join(PROJEKT, "bildmodus.py"), *args],
                              capture_output=True, text=True, encoding="utf-8", timeout=600)

    def test_stummes_video_automatisch(self):
        ziel = ausgabe("cli")
        r = self.cli(VIDEOS["stumm"], "-o", ziel, "--kein-ocr", "--ueberschreiben")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Automatisch Bildmodus: keine Tonspur", r.stderr)
        self.assertTrue(os.path.isfile(os.path.join(ziel, "bildprotokoll.md")))
        self.assertRegex(r.stdout, r"\d+ Bilder ->")

    def test_video_mit_ton_verweist_auf_sprachmodus(self):
        r = self.cli(VIDEOS["ton"], "-o", ausgabe("cli_ton"), "--kein-ocr")
        self.assertEqual(r.returncode, 3, r.stderr)
        self.assertIn("--modus bild", r.stderr)
        r = self.cli(VIDEOS["ton"], "-o", ausgabe("cli_ton"), "--kein-ocr", "--modus", "bild",
                     "--ueberschreiben", "-q")
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_fehler_ohne_traceback(self):
        r = self.cli(VIDEOS["kaputt"], "-o", ausgabe("cli_kaputt"), "--kein-ocr")
        self.assertEqual(r.returncode, 1)
        self.assertIn("Fehler:", r.stderr)
        self.assertNotIn("Traceback", r.stderr)
        r = self.cli(VIDEOS["stumm"], "--start", "quatsch", "--kein-ocr")
        self.assertEqual(r.returncode, 2)
        self.assertNotIn("Traceback", r.stderr)

    def test_pruefen(self):
        r = self.cli("--pruefen", "--kein-ocr")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("Alle Abhängigkeiten sind da", r.stdout)


if __name__ == "__main__":
    if not OCR_DA:
        print("HINWEIS: OCR-Tests werden übersprungen.\n" + bm.anleitung(OCR_PROBLEME) + "\n",
              file=sys.stderr)
    unittest.main()
