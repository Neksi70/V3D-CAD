#!/usr/bin/env python3
# Loft/Sweep/Pipe, Abwickeln, glatte Freiform-Übergänge (G1), Käfig von Hand, Symmetrieebene,
# Mehrfachschnitt (v0.9).
#
#   python3 tests/test_flaechen2.py

import base64
import json
import math
import os
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

from kern import features as ft  # noqa: E402
from kern import freiform as ff  # noqa: E402
from kern import koerper as kp  # noqa: E402
from kern import referenz as rf  # noqa: E402
from kern import skizze as sk  # noqa: E402

fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def skz(ebene, elemente, zu=True):
    return {"ebene": sk.ebene_json(ebene), "ketten": [{"geschlossen": zu, "elemente": elemente}]}


def kreis(r, m=(0, 0)):
    return {"typ": "kreis", "mitte": list(m), "r": r}


def quadrat(a):
    h = a / 2
    p = [(-h, -h), (h, -h), (h, h), (-h, h)]
    return [{"typ": "linie", "a": list(p[i]), "b": list(p[(i + 1) % 4])} for i in range(4)]


def vol(s):
    return kp.kennwerte(s)["volumen"]


def kern_test():
    print("Loft / Sweep / Pipe")
    v = vol(ft.loft([skz(sk.ebene_welt("xy", 0), [kreis(10)]), skz(sk.ebene_welt("xy", 20), [kreis(5)])]))
    soll = math.pi * 20 / 3 * (100 + 50 + 25)
    pruefe(abs(v - soll) / soll < 1e-3, "Loft Kreis r10 → r5, h20: %.1f (Soll %.1f)" % (v, soll))
    v = vol(ft.loft([skz(sk.ebene_welt("xy", 0), quadrat(20)), skz(sk.ebene_welt("xy", 20), quadrat(10))], glatt=False))
    pruefe(abs(v - 20 / 3 * 700) < 0.5, "Loft Quadrat 20 → 10 (gerade): %.1f (Soll 4666.7)" % v)
    try:
        ft.loft([skz(sk.ebene_welt("xy", 0), [kreis(10)])])
        pruefe(False, "Loft mit einer Skizze müsste scheitern")
    except ValueError as e:
        pruefe("zwei" in str(e), "Loft mit einer Skizze: „%s“" % e)
    pfad = skz(sk.ebene_welt("xz"), [{"typ": "linie", "a": [0, 0], "b": [0, 30]}], zu=False)
    v = vol(ft.sweep(skz(sk.ebene_welt("xy"), [kreis(2)]), pfad))
    pruefe(abs(v - math.pi * 4 * 30) < 0.05, "Sweep Kreis r2 entlang 30 mm: %.2f (Soll %.2f)" % (v, math.pi * 120))
    m = (20, 0)
    a, b = (0, 0), (20, 20)
    mid = (20 - 20 * math.cos(math.pi / 4), 20 * math.sin(math.pi / 4))
    bogen = skz(sk.ebene_welt("xz"), [{"typ": "bogen", "a": list(a), "b": list(b), "m": list(mid), "mitte": list(m), "r": 20}], zu=False)
    v = vol(ft.pipe(bogen, 2))
    soll = math.pi * 4 * math.pi / 2 * 20
    pruefe(abs(v - soll) / soll < 1e-3, "Rohr r2 auf Viertelbogen R20: %.2f (Soll %.2f)" % (v, soll))
    v = vol(ft.pipe(bogen, 2, 1))
    pruefe(abs(v - soll * 3 / 4) / soll < 1e-3, "hohl (innen r1): %.2f (Soll %.2f)" % (v, soll * 0.75))

    print("Abwickeln")
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeCone, BRepPrimAPI_MakeCylinder
    from OCP.GeomAbs import GeomAbs_Cone, GeomAbs_Cylinder
    from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
    from OCP.TopoDS import TopoDS

    def mantel(sh, typ):
        mm = ft.flaechen_karte(sh)
        return [i for i in range(1, mm.Extent() + 1) if BRepAdaptor_Surface(TopoDS.Face_s(mm.FindKey(i))).GetType() == typ]
    zyl = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 10, 30).Shape()
    a = ft.abwickeln(zyl, mantel(zyl, GeomAbs_Cylinder))
    g = a["info"]["groesse"]
    pruefe(abs(g[0] - 2 * math.pi * 10) < 0.15 and abs(g[1] - 30) < 0.05 and a["info"]["verzerrung_max"] < 1e-6,
           "Zylindermantel → %.2f × %.2f (Soll 62,83 × 30), verzerrungsfrei" % tuple(g))
    kg = BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 20, 10, 30).Shape()
    a = ft.abwickeln(kg, mantel(kg, GeomAbs_Cone))
    L = math.hypot(30, 10) * 2                      # Mantellinie bis zur Spitze (aussen)
    sehne = 2 * L * math.sin(math.pi * 20 / L)
    pruefe(abs(a["info"]["groesse"][0] - sehne) < 0.3 and a["info"]["verzerrung_max"] < 1e-3,
           "Kegelmantel → Kreisringsektor, Sehne %.2f (Soll %.2f)" % (a["info"]["groesse"][0], sehne))
    svg = ft.umriss_svg(a["umriss"])
    pruefe(svg.startswith("<svg") and "polygon" in svg and "mm" in svg, "SVG in mm")

    print("Glatte Freiform-Übergänge + Käfig")
    from test_freiform import torus
    X, T, soll = torus()
    probe = X[np.random.default_rng(0).choice(len(X), 8000, replace=False)]
    roh, i0 = ff.auto_flaechen(X, T, 400, glatt=False)
    sh, i1 = ff.auto_flaechen(X, T, 400, glatt=True)
    w = np.abs(kp.abweichung([sh], probe))
    pruefe(i1["geschlossen"] and i1["knick_mitte_max"] < 0.01 and i1["knick_p95"] < 1.0 and i1["knick_mittel"] < 0.3,
           "G1: Knick Kantenmitte %.3f°, 95 %% unter %.2f°, Mittel %.2f° (ohne Glättung: %.1f / %.1f°)"
           % (i1["knick_mitte_max"], i1["knick_p95"], i1["knick_mittel"], i0["knick_p95"], i0["knick_mittel"]))
    pruefe(np.percentile(w, 95) < 0.03 and abs(vol(sh) - soll) / soll < 0.001,
           "dabei 95 %% unter %.3f mm, Volumen %.1f (Netz %.1f)" % (np.percentile(w, 95), vol(sh), soll))
    V, F = ff.quad_netz(X, T, 400)
    V2 = V.copy()
    V2[0] += np.cross(V2[0] / np.linalg.norm(V2[0]), [0, 0, 1]) * 1.5   # eine Ecke entlang der Fläche schieben
    k3, i3 = ff.auto_flaechen(X, T, kaefig={"V": V2, "F": F})
    w = np.abs(kp.abweichung([k3], probe))
    pruefe(i3["geschlossen"] and i3["vierecke"] == len(F) and np.percentile(w, 95) < 0.03,
           "Käfig von Hand (Ecke verschoben): geschlossen, %d Flächen, 95 %% unter %.3f" % (i3["vierecke"], np.percentile(w, 95)))
    try:
        ff.auto_flaechen(X, T, kaefig={"V": V2, "F": F + 100000})
        pruefe(False, "kaputter Käfig müsste scheitern")
    except ValueError as e:
        pruefe("Käfig" in str(e), "kaputter Käfig: „%s“" % e)

    print("Symmetrieebene")
    from test_skizze import als_scan, platte
    s = als_scan(platte(), wolke=True, rauschen=0.02)
    a = math.radians(25)
    R = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
    Xs = s.xyz @ R.T + [5, -3, 2]
    e, rms, kand = rf.symmetrieebene(Xs)
    n, p = np.asarray(e["normale"]), np.asarray(e["punkt"])
    # echte Symmetrieebenen der Platte: z = 5 (Dickenmitte) und y = 20 (durch die Bohrung)
    soll_z = abs(n @ [0, 0, 1]) > 0.9999 and abs(p @ [0, 0, 1] - 7) < 0.02
    ny = R @ [0, 1, 0]
    soll_y = abs(n @ ny) > 0.9999 and abs(abs(p @ ny) - abs((R @ [30, 20, 5] + [5, -3, 2]) @ ny)) < 0.05
    pruefe(soll_z or soll_y, "gedrehte Platte: Symmetrieebene gefunden (rms %.3f; Kandidaten %s)"
           % (rms, [round(k["rms"], 3) for k in kand]))
    pruefe(max(k["rms"] for k in kand) > 3 * rms, "unsymmetrische Richtung deutlich schlechter")


