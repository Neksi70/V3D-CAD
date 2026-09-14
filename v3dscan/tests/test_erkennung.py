#!/usr/bin/env python3
# Geometrieerkennung am CAD-Testteil (Etappe 3).
#
#   python3 tests/test_erkennung.py

import json
import os
import sys
import time

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))

from kern import erkennung as er  # noqa: E402
from kern.wolke import Scan, einlesen  # noqa: E402

DATEN = os.path.join(HIER, "daten")
fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def typen(e):
    z = {}
    for el in e["elemente"]:
        z[el["typ"]] = z.get(el["typ"], 0) + 1
    return z


def main():
    pfad = os.path.join(DATEN, "testteil.ply")
    if not os.path.exists(pfad):
        import cad_testteil
        cad_testteil.erzeugen(DATEN)
    soll = json.load(open(os.path.join(DATEN, "testteil_soll.json")))
    T = np.array(soll["matrix"])
    roh = einlesen(pfad)

    print("Schräg im Raum (nicht ausgerichtet)")
    t = time.time()
    e = er.erkennen(roh)
    print("  " + e["zusammenfassung"], "(%.1f s)" % (time.time() - t))
    z = typen(e)
    pruefe(z.get("bohrung") == 6 and z.get("zapfen") == 1 and z.get("rundung") == 4
           and z.get("kugel") == 1 and z.get("kegel") == 1 and z.get("ebene") == 8,
           "alle Formelemente gefunden %s" % z)
    d = sorted(el["durchmesser_nenn"] for el in e["elemente"] if el["typ"] == "bohrung")
    pruefe(d == [5, 5, 5, 5, 8, 8], "Bohrungen Nennmaß %s" % d)
    gem = sorted(el["durchmesser"] for el in e["elemente"] if el["typ"] == "bohrung")
    pruefe(all(abs(g - s) < 0.02 for g, s in zip(gem, [5.02] * 4 + [8.03] * 2)),
           "gemessene Ø auf 0,02 mm: %s" % [round(g, 3) for g in gem])
    pruefe(len(e["labels"]) == len(roh) and (e["labels"] >= 0).mean() > 0.9,
           "%.1f %% der Punkte einer Form zugeordnet" % (100 * (e["labels"] >= 0).mean()))

    print("Ausgerichtet (Bauteil-System)")
    s = roh.kopie()
    s.transformiere(T)
    e = er.erkennen(s)
    bohr = [el for el in e["elemente"] if el["typ"] == "bohrung"]
    pruefe(all(el.get("achse_name") == "Z" for el in bohr), "Bohrungsachsen rasten auf Z ein")
    lagen = sorted((round(el["punkt"][0], 1), round(el["punkt"][1], 1)) for el in bohr)
    soll_lagen = sorted(tuple(b["xy"]) for b in soll["bohrungen"])
    abw = max(np.hypot(a[0] - b[0], a[1] - b[1]) for a, b in zip(lagen, soll_lagen))
    pruefe(abw < 0.1, "Bohrungsmitten auf %.3f mm" % abw)
    pruefe(all(abs(el["hoehe"] - 15) < 0.3 for el in bohr), "Tiefe 15 mm")
    beispiel = next(el["text"] for el in bohr if el["durchmesser_nenn"] == 8)
    print("  z. B.:", beispiel)
    pruefe("Mitte X" in beispiel and "Tiefe 15" in beispiel, "Text mit Mitte und Tiefe")
    zapfen = next(el for el in e["elemente"] if el["typ"] == "zapfen")
    pruefe(zapfen["durchmesser_nenn"] == 20 and abs(zapfen["hoehe"] - 10) < 0.3, "Zapfen Ø 20 × 10")
    kugel = next(el for el in e["elemente"] if el["typ"] == "kugel")
    pruefe(abs(kugel["radius"] - 7) < 0.03 and np.linalg.norm(np.subtract(kugel["mitte"], [50, 50, 15])) < 0.1,
           "Kuppel r %.3f" % kugel["radius"])
    kegel = next(el for el in e["elemente"] if el["typ"] == "kegel")
    soll_winkel = 2 * np.degrees(np.arctan(0.3))
    pruefe(abs(kegel["winkel_grad"] - soll_winkel) < 0.3 and abs(kegel["r_max"] - 6) < 0.1,
           "Kegel %.2f° (soll %.2f°)" % (kegel["winkel_grad"], soll_winkel))
    rund = [el for el in e["elemente"] if el["typ"] == "rundung"]
    pruefe(len(rund) == 4 and all(el["radius_nenn"] == 5 for el in rund), "4 Rundungen R 5")

    print("Mehr Rauschen (0,06 mm)")
    laut = s.kopie()
    rng = np.random.default_rng(4)
    laut.xyz = (laut.xyz + rng.normal(0, 0.06, laut.xyz.shape)).astype(np.float32)
    e = er.erkennen(laut)
    print("  " + e["zusammenfassung"])
    z = typen(e)
    pruefe(z.get("bohrung") == 6 and z.get("zapfen") == 1, "Bohrungen/Zapfen trotz Rauschen")

    print("Ohne Normalen")
    ohne = s.kopie()
    ohne.nrm = None
    e = er.erkennen(ohne)
    print("  " + e["zusammenfassung"])
    z = typen(e)
    pruefe(z.get("bohrung") == 6 and z.get("zapfen") == 1 and z.get("rundung") == 4,
           "Normalen geschätzt + ausgerichtet: Bohrung/Zapfen/Rundung richtig")

    print("Als Netz")
    import cad_testteil
    m = cad_testteil.netz_aus_form(cad_testteil.bauen(), 0.01)
    m = m.subdivide_midpoint(1)
    m.remove_duplicated_vertices()
    netz_scan = Scan.aus_o3d_netz("teil", m)
    e = er.erkennen(netz_scan)
    print("  " + e["zusammenfassung"], "(%d Eckpunkte)" % len(netz_scan))
    z = typen(e)
    pruefe(z.get("bohrung", 0) >= 6 and z.get("zapfen", 0) >= 1, "Netz-Eckpunkte reichen für Bohrungen")

    print("Nennmaße")
    pruefe(er.nennmass(10.03, 0.02) == 10.0, "10,03 → 10")
    pruefe(er.nennmass(6.52, 0.01) == 6.5, "6,52 → 6,5")
    pruefe(er.nennmass(6.43, 0.005) == 6.4, "6,43 → 6,4")
    pruefe(er.nennmass(6.37, 0.01) == 6.4, "6,37 → 6,4")
    pruefe(er.nennmass(24.93, 0.03) == 25.0, "24,93 → 25 (0,4 % Toleranz bei großen Maßen)")

    print()
    print("FEHLER: %d" % len(fehler) if fehler else "Alles in Ordnung.")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.path.insert(0, HIER)
    sys.exit(main())
