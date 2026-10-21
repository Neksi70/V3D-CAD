#!/usr/bin/env python3
# Auto-Sicherung + Navigationsschemata (v1.2): Dienst sichert nur nach Aenderungen, behaelt die letzten 5,
# Sicherung laden ersetzt das Projekt; Optionen-Dialog stellt die Maustasten um.
#
#   python3 tests/test_sicherung.py

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HIER)
fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def main():
    from test_koerper import _frei
    from test_oberflaeche_skizze import testdatei
    port = _frei(18797)
    basis = "http://127.0.0.1:%d" % port
    ordner = tempfile.mkdtemp()
    umg = dict(os.environ, V3DSCAN_SICHERUNG=ordner)
    prozess = subprocess.Popen([sys.executable, os.path.join(HIER, "..", "server.py"), "--port", str(port)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=umg)

    def holen(pfad, daten=None):
        if daten is not None and not isinstance(daten, bytes):
            daten = json.dumps(daten).encode()
        with urllib.request.urlopen(urllib.request.Request(basis + pfad, data=daten), timeout=120) as r:
            return json.loads(r.read())
    try:
        for _ in range(100):
            try:
                holen("/api/puls")
                break
            except OSError:
                time.sleep(0.2)
        pruefe(holen("/api/sicherung/jetzt", {})["name"] is None, "leeres Projekt wird nicht gesichert")
        holen("/api/import?name=platte.ply", open(testdatei(), "rb").read())
        holen("/api/koerper/aus_form", {}) if False else None
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xy", "versatz": 0}})
        holen("/api/skizze/zeichnen", {"art": "rechteck", "punkte": [[0, 0], [10, 10]]})
        holen("/api/skizze/uebernehmen", {})
        n1 = holen("/api/sicherung/jetzt", {})["name"]
        pruefe(bool(n1) and os.path.exists(os.path.join(ordner, n1)), "Sicherung geschrieben: %s" % n1)
        # automatisch: Abstand 0,05 min, nur nach Aenderung
        holen("/api/sicherung/einstellen", {"minuten": 0.05})
        time.sleep(1.1)
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xy", "versatz": 5}})
        holen("/api/skizze/zeichnen", {"art": "kreis", "punkte": [[0, 0], [3, 0]]})
        holen("/api/skizze/uebernehmen", {})
        for _ in range(40):
            liste = holen("/api/sicherung/liste", {})["liste"]
            if len(liste) >= 2:
                break
            time.sleep(1)
        pruefe(len(liste) == 2, "Auto-Sicherung nach Änderung: %d Dateien" % len(liste))
        time.sleep(15)
        pruefe(len(holen("/api/sicherung/liste", {})["liste"]) == 2, "ohne Änderung keine weitere Sicherung")
        holen("/api/sicherung/einstellen", {"minuten": 0})
        # Laden: neues Projekt, dann Sicherung zurueck
        holen("/api/projekt/neu", {})
        z = holen("/api/sicherung/laden", {"name": liste[0]["name"]})
        pruefe(len(z["scans"]) == 1 and len(z["skizzen"]) == 2, "Sicherung geladen: %d Scan, %d Skizzen" % (len(z["scans"]), len(z["skizzen"])))
        # nur 5 behalten
        for i in range(6):
            holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xy", "versatz": 10 + i}})
            holen("/api/skizze/zeichnen", {"art": "kreis", "punkte": [[0, 0], [1, 0]]})
            holen("/api/skizze/uebernehmen", {})
            holen("/api/sicherung/jetzt", {})
            time.sleep(1.05)                      # Dateinamen sekundengenau
        pruefe(len(os.listdir(ordner)) == 5, "nur die letzten 5 bleiben (%d)" % len(os.listdir(ordner)))
        try:
            holen("/api/sicherung/laden", {"name": "../etwas"})
            pruefe(False, "fremder Dateiname abgelehnt")
        except urllib.error.HTTPError:
            pruefe(True, "fremder Dateiname abgelehnt")
        # Oberflaeche: Navigationsschema
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            b = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            seite = b.new_page(viewport={"width": 1400, "height": 900})
            seite.goto(basis + "/")
            seite.wait_for_function("window.v3dscan && v3dscan.S.zustand", timeout=30000)
            seite.evaluate("v3dscan.aktionAusfuehren ? v3dscan.aktionAusfuehren('optionen') : document.querySelector('[data-aktion=optionen]').click()")
            seite.wait_for_selector("#optionenDialog[open]", timeout=10000)
            zeilen = seite.locator("#sichTabelle tr").count()
            pruefe(zeilen == 5, "Optionen zeigen 5 Sicherungen")
            seite.select_option("#navSchema", "solidworks")
            seite.check("#navRad")
            mitte = seite.evaluate("v3dscan.steuerung.mouseButtons.MIDDLE")
            zoom = seite.evaluate("v3dscan.steuerung.zoomSpeed")
            pruefe(mitte == 0 and zoom < 0, "SolidWorks: Mitte dreht (%s), Rad umgekehrt (%s)" % (mitte, zoom))
            seite.reload()
            seite.wait_for_function("window.v3dscan && v3dscan.S.zustand", timeout=30000)
            pruefe(seite.evaluate("v3dscan.steuerung.mouseButtons.MIDDLE") == 0, "Schema bleibt nach Neuladen")
            b.close()
    finally:
        prozess.terminate()
        prozess.wait(10)


if __name__ == "__main__":
    main()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
