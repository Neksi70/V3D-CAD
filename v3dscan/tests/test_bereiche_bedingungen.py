#!/usr/bin/env python3
# v1.5: Bedingungen beim Extrahieren (parallel/rechtwinklig/koaxial), Formabweichung je Bereich, Einheiten.
#
#   python3 tests/test_bereiche_bedingungen.py

import math
import os
import sys
import tempfile

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))

from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse  # noqa: E402
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform  # noqa: E402
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder  # noqa: E402
from OCP.gp import gp_Ax1, gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf  # noqa: E402

from kern import erkennung as er  # noqa: E402
from kern import koerper as kp  # noqa: E402
from kern import wolke  # noqa: E402

fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def drehen(shape, achse, grad, punkt=(0, 0, 0)):
    t = gp_Trsf()
    t.SetRotation(gp_Ax1(gp_Pnt(*punkt), gp_Dir(*achse)), math.radians(grad))
    return BRepBuilderAPI_Transform(shape, t, True).Shape()


def scan_aus(shape):
    d = tempfile.mkdtemp()
    f = os.path.join(d, "s.stl")
    open(f, "wb").write(kp.stl_daten([shape]))
    return wolke.einlesen(f)


def main():
    a = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 10, 30).Shape()
    b = drehen(BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0.02, 0, 30), gp_Dir(0, 0, 1)), 6, 25).Shape(), (1, 0, 0), 0.6, (0, 0, 30))
    welle = drehen(BRepAlgoAPI_Fuse(a, b).Shape(), (1, 0, 0), 20)            # schraeg: keine Weltachse
    erk = er.erkennen(scan_aus(welle))
    zyl = sorted([e for e in erk["elemente"] if e["art"] == "zylinder"], key=lambda e: -e["radius"])
    pruefe(len(zyl) == 2, "zwei Zylinder erkannt")
    w_mess = math.degrees(math.acos(min(1, abs(float(np.dot(zyl[0]["achse"], zyl[1]["achse"]))))))
    w_nenn = math.degrees(math.acos(min(1, abs(float(np.dot(zyl[0]["achse_nenn"], zyl[1]["achse_nenn"]))))))
    pruefe(w_mess > 0.3 and w_nenn < 1e-6, "Achsen gemessen %.2f° auseinander → als parallel exakt 0°" % w_mess)
    pruefe(any("koaxial" in x for x in zyl[1].get("bezug", [])), "kleiner Absatz koaxial zum großen: %s" % zyl[1].get("bezug"))
    # Grundkoerper auf der gemeinsamen Achse
    p0 = kp.grundkoerper_parameter(er.als_json(zyl[0]))
    p1 = kp.grundkoerper_parameter(er.als_json(zyl[1]))
    v = np.subtract(p1["punkt"], p0["punkt"])
    quer = np.linalg.norm(v - (v @ np.asarray(p0["achse"])) * np.asarray(p0["achse"]))
    pruefe(quer < 1e-4, "Grundkörper liegen auf einer Achse (Querversatz %.2e mm)" % quer)
    ebenen = [e for e in erk["elemente"] if e["art"] == "ebene"]
    pruefe(all("form" in e and e["form"]["art"] == "Ebenheit" for e in ebenen) and
           all(e["form"]["art"] == "Zylinderform" and e["form"]["wert"] < 0.01 for e in zyl),
           "Formabweichung je Bereich (Ebenheit/Zylinderform)")
    # rechtwinklig: Quader, eine Seitenflaeche um 0,8 Grad verkippt (schraeg zur Welt)
    q = drehen(drehen(BRepPrimAPI_MakeBox(40, 30, 20).Shape(), (0, 0, 1), 25), (1, 0, 0), 15)
    erk = er.erkennen(scan_aus(q))
    n = [np.asarray(e["normale_nenn"]) for e in erk["elemente"] if e["art"] == "ebene"]
    w = sorted({round(math.degrees(math.acos(min(1, abs(float(a_ @ b_))))), 6) for a_ in n for b_ in n})
    pruefe(set(w) <= {0.0, 90.0}, "Quader schräg: alle Normalen exakt parallel oder rechtwinklig %s" % w)
    # Einheiten: Scan in inch → intern mm
    import json, subprocess, time, urllib.request
    sys.path.insert(0, HIER)
    from test_koerper import _frei
    port = _frei(18803)
    basis = "http://127.0.0.1:%d" % port
    pr = subprocess.Popen([sys.executable, os.path.join(HIER, "..", "server.py"), "--port", str(port)],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(basis + "/api/puls", timeout=1)
                break
            except OSError:
                time.sleep(0.2)
        d = tempfile.mkdtemp()
        f = os.path.join(d, "zoll.stl")
        open(f, "wb").write(kp.stl_daten([BRepPrimAPI_MakeBox(1, 2, 3).Shape()]))
        z = json.loads(urllib.request.urlopen(urllib.request.Request(basis + "/api/import?name=zoll.stl&einheit=inch",
                                                                     data=open(f, "rb").read()), timeout=60).read())
        sid = z["neu"]
        stl = urllib.request.urlopen(basis + "/api/export/%d?format=stl&einheit=inch" % sid, timeout=60).read()
        g = wolke.einlesen(f)
        f2 = os.path.join(d, "zurueck.stl")
        open(f2, "wb").write(stl)
        g2 = wolke.einlesen(f2)
        info = [s for s in z["scans"] if s["id"] == sid][0]
        pruefe(np.allclose(np.ptp(g2.xyz, axis=0), [1, 2, 3], atol=1e-4), "inch-Datei: Import → mm, Export zurück in inch")
        mm = urllib.request.urlopen(basis + "/api/export/%d?format=xyz" % sid, timeout=60).read().decode()
        werte = np.array([[float(x) for x in l.split()[:3]] for l in mm.strip().splitlines()])
        pruefe(np.allclose(np.ptp(werte, axis=0), [25.4, 50.8, 76.2], atol=1e-3), "intern mm: 25,4 × 50,8 × 76,2")
    finally:
        pr.terminate()
        pr.wait(10)


if __name__ == "__main__":
    main()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
