#!/usr/bin/env python3
# Achsen-Reiter: Bauteil (Platte mit Bohrung) per 3-2-1 ins Bauteil-System legen.
#
#   python3 tests/test_oberflaeche_achsen.py

import json
import os
import subprocess
import sys
import time
import urllib.request

import numpy as np
from playwright.sync_api import sync_playwright

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL = os.path.join(HIER, "..")
DATEN = os.path.join(HIER, "daten")
BILDER = os.path.join(HIER, "bilder")
PORT = int(os.environ.get("V3DSCAN_TEST_PORT") or 18796)
fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def main():
    soll_pfad = os.path.join(DATEN, "soll.json")
    if not os.path.exists(soll_pfad) or "bauteil.ply" not in json.load(open(soll_pfad)):
        subprocess.check_call([sys.executable, os.path.join(HIER, "testdaten.py")])
    soll = np.array(json.load(open(soll_pfad))["bauteil.ply"]["matrix"])
    os.makedirs(BILDER, exist_ok=True)
    dienst = None
    if not os.environ.get("V3DSCAN_TEST_PORT"):
        dienst = subprocess.Popen([sys.executable, os.path.join(WURZEL, "server.py"), "--port", str(PORT),
                                   "--laden", os.path.join(DATEN, "bauteil.ply")], cwd=WURZEL)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen("http://127.0.0.1:%d/api/puls" % PORT, timeout=1)
                break
            except Exception:
                time.sleep(0.2)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            seite = browser.new_page(viewport={"width": 1500, "height": 900})
            konsole = []
            seite.on("console", lambda m: konsole.append(m.text) if m.type == "error" else None)
            seite.on("pageerror", lambda e: konsole.append(str(e)))
            seite.goto("http://127.0.0.1:%d/" % PORT)
            seite.wait_for_function("window.v3dscan && v3dscan.S.scans.size === 1", timeout=30000)
            leer = lambda: seite.wait_for_function("!v3dscan.S.beschaeftigt", timeout=60000)  # noqa: E731
            seite.click("#reiter button[data-reiter=achsen]")

            # Auswahl als Zustand setzen (welche Punkte auf welcher Flaeche liegen,
            # weiss nur der Test ueber die Soll-Matrix); geklickt wird echt.
            seite.evaluate("""(soll) => {
              const e = v3dscan.S.scans.get(1);
              e.teil = new Float32Array(e.n * 3);
              for (let i = 0; i < e.n; i++) {
                const x = e.xyz[i*3], y = e.xyz[i*3+1], z = e.xyz[i*3+2];
                for (let k = 0; k < 3; k++) e.teil[i*3+k] = soll[k][0]*x + soll[k][1]*y + soll[k][2]*z + soll[k][3];
              }
              window.waehle = (bed) => { for (let i = 0; i < e.n; i++) {
                const p = [e.teil[i*3], e.teil[i*3+1], e.teil[i*3+2]]; e.sel[i] = bed(p) ? 1 : 0; } };
            }""", soll.tolist())

            def slot_form(slot, bedingung, knopf):
                seite.evaluate("waehle((p) => %s)" % bedingung)
                seite.click("#s-achsen [data-slot=%s] [data-form=%s]" % (slot, knopf))
                leer()
                time.sleep(0.3)
                return seite.inner_text("#s-achsen [data-slot=%s] [data-info]" % slot)

            info = slot_form("primaer", "Math.abs(p[2]-15) < 0.2 && p[0] < 25", "ebene")
            print("  Primär:", info)
            pruefe(info.startswith("Ebene"), "Primär = Deckfläche")
            info = slot_form("sekundaer", "Math.abs(p[0]-60) < 0.2", "ebene")
            print("  Sekundär:", info)
            info = slot_form("ursprung", "Math.abs(Math.hypot(p[0]-35, p[1]-20) - 5.015) < 0.2 && p[2] > 0.5 && p[2] < 14.5", "zylinder")
            print("  Ursprung:", info)
            pruefe("Ø 10,03" in info, "Bohrung als Zylinder Ø 10,03 erkannt")
            seite.select_option("#s-achsen [data-slot=sekundaer] [data-ziel]", "x")
            seite.click("[data-aktion=koordElemente]")
            leer()
            time.sleep(0.5)
            seite.mouse.move(700, 400)
            seite.screenshot(path=os.path.join(BILDER, "a1_elemente_vorschau.png"))
            T = np.array(seite.evaluate("v3dscan.S.regMatrizen[1]"))
            erwartet = np.eye(4)
            erwartet[:3, 3] = [-35, -20, -7.5]
            erwartet = erwartet @ soll
            abw_dreh = np.degrees(np.arccos(np.clip((np.trace(T[:3, :3].T @ erwartet[:3, :3]) - 1) / 2, -1, 1)))
            abw_weg = np.linalg.norm(T[:3, 3] - erwartet[:3, 3])
            pruefe(abw_dreh < 0.05 and abw_weg < 0.1, "3-2-1: %.4f° / %.4f mm vom Soll" % (abw_dreh, abw_weg))

            seite.click("[data-aktion=koordAnwenden] >> nth=0")
            leer()
            seite.wait_for_function("v3dscan.S.scans.get(1).rev > 1", timeout=30000)
            time.sleep(0.5)
            z = seite.evaluate("""() => { const e = v3dscan.S.scans.get(1); let lo = 1e9, hi = -1e9;
              for (let i = 0; i < e.n; i++) { lo = Math.min(lo, e.xyz[i*3+2]); hi = Math.max(hi, e.xyz[i*3+2]); } return [lo, hi]; }""")
            pruefe(abs(z[0] + 7.5) < 0.2 and abs(z[1] - 7.5) < 0.2, "Anwenden: Platte liegt Z %.2f … %.2f" % tuple(z))
            seite.keyboard.press("2")
            seite.mouse.move(705, 405)
            seite.screenshot(path=os.path.join(BILDER, "a2_angewendet_oben.png"))

            # Automatik: auf groesste Ebene stellen -> Boden auf Z=0
            seite.select_option("#autoUrsprung", "unten")
            seite.click("[data-aktion=koordEbene]")
            leer()
            time.sleep(0.3)
            T2 = np.array(seite.evaluate("v3dscan.S.regMatrizen[1]"))
            e = np.abs(T2[:3, :3] @ [0, 0, 1])
            pruefe(e.max() > 0.999, "Auf größte Ebene: eine Plattenfläche wird Boden")
            seite.click("[data-aktion=koordZurueck] >> nth=0")

            pruefe(not konsole, "keine JS-Fehler %s" % konsole[:3])
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
