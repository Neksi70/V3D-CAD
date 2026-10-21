#!/usr/bin/env python3
# Freiform-Editor (v1.2): Topologie-Operationen auf dem Vierecks-Kaefig – Anzahl, Umlaufrichtung, Lage.
#
#   python3 tests/test_kaefig.py

import os
import sys
from collections import Counter

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))

from kern import freiform as ff  # noqa: E402

fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def konsistent(F):
    """jede gerichtete Kante hoechstens einmal = einheitliche Umlaufrichtung"""
    c = Counter((f[k], f[(k + 1) % 4]) for f in np.asarray(F).tolist() for k in range(4))
    return all(v == 1 for v in c.values())


def raster(nu, nv, versatz=(0, 0, 0)):
    V = np.array([[i, j, 0.0] for i in range(nu + 1) for j in range(nv + 1)]) + versatz
    return V, ff._raster_flaechen(nu, nv)


def main():
    V, F = raster(3, 2)
    pruefe(len(ff.kaefig_rand(F)) == 10 and ff.kaefig_unregelmaessig(F) == [], "Raster 3×2: 10 Randkanten, regulär")
    V2, F2, _ = ff.kaefig_extrudieren(V, F, [(9, 10), (10, 11)], 1.0)
    pruefe(len(F2) == 8 and len(V2) == 15 and konsistent(F2) and np.allclose(V2[-3:, 0], 4),
           "Extrudieren: 2 Vierecke, Ecken teilen sich, 1 mm nach außen")
    try:
        ff.kaefig_extrudieren(V, F, [(4, 7)])
        pruefe(False, "Innenkante abgelehnt")
    except ValueError:
        pruefe(True, "Innenkante abgelehnt")
    V3, F3, _ = ff.kaefig_schleife(V, F, (0, 3))
    pruefe(len(F3) == 8 and konsistent(F3), "Schleife längs: 6 → 8 Vierecke")
    V3, F3, _ = ff.kaefig_schleife(V, F, (0, 1))
    pruefe(len(F3) == 9 and konsistent(F3), "Schleife quer: 6 → 9 Vierecke")
    V4, F4, z = ff.kaefig_loeschen(V, F, [0])
    pruefe(len(F4) == 5 and len(V4) == 11 and z[0] == -1 and konsistent(F4), "Löschen: Ecke 0 entfällt, Rest umnummeriert")
    # Bruecke zwischen zwei Streifen nebeneinander
    Va, Fa = raster(2, 2)
    Vb, Fb = raster(2, 2, (5, 0, 0))
    VV, FF = np.r_[Va, Vb], np.r_[Fa, Fb + len(Va)]
    V5, F5, _ = ff.kaefig_bruecke(VV, FF, (6, 7), (9, 10))
    pruefe(len(F5) == 9 and konsistent(F5), "Brücke zwischen zwei Streifen: Umlauf einheitlich")
    # Verschmelzen zweier Raender (Spalt 0)
    Vb0, Fb0 = raster(2, 2, (2, 0, 0))
    VV, FF = np.r_[Va, Vb0], np.r_[Fa, Fb0 + len(Va)]
    V6, F6, z = ff.kaefig_verschmelzen(VV, FF, [(6, 9), (7, 10), (8, 11)])
    pruefe(len(V6) == 15 and len(F6) == 8 and konsistent(F6) and len(ff.kaefig_rand(F6)) == 12,
           "Verschmelzen: zwei Streifen zu einem 4×2-Raster")
    pruefe(np.allclose(ff.kaefig_ausrichten(np.array([[0, 0, 0], [1, 1, 0], [2, 0, 0.0]]), [0, 1, 2])[1], [1, 0, 0]),
           "Ausrichten auf die Gerade")
    V7 = ff.kaefig_verschieben(V, F, [4], normal=2.0)
    pruefe(np.allclose(abs(V7[4, 2]), 2.0) and np.allclose(V7[4, :2], V[4, :2]), "Verschieben entlang der Normale")
    # unregelmaessige Ecke: 3 Vierecke um eine Innenecke
    Vs = np.array([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [-1, 0.5, 0], [-0.5, -1, 0], [0.5, -1, 0]], float)
    Fs = np.array([[0, 1, 2, 3], [0, 3, 4, 5], [0, 5, 6, 1]])
    pruefe((0, 3, False) in ff.kaefig_unregelmaessig(Fs), "Innenecke mit 3 Vierecken = unregelmäßig")
    V8, F8, _ = ff.kaefig_extrudieren(Vs, Fs, [(2, 3)], 1.0)
    pruefe(konsistent(F8), "Extrudieren am Stern konsistent")


if __name__ == "__main__":
    main()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
