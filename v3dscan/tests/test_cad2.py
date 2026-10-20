#!/usr/bin/env python3
# CAD-Reiter Teil 2: Formschräge beim Extrudieren, beidseitig, Drehen mit 2 Winkeln, Körper aus Flächen
# (automatisches Trimmen), Trennen, Skalieren, Fläche verschieben/löschen, Formschräge, Gewinde.
#
#   python3 tests/test_cad2.py

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

from kern import features as ft  # noqa: E402
from kern import koerper as kp  # noqa: E402
from kern import skizze as sk  # noqa: E402

fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def vol(s):
    return kp.kennwerte(s)["volumen"]


Q = {"ebene": sk.ebene_json(sk.ebene_welt("xy")), "ketten": [{"geschlossen": True, "elemente": [
    {"typ": "linie", "a": [0, 0], "b": [40, 0]}, {"typ": "linie", "a": [40, 0], "b": [40, 30]},
    {"typ": "linie", "a": [40, 30], "b": [0, 30]}, {"typ": "linie", "a": [0, 30], "b": [0, 0]}]}]}


def kern_test():
    print("Kern")
    t = 20 * math.tan(math.radians(3))
    a2 = (40 - 2 * t) * (30 - 2 * t)
    soll = 20 / 3 * (1200 + a2 + math.sqrt(1200 * a2))
    pruefe(abs(vol(ft.extrudieren_schraeg(Q, 0, 20, 3)) - soll) < 0.5, "Extrusion mit 3° Formschräge = Pyramidenstumpf %.1f" % soll)
    E = sk.ebene_durch_achse({"punkt": [0, 0, 0], "achse": [0, 0, 1]}, 0)     # u = Z-Achse
    w = vol(ft.drehen({"ebene": sk.ebene_json(E), "ketten": [{"geschlossen": True, "elemente": [
        {"typ": "linie", "a": [0, 5], "b": [0, 10]}, {"typ": "linie", "a": [0, 10], "b": [10, 10]},
        {"typ": "linie", "a": [10, 10], "b": [10, 5]}, {"typ": "linie", "a": [10, 5], "b": [0, 5]}]}]},
        90, None, 45))
    pruefe(abs(w - math.pi * (100 - 25) * 10 * 135 / 360) < 0.5, "Drehen 90° + 45° Gegenrichtung = 135°-Ring: %.1f" % w)
    box = ft.extrudieren(Q, 0, 20)
    pruefe(abs(vol(ft.skalieren(box, 2)) - 8 * 24000) < 1e-3 and abs(vol(ft.skalieren(box, [1, 2, 0.5])) - 24000) < 1e-3,
           "Skalieren gleichmäßig ×2 und je Achse (1/2/0,5)")
    from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
    from OCP.GeomAbs import GeomAbs_Cylinder
    from OCP.TopoDS import TopoDS
    m = ft.flaechen_karte(box)
    oben = [i for i in range(1, m.Extent() + 1)
            if BRepAdaptor_Surface(TopoDS.Face_s(m.FindKey(i))).Plane().Location().Z() > 19.9
            and abs(BRepAdaptor_Surface(TopoDS.Face_s(m.FindKey(i))).Plane().Axis().Direction().Z()) > 0.9]
    seiten = [i for i in range(1, m.Extent() + 1)
              if abs(BRepAdaptor_Surface(TopoDS.Face_s(m.FindKey(i))).Plane().Axis().Direction().Z()) < 0.1]
    pruefe(abs(vol(ft.flaeche_verschieben(box, oben, 5)) - 30000) < 1e-3, "Deckfläche +5 mm verschoben → 30000 mm³")
    pruefe(abs(vol(ft.formschraege(box, seiten, 3)) - soll) < 0.5, "Formschräge 3° an den 4 Seiten = Pyramidenstumpf")
    km = ft.kanten_karte(box)
    senk = []
    for i in range(1, km.Extent() + 1):
        c = BRepAdaptor_Curve(TopoDS.Edge_s(km.FindKey(i)))
        if abs(c.Value(c.FirstParameter()).Z() - c.Value(c.LastParameter()).Z()) > 10:
            senk.append(i)
    rund = ft.kanten_runden(box, senk, 3)
    mr = ft.flaechen_karte(rund)
    zyl = [i for i in range(1, mr.Extent() + 1) if BRepAdaptor_Surface(TopoDS.Face_s(mr.FindKey(i))).GetType() == GeomAbs_Cylinder]
    pruefe(len(zyl) == 4 and abs(vol(ft.flaechen_loeschen(rund, zyl)) - 24000) < 1e-3,
           "4 Rundungen gelöscht → wieder scharfkantiger Quader 24000 mm³")
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
    from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
    zwei = ft._verbund([BRepPrimAPI_MakeBox(10, 10, 10).Shape(), BRepPrimAPI_MakeBox(gp_Pnt(20, 0, 0), 10, 10, 10).Shape()])
    pruefe(len(ft.koerper_trennen(zwei)) == 2, "Trennen: 2 Einzelkörper")
    nut = ft.gewinde((0, 0, 0), (0, 0, 1), 5, 20, 1.5, True)
    h = 0.6134 * 1.5
    soll_nut = 0.5 * (2 * math.tan(math.radians(30)) * h * 1.05) * h * (1 + 0.05) * math.hypot(2 * math.pi * 5, 1.5) * 20 / 1.5
    pruefe(abs(vol(nut) - soll_nut) / soll_nut < 0.1, "Gewindenut M10×1,5 × 20: %.1f mm³ (≈ %.1f)" % (vol(nut), soll_nut))
    bolzen = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, -2), gp_Dir(0, 0, 1)), 5, 24).Shape()
    mit = kp.boolean(bolzen, nut, "abziehen")
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
    weg = vol(BRepAlgoAPI_Common(bolzen, nut).Shape())     # Profil ragt 5 % über die Oberfläche hinaus
    pruefe(abs(vol(bolzen) - vol(mit) - weg) < 0.5 and weg > 0.85 * vol(nut),
           "Gewinde in Bolzen geschnitten: −%.1f mm³" % (vol(bolzen) - vol(mit)))
    # Koerper aus Flaechen: Seitenwaende als Flaeche + Deckel/Boden-Ebenen
    def ebene(o, n, s_):
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
        from OCP.gp import gp_Pln
        return BRepBuilderAPI_MakeFace(gp_Pln(gp_Pnt(*o), gp_Dir(*n)), -s_, s_, -s_, s_).Face()
    waende = ft.extrudieren_flaeche(Q, -5, 25)
    z, n = ft.koerper_aus_flaechen([waende, ebene((20, 15, 0), (0, 0, 1), 60), ebene((20, 15, 20), (0, 0, 1), 60)])
    pruefe(abs(vol(z) - 24000) < 1e-3, "Körper aus Flächen (Wände + 2 Ebenen): %d Zellen → %.1f mm³" % (n, vol(z)))


