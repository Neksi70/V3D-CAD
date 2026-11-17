#!/usr/bin/env python3
# Messplan, GD&T, Wandstärke, Volumenfehler, Schattenriss gegen synthetische Teile mit bekannten Sollwerten.
#
#   python3 tests/test_messplan.py

import math
import os
import sys

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))

from kern import erkennung as er  # noqa: E402
from kern import messplan as mp  # noqa: E402
from kern import pruefen as pr  # noqa: E402
from kern import schattenriss as sr  # noqa: E402
from kern.o3d import o3d  # noqa: E402
from kern.wolke import Scan  # noqa: E402

fehler = []
R = np.random.default_rng(7)


def pruefe(bed, text):
    print(("  ok   " if bed else "  FEHLER ") + text)
    if not bed:
        fehler.append(text)


def rauschen(P, s=0.004):
    return P + R.normal(0, s, P.shape)


def flaeche(u, v):
    a, b = np.meshgrid(u, v, indexing="ij")
    return a.ravel(), b.ravel()


def zylinder(cx, cy, r, z0, z1, n=180, nz=20, innen=False):
    w = np.linspace(0, 2 * np.pi, n, endpoint=False)
    z = np.linspace(z0, z1, nz)
    W, Z = np.meshgrid(w, z, indexing="ij")
    P = np.stack([cx + r * np.cos(W.ravel()), cy + r * np.sin(W.ravel()), Z.ravel()], 1)
    N = np.stack([np.cos(W.ravel()), np.sin(W.ravel()), np.zeros(W.size)], 1) * (-1 if innen else 1)
    return P, N


def kugel(c, r, n=1500):
    v = R.normal(size=(n, 3))
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    return np.asarray(c) + r * v, v


def teil():
    """Synthetisches Messteil: Teile + Masken + Normalen."""
    teile = []
    x, y = flaeche(np.arange(0, 100, 1.0), np.arange(0, 60, 1.0))
    teile.append(("A", np.stack([x, y, np.zeros_like(x)], 1), np.tile([0, 0, -1.0], (len(x), 1))))
    neig = math.tan(math.radians(0.1))
    teile.append(("B", np.stack([x, y, 10 + neig * x], 1), np.tile([0, 0, 1.0], (len(x), 1))))
    yy, zz = flaeche(np.arange(0, 60, 1.0), np.arange(0, 10, 0.5))
    teile.append(("C", np.stack([np.full_like(yy, -5.0), yy, zz], 1), np.tile([-1.0, 0, 0], (len(yy), 1))))
    teile.append(("Z1", *zylinder(50, 30, 5, 0, 10, innen=True)))
    teile.append(("Z2", *zylinder(50.05, 30, 8, 0, 10)))
    teile.append(("K1", *kugel((20, 30, 40), 6)))
    teile.append(("K2", *kugel((100, 30, 40), 6)))
    xyz = np.concatenate([rauschen(t[1]) for t in teile]).astype(np.float32)
    nrm = np.concatenate([t[2] for t in teile]).astype(np.float32)
    masken, start = {}, 0
    for t in teile:
        m = np.zeros(len(xyz), bool)
        m[start:start + len(t[1])] = True
        masken[t[0]] = m
        start += len(t[1])
    return Scan("Messteil", xyz, None, nrm, None), masken


