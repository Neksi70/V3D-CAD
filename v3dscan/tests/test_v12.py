#!/usr/bin/env python3
# v1.2 Nachtrag über den Dienst: Referenz aus Koerperflaeche, Grundkoerper per Eingabe, Skizze als IGES,
# Rundung mit Abweichung zum Scan, Flaechen-Fit nach Toleranz.
#
#   python3 tests/test_v12.py

import base64
import json
import math
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))
sys.path.insert(0, HIER)
fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def main():
    from test_koerper import _frei
    port = _frei(18800)
    basis = "http://127.0.0.1:%d" % port
    prozess = subprocess.Popen([sys.executable, os.path.join(HIER, "..", "server.py"), "--port", str(port)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def holen(pfad, d=None, roh=None):
        daten = roh if roh is not None else (json.dumps(d).encode() if d is not None else None)
        try:
            with urllib.request.urlopen(urllib.request.Request(basis + pfad, data=daten), timeout=300) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            return {"_status": e.code, **json.loads(e.read())}
    try:
        for _ in range(100):
            try:
                holen("/api/puls")
                break
            except OSError:
                time.sleep(0.2)
        # Grundkoerper per Eingabe
        a = holen("/api/koerper/eingabe", {"art": "quader", "mitte": [0, 0, 10], "groesse": [40, 30, 20]})
        q = a["koerper"]
        a = holen("/api/koerper/eingabe", {"art": "zylinder", "mitte": [0, 0, 10], "achse": [0, 0, 1], "hoehe": 30, "radius": 5,
                                           "operation": "abziehen", "ziel": q})
        bb = holen("/api/koerper/bauplan", {"kid": q})
        print("    ", {k_: bb[k_] for k_ in bb if k_ != "befehle"})
        v = bb["volumen"]
        pruefe(abs(v - (24000 - math.pi * 25 * 20)) < 1, "Quader 40×30×20 minus Zylinder Ø10: %.1f mm³" % v)
        a = holen("/api/koerper/eingabe", {"art": "kegel", "mitte": [100, 0, 10], "hoehe": 20, "r_max": 10, "r_min": 5})
        b = holen("/api/koerper/bauplan", {"kid": a["koerper"]})
        soll = math.pi * 20 / 3 * (100 + 50 + 25)
        pruefe(abs(b["volumen"] - soll) < 1, "Kegelstumpf R10→R5 × 20: %.1f (Soll %.1f)" % (b["volumen"], soll))
        a = holen("/api/koerper/eingabe", {"art": "quader", "groesse": [0, 1, 1]})
        pruefe("größer 0" in a.get("fehler", ""), "Quader mit Maß 0 abgelehnt")
        # Referenz aus Koerperflaeche: Flaechen des Quaders durchsuchen
        arten = []
        for nr in range(1, 9):
            r = holen("/api/referenz/aus_flaeche", {"kid": q, "flaechen": [nr]})
            if "art" in r:
                arten.append(r["art"])
        pruefe(arten.count("ebene") == 6 and arten.count("achse") == 1, "Referenzen aus Flächen: %s" % arten)
        # Skizze als IGES
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xy", "versatz": 3}})
        holen("/api/skizze/zeichnen", {"art": "langloch", "punkte": [[0, 0], [20, 0]], "wert": 6})
        sid = holen("/api/skizze/uebernehmen", {})["sid"]
        a = holen("/api/skizze/iges", {"sid": sid})
        iges = base64.b64decode(a["iges"]).decode("ascii", "replace")
        pruefe(len(iges) > 500 and " 100" in iges and " 110" in iges, "Skizze als IGES (Linien 110 + Kreisbögen 100)")
        # Uebergangskurve zwischen zwei 3D-Skizzen
        sa = holen("/api/skizze/3d", {"punkte": [[0, 0, 0], [10, 0, 0], [20, 0, 0]], "auf_scan": False})["sid"]
        sb = holen("/api/skizze/3d", {"punkte": [[40, 10, 0], [40, 20, 0], [40, 30, 0]], "auf_scan": False})["sid"]
        a = holen("/api/skizze/uebergang", {"sid_a": sa, "ende_a": "ende", "sid_b": sb, "ende_b": "anfang"})
        z = holen("/api/skizze/holen", {"sid": a["sid"]})["skizze"]
        K = np.asarray(z["kurve"], float)
        t0 = (K[1] - K[0]) / np.linalg.norm(K[1] - K[0])
        t1 = (K[-1] - K[-2]) / np.linalg.norm(K[-1] - K[-2])
        pruefe(np.allclose(K[0], [20, 0, 0], atol=1e-3) and np.allclose(K[-1], [40, 10, 0], atol=1e-3)
               and t0 @ [1, 0, 0] > 0.99 and t1 @ [0, 1, 0] > 0.99,
               "Übergangskurve: (20,0,0) → (40,10,0), tangential an beiden Enden (%.3f / %.3f)" % (t0 @ [1, 0, 0], t1 @ [0, 1, 0]))
        # Flaechen-Fit nach Toleranz auf einer welligen Flaeche
        from kern.wolke import Scan, ausgeben
        u, w = np.meshgrid(np.linspace(0, 60, 120), np.linspace(0, 40, 80))
        X = np.c_[u.ravel(), w.ravel(), (3 * np.sin(u / 6) * np.cos(w / 9)).ravel()]
        with tempfile.TemporaryDirectory() as tmp:
            ausgeben(Scan("welle", X), os.path.join(tmp, "w.ply"), "ply")
            sc = holen("/api/import?name=welle.ply", roh=open(os.path.join(tmp, "w.ply"), "rb").read())["neu"]
        maske = base64.b64encode(np.packbits(np.ones(len(X), bool), bitorder="little").tobytes()).decode()
        a = holen("/api/freiform/flaeche", {"masken": {str(sc): maske}, "toleranz": 0.02, "vorschau": True})
        if "info" not in a:
            print("    ", a)
        pruefe(a.get("info", {}).get("toleranz_erreicht") and a["info"]["p95"] <= 0.02,
               "Fit nach Toleranz 0,02: Raster %s, 95 %% unter %s" % (a.get("info", {}).get("raster_gewaehlt"), a.get("info", {}).get("p95")))
    finally:
        prozess.terminate()
        prozess.wait(10)


if __name__ == "__main__":
    main()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
