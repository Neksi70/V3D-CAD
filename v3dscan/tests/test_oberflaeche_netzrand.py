"""Oberflächentest v1.3: Punkt als Skizzenelement (Klick, Bedingung auf Linie), Netzrand: Bucht per 2 Klicks füllen."""
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
PORT = int(os.environ.get("V3DSCAN_TEST_PORT") or 18802)
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

            r = seite.evaluate("(() => { const r = document.querySelector('#leinwand').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()")
            entfokus()
            # --- Punkt als Skizzenelement: per Klick zeichnen, auf Linie legen ---
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
            seite.select_option("#skzArt", "punkt")
            seite.click("#wfInhalt [data-aktion=skzStart]")
            x, y = bildschirm((42, 9, 10))
            seite.mouse.click(x, y)
            seite.wait_for_function("v3dscan.S.skVorschau.daten.ketten.length === 2", timeout=30000)
            leer()
            texte = seite.eval_on_selector_all("#skElemente .el > span:first-child", "e => e.map(x => x.textContent)")
            pruefe(any("Punkt (" in t for t in texte), "Punkt per Klick gezeichnet: %s" % texte[-1])
            seite.locator("#skElemente .el").nth(4).click()
            seite.select_option("#skeArt", "auf_linie")
            seite.fill("#skeBezug", "1.3")
            seite.click("#wfInhalt [data-aktion=skeAusfuehren]")
            time.sleep(0.4)
            leer()
            pt = seite.evaluate("v3dscan.S.skVorschau.daten.ketten[1].elemente[0].a")
            oben = seite.evaluate("v3dscan.S.skVorschau.daten.ketten[0].elemente[2].a[1]")
            pruefe(abs(pt[1] - oben) < 1e-4, "Punkt auf die obere Rechteckseite gelegt (y %.3f = %.3f)" % (pt[1], oben))
            bed = seite.eval_on_selector_all("#skBedingungen .el > span:first-child", "e => e.map(x => x.textContent)")
            pruefe(bed == ["auf Linie K2/E1 ↔ K1/E3"], "Bedingungsliste: %s" % bed)
            seite.click("#wfZu") if seite.locator("#wfZu").count() else None
            # --- Netzrand: offenes Netz mit Kerbe laden, Bucht per 2 Klicks fuellen ---
            sys.path.insert(0, WURZEL)
            from kern.wolke import Scan, ausgeben
            import numpy as np
            n = 41
            u, v = np.meshgrid(np.linspace(100, 140, n), np.linspace(0, 40, n))
            X = np.c_[u.ravel(), v.ravel(), np.zeros(n * n)]
            T = []
            for i in range(n - 1):
                for j in range(n - 1):
                    a = i * n + j
                    cx, cy = X[a, 0] + 0.5, X[a, 1] + 0.5
                    if 115 < cx < 125 and cy > 32:
                        continue
                    T += [[a, a + 1, a + n + 1], [a, a + n + 1, a + n]]
            with tempfile.TemporaryDirectory() as tmp:
                ausgeben(Scan("kerbe", X, tri=np.array(T)), os.path.join(tmp, "kerbe.ply"), "ply")
                kid = seite.evaluate("""async (b) => { const r = await fetch('/api/import?name=kerbe.ply', {method: 'POST', body: new Uint8Array(b)});
                  return (await r.json()).neu; }""", list(open(os.path.join(tmp, "kerbe.ply"), "rb").read()))
            seite.reload()
            seite.wait_for_function("window.v3dscan && v3dscan.S.scans.size === 2", timeout=60000)
            seite.evaluate("v3dscan.S.aktiv = %d" % kid)
            seite.evaluate("""(() => { const {kamera, steuerung} = v3dscan; kamera.up.set(0, 1, 0); kamera.position.set(130, 25, 120);
              steuerung.target.set(130, 25, 0); kamera.lookAt(130, 25, 0); steuerung.update(); })()""")
            time.sleep(0.3)
            oeffne("polygone", "w-netz-rand")
            seite.select_option("#randArt", "bucht")
            for p in ((114.7, 39.7, 0), (125.3, 39.7, 0)):
                x, y = bildschirm(p)
                assert seite.evaluate("([x, y]) => document.elementFromPoint(x, y).id", [x, y]) == "leinwand", "Klick unter einem Fenster"
                seite.mouse.click(x, y)
                time.sleep(0.2)
            pruefe(seite.evaluate("v3dscan.S.randPunkte.length") == 2, "zwei Randpunkte angeklickt")
            vorher = seite.evaluate("v3dscan.S.zustand.scans.find(s => s.id === %d).dreiecke" % kid)
            seite.click("#wfInhalt [data-anwenden]")
            seite.wait_for_function("v3dscan.S.zustand.scans.find(s => s.id === %d).dreiecke > %d" % (kid, vorher), timeout=60000)
            leer()
            nach = seite.evaluate("v3dscan.S.zustand.scans.find(s => s.id === %d).dreiecke" % kid)
            pruefe(nach > vorher, "Bucht gefüllt: %d → %d Dreiecke" % (vorher, nach))
            pruefe(seite.evaluate("v3dscan.S.randPunkte.length") == 0, "Randpunkte nach dem Anwenden zurückgesetzt")
            seite.screenshot(path=os.path.join(BILDER, "netzrand_punkt.png"))
            pruefe(not konsole, "keine Konsolenfehler: %s" % konsole[:3])
            browser.close()
    finally:
        if dienst:
            dienst.terminate()
            dienst.wait(10)


if __name__ == "__main__":
    main()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
