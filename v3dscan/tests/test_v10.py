#!/usr/bin/env python3
# v1.0: Netz-Werkzeuge (PTX, Abrollen, Mittelwert, Normalen, Skalieren/Spiegeln, Netz mit Körper, Auswahl
# merken), Export/Import (STL, STEP als Körper), Skizzen-Editor + Flächen-Befehle + Käfig über den Dienst.
#
#   python3 tests/test_v10.py

import base64
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))
sys.path.insert(0, HIER)

from kern import koerper as kp  # noqa: E402
from kern import netz as nz  # noqa: E402
from kern.wolke import Scan, einlesen  # noqa: E402

fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def ptx_datei(pfad):
    """Kleiner PTX-Scan: 40 × 30 Raster einer Ebene z = 2 mit Loch (0,0,0-Punkte), verschoben um (10, 0, 0)."""
    sp, re_ = 40, 30
    z = [str(sp), str(re_), "0 0 0", "1 0 0", "0 1 0", "0 0 1",
         "1 0 0 0", "0 1 0 0", "0 0 1 0", "10 0 0 1"]
    for i in range(sp):
        for j in range(re_):
            if 15 <= i < 20 and 10 <= j < 15:
                z.append("0 0 0 0.5 0 0 0")
            else:
                z.append("%g %g 2 0.5 200 100 50" % (i * 0.5, j * 0.5))
    open(pfad, "w").write("\n".join(z) + "\n")


def kern_test():
    print("Netz-Werkzeuge")
    with tempfile.TemporaryDirectory() as tmp:
        ptx_datei(os.path.join(tmp, "a.ptx"))
        s = einlesen(os.path.join(tmp, "a.ptx"))
    pruefe(len(s) == 40 * 30 - 25 and s.tri is not None and abs(s.xyz[:, 0].min() - 10) < 1e-6 and s.rgb is not None,
           "PTX: %d Punkte (Loch ausgespart), Netz aus dem Raster, Verschiebung + Farbe übernommen" % len(s))
    # Zylinder-Scan abrollen
    # offenes Rohr r10 × 30 (z 0…30) als Netz
    nu, nv = 120, 10
    w = np.linspace(0, 2 * np.pi, nu, endpoint=False)
    zz = np.linspace(0, 30, nv + 1)
    X = np.array([[10 * np.cos(a), 10 * np.sin(a), z] for z in zz for a in w])
    T = []
    for j in range(nv):
        for i in range(nu):
            a0, a1 = j * nu + i, j * nu + (i + 1) % nu
            b0, b1 = a0 + nu, a1 + nu
            T += [[a0, a1, b1], [a0, b1, b0]]
    zyl = Scan("zyl", X, tri=np.array(T))
    ab = nz.abrollen(zyl, (0, 0, 0), (0, 0, 1))
    b = np.ptp(ab.xyz, axis=0)
    pruefe(abs(b[0] - 2 * math.pi * 10) < 1.0 and abs(b[1] - 30) < 1e-3 and np.abs(ab.xyz[:, 2]).max() < 0.05,
           "Abrollen: %.2f × %.2f mm (Soll 62,8 × 30), radial flach" % (b[0], b[1]))
    um = nz.normalen_umdrehen(zyl)
    pruefe(np.array_equal(um.tri, zyl.tri[:, [0, 2, 1]]), "Normalen umdrehen: Dreiecke umgekehrt")
    s2 = zyl.kopie()
    T = np.eye(4); T[0, 0] = -1
    s2.transformiere(T)
    pruefe(np.array_equal(s2.tri, zyl.tri[:, [0, 2, 1]]), "Spiegeln kehrt den Dreiecks-Umlauf um (Außen bleibt außen)")
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
    from OCP.gp import gp_Pnt
    box = BRepPrimAPI_MakeBox(gp_Pnt(-20, -20, 10), 40, 40, 10).Shape()
    innen = nz.innen_maske(zyl, [box])
    pruefe(innen.any() and np.all(zyl.xyz[innen][:, 2] >= 10 - 1e-3) and np.all(zyl.xyz[innen][:, 2] <= 20 + 1e-3),
           "Netz mit Körper: %d Punkte liegen im Quader z 10…20" % innen.sum())
    a = nz.mittelwert_netz([zyl, zyl])
    pruefe(len(a[0].tri) > 100, "Mittelwert-Netz aus zwei Scans: %d Dreiecke" % len(a[0].tri))
    stl = kp.stl_daten([box])
    n = struct.unpack("<I", stl[80:84])[0]
    pruefe(len(stl) == 84 + 50 * n and n >= 12, "STL binär: %d Dreiecke" % n)


