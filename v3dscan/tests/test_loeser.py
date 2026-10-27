#!/usr/bin/env python3
# Skizzen-Bedingungs-Loeser (v1.1): gekoppelte Bedingungen + Masse bleiben gespeichert und werden gemeinsam
# geloest – im Kern und ueber den Dienst.
#
#   python3 tests/test_loeser.py

import json
import math
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))
sys.path.insert(0, HIER)

from kern import loeser as L  # noqa: E402
from kern import skizze as sk  # noqa: E402

fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def laengen(k):
    return [round(float(np.linalg.norm(np.subtract(e["b"], e["a"]))), 4) for e in k["elemente"] if e["typ"] == "linie"]


def kern():
    print("Kern")
    R = sk.kette_json(sk.zeichnen("rechteck", [[0, 0], [40, 30]], None))
    k = L.skizze_loesen([R], [{"art": "laenge", "e": [0, 0], "wert": 50}], anker=[[0, 0, "a"]])[0]
    pruefe(laengen(k) == [50, 30, 50, 30], "Rechteck: Länge 50, Gegenseite folgt (Achsen automatisch): %s" % laengen(k))
    pruefe(np.allclose(k["elemente"][0]["a"], [0, 0], atol=1e-3), "Anker bleibt liegen")
    k = L.skizze_loesen([R], [{"art": "laenge", "e": [0, 0], "wert": 50}, {"art": "gleich", "e": [0, 1], "f": [0, 0]}])[0]
    pruefe(laengen(k) == [50, 50, 50, 50], "gekoppelt: Höhe = Breite → Quadrat 50: %s" % laengen(k))
    D = sk.kette_json(sk.zeichnen("polylinie", [[60, 0], [100, 0], [100, 30], [60, 0]], None))
    k = L.skizze_loesen([D], [{"art": "winkel", "e": [0, 1], "f": [0, 0], "wert": 60}])[0]
    e0, e1 = k["elemente"][0], k["elemente"][1]
    w = math.degrees(math.atan2(e1["b"][1] - e1["a"][1], e1["b"][0] - e1["a"][0]))
    pruefe(abs(e0["a"][1] - e0["b"][1]) < 1e-9 and abs(w - 60) < 1e-6, "Winkel 60°, Grundlinie bleibt waagrecht (%.4f°)" % w)
    LL = sk.kette_json(sk.zeichnen("langloch", [[0, 0], [40, 0]], 10))
    k = L.skizze_loesen([LL], [{"art": "radius", "e": [0, 1], "wert": 8}, {"art": "gleich", "e": [0, 3], "f": [0, 1]}])[0]
    E = k["elemente"]
    def kreuz(u, v):
        return u[0] * v[1] - u[1] * v[0]
    tang = all(abs(abs(kreuz(np.subtract(E[i]["b"], E[i]["a"]) / np.linalg.norm(np.subtract(E[i]["b"], E[i]["a"])),
                             np.subtract(E[j]["mitte"], E[i]["a"]))) - E[j]["r"]) < 1e-6 for i in (0, 2) for j in (1, 3))
    pruefe(abs(E[1]["r"] - 8) < 1e-9 and abs(E[3]["r"] - 8) < 1e-9 and tang, "Langloch R8 beidseitig, Linien tangential")
    try:
        L.skizze_loesen([R], [{"art": "waagrecht", "e": [0, 1]}, {"art": "senkrecht", "e": [0, 1]}])
        pruefe(False, "Widerspruch erkannt")
    except ValueError as x:
        pruefe("widersprechen" in str(x), "Widerspruch erkannt: %s" % x)
    # Symmetrie ueber zwei Konturen: Kreis-Mitten symmetrisch zur senkrechten Linie
    A = sk.kette_json(sk.zeichnen("linie", [[0, -20], [0, 20]], None))
    K1 = sk.kette_json(sk.zeichnen("kreis", [[-10, 3], [-8, 3]], None))
    K2 = sk.kette_json(sk.zeichnen("kreis", [[12, 0], [14, 0]], None))
    k = L.skizze_loesen([A, K1, K2], [{"art": "symmetrisch", "p": [1, 0, "mitte"], "q": [2, 0, "mitte"], "achse": [0, 0]}])
    m1, m2 = k[1]["elemente"][0]["mitte"], k[2]["elemente"][0]["mitte"]
    ax = k[0]["elemente"][0]["a"][0]
    pruefe(abs(k[0]["elemente"][0]["b"][0] - ax) < 1e-9 and abs(m1[0] + m2[0] - 2 * ax) < 1e-6 and abs(m1[1] - m2[1]) < 1e-6, "symmetrisch über Konturen: %s ↔ %s" % (m1, m2))
    # Groesse: 120 Elemente aus einer Scan-Kontur in vertretbarer Zeit
    t = np.linspace(0, 2 * math.pi, 121)[:-1]
    P = np.c_[50 * np.cos(t), 30 * np.sin(t)]
    G = {"geschlossen": True, "elemente": [{"typ": "linie", "a": P[i].tolist(), "b": P[(i + 1) % 120].tolist()} for i in range(120)]}
    t0 = time.time()
    k = L.skizze_loesen([G], [{"art": "laenge", "e": [0, 0], "wert": 3}])[0]
    dt = time.time() - t0
    pruefe(abs(laengen(k)[0] - 3) < 1e-6 and dt < 20, "120 Elemente gelöst in %.1f s" % dt)


