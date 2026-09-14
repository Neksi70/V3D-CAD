#!/usr/bin/env python3
# Formen-Reiter: CAD-Testteil analysieren, Element waehlen, Nennmass aendern,
# verwerfen, von Hand einpassen, CSV, Projekt speichern/laden.
#
#   python3 tests/test_oberflaeche_formen.py

import json
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
PORT = int(os.environ.get("V3DSCAN_TEST_PORT") or 18795)
BASIS = "http://127.0.0.1:%d" % PORT
fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def post(pfad, daten, roh=False):
    req = urllib.request.Request(BASIS + pfad, data=daten if roh else json.dumps(daten).encode(),
                                 headers={} if roh else {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as a:
        return json.loads(a.read())


def main():
    if not os.path.exists(os.path.join(DATEN, "testteil.ply")):
        sys.path.insert(0, HIER)
        import cad_testteil
        cad_testteil.erzeugen(DATEN)
    os.makedirs(BILDER, exist_ok=True)
    dienst = None
    if not os.environ.get("V3DSCAN_TEST_PORT"):
        dienst = subprocess.Popen([sys.executable, os.path.join(WURZEL, "server.py"), "--port", str(PORT),
                                   "--laden", os.path.join(DATEN, "testteil.ply")], cwd=WURZEL)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(BASIS + "/api/puls", timeout=1)
                break
            except Exception:
                time.sleep(0.2)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            seite = browser.new_page(viewport={"width": 1500, "height": 950}, accept_downloads=True)
            konsole = []
            seite.on("console", lambda m: konsole.append(m.text) if m.type == "error" else None)
            seite.on("pageerror", lambda e: konsole.append(str(e)))
            seite.goto(BASIS + "/")
            seite.wait_for_function("window.v3dscan && v3dscan.S.scans.size === 1", timeout=30000)
            leer = lambda: seite.wait_for_function("!v3dscan.S.beschaeftigt", timeout=180000)  # noqa: E731

            seite.click("#reiter button[data-reiter=formen]")
            seite.click("[data-aktion=formenErkennen]")
            seite.wait_for_selector("#formZusammenfassung:not([hidden])", timeout=180000)
            leer()
            text = seite.inner_text("#formZusammenfassung")
            print("  " + text)
            pruefe("6 Bohrungen (4× Ø 5, 2× Ø 8)" in text and "4 Rundungen" in text and "1 Kegel" in text,
                   "Zusammenfassung vollständig")
            seite.mouse.move(700, 450)
            seite.screenshot(path=os.path.join(BILDER, "f1_formen.png"))

            # Bohrung Ø 8 anklicken -> Punkte gewaehlt, Kamera faehrt hin
            zeile = seite.locator(".formliste .el", has_text="Bohrung Ø 8,00").first
            zeile.click()
            time.sleep(0.4)
            gew = seite.evaluate("v3dscan.S.scans.get(1).sel.reduce((a,b)=>a+b,0)")
            pruefe(gew > 1000, "Element gewählt (%d Punkte)" % gew)
            seite.mouse.move(705, 455)
            seite.screenshot(path=os.path.join(BILDER, "f2_bohrung_gewaehlt.png"))

            # Nennmass aendern ueber den Dialog
            seite.once("dialog", lambda d: d.accept("8,1"))
            zeile.locator(".nenn").click()
            leer()
            time.sleep(0.4)
            pruefe(seite.locator(".formliste .el", has_text="Bohrung Ø 8,10").count() == 1, "Nennmaß auf 8,10 geändert")
            pruefe("1× Ø 8,1" in seite.inner_text("#formZusammenfassung"), "Zusammenfassung folgt dem Nennmaß")

            # Element verwerfen, dann von Hand aus der Auswahl wieder einpassen
            vorher = seite.evaluate("v3dscan.S.erkennung.elemente.length")
            eid = seite.evaluate("v3dscan.S.erkennung.elemente.find(e => e.typ === 'bohrung' && e.durchmesser_nenn === 5).id")
            seite.evaluate("""(eid) => { const e = v3dscan.S.scans.get(1), l = v3dscan.S.erkennung.labels;
                for (let i = 0; i < e.n; i++) e.sel[i] = l[i] === eid ? 1 : 0; }""", eid)
            seite.locator(".formliste .el", has_text="Bohrung Ø 5,00").first.locator("button").click()
            leer()
            time.sleep(0.3)
            pruefe(seite.evaluate("v3dscan.S.erkennung.elemente.length") == vorher - 1, "Element verworfen")
            # Auswahl wurde durch das Listen-Neuzeichnen nicht geloescht? neu setzen per Labels geht nicht mehr
            # (-1) -> Auswahl aus dem Schritt davor wiederherstellen
            seite.evaluate("""(eid) => { const e = v3dscan.S.scans.get(1); let n=0; for (let i = 0; i < e.n; i++) n += e.sel[i]; return n; }""", eid)
            seite.click("[data-form-auswahl=auto]")
            leer()
            time.sleep(0.4)
            letzte = seite.evaluate("v3dscan.S.erkennung.elemente[v3dscan.S.erkennung.elemente.length-1]")
            pruefe(letzte["typ"] == "bohrung" and letzte["durchmesser_nenn"] == 5 and letzte.get("manuell"),
                   "von Hand eingepasst: %s" % letzte["text"])

            with seite.expect_download() as dl:
                seite.click("[data-aktion=formenCsv]")
            csv = open(dl.value.path(), encoding="utf-8-sig").read().splitlines()
            pruefe(csv[0].startswith("Nr;Typ;Nennmaß") and len(csv) == vorher + 1, "CSV mit %d Zeilen" % (len(csv) - 1))

            pruefe(not konsole, "keine JS-Fehler %s" % konsole[:3])
            browser.close()

        # Projekt speichern/laden behaelt die Erkennung
        with urllib.request.urlopen(BASIS + "/api/projekt/speichern", timeout=60) as a:
            projekt = a.read()
        post("/api/projekt/laden", projekt, roh=True)
        j = post("/api/formen/laden", {"id": 1})
        pruefe(j.get("erkennung") and len(j["erkennung"]["elemente"]) == vorher, "Erkennung im Projekt gespeichert")
    finally:
        if dienst:
            dienst.terminate()
            dienst.wait(5)
    print()
    print("FEHLER: %d" % len(fehler) if fehler else "Alles in Ordnung.")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
