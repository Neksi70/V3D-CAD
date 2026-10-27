#!/usr/bin/env python3
# v1.5 über den Dienst: Extrusion bis zur Punktauswahl, Radius aus Auswahl, beide Teile beim Schneiden,
# Gewinde-Enden, Loft verlängert, Füllfläche mit innerer Kurve, Fläche je Seite verlängern, Fläche aus Skizze.
#
#   python3 tests/test_v15.py

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
    from kern import koerper as kp
    from kern.wolke import Scan, ausgeben
    port = _frei(18804)
    basis = "http://127.0.0.1:%d" % port
    pr = subprocess.Popen([sys.executable, os.path.join(HIER, "..", "server.py"), "--port", str(port)],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def holen(pfad, d=None, roh=None):
        daten = roh if roh is not None else (json.dumps(d).encode() if d is not None else None)
        try:
            with urllib.request.urlopen(urllib.request.Request(basis + pfad, data=daten), timeout=300) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            return {"_status": e.code, **json.loads(e.read())}

    def maske(n, wahl):
        return base64.b64encode(np.packbits(wahl, bitorder="little").tobytes()).decode()

    def koerper(kid):
        return [k for k in holen("/api/zustand")["koerper"] if k["id"] == kid][0] if "koerper" in holen("/api/zustand") else None
    try:
        for _ in range(100):
            try:
                holen("/api/puls")
                break
            except OSError:
                time.sleep(0.2)
        # Scan: Quader 40 x 30 x 12.3 als Punktwolke (Oberseite bei z = 12.3)
        rng = np.random.default_rng(0)
        oben = np.c_[rng.uniform(0, 40, 4000), rng.uniform(0, 30, 4000), np.full(4000, 12.3)]
        rund = np.c_[50 + 7 * np.cos(t := rng.uniform(0, math.pi / 2, 3000)), rng.uniform(0, 30, 3000), 7 * np.sin(t)]
        X = np.r_[oben, rund]
        with tempfile.TemporaryDirectory() as tmp:
            ausgeben(Scan("q", X), os.path.join(tmp, "q.ply"), "ply")
            sid = holen("/api/import?name=q.ply", roh=open(os.path.join(tmp, "q.ply"), "rb").read())["neu"]
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xy", "versatz": 0}})
        holen("/api/skizze/zeichnen", {"art": "rechteck", "punkte": [[0, 0], [40, 30]]})
        s1 = holen("/api/skizze/uebernehmen", {})["sid"]
        m_oben = maske(len(X), np.r_[np.ones(4000, bool), np.zeros(3000, bool)])
        a = holen("/api/feature/extrudieren", {"sid": s1, "modus": "auswahl", "masken": {str(sid): m_oben}, "operation": "neu"})
        k = a.get("koerper")
        v = a.get("info", {}).get("volumen") or kp and None
        z = holen("/api/koerper/bauplan", {"kid": k})["volumen"]
        pruefe(abs(z - 40 * 30 * 12.3) < 0.1, "Extrusion bis zur Auswahl: Höhe 12,3 (Volumen %.1f)" % z)
        m_rund = maske(len(X), np.r_[np.zeros(4000, bool), np.ones(3000, bool)])
        a = holen("/api/feature/radius_auswahl", {"masken": {str(sid): m_rund}})
        pruefe(abs(a["radius"] - 7) < 0.01, "Radius aus Auswahl: R %.3f (Soll 7)" % a["radius"])
        # Flaeche aus Skizze (mit Loch)
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xy", "versatz": 20}})
        holen("/api/skizze/zeichnen", {"art": "rechteck", "punkte": [[0, 0], [40, 30]]})
        holen("/api/skizze/zeichnen", {"art": "kreis", "punkte": [[20, 15], [25, 15]]})
        s2 = holen("/api/skizze/uebernehmen", {})["sid"]
        a = holen("/api/feature/skizze_flaeche", {"sid": s2, "vorschau": True})
        pruefe(abs(a["info"]["flaeche"] - (1200 - math.pi * 25)) < 0.5, "Fläche aus Skizze: %.1f mm² (Soll 1121,5)" % a["info"]["flaeche"])
        f = holen("/api/feature/skizze_flaeche", {"sid": s2})["koerper"]
        # Flaeche je Seite verlaengern
        a = holen("/api/feature/verlaengern", {"kid": f, "seiten": [5, 0, 0, 0], "vorschau": True})
        # Verlaengern baut die Flaeche unbeschnitten neu (wie bisher): 40 x 30 + eine Seite 5 mm = 45 x 30
        pruefe(abs(a["info"]["flaeche"] - 45 * 30) < 3, "nur eine Seite um 5 mm verlängert: %.1f mm² (Soll 1350)" % a["info"]["flaeche"])
        # beide Teile behalten: Quader mit der Flaeche z = 6 schneiden
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xy", "versatz": 6}})
        holen("/api/skizze/zeichnen", {"art": "rechteck", "punkte": [[-10, -10], [50, 40]]})
        s3 = holen("/api/skizze/uebernehmen", {})["sid"]
        schnitt = holen("/api/feature/skizze_flaeche", {"sid": s3})["koerper"]
        a = holen("/api/feature/schneiden_flaeche", {"kid": k, "fid": schnitt, "behalten": "beide"})
        teile = a.get("koerper") or []
        vol = sorted(holen("/api/koerper/bauplan", {"kid": t})["volumen"] for t in teile)
        pruefe(len(teile) == 2 and abs(vol[0] - 40 * 30 * 6) < 0.5 and abs(vol[1] - 40 * 30 * 6.3) < 0.5,
               "Schneiden, beide behalten: %s mm³" % [round(x) for x in vol])
        # Loft verlaengert: zwei gleiche Quadrate im Abstand 10 → mit 5 mm je Ende = Prisma 20 hoch
        sids = []
        for z_ in (100, 110):
            holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xy", "versatz": z_}})
            holen("/api/skizze/zeichnen", {"art": "rechteck", "punkte": [[0, 0], [10, 10]]})
            sids.append(holen("/api/skizze/uebernehmen", {})["sid"])
        a = holen("/api/feature/loft", {"sids": sids, "glatt": False, "verlaengern": 5, "vorschau": True, "operation": "neu"})
        pruefe(abs(a["info"]["volumen"] - 2000) < 1, "Loft 5 mm über beide Enden: %.1f mm³ (Soll 2000)" % a["info"]["volumen"])
        # Fuellflaeche mit innerer Fuehrungskurve: quadratischer Rand, Kurve in der Mitte 5 mm hoch
        rand = holen("/api/skizze/3d", {"punkte": [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0]], "glatt": False,
                                       "geschlossen": True, "auf_scan": False})["sid"]
        kurve = holen("/api/skizze/3d", {"punkte": [[5, 10, 3], [10, 10, 5], [15, 10, 3]], "auf_scan": False})["sid"]
        a = holen("/api/feature/fuellen", {"sid": rand, "kurven": [kurve], "vorschau": True})
        ohne = holen("/api/feature/fuellen", {"sid": rand, "vorschau": True})
        pruefe(a["info"]["flaeche"] > ohne["info"]["flaeche"] + 5, "Füllfläche wölbt sich über die Führungskurve (%.1f gegen %.1f mm² flach)"
               % (a["info"]["flaeche"], ohne["info"]["flaeche"]))
    finally:
        pr.terminate()
        pr.wait(10)


if __name__ == "__main__":
    main()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
