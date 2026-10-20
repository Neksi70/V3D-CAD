#!/usr/bin/env python3
# Abweichungskarte Scan <-> Koerper (Etappe F "Accuracy Analyzer").
#
#   python3 tests/test_abweichung.py
#
# Sollwerte: Platte 100 x 60 x 15 mit Durchgangsbohrung Ø 20 bei (50, 30).
# Punkte werden gezielt um bekannte Betraege neben/auf/in die Oberflaeche gelegt.

import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))

from kern import koerper as kp  # noqa: E402
from kern.wolke import Scan  # noqa: E402

fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def platte_mit_bohrung():
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
    from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
    box = BRepPrimAPI_MakeBox(100, 60, 15).Shape()
    zyl = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(50, 30, -1), gp_Dir(0, 0, 1)), 10, 17).Shape()
    return BRepAlgoAPI_Cut(box, zyl).Shape()


def testpunkte():
    rng = np.random.default_rng(1)
    # Deckel: 0,2 mm darueber (Scan hat mehr Material -> +0,2)
    xy = rng.uniform([5, 5], [35, 55], (500, 2))
    oben = np.c_[xy, np.full(500, 15.2)]
    # Boden: 0,1 mm ins Material hinein (-> -0,1)
    xy = rng.uniform([65, 5], [95, 55], (500, 2))
    unten = np.c_[xy, np.full(500, 0.1)]
    # Bohrungswand: Radius 9,7 statt 10 -> Punkt liegt in der Luft der Bohrung,
    # also ausserhalb des Koerpers (Bohrung im Scan kleiner) -> +0,3
    w = rng.uniform(0, 2 * np.pi, 500)
    z = rng.uniform(2, 13, 500)
    bohr = np.c_[50 + 9.7 * np.cos(w), 30 + 9.7 * np.sin(w), z]
    # Ausreisser ohne Gegenstueck
    weit = np.array([[50, 30, 40.0], [-20, 0, 7]])
    return oben, unten, bohr, weit


def kern_test():
    print("Kern")
    shape = platte_mit_bohrung()
    oben, unten, bohr, weit = testpunkte()
    xyz = np.concatenate([oben, unten, bohr, weit]).astype(np.float32)
    t = time.time()
    d = kp.abweichung([shape], xyz)
    dauer = time.time() - t
    a, b, c = d[:500], d[500:1000], d[1000:1500]
    pruefe(np.allclose(a, 0.2, atol=1e-4), "Deckel +0,2: %.4f … %.4f" % (a.min(), a.max()))
    pruefe(np.allclose(b, -0.1, atol=1e-4), "Boden −0,1: %.4f … %.4f" % (b.min(), b.max()))
    # Zylinder ist facettiert vernetzt (Sehnenfehler < lin) -> etwas groessere Toleranz
    pruefe(np.allclose(c, 0.3, atol=0.005), "Bohrung zu klein +0,3: %.4f … %.4f" % (c.min(), c.max()))
    # (50,30,40) liegt ueber der Bohrung: naechster Punkt ist die Bohrungskante oben
    pruefe(abs(d[1500] - np.hypot(10, 25)) < 0.01 and abs(d[1501] - 20) < 0.01,
           "Ausreißer 26,93 / 20 mm: %.3f / %.3f" % (d[1500], d[1501]))
    kw = kp.abweichung_kennwerte(d, toleranz=0.15, ausblenden=2.0)
    pruefe(kw["anzahl"] == 1500 and kw["ohne_gegenstueck"] == 2,
           "Ausblenden > 2 mm: %d gezählt, %d ohne Gegenstück" % (kw["anzahl"], kw["ohne_gegenstueck"]))
    pruefe(abs(kw["in_toleranz"] - 100 / 3) < 0.5, "±0,15 mm: %.1f %% in Toleranz (Soll 33,3 %%)" % kw["in_toleranz"])
    pruefe(abs(kw["mittel"] - 0.4 / 3) < 0.01, "Mittel %.4f (Soll 0,1333)" % kw["mittel"])

    # zwei Koerper: Punkte gehoeren zum jeweils naechsten
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
    from OCP.gp import gp_Pnt
    zweiter = BRepPrimAPI_MakeBox(gp_Pnt(200, 0, 0), 10, 10, 10).Shape()
    d2 = kp.abweichung([shape, zweiter], np.array([[205, 5, 10.5], [20, 20, 15.2]], np.float32))
    pruefe(np.allclose(d2, [0.5, 0.2], atol=0.003), "Mehrere Körper: %s" % np.round(d2, 4).tolist())

    # Leistung: 1 Mio Punkte
    viele = np.random.default_rng(2).uniform([-5, -5, -5], [105, 65, 20], (1_000_000, 3)).astype(np.float32)
    t = time.time()
    kp.abweichung([shape], viele)
    t1 = time.time() - t
    pruefe(t1 < 10, "1 Mio Punkte in %.1f s (1503 Punkte: %.2f s)" % (t1, dauer))


