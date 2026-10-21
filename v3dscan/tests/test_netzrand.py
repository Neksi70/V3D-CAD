#!/usr/bin/env python3
# Netzrand (v1.3): Bucht am Rand fuellen, Bruecke, Rand glaetten, Zacken entfernen, Rand verlaengern.
#
#   python3 tests/test_netzrand.py

import os
import sys

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))

from kern import netz as nz  # noqa: E402
from kern.wolke import Scan  # noqa: E402

fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def gitter(welle=False):
    """40 x 40 mm, Kerbe 10 x 8 am oberen Rand, Loch 10 x 10 in der Mitte; optional gewoelbt."""
    n = 41
    u, v = np.meshgrid(np.linspace(0, 40, n), np.linspace(0, 40, n))
    z = 2 * np.sin(u / 8) * np.cos(v / 10) if welle else np.zeros_like(u)
    X = np.c_[u.ravel(), v.ravel(), z.ravel()]
    T = []
    for i in range(n - 1):
        for j in range(n - 1):
            a = i * n + j
            b, c, d = a + 1, a + n, a + n + 1
            cx, cy = X[a, 0] + 0.5, X[a, 1] + 0.5
            if (15 < cx < 25 and cy > 32) or (15 < cx < 25 and 15 < cy < 25):
                continue
            T += [[a, b, d], [a, d, c]]
    return Scan("gitter", X, tri=np.array(T))


def gekippt(s):
    P = s.xyz[s.tri].astype(float)
    fn = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    return int((fn[:, 2] < -1e-9).sum())


def main():
    s = gitter()
    raender = sorted(len(r) for r in nz.randschleifen(s))
    pruefe(raender == [40, 176], "Testgitter: Außenrand mit Kerbe (176) + Loch (40)")
    neu, b = nz.bucht_fuellen(s, [[15, 40, 0], [25, 40, 0]], "flach")
    r = sorted(len(x) for x in nz.randschleifen(neu))
    pruefe(r[0] == 40 and r[1] < 165 and gekippt(neu) == 0, "Bucht gefüllt: Außenrand %d statt 176, Loch bleibt, nichts gekippt" % r[1])
    flaeche = float(np.linalg.norm(np.cross(*(neu.xyz[neu.tri][:, 1:] - neu.xyz[neu.tri][:, :1]).transpose(1, 0, 2)), axis=1).sum() / 2)
    pruefe(abs(flaeche - (1600 - 100)) < 2, "Fläche danach %.1f mm² (Soll 1500: nur das Loch fehlt)" % flaeche)
    w = gitter(welle=True)
    neu, _ = nz.bucht_fuellen(w, [[15, 40, 0], [25, 40, 0]], "gewoelbt")
    pruefe(np.isfinite(neu.xyz).all() and len(neu.tri) > len(w.tri), "Bucht in gewölbter Fläche gefüllt (gewölbt)")
    neu, _ = nz.bruecke(s, [[15, 20, 0], [25, 20, 0]])
    r = sorted(len(x) for x in nz.randschleifen(neu))
    pruefe(len(r) == 3 and r[0] == r[1] and gekippt(neu) == 0, "Brücke teilt das Loch in zwei gleiche: %s" % r)
    neu, _ = nz.loecher_fuellen(neu, max_umfang=40, art="flach")
    pruefe(len(nz.randschleifen(neu)) == 1, "beide Hälften danach normal füllbar")
    try:
        nz.bucht_fuellen(s, [[15, 40, 0], [20, 20, 0]])
        pruefe(False, "verschiedene Ränder abgelehnt")
    except ValueError:
        pruefe(True, "Punkte auf verschiedenen Rändern abgelehnt")
    # Zacke anhaengen und entfernen
    X = np.r_[s.xyz, [[10.5, -3, 0]]]
    T = np.r_[s.tri, [[len(X) - 1, 11, 10]]]
    z = Scan("zacke", X, tri=T)
    neu, b = nz.ausfransungen_entfernen(z)
    pruefe(b["entfernt"] == 1 and len(neu.tri) == len(s.tri), "Zacke entfernt, Ecken des Quadrats bleiben (%d)" % b["entfernt"])
    # Rand glaetten: zackiger Rand wird ruhiger
    rau = gitter()
    L = sorted(nz.randschleifen(rau), key=len)[-1]
    rng = np.random.default_rng(0)
    rau.xyz[L, :2] += rng.normal(0, 0.2, (len(L), 2)).astype(np.float32)

    def unruhe(sc):
        P = sc.xyz[sorted(nz.randschleifen(sc), key=len)[-1]].astype(float)
        return float(np.linalg.norm(P - 0.5 * (np.roll(P, 1, 0) + np.roll(P, -1, 0)), axis=1).mean())
    neu, _ = nz.rand_glaetten(rau, None, 10)
    pruefe(unruhe(neu) < 0.5 * unruhe(rau), "Rand geglättet: Unruhe %.3f → %.3f" % (unruhe(rau), unruhe(neu)))
    # Rand verlaengern (linker Rand, ohne Kerbe in der Naehe)
    neu, _ = nz.rand_verlaengern(s, [[0, 10, 0]], 0.5)
    pruefe(abs(neu.xyz[:, 0].min() + 0.5) < 0.05 and abs(neu.xyz[:, 1].min() + 0.5) < 0.05 and gekippt(neu) == 0,
           "Außenrand um 0,5 mm verlängert, nichts gekippt")


if __name__ == "__main__":
    main()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
