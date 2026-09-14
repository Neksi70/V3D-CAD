#!/usr/bin/env python3
# Netz-Werkzeuge pruefen (Etappe 1).
#
#   python3 tests/test_netz.py

import os
import sys
import time

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))

from kern import netz  # noqa: E402
from kern.o3d import o3d  # noqa: E402
from kern.projekt import Projekt  # noqa: E402
from kern.wolke import Scan, ausgeben, einlesen  # noqa: E402

fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def kugel(r=20.0, aufl=80):
    m = o3d.geometry.TriangleMesh.create_sphere(r, aufl)
    m.remove_duplicated_vertices()
    return Scan.aus_o3d_netz("kugel", m)


def main():
    print("Analyse")
    k = kugel()
    a, _ = netz.analyse(k)
    pruefe(a["wasserdicht"] and a["loecher"] == 0 and a["teile"] == 1, "geschlossene Kugel")
    pruefe(abs(a["volumen"] - 4 / 3 * np.pi * 8000) / 33510 < 0.01, "Volumen %.0f" % a["volumen"])

    kaputt = k.kopie()
    n = len(kaputt)
    kaputt.xyz = np.vstack([kaputt.xyz, [[-30, 0, 0], [30, 5, 0], [30, -5, 0]]]).astype(np.float32)
    kaputt.nrm = None
    kaputt.tri = np.vstack([kaputt.tri, [[n, n + 1, n + 2]], kaputt.tri[:5]]).astype(np.int32)
    a, marken = netz.analyse(kaputt)
    pruefe(a["selbstschnitte"] > 0 and a["doppelt"] == 5 and not a["wasserdicht"],
           "Störungen erkannt (Schnitte %d, doppelt %d)" % (a["selbstschnitte"], a["doppelt"]))
    pruefe(marken["problem"][n:].all(), "Problemstellen markiert")

    r, bericht = netz.reparieren(kaputt, kleine_teile_prozent=1, schnitte_entfernen=True)
    a, _ = netz.analyse(r)
    pruefe(a["doppelt"] == 0 and a["selbstschnitte"] == 0 and a["teile"] == 1, "Reparieren")

    print("Löcher")
    offen = k.kopie()
    ecken = offen.xyz[offen.tri]
    weg = np.any(ecken[:, :, 2] > 16, axis=1) | np.any(ecken[:, :, 0] > 18, axis=1)
    offen.tri = offen.tri[~weg]
    info = netz.loch_info(offen)
    pruefe(len(info) == 2, "2 Löcher gefunden (%s)" % [i["umfang"] for i in info])
    klein = min(info, key=lambda i: i["umfang"])
    nur_klein, _ = netz.loecher_fuellen(offen, max_umfang=klein["umfang"] + 0.1)
    pruefe(netz.analyse(nur_klein)[0]["loecher"] == 1, "Größengrenze: nur das kleine Loch")
    for art, grenze in (("gewoelbt", 0.6), ("flach", 5)):
        t = time.time()
        g, _ = netz.loecher_fuellen(offen, art=art)
        a, _ = netz.analyse(g)
        r_neu = np.linalg.norm(g.xyz[len(offen):], axis=1)
        abw = np.abs(r_neu - 20).max()
        pruefe(a["wasserdicht"] and (abw < grenze if art == "gewoelbt" else True),
               "%s: wasserdicht, max. Abweichung von der Kugel %.2f mm (%.1f s)"
               % (art, abw, time.time() - t))
        if art == "gewoelbt":
            pruefe(abs(a["volumen"] - 33510) / 33510 < 0.01, "gewölbt: Volumen %.0f" % a["volumen"])

    print("Glätten / Vereinfachen / Beschneiden")
    rauh = k.kopie()
    rng = np.random.default_rng(1)
    rauh.xyz = (rauh.xyz + rng.normal(0, 0.3, rauh.xyz.shape)).astype(np.float32)
    g, _ = netz.glaetten(rauh, 10)
    streu_vor = np.std(np.linalg.norm(rauh.xyz, axis=1))
    streu_nach = np.std(np.linalg.norm(g.xyz, axis=1))
    pruefe(streu_nach < streu_vor * 0.5, "Taubin: Rauschen %.3f → %.3f mm" % (streu_vor, streu_nach))
    pruefe(abs(np.mean(np.linalg.norm(g.xyz, axis=1)) - 20) < 0.2, "Taubin schrumpft nicht")

    v, b = netz.vereinfachen(k, len(k.tri) // 4)
    pruefe(len(v.tri) <= len(k.tri) // 4 + 2, "Vereinfachen %d → %d" % (len(k.tri), len(v.tri)))
    pruefe(np.abs(np.linalg.norm(v.xyz, axis=1) - 20).max() < 0.5, "Form bleibt")

    h, _ = netz.beschneiden(k, [0, 0, 5], [0, 0, 1])
    pruefe(h.xyz[:, 2].max() <= 5.001 and h.xyz[:, 2].min() < -19, "Schnitt z=5 sauber (max %.3f)" % h.xyz[:, 2].max())
    pruefe(netz.analyse(h)[0]["loecher"] == 1, "Schnittkante = ein Rand")

    print("Netz aus Punktwolke")
    wolke = k.kopie()
    punkte = o3d.geometry.TriangleMesh.create_sphere(20, 80).sample_points_uniformly(40000)
    wolke = Scan.aus_o3d("wolke", punkte)
    wolke.nrm = None                      # Normalen muss netz_erzeugen selbst schaetzen
    t = time.time()
    p, info = netz.netz_erzeugen(wolke, "poisson", tiefe=7, dichte_schnitt=0)
    abw = np.abs(np.linalg.norm(p.xyz, axis=1) - 20)
    pruefe(np.percentile(abw, 95) < 0.5, "Poisson: 95 %% unter %.3f mm (%d Dreiecke, %.1f s)"
           % (np.percentile(abw, 95), info["dreiecke"], time.time() - t))

    print("Projekt mit Netz")
    pr = Projekt()
    s = pr.hinzufuegen(k.kopie())
    maske = s.xyz[:, 2] > 10
    pr.loeschen({s.id: maske})
    a, _ = netz.analyse(pr.scans[s.id])
    pruefe(a["loecher"] == 1 and len(pr.scans[s.id].tri) < len(k.tri), "Punkte löschen entfernt Dreiecke")
    pr.rueckgaengig()
    pruefe(len(pr.scans[s.id].tri) == len(k.tri), "Rückgängig stellt Dreiecke her")
    q = Projekt.laden(pr.speichern())
    pruefe(len(next(iter(q.scans.values())).tri) == len(k.tri), "Projekt speichert Dreiecke")

    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        for fmt in ("stl", "obj", "ply", "off"):
            pfad = os.path.join(tmp, "k." + fmt)
            ausgeben(k, pfad, fmt)
            z = einlesen(pfad)
            pruefe(z.ist_netz and len(z.tri) == len(k.tri), "Export/Import %s" % fmt)

    print()
    print("FEHLER: %d" % len(fehler) if fehler else "Alles in Ordnung.")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
