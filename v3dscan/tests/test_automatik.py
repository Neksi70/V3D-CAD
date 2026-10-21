#!/usr/bin/env python3
# Scan -> CAD mit einem Klick (kern/automatik.py): vier kuenstliche Scans, zufaellig gedreht/verschoben,
# mit Messrauschen. Geprueft wird Kandidat, Genauigkeit gegen den Scan, Volumen gegen das Soll-CAD
# und ob der Bauplan fuer V3D CAD vollstaendig ist.
#
#   python3 tests/test_automatik.py [name …]     (testteil, drehteil, winkel, torus, knolle)

import os
import sys
import time

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))
sys.path.insert(0, HIER)
from kern import automatik as au  # noqa: E402
from kern import cad_bauplan  # noqa: E402
from kern import koerper as kp  # noqa: E402
from kern.o3d import o3d  # noqa: E402
from kern.projekt import Projekt  # noqa: E402
from kern.wolke import Scan  # noqa: E402

fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text, flush=True)
    if not bedingung:
        fehler.append(text)


def _zufall_lage(rng):
    w = np.radians(rng.uniform(-60, 60, 3))
    T = np.eye(4)
    T[:3, :3] = o3d.geometry.get_rotation_matrix_from_xyz(w)
    T[:3, 3] = rng.uniform(-80, 80, 3)
    return T


def als_wolke(form, punkte=300000, rauschen=0.02, seed=3):
    from cad_testteil import netz_aus_form
    rng = np.random.default_rng(seed)
    m = netz_aus_form(form)
    w = m.sample_points_uniformly(punkte, use_triangle_normal=True)
    xyz = np.asarray(w.points) + rng.normal(0, rauschen, (punkte, 3))
    T = _zufall_lage(rng)
    return Scan("wolke", xyz @ T[:3, :3].T + T[:3, 3], None, np.asarray(w.normals) @ T[:3, :3].T)


def als_netz(form, rauschen=0.02, seed=5, kante=0.6):
    """Wie ein Netz-Export von Revo Scan: gleichmaessig feines Netz mit verrauschten Eckpunkten."""
    from cad_testteil import netz_aus_form
    rng = np.random.default_rng(seed)
    m = netz_aus_form(form, 0.005)
    m = m.merge_close_vertices(1e-4)
    while True:
        X, Tr = np.asarray(m.vertices), np.asarray(m.triangles)
        laenge = np.linalg.norm(X[Tr[:, 0]] - X[Tr[:, 1]], axis=1).max()
        if laenge < 2 * kante or len(Tr) > 600000:
            break
        m = m.subdivide_midpoint(1)
    X = np.asarray(m.vertices) + rng.normal(0, rauschen, (len(m.vertices), 3))
    T = _zufall_lage(rng)
    return Scan("netz", X @ T[:3, :3].T + T[:3, 3], None, None, np.asarray(m.triangles))


def drehteil():
    """Stufenwelle: Ø30 × 10, Ø20 × 25 mit Einstich Ø16 × 3, Ø12 × 15, Fase 1 × 45° oben."""
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakePolygon
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeRevol
    from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt
    r_z = [(0, 0), (15, 0), (15, 10), (10, 10), (10, 20), (8, 20), (8, 23), (10, 23), (10, 35), (6, 35),
           (6, 49), (5, 50), (0, 50)]
    poly = BRepBuilderAPI_MakePolygon()
    for r, z in r_z:
        poly.Add(gp_Pnt(r, 0, z))
    poly.Close()
    f = BRepBuilderAPI_MakeFace(poly.Wire(), True).Face()
    return BRepPrimAPI_MakeRevol(f, gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 2 * np.pi, True).Shape()


def winkel():
    """L-Winkel 80 lang, Schenkel 40 × 30, Wand 5, zwei Bohrungen Ø 6 durch den hohen Schenkel."""
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
    from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
    teil = BRepAlgoAPI_Fuse(BRepPrimAPI_MakeBox(80, 40, 5).Shape(), BRepPrimAPI_MakeBox(80, 5, 30).Shape()).Shape()
    for x in (20, 60):
        z = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, -1, 18), gp_Dir(0, 1, 0)), 3.0, 7).Shape()
        teil = BRepAlgoAPI_Cut(teil, z).Shape()
    return teil