def http_test():
    print("Server")
    from test_koerper import _frei
    from test_skizze import als_scan, platte
    from kern.wolke import ausgeben
    port = _frei(18789)
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
        with tempfile.TemporaryDirectory() as tmp:
            ausgeben(als_scan(platte()), os.path.join(tmp, "p.ply"), "ply")
            sid = holen("/api/import?name=platte.ply", open(os.path.join(tmp, "p.ply"), "rb").read())["neu"]
        a = holen("/api/skizze/stapel", {"id": sid, "ebene": {"art": "welt", "name": "xy"}, "von": 1, "bis": 9,
                                         "anzahl": 5, "toleranz": 0.05})
        pruefe(len(a["sids"]) == 5 and a["zustand"]["undo"] == "5 Querschnitte erzeugt" and len(a["zustand"]["skizzen"]) == 5,
               "Mehrfachschnitt: 5 Skizzen in einem Schritt")
        a = holen("/api/feature/loft", {"sids": [a["sids"][0], a["sids"][-1]], "operation": "neu"})
        k = a["zustand"]["koerper"][0]
        soll = (2400 - (4 - math.pi) * 25) * 8          # Aussenkontur (Loft nimmt keine Bohrung) × 8 mm
        pruefe(k["name"] == "Loft1" and abs(k["volumen"] - soll) < 15,
               "Loft zwischen z=1 und z=9: %.1f mm³ (Soll %.1f)" % (k["volumen"], soll))
        a = holen("/api/rueckgaengig", {})
        a = holen("/api/rueckgaengig", {})
        pruefe(a["zustand"]["skizzen"] == [] and a["zustand"]["koerper"] == [], "2× Rückgängig: Loft und alle 5 Schnitte weg")
        a = holen("/api/referenz/symmetrie", {"id": sid})
        r = a["zustand"]["referenzen"][0]
        pruefe(r["name"] == "Symmetrieebene1" and a["info"]["rms"] < 0.3, "Symmetrieebene1 (rms %.3f)" % a["info"]["rms"])
        a = holen("/api/skizze/schnitt", {"id": sid, "ebene": {"art": "referenz", "rid": r["id"]}, "toleranz": 0.05})
        pruefe("skizze" in a and len(a["skizze"]["ketten"]) >= 1, "Skizze auf der Symmetrieebene: %s" % a["texte"])
        a = holen("/api/skizze/uebernehmen", {})
        a = holen("/api/feature/extrudieren", {"sid": a["sid"], "modus": "mitte", "laenge": 4, "operation": "neu"})
        kid = a["koerper"]
        a = holen("/api/feature/spiegeln", {"kid": kid, "ebene": "ref:%d" % r["id"], "vereinen": False, "vorschau": True})
        pruefe("vorschau" in a, "Spiegeln an Referenzebene (Vorschau)")
        a = holen("/api/feature/abwickeln", {"kid": kid})
        pruefe(a["svg"].startswith("<svg") and a["info"]["flaeche"] > 0 and a["zustand"]["koerper"][0]["id"] == kid,
               "Abwickeln liefert SVG, Projekt unverändert")
    finally:
        prozess.terminate()
        prozess.wait(10)


if __name__ == "__main__":
    kern_test()
    http_test()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
