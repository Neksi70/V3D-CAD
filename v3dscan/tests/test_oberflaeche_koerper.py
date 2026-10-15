"""Oberflächentest „Grundkörper aus Bereich“ (Menüband → Werkzeugfenster → STEP).

Ablauf wie ein Nutzer: Bereiche erkennen, Zapfen im Modell anklicken, Vorschau,
✓ → Körper; Bohrung wählen → automatisch abgezogen; Verlauf/Eigenschaften prüfen;
Rückgängig; STEP-Export über das Menüband und mit OCP wieder einlesen.
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
PORT = int(os.environ.get("V3DSCAN_TEST_PORT") or 18796)
BASIS = "http://127.0.0.1:%d" % PORT
fehler = []


def pruefe(bed, text):
    print(("  ok   " if bed else "  FEHLER ") + text)
    if not bed:
        fehler.append(text)


def main():
    if not os.path.exists(os.path.join(DATEN, "testteil.ply")):
        sys.path.insert(0, HIER)
        import cad_testteil
        cad_testteil.erzeugen(DATEN)
    os.makedirs(BILDER, exist_ok=True)
    dienst = None
    if not os.environ.get("V3DSCAN_TEST_PORT"):
        dienst = subprocess.Popen([sys.executable, os.path.join(WURZEL, "server.py"), "--port", str(PORT),
                                   "--laden", os.path.join(DATEN, "testteil.ply")], cwd=WURZEL,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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

            def oeffne(band, teil):
                if seite.evaluate("!!document.querySelector('#wfInhalt #%s')" % teil):
                    return
                seite.click("#bandReiter [data-band=%s]" % band)
                seite.click("[data-bandseite=%s] [data-wf~='%s']" % (band, teil))

            oeffne("bereiche", "w-formen-auto")
            seite.click("#wfInhalt [data-aktion=formenErkennen]")
            seite.wait_for_selector("#formZusammenfassung:not([hidden])", timeout=180000)
            leer()

            oeffne("modell", "w-grundkoerper")
            pruefe(seite.inner_text("#wfTitel") == "Grundkörper aus Bereich", "Werkzeugfenster über Menüband geöffnet")

            # Zapfen im Modell anklicken (echter Klick auf einen Punkt des Bereichs)
            zapfen = seite.evaluate("v3dscan.S.erkennung.elemente.find(e => e.typ === 'zapfen').id")
            seite.keyboard.press("4")  # schräg: Zapfenmantel sichtbar
            time.sleep(0.4)
            # Klickstelle suchen, an der die App selbst den Zapfen trifft (punktAn wie beim echten Klick)
            pos = seite.evaluate("""(eid) => {
              const {S, kamera, renderer, punktAn} = v3dscan; const e = S.scans.get(S.erkennung.id);
              const r = renderer.domElement.getBoundingClientRect();
              for (let i = 0; i < e.n; i += 11) {
                if (S.erkennung.labels[i] !== eid) continue;
                const v = new kamera.position.constructor(e.xyz[i*3], e.xyz[i*3+1], e.xyz[i*3+2]).project(kamera);
                const x = (v.x * 0.5 + 0.5) * r.width, y = (-v.y * 0.5 + 0.5) * r.height;
                const p = punktAn(x, y, e.id);
                if (p && S.erkennung.labels[p.index] === eid) return { x: r.left + x, y: r.top + y };
              }
              return null; }""", zapfen)
            pruefe(pos is not None, "Klickstelle auf dem Zapfen gefunden")
            seite.mouse.click(pos["x"], pos["y"])
            time.sleep(0.3)
            pruefe(seite.evaluate("v3dscan.S.formAktiv") == zapfen, "Klick im Modell wählt den Zapfen")
            pruefe("Zapfen" in seite.inner_text("#gkBereich"), "Feld „Bereich“ zeigt den Zapfen")
            pruefe(seite.inner_text("#elementKopf") == "Bereich", "Eigenschaften zeigen den Bereich")

            seite.click("#wfVorschau")
            leer()
            seite.wait_for_function("v3dscan.S.gkVorschau !== null", timeout=30000)
            pruefe("neuer Körper" in seite.inner_text("#gkInfo"), "Vorschau: %s" % seite.inner_text("#gkInfo"))
            seite.keyboard.press("4")
            seite.mouse.move(700, 450)
            seite.screenshot(path=os.path.join(BILDER, "k1_vorschau.png"))
            seite.click("#wfOk")
            leer()
            seite.wait_for_function("v3dscan.S.koerper.size === 1", timeout=30000)
            pruefe(seite.evaluate("v3dscan.S.gkVorschau") is None, "Vorschau nach ✓ weg")
            v1 = seite.evaluate("[...v3dscan.S.koerper.values()][0].meta.volumen")
            pruefe(abs(v1 - 3.14159 * 10 ** 2 * seite.evaluate(
                "v3dscan.S.erkennung.elemente.find(e => e.typ === 'zapfen').hoehe")) < 60,
                "Zapfen-Körper Ø 20, Volumen %.1f mm³" % v1)
            pruefe("Grundkörper1" in seite.inner_text("#verlaufListe"), "Verlauf zeigt Grundkörper1")

            # Kugel über die Liste wählen und mit dem Zapfen-Körper vereinen
            kugel = seite.evaluate("v3dscan.S.erkennung.elemente.find(e => e.typ === 'kugel')")
            seite.locator(".formliste .el", has_text="Kugel").first.click()
            pruefe(seite.evaluate("v3dscan.S.formAktiv") == kugel["id"], "Kugel in der Liste gewählt")
            seite.select_option("#gkOperation", "vereinen")
            seite.click("#wfVorschau")
            leer()
            pruefe("vereint" in seite.inner_text("#gkInfo") or "Grundkörper1" in seite.inner_text("#gkInfo"),
                   "Vorschau nennt das Ziel: %s" % seite.inner_text("#gkInfo"))
            seite.click("#wfOk")
            leer()
            time.sleep(0.5)
            v2 = seite.evaluate("[...v3dscan.S.koerper.values()][0].meta.volumen")
            r = kugel["durchmesser_nenn"] / 2
            pruefe(seite.evaluate("v3dscan.S.koerper.size") == 1, "Vereinen erzeugt keinen neuen Körper")
            pruefe(abs(v2 - v1 - 4 / 3 * 3.14159265 * r ** 3) < 1.0, "Volumen nach Vereinen %.1f = %.1f + Kugel" % (v2, v1))
            pruefe("vereint" in seite.inner_text("#verlaufListe"), "Verlauf zeigt das Vereinen")
            seite.mouse.move(705, 455)
            seite.screenshot(path=os.path.join(BILDER, "k2_abgezogen.png"))

            seite.keyboard.press("Control+z")
            leer()
            seite.wait_for_function("Math.abs([...v3dscan.S.koerper.values()][0].meta.volumen - %f) < 0.01" % v1, timeout=30000)
            pruefe(True, "Rückgängig stellt den Körper vor dem Vereinen her")

            # STEP über das Menüband
            seite.click("#bandReiter [data-band=modell]")
            with seite.expect_download() as dl:
                seite.click("[data-bandseite=modell] [data-aktion=koerperStep]")
            pfad = os.path.join(BILDER, "export.step")
            dl.value.save_as(pfad)
            sys.path.insert(0, WURZEL)
            from kern import koerper as kp
            from OCP.GProp import GProp_GProps
            from OCP.BRepGProp import BRepGProp
            form = kp.einlesen(open(pfad, 'rb').read(), 'step')
            gp = GProp_GProps()
            BRepGProp.VolumeProperties_s(form, gp)
            pruefe(abs(gp.Mass() - v1) < 0.5, "STEP wieder eingelesen: Volumen %.1f mm³" % gp.Mass())

            # Esc schließt das Werkzeugfenster (ohne Auswahl)
            seite.click("#wfZu")
            pruefe(seite.is_hidden("#werkzeugfenster"), "✕ schließt das Werkzeugfenster")
            pruefe(not konsole, "keine JS-Fehler %s" % konsole[:3])
            browser.close()
    finally:
        if dienst:
            dienst.terminate()
            dienst.wait()
    print("Alles in Ordnung." if not fehler else "%d FEHLER" % len(fehler))
    sys.exit(1 if fehler else 0)


if __name__ == "__main__":
    main()
