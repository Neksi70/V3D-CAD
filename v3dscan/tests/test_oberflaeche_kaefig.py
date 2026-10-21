"""Oberflächentest Freiform-Editor (v1.2): Vierecke/Kanten/Ecken wählen, Löschen, Extrudieren, Schleife,\nVerschieben entlang der Normale, Pinsel-Glätten, Isolieren, Umdrehen, unregelmäßige Ecken."""
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
PORT = int(os.environ.get("V3DSCAN_TEST_PORT") or 18794)
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

            seite.evaluate("v3dscan.einpassen()")
            oeffne("modell", "w-auto-flaechen")
            seite.fill("#afAnzahl", "200")
            seite.click("#wfInhalt [data-aktion=afVorschau]")
            seite.wait_for_function("v3dscan.S.kaefig !== null", timeout=60000)
            leer()
            entfokus()
            seite.evaluate("document.querySelector('#kgEditor').open = true")
            n = lambda: seite.evaluate("v3dscan.S.kaefig.F.length / 4")  # noqa: E731
            wahl = lambda: seite.evaluate("(() => { const w = v3dscan.S.kaefig.wahl; return [w.ecken.length, w.kanten.size, w.flaechen.size]; })()")  # noqa: E731
            irr = seite.inner_text("#kgIrrInfo")
            pruefe("unregelmäßige" in irr, "unregelmäßige Ecken angezeigt: „%s“" % irr)
            r = seite.evaluate("(() => { const r = document.querySelector('#leinwand').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()")

            def schirm_von(ausdruck):
                # Bildschirmpunkt eines Kaefig-Punkts (Weltkoordinaten aus JS-Ausdruck)
                p = seite.evaluate(ausdruck)
                return bildschirm(p)

            # Viereck in der Bildmitte wählen
            seite.select_option("#kgModus", "flaechen")
            mitte = None
            for dx, dy in ((0, 0), (40, 20), (-40, -20), (60, -30)):
                x, y = r[0] + r[2] / 2 + dx, r[1] + r[3] / 2 + dy
                f = seite.evaluate("([x, y]) => v3dscan.kaefigFlaecheAn(x, y)", [x - r[0], y - r[1]])
                if f is not None:
                    mitte = (x, y, f)
                    break
            seite.mouse.click(mitte[0], mitte[1])
            time.sleep(0.2)
            pruefe(wahl() == [0, 0, 1], "Viereck %d per Klick gewählt" % mitte[2])
            vorher = n()
            seite.click("#wfInhalt [data-aktion=kgLoeschen]")
            seite.wait_for_function("v3dscan.S.kaefig.F.length / 4 === %d" % (vorher - 1), timeout=30000)
            leer()
            pruefe(True, "Viereck gelöscht (%d → %d)" % (vorher, n()))
            # Randkante des neuen Lochs wählen und extrudieren (wieder zuklappen geht nicht – nur Zählung)
            rand = seite.evaluate("""() => { const {V, F} = v3dscan.S.kaefig, kz = new Map();
              for (let f = 0; f < F.length / 4; f++) for (let e = 0; e < 4; e++) { const a = F[f*4+e], b = F[f*4+(e+1)%4];
                const k = a < b ? a + '-' + b : b + '-' + a; kz.set(k, (kz.get(k) || 0) + 1); }
              const r = []; for (const [k, c] of kz) if (c === 1) { const [a, b] = k.split('-').map(Number);
                r.push([k, [(V[a*3]+V[b*3])/2, (V[a*3+1]+V[b*3+1])/2, (V[a*3+2]+V[b*3+2])/2]]); } return r; }""")
            seite.select_option("#kgModus", "kanten")
            gewaehlt = None
            for k, p in rand:
                x, y = bildschirm(p)
                if seite.evaluate("([x, y]) => v3dscan.kaefigKanteAn(x, y)", [x - r[0], y - r[1]]) == k:
                    seite.mouse.click(x, y)
                    gewaehlt = k
                    break
            time.sleep(0.2)
            pruefe(gewaehlt is not None and wahl() == [0, 1, 0], "Randkante %s am Loch per Klick gewählt" % gewaehlt)
            vorher = n()
            seite.fill("#kgLaenge", "2")
            seite.click("#wfInhalt [data-aktion=kgExtrudieren]")
            seite.wait_for_function("v3dscan.S.kaefig.F.length / 4 === %d" % (vorher + 1), timeout=30000)
            leer()
            pruefe(True, "Randkante extrudiert (+1 Viereck)")
            # Schleife einfügen an einer Innenkante in der Bildmitte
            seite.select_option("#kgModus", "kanten")
            x, y = r[0] + r[2] / 2 - 70, r[1] + r[3] / 2 + 50
            k = None
            for dx in range(0, 200, 7):
                k = seite.evaluate("([x, y]) => v3dscan.kaefigKanteAn(x, y)", [x + dx - r[0], y - r[1]])
                if k:
                    seite.mouse.click(x + dx, y)
                    break
            time.sleep(0.2)
            vorher = n()
            seite.click("#wfInhalt [data-aktion=kgSchleife]")
            seite.wait_for_function("v3dscan.S.kaefig.F.length / 4 > %d" % vorher, timeout=30000)
            leer()
            pruefe(n() > vorher + 2, "Schleife eingefügt: %d → %d Vierecke" % (vorher, n()))
            # Ecken: wählen, entlang der Normale verschieben
            seite.select_option("#kgModus", "ecken")
            ecke = None
            for dx in range(0, 300, 5):
                xx, yy = r[0] + r[2] / 2 - 150 + dx, r[1] + r[3] / 2
                i = seite.evaluate("([x, y]) => v3dscan.kaefigEckeAn(x, y)", [xx - r[0], yy - r[1]])
                frei = seite.evaluate("([x, y]) => document.elementFromPoint(x, y).id === 'leinwand'", [xx, yy])
                if i is not None and frei:
                    ecke = i
                    seite.mouse.click(xx, yy)
                    break
            time.sleep(0.2)
            pos0 = seite.evaluate("Array.from(v3dscan.S.kaefig.V.slice(%d * 3, %d * 3 + 3))" % (ecke, ecke))
            seite.fill("#kgDn", "1.5")
            seite.click("#wfInhalt [data-aktion=kgVerschieben]")
            time.sleep(0.3)
            leer()
            pos1 = seite.evaluate("Array.from(v3dscan.S.kaefig.V.slice(%d * 3, %d * 3 + 3))" % (ecke, ecke))
            pruefe(abs(math.dist(pos0, pos1) - 1.5) < 1e-3, "Ecke %d um 1,5 mm entlang der Normale verschoben (%.3f)" % (ecke, math.dist(pos0, pos1)))
            seite.fill("#kgDn", "0")
            # Pinsel-Glätten über die Bildmitte
            seite.click("#wfInhalt [data-aktion=kgWahlLeeren]")
            seite.select_option("#kgModus", "pinsel")
            V0 = seite.evaluate("Array.from(v3dscan.S.kaefig.V)")
            cx, cy = r[0] + r[2] / 2, r[1] + r[3] / 2
            seite.mouse.move(cx - 60, cy)
            seite.mouse.down()
            seite.mouse.move(cx + 60, cy, steps=10)
            seite.mouse.up()
            time.sleep(0.5)
            leer()
            V1 = seite.evaluate("Array.from(v3dscan.S.kaefig.V)")
            bewegt = sum(1 for i in range(0, len(V0), 3) if math.dist(V0[i:i + 3], V1[i:i + 3]) > 1e-4)
            pruefe(bewegt > 0, "Pinsel glättet %d Ecken" % bewegt)
            # Verbergen / Isolieren / alle zeigen
            seite.select_option("#kgModus", "flaechen")
            for dx, dy in ((0, 0), (40, 20), (-40, -20)):
                f = seite.evaluate("([x, y]) => v3dscan.kaefigFlaecheAn(x, y)", [r[2] / 2 + dx, r[3] / 2 + dy])
                if f is not None:
                    seite.mouse.click(cx + dx, cy + dy)
                    break
            time.sleep(0.2)
            seite.click("#wfInhalt [data-aktion=kgIsolieren]")
            time.sleep(0.2)
            pruefe(seite.evaluate("v3dscan.S.kaefig.versteckt.size") == n() - 1, "Isolieren: nur 1 Viereck sichtbar")
            seite.click("#wfInhalt [data-aktion=kgAlleZeigen]")
            time.sleep(0.2)
            pruefe(seite.evaluate("v3dscan.S.kaefig.versteckt.size") == 0, "Alle wieder sichtbar")
            vorher = seite.evaluate("Array.from(v3dscan.S.kaefig.F.slice(0, 4))")
            seite.click("#wfInhalt [data-aktion=kgUmdrehen]")
            time.sleep(0.3)
            leer()
            pruefe(seite.evaluate("Array.from(v3dscan.S.kaefig.F.slice(0, 4))") == vorher[::-1], "Normalen umgedreht")
            seite.screenshot(path=os.path.join(BILDER, "kaefig_editor.png"))
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
