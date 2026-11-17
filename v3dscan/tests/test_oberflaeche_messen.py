"""Oberflächentest v1.6 – Messen und Prüfen: Messplan (Maße + Form/Lage, Klick-Auswahl, Bericht, Speichern),
Wandstärke, Volumenfehler-Knopf, Schattenriss, 2D-Messen auf einem synthetischen 600-dpi-Flachbettbild.

    python3 tests/test_oberflaeche_messen.py
"""
import io
import json
import math
import os
import struct
import subprocess
import sys
import time
import urllib.request
import zlib

from playwright.sync_api import sync_playwright

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL = os.path.dirname(HIER)
BILDER = os.path.join(HIER, "bilder")
PORT = int(os.environ.get("V3DSCAN_TEST_PORT") or 18816)
BASIS = "http://127.0.0.1:%d" % PORT
fehler = []


def pruefe(bed, text):
    print(("  ok   " if bed else "  FEHLER ") + text)
    if not bed:
        fehler.append(text)


def flachbett_png(pfad, dpi=600, w=900, h=700, cx=420.3, cy=330.7, r=120.4):
    """Graustufen-PNG: helles Glas, dunkles Teil mit heller Bohrung; pHYs = dpi (ohne PIL)."""
    zeilen = bytearray()
    for y in range(h):
        zeilen.append(0)
        for x in range(w):
            s = 0
            for a in range(4):
                for b in range(4):
                    px, py = x + (a + 0.5) / 4, y + (b + 0.5) / 4
                    teil = 150 < px < 780 and 120 < py < 600 and math.hypot(px - cx, py - cy) > r
                    s += teil
            zeilen.append(int(round(235 - 200 * s / 16)))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    ppm = int(round(dpi / 0.0254))
    daten = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
             + chunk(b"pHYs", struct.pack(">IIB", ppm, ppm, 1)) + chunk(b"IDAT", zlib.compress(bytes(zeilen), 6)) + chunk(b"IEND", b""))
    with open(pfad, "wb") as f:
        f.write(daten)
    return cx, cy, r