def dienst():
    print("Dienst")
    from test_koerper import _frei
    port = _frei(18791)
    basis = "http://127.0.0.1:%d" % port
    prozess = subprocess.Popen([sys.executable, os.path.join(HIER, "..", "server.py"), "--port", str(port)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def holen(pfad, daten=None):
        if daten is not None and not isinstance(daten, bytes):
            daten = json.dumps(daten).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request(basis + pfad, data=daten), timeout=600) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            return {"_status": e.code, **json.loads(e.read())}
    try:
        for _ in range(100):
            try:
                holen("/api/puls")
                break
            except OSError:
                time.sleep(0.2)
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xy", "versatz": 0}})
        holen("/api/skizze/zeichnen", {"art": "rechteck", "punkte": [[0, 0], [40, 30]]})
        a = holen("/api/skizze/bedingung", {"kette": 0, "element": 1, "art": "gleich", "bezug": 0})
        pruefe(laengen(a["skizze"]["ketten"][0]) == [35, 35, 35, 35], "gleich: Rechteck → Quadrat 35: %s" % laengen(a["skizze"]["ketten"][0]))
        a = holen("/api/skizze/laenge", {"kette": 0, "element": 0, "wert": 60})
        pruefe(laengen(a["skizze"]["ketten"][0]) == [60, 60, 60, 60], "neue Länge hält „gleich“: %s" % laengen(a["skizze"]["ketten"][0]))
        pruefe(a["bedingungen"] == ["gleich K1/E2 ↔ K1/E1", "Länge K1/E1 = 60 mm"], "Liste: %s" % a["bedingungen"])
        a = holen("/api/skizze/laenge", {"kette": 0, "element": 0, "wert": 50})
        pruefe(len(a["bedingungen"]) == 2 and laengen(a["skizze"]["ketten"][0]) == [50] * 4, "Maß ersetzt, nicht verdoppelt")
        a = holen("/api/skizze/bedingung", {"kette": 0, "element": 0, "art": "senkrecht"})
        pruefe("passt nicht" in a.get("fehler", ""), "Widerspruch → Fehler, Skizze unverändert: %s" % a.get("fehler"))
        a = holen("/api/skizze/bedingung_entfernen", {"index": 0})
        pruefe(a["bedingungen"] == ["Länge K1/E1 = 50 mm"], "Bedingung entfernt")
        holen("/api/skizze/zeichnen", {"art": "kreis", "punkte": [[20, 20], [24, 20]]})
        a = holen("/api/skizze/bedingung", {"kette": 1, "element": 0, "art": "radius", "wert": 6})
        pruefe(abs(a["skizze"]["ketten"][1]["elemente"][0]["r"] - 6) < 1e-9, "Radius als Maß")
        sid = holen("/api/skizze/uebernehmen", {})["sid"]
        a = holen("/api/skizze/kette_entfernen", {"sid": sid, "kette": 0})
        pruefe(a["bedingungen"] == ["Radius K1/E1 = 6 mm"], "Kontur entfernt → Bedingungen nachnummeriert: %s" % a["bedingungen"])
        a = holen("/api/skizze/holen", {"sid": sid})
        pruefe(a["bedingungen"] == ["Radius K1/E1 = 6 mm"], "gespeichert in der Skizze")
        # v1.2: Spline durch Klickpunkte, Trennen, Verlaengern
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xy", "versatz": 0}})
        a = holen("/api/skizze/zeichnen", {"art": "spline", "punkte": [[0, 0], [10, 5], [20, 0], [30, 8]]})
        e = a["skizze"]["ketten"][0]["elemente"][0]
        pruefe(e["typ"] == "spline" and e["a"] == [0, 0] and e["b"] == [30, 8], "Spline durch 4 Klickpunkte")
        a = holen("/api/skizze/trennen", {"kette": 0, "element": 0, "t": 0.5})
        pruefe(len(a["skizze"]["ketten"][0]["elemente"]) == 2, "Spline getrennt")
        holen("/api/skizze/zeichnen", {"art": "rechteck", "punkte": [[50, 0], [90, 30]]})
        holen("/api/skizze/zeichnen", {"art": "linie", "punkte": [[60, 10], [70, 10]]})
        a = holen("/api/skizze/verlaengern", {"kette": 2, "element": 0})
        pruefe(a["skizze"]["ketten"][2]["elemente"][0]["b"] == [90, 10], "Linie bis zur Rechteckseite verlängert")
        # v1.5: Auto-Bedingungen, Trimmen, Pinsel-Fit
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xy", "versatz": 0}})
        c_, s_ = math.cos(0.35), math.sin(0.35)
        P = [[c_ * x - s_ * y, s_ * x + c_ * y] for x, y in ([0, 0], [40.2, 0.3], [40, 30.1], [-0.2, 30])]
        holen("/api/skizze/zeichnen", {"art": "polylinie", "punkte": P + [P[0]]})
        a = holen("/api/skizze/auto_bedingungen", {})
        E = a["skizze"]["ketten"][0]["elemente"]
        d = [np.subtract(e["b"], e["a"]) for e in E]
        winkel = abs(float(d[0] @ d[1]) / (np.linalg.norm(d[0]) * np.linalg.norm(d[1])))
        pruefe(len(a["bedingungen"]) >= 4 and winkel < 1e-6 and abs(np.linalg.norm(d[0]) - np.linalg.norm(d[2])) < 1e-6,
               "Auto-Bedingungen: schiefes Viereck → exaktes Rechteck (%d Bedingungen)" % len(a["bedingungen"]))
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xy", "versatz": 0}})
        holen("/api/skizze/zeichnen", {"art": "rechteck", "punkte": [[0, 0], [40, 30]]})
        holen("/api/skizze/zeichnen", {"art": "kreis", "punkte": [[20, 30], [30, 30]]})
        a = holen("/api/skizze/trimmen", {"kette": 1, "element": 0, "punkt": [20, 40]})
        e = a["skizze"]["ketten"][1]["elemente"][0]
        pruefe(e["typ"] == "bogen" and np.allclose(e["m"], [20, 20], atol=1e-6), "Kreis oben weggetrimmt → unterer Halbbogen")
        a = holen("/api/skizze/trimmen", {"kette": 0, "element": 2, "punkt": [20, 30]})
        pruefe(len(a["skizze"]["ketten"]) == 2 and not a["skizze"]["ketten"][0]["geschlossen"]
               and [t for t in a["texte"][0]].count("Linie 10.00 mm") == 2, "Rechteck-Oberkante zwischen den Kreisschnitten getrimmt: %s" % a["texte"][0])
        t = np.linspace(0.3, 2.2, 30)
        pts = np.c_[5 + 8 * np.cos(t), 3 + 8 * np.sin(t)].tolist()
        a = holen("/api/skizze/einpassen_punkte", {"punkte": pts})
        e = a["skizze"]["ketten"][-1]["elemente"][0]
        pruefe(e["typ"] == "bogen" and abs(e["r"] - 8) < 1e-6 and np.allclose(e["mitte"], [5, 3]), "Pinsel-Fit: Bogen R8 um (5, 3)")
        # v1.3: Punkt als Skizzenelement
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xy", "versatz": 0}})
        holen("/api/skizze/zeichnen", {"art": "rechteck", "punkte": [[0, 0], [40, 30]]})
        a = holen("/api/skizze/zeichnen", {"art": "punkt", "punkte": [[12, 8]]})
        pruefe(a["skizze"]["ketten"][1].get("hilfe") and a["texte"][1] == ["Punkt (12.00; 8.00)"], "Punkt gezeichnet (Hilfs-Kontur)")
        a = holen("/api/skizze/bedingung", {"kette": 1, "element": 0, "art": "auf_linie", "bezug": 2, "bezug_kette": 0})
        pt = a["skizze"]["ketten"][1]["elemente"][0]["a"]
        y_oben = a["skizze"]["ketten"][0]["elemente"][2]["a"][1]
        pruefe(abs(pt[1] - y_oben) < 1e-6, "Punkt auf obere Linie gezogen: %s" % pt)
        a = holen("/api/skizze/bedingung", {"kette": 1, "element": 0, "art": "punkt_abstand", "bezug": 0, "bezug_kette": 0,
                                            "ende2": "a", "wert": 20})
        pt = np.array(a["skizze"]["ketten"][1]["elemente"][0]["a"])
        ecke = np.array(a["skizze"]["ketten"][0]["elemente"][0]["a"])
        pruefe(abs(np.linalg.norm(pt - ecke) - 20) < 1e-6, "Punktabstand 20 mm zur Ecke, weiter auf der Linie")
        sid = holen("/api/skizze/uebernehmen", {})["sid"]
        a = holen("/api/feature/extrudieren", {"sid": sid, "modus": "laenge", "laenge": 5, "operation": "neu"})
        pruefe("koerper" in a, "Skizze mit Punkt extrudierbar (Punkt zählt nicht zum Profil)")
        pruefe("POINT" in holen("/api/skizze/dxf", {"sid": sid})["dxf"], "DXF enthält POINT")
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xy", "versatz": 0}})
        holen("/api/skizze/zeichnen", {"art": "rechteck", "punkte": [[50, 0], [90, 30]]})
        holen("/api/skizze/zeichnen", {"art": "linie", "punkte": [[60, 10], [70, 10]]})
        a = holen("/api/skizze/verlaengern", {"kette": 1, "element": 0})
        a = holen("/api/skizze/trennen", {"kette": 0, "element": 0, "t": 0.25})
        pruefe(a["texte"][0][:2] == ["Linie 10.00 mm", "Linie 30.00 mm"], "Rechteckseite bei ¼ getrennt: %s" % a["texte"][0])
    finally:
        prozess.terminate()
        prozess.wait(10)


if __name__ == "__main__":
    kern()
    dienst()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
