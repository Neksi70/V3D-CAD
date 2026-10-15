#!/usr/bin/env python3
# Oberflaeche headless durchklicken (Playwright/Chromium).
#
# Startet einen eigenen Dienst auf Port 18797 mit den Testdaten und prueft
# die Hauptablaeufe ueber ECHTE Maus-/Tastatureingaben; evaluate() nur zum
# Auslesen. Bildschirmfotos landen in tests/bilder/.
#
#   python3 tests/test_oberflaeche.py

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL = os.path.join(HIER, "..")
DATEN = os.path.join(HIER, "daten")
BILDER = os.path.join(HIER, "bilder")
PORT = 18797
fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def warte_auf_dienst():
    for _ in range(100):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/api/puls" % PORT, timeout=1)
            return True
        except Exception:
            time.sleep(0.2)
    return False


def main():
    if not os.path.exists(os.path.join(DATEN, "soll.json")):
        subprocess.check_call([sys.executable, os.path.join(HIER, "testdaten.py")])
    os.makedirs(BILDER, exist_ok=True)
    global PORT
    fremd = os.environ.get("V3DSCAN_TEST_PORT")   # z. B. laufende EXE unter Wine
    if fremd:
        PORT = int(fremd)
        dienst = None
    else:
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", PORT)) == 0:
                print("Port %d ist schon belegt - alter Testdienst?" % PORT)
                return 1
        dienst = subprocess.Popen([sys.executable, os.path.join(WURZEL, "server.py"),
                                   "--port", str(PORT), "--laden",
                                   os.path.join(DATEN, "ansicht_1.ply"),
                                   os.path.join(DATEN, "ansicht_2.ply")], cwd=WURZEL)
    try:
        if not warte_auf_dienst():
            print("Dienst startet nicht")
            return 1
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            seite = browser.new_page(viewport={"width": 1500, "height": 900})
            konsole = []
            seite.on("console", lambda m: konsole.append(m.text) if m.type == "error" else None)
            seite.on("pageerror", lambda e: konsole.append(str(e)))

            def oeffne(band, teil):
                """Werkzeug wie ein Nutzer über das Menüband öffnen (falls nicht schon offen)."""
                if seite.evaluate("!!document.querySelector('#wfInhalt #%s')" % teil):
                    return
                seite.click("#bandReiter [data-band=%s]" % band)
                seite.click("[data-bandseite=%s] [data-wf~='%s']" % (band, teil))
            seite.goto("http://127.0.0.1:%d/" % PORT)
            seite.wait_for_function("window.v3dscan && window.v3dscan.S.scans.size === 2", timeout=20000)
            seite.mouse.click(700, 450)
            time.sleep(0.5)
            pruefe(not konsole, "keine JS-Fehler beim Start %s" % konsole[:3])
            seite.screenshot(path=os.path.join(BILDER, "01_start.png"))

            def gewaehlt():
                return seite.evaluate("[...v3dscan.S.scans.values()].reduce((a,e)=>a+e.sel.reduce((x,y)=>x+y,0),0)")

            def punkte(sid):
                return seite.evaluate("v3dscan.S.scans.get(%d).n" % sid)

            # --- Rechteck-Auswahl: nur sichtbare vs. durch --------------------
            seite.keyboard.press("m")
            leinwand = seite.locator("#leinwand").bounding_box()
            cx, cy = leinwand["x"] + leinwand["width"] / 2, leinwand["y"] + leinwand["height"] / 2
            seite.mouse.move(cx - 60, cy - 60)
            seite.mouse.down()
            seite.mouse.move(cx + 60, cy + 60, steps=5)
            seite.mouse.up()
            sichtbar = gewaehlt()
            seite.keyboard.press("Escape")
            seite.keyboard.press("t")
            seite.mouse.move(cx - 60, cy - 60)
            seite.mouse.down()
            seite.mouse.move(cx + 60, cy + 60, steps=5)
            seite.mouse.up()
            durch = gewaehlt()
            pruefe(0 < sichtbar < durch, "Rechteck: sichtbar %d < durch %d" % (sichtbar, durch))
            seite.screenshot(path=os.path.join(BILDER, "02_auswahl.png"))

            vorher = punkte(1) + punkte(2)
            seite.keyboard.press("Delete")
            seite.wait_for_function("!v3dscan.S.beschaeftigt")
            time.sleep(0.5)
            nachher = punkte(1) + punkte(2)
            pruefe(vorher - nachher == durch, "Löschen entfernt genau die Auswahl (%d)" % (vorher - nachher))
            seite.keyboard.press("Control+z")
            time.sleep(1.0)
            pruefe(punkte(1) + punkte(2) == vorher, "Strg+Z stellt wieder her")
            seite.keyboard.press("t")

            # --- Polygon: 4 Ecken klicken, Enter schliesst --------------------
            seite.keyboard.press("Escape")
            seite.keyboard.press("p")
            for dx, dy in ((-80, -40), (60, -70), (90, 50), (-50, 80)):
                seite.mouse.click(cx + dx, cy + dy)
            seite.screenshot(path=os.path.join(BILDER, "02b_polygon.png"))
            seite.keyboard.press("Enter")
            pruefe(gewaehlt() > 0, "Polygon-Auswahl (%d Punkte)" % gewaehlt())
            seite.keyboard.press("Escape")
            pruefe(gewaehlt() == 0, "Esc hebt Auswahl auf")
            seite.keyboard.press("v")

            # --- Bereinigen: Tisch-Vorschau + Anwenden -----------------------
            oeffne("punkte", "w-tisch")
            seite.click("section[data-werkzeug-block=tisch] [data-vorschau]")
            seite.wait_for_function("[...v3dscan.S.scans.values()].some(e=>e.vor.some(v=>v))", timeout=20000)
            seite.mouse.move(cx, cy)
            seite.screenshot(path=os.path.join(BILDER, "03_tisch_vorschau.png"))
            aktiv = seite.evaluate("v3dscan.S.aktiv")
            n1 = punkte(aktiv)
            seite.click("section[data-werkzeug-block=tisch] [data-anwenden]")
            seite.wait_for_function("v3dscan.S.scans.get(%d).n < %d" % (aktiv, n1), timeout=20000)
            pruefe(n1 - punkte(aktiv) > 20000, "Tisch entfernt: %d → %d" % (n1, punkte(aktiv)))

            # Tisch auch beim anderen Scan (in der Liste anklicken), dann
            # Inseln auf beiden sichtbaren
            seite.click("#scanListe .scan >> nth=0")
            n0 = punkte(1)
            seite.click("section[data-werkzeug-block=tisch] [data-anwenden]")
            seite.wait_for_function("v3dscan.S.scans.get(1).n < %d" % n0, timeout=20000)
            oeffne("punkte", "w-inseln")
            seite.check("input[name=ziel][value=sichtbar]")
            seite.click("section[data-werkzeug-block=inseln] [data-anwenden]")
            seite.wait_for_function("!v3dscan.S.beschaeftigt")
            time.sleep(0.5)

            # --- Ausrichten ----------------------------------------------------
            oeffne("ausrichten", "w-reg-auto")
            seite.select_option("#wahlFest", "1")
            time.sleep(0.5)
            seite.select_option("#wahlBewegt", "2")
            seite.fill("#regVoxel", "3")
            seite.fill("#regFang", "2")
            seite.click("[data-aktion=regAuto]")
            seite.wait_for_selector("#regErgebnis:not([hidden])", timeout=60000)
            text = seite.inner_text("#regErgebnis")
            print("  " + text.replace("\n", " | "))
            matrix = seite.evaluate("v3dscan.S.regMatrizen[2]")
            soll = json.load(open(os.path.join(DATEN, "soll.json")))["ansicht_2.ply"]["matrix"]
            abw = max(abs(matrix[i][3] - soll[i][3]) for i in range(3))
            pruefe(abw < 1.0, "Automatisch: Verschiebung weicht %.3f mm ab" % abw)
            oeffne("ausrichten", "w-reg-abw")
            seite.click("#wfInhalt [data-aktion=abweichung]")
            seite.wait_for_selector("#legende:not([hidden])", timeout=30000)
            seite.mouse.move(cx, cy + 5)
            seite.screenshot(path=os.path.join(BILDER, "04_ausgerichtet_abweichung.png"))
            oeffne("ausrichten", "w-reg-auto")
            seite.click("#wfInhalt [data-aktion=regAnwenden]")
            seite.wait_for_function("!v3dscan.S.regMatrizen && !v3dscan.S.beschaeftigt", timeout=30000)
            time.sleep(0.5)
            oeffne("ausrichten", "w-reg-merge")
            seite.click("#wfInhalt [data-aktion=zusammenfuehren]")
            seite.wait_for_function("v3dscan.S.scans.size === 3", timeout=30000)
            pruefe(True, "Zusammengeführt")
            seite.mouse.move(cx, cy - 5)
            seite.screenshot(path=os.path.join(BILDER, "05_zusammengefuehrt.png"))

            pruefe(not konsole, "keine JS-Fehler im Ablauf %s" % konsole[:3])
            browser.close()
    finally:
        if dienst:
            dienst.terminate()
            dienst.wait(5)
    print()
    print("FEHLER: %d" % len(fehler) if fehler else "Alles in Ordnung.")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
