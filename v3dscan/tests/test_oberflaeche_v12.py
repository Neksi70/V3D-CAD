"""Oberflächentest v1.2-Nachträge: Ansichtswürfel, Beispiel laden, Grundkörper per Eingabe, Referenz aus\nKörperfläche, Kreis-Auswahl, Viereck per 4 Klicks."""
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
PORT = int(os.environ.get("V3DSCAN_TEST_PORT") or 18801)
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
            # Ansichtswuerfel: Mitte des Wuerfels anklicken -> Kamera schaut genau auf diese Seite
            seite.evaluate("v3dscan.einpassen()")
            wx, wy = r[0] + r[2] - 8 - 48, r[1] + 8 + 48
            m = seite.evaluate("([x, y]) => { const t = v3dscan.wuerfelTreffer(x, y); return t && t.userData.name; }", [wx - r[0], wy - r[1]])
            seite.mouse.click(wx, wy)
            time.sleep(0.3)
            d = seite.evaluate("""(() => { const {kamera, steuerung} = v3dscan; const v = kamera.position.clone().sub(steuerung.target).normalize();
              return [v.x, v.y, v.z]; })()""")
            pruefe(m is not None and max(abs(x) for x in d) > 0.999, "Würfelseite „%s“ angeklickt → Blick achsparallel %s" % (m, [round(x, 3) for x in d]))
            # Beispiel laden
            seite.click("#knopfMenue") if seite.locator("#knopfMenue").count() else None
            seite.evaluate("document.querySelector('#beispielWahl').value = 'torus_freiform.ply'")
            vorher = seite.evaluate("v3dscan.S.scans.size")
            seite.evaluate("v3dscan.aktionAusfuehren('beispielLaden')")
            seite.wait_for_function("v3dscan.S.scans.size === %d" % (vorher + 1), timeout=60000)
            leer()
            pruefe(True, "Beispiel „Torus“ aus dem Menü geladen")
            # Grundkoerper per Eingabe
            oeffne("modell", "w-gk-eingabe")
            seite.select_option("#geArt", "zylinder")
            seite.fill("#geMitte", "200; 0; 10")
            seite.fill("#geRadius", "6")
            seite.fill("#geHoehe", "20")
            seite.click("#wfInhalt [data-aktion=geAnwenden]")
            seite.wait_for_function("v3dscan.S.zustand.koerper.length === 1", timeout=60000)
            leer()
            vol = seite.evaluate("v3dscan.S.zustand.koerper[0].volumen")
            pruefe(abs(vol - math.pi * 36 * 20) < 1, "Zylinder Ø12 × 20 per Eingabe: %.1f mm³" % vol)
            # Referenz aus Koerperflaeche: Mantel anklicken -> Achse
            oeffne("konstruktion", "w-ref-flaeche")
            seite.evaluate("""(() => { const {kamera, steuerung} = v3dscan; kamera.up.set(0, 0, 1); kamera.position.set(260, -60, 40);
              steuerung.target.set(200, 0, 10); kamera.lookAt(200, 0, 10); steuerung.update(); })()""")
            time.sleep(0.3)
            x, y = bildschirm((205, -4, 10))
            seite.mouse.click(x, y)
            time.sleep(0.3)
            n = seite.evaluate("v3dscan.S.fwahl.size")
            seite.click("#wfInhalt [data-aktion=rkAnwenden]")
            time.sleep(0.5)
            leer()
            ref = seite.evaluate("v3dscan.S.zustand.referenzen.slice(-1)[0]")
            pruefe(n == 1 and ref and ref["art"] == "achse" and abs(abs(ref["richtung"][2]) - 1) < 1e-6,
                   "Mantel angeklickt → Achse Z: %s" % (ref and ref.get("art")))
            # Kreis-Auswahl
            oeffne("start", "w-auswahl")
            seite.click("#wfInhalt [data-werkzeug=kreis]")
            seite.evaluate("v3dscan.einpassen()")
            time.sleep(0.2)
            cx, cy = r[0] + r[2] * 0.6, r[1] + r[3] * 0.5
            seite.mouse.move(cx, cy)
            seite.mouse.down()
            seite.mouse.move(cx + 80, cy, steps=5)
            seite.mouse.up()
            time.sleep(0.3)
            n = seite.evaluate("(() => { let n = 0; for (const e of v3dscan.S.scans.values()) for (let i = 0; i < e.n; i++) n += e.sel[i]; return n; })()")
            pruefe(n > 0, "Kreis-Auswahl wählt %d Punkte" % n)
            seite.keyboard.press("Escape")
            seite.click("#wfInhalt [data-werkzeug=orbit]") if seite.locator("#wfInhalt [data-werkzeug=orbit]").count() else seite.evaluate("v3dscan.werkzeugSetzen('orbit')")
            seite.evaluate("v3dscan.werkzeugSetzen('orbit')")
            # Viereck per 4 Klicks (ohne vorhandenen Kaefig) auf der Platte
            oeffne("freiform", "w-auto-flaechen")
            seite.evaluate("document.querySelector('#kgEditor').open = true")
            sid = seite.evaluate("v3dscan.S.zustand.scans[0].id")
            seite.select_option("#afScan", str(sid))
            seite.select_option("#kgModus", "viereck")
            draufsicht()
            for p in ((38, 8, 10), (48, 8, 10), (48, 22, 10), (38, 22, 10)):
                x, y = bildschirm(p)
                seite.mouse.click(x, y)
                time.sleep(0.2)
            k = seite.evaluate("v3dscan.S.kaefig && [v3dscan.S.kaefig.V.length / 3, v3dscan.S.kaefig.F.length / 4]")
            pruefe(k == [4, 1], "Viereck aus 4 Klicks: %s" % k)
            for p in ((48, 8, 10), (58, 8, 10), (58, 22, 10), (48, 22, 10)):
                x, y = bildschirm(p)
                seite.mouse.click(x, y)
                time.sleep(0.2)
            k = seite.evaluate("v3dscan.S.kaefig && [v3dscan.S.kaefig.V.length / 3, v3dscan.S.kaefig.F.length / 4]")
            pruefe(k == [6, 2], "zweites Viereck schließt an (2 Ecken geteilt): %s" % k)
            seite.screenshot(path=os.path.join(BILDER, "v12.png"))
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
