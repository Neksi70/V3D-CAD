"""Oberflächentest Freiform + Körper-Werkzeuge (v0.8).

Torus-Netz laden → Automatische Flächen (Vorschau + Erzeugen) → Kopie verschieben → Schnittmenge →
Spiegeln → Punkte wählen → Fläche aus Auswahl → Aufdicken. Alles über das Menüband MODELL.
"""
import os
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL = os.path.dirname(HIER)
DATEN = os.path.join(HIER, "daten")
BILDER = os.path.join(HIER, "bilder")
PORT = int(os.environ.get("V3DSCAN_TEST_PORT") or 18791)
BASIS = "http://127.0.0.1:%d" % PORT
fehler = []


def pruefe(bed, text):
    print(("  ok   " if bed else "  FEHLER ") + text)
    if not bed:
        fehler.append(text)


def testdatei():
    pfad = os.path.join(DATEN, "torus_netz.ply")
    if not os.path.exists(pfad):
        sys.path.insert(0, HIER)
        sys.path.insert(0, WURZEL)
        from test_freiform import torus
        from kern.wolke import Scan, ausgeben
        X, T, _ = torus()
        os.makedirs(DATEN, exist_ok=True)
        ausgeben(Scan("torus", X, tri=T), pfad, "ply")
    return pfad


