"""Oberflächentest Querschnitt-Skizze → Extrudieren → Kante runden → Drehen (Etappen D/E).

Ablauf wie ein Nutzer über das Menüband MODELL; Kante wird mit echtem Mausklick gewählt.
Scan: Platte 60 × 40 × 10 mit R5-Ecken und Bohrung Ø 12 als verrauschtes Netz.
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
PORT = int(os.environ.get("V3DSCAN_TEST_PORT") or 18793)
BASIS = "http://127.0.0.1:%d" % PORT
fehler = []


def pruefe(bed, text):
    print(("  ok   " if bed else "  FEHLER ") + text)
    if not bed:
        fehler.append(text)


def testdatei():
    pfad = os.path.join(DATEN, "platte_netz.ply")
    if not os.path.exists(pfad):
        sys.path.insert(0, HIER)
        sys.path.insert(0, WURZEL)
        from test_skizze import als_scan, platte
        from kern.wolke import ausgeben
        os.makedirs(DATEN, exist_ok=True)
        ausgeben(als_scan(platte()), pfad, "ply")
    return pfad


def main():
    pfad = testdatei()
    os.makedirs(BILDER, exist_ok=True)
    dienst = None
    if not os.environ.get("V3DSCAN_TEST_PORT"):
        dienst = subprocess.Popen([sys.executable, os.path.join(WURZEL, "server.py"), "--port", str(PORT),
                                   "--laden", pfad], cwd=WURZEL,
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
                seite.click("#bandReiter [data-band=%s]" % band)
                seite.click("[data-bandseite=%s] [data-wf~='%s']" % (band, teil))

            # --- Skizze ---
            oeffne("modell", "w-skizze")
            pruefe(seite.inner_text("#wfTitel") == "Querschnitt-Skizze", "Skizzen-Werkzeug über Menüband")
            seite.select_option("#skEbene", "welt:xy")
            seite.fill("#skVersatz", "5")
            seite.fill("#skTol", "0.05")
            seite.click("#wfInhalt [data-aktion=skVorschau]")
            seite.wait_for_selector("#skElemente .el", timeout=60000)
            leer()
            texte = seite.eval_on_selector_all("#skElemente .el span:first-child", "e => e.map(x => x.textContent)")
            pruefe(len(texte) == 9 and sum(t.startswith("Bogen R 5") for t in texte) == 4
                   and any(t.startswith("Kreis Ø 12") for t in texte),
                   "Vorschau: 9 Elemente, 4× R5, Ø 12 (%s)" % texte)
            pruefe(seite.evaluate("v3dscan.S.zustand.skizzen.length") == 0, "Vorschau ändert das Projekt nicht")
            # Radius des ersten Bogens auf 6
            feld = seite.locator("#skElemente .el:has-text('Bogen') input").first
            feld.fill("6")
            feld.dispatch_event("change")
            seite.wait_for_function("[...document.querySelectorAll('#skElemente .el span:first-child')].some(e => e.textContent.startsWith('Bogen R 6'))", timeout=30000)
            pruefe(True, "Radius im Feld geändert → Bogen R 6")
            # Versatz-Regler zieht den Schnitt live nach
            seite.evaluate("""() => { const r = document.querySelector('#skVersatzRegler'); r.value = 2;
                                     r.dispatchEvent(new Event('input')); }""")
            seite.wait_for_function("document.querySelector('#skVersatz').value === '2.00'", timeout=5000)
            seite.wait_for_function("v3dscan.S.skVorschau && v3dscan.S.skVorschau.daten.ebene.ursprung[2] === 2", timeout=30000)
            leer()
            pruefe(True, "Regler: Schnitt bei z = 2 neu gerechnet")
            seite.fill("#skVersatz", "5")
            seite.click("#wfInhalt [data-aktion=skVorschau]")
            leer()
            seite.click("#wfOk")
            seite.wait_for_selector("#skizzenListe .skizze", timeout=30000)
            leer()
            pruefe("Skizze1" in seite.inner_text("#skizzenListe"), "Übernehmen → Skizze1 im Modellbaum")

            # --- Extrudieren bis Scan ---
            oeffne("modell", "w-extrudieren")
            seite.select_option("#exModus", "auto")
            seite.click("#wfInhalt [data-aktion=exVorschau]")
            seite.wait_for_function("document.querySelector('#exInfo').textContent.includes('Länge')", timeout=60000)
            leer()
            info = seite.inner_text("#exInfo")
            pruefe("neuer Körper" in info and ("Länge 10" in info or "Länge 9,9" in info), "Vorschau: %s" % info)
            seite.click("#wfOk")
            seite.wait_for_selector("#koerperListe .koerper", timeout=60000)
            leer()
            pruefe("Extrusion1" in seite.inner_text("#koerperListe"), "Extrusion1 im Modellbaum")
            vol = seite.evaluate("[...v3dscan.S.koerper.values()][0].meta.volumen")
            # zweite Vorschau hat den Schnitt neu gerechnet (R6-Aenderung verworfen); Hoehe bis Scan ~10,05
            pruefe(22550 < vol < 22900, "Volumen %.1f mm³ (Platte, Höhe bis Scan)" % vol)

            # --- Kante runden: echte Maus auf eine obere, lange gerade Kante ---
            oeffne("modell", "w-kanten")
            seite.keyboard.press("4")
            time.sleep(0.5)
            pos = seite.evaluate("""() => {
              const {S} = v3dscan; const k = [...S.koerper.values()][0];
              const p = k.kanten.geometry.getAttribute('position').array, ids = k.kantenId;
              const laenge = {};
              let top = -Infinity;
              for (let i = 0; i < ids.length; i++) top = Math.max(top, p[i*6+2]);
              for (let i = 0; i < ids.length; i++) {
                if (Math.abs(p[i*6+2] - top) > 1e-3 || Math.abs(p[i*6+5] - top) > 1e-3) continue;
                laenge[ids[i]] = (laenge[ids[i]] || 0) + Math.hypot(p[i*6+3]-p[i*6], p[i*6+4]-p[i*6+1]);
              }
              const id = Number(Object.keys(laenge).sort((a, b) => laenge[b] - laenge[a])[0]);
              for (let i = 0; i < ids.length; i++) if (ids[i] === id)
                return {id, m: [(p[i*6]+p[i*6+3])/2, (p[i*6+1]+p[i*6+4])/2, top]};
            }""")
            punkt = seite.evaluate("""([x, y, z]) => {
              const {kamera} = v3dscan; const v = kamera.position.clone().set(x, y, z).project(kamera);
              const c = document.querySelector('#leinwand'), r = c.getBoundingClientRect();
              return [r.left + (v.x + 1) / 2 * c.clientWidth, r.top + (1 - v.y) / 2 * c.clientHeight];
            }""", pos["m"])
            seite.mouse.click(punkt[0], punkt[1])
            seite.wait_for_function("v3dscan.S.knKanten.size === 1", timeout=5000)
            pruefe(seite.evaluate("[...v3dscan.S.knKanten][0]") == pos["id"], "Klick wählt die obere Kante %d" % pos["id"])
            pruefe("1 Kante gewählt" in seite.inner_text("#knInfo"), "Anzeige: %s" % seite.inner_text("#knInfo"))
            seite.fill("#knRadius", "2")
            seite.click("#wfInhalt [data-aktion=knVorschau]")
            seite.wait_for_function("document.querySelector('#knInfo').textContent.includes('Volumen danach')", timeout=60000)
            leer()
            seite.screenshot(path=os.path.join(BILDER, "skizze_kante.png"))
            seite.click("#wfOk")
            seite.wait_for_function("[...v3dscan.S.koerper.values()][0].meta.verlauf.some(v => v.name === 'Rundung1')", timeout=60000)
            leer()
            vol2 = seite.evaluate("[...v3dscan.S.koerper.values()][0].meta.volumen")
            pruefe(vol2 < vol and "Rundung1" in seite.inner_text("#verlaufListe"),
                   "Rundung1 im Verlauf, Volumen %.1f → %.1f" % (vol, vol2))

            # --- Drehen durch die Bohrungsachse ---
            oeffne("bereiche", "w-formen-auto")
            seite.click("#wfInhalt [data-aktion=formenErkennen]")
            seite.wait_for_selector("#formZusammenfassung:not([hidden])", timeout=180000)
            leer()
            # Bohrung; unter Wine stuft die Erkennung sie gelegentlich als Zylinderflaeche ein
            # (mehrfaedige Normalen) - fuer "durch Achse" taugt jede erkannte Achse nahe (20, 20)
            typ = seite.evaluate("""() => { const {S, formWaehlen} = v3dscan;
              const el = S.erkennung.elemente.find(e => e.typ === 'bohrung')
                || S.erkennung.elemente.find(e => e.achse && Math.hypot(e.punkt[0] - 20, e.punkt[1] - 20) < 1);
              formWaehlen(el, false); return el.typ; }""")
            print("    gewählt:", typ)
            oeffne("modell", "w-skizze")
            seite.select_option("#skEbene", "achse")
            pruefe("Ø 12" in seite.inner_text("#skBereich"), "Bereich-Feld: %s" % seite.inner_text("#skBereich"))
            seite.click("#wfInhalt [data-aktion=skVorschau]")
            seite.wait_for_selector("#skElemente .el", timeout=60000)
            leer()
            seite.click("#wfOk")
            seite.wait_for_function("v3dscan.S.zustand.skizzen.length === 2", timeout=30000)
            leer()
            oeffne("modell", "w-drehen")
            seite.select_option("#drOperation", "neu")
            seite.click("#wfInhalt [data-aktion=drVorschau]")
            seite.wait_for_function("document.querySelector('#drInfo').textContent.includes('mm³')", timeout=60000)
            leer()
            seite.click("#wfOk")
            seite.wait_for_function("v3dscan.S.zustand.koerper.some(k => k.name === 'Drehung1')", timeout=60000)
            leer()
            dreh = seite.evaluate("v3dscan.S.zustand.koerper.find(k => k.name === 'Drehung1')")
            pruefe(dreh["volumen"] > 1000, "Drehung1 um die Bohrungsachse: %.1f mm³" % dreh["volumen"])
            seite.screenshot(path=os.path.join(BILDER, "skizze_drehen.png"))

            # --- Rückgängig über den Knopf ---
            seite.click("#knopfUndo")
            seite.wait_for_function("!v3dscan.S.zustand.koerper.some(k => k.name === 'Drehung1')", timeout=30000)
            leer()
            pruefe(len(seite.evaluate("v3dscan.S.zustand.skizzen")) == 2, "Rückgängig: Drehung weg, Skizzen bleiben")
            echte = [k for k in konsole if "Bereich" not in k]
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
