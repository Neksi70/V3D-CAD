#!/usr/bin/env python3
# Netz-Reiter headless durchklicken: analysieren, reparieren, Loecher
# schliessen, vereinfachen, Netz aus Punktwolke, STL-Export.
#
#   python3 tests/test_oberflaeche_netz.py

import os
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL = os.path.join(HIER, "..")
DATEN = os.path.join(HIER, "daten")
BILDER = os.path.join(HIER, "bilder")
PORT = int(os.environ.get("V3DSCAN_TEST_PORT") or 18798)
fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def main():
    if not os.path.exists(os.path.join(DATEN, "scan_netz.ply")):
        subprocess.check_call([sys.executable, os.path.join(HIER, "testdaten.py")])
    os.makedirs(BILDER, exist_ok=True)
    dienst = None
    if not os.environ.get("V3DSCAN_TEST_PORT"):
        dienst = subprocess.Popen([sys.executable, os.path.join(WURZEL, "server.py"), "--port",
                                   str(PORT), "--laden", os.path.join(DATEN, "ansicht_1.ply"),
                                   os.path.join(DATEN, "scan_netz.ply")], cwd=WURZEL)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen("http://127.0.0.1:%d/api/puls" % PORT, timeout=1)
                break
            except Exception:
                time.sleep(0.2)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            seite = browser.new_page(viewport={"width": 1500, "height": 900}, accept_downloads=True)
            konsole = []
            seite.on("console", lambda m: konsole.append(m.text) if m.type == "error" else None)
            seite.on("pageerror", lambda e: konsole.append(str(e)))
            seite.goto("http://127.0.0.1:%d/" % PORT)
            seite.wait_for_function("window.v3dscan && v3dscan.S.scans.size === 2", timeout=30000)
            leer = lambda: seite.wait_for_function("!v3dscan.S.beschaeftigt", timeout=120000)  # noqa: E731

            def analyse():
                seite.click("[data-aktion=netzAnalyse]")
                leer()
                time.sleep(0.3)
                return {r.split("\t")[0]: r.split("\t")[-1]
                        for r in seite.inner_text("#analyseTabelle").split("\n") if "\t" in r}

            def netz_block(name, knopf):
                seite.click("section[data-netz=%s] [data-%s]" % (name, knopf))
                leer()
                time.sleep(0.4)

            # Netz-Scan (Id 2) aktiv, Blick drauf
            seite.click("#scanListe .scan >> nth=1")
            seite.click("#scanListe .scan >> nth=0 >> .auge")
            leer()
            seite.keyboard.press("f")
            seite.click("#reiter button[data-reiter=netz]")
            a = analyse()
            print("  Analyse:", a)
            pruefe(a.get("Löcher / offene Ränder") == "5", "5 offene Ränder erkannt")
            pruefe(a.get("wasserdicht (druckbar)") == "nein", "nicht wasserdicht")
            seite.click("[data-aktion=netzProbleme]")
            seite.mouse.move(700, 400)
            seite.screenshot(path=os.path.join(BILDER, "n1_analyse_probleme.png"))

            seite.fill("section[data-netz=reparieren] [data-p=kleine_teile]", "1")
            netz_block("reparieren", "vorschau")
            pruefe(seite.is_visible("#netzErgebnis"), "Reparieren: Vorschau zeigt Bericht")
            netz_block("reparieren", "anwenden")
            a = analyse()
            pruefe(a.get("doppelte Dreiecke") == "0" and a.get("Teile") in ("1", "2"),
                   "Reparieren: keine Doppelten, Splitter weg (Teile %s)" % a.get("Teile"))

            # Loecher: Schieber steht auf "alle ausser dem groessten"
            listentext = seite.inner_text("#lochListe")
            print("  Löcher:", listentext.replace("\n", " | "))
            netz_block("loecher", "vorschau")
            seite.mouse.move(705, 405)
            seite.screenshot(path=os.path.join(BILDER, "n2_loecher_vorschau.png"))
            loecher_vor = int(a.get("Löcher / offene Ränder", "0"))
            netz_block("loecher", "anwenden")
            time.sleep(0.5)
            a = analyse()
            pruefe(int(a.get("Löcher / offene Ränder", "99")) < loecher_vor,
                   "Löcher geschlossen (%d → %s)" % (loecher_vor, a.get("Löcher / offene Ränder")))

            dreiecke_vor = seite.evaluate("v3dscan.S.scans.get(2).tri.length / 3")
            seite.fill("section[data-netz=vereinfachen] [data-p=prozent]", "30")
            netz_block("vereinfachen", "vorschau")
            netz_block("vereinfachen", "anwenden")
            seite.wait_for_function("v3dscan.S.scans.get(2).tri.length / 3 < %d" % (dreiecke_vor * 0.4), timeout=60000)
            pruefe(True, "Vereinfachen %d → %d" % (dreiecke_vor, seite.evaluate("v3dscan.S.scans.get(2).tri.length / 3")))

            seite.keyboard.press("Control+z")
            leer()
            seite.wait_for_function("v3dscan.S.scans.get(2).tri.length / 3 === %d" % dreiecke_vor, timeout=30000)
            pruefe(True, "Rückgängig stellt Netz her")

            # Poisson aus der Punktwolke (Scan 1)
            seite.click("#scanListe .scan >> nth=0 >> .auge")
            leer()
            seite.click("#scanListe .scan >> nth=1 >> .auge")
            leer()
            seite.click("#scanListe .scan >> nth=0")
            seite.fill("section[data-netz=erzeugen] [data-p=tiefe]", "7")
            netz_block("erzeugen", "anwenden")
            seite.wait_for_function("v3dscan.S.scans.size === 3", timeout=180000)
            neu = seite.evaluate("v3dscan.S.scans.get(v3dscan.S.aktiv).tri ? v3dscan.S.scans.get(v3dscan.S.aktiv).tri.length/3 : 0")
            pruefe(neu > 1000, "Netz aus Punktwolke: %d Dreiecke" % neu)
            seite.keyboard.press("f")
            seite.mouse.move(700, 410)
            seite.screenshot(path=os.path.join(BILDER, "n3_poisson.png"))

            with seite.expect_download() as dl:
                seite.select_option("#exportFormat", "stl")
                seite.click("[data-aktion=exportieren]")
            pfad = dl.value.path()
            groesse = os.path.getsize(pfad)
            pruefe(groesse == 84 + 50 * neu, "STL-Export binär, %d Bytes" % groesse)

            pruefe(not konsole, "keine JS-Fehler %s" % konsole[:3])
            browser.close()
    finally:
        if dienst:
            dienst.terminate()
            dienst.wait(5)
    print()
    print("FEHLER: %d" % len(fehler) if fehler else "Alles in Ordnung.")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
