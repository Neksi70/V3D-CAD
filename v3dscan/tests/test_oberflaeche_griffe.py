"""Oberflächentest v1.5: Ziehgriffe – Scan ausrichten, Käfig-Ecke, Grundkörper (Mitte/Größe), Referenzebene."""
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
PORT = int(os.environ.get("V3DSCAN_TEST_PORT") or 18806)
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
            ziehen = """(f) => { const {griff, griffObjekt} = v3dscan.griffTest(); f(griffObjekt); griffObjekt.updateMatrixWorld(true);
              griff.dispatchEvent({type: 'objectChange'}); griff.dispatchEvent({type: 'dragging-changed', value: true});
              griff.dispatchEvent({type: 'dragging-changed', value: false}); }"""
            box = lambda: seite.evaluate("(() => { const e = [...v3dscan.S.scans.values()][0]; const b = new (e.geo.boundingBox.constructor)().copy(e.geo.boundingBox).applyMatrix4(e.obj.matrix); return [b.min.x, b.min.y, b.min.z]; })()")  # noqa: E731
            # 1) Scan mit Griff verschieben (Align Interactive)
            oeffne("ausrichten", "w-koord-werte")
            b0 = box()
            seite.check("#wertGriff")
            seite.evaluate("(z) => { const f = new Function('return ' + z)(); f(o => { o.position.x += 5; o.position.z += 2; }); }", ziehen)
            time.sleep(0.3)
            pruefe(abs(float(seite.input_value("#wertVX")) - 5) < 1e-6, "Werte laufen mit: X = %s" % seite.input_value("#wertVX"))
            seite.click("#wfInhalt [data-aktion=koordAnwenden]")
            time.sleep(0.5)
            leer()
            zust = seite.evaluate("v3dscan.S.zustand.undo")
            pruefe("ausgerichtet" in (zust or ""), "Griff-Ausrichtung übernommen (%s)" % zust)
            # echte Maus: am X-Pfeil des Griffs ziehen (Bildschirmrichtung der Weltachse X)
            seite.check("#wertGriff")
            time.sleep(0.3)
            mitte = seite.evaluate("(() => { const {griffObjekt} = v3dscan.griffTest(); return griffObjekt.position.toArray(); })()")
            gezogen = False
            for k in (0.4, 0.55, 0.7, 0.85, 1.0, 1.2):
                d = seite.evaluate("""([m, k]) => { const {kamera, steuerung} = v3dscan; const s = kamera.position.distanceTo(steuerung.target) * 0.15 * k;
                  const p = new kamera.position.constructor(m[0] + s, m[1], m[2]).project(kamera); const c = document.querySelector('#leinwand').getBoundingClientRect();
                  return [c.left + (p.x + 1) / 2 * c.width, c.top + (1 - p.y) / 2 * c.height]; }""", [mitte, k])
                seite.mouse.move(d[0], d[1])
                time.sleep(0.1)
                seite.mouse.down()
                seite.mouse.move(d[0] + 40, d[1], steps=6)
                seite.mouse.up()
                time.sleep(0.2)
                neu = seite.evaluate("(() => { const {griffObjekt} = v3dscan.griffTest(); return griffObjekt.position.toArray(); })()")
                if math.dist(neu, mitte) > 0.01:
                    gezogen = abs(neu[1] - mitte[1]) < 1e-6 and abs(neu[2] - mitte[2]) < 1e-6
                    break
            pruefe(gezogen, "echtes Ziehen am X-Pfeil bewegt nur in X")
            seite.click("#wfInhalt [data-aktion=koordZurueck]")
            seite.uncheck("#wertGriff")
            # 2) Kaefig-Ecke mit Griff
            oeffne("freiform", "w-auto-flaechen")
            seite.fill("#afAnzahl", "150")
            seite.click("#wfInhalt [data-aktion=afVorschau]")
            seite.wait_for_function("v3dscan.S.kaefig !== null", timeout=60000)
            leer()
            seite.evaluate("document.querySelector('#kgEditor').open = true")
            seite.evaluate("v3dscan.S.kaefig.wahl = {ecken: [3], kanten: new Set(), flaechen: new Set()}")
            p0 = seite.evaluate("Array.from(v3dscan.S.kaefig.V.slice(9, 12))")
            seite.select_option("#kgModus", "griff")
            time.sleep(0.2)
            seite.evaluate("(z) => { const f = new Function('return ' + z)(); f(o => { o.position.z += 1.5; }); }", ziehen)
            p1 = seite.evaluate("Array.from(v3dscan.S.kaefig.V.slice(9, 12))")
            pruefe(abs(p1[2] - p0[2] - 1.5) < 1e-4 and abs(p1[0] - p0[0]) < 1e-6, "Käfig-Ecke mit Griff um 1,5 mm in Z gezogen")
            seite.select_option("#kgModus", "ziehen")
            # 3) Grundkoerper: Griff verschiebt die Mitte, Groesse per Skalieren
            oeffne("modell", "w-gk-eingabe")
            seite.select_option("#geArt", "quader")
            seite.fill("#geMitte", "100; 0; 5")
            seite.fill("#geGroesse", "10; 10; 10")
            seite.check("#geGriff")
            seite.wait_for_function("!!v3dscan.S.featVorschau", timeout=30000)
            leer()
            seite.evaluate("(z) => { const f = new Function('return ' + z)(); f(o => { o.position.x += 7; }); }", ziehen)
            time.sleep(0.8)
            leer()
            pruefe(seite.input_value("#geMitte").startswith("107"), "Griff verschiebt die Mitte: %s" % seite.input_value("#geMitte"))
            seite.select_option("#geGriffModus", "scale")
            time.sleep(0.3)
            seite.evaluate("(z) => { const f = new Function('return ' + z)(); f(o => { o.scale.set(2, 1, 1.5); }); }", ziehen)
            time.sleep(0.8)
            leer()
            pruefe(seite.input_value("#geGroesse").replace(" ", "") == "20;10;15", "Griff ändert die Größe: %s" % seite.input_value("#geGroesse"))
            seite.uncheck("#geGriff")
            # 4) Referenzebene mit Griff drehen
            seite.evaluate("v3dscan.api('referenz/eingabe', {punkt: [0, 0, 0], normale: [0, 0, 1]})")
            time.sleep(0.5)
            oeffne("konstruktion", "w-referenz")
            seite.check("#rfGriff")
            seite.select_option("#rfGriffModus", "rotate")
            time.sleep(0.2)
            seite.evaluate("(z) => { const f = new Function('return ' + z)(); f(o => { o.rotateX(Math.PI / 18); o.position.z += 3; }); }", ziehen)
            seite.wait_for_function("v3dscan.S.zustand.referenzen.some(r => Math.abs(r.normale[2] - Math.cos(Math.PI / 18)) < 1e-4)", timeout=30000)
            r = seite.evaluate("v3dscan.S.zustand.referenzen.slice(-1)[0]")
            pruefe(abs(r["punkt"][2] - 3) < 1e-4, "Referenzebene um 10° gedreht und 3 mm verschoben: n=%s p=%s" % (r["normale"], r["punkt"]))
            seite.uncheck("#rfGriff")
            pruefe(not konsole, "keine Konsolenfehler: %s" % konsole[:3])
            seite.screenshot(path=os.path.join(BILDER, "griffe.png"))
            browser.close()
    finally:
        if dienst:
            dienst.terminate()
            dienst.wait(10)


if __name__ == "__main__":
    main()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
