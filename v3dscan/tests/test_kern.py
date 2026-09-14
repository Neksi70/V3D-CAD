#!/usr/bin/env python3
# Rechenkern gegen die kuenstlichen Scans pruefen (Sollwerte aus soll.json).
#
#   python3 tests/test_kern.py

import json
import os
import sys
import tempfile
import time

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))

from kern import registrierung as rg  # noqa: E402
from kern import werkzeuge as wz  # noqa: E402
from kern.projekt import Projekt  # noqa: E402
from kern.wolke import Scan, ausgeben, einlesen  # noqa: E402

DATEN = os.path.join(HIER, "daten")
fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def winkel_grad(T1, T2):
    R = np.asarray(T1)[:3, :3].T @ np.asarray(T2)[:3, :3]
    return float(np.degrees(np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1))))


def weg_mm(T1, T2):
    return float(np.linalg.norm(np.asarray(T1)[:3, 3] - np.asarray(T2)[:3, 3]))


def bereinigt(scan, abstand):
    """Tisch, Inseln und Ausreisser weg - wie ein Nutzer es vor dem Ausrichten tut."""
    weg, _, _ = wz.tisch_maske(scan, 0.6)
    scan.behalte(~weg)
    scan.behalte(~wz.kleine_inseln(scan, abstand * 4, 5))
    scan.behalte(~wz.ausreisser_statistisch(scan, 20, 2.0))
    return scan