def http_test():
    print("Server")
    from test_koerper import _frei
    from test_skizze import als_scan, platte
    from kern.wolke import ausgeben
    port = _frei(18787)
    basis = "http://127.0.0.1:%d" % port
    prozess = subprocess.Popen([sys.executable, os.path.join(HIER, "..", "server.py"), "--port", str(port)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def holen(pfad, daten=None):
        if daten is not None and not isinstance(daten, bytes):
            daten = json.dumps(daten).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request(basis + pfad, data=daten), timeout=600) as r:
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
        s = als_scan(platte())
        with tempfile.TemporaryDirectory() as tmp:
            ausgeben(s, os.path.join(tmp, "p.ply"), "ply")
            sid = holen("/api/import?name=platte.ply", open(os.path.join(tmp, "p.ply"), "rb").read())["neu"]
        # Wände: Schnitt bei z=5 nur als Fläche, deutlich über den Scan hinaus
        a = holen("/api/skizze/schnitt", {"id": sid, "ebene": {"art": "welt", "name": "xy", "versatz": 5}, "toleranz": 0.05})
        skid = holen("/api/skizze/uebernehmen", {})["sid"]
        a = holen("/api/feature/extrudieren", {"sid": skid, "modus": "mitte", "laenge": 30, "als_flaeche": True})
        waende = a["koerper"]
        # Deckel + Boden als eingepasste Flächen (Punktauswahl), 20 % verlängert
        def maske(m):
            return base64.b64encode(np.packbits(m, bitorder="little")).decode()
        ids = []
        for m in (s.xyz[:, 2] > 9.95, s.xyz[:, 2] < 0.05):
            a = holen("/api/freiform/flaeche", {"masken": {str(sid): maske(m)}, "verlaengern": 25})
            ids.append(a["koerper"])
        a = holen("/api/feature/aus_flaechen", {"kids": [waende] + ids, "id": sid, "vorschau": True})
        soll = (2400 - (4 - math.pi) * 25 - math.pi * 36) * 10
        pruefe(abs(a["info"]["volumen"] - soll) / soll < 0.003,
               "Körper aus Flächen mit Scan-Bezug: %d Zellen → %.1f mm³ (Platte mit Bohrung %.1f)"
               % (a["info"]["zellen"], a["info"]["volumen"], soll))
        a = holen("/api/feature/aus_flaechen", {"kids": [waende] + ids, "id": sid})
        pruefe(len(a["zustand"]["koerper"]) == 1 and a["zustand"]["koerper"][0]["name"] == "Körper aus Flächen1",
               "Flächen ersetzt durch „Körper aus Flächen1“")
        kid = a["koerper"]
        a = holen("/api/feature/extrudieren", {"sid": skid, "modus": "beidseitig", "laenge": 3, "laenge2": 2, "vorschau": True,
                                               "operation": "neu"})
        pruefe(abs(a["info"]["laenge"] - 5) < 1e-6 and abs(a["info"]["von"] + 2) < 1e-6, "beidseitig: −2 … +3 (Länge 5)")
        a = holen("/api/feature/extrudieren", {"sid": skid, "modus": "laenge", "laenge": 10, "schraege": 2, "vorschau": True,
                                               "operation": "neu"})
        pruefe(a["info"]["volumen"] < soll, "Extrusion mit Formschräge kleiner als ohne (%.1f)" % a["info"]["volumen"])
        a = holen("/api/feature/trennen", {"kid": kid})
        pruefe("nur aus einem Teil" in a.get("fehler", ""), "Trennen eines Einzelkörpers: „%s“" % a.get("fehler"))
    finally:
        prozess.terminate()
        prozess.wait(10)


if __name__ == "__main__":
    kern_test()
    http_test()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
