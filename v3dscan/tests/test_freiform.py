#!/usr/bin/env python3
# Freiform (automatische Flaechenrueckfuehrung, Flaeche einpassen, Beschneiden) und
# Koerper-Werkzeuge (Verknuepfen, Spiegeln, Muster, Schale, Aufdicken, Verschieben).
#
#   python3 tests/test_freiform.py

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
from kern.o3d import o3d  # noqa: E402
from kern.wolke import Scan  # noqa: E402

fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def torus(rauschen=0.0):
    m = o3d.geometry.TriangleMesh.create_torus(torus_radius=30, tube_radius=12, radial_resolution=160,
                                               tubular_resolution=80)
    X = np.asarray(m.vertices).copy()
    X[:, 2] *= 0.7
    X[:, 0] *= 1.3
    T = np.asarray(m.triangles).copy()
    soll = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(X), o3d.utility.Vector3iVector(T)).get_volume()
    if rauschen:
        X = X + np.random.default_rng(1).normal(0, rauschen, X.shape)
    return X, T, soll


def welle(x, y):
    return 3 * np.sin(x / 10) * np.cos(y / 15)


def box(x, y, z, p=(0, 0, 0)):
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
    from OCP.gp import gp_Pnt
    return BRepPrimAPI_MakeBox(gp_Pnt(*map(float, p)), float(x), float(y), float(z)).Shape()


def vol(s):
    return kp.kennwerte(s)["volumen"]


