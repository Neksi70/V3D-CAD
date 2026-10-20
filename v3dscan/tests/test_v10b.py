#!/usr/bin/env python3
# v1.0 Nachtrag: treibende Maße (Länge, Winkel), Hilfslinien, Raster-Muster, Referenzen (Eingabe, 3 Punkte,
# Achse aus 2 Ebenen, Punkt aus 3 Ebenen), Übergangsfläche – über den Dienst.
#
#   python3 tests/test_v10b.py

import json
import math
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))
sys.path.insert(0, HIER)

fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def main():
    from test_koerper import _frei
    port = _frei(18781)
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
        # Referenzen
        a = holen("/api/referenz/eingabe", {"punkt": [0, 0, 0], "normale": [0, 0, 1]})
        r1 = a["rid"]
        a = holen("/api/referenz/drei_punkte", {"punkte": [[0, 0, 0], [0, 10, 0], [0, 0, 10]]})
        r2 = a["rid"]
        a = holen("/api/referenz/eingabe", {"punkt": [0, 7, 0], "normale": [0, 1, 0]})
        r3 = a["rid"]
        a = holen("/api/referenz/achse_ebenen", {"rids": [r1, r2]})
        ach = a["zustand"]["referenzen"][-1]
        pruefe(ach["art"] == "achse" and abs(abs(ach["richtung"][1]) - 1) < 1e-9, "Achse = Schnitt XY ∩ YZ: Y-Richtung")
        a = holen("/api/referenz/punkt_ebenen", {"rids": [r1, r2, r3]})
        pk = a["zustand"]["referenzen"][-1]
        pruefe(pk["art"] == "punkt" and [round(x, 6) for x in pk["punkt"]] == [0, 7, 0], "Punkt aus 3 Ebenen: (0, 7, 0)")
        a = holen("/api/referenz/achse_ebenen", {"rids": [r1, r1]})
        pruefe("parallel" in a.get("fehler", ""), "parallele Ebenen: „%s“" % a.get("fehler"))
        # Skizze: Rechteck, Länge, Winkel, Hilfslinie
        holen("/api/skizze/neu", {"ebene": {"art": "referenz", "rid": r1}})
        holen("/api/skizze/zeichnen", {"art": "rechteck", "punkte": [[0, 0], [40, 30]]})
        a = holen("/api/skizze/laenge", {"kette": 0, "element": 0, "wert": 50})
        pruefe(a["texte"][0] == ["Linie 50.00 mm", "Linie 30.00 mm", "Linie 50.00 mm", "Linie 30.00 mm"],
               "Länge 40 → 50: %s" % a["texte"][0])
        holen("/api/skizze/zeichnen", {"art": "polylinie", "punkte": [[60, 0], [100, 0], [100, 30], [60, 0]]})
        a = holen("/api/skizze/winkel", {"kette": 1, "element": 1, "bezug": 0, "wert": 60})
        e = a["skizze"]["ketten"][1]["elemente"][1]
        w = math.degrees(math.atan2(e["b"][1] - e["a"][1], e["b"][0] - e["a"][0]))
        pruefe(abs(w - 60) < 1e-6 or abs(w - 120) < 1e-6, "Winkel 60° zur Grundlinie (%.1f°)" % w)
        holen("/api/skizze/zeichnen", {"art": "kreis", "punkte": [[25, 15], [30, 15]]})
        a = holen("/api/skizze/hilfe", {"kette": 2})
        pruefe(a["skizze"]["ketten"][2].get("hilfe") is True, "Kreis als Hilfslinie markiert")
        holen("/api/skizze/kette_entfernen", {"kette": 1})
        sid = holen("/api/skizze/uebernehmen", {})["sid"]
        a = holen("/api/feature/extrudieren", {"sid": sid, "modus": "laenge", "laenge": 10, "operation": "neu"})
        k = a["zustand"]["koerper"][0]
        pruefe(abs(k["volumen"] - 50 * 30 * 10) < 1e-3, "Hilfslinie (Kreis) nicht im Profil: %.1f mm³ = 15000" % k["volumen"])
        # Raster-Muster
        a = holen("/api/feature/muster", {"kid": k["id"], "art": "raster", "anzahl": 2, "versatz": [60, 0, 0],
                                          "anzahl2": 2, "versatz2": [0, 40, 0]})
        pruefe(abs(a["zustand"]["koerper"][0]["volumen"] - 4 * 15000) < 1e-2, "Raster-Muster 2 × 2 = 60000 mm³")
        # Übergangsfläche zwischen zwei Streifen (Flächen aus Linienzug, als Fläche extrudiert)
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xz", "versatz": 0}})
        holen("/api/skizze/zeichnen", {"art": "linie", "punkte": [[0, 0], [20, 0]]})
        s1 = holen("/api/skizze/uebernehmen", {})["sid"]
        f1 = holen("/api/feature/extrudieren", {"sid": s1, "modus": "laenge", "laenge": 10, "als_flaeche": True})["koerper"]
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xz", "versatz": 20}})
        holen("/api/skizze/zeichnen", {"art": "linie", "punkte": [[0, 10], [20, 10]]})
        s2 = holen("/api/skizze/uebernehmen", {})["sid"]
        a = holen("/api/feature/extrudieren", {"sid": s2, "modus": "laenge", "laenge": 10, "als_flaeche": True})
        f2 = a["koerper"]
        # Kanten-Nummern: die freie Kante jedes Streifens, die zum anderen zeigt, über den Dienst suchen
        import base64
        import numpy as np

        def kanten(kid):
            n = holen("/api/koerper/netz/%d" % kid)
            ids = np.frombuffer(base64.b64decode(n["kanten_id"]), np.uint32)
            seg = np.frombuffer(base64.b64decode(n["kanten"]), np.float32).reshape(-1, 2, 3)
            return {int(i): seg[ids == i].reshape(-1, 3).mean(0) for i in set(ids.tolist())}
        ka = kanten(f1)
        kb = kanten(f2)
        # Ebene xz: Normale -Y → Streifen 1 reicht von y=0 nach y=-10, Streifen 2 von y=20 nach y=10
        ea = min(ka, key=lambda i: abs(ka[i][1] - max(v[1] for v in ka.values())) + abs(ka[i][0] - 10))
        eb = min(kb, key=lambda i: abs(kb[i][1] - min(v[1] for v in kb.values())) + abs(kb[i][0] - 10))
        a = holen("/api/feature/uebergang", {"kid_a": f1, "kante_a": ea, "kid_b": f2, "kante_b": eb})
        pruefe("info" in a and a["info"]["flaeche"] > 200, "Übergangsfläche zwischen den Streifen: %s" % (a.get("info") or a.get("fehler")))
    finally:
        prozess.terminate()
        prozess.wait(10)


if __name__ == "__main__":
    main()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
