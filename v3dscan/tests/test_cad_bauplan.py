#!/usr/bin/env python3
# Bauplan fuer V3D CAD (v1.2): Verlauf -> Befehlsfolge. Die Werte wurden am 21.10.26 in V3D CAD selbst
# nachgebaut (MCP v3d-cad): Platte 29120,0 mm3 (Scan 29118,2), Drehteil 10135,2 (Scan 10151,5).
#
#   python3 tests/test_cad_bauplan.py

import json
import os
import subprocess
import sys
import time
import urllib.request

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HIER)
fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def main():
    from test_koerper import _frei
    port = _frei(18799)
    basis = "http://127.0.0.1:%d" % port
    prozess = subprocess.Popen([sys.executable, os.path.join(HIER, "..", "server.py"), "--port", str(port)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def holen(pfad, d=None):
        with urllib.request.urlopen(urllib.request.Request(basis + pfad, data=json.dumps(d).encode() if d is not None else None),
                                    timeout=300) as r:
            return json.loads(r.read())
    try:
        for _ in range(100):
            try:
                holen("/api/puls")
                break
            except OSError:
                time.sleep(0.2)
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xy", "versatz": 2}})
        holen("/api/skizze/zeichnen", {"art": "rechteck", "punkte": [[0, 0], [60, 40]]})
        holen("/api/skizze/ecke", {"kette": 0, "element": 0, "r": 5})
        holen("/api/skizze/zeichnen", {"art": "kreis", "punkte": [[15, 20], [20, 20]]})
        holen("/api/skizze/zeichnen", {"art": "langloch", "punkte": [[35, 20], [50, 20]], "wert": 6})
        s1 = holen("/api/skizze/uebernehmen", {})["sid"]
        k = holen("/api/feature/extrudieren", {"sid": s1, "modus": "laenge", "laenge": 8, "operation": "neu"})["koerper"]
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xz", "versatz": 0}})
        holen("/api/skizze/zeichnen", {"art": "rechteck", "punkte": [[20, 6], [40, 12]]})
        s2 = holen("/api/skizze/uebernehmen", {})["sid"]
        holen("/api/feature/extrudieren", {"sid": s2, "modus": "laenge", "laenge": 50, "operation": "abziehen", "kid": k, "umkehren": True})
        holen("/api/feature/muster", {"kid": k, "art": "linear", "anzahl": 2, "versatz": [0, 0, 20]})
        b = holen("/api/koerper/bauplan", {"kid": k})
        pruefe(b["vollstaendig"] and [x["befehl"] for x in b["befehle"]] == ["sketch.extrude", "sketch.extrude", "body.pattern"],
               "Platte: Extrusion, Tasche, Muster übersetzt")
        e0 = b["befehle"][0]["params"]
        pruefe(e0["plane"] == "XY" and e0["offset"] == 2 and e0["height"] == 8, "XY-Ebene, Starthöhe 2, Höhe 8")
        boegen = [x for x in e0["sketch"]["entities"] if x["type"] == "arc"]
        pruefe(len(boegen) == 3 and all(x["a1"] > x["a0"] for x in boegen), "Bögen mit a1 > a0 (V3D CAD läuft gegen den Uhrzeigersinn)")
        ecke = [x for x in boegen if x["r"] == 5][0]
        pruefe((ecke["a0"], ecke["a1"]) == (270, 360), "Eckrundung 270° → 360°")
        e1 = b["befehle"][1]["params"]
        pruefe(e1["plane"] == "XZ" and e1["op"] == "cut" and e1["target"] == "@k" and e1["offset"] == -50,
               "Tasche: XZ, cut auf @k, offset −50 (Y 0 … 50)")
        # Drehteil um eine senkrechte Achse
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xz", "versatz": -100}})
        holen("/api/skizze/zeichnen", {"art": "polylinie", "punkte": [[100, 0], [115, 0], [115, 5], [108, 12], [108, 30], [100, 30], [100, 0]]})
        s3 = holen("/api/skizze/uebernehmen", {})["sid"]
        d = holen("/api/feature/drehen", {"sid": s3, "winkel": 360, "element": 5, "operation": "neu"})
        b = holen("/api/koerper/bauplan", {"kid": d["koerper"]})
        pr = b["befehle"][0]["params"]["profile"]
        pruefe(b["vollstaendig"] and b["befehle"][0]["befehl"] == "revolve" and [15, 0] in pr and [8, 30] in pr,
               "Drehteil: revolve mit Profil (r, z)")
        # schraege Skizzenebene -> STEP
        holen("/api/skizze/neu", {"ebene": {"art": "welt", "name": "xy", "versatz": 0}})
        holen("/api/skizze/zeichnen", {"art": "rechteck", "punkte": [[0, 0], [10, 10]]})
        s4 = holen("/api/skizze/uebernehmen", {})["sid"]
        k4 = holen("/api/feature/extrudieren", {"sid": s4, "modus": "laenge", "laenge": 5, "operation": "neu"})["koerper"]
        holen("/api/feature/verschieben", {"kid": k4, "drehung": [0, 0, 30]})
        b = holen("/api/koerper/bauplan", {"kid": k4})
        pruefe(b["vollstaendig"] and b["befehle"][-1]["befehl"] == "body.transform", "Drehen um Z als body.transform")
        k5 = holen("/api/feature/extrudieren", {"sid": s4, "modus": "laenge", "laenge": 5, "operation": "neu"})["koerper"]
        holen("/api/feature/schale", {"kid": k5, "dicke": 1})
        b = holen("/api/koerper/bauplan", {"kid": k5})
        pruefe(not b["vollstaendig"] and b["befehle"][0]["befehl"] == "file.import" and "schale" in " ".join(b["hinweise"]),
               "nicht übersetzbar (Schale) → fester Körper (STL) mit Hinweis: %s" % b["hinweise"])
    finally:
        prozess.terminate()
        prozess.wait(10)


if __name__ == "__main__":
    main()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
