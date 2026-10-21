#!/usr/bin/env python3
# Auswahl-Werkzeuge (v1.2): Zauberstab mit Winkel (Netz + Punktwolke), Vergroessern/Verkleinern.
#
#   python3 tests/test_auswahl.py

import os
import sys

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))

from kern import werkzeuge as wz  # noqa: E402
from kern.o3d import o3d  # noqa: E402
from kern.wolke import Scan  # noqa: E402

fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def main():
    m = o3d.geometry.TriangleMesh.create_box(40, 30, 10).subdivide_midpoint(5)
    m.remove_duplicated_vertices()
    X = np.asarray(m.vertices) + np.random.default_rng(1).normal(0, 0.02, (len(m.vertices), 3))
    netz = Scan("quader", X, tri=np.asarray(m.triangles))
    oben = X[:, 2] > 9.9
    v = int(np.nonzero(oben)[0][len(np.nonzero(oben)[0]) // 2])
    w = wz.zauberstab(netz, v, 15, punkt=X[v])
    pruefe(w.sum() >= 0.99 * oben.sum() and not (w & (X[:, 2] < 9.9)).any(),
           "Netz: Zauberstab 15° wählt genau die Oberseite (%d von %d)" % (w.sum(), oben.sum()))
    w = wz.zauberstab(netz, v, 100, punkt=X[v])
    pruefe(w.all(), "Netz: Zauberstab 100° läuft über alle Kanten")
    # Punktwolke derselben Form (ohne Dreiecke)
    p = m.sample_points_uniformly(20000)
    P = np.asarray(p.points)
    wolke = Scan("wolke", P)
    i = int(np.argmin(np.linalg.norm(P - [20, 15, 10], axis=1)))
    w = wz.zauberstab(wolke, i, 20)
    pruefe(w.sum() > 0.8 * (P[:, 2] > 9.99).sum() and (P[w, 2] > 9.0).mean() > 0.97,
           "Wolke: Zauberstab bleibt auf der Oberseite (%d Punkte, %.1f %% oben)" % (w.sum(), 100 * (P[w, 2] > 9).mean()))
    # Vergroessern / Verkleinern
    sel = np.linalg.norm(P[:, :2] - [20, 15], axis=1) < 5
    sel &= P[:, 2] > 9.99
    g = wz.auswahl_wachsen(wolke, sel, 3)
    k = wz.auswahl_wachsen(wolke, sel, -1)
    pruefe(g.sum() > sel.sum() > k.sum() and (g | sel).sum() == g.sum() and (k & ~sel).sum() == 0,
           "Vergrößern %d → %d, Verkleinern → %d" % (sel.sum(), g.sum(), k.sum()))


if __name__ == "__main__":
    main()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