def main():
    pfad = testdatei()
    os.makedirs(BILDER, exist_ok=True)
    dienst = None
    if not os.environ.get("V3DSCAN_TEST_PORT"):
        dienst = subprocess.Popen([sys.executable, os.path.join(WURZEL, "server.py"), "--port", str(PORT),
                                   "--laden", pfad], cwd=WURZEL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(BASIS + "/api/puls", timeout=1)
                break
            except Exception:
                time.sleep(0.2)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            seite = browser.new_page(viewport={"width": 1500, "height": 950})
            konsole = []
            seite.on("console", lambda m: konsole.append(m.text) if m.type == "error" else None)
            seite.on("pageerror", lambda e: konsole.append(str(e)))
            seite.goto(BASIS + "/")
            seite.wait_for_function("window.v3dscan && v3dscan.S.scans.size === 1", timeout=30000)
            leer = lambda: seite.wait_for_function("!v3dscan.S.beschaeftigt", timeout=300000)  # noqa: E731

            def oeffne(band, teil):
                if seite.evaluate("!!document.querySelector('#wfInhalt #%s')" % teil):
                    return
                # Reiter des Werkzeugs selbst finden (Menüband ist nach Arbeitsschritten aufgeteilt)
                band = seite.evaluate("(t) => document.querySelector(`#band [data-wf~='${t}']`).closest('[data-bandseite]').dataset.bandseite", teil)
                seite.click("#bandReiter [data-band=%s]" % band)
                seite.click("[data-bandseite=%s] [data-wf~='%s']" % (band, teil))

            def koerper():
                return seite.evaluate("v3dscan.S.zustand.koerper.map(k => k.name)")

            oeffne("modell", "w-auto-flaechen")
            pruefe(seite.inner_text("#wfTitel") == "Automatische Flächen", "Werkzeug über Menüband")
            seite.fill("#afAnzahl", "300")
            seite.click("#wfInhalt [data-aktion=afVorschau]")
            seite.wait_for_function("document.querySelector('#afInfo').textContent.includes('Vierecke')", timeout=60000)
            leer()
            pruefe(koerper() == [], "Vorschau: %s" % seite.inner_text("#afInfo"))
            seite.keyboard.press("4")
            time.sleep(0.4)
            seite.screenshot(path=os.path.join(BILDER, "freiform_vierecke.png"))
            seite.click("#wfOk")
            seite.wait_for_function("document.querySelector('#afInfo').textContent.includes('Abweichung')", timeout=300000)
            leer()
            info = seite.inner_text("#afInfo")
            pruefe("geschlossener Volumenkörper" in info and koerper() == ["Freiform1"], "Erzeugt: %s" % info.replace("\n", " | "))
            seite.screenshot(path=os.path.join(BILDER, "freiform_koerper.png"))

            oeffne("modell", "w-verschieben")
            seite.fill("#vsZ", "5")
            seite.check("#vsKopie")
            seite.click("#wfOk")
            seite.wait_for_function("v3dscan.S.zustand.koerper.length === 2", timeout=120000)
            leer()
            pruefe(koerper() == ["Freiform1", "Kopie1"], "Kopie um Z 5 verschoben: %s" % koerper())

            oeffne("modell", "w-bool")
            seite.select_option("#boArt", "schneiden")
            pruefe(seite.eval_on_selector("#boA", "e => e.selectedOptions[0].textContent") !=
                   seite.eval_on_selector("#boB", "e => e.selectedOptions[0].textContent"),
                   "zweiter Körper vorbelegt mit einem anderen")
            seite.click("#wfInhalt [data-aktion=kwVorschau]")
            seite.wait_for_function("document.querySelector('#w-bool .kwInfo').textContent.includes('Volumen')", timeout=300000)
            leer()
            seite.click("#wfOk")
            seite.wait_for_function("v3dscan.S.zustand.koerper.length === 1", timeout=300000)
            leer()
            pruefe("Kombination1" in seite.inner_text("#verlaufListe"), "Schnittmenge → Kombination1 im Verlauf")

            oeffne("modell", "w-spiegeln")
            seite.select_option("#spEbene", "xy")
            seite.select_option("#spDurch", "ursprung")
            seite.uncheck("#spVereinen")
            seite.click("#wfOk")
            seite.wait_for_function("[...document.querySelectorAll('#verlaufListe .schritt')].some(e => e.textContent.includes('Spiegeln1'))", timeout=120000)
            leer()
            pruefe(True, "Spiegeln1 im Verlauf")

            # Punkte auf der Oberseite wählen (wie Lasso-Ergebnis) -> Fläche -> Aufdicken
            n = seite.evaluate("""() => { const {S, auswahlAnwenden} = v3dscan; const e = [...S.scans.values()][0];
              let n = 0; for (let i = 0; i < e.n; i++) { const w = e.xyz[i*3+2] > 6 && e.xyz[i*3] > 20; e.sel[i] = w ? 1 : 0; n += w; }
              return n; }""")
            oeffne("modell", "w-flaeche")
            seite.fill("#flVerl", "0")
            seite.click("#wfInhalt [data-aktion=flVorschau]")
            seite.wait_for_function("document.querySelector('#flInfo').textContent.includes('Raster')", timeout=120000)
            leer()
            pruefe(("%s Punkte" % format(n, ",").replace(",", ".")) in seite.inner_text("#flInfo"),
                   "Fläche-Vorschau: %s" % seite.inner_text("#flInfo"))
            seite.click("#wfOk")
            seite.wait_for_function("v3dscan.S.zustand.koerper.some(k => k.name === 'Fläche1')", timeout=120000)
            leer()
            oeffne("modell", "w-aufdicken")
            seite.select_option("#adK", label="Fläche1")
            seite.fill("#adDicke", "1.5")
            seite.click("#wfOk")
            seite.wait_for_function("v3dscan.S.zustand.koerper.some(k => k.name === 'Aufdickung1')", timeout=120000)
            leer()
            v = seite.evaluate("v3dscan.S.zustand.koerper.find(k => k.name === 'Aufdickung1').volumen")
            pruefe(v > 0, "Aufdickung1: %.1f mm³" % v)
            seite.screenshot(path=os.path.join(BILDER, "freiform_werkzeuge.png"))
            pruefe(not konsole, "keine Konsolenfehler %s" % konsole[:3])
            browser.close()
    finally:
        if dienst:
            dienst.terminate()
            dienst.wait(10)
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)


if __name__ == "__main__":
    main()
