"""Oberflächentest „Abweichung Scan ↔ Körper“ (MODELL → Prüfen).

Ablauf wie ein Nutzer: Bereiche erkennen, Zapfen als Körper (Nennmaß), dann über das
Menüband das Werkzeug öffnen, Anzeigen → Scan gefärbt, Legende + Kennwerte; Zapfen-
Punkte liegen im Toleranzband (grün), Punkte fern vom Körper grau; Aus → Farben weg.
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
PORT = int(os.environ.get("V3DSCAN_TEST_PORT") or 18795)
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
            seite = browser.new_page(viewport={"width": 1500, "height": 950})
            konsole = []
            seite.on("console", lambda m: konsole.append(m.text) if m.type == "error" else None)
            seite.on("pageerror", lambda e: konsole.append(str(e)))
            seite.goto(BASIS + "/")
            seite.wait_for_function("window.v3dscan && v3dscan.S.scans.size === 1", timeout=30000)
            leer = lambda: seite.wait_for_function("!v3dscan.S.beschaeftigt", timeout=180000)  # noqa: E731

            def oeffne(band, teil):
                if seite.evaluate("!!document.querySelector('#wfInhalt #%s')" % teil):
                    return
                # Reiter des Werkzeugs selbst finden (Menüband ist nach Arbeitsschritten aufgeteilt)
                band = seite.evaluate("(t) => document.querySelector(`#band [data-wf~='${t}']`).closest('[data-bandseite]').dataset.bandseite", teil)
                seite.click("#bandReiter [data-band=%s]" % band)
                seite.click("[data-bandseite=%s] [data-wf~='%s']" % (band, teil))

            # ohne Körper: verständliche Meldung statt Absturz
            oeffne("modell", "w-koerper-abw")
            pruefe(seite.inner_text("#wfTitel") == "Abweichung Scan ↔ Körper", "Werkzeug über Menüband geöffnet")
            seite.click("#wfInhalt [data-aktion=kaZeigen]")
            seite.wait_for_selector("#meldungen :text('Grundkörper')", timeout=10000)
            pruefe(True, "ohne Körper: Hinweis „erst einen Grundkörper“")

            oeffne("bereiche", "w-formen-auto")
            seite.click("#wfInhalt [data-aktion=formenErkennen]")
            seite.wait_for_selector("#formZusammenfassung:not([hidden])", timeout=180000)
            leer()
            seite.evaluate("""async () => {
              const {S, api} = v3dscan;
              const el = S.erkennung.elemente.find(e => e.typ === 'zapfen');
              await api('koerper/aus_form', {id: S.erkennung.id, element: el.id, nennmass: true,
                                              verlaengern: 0, operation: 'neu', ziel: null});
            }""")
            leer()

            oeffne("modell", "w-koerper-abw")
            optionen = seite.evaluate("[...document.querySelectorAll('#kaKoerper option')].map(o => o.textContent)")
            pruefe(len(optionen) == 2 and optionen[0] == "alle sichtbaren", "Körper-Auswahl: %s" % optionen)
            seite.fill("#kaTol", "0.1")
            seite.fill("#kaAus", "1")
            seite.click("#wfOk")  # ✓ = Anzeigen
            seite.wait_for_selector("#legende:not([hidden])", timeout=60000)
            leer()
            info = seite.inner_text("#kaInfo")
            pruefe("Std-Abw." in info and "in ±0.1 mm" in info, "Kennwerte-Tabelle:\n      " + info.replace("\n", " | "))
            legende = seite.inner_text("#legende")
            pruefe("Scan ↔ Körper" in legende and "−0.50" in legende, "Legende mit Vorzeichen-Skala")

            # Farben: Zapfen-Punkte gruen (Toleranzband), weit entfernte grau
            farben = seite.evaluate("""() => {
              const {S} = v3dscan; const e = S.scans.get(S.abweichung.id);
              const el = S.erkennung.elemente.find(x => x.typ === 'zapfen');
              let gruen = 0, zap = 0, grau = 0, fern = 0;
              for (let i = 0; i < e.n; i++) {
                const c = [e.farbe[i*3], e.farbe[i*3+1], e.farbe[i*3+2]];
                const w = S.abweichung.werte[i];
                if (S.erkennung.labels[i] === el.id) { zap++; if (Math.abs(w) <= 0.1 && c[1] === 190 && c[0] === 46) gruen++; }
                if (Math.abs(w) > 1) { fern++; if (c[0] === 150 && c[1] === 150) grau++; }
              }
              return {gruen, zap, grau, fern};
            }""")
            pruefe(farben["zap"] > 0 and farben["gruen"] / farben["zap"] > 0.9,
                   "Zapfen-Punkte grün: %d / %d" % (farben["gruen"], farben["zap"]))
            pruefe(farben["fern"] > 0 and farben["grau"] == farben["fern"],
                   "fern vom Körper grau: %d / %d" % (farben["grau"], farben["fern"]))
            seite.keyboard.press("4")
            time.sleep(0.5)
            seite.screenshot(path=os.path.join(BILDER, "abweichung_koerper.png"))

            seite.click("#wfInhalt [data-aktion=kaAus]")
            pruefe(seite.evaluate("v3dscan.S.abweichung === null") and seite.is_hidden("#legende"),
                   "Aus: Färbung und Legende weg")
            # der absichtlich ausgeloeste Hinweis landet (wie alle Nutzerhinweise) auch in der Konsole
            echte = [k for k in konsole if "erst einen Grundkörper" not in k]
            pruefe(not echte, "keine Konsolenfehler %s" % echte[:3])
            browser.close()
    finally:
        if dienst:
            dienst.terminate()
            dienst.wait(10)
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)


if __name__ == "__main__":
    main()
