#!/usr/bin/env python3
# Technisches Testteil mit OpenCASCADE bauen und wie einen Scan abtasten.
#
# Platte 100 x 60 x 15 mm, senkrechte Aussenkanten gerundet R5, darin
#   4 Bohrungen Ø 5,02 (durchgehend)   bei (15,15) (85,15) (15,45) (85,45)
#   2 Bohrungen Ø 8,03 (durchgehend)   bei (32,30) (68,30)
#   Zapfen Ø 20, 10 hoch               bei (50,30)
#   Kuppel (Halbkugel) r 7             bei (50,50)
#   Kegelstumpf r 6 -> 3, 10 hoch      bei (15,30)
# Ursprung = Plattenecke unten, Z nach oben. Die Datei liegt zufaellig
# gedreht/verschoben; soll["matrix"] bringt sie zurueck ins Bauteil-System.
#
#   python3 tests/cad_testteil.py [zielordner]

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from kern.o3d import o3d  # noqa: E402
from kern.wolke import Scan, ausgeben  # noqa: E402

SOLL = {
    "bohrungen": [{"d": 5.02, "xy": p, "tiefe": 15} for p in ((15, 15), (85, 15), (15, 45), (85, 45))]
    + [{"d": 8.03, "xy": p, "tiefe": 15} for p in ((32, 30), (68, 30))],
    "zapfen": {"d": 20.0, "xy": (50, 30), "hoehe": 10},
    "kuppel": {"r": 7.0, "mitte": (50, 50, 15)},
    "kegel": {"r_unten": 6.0, "r_oben": 3.0, "xy": (15, 30), "hoehe": 10},
    "rundung": {"r": 5.0, "anzahl": 4},
}


def bauen():
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
    from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.BRepPrimAPI import (BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCone,
                                 BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeSphere)
    from OCP.GeomAbs import GeomAbs_Line
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt

    platte = BRepPrimAPI_MakeBox(100, 60, 15).Shape()
    runden = BRepFilletAPI_MakeFillet(platte)
    ex = TopExp_Explorer(platte, TopAbs_EDGE)
    gesehen = set()
    while ex.More():
        kante = TopoDS.Edge_s(ex.Current())
        c = BRepAdaptor_Curve(kante)
        if c.GetType() == GeomAbs_Line:
            a, b = c.Value(c.FirstParameter()), c.Value(c.LastParameter())
            if abs(a.X() - b.X()) < 1e-6 and abs(a.Y() - b.Y()) < 1e-6:
                schluessel = (round(a.X()), round(a.Y()))
                if schluessel not in gesehen:
                    gesehen.add(schluessel)
                    runden.Add(5.0, kante)
        ex.Next()
    teil = runden.Shape()

    def zyl(x, y, r, z0, h):
        return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, y, z0), gp_Dir(0, 0, 1)), r, h).Shape()

    teil = BRepAlgoAPI_Fuse(teil, zyl(50, 30, 10, 14.9, 10.1)).Shape()
    kuppel = BRepPrimAPI_MakeSphere(gp_Pnt(50, 50, 15), 7.0).Shape()
    teil = BRepAlgoAPI_Fuse(teil, kuppel).Shape()
    kegel = BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(15, 30, 14.9), gp_Dir(0, 0, 1)), 6.0 + 0.1 * 0.3, 3.0, 10.1).Shape()
    teil = BRepAlgoAPI_Fuse(teil, kegel).Shape()
    for b in SOLL["bohrungen"]:
        teil = BRepAlgoAPI_Cut(teil, zyl(b["xy"][0], b["xy"][1], b["d"] / 2, -1, 17)).Shape()
    # untere Kuppelhaelfte ragt unter die Platte? nein: Mitte z=15, r=7 -> bis z=8, liegt im Material
    return teil


def netz_aus_form(form, abweichung=0.01):
    from OCP.BRep import BRep_Tool
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.TopAbs import TopAbs_FACE, TopAbs_REVERSED
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopLoc import TopLoc_Location
    from OCP.TopoDS import TopoDS

    BRepMesh_IncrementalMesh(form, abweichung, False, 0.05, True)
    punkte, dreiecke = [], []
    versatz = 0
    ex = TopExp_Explorer(form, TopAbs_FACE)
    while ex.More():
        flaeche = TopoDS.Face_s(ex.Current())
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(flaeche, loc)
        if tri is not None:
            trsf = loc.Transformation()
            for i in range(1, tri.NbNodes() + 1):
                p = tri.Node(i).Transformed(trsf)
                punkte.append((p.X(), p.Y(), p.Z()))
            umgedreht = flaeche.Orientation() == TopAbs_REVERSED
            for i in range(1, tri.NbTriangles() + 1):
                a, b, c = tri.Triangle(i).Get()
                if umgedreht:
                    b, c = c, b
                dreiecke.append((a - 1 + versatz, b - 1 + versatz, c - 1 + versatz))
            versatz += tri.NbNodes()
        ex.Next()
    m = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(np.array(punkte)),
                                  o3d.utility.Vector3iVector(np.array(dreiecke, np.int32)))
    m.compute_triangle_normals()
    return m


def erzeugen(ziel, punkte=400000, seed=7):
    rng = np.random.default_rng(seed)
    os.makedirs(ziel, exist_ok=True)
    m = netz_aus_form(bauen())
    wolke = m.sample_points_uniformly(punkte, use_triangle_normal=True)
    xyz = np.asarray(wolke.points) + rng.normal(0, 0.02, (punkte, 3))
    nrm = np.asarray(wolke.normals)
    w = np.radians(rng.uniform(-50, 50, 3))
    T = np.eye(4)
    T[:3, :3] = o3d.geometry.get_rotation_matrix_from_xyz(w)
    T[:3, 3] = rng.uniform(-80, 80, 3)
    xyz = xyz @ T[:3, :3].T + T[:3, 3]
    nrm = nrm @ T[:3, :3].T
    ausgeben(Scan("testteil", xyz, None, nrm), os.path.join(ziel, "testteil.ply"), "ply")
    soll = dict(SOLL, matrix=np.linalg.inv(T).tolist(), punkte=punkte)
    with open(os.path.join(ziel, "testteil_soll.json"), "w") as f:
        json.dump(soll, f, indent=1)
    print("testteil.ply: %d Punkte, %d Dreiecke im CAD-Netz" % (punkte, len(m.triangles)))
    return soll


if __name__ == "__main__":
    erzeugen(sys.argv[1] if len(sys.argv) > 1 else
             os.path.join(os.path.dirname(os.path.abspath(__file__)), "daten"))