def http_test():
    print("Server")
    from test_koerper import _frei
    from test_skizze import als_scan, platte
    from test_freiform import torus
    from kern.wolke import ausgeben
    port = _frei(18785)
    basis = "http://127.0.0.1:%d" % port
    prozess = subprocess.Popen([sys.executable, os.path.join(HIER, "..", "server.py"), "--port", str(port)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def holen(pfad, daten=None, roh=False):
        if daten is not None and not isinstance(daten, bytes):
            daten = json.dumps(daten).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request(basis + pfad, data=daten), timeout=600) as r:
                inhalt = r.read()
                return inhalt if roh else json.loads(inhalt)
        except urllib.error.HTTPError as e:
            return {"_status": e.code, **json.loads(e.read())}

    def maske(m):
        return base64.b64encode(np.packbits(m, bitorder="little")).decode()
    try:
        for _ in range(100):
            try:
                holen("/api/puls")
                break
            except OSError:
                time.sleep(0.2)
        s = als_scan(platte())
        with tempfile.TemporaryDirectory() as tmp:
            ausgeben(s, os.path.join(tmp, "p.ply"), "ply")
            sid = holen("/api/import?name=platte.ply", open(os.path.join(tmp, "p.ply"), "rb").read())["neu"]
        # --- Skizzen-Editor über den Dienst ---
        a = holen("/api/skizze/neu", {"id": sid, "ebene": {"art": "welt", "name": "xy", "versatz": 10}})
        pruefe(a["skizze"]["ketten"] == [], "leere Skizze")
        a = holen("/api/skizze/zeichnen", {"art": "rechteck", "punkte": [[0, 0], [20, 10]]})
        a = holen("/api/skizze/ecke", {"kette": 0, "element": 0, "r": 2})
        a = holen("/api/skizze/versatz", {"kette": 0, "abstand": -1, "ecke": "schnitt"})
        a = holen("/api/skizze/kopieren", {"kette": 0, "art": "linear", "anzahl": 2, "schritt": [30, 0]})
        pruefe(len(a["skizze"]["ketten"]) == 3 and len(a["texte"][0]) == 5, "Rechteck + Ecke R2 + Versatz + Kopie: %s" % a["texte"])
        a = holen("/api/skizze/zeichnen", {"art": "langloch", "punkte": [[5, 20], [15, 20]], "wert": 4})
        a = holen("/api/skizze/bedingung", {"kette": 0, "element": 2, "art": "senkrecht"})
        if "fehler" in a: print("    FEHLERTEXT", a["fehler"])
        e2 = a["skizze"]["ketten"][0]["elemente"][2]
        pruefe(any(t.startswith("senkrecht K1/E3") for t in a.get("bedingungen", [])) and abs(e2["a"][0] - e2["b"][0]) < 1e-6,
               "Bedingung „senkrecht“ gespeichert: %s" % a.get("bedingungen"))
        a = holen("/api/skizze/uebernehmen", {})
        skid = a["sid"]
        d = holen("/api/skizze/dxf", {"sid": skid})
        pruefe(d["dxf"].count("\nLINE\n") >= 8 and "\nARC\n" in d["dxf"] and d["dxf"].rstrip().endswith("EOF"), "DXF-Export")
        a = holen("/api/skizze/umriss", {"id": sid, "ebene": {"art": "welt", "name": "xy"}, "toleranz": 0.1})
        pruefe(len(a["skizze"]["ketten"]) == 2, "Umriss der Platte: Außenkontur + Bohrung")
        holen("/api/skizze/verwerfen", {})
        # Schnitt nur durch Auswahl: linke Hälfte -> Kontur ohne Bohrung? (Bohrung bei x=20 liegt links)
        m = s.xyz[:, 0] > 35
        a = holen("/api/skizze/schnitt", {"id": sid, "ebene": {"art": "welt", "name": "xy", "versatz": 5},
                                          "masken": {str(sid): maske(m)}, "toleranz": 0.05})
        pruefe(len(a["skizze"]["ketten"]) == 1 and not a["skizze"]["ketten"][0]["geschlossen"],
               "Schnitt nur durch die Auswahl (rechte Hälfte): eine offene Kontur")
        holen("/api/skizze/verwerfen", {})
        # --- 3D-Skizze + Fläche füllen + Nähen + Wickeln ---
        w = np.linspace(0, 2 * np.pi, 9)[:-1]
        P = np.c_[45 + 8 * np.cos(w), 20 + 8 * np.sin(w), np.full(8, 10.0)]       # neben der Bohrung
        a = holen("/api/skizze/3d", {"id": sid, "punkte": P.tolist(), "glatt": True, "geschlossen": True})
        s3 = a["sid"]
        pruefe(a["zustand"]["skizzen"][-1]["name"] == "3D-Skizze1", "3D-Skizze auf den Scan gelegt")
        a = holen("/api/feature/fuellen", {"sid": s3, "auf_scan": True, "id": sid})
        pruefe(abs(a["info"]["flaeche"] - math.pi * 64) / (math.pi * 64) < 0.03 and a["info"]["scanpunkte"] > 0,
               "Fläche in die 3D-Skizze gefüllt, auf den Scan: %.1f mm² (Kreis r8: %.1f)" % (a["info"]["flaeche"], math.pi * 64))
        fid = a["koerper"]
        a = holen("/api/feature/extrudieren_3d", {"sid": s3, "richtung": "z", "laenge": 6, "beidseitig": False})
        wand = a["koerper"]
        a = holen("/api/feature/naehen", {"kids": [fid, wand], "vorschau": True})
        pruefe(not a["info"]["geschlossen"] and a["info"]["freie_kanten"] > 0, "Nähen Deckel + Wand: offener Becher")
        # --- Käfig über den Dienst ---
        X, T, _ = torus()
        with tempfile.TemporaryDirectory() as tmp:
            ausgeben(Scan("torus", X, tri=T), os.path.join(tmp, "t.ply"), "ply")
            tid = holen("/api/import?name=torus.ply", open(os.path.join(tmp, "t.ply"), "rb").read())["neu"]
        a = holen("/api/freiform/kaefig_neu", {"id": tid, "masken": {str(tid): maske(X[:, 2] > 5)}, "nu": 4, "nv": 4})
        pruefe(a["vierecke"] == 16 and a["raster"] == [4, 4], "Neuer Raster-Käfig 4 × 4 auf der Auswahl")
        a = holen("/api/freiform/kaefig_op", {"id": tid, "V": a["V"], "F": a["F"], "op": "feiner"})
        pruefe(a["vierecke"] == 64, "Käfig feiner: 64 Vierecke")
        a = holen("/api/freiform/kaefig_wrap", {"id": tid, "masken": {str(tid): maske(np.hypot(X[:, 0] / 1.3, X[:, 1]) > 30)}, "nu": 16, "nv": 4})
        pruefe(a["vierecke"] == 64, "Wrap-Käfig 16 × 4")
        # --- Netz-Befehle ---
        a = holen("/api/scan/transformieren", {"id": sid, "art": "skalieren", "faktor": [2, 1, 1]})
        sc = next(x for x in a["zustand"]["scans"] if x["id"] == sid)
        pruefe(a["zustand"]["undo"] == "Scan skaliert", "Scan skaliert (rückgängig machbar)")
        holen("/api/rueckgaengig", {})
        a = holen("/api/auswahl/speichern", {"masken": {str(sid): maske(s.xyz[:, 2] > 9.9)}, "name": "Deckel"})
        pruefe(a["zustand"]["auswahlen"][0]["name"] == "Deckel", "Auswahl „Deckel“ gemerkt")
        b = holen("/api/auswahl/holen", {"aid": a["aid"]})
        mm = np.unpackbits(np.frombuffer(base64.b64decode(b["maske"]), np.uint8), bitorder="little")[:len(s)].astype(bool)
        pruefe(np.array_equal(mm, s.xyz[:, 2] > 9.9), "gemerkte Auswahl wiederhergestellt")
        # --- Export/Import ---
        a = holen("/api/feature/extrudieren", {"sid": skid, "modus": "laenge", "laenge": 5, "operation": "neu"})
        kid = a["koerper"]
        stl = holen("/api/koerper/export/%d?format=stl" % kid, None, roh=True) if False else \
            urllib.request.urlopen(basis + "/api/koerper/export/%d?format=stl" % kid, timeout=120).read()
        pruefe(stl[:8] == b"V3D Scan" and len(stl) > 84, "STL-Export über den Dienst (%d Bytes)" % len(stl))
        step = urllib.request.urlopen(basis + "/api/koerper/export/%d?format=step" % kid, timeout=120).read()
        a = holen("/api/import?name=teil.step", step)
        if "fehler" in a:
            print("    FEHLERTEXT", a)
        neu = next(x for x in a["koerper"] if x["id"] == a["koerper_neu"])      # Import liefert den Zustand flach
        alt = next(x for x in a["koerper"] if x["id"] == kid)
        pruefe(abs(neu["volumen"] - alt["volumen"]) < 1e-3 and neu["name"] == "teil",
               "STEP wieder importiert als Körper „teil“ (gleiches Volumen %.1f)" % neu["volumen"])
        a = holen("/api/scan/mit_koerper", {"id": sid, "kids": [kid], "art": "teilen"})
        pruefe(a.get("anzahl", 0) > 0 or "Kein Scanpunkt" in a.get("fehler", ""), "Netz mit Körper teilen: %s" % (a.get("anzahl") or a.get("fehler")))
    finally:
        prozess.terminate()
        prozess.wait(10)


if __name__ == "__main__":
    kern_test()
    http_test()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