def kern_test():
    print("Automatische Flächenrückführung")
    X, T, soll = torus()
    t = time.time()
    sh, info = ff.auto_flaechen(X, T, 400, 7)
    dauer = time.time() - t
    pruefe(info["geschlossen"] and info["freie_kanten"] == 0 and info["fehlgeschlagen"] == 0,
           "Torus: geschlossener Körper aus %d Flächen (%.1f s)" % (info["vierecke"], dauer))
    v = vol(sh)
    pruefe(abs(v - soll) / soll < 0.002, "Volumen %.1f (Netz %.1f)" % (v, soll))
    rng = np.random.default_rng(0)
    probe = X[rng.choice(len(X), 8000, replace=False)]
    w = np.abs(kp.abweichung([sh], probe))
    pruefe(np.percentile(w, 95) < 0.05 and w.max() < 0.5,
           "Abweichung Netz ↔ Flächen: 95 %% unter %.3f, max %.3f mm" % (np.percentile(w, 95), w.max()))
    Xr, Tr, _ = torus(0.03)
    sh2, info2 = ff.auto_flaechen(Xr, Tr, 400, 7)
    w2 = np.abs(kp.abweichung([sh2], X[rng.choice(len(X), 8000, replace=False)]))
    pruefe(info2["geschlossen"] and np.percentile(w2, 95) < 0.1,
           "verrauscht (σ 0,03): geschlossen, 95 %% unter %.3f mm zum glatten Torus" % np.percentile(w2, 95))
    # offene Kuppel (Halbkugel ohne Boden) -> Schale, kein Volumen
    k = o3d.geometry.TriangleMesh.create_sphere(20, 80)
    Xk, Tk = np.asarray(k.vertices), np.asarray(k.triangles)
    oben = Xk[:, 2] > 0
    Tk = Tk[oben[Tk].all(1)]
    sh3, info3 = ff.auto_flaechen(Xk, Tk, 200, 7)
    pruefe(not info3["geschlossen"] and info3["freie_kanten"] > 0, "offene Kuppel → Schale mit %d freien Kanten"
           % info3["freie_kanten"])
    fl = kp.kennwerte(sh3)["flaeche"]
    pruefe(abs(fl - 2 * math.pi * 400) / (2 * math.pi * 400) < 0.03,
           "Kuppelfläche %.1f mm² (Soll 2πr² = %.1f)" % (fl, 2 * math.pi * 400))

    print("Fläche einpassen + Körper beschneiden")
    xy = rng.uniform([0, 0], [60, 40], (6000, 2))
    P = np.c_[xy, welle(xy[:, 0], xy[:, 1]) + rng.normal(0, 0.02, 6000)]
    face, finfo = ff.flaeche_einpassen(P, verlaengern=0.15)
    w = np.abs(kp.abweichung([face], P))
    pruefe(np.median(w) < 0.03 and np.percentile(w, 95) < 0.08,
           "Wellenfläche: Median %.4f, 95 %% unter %.3f mm (Raster %s)" % (np.median(w), np.percentile(w, 95), finfo["raster"]))
    klotz = box(60, 40, 20, (0, 0, -10))
    a = ff.koerper_schneiden(klotz, face, "unten")
    b = ff.koerper_schneiden(klotz, face, "oben")
    gx, gy = np.meshgrid(np.linspace(0, 60, 601), np.linspace(0, 40, 401))
    integral = float(np.trapezoid(np.trapezoid(welle(gx, gy) + 10, gx[0], axis=1), gy[:, 0]))
    va, vb = vol(a), vol(b)
    pruefe(abs(va + vb - 48000) < 5, "beide Seiten zusammen = Klotz (%.1f + %.1f)" % (va, vb))
    pruefe(min(abs(va - integral), abs(vb - integral)) < 30,
           "eine Seite = ∫(Welle+10) = %.1f mm³ (%.1f / %.1f)" % (integral, va, vb))

    print("Körper-Werkzeuge")
    q1, q2 = box(40, 30, 20), box(40, 30, 20, (20, 15, 10))
    pruefe(abs(vol(ft.koerper_bool(q1, q2, "schneiden")) - 20 * 15 * 10) < 1e-3, "Schnittmenge 3000 mm³")
    pruefe(abs(vol(ft.koerper_bool(q1, q2, "vereinen")) - (48000 - 3000)) < 1e-3, "Vereinen 45000 mm³")
    pruefe(abs(vol(ft.koerper_bool(q1, q2, "abziehen")) - (24000 - 3000)) < 1e-3, "Abziehen 21000 mm³")
    try:
        ft.koerper_bool(q1, box(5, 5, 5, (100, 0, 0)), "schneiden")
        pruefe(False, "leere Schnittmenge müsste Fehler geben")
    except ValueError as e:
        pruefe("leer" in str(e), "getrennte Körper: „%s“" % e)
    m = ft.spiegeln(q1, "yz", "ursprung", vereinen=True)
    pruefe(abs(vol(m) - 48000) < 1e-3 and abs(kp.kennwerte(m)["groesse"][0] - 80) < 1e-6,
           "Spiegeln an YZ durch Ursprung + vereinen: 80 mm breit, 48000 mm³")
    reihe = ft.muster(box(5, 5, 5), "linear", 4, (10, 0, 0))
    pruefe(abs(vol(reihe) - 4 * 125) < 1e-3 and abs(kp.kennwerte(reihe)["groesse"][0] - 35) < 1e-6,
           "lineares Muster 4 × 10 mm")
    kreis = ft.muster(box(4, 4, 4, (20, -2, 0)), "kreis", 6, achse="z")
    pruefe(abs(vol(kreis) - 6 * 64) < 1e-2, "Kreismuster 6× um Z: %.1f mm³" % vol(kreis))
    m_ = ft.flaechen_karte(q1)
    from OCP.BRepAdaptor import BRepAdaptor_Surface
    from OCP.TopoDS import TopoDS
    deckel = next(i for i in range(1, m_.Extent() + 1)
                  if abs(BRepAdaptor_Surface(TopoDS.Face_s(m_.FindKey(i))).Plane().Location().Z() - 20) < 1e-6)
    offen = ft.schale(q1, 2, [deckel])
    pruefe(abs(vol(offen) - (24000 - 36 * 26 * 18)) < 0.5, "Schale 2 mm, Deckel offen: %.1f mm³" % vol(offen))
    zu = ft.schale(q1, 2)
    pruefe(abs(vol(zu) - (24000 - 36 * 26 * 16)) < 0.5, "Schale 2 mm geschlossen hohl: %.1f mm³" % vol(zu))
    nz = kp.vernetzen(q1)
    pruefe(set(nz["flaechen_id"].tolist()) == set(range(1, 7)) and len(nz["flaechen_id"]) == len(nz["tri"]),
           "Anzeige-Netz trägt Flächen-Nummern 1…6")
    dick = ft.aufdicken(face, 2.0)
    pruefe(vol(dick) > 0, "Wellenfläche 2 mm aufgedickt: %.1f mm³" % vol(dick))
    v = ft.verschieben(q1, (5, 0, 0), (0, 0, 90))
    g = kp.kennwerte(v)["groesse"]
    pruefe(abs(g[0] - 30) < 1e-6 and abs(g[1] - 40) < 1e-6, "Drehen 90° um Z: Größe %s" % np.round(g, 3).tolist())


