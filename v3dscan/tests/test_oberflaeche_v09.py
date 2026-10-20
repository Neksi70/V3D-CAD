"""Oberflächentest v0.9: Symmetrie/Referenz, Messen, Mehrfachschnitt → Loft, Zebra/Formschräge,
Abwickeln (Fläche per Mausklick), Rohr, Käfig von Hand (Ecke mit der Maus ziehen) + glatte Flächen.
Scan: Platte 60 × 40 × 10 mit R5-Ecken und Bohrung Ø 12 (Netz).
"""
import math
import os
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL = os.path.dirname(HIER)
BILDER = os.path.join(HIER, "bilder")
PORT = int(os.environ.get("V3DSCAN_TEST_PORT") or 18788)
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
                seite.click("#bandReiter [data-band=%s]" % band)
                seite.click("[data-bandseite=%s] [data-wf~='%s']" % (band, teil))

            def bildschirm(p):
                return seite.evaluate("""([x, y, z]) => { const {kamera} = v3dscan;
                  const v = kamera.position.clone().set(x, y, z).project(kamera);
                  const c = document.querySelector('#leinwand'), r = c.getBoundingClientRect();
                  return [r.left + (v.x + 1) / 2 * c.clientWidth, r.top + (1 - v.y) / 2 * c.clientHeight]; }""", p)

            # --- Symmetrieebene ---
            oeffne("modell", "w-referenz")
            seite.select_option("#rfArt", "symmetrie")
            seite.click("#wfInhalt [data-aktion=rfVorschau]")
            seite.wait_for_function("document.querySelector('#rfInfo').textContent.includes('rms')", timeout=120000)
            leer()
            seite.click("#wfOk")
            seite.wait_for_function("v3dscan.S.zustand.referenzen.length === 1", timeout=60000)
            leer()
            pruefe("Symmetrieebene1" in seite.inner_text("#referenzListe"), "Symmetrieebene1 im Modellbaum")
            pruefe(seite.evaluate("[...document.querySelectorAll('#skEbene option')].some(o => o.value.startsWith('ref:'))"),
                   "Referenz als Skizzenebene wählbar")

            # --- Messen mit echter Maus: zwei Eckpunkte der Oberseite ---
            seite.keyboard.press("2")      # Draufsicht
            time.sleep(0.5)
            oeffne("modell", "w-messen")
            seite.select_option("#meArt", "abstand")
            punkte = seite.evaluate("""() => { const e = [...v3dscan.S.scans.values()][0]; let a = null, b = null;
              for (let i = 0; i < e.n; i++) { const x = e.xyz[i*3], y = e.xyz[i*3+1], z = e.xyz[i*3+2];
                if (z < 9.9) continue;
                if (!a || x + y < a[0] + a[1]) a = [x, y, z]; if (!b || x + y > b[0] + b[1]) b = [x, y, z]; }
              return [a, b]; }""")
            for p in punkte:
                x, y = bildschirm(p)
                seite.mouse.click(x, y)
                time.sleep(0.2)
            text = seite.inner_text("#meErgebnis")
            soll = math.dist(punkte[0], punkte[1])
            import re
            m = re.search(r"([\d.,]+) mm", text)
            ist = float(m.group(1).replace(".", "").replace(",", ".")) if m else -1
            pruefe(abs(ist - soll) < 1.0, "Abstand gemessen %.2f mm (Punkte %.2f mm auseinander)" % (ist, soll))
            seite.keyboard.press("4")
            time.sleep(0.3)

            # --- Mehrfachschnitt -> Loft ---
            oeffne("modell", "w-skizze")
            seite.select_option("#skEbene", "welt:xy")
            seite.check("#skStapel")
            seite.fill("#skVon", "1")
            seite.fill("#skBis", "9")
            seite.fill("#skAnzahl", "3")
            seite.fill("#skTol", "0.05")
            seite.click("#wfOk")
            seite.wait_for_function("v3dscan.S.zustand.skizzen.length === 3", timeout=120000)
            leer()
            pruefe(True, "Mehrfachschnitt: 3 Skizzen")
            oeffne("modell", "w-loft")
            boxen = seite.locator("#loListe input")
            boxen.nth(0).check()
            boxen.nth(2).check()
            seite.select_option("#loOperation", "neu")
            seite.click("#wfOk")
            seite.wait_for_function("v3dscan.S.zustand.koerper.some(k => k.name === 'Loft1')", timeout=120000)
            leer()
            v = seite.evaluate("v3dscan.S.zustand.koerper.find(k => k.name === 'Loft1').volumen")
            soll = (2400 - (4 - math.pi) * 25) * 8
            pruefe(abs(v - soll) < 20, "Loft1: %.1f mm³ (Soll %.1f)" % (v, soll))

            # --- Zebra / Formschräge ---
            seite.click("#bandReiter [data-band=modell]")
            seite.click("[data-bandseite=modell] [data-aktion=zebraAn]")
            pruefe(seite.evaluate("[...v3dscan.S.koerper.values()][0].flaeche.material.type") == "ShaderMaterial"
                   and "Zebra" in seite.inner_text("#legende"), "Zebra-Streifen an")
            seite.screenshot(path=os.path.join(BILDER, "v09_zebra.png"))
            seite.click("[data-bandseite=modell] [data-aktion=schraegeAn]")
            farbe = seite.evaluate("""() => { const k = [...v3dscan.S.koerper.values()][0];
              return {vc: k.flaeche.material.vertexColors, s: k.schraege}; }""")
            pruefe(farbe["vc"] and farbe["s"]["kritisch"] > 0 and farbe["s"]["plus"] > 0,
                   "Formschräge: senkrechte Wände rot, Oberseite grün (%s)" % farbe["s"])
            seite.screenshot(path=os.path.join(BILDER, "v09_schraege.png"))
            seite.click("[data-bandseite=modell] [data-aktion=schraegeAn]")

            # --- Abwickeln: Oberseite per Mausklick ---
            oeffne("modell", "w-abwickeln")
            ziel = seite.evaluate("""() => { const k = [...v3dscan.S.koerper.values()][0];
              const pos = k.flaeche.geometry.getAttribute('position').array, idx = k.flaeche.geometry.index.array;
              let best = null;
              for (let t = 0; t < idx.length / 3; t++) { let z = 0, x = 0, y = 0;
                for (let e = 0; e < 3; e++) { x += pos[idx[t*3+e]*3]; y += pos[idx[t*3+e]*3+1]; z += pos[idx[t*3+e]*3+2]; }
                if (!best || z > best[2]) best = [x/3, y/3, z/3, k.flaechenId[t]]; }
              return best; }""")
            x, y = bildschirm(ziel[:3])
            seite.mouse.click(x, y)
            pruefe(seite.evaluate("[...v3dscan.S.awWahl]") == [ziel[3]], "Oberseite per Klick gewählt")
            seite.click("#wfOk")
            seite.wait_for_function("document.querySelector('#awInfo').textContent.includes('Verzerrung')", timeout=60000)
            leer()
            info = seite.inner_text("#awInfo")
            pruefe("keine (abwickelbar)" in info and info.startswith("60") and "× 40" in info,
                   "Abwicklung Oberseite: %s" % info)

            # --- Rohr entlang einer Skizze ---
            oeffne("modell", "w-sweep")
            seite.select_option("#swArt", "pipe")
            seite.fill("#swRadius", "1")
            seite.select_option("#swOperation", "neu")
            seite.click("#wfOk")
            seite.wait_for_function("v3dscan.S.zustand.koerper.some(k => k.name === 'Rohr1')", timeout=120000)
            leer()
            v = seite.evaluate("v3dscan.S.zustand.koerper.find(k => k.name === 'Rohr1').volumen")
            umfang = 2 * (50 + 30) + 2 * math.pi * 5
            pruefe(abs(v - math.pi * umfang) / (math.pi * umfang) < 0.02,
                   "Rohr r1 um die Kontur: %.1f mm³ (Soll ≈ %.1f)" % (v, math.pi * umfang))

            # --- Käfig von Hand + glatte Flächen: am Torus (organische Form) ---
            from test_oberflaeche_freiform import testdatei as torus_datei
            import json as _json
            daten = open(torus_datei(), "rb").read()
            tid = _json.loads(urllib.request.urlopen(urllib.request.Request(
                BASIS + "/api/import?name=torus_netz.ply", data=daten), timeout=120).read())["neu"]
            seite.evaluate("""async (tid) => { const {api, S} = v3dscan;
              for (const sc of S.zustand.scans) if (sc.id !== tid) await api('scan/setzen', {id: sc.id, sichtbar: false});
              for (const k of S.zustand.koerper) await api('koerper/setzen', {kid: k.id, sichtbar: false});
              for (const r of S.zustand.referenzen) await api('referenz/setzen', {rid: r.id, sichtbar: false});
              for (const z of S.zustand.skizzen) await api('skizze/setzen', {sid: z.id, sichtbar: false}); }""", tid)
            leer()
            seite.evaluate("v3dscan.einpassen()")
            oeffne("modell", "w-auto-flaechen")
            seite.select_option("#afScan", str(tid))
            seite.fill("#afAnzahl", "300")
            seite.click("#wfInhalt [data-aktion=afVorschau]")
            seite.wait_for_function("v3dscan.S.kaefig !== null", timeout=60000)
            leer()
            seite.evaluate("document.activeElement && document.activeElement.blur()")
            ecke = seite.evaluate("""() => { const V = v3dscan.S.kaefig.V; let b = null;
              for (let i = 0; i < V.length / 3; i++) if (!b || V[i*3+2] > b[2]) b = [V[i*3], V[i*3+1], V[i*3+2], i];
              return b; }""")
            x, y = bildschirm(ecke[:3])
            pruefe(seite.evaluate("([x, y]) => { const r = document.querySelector('#leinwand').getBoundingClientRect();"
                                  " return v3dscan.kaefigEckeAn(x - r.left, y - r.top); }", [x, y]) == ecke[3],
                   "Käfig-Ecke %d unter der Maus gefunden" % ecke[3])
            seite.mouse.move(x, y)
            seite.mouse.down()
            seite.mouse.move(x + 12, y + 4, steps=6)
            seite.mouse.up()
            pruefe(seite.evaluate("v3dscan.S.kaefig.geaendert"), "Käfig-Ecke mit der Maus verschoben")
            neu_pos = seite.evaluate("Array.from(v3dscan.S.kaefig.V.slice(%d * 3, %d * 3 + 3))" % (ecke[3], ecke[3]))
            pruefe(math.dist(neu_pos, ecke[:3]) > 0.5, "Ecke liegt jetzt woanders auf dem Scan (%.2f mm)" % math.dist(neu_pos, ecke[:3]))
            seite.click("#wfOk")
            seite.wait_for_function("document.querySelector('#afInfo').textContent.includes('Knick')", timeout=300000)
            leer()
            info = seite.inner_text("#afInfo")
            pruefe("geschlossener Volumenkörper" in info, "Freiform aus Käfig: %s" % info.replace("\n", " | "))
            seite.screenshot(path=os.path.join(BILDER, "v09_freiform.png"))
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