def main():
    sys.path.insert(0, HIER)
    from test_oberflaeche_skizze import testdatei
    pfad = testdatei()
    os.makedirs(BILDER, exist_ok=True)
    png = os.path.join(BILDER, "flachbett_test.png")
    kx, ky, kr = flachbett_png(png)
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
            sid = seite.evaluate("[...v3dscan.S.scans.keys()][0]")

            def oeffne(teil):
                band = seite.evaluate("(t) => document.querySelector(`#band [data-wf~='${t}']`).closest('[data-bandseite]').dataset.bandseite", teil)
                seite.click("#bandReiter [data-band=%s]" % band)
                seite.click("[data-bandseite=%s] [data-wf~='%s']" % (band, teil))
                seite.wait_for_selector("#wfInhalt #%s" % teil, timeout=5000)

            print("Messplan")
            for versuch in range(3):          # RANSAC ist zufallsbasiert: bis Ober-/Unterseite und Bohrung erkannt sind
                seite.evaluate("(id) => v3dscan.api('formen/erkennen', { id }).then(j => v3dscan.erkennungUebernehmen(j.erkennung))", sid)
                leer()
                els = seite.evaluate("v3dscan.S.erkennung.elemente.map(e => ({id: e.id, typ: e.typ, n: e.normale, p: e.punkt, d: e.durchmesser}))")
                oben = next((e for e in els if e["typ"] == "ebene" and abs(e["n"][2]) > 0.99 and e["p"][2] > 9), None)
                unten = next((e for e in els if e["typ"] == "ebene" and abs(e["n"][2]) > 0.99 and e["p"][2] < 1), None)
                loch = next((e for e in els if e["typ"] in ("bohrung", "zylinder", "zylinderflaeche") and e["d"] and abs(e["d"] - 12) < 0.5), None)
                print("    erkannt (Versuch %d):" % (versuch + 1), sorted(e["typ"] for e in els))
                if oben and unten and loch:
                    break
            pruefe(bool(oben and unten and loch), "Erkennung liefert Ober-/Unterseite und Bohrung")
            oeffne("w-messplan")
            seite.select_option("#mpA", str(oben["id"]))
            seite.select_option("#mpB", str(unten["id"]))
            seite.fill("#mpNenn", "10")
            seite.fill("#mpPlus", "0,05")
            seite.fill("#mpMinus", "0,05")
            seite.click("#wfInhalt [data-aktion=mpHinzu]")
            leer()
            seite.select_option("#mpA", str(loch["id"]))
            seite.select_option("#mpB", "")
            seite.fill("#mpNenn", "12")
            seite.click("#wfInhalt [data-aktion=mpHinzu]")
            leer()
            seite.click("#wfInhalt [data-aktion=mpTolModus]")
            seite.select_option("#mpA", str(oben["id"]))
            seite.select_option("#mpTol", "ebenheit")
            seite.fill("#mpGrenze", "0,05")
            seite.click("#wfInhalt [data-aktion=mpHinzu]")
            leer()
            seite.select_option("#mpB", str(unten["id"]))
            seite.select_option("#mpTol", "parallelitaet")
            seite.fill("#mpGrenze", "0,05")
            seite.click("#wfInhalt [data-aktion=mpHinzu]")
            leer()
            mpl = seite.evaluate("v3dscan.S.messplan")
            pruefe(len(mpl) == 4, "4 Merkmale im Messplan")
            pruefe(abs(mpl[0]["wert"] - 10) < 0.05 and mpl[0]["status"] == "ok", "Abstand Ober-/Unterseite %.4f, i.O." % mpl[0]["wert"])
            pruefe(abs(mpl[1]["wert"] - 12) < 0.05 and mpl[1].get("mass_erkannt") == "durchmesser", "Bohrung allein → Ø %.4f" % mpl[1]["wert"])
            pruefe(mpl[2]["wert"] < 0.1 and mpl[3]["wert"] < 0.1, "Ebenheit %.4f, Parallelität %.4f (Kanten zu den Rundungen)" % (mpl[2]["wert"], mpl[3]["wert"]))
            zeilen = seite.locator("#mpListe tr").count()
            pruefe(zeilen == 4 and seite.locator("#mpListe tr.ok").count() >= 3, "Tabelle zeigt 4 Zeilen mit i.O.-Status")
            seite.select_option("#mpA", "")
            # Punkt der Oberseite auf den Schirm projizieren und nur dort klicken, wo die Ansicht oben liegt
            ziele = seite.evaluate("""([sid, eid]) => { const S = v3dscan.S, e = S.scans.get(sid), erk = S.erkennung, cv = document.querySelector('#leinwand'), r = cv.getBoundingClientRect(), aus = [];
              for (let i = 0; i < e.n && aus.length < 30; i += 7) { if (erk.labels[i] !== eid) continue;
                const v = new e.obj.position.constructor(e.xyz[i * 3], e.xyz[i * 3 + 1], e.xyz[i * 3 + 2]); e.obj.localToWorld(v); v.project(v3dscan.kamera);
                const x = r.left + (v.x + 1) / 2 * r.width, y = r.top + (1 - v.y) / 2 * r.height;
                if (document.elementFromPoint(x, y) === cv) aus.push([x, y]); } return aus; }""", [sid, oben["id"]])
            print("    Ziele sichtbar:", len(ziele), "WF:", seite.evaluate("(window.v3dscan && document.querySelector('#wfInhalt section') || {}).id"))
            for x, y in ziele[:6]:
                seite.mouse.click(x, y)
                if seite.input_value("#mpA") != "":
                    break
            pruefe(seite.input_value("#mpA") != "", "Klick in die Ansicht wählt A (%s)" % seite.input_value("#mpA"))
            bericht = seite.evaluate("(id) => v3dscan.api('messplan/bericht', { id })", sid)
            pruefe("Ergebnis:" in bericht["text"] and "Ebenheit" in bericht["text"] and bericht["csv"].count("\n") == 5, "Bericht + CSV")
            seite.click("#wfInhalt [data-aktion=mpAbw]")
            leer()
            pruefe(seite.evaluate("!!(v3dscan.S.abweichung && v3dscan.S.abweichung.titel && v3dscan.S.abweichung.titel.startsWith('Abweichung zu'))"), "Abweichung zu A färbt den Scan")
            seite.screenshot(path=os.path.join(BILDER, "v16_messplan.png"))
            # Speichern + Laden: Messplan bleibt
            daten = urllib.request.urlopen(BASIS + "/api/projekt/speichern").read()
            req = urllib.request.Request(BASIS + "/api/projekt/laden", data=daten, method="POST")
            urllib.request.urlopen(req).read()
            n = seite.evaluate("(id) => v3dscan.api('messplan/liste', { id }).then(j => j.messplan.length)", sid)
            pruefe(n == 4, "nach Speichern/Laden: %d Merkmale" % n)

            print("Wandstärke")
            oeffne("w-wand")
            seite.fill("#wdMax", "15")
            seite.click("#wfInhalt [data-aktion=wdMessen]")
            leer()
            k = seite.evaluate("v3dscan.S.abweichung && v3dscan.S.abweichung.wand ? v3dscan.S.abweichung.kennwerte : null")
            pruefe(k is not None and abs(k["median"] - 10) < 1.0, "Wandstärke der 10-mm-Platte: Median %s" % (k and k["median"]))
            pruefe(seite.locator("#wdInfo .wdHisto div").count() == 20 and not seite.locator("#legende").is_hidden(), "Kennwerte, Histogramm, Legende")
            seite.screenshot(path=os.path.join(BILDER, "v16_wandstaerke.png"))

            print("Schattenriss")
            oeffne("w-schatten")
            seite.fill("#srAbstand", "1")
            seite.click("#wfInhalt [data-aktion=srRechnen]")
            leer()
            sr = seite.evaluate("v3dscan.S.schatten")
            b = sr["box"]
            pruefe(abs((b[2] - b[0]) - 62) < 1.0 and abs((b[3] - b[1]) - 42) < 1.0, "Umriss %.2f × %.2f (62 × 42)" % (b[2] - b[0], b[3] - b[1]))
            pruefe(len(sr["konturen"]) == 2 and "LWPOLYLINE" in sr["dxf"], "Außenkontur + Bohrung, DXF")
            with seite.expect_download() as dl:
                seite.click("#wfInhalt [data-aktion=srSvg]")
            pruefe(dl.value.suggested_filename.endswith(".svg"), "SVG-Download " + dl.value.suggested_filename)

            print("Volumenfehler-Knopf")
            pruefe(seite.evaluate("!!document.querySelector('[data-aktion=kaVolumen]')"), "Knopf im Abweichungsfenster vorhanden")

            print("2D-Messen")
            oeffne("w-flachbett")
            seite.set_input_files("#fbDatei", png)
            seite.wait_for_function("window.V3DFlachbett.F.bild !== null", timeout=10000)
            st = seite.text_content("#fbStatus")
            pruefe("UNKALIBRIERT" in st and "600 dpi" in st, "Status: " + st)
            punkt = seite.evaluate("([x, y]) => { const F = window.V3DFlachbett.F, cv = document.querySelector('#fbLeinwand'), r = cv.getBoundingClientRect();"
                                   " return [r.left + (x * F.sicht.s + F.sicht.ox) * r.width / cv.width, r.top + (y * F.sicht.s + F.sicht.oy) * r.height / cv.height]; }",
                                   [kx + kr, ky])
            seite.mouse.click(punkt[0], punkt[1])
            e = seite.evaluate("window.V3DFlachbett.F.elemente[0]")
            pruefe(e and e["art"] == "kreis" and abs(e["r"] - kr) < 0.15, "Kreis an die Kante geklickt: r %.3f px (%.1f)" % (e["r"] if e else -1, kr))
            seite.click("#fbMass")
            txt = seite.text_content("#fbListe")
            soll_mm = 2 * kr * 25.4 / 600
            pruefe(("%.3f" % soll_mm).replace(".", ",")[:5] in txt, "Ø in mm aus 600 dpi: %s… (Soll %.3f)" % (txt[txt.find("Ø"):txt.find("Ø") + 14] if "Ø" in txt else txt[:40], soll_mm))
            seite.screenshot(path=os.path.join(BILDER, "v16_flachbett.png"))
            pruefe(not konsole, "keine Fehler in der Konsole %s" % konsole[:3])
            browser.close()
    finally:
        if dienst:
            dienst.terminate()
    print("\n%d Fehler" % len(fehler) if fehler else "\nAlle Prüfungen bestanden")
    sys.exit(1 if fehler else 0)


if __name__ == "__main__":
    main()
