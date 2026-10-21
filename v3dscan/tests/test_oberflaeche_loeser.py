"""Oberflächentest Skizzen-Löser (v1.1): Bedingungen und Maße setzen, Liste, Widerspruch, Entfernen."""
import math
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

from playwright.sync_api import sync_playwright

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL = os.path.dirname(HIER)
BILDER = os.path.join(HIER, "bilder")
PORT = int(os.environ.get("V3DSCAN_TEST_PORT") or 18793)
BASIS = "http://127.0.0.1:%d" % PORT
fehler = []


def pruefe(bed, text):
    print(("  ok   " if bed else "  FEHLER ") + text)
    if not bed:
        fehler.append(text)


def main():
    sys.path.insert(0, HIER)
    from test_oberflaeche_skizze import testdatei
    pfad = testdatei()
    os.makedirs(BILDER, exist_ok=True)
    dienst = None
    if not os.environ.get("V3DSCAN_TEST_PORT"):
        dienst = subprocess.Popen([sys.executable, os.path.join(WURZEL, "server.py"), "--port", str(PORT), "--laden", pfad],
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
            seite.wait_for_function("window.v3dscan && v3dscan.S.scans.size === 1", timeout=30000)
            leer = lambda: seite.wait_for_function("!v3dscan.S.beschaeftigt", timeout=300000)  # noqa: E731
            zustand = lambda ausdruck: seite.evaluate("v3dscan.S.zustand." + ausdruck)  # noqa: E731

            def oeffne(band, teil):
                if seite.evaluate("!!document.querySelector('#wfInhalt #%s')" % teil):
                    return
                # Reiter des Werkzeugs selbst finden (Menüband ist nach Arbeitsschritten aufgeteilt)
                band = seite.evaluate("(t) => document.querySelector(`#band [data-wf~='${t}']`).closest('[data-bandseite]').dataset.bandseite", teil)
                seite.click("#bandReiter [data-band=%s]" % band)
                seite.click("[data-bandseite=%s] [data-wf~='%s']" % (band, teil))

            def bildschirm(p):
                return seite.evaluate("""([x, y, z]) => { const {kamera} = v3dscan;
                  const v = kamera.position.clone().set(x, y, z).project(kamera);
                  const c = document.querySelector('#leinwand'), r = c.getBoundingClientRect();
                  return [r.left + (v.x + 1) / 2 * c.clientWidth, r.top + (1 - v.y) / 2 * c.clientHeight]; }""", p)

            def entfokus():
                seite.evaluate("document.activeElement && document.activeElement.blur()")

            def draufsicht():
                # senkrecht von oben auf die Platte (z nach oben)
                seite.evaluate("""() => { const {kamera, steuerung} = v3dscan;
                  kamera.up.set(0, 1, 0); kamera.position.set(30, 20, 180); steuerung.target.set(30, 20, 5);
                  kamera.lookAt(30, 20, 5); steuerung.update(); }""")
                time.sleep(0.3)

            entfokus()
            draufsicht()
            oeffne("modell", "w-skizze")
            seite.select_option("#skEbene", "welt:xy")
            seite.fill("#skVersatz", "10")
            seite.click("#wfInhalt [data-aktion=skLeer]")
            seite.wait_for_function("v3dscan.S.skVorschau !== null", timeout=30000)
            leer()
            seite.select_option("#skzArt", "rechteck")
            seite.click("#wfInhalt [data-aktion=skzStart]")
            for p in ((35, 5, 10), (55, 15, 10)):
                x, y = bildschirm(p)
                seite.mouse.click(x, y)
                time.sleep(0.2)
            seite.wait_for_function("v3dscan.S.skVorschau.daten.ketten.length === 1", timeout=30000)
            leer()
            texte = lambda: seite.eval_on_selector_all("#skElemente .el > span:first-child", "e => e.map(x => x.textContent)")  # noqa: E731
            bed = lambda: seite.eval_on_selector_all("#skBedingungen .el > span:first-child", "e => e.map(x => x.textContent)")  # noqa: E731

            def anwenden(element, art, bezug="", wert=""):
                if "an" not in (seite.locator("#skElemente .el").nth(element).get_attribute("class") or ""):
                    seite.locator("#skElemente .el").nth(element).click()
                seite.select_option("#skeArt", art)
                seite.fill("#skeBezug", bezug)
                seite.fill("#skeWert", wert)
                seite.click("#wfInhalt [data-aktion=skeAusfuehren]")
                time.sleep(0.3)
                leer()
            anwenden(1, "gleich", "1")
            t = texte()
            pruefe(sum("15.00 mm" in x for x in t) == 4, "Element 2 „gleich lang wie“ 1 → Quadrat 15: %s" % t)
            anwenden(0, "laenge", "", "30")
            t = texte()
            pruefe(sum("30.00 mm" in x for x in t) == 4, "Länge 30 – Quadrat bleibt: %s" % t)
            pruefe(bed() == ["gleich K1/E2 ↔ K1/E1", "Länge K1/E1 = 30 mm"], "Bedingungsliste: %s" % bed())
            anwenden(0, "senkrecht")
            meldung = seite.evaluate("[...document.querySelectorAll('#meldungen .meldung.fehler')].map(e => e.textContent).join(' ')")
            pruefe("passt nicht" in meldung and len(bed()) == 2, "Widerspruch gemeldet, nichts geändert: „%s“" % meldung[:90])
            seite.locator("#skBedingungen .el button").first.click()
            seite.wait_for_function("document.querySelectorAll('#skBedingungen .el').length === 1", timeout=30000)
            leer()
            anwenden(0, "laenge", "", "40")
            t = texte()
            pruefe(sum("40.00 mm" in x for x in t) == 2 and sum("30.00 mm" in x for x in t) == 2,
                   "ohne „gleich“: nur die Breite wird 40: %s" % t)
            # die absichtliche Widerspruchs-Meldung landet ebenfalls in der Konsole
            rest = [k for k in konsole if "passt nicht" not in k and "400" not in k]
            pruefe(not rest, "keine weiteren Konsolenfehler: %s" % rest[:3])
            seite.screenshot(path=os.path.join(BILDER, "loeser.png"))
            browser.close()
    finally:
        if dienst:
            dienst.terminate()
            dienst.wait(10)


if __name__ == "__main__":
    main()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