def main():
    if not os.path.exists(os.path.join(DATEN, "soll.json")):
        import testdaten
        testdaten.erzeugen(DATEN)
    soll = json.load(open(os.path.join(DATEN, "soll.json")))

    print("Einlesen")
    s1 = einlesen(os.path.join(DATEN, "ansicht_1.ply"))
    s2 = einlesen(os.path.join(DATEN, "ansicht_2.ply"))
    s3 = einlesen(os.path.join(DATEN, "ansicht_3.asc"))
    pruefe(len(s1) == soll["ansicht_1.ply"]["punkte"], "PLY Punktzahl")
    pruefe(s1.rgb is not None and s1.nrm is not None, "PLY mit Farbe und Normalen")
    pruefe(len(s3) == soll["ansicht_3.asc"]["punkte"], "ASC Punktzahl")
    pruefe(s3.rgb is not None and s3.nrm is not None,
           "ASC-Spalten als Farbe + Normalen erkannt")
    netz = einlesen(os.path.join(DATEN, "objekt_netz.stl"))
    pruefe(len(netz) > 1000 and netz.nrm is not None, "STL-Netz als Punkte (%d)" % len(netz))

    abstand = wz.punktabstand(s1)
    print("  mittlerer Punktabstand %.3f mm" % abstand)
    pruefe(0.05 < abstand < 3, "Punktabstand plausibel")

    print("Bereinigen")
    weg, n, d = wz.tisch_maske(s1, 0.6)
    oben = s1.xyz[:, 1] > 0.6
    pruefe(abs(abs(n[1]) - 1) < 0.01 and n[1] > 0, "Tischnormale zeigt nach oben zum Objekt")
    pruefe(np.mean(weg[~oben & (s1.xyz[:, 1] > -0.3)]) > 0.97, "Tischpunkte erfasst")
    pruefe(np.mean(weg[oben & (s1.xyz[:, 1] < 150)]) < 0.03, "Objekt bleibt stehen")

    t = time.time()
    insel = wz.kleine_inseln(s1, abstand * 4, 5)
    print("  Inseln: %d Punkte in %.2f s" % (insel.sum(), time.time() - t))
    hand = np.linalg.norm(s1.xyz - [90, 60, 40], axis=1) < 12
    pruefe(np.mean(insel[hand]) > 0.95, "Hand-Insel erkannt")

    stat = wz.ausreisser_statistisch(s1, 20, 2.0)
    pruefe(stat.sum() > 0, "statistischer Filter findet Ausreißer (%d)" % stat.sum())

    idx = int(np.nonzero(hand)[0][0])
    verb = wz.verbunden(s1, idx, abstand * 4)
    pruefe(abs(int(verb.sum()) - int(hand.sum())) < 400, "Verbunden-Auswahl = Hand")

    duenn = wz.ausduennen(s1, 2.0)
    pruefe(len(duenn) < len(s1) / 2, "Ausdünnen 2 mm (%d → %d)" % (len(s1), len(duenn)))
    nrm = wz.normalen_berechnen(duenn, 6.0)
    pruefe(np.allclose(np.linalg.norm(nrm, axis=1), 1, atol=1e-3), "Normalen normiert")

    print("Ausrichten")
    for s in (s1, s2, s3):
        bereinigt(s, abstand)
    t = time.time()
    grob = rg.grob_automatisch(s2, s1, voxel=3.0)
    fein = rg.fein_icp(s2, s1, max_abstand=2.0, start=grob["matrix"], voxel=1.0)
    T2 = soll["ansicht_2.ply"]["matrix"]
    print("  Scan 2: grob %.1f°/%.1f mm, fein %.3f°/%.3f mm, Überlappung %.0f %%, "
          "RMSE %.3f, %.1f s" % (winkel_grad(grob["matrix"], T2), weg_mm(grob["matrix"], T2),
                                 winkel_grad(fein["matrix"], T2), weg_mm(fein["matrix"], T2),
                                 fein["ueberlappung"], fein["rmse"], time.time() - t))
    pruefe(winkel_grad(fein["matrix"], T2) < 0.5 and weg_mm(fein["matrix"], T2) < 1.0,
           "Scan 2 automatisch ausgerichtet")

    # Punktpaare: drei echte Stellen im Objekt, im Scan-3-System
    T3 = np.asarray(soll["ansicht_3.asc"]["matrix"])
    welt = np.array([[-20, 90, 10], [22, 38, 23], [-40, 20, 25], [30, 20, -20]], float)
    inv = np.linalg.inv(T3)
    lokal = welt @ inv[:3, :3].T + inv[:3, 3] + np.random.default_rng(3).normal(0, 0.8, (4, 3))
    paar = rg.aus_punktpaaren(lokal, welt)
    pruefe(winkel_grad(paar["matrix"], T3) < 3 and weg_mm(paar["matrix"], T3) < 4,
           "Punktpaare grob (%.2f°, RMSE %.2f mm)" % (winkel_grad(paar["matrix"], T3),
                                                     paar["rmse"]))
    fein3 = rg.fein_icp(s3, s1, 4.0, start=paar["matrix"], voxel=1.0)
    pruefe(winkel_grad(fein3["matrix"], T3) < 0.5 and weg_mm(fein3["matrix"], T3) < 1.0,
           "Scan 3 nach Punktpaaren + ICP (%.3f°, %.3f mm)"
           % (winkel_grad(fein3["matrix"], T3), weg_mm(fein3["matrix"], T3)))

    abw = rg.abweichung(s2, s1, fein["matrix"])
    print("  Abweichung Scan 2: Median %.3f mm" % np.median(abw))
    pruefe(np.median(abw) < 0.3, "Abweichungskarte plausibel")

    # Global: alle leicht verstellt starten und gemeinsam nachziehen
    s2.transformiere(fein["matrix"])
    s3.transformiere(fein3["matrix"])
    stoer = np.eye(4)
    stoer[:3, 3] = [0.8, -0.5, 0.6]
    s3.transformiere(stoer)
    s1.id, s2.id, s3.id = 1, 2, 3
    s1.fest = True
    t = time.time()
    glob = rg.global_ausrichten([s1, s2, s3], voxel=1.0, max_abstand=2.0)
    m3 = np.asarray(glob["matrizen"][3])
    pruefe(np.allclose(np.asarray(glob["matrizen"][1]), np.eye(4), atol=1e-6),
           "Global: fester Scan bleibt liegen")
    pruefe(weg_mm(m3 @ stoer, np.eye(4)) < 0.5,
           "Global zieht Störung zurück (%.3f mm, %.1f s)"
           % (weg_mm(m3 @ stoer, np.eye(4)), time.time() - t))

    print("Projekt")
    p = Projekt()
    a = p.hinzufuegen(Scan("a", np.random.rand(1000, 3) * 10))
    b = p.hinzufuegen(Scan("b", np.random.rand(500, 3) * 10, np.zeros((500, 3))))
    maske = np.zeros(1000, bool)
    maske[:100] = True
    p.loeschen({a.id: maske})
    pruefe(len(p.scans[a.id]) == 900, "Löschen")
    p.rueckgaengig()
    pruefe(len(p.scans[a.id]) == 1000, "Rückgängig")
    p.wiederholen()
    pruefe(len(p.scans[a.id]) == 900, "Wiederholen")
    neu = p.zusammenfuehren([a.id, b.id])
    pruefe(len(neu) == 1400 and neu.rgb is None and not p.scans[a.id].sichtbar,
           "Zusammenführen")
    p.rueckgaengig()
    pruefe(neu.id not in p.scans and p.scans[a.id].sichtbar, "Zusammenführen rückgängig")
    q = Projekt.laden(p.speichern())
    pruefe([len(s) for s in q.scans.values()] == [900, 500], "Projekt speichern/laden")
    p.hinzufuegen(Scan("c", np.zeros((5, 3))))
    p.rueckgaengig()
    pruefe(len(p.scans) == 2, "Hinzufügen rückgängig")

    with tempfile.TemporaryDirectory() as tmp:
        for fmt in ("ply", "pcd", "xyz", "asc"):
            pfad = os.path.join(tmp, "x." + fmt)
            ausgeben(s1, pfad, fmt)
            zurueck = einlesen(pfad)
            pruefe(len(zurueck) == len(s1), "Export/Import %s" % fmt)

    print("Tempo (1 Mio. Punkte)")
    gross = Scan("gross", np.random.default_rng(0).random((1000000, 3)) * 200)
    t = time.time()
    wz.komponenten(gross.xyz, 1.0)
    dauer = time.time() - t
    pruefe(dauer < 15, "Zusammenhangs-Suche %.1f s" % dauer)

    print()
    print("FEHLER: %d" % len(fehler) if fehler else "Alles in Ordnung.")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
