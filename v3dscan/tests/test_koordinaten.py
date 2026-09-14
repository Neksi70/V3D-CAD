#!/usr/bin/env python3
# Formen einpassen + Koordinatensystem (Etappe 2).
#
#   python3 tests/test_koordinaten.py

import os
import sys

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))

from kern import formen, koordinaten as ko  # noqa: E402

fehler = []
rng = np.random.default_rng(11)


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def drehung(ax, ay, az):
    return ko.aus_werten((0, 0, 0), (ax, ay, az))[:3, :3]


def winkel(a, b):
    return np.degrees(np.arccos(np.clip(abs(np.dot(a, b)) / np.linalg.norm(a) / np.linalg.norm(b), -1, 1)))


def zylinder_punkte(r, h, R, t, n=4000, rauschen=0.02):
    phi = rng.uniform(0, 2 * np.pi, n)
    z = rng.uniform(-h / 2, h / 2, n)
    p = np.stack([r * np.cos(phi), r * np.sin(phi), z], 1)
    nrm = np.stack([np.cos(phi), np.sin(phi), np.zeros(n)], 1)
    p += rng.normal(0, rauschen, p.shape)
    return p @ R.T + t, nrm @ R.T


def main():
    print("Formen")
    R = drehung(23, -41, 67)
    t = np.array([35.0, 20.0, -12.0])
    # Bohrung Ø 10,03 mm, 15 mm tief, schraeg im Raum, Teil-Umfang 240°
    p, nrm = zylinder_punkte(5.015, 15, R, t)
    phi = np.arctan2(*(((p - t) @ R)[:, [1, 0]]).T)
    teil = phi < np.radians(120)
    z = formen.zylinder(p[teil], nrm[teil])
    pruefe(abs(z["radius"] * 2 - 10.03) < 0.01, "Zylinder Ø %.4f (soll 10,03)" % (z["radius"] * 2))
    pruefe(winkel(z["achse"], R[:, 2]) < 0.2, "Achse %.3f° daneben" % winkel(z["achse"], R[:, 2]))
    abst = np.linalg.norm(np.cross(z["punkt"] - t, R[:, 2]))
    pruefe(abst < 0.02, "Achslage %.4f mm daneben" % abst)
    pruefe(abs(z["hoehe"] - 15) < 0.2, "Höhe %.2f" % z["hoehe"])
    z2 = formen.zylinder(p[teil])          # ohne Normalen
    pruefe(abs(z2["radius"] * 2 - 10.03) < 0.05, "Zylinder ohne Normalen Ø %.3f" % (z2["radius"] * 2))

    # Ausreisser duerfen nicht stoeren
    stoer = np.vstack([p, rng.uniform(t - 20, t + 20, (200, 3))])
    z3 = formen.zylinder(stoer, None)
    pruefe(abs(z3["radius"] * 2 - 10.03) < 0.05, "Zylinder mit 5 %% Ausreißern Ø %.3f" % (z3["radius"] * 2))

    k = rng.normal(size=(3000, 3))
    k = k / np.linalg.norm(k, axis=1, keepdims=True) * 12.5 + [4, -7, 9] + rng.normal(0, 0.02, (3000, 3))
    kf = formen.kugel(k[k[:, 2] > 9])
    pruefe(abs(kf["radius"] - 12.5) < 0.01 and np.linalg.norm(kf["mitte"] - [4, -7, 9]) < 0.02,
           "Halbkugel r %.4f, Mitte %.4f mm daneben" % (kf["radius"], np.linalg.norm(kf["mitte"] - [4, -7, 9])))

    e = rng.uniform(-30, 30, (2000, 3))
    e[:, 2] = 0
    e = e @ R.T + t + rng.normal(0, 0.02, e.shape)
    ef = formen.ebene(e)
    pruefe(winkel(ef["normale"], R[:, 2]) < 0.1 and ef["rms"] < 0.03, "Ebene %.3f°, RMS %.3f" % (winkel(ef["normale"], R[:, 2]), ef["rms"]))

    print("3-2-1")
    # Bauteil: Grundplatte (Ebene) + Bohrung (Zylinder), beides schraeg im Raum
    T = ko.aus_elementen(ef, z, {"art": "schnitt"}, e.mean(0), "z", "x")
    Rt = T[:3, :3]
    pruefe(np.allclose(Rt @ Rt.T, np.eye(3), atol=1e-9) and np.linalg.det(Rt) > 0, "Drehung rechtshändig")
    pruefe(winkel(Rt @ ef["normale"], [0, 0, 1]) < 1e-6, "Ebenennormale → Z")
    neu_achse = Rt @ z["achse"]
    pruefe(abs(neu_achse[1]) < 1e-9 and neu_achse[0] != 0, "Achse liegt in XZ-Ebene")
    schnitt = ko._schnitt_ebene_linie(ef, z["punkt"], z["achse"])
    pruefe(np.linalg.norm(Rt @ schnitt + T[:3, 3]) < 1e-9, "Schnittpunkt → Ursprung")
    for z1, z2_ in (("y", "z"), ("x", "y"), ("z", "y")):
        Ti = ko.aus_elementen(ef, z, {"art": "punkt", "punkt": t}, t, z1, z2_)
        pruefe(np.linalg.det(Ti[:3, :3]) > 0 and winkel(Ti[:3, :3] @ ef["normale"], np.eye(3)[ko.ACHSEN[z1]]) < 1e-6,
               "Primär → %s, Sekundär → %s rechtshändig" % (z1, z2_))
    try:
        ko.aus_elementen(ef, {"art": "linie", "von": [0, 0, 0], "bis": list(ef["normale"])}, None, t)
        pruefe(False, "parallele Richtungen werden abgewiesen")
    except ValueError:
        pruefe(True, "parallele Richtungen werden abgewiesen")

    print("Automatisch")
    quader = rng.uniform([-40, -15, -5], [40, 15, 5], (20000, 3))
    quader[:, 0] += np.where(quader[:, 0] > 30, 3, 0)   # Schiefe fuer eindeutiges Vorzeichen
    schraeg = quader @ R.T + t
    H = ko.hauptachsen(schraeg, "mitte")
    q = schraeg @ H[:3, :3].T + H[:3, 3]
    ausdehnung = np.ptp(q, axis=0)
    pruefe(ausdehnung[0] > ausdehnung[1] > ausdehnung[2] and abs(ausdehnung[0] - 83) < 1.5,
           "Hauptachsen: Ausdehnung %s" % np.round(ausdehnung, 1))
    pruefe(np.abs((q.min(0) + q.max(0)) / 2).max() < 1e-6, "Ursprung in der Mitte")
    pruefe(np.allclose(ko.hauptachsen(schraeg[::-1], "mitte"), H, atol=1e-6), "eindeutig (Reihenfolge egal)")

    boden = rng.uniform(-60, 60, (8000, 3))
    boden[:, 2] = 0
    objekt = rng.uniform([-10, -10, 0], [10, 10, 30], (6000, 3))
    szene = np.vstack([boden, objekt]) @ R.T + t
    eb = formen.ebene((boden @ R.T + t))
    A = ko.auf_ebene(szene, eb, "unten", "z")
    s2 = szene @ A[:3, :3].T + A[:3, 3]
    pruefe(abs(s2[:8000, 2]).max() < 1e-6 and s2[8000:, 2].mean() > 10,
           "auf Ebene gestellt, Objekt steht oben (Boden max %.2g, Objekt %.1f)" % (abs(s2[:8000, 2]).max(), s2[8000:, 2].mean()))

    print()
    print("FEHLER: %d" % len(fehler) if fehler else "Alles in Ordnung.")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
