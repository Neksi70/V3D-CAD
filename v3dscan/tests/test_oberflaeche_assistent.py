"""Oberflächentest „Scan → CAD (1 Klick)“: leeres Projekt → großer Knopf → Datei wählen → Assistent läuft
von selbst → Ergebnis mit STEP/Bauplan-Download, Abweichung, rückgängig."""
import json
import os
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL = os.path.dirname(HIER)
BILDER = os.path.join(HIER, "bilder")
PORT = int(os.environ.get("V3DSCAN_TEST_PORT") or 18811)
BASIS = "http://127.0.0.1:%d" % PORT
fehler = []


def pruefe(bed, text):
    print(("  ok   " if bed else "  FEHLER ") + text, flush=True)
    if not bed:
        fehler.append(text)


def main():
    os.makedirs(BILDER, exist_ok=True)
    datei = os.path.join(WURZEL, "web", "beispiele", "platte_mit_bohrung.ply")
    dienst = subprocess.Popen([sys.executable, os.path.join(WURZEL, "server.py"), "--port", str(PORT)],
                              cwd=WURZEL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
            seite.wait_for_function("window.v3dscan && v3dscan.S.zustand", timeout=30000)
            knopf = seite.locator("#leerHinweis [data-aktion=assistent]")
            pruefe(knopf.is_visible(), "großer Knopf im leeren Projekt sichtbar")
            pruefe(seite.locator("[data-bandseite=start] [data-aktion=assistent]").is_visible(), "Knopf im Menüband START")

            # ohne Scan: erst Dateiauswahl, nach dem Laden startet der Assistent von selbst
            with seite.expect_file_chooser() as fc:
                knopf.click()
            fc.value.set_files(datei)
            seite.wait_for_selector("#assistentDialog[open]", timeout=60000)
            pruefe(True, "Dialog öffnet nach dem Laden von selbst")
            time.sleep(2)
            schritte_waehrend = seite.locator("#asSchritte li").count()
            pruefe(seite.locator("#asZu").is_disabled(), "Schließen gesperrt, solange er rechnet")
            seite.wait_for_selector("#asErgebnis:not([hidden])", timeout=400000)
            seite.screenshot(path=os.path.join(BILDER, "assistent_ergebnis.png"))
            text = seite.inner_text("#asErgebnis")
            print("     " + text.replace("\n", " | "))
            pruefe(schritte_waehrend >= 1, "Fortschritt wird während der Rechnung gezeigt (%d Zeilen)" % schritte_waehrend)
            pruefe("Prisma" in text or "Drehteil" in text, "parametrischer Körper erkannt")
            pruefe("sehr gut" in text or "brauchbar" in text, "Urteil sehr gut/brauchbar")
            pruefe(seite.evaluate("v3dscan.S.koerper.size") == 1, "ein Körper im Modellbaum")
            pruefe(not seite.locator("#asZu").is_disabled(), "Schließen wieder frei")

            with seite.expect_download() as dl:
                seite.click("[data-aktion=asStep]")
            pfad = dl.value.path()
            pruefe(open(pfad, "rb").read(200).startswith(b"ISO-10303-21"), "STEP-Download")
            with seite.expect_download() as dl:
                seite.click("[data-aktion=asBauplan]")
            plan = json.load(open(dl.value.path()))
            pruefe(plan.get("format") == "v3dscan-bauplan" and plan.get("vollstaendig"),
                   "Bauplan für V3D CAD vollständig (%d Befehle)" % len(plan.get("befehle", [])))

            seite.click("[data-aktion=asAbweichung]")
            seite.wait_for_function("v3dscan.S.abweichung && v3dscan.S.abweichung.koerper", timeout=120000)
            pruefe(not seite.locator("#assistentDialog").evaluate("d => d.open"), "Abweichung: Dialog zu, Karte gerechnet")
            seite.screenshot(path=os.path.join(BILDER, "assistent_abweichung.png"))
            pruefe(not konsole, "keine Fehler in der Konsole %s" % konsole[:3])
            browser.close()
    finally:
        dienst.terminate()
    print("\nALLES OK" if not fehler else "\n%d FEHLER" % len(fehler))
    sys.exit(1 if fehler else 0)


if __name__ == "__main__":
    main()