def knolle():
    """Organische Form ohne Symmetrie (Freiform): verbeulte, gestreckte Kugel als Netz."""
    m = o3d.geometry.TriangleMesh.create_sphere(25.0, 90)
    X = np.asarray(m.vertices)
    r = np.linalg.norm(X, axis=1, keepdims=True)
    u = X / r
    beule = 1 + 0.18 * np.sin(2.3 * u[:, :1] + 0.7) * np.cos(1.7 * u[:, 1:2]) + 0.12 * np.sin(3.1 * u[:, 2:3] + u[:, :1])
    m.vertices = o3d.utility.Vector3dVector(u * r * beule * np.array([1.5, 1.0, 0.8]))
    m.compute_triangle_normals()
    return m


def netz_scan(m, rauschen=0.02, seed=9):
    rng = np.random.default_rng(seed)
    m = m.subdivide_midpoint(1)
    X = np.asarray(m.vertices) + rng.normal(0, rauschen, (len(m.vertices), 3))
    T = _zufall_lage(rng)
    return Scan("knolle", X @ T[:3, :3].T + T[:3, 3], None, None, np.asarray(m.triangles))


def torus():
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeTorus
    from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
    return BRepPrimAPI_MakeTorus(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 25, 8).Shape()


def faelle():
    from cad_testteil import bauen
    return {
        # name: (Form, Scan-Erzeuger, erwartete Art (Praefix), p95-Grenze mm, Volumen-Toleranz, Bauplan vollstaendig)
        "testteil": (bauen, als_wolke, "Prisma Z", 0.12, 0.01, True),
        "drehteil": (drehteil, als_netz, "Drehteil", 0.12, 0.01, True),
        "winkel": (winkel, als_wolke, "Prisma", 0.12, 0.01, True),
        # Torus ist rotationssymmetrisch -> Drehteil (genauer als Freiform)
        "torus": (torus, als_netz, "Drehteil", 0.12, 0.01, True),
        "knolle": (knolle, netz_scan, "Freiform", 0.6, 0.03, False),
    }


def main():
    wahl = sys.argv[1:] or list(faelle())
    for name in wahl:
        form_fn, scan_fn, art, grenze, vol_tol, bauplan_voll = faelle()[name]
        print("== %s" % name, flush=True)
        form = form_fn()
        soll_vol = form.get_volume() if isinstance(form, o3d.geometry.TriangleMesh) else kp.kennwerte(form)["volumen"]
        p = Projekt()
        s = scan_fn(form)
        p.hinzufuegen(s)
        t = time.time()
        try:
            erg = au.scan_zu_cad(p, s.id, fortschritt=lambda x: print("     · " + x, flush=True))
        except Exception as ex:
            pruefe(False, "%s: Abbruch %s" % (name, ex))
            continue
        dauer = time.time() - t
        k = p.koerper_holen(erg["koerper"])
        vol = kp.kennwerte(k.shape)["volumen"]
        pruefe(erg["art"].startswith(art), "%s: Art %s (erwartet %s)" % (name, erg["art"], art))
        pruefe(erg["guete"]["p95"] <= grenze, "%s: 95 %% der Scanpunkte ≤ %.3f mm (Grenze %.2f)" %
               (name, erg["guete"]["p95"], grenze))
        pruefe(abs(vol - soll_vol) <= vol_tol * soll_vol, "%s: Volumen %.0f mm³, Soll %.0f (%.2f %%)" %
               (name, vol, soll_vol, 100 * (vol - soll_vol) / soll_vol))
        b = cad_bauplan.bauplan(p, k)
        pruefe(b["vollstaendig"] == bauplan_voll, "%s: Bauplan vollständig = %s %s" % (name, b["vollstaendig"], b["hinweise"]))
        pruefe(dauer < 300, "%s: Dauer %.0f s" % (name, dauer))
        # rueckgaengig bis zum Anfang muss gehen (Assistent = mehrere normale Schritte)
        n = 0
        while p.undo and n < 40:
            p.rueckgaengig()
            n += 1
        pruefe(not p.koerper, "%s: alles rückgängig machbar (%d Schritte)" % (name, n))
    print("\nALLES OK" if not fehler else "\n%d FEHLER" % len(fehler))
    sys.exit(1 if fehler else 0)


if __name__ == "__main__":
    main()
