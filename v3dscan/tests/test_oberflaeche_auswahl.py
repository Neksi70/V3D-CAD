"""Oberflächentest Auswahl (v1.2): Pinsel, Vergrößern/Verkleinern, Verbergen/Alle zeigen, Zauberstab mit Winkel."""
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
PORT = int(os.environ.get("V3DSCAN_TEST_PORT") or 18796)
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
            gewaehlt = lambda: seite.evaluate("(() => { let n = 0; for (const e of v3dscan.S.scans.values()) for (let i = 0; i < e.n; i++) n += e.sel[i]; return n; })()")  # noqa: E731
            oeffne("start", "w-auswahl")
            r = seite.evaluate("(() => { const r = document.querySelector('#leinwand').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()")
            # Pinsel: Strich ueber die Plattenmitte
            seite.click("#wfInhalt [data-werkzeug=pinsel]")
            seite.fill("#pinselGroesse", "15")
            a = bildschirm((20, 20, 10))
            b = bildschirm((45, 20, 10))
            seite.mouse.move(*a)
            seite.mouse.down()
            seite.mouse.move(*b, steps=12)
            seite.mouse.up()
            time.sleep(0.3)
            n1 = gewaehlt()
            z = seite.evaluate("""(() => { const zs = []; for (const e of v3dscan.S.scans.values())
              for (let i = 0; i < e.n; i++) if (e.sel[i]) zs.push(e.xyz[i * 3 + 2]); return [Math.min(...zs), Math.max(...zs)]; })()""")
            pruefe(n1 > 5 and z[0] > 9, "Pinselstrich wählt %d Punkte der Oberseite (z %.2f–%.2f)" % (n1, z[0], z[1]))
            seite.click("#wfInhalt [data-aktion=vergroessern]")
            time.sleep(0.3)
            leer()
            n2 = gewaehlt()
            pruefe(n2 > n1, "Vergrößern: %d → %d" % (n1, n2))
            seite.click("#wfInhalt [data-aktion=verkleinern]")
            time.sleep(0.3)
            leer()
            seite.click("#wfInhalt [data-aktion=verkleinern]")
            time.sleep(0.3)
            leer()
            n3 = gewaehlt()
            pruefe(n3 < n2, "Verkleinern: %d → %d" % (n2, n3))
            # Verbergen: Auswahl verschwindet und ist nicht mehr waehlbar
            seite.click("#wfInhalt [data-aktion=verbergen]")
            time.sleep(0.2)
            vb = seite.evaluate("(() => { let n = 0; for (const e of v3dscan.S.scans.values()) if (e.verborgen) for (let i = 0; i < e.n; i++) n += e.verborgen[i]; return n; })()")
            pruefe(vb == n3 and gewaehlt() == 0, "Verbergen: %d Punkte ausgeblendet" % vb)
            seite.keyboard.press("Control+a")
            time.sleep(0.2)
            alle = seite.evaluate("(() => { let n = 0; for (const e of v3dscan.S.scans.values()) n += e.n; return n; })()")
            pruefe(gewaehlt() == alle - vb, "Alles wählen lässt Verborgenes aus (%d von %d)" % (gewaehlt(), alle))
            seite.click("#wfInhalt [data-aktion=alleZeigen]")
            seite.keyboard.press("Escape")
            seite.evaluate("v3dscan.auswahlAlle ? v3dscan.auswahlAlle(0) : null")
            time.sleep(0.2)
            pruefe(seite.evaluate("[...v3dscan.S.scans.values()].every(e => !e.verborgen)"), "Alle zeigen")
            # Zauberstab auf der Oberseite
            seite.evaluate("(() => { for (const e of v3dscan.S.scans.values()) e.sel.fill(0); })()")
            seite.click("#wfInhalt [data-werkzeug=zauberstab]")
            seite.fill("#zauberWinkel", "15")
            x, y = bildschirm((40, 30, 10))
            pruefe(seite.evaluate("([x, y]) => document.elementFromPoint(x, y).id", [x, y]) == "leinwand", "Klickpunkt frei")
            seite.mouse.click(x, y)
            time.sleep(0.5)
            leer()
            nz = gewaehlt()
            z = seite.evaluate("""(() => { const zs = []; for (const e of v3dscan.S.scans.values())
              for (let i = 0; i < e.n; i++) if (e.sel[i]) zs.push(e.xyz[i * 3 + 2]); return zs.length ? [Math.min(...zs), Math.max(...zs)] : [0, 0]; })()""")
            pruefe(nz > 20 and z[0] > 9, "Zauberstab wählt %d Punkte, nur Oberseite (z %.2f–%.2f)" % (nz, z[0], z[1]))
            seite.screenshot(path=os.path.join(BILDER, "auswahl.png"))
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