def http_test():
    print("Server")
    from test_koerper import _frei
    from kern.wolke import ausgeben
    import tempfile
    port = _frei(18798)
    basis = "http://127.0.0.1:%d" % port
    prozess = subprocess.Popen([sys.executable, os.path.join(HIER, "..", "server.py"), "--port", str(port)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def holen(pfad, daten=None):
        if daten is not None and not isinstance(daten, bytes):
            daten = json.dumps(daten).encode()
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
        # Scan: dichter Zapfen r = 10,04 mit 0,02 mm Rauschen -> Nennmass Ø 20,
        # Koerper r = 10, Abweichung im Mittel +0,04
        rng = np.random.default_rng(3)
        w = rng.uniform(0, 2 * np.pi, 30000)
        r = 10.04 + rng.normal(0, 0.02, 30000)
        nrm = np.c_[np.cos(w), np.sin(w), np.zeros(30000)]
        s = Scan("zapfen", np.c_[r * np.cos(w), r * np.sin(w), rng.uniform(0, 30, 30000)], nrm=nrm)
        with tempfile.TemporaryDirectory() as tmp:
            ausgeben(s, os.path.join(tmp, "z.ply"), "ply")
            sid = holen("/api/import?name=zapfen.ply", open(os.path.join(tmp, "z.ply"), "rb").read())["neu"]
        a = holen("/api/koerper/abweichung", {"id": sid})
        pruefe(a.get("_status") == 400 or "Körper" in a.get("fehler", ""),
               "ohne Körper: verständliche Meldung (%s)" % a.get("fehler"))
        erk = holen("/api/formen/erkennen", {"id": sid})["erkennung"]
        el = next(e for e in erk["elemente"] if e["typ"] in ("zapfen", "zylinder", "zylinderflaeche"))
        holen("/api/koerper/aus_form", {"id": sid, "element": el["id"], "nennmass": True, "verlaengern": 0,
                                        "operation": "neu", "ziel": None})
        a = holen("/api/koerper/abweichung", {"id": sid, "toleranz": 0.3, "ausblenden": 2})
        werte = np.frombuffer(base64.b64decode(a["werte"]), np.float32)
        kw = a["kennwerte"]
        print("   ", el["typ"], el.get("durchmesser"), el.get("durchmesser_nenn"), kw)
        pruefe(el.get("durchmesser_nenn") == 20, "Nennmaß Ø %s" % el.get("durchmesser_nenn"))
        pruefe(len(werte) == len(s) and kw["ohne_gegenstueck"] < 0.01 * len(s) and abs(kw["mittel"] - 0.04) < 0.005,
               "Zapfen gegen Nennmaß-Körper: Mittel %.4f (Soll +0,04), Std %.4f" % (kw["mittel"], kw["std"]))
        pruefe(kw["in_toleranz"] > 99, "%.1f %% in ±0,3" % kw["in_toleranz"])
    finally:
        prozess.terminate()
        prozess.wait(10)


if __name__ == "__main__":
    sys.path.insert(0, HIER)
    kern_test()
    http_test()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