def http_test():
    print("Server")
    from test_koerper import _frei
    from kern.wolke import ausgeben
    port = _frei(18792)
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
        X, T, soll = torus()
        with tempfile.TemporaryDirectory() as tmp:
            ausgeben(Scan("torus", X, tri=T), os.path.join(tmp, "t.ply"), "ply")
            sid = holen("/api/import?name=torus.ply", open(os.path.join(tmp, "t.ply"), "rb").read())["neu"]
        a = holen("/api/freiform/auto", {"id": sid, "flaechen": 400, "vorschau": True})
        seg = np.frombuffer(base64.b64decode(a["linien"]), np.float32)
        pruefe(a["vierecke"] > 300 and len(seg) == a["vierecke"] * 4 * 6 and a["zustand"]["koerper"] == [],
               "Vorschau: %d Vierecke als Linien, keine Projektänderung" % a["vierecke"])
        a = holen("/api/freiform/auto", {"id": sid, "flaechen": 400})
        k = a["zustand"]["koerper"][0]
        pruefe(k["name"] == "Freiform1" and a["info"]["geschlossen"] and a["info"]["p95"] < 0.05
               and abs(k["volumen"] - soll) / soll < 0.002,
               "Freiform1: %.1f mm³, 95 %% unter %.3f mm" % (k["volumen"], a["info"]["p95"]))
        # Flaeche aus Auswahl: obere Haelfte des Torus
        n = len(X)
        m = X[:, 2] > 5
        maske = base64.b64encode(np.packbits(m, bitorder="little")).decode()
        a = holen("/api/freiform/flaeche", {"masken": {str(sid): maske}, "verlaengern": 0, "vorschau": True})
        pruefe("vorschau" in a and a["info"]["punkte"] == int(m.sum()), "Fläche aus Auswahl: Vorschau (%d Punkte, "
               "Median %.3f)" % (a["info"]["punkte"], a["info"]["median"]))
        a = holen("/api/freiform/flaeche", {"masken": {str(sid): base64.b64encode(np.packbits(np.zeros(n, bool), bitorder="little")).decode()}})
        pruefe("auswählen" in a.get("fehler", ""), "leere Auswahl: „%s“" % a.get("fehler"))
        # zwei Koerper per Tool verknuepfen
        from test_skizze import als_scan, platte  # noqa: F401
        kid = k["id"]
        a = holen("/api/feature/verschieben", {"kid": kid, "versatz": [0, 0, 5], "kopie": True})
        kid2 = a["koerper"]
        pruefe(len(a["zustand"]["koerper"]) == 2 and a["zustand"]["koerper"][1]["name"] == "Kopie1", "Kopie1 verschoben")
        a = holen("/api/feature/bool", {"kid": kid, "kid2": kid2, "art": "schneiden"})
        pruefe(len(a["zustand"]["koerper"]) == 1 and "Kombination1" in a["zustand"]["koerper"][0]["verlauf"][-1]["name"]
               and a["zustand"]["koerper"][0]["volumen"] < soll,
               "Schnittmenge: ein Körper, %.1f mm³" % a["zustand"]["koerper"][0]["volumen"])
        a = holen("/api/rueckgaengig", {})
        pruefe(len(a["zustand"]["koerper"]) == 2, "Rückgängig bringt beide Körper zurück")
    finally:
        prozess.terminate()
        prozess.wait(10)


if __name__ == "__main__":
    kern_test()
    http_test()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