def main():
    print("Messplan")
    s, masken = teil()
    arten = {"A": "ebene", "B": "ebene", "C": "ebene", "Z1": "zylinder", "Z2": "zylinder", "K1": "kugel", "K2": "kugel"}
    elemente, labels, ids = [], np.full(len(s), -1, np.int32), {}
    for k, art in arten.items():
        el = er.aus_auswahl(s, masken[k], art, elemente)
        labels[masken[k]] = el["id"]
        elemente.append(er.als_json(el))
        ids[k] = el["id"]

    def eintrag(nr, **k):
        return dict({"nr": nr, "art": "mass", "b": None}, **k)
    E = [eintrag(1, a=ids["A"], b=ids["B"], mass="auto", nenn=10, plus=0.1, minus=0.1),
         eintrag(2, a=ids["A"], b=ids["C"], mass="auto", nenn=90, plus=0.05, minus=0.05),
         eintrag(3, a=ids["Z1"], mass="auto", nenn=10, plus=0.02, minus=0.02),
         eintrag(4, a=ids["K1"], b=ids["K2"], mass="abstand"),
         eintrag(5, a=ids["K1"], b=ids["K2"], mass="spalt"),
         eintrag(6, a=ids["K1"], b=ids["K2"], mass="spannweite"),
         eintrag(7, a=ids["Z1"], b=ids["Z2"], mass="auto"),
         eintrag(8, a=ids["Z1"], b=ids["C"], mass="auto"),
         eintrag(9, a=ids["A"], b=ids["K1"], mass="auto", nenn=40, plus=0.01, minus=0.01),
         dict(nr=10, art="tol", tol="ebenheit", a=ids["A"], grenze=0.05),
         dict(nr=11, art="tol", tol="parallelitaet", a=ids["B"], b=ids["A"], grenze=0.1),
         dict(nr=12, art="tol", tol="rechtwinkligkeit", a=ids["C"], b=ids["A"], grenze=0.05),
         dict(nr=13, art="tol", tol="koaxialitaet", a=ids["Z2"], b=ids["Z1"], grenze=0.2),
         dict(nr=14, art="tol", tol="rechtwinkligkeit", a=ids["Z1"], b=ids["A"], grenze=0.05),
         dict(nr=15, art="tol", tol="zylinderform", a=ids["Z1"], grenze=0.05),
         dict(nr=16, art="tol", tol="neigung", a=ids["B"], b=ids["A"], winkel=0, grenze=0.1),
         dict(nr=17, art="tol", tol="ebenheit", a=ids["Z1"]),
         dict(nr=18, art="tol", tol="parallelitaet", a=ids["B"])]
    W = {w["nr"]: w for w in mp.auswerten(E, elemente, s.xyz, labels)}
    pruefe(W[1]["mass_erkannt"] == "abstand" and abs(W[1]["wert"] - (10 + math.tan(math.radians(0.1)) * 49.5)) < 0.02 and W[1]["status"] == "ok",
           "Ebene–Ebene (fast parallel): auto = Abstand %.4f, i.O." % W[1]["wert"])
    pruefe(W[2]["mass_erkannt"] == "winkel" and abs(W[2]["wert"] - 90) < 0.05 and W[2]["status"] == "ok", "Ebene ⟂ Ebene: auto = Winkel %.3f°" % W[2]["wert"])
    pruefe(W[3]["mass_erkannt"] == "durchmesser" and abs(W[3]["wert"] - 10) < 0.01, "Bohrung allein: auto = Ø %.4f" % W[3]["wert"])
    pruefe(abs(W[4]["wert"] - 80) < 0.01 and abs(W[5]["wert"] - 68) < 0.02 and abs(W[6]["wert"] - 92) < 0.02,
           "Kugeln: Mitte–Mitte %.3f, Spalt %.3f, Spannweite %.3f" % (W[4]["wert"], W[5]["wert"], W[6]["wert"]))
    pruefe(W[7]["mass_erkannt"] == "abstand" and abs(W[7]["wert"] - 0.05) < 0.01, "Achse–Achse parallel: Achsabstand %.4f" % W[7]["wert"])
    pruefe(W[8]["mass_erkannt"] == "abstand" and abs(W[8]["wert"] - 55) < 0.02, "Achse ∥ Ebene: Abstand %.3f (55)" % W[8]["wert"])
    pruefe(abs(W[9]["wert"] - 40) < 0.02 and W[9]["status"] in ("ok", "nok"), "Kugel zur Ebene: %.4f" % W[9]["wert"])
    pruefe(W[10]["wert"] < 0.03 and W[10]["status"] == "ok", "Ebenheit A %.4f (nur Rauschen)" % W[10]["wert"])
    soll = 99 * math.tan(math.radians(0.1))
    pruefe(abs(W[11]["wert"] - soll) < 0.03 and W[11]["status"] == "nok", "Parallelität B zu A %.4f ≈ %.4f → n.i.O. (Grenze 0,1)" % (W[11]["wert"], soll))
    pruefe(abs(W[16]["wert"] - W[11]["wert"]) < 1e-6, "Neigung 0° = Parallelität")
    pruefe(W[12]["wert"] < 0.03 and W[12]["status"] == "ok", "Rechtwinkligkeit C zu A %.4f" % W[12]["wert"])
    pruefe(abs(W[13]["wert"] - 0.1) < 0.02 and W[13]["status"] == "ok", "Koaxialität Z2 zu Z1 %.4f ≈ 0,1" % W[13]["wert"])
    pruefe(W[14]["wert"] < 0.02, "Rechtwinkligkeit Achse Z1 zu A %.4f" % W[14]["wert"])
    pruefe(W[15]["wert"] < 0.03, "Zylinderform Z1 %.4f" % W[15]["wert"])
    pruefe("fehler" in W[17] and "fehler" in W[18], "Unsinn wird gemeldet: %s | %s" % (W[17].get("fehler"), W[18].get("fehler")))
    txt = mp.bericht_text("Messteil", list(W.values()), "17.11.2026")
    pruefe("Maße:" in txt and "Form und Lage:" in txt and "✘ n.i.O." in txt and "Ergebnis:" in txt, "Bericht-Text mit Bewertung")
    csv = mp.bericht_csv(list(W.values())).decode("utf-8-sig").splitlines()
    pruefe(len(csv) == 19 and csv[0].startswith("Nr;Art;Merkmal"), "CSV: Kopf + 18 Zeilen")
    d = mp.abweichung_element(next(e for e in elemente if e["id"] == ids["A"]), s.xyz)
    pruefe(abs(float(np.median(np.abs(d[masken["A"]])))) < 0.01 and abs(abs(float(np.median(d[masken["B"]]))) - 10.09) < 0.1,
           "Abweichung gegen Element A: auf A ≈ 0, auf B ≈ 10 (Vorzeichen nach Normale)")
    weg = [e for e in elemente if e["id"] != ids["K2"]]
    pruefe("fehler" in mp.auswerten([E[3]], weg, s.xyz, labels)[0], "entferntes Element → Hinweis statt Absturz")

    print("Wandstärke")
    aussen = o3d.geometry.TriangleMesh.create_box(40, 40, 40)
    innen = o3d.geometry.TriangleMesh.create_box(36, 36, 36).translate((2, 2, 2))
    innen.triangles = o3d.utility.Vector3iVector(np.asarray(innen.triangles)[:, ::-1])
    m = (aussen + innen).subdivide_midpoint(4)
    V, T = np.asarray(m.vertices), np.asarray(m.triangles)
    for meth, strahl in (("strahl", 1), ("strahl", 6), ("kugel", 1)):
        w = pr.wandstaerke(V, T, meth, 10, strahl)
        mitte = (np.abs(V[:, 0] - 20) < 12) & (np.abs(V[:, 1] - 20) < 12) & (V[:, 2] > 39.9)
        pruefe(np.isfinite(w[mitte]).all() and abs(float(np.median(w[mitte])) - 2) < 0.05, "%s/%d: Deckel-Mitte %.3f mm (2)" % (meth, strahl, float(np.median(w[mitte]))))
    k = pr.kennwerte(w)
    pruefe(k["anzahl"] > 0 and len(k["histogramm"]) == 20, "Kennwerte + Histogramm")
    try:
        pr.wandstaerke(V, None)
        pruefe(False, "Punktwolke ohne Netz abgelehnt")
    except ValueError:
        pruefe(True, "Punktwolke ohne Netz abgelehnt")

    print("Volumenfehler")
    x, y = flaeche(np.arange(0, 80, 0.5), np.arange(0, 80, 0.5))
    P = np.stack([x, y, np.zeros_like(x)], 1)
    werte = R.normal(0, 0.01, len(P))
    beule = (x - 20) ** 2 + (y - 20) ** 2 < 25
    delle = (x - 60) ** 2 + (y - 50) ** 2 < 16
    werte[beule] += 0.6
    werte[delle] -= 0.4
    g = pr.volumenfehler(P, werte.astype(np.float32), 0.1, 0.5)
    pruefe(len(g) == 2 and g[0]["art"] == "mehr" and g[1]["art"] == "weniger", "2 Gebiete: Beule (mehr) vor Delle (weniger)")
    pruefe(abs(g[0]["mitte"][0] - 20) < 1 and abs(g[0]["flaeche"] - math.pi * 25) < 8, "Beule bei x=20, Fläche %.1f mm² (≈78,5)" % g[0]["flaeche"])

    print("Schattenriss")
    x, y = flaeche(np.arange(0, 30.01, 0.25), np.arange(0, 20.01, 0.25))
    loch = (x - 15) ** 2 + (y - 10) ** 2 < 9
    P = np.stack([x[~loch], y[~loch], np.full((~loch).sum(), 3.0)], 1)
    r = sr.schattenriss(P, "z", 1.0)
    b = r["box"]
    pruefe(len(r["konturen"]) == 2, "Außenkontur + Loch: %d Konturen" % len(r["konturen"]))
    pruefe(abs((b[2] - b[0]) - 32) < 0.6 and abs((b[3] - b[1]) - 22) < 0.6, "Umriss mit 1 mm Abstand: %.2f × %.2f (32 × 22)" % (b[2] - b[0], b[3] - b[1]))
    dx, sv = sr.dxf(r["konturen"]), sr.svg(r["konturen"])
    pruefe(dx.count("LWPOLYLINE") == 2 and "$INSUNITS" in dx and sv.startswith("<?xml") and 'width="' in sv, "DXF (mm) + SVG")

    print("\n%d Fehler" % len(fehler) if fehler else "\nAlle Prüfungen bestanden")
    sys.exit(1 if fehler else 0)


if __name__ == "__main__":
    main()
