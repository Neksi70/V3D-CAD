#!/usr/bin/env python3
# Querschnitt -> Skizze -> Extrudieren/Drehen -> Runden/Fasen (Etappen D + E).
#
#   python3 tests/test_skizze.py
#
# Sollteile werden mit OCP gebaut, vernetzt, verschweisst und verrauscht (wie ein Scan):
#   Platte 60 x 40 x 10, senkrechte Kanten R5, Bohrung Ø 12 bei (20, 20)
#       V = (2400 - (4 - pi)·25 - pi·36)·10 = 22 654,4 mm³
#   Welle: Ø 20 × 20 + Ø 12 × 25 entlang Z      V = pi·(100·20 + 36·25) = 9 110,6 mm³

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
from kern import koerper as kp  # noqa: E402
from kern import skizze as sk  # noqa: E402
from kern.wolke import Scan  # noqa: E402

fehler = []
V_PLATTE = (2400 - (4 - math.pi) * 25 - math.pi * 36) * 10
V_WELLE = math.pi * (100 * 20 + 36 * 25)
V_BASIS = V_PLATTE


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def platte():
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
    from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
    from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
    from OCP.TopAbs import TopAbs_EDGE
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    box = BRepPrimAPI_MakeBox(60, 40, 10).Shape()
    f = BRepFilletAPI_MakeFillet(box)
    ex = TopExp_Explorer(box, TopAbs_EDGE)
    while ex.More():
        e = TopoDS.Edge_s(ex.Current())
        c = BRepAdaptor_Curve(e)
        a, b = c.Value(c.FirstParameter()), c.Value(c.LastParameter())
        if abs(a.Z() - b.Z()) > 5:
            f.Add(5.0, e)
        ex.Next()
    zyl = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20, 20, -1), gp_Dir(0, 0, 1)), 6, 12).Shape()
    return BRepAlgoAPI_Cut(f.Shape(), zyl).Shape()


def welle():
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder
    from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
    a = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 10, 20).Shape()
    b = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, 20), gp_Dir(0, 0, 1)), 6, 25).Shape()
    return BRepAlgoAPI_Fuse(a, b).Shape()


def als_scan(shape, rauschen=0.01, name="scan", wolke=False, n=400000):
    nz = kp.vernetzen(shape, fein=True)
    X = nz["xyz"].astype(np.float64)
    T = nz["tri"].astype(np.int64)
    key = np.round(X / 1e-5).astype(np.int64)
    _, idx, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    X, T = X[idx], inv.ravel()[T]
    T = T[(T[:, 0] != T[:, 1]) & (T[:, 1] != T[:, 2]) & (T[:, 0] != T[:, 2])]
    rng = np.random.default_rng(7)
    if wolke:
        from kern.o3d import o3d
        m = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(X), o3d.utility.Vector3iVector(T.astype(np.int32)))
        m.compute_triangle_normals()
        pc = m.sample_points_uniformly(n, use_triangle_normal=True)
        P = np.asarray(pc.points) + rng.normal(0, rauschen, (n, 3))
        return Scan(name, P, nrm=np.asarray(pc.normals))
    return Scan(name, X + rng.normal(0, rauschen, X.shape), tri=T)


def elemente(ketten):
    return [(e["typ"], e) for k in ketten for e in k["elemente"]]


def platte_pruefen(s, titel, tol, luecke=0.0):
    E = sk.ebene_welt("xy", 5.0)
    t = time.time()
    L, zu, info = sk.schnitt(s, E)
    ketten = sk.skizze_rechnen(L, zu, tol=tol, luecke=luecke)
    dauer = time.time() - t
    skz = sk.skizze_json(ketten, E)
    typen = sorted(e["typ"] for k in skz["ketten"] for e in k["elemente"])
    pruefe(typen == ["bogen"] * 4 + ["kreis"] + ["linie"] * 4,
           "%s: 4 Bögen, 4 Linien, 1 Kreis (%s, %.2f s)" % (titel, typen, dauer))
    radien = [e["r"] for k in skz["ketten"] for e in k["elemente"] if e["typ"] == "bogen"]
    kreis = [e["r"] for k in skz["ketten"] for e in k["elemente"] if e["typ"] == "kreis"]
    pruefe(all(abs(r - 5) < 1e-6 for r in radien) and kreis and abs(kreis[0] - 6) < 1e-6,
           "%s: Nennmaß R5 ×4, Ø 12 (%s, Ø %s)" % (titel, radien, [2 * r for r in kreis]))
    laengen = sorted(np.linalg.norm(np.subtract(e["b"], e["a"])) for k in skz["ketten"]
                     for e in k["elemente"] if e["typ"] == "linie")
    pruefe(np.allclose(laengen, [30, 30, 50, 50], atol=0.06),
           "%s: Linien 30/30/50/50 ±0,06 (%s)" % (titel, np.round(laengen, 3).tolist()))
    pruefe(all(e.get("achse") for k in skz["ketten"] for e in k["elemente"] if e["typ"] == "linie"),
           "%s: Linien achsparallel eingerastet" % titel)
    abw = sk.schnitt_abweichung(skz)
    mx = max(float(w.max()) for w in abw if w is not None)
    pruefe(mx < 3 * tol, "%s: Schnitt ↔ Skizze max %.3f mm" % (titel, mx))
    return skz


def kern_test():
    print("Kern: Platte als Netz")
    sh = platte()
    s = als_scan(sh)
    skz = platte_pruefen(s, "Netz", 0.05)
    tiefe = ft.scan_tiefe(skz, s.xyz)
    pruefe(tiefe and abs(tiefe[0] + 5) < 0.05 and abs(tiefe[1] - 5) < 0.05,
           "bis Scan: −5 … +5 ab Schnitt bei z=5 (%s)" % (np.round(tiefe, 3).tolist() if tiefe else None))
    k = ft.extrudieren(skz, tiefe[0], tiefe[1])
    v = kp.kennwerte(k)["volumen"]
    # bis-Scan geht nur bis zum 0,2/99,8-%-Quantil -> Hoehe etwas unter 10
    pruefe(abs(v - V_PLATTE) / V_PLATTE < 0.01, "Extrusion bis Scan: %.1f mm³ (Soll %.1f)" % (v, V_PLATTE))
    k = ft.extrudieren(skz, -5, 5)
    v = kp.kennwerte(k)["volumen"]
    pruefe(abs(v - V_PLATTE) / V_PLATTE < 0.002, "Extrusion ±5: %.1f mm³ (Soll %.1f)" % (v, V_PLATTE))
    global V_BASIS
    V_BASIS = v          # gemessene Linienlaengen (±0,01) -> Bearbeitungen relativ dazu pruefen
    d = kp.abweichung([k], s.xyz)
    pruefe(abs(np.median(d)) < 0.01 and np.percentile(np.abs(d), 95) < 0.1,
           "Körper ↔ Scan: Median %.4f, 95 %% unter %.3f mm" % (np.median(d), np.percentile(np.abs(d), 95)))

    print("Kern: Platte als Punktwolke")
    w = als_scan(sh, rauschen=0.02, wolke=True)
    platte_pruefen(w, "Wolke", 0.1, luecke=1.0)

    print("Kern: Bearbeiten")
    ki = next(i for i, kk in enumerate(skz["ketten"]) if len(kk["elemente"]) == 8)
    bi = next(i for i, e in enumerate(skz["ketten"][ki]["elemente"]) if e["typ"] == "bogen")
    neu = sk.radius_setzen(skz["ketten"][ki], bi, 8.0)
    b = neu["elemente"][bi]
    vor = neu["elemente"][bi - 1]
    pruefe(abs(b["r"] - 8) < 1e-9 and np.allclose(vor["b"], b["a"]) and
           abs(np.linalg.norm(np.subtract(b["a"], b["mitte"])) - 8) < 1e-6,
           "Radius 5 → 8: Anschlüsse neu, Endpunkt auf dem Kreis")
    skz2 = dict(skz, ketten=[neu if i == ki else kk for i, kk in enumerate(skz["ketten"])])
    v8 = kp.kennwerte(ft.extrudieren(skz2, -5, 5))["volumen"]
    soll8 = V_BASIS - (1 - math.pi / 4) * (64 - 25) * 10
    pruefe(abs(v8 - soll8) < 2, "R8 an einer Ecke: %.1f mm³ (Soll %.1f)" % (v8, soll8))
    ohne = sk.element_entfernen(skz["ketten"][ki], bi)
    pruefe(ohne["elemente"][bi]["typ"] == "linie" and len(ohne["elemente"]) == 8,
           "Bogen entfernen → Fase (gerade Verbindung), Kontur bleibt zu")
    skz3 = dict(skz, ketten=[ohne if i == ki else kk for i, kk in enumerate(skz["ketten"])])
    v3 = kp.kennwerte(ft.extrudieren(skz3, -5, 5))["volumen"]
    soll3 = V_BASIS - (math.pi / 4 - 0.5) * 25 * 10
    pruefe(abs(v3 - soll3) < 2, "Bogen → Gerade: %.1f mm³ (Soll %.1f)" % (v3, soll3))

    print("Kern: Welle drehen")
    sw = als_scan(welle())
    el = {"punkt": [0, 0, 22.5], "achse": [0, 0, 1]}
    E = sk.ebene_durch_achse(el, 0)
    L, zu, _ = sk.schnitt(sw, E)
    ketten = sk.skizze_rechnen(L, zu, tol=0.05)
    skzw = sk.skizze_json(ketten, E)
    typen = sorted(e["typ"] for kk in skzw["ketten"] for e in kk["elemente"])
    pruefe(typen.count("linie") == 8 and len(skzw["ketten"]) == 1,
           "Schnitt durch die Achse: 1 Kontur, 8 Linien (%s)" % typen)
    k = ft.drehen(skzw, 360)
    v = kp.kennwerte(k)["volumen"]
    pruefe(abs(v - V_WELLE) / V_WELLE < 0.003, "Drehung 360°: %.1f mm³ (Soll %.1f)" % (v, V_WELLE))
    k = ft.drehen(skzw, 90)
    v = kp.kennwerte(k)["volumen"]
    pruefe(abs(v - V_WELLE / 4) / V_WELLE < 0.003, "Drehung 90°: %.1f mm³ (Soll %.1f)" % (v, V_WELLE / 4))

    print("Kern: Kanten runden/fasen")
    quader = ft.extrudieren({"ebene": sk.ebene_json(sk.ebene_welt("xy")), "ketten": [{"geschlossen": True, "elemente": [
        {"typ": "linie", "a": [0, 0], "b": [40, 0]}, {"typ": "linie", "a": [40, 0], "b": [40, 30]},
        {"typ": "linie", "a": [40, 30], "b": [0, 30]}, {"typ": "linie", "a": [0, 30], "b": [0, 0]}]}]}, 0, 20)
    pruefe(abs(kp.kennwerte(quader)["volumen"] - 24000) < 1e-3, "Quader aus Linien-Skizze 24000 mm³")
    m = ft.kanten_karte(quader)
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.TopoDS import TopoDS
    senkrecht = []
    for i in range(1, m.Extent() + 1):
        c = BRepAdaptor_Curve(TopoDS.Edge_s(m.FindKey(i)))
        a, b = c.Value(c.FirstParameter()), c.Value(c.LastParameter())
        if abs(a.Z() - b.Z()) > 10:
            senkrecht.append(i)
    nz = kp.vernetzen(quader)
    ids = set(nz["kanten_id"].tolist())
    pruefe(len(senkrecht) == 4 and ids == set(range(1, m.Extent() + 1)),
           "Kanten-Nummern im Anzeige-Netz = Kantenkarte (%d Kanten)" % m.Extent())
    seg = nz["kanten"][nz["kanten_id"] == senkrecht[0]]
    pruefe(np.allclose(np.ptp(seg[..., 2]), 20), "Segmente der Kante %d sind die senkrechte Kante" % senkrecht[0])
    r = ft.kanten_runden(quader, senkrecht, 3.0)
    soll = 24000 - 4 * (9 - math.pi * 9 / 4) * 20
    pruefe(abs(kp.kennwerte(r)["volumen"] - soll) < 0.5, "4× R3: %.1f (Soll %.1f)" % (kp.kennwerte(r)["volumen"], soll))
    f = ft.kanten_runden(quader, senkrecht[:1], 2.0, fase=True)
    pruefe(abs(kp.kennwerte(f)["volumen"] - (24000 - 2 * 20)) < 0.5, "Fase 2 mm: %.1f" % kp.kennwerte(f)["volumen"])
    try:
        ft.kanten_runden(quader, senkrecht, 50)
        pruefe(False, "R50 müsste scheitern")
    except ValueError as e:
        pruefe("nicht möglich" in str(e), "zu großer Radius: „%s“" % e)
    # Radius-Vorschlag aus erkannter Rundung an der Kante (0,0)-(0,0,20)
    rund = [{"typ": "rundung", "achse": [0, 0, 1], "punkt": [3, 3, 10], "radius": 3.02, "radius_nenn": 3.0}]
    c = BRepAdaptor_Curve(TopoDS.Edge_s(m.FindKey(senkrecht[0])))
    a = c.Value(c.FirstParameter())
    rund[0]["punkt"] = [a.X() + (3 if a.X() < 20 else -3), a.Y() + (3 if a.Y() < 15 else -3), 10]
    pruefe(ft.radius_vorschlag(quader, senkrecht[:1], rund) == 3.0, "Radius aus Scan: R3 vorgeschlagen")


def http_test():
    print("Server: kompletter Ablauf")
    from test_koerper import _frei
    from kern.wolke import ausgeben
    port = _frei(18794)
    basis = "http://127.0.0.1:%d" % port
    prozess = subprocess.Popen([sys.executable, os.path.join(HIER, "..", "server.py"), "--port", str(port)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def holen(pfad, daten=None, roh=False):
        if daten is not None and not isinstance(daten, bytes):
            daten = json.dumps(daten).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request(basis + pfad, data=daten), timeout=300) as r:
                inhalt = r.read()
                return inhalt if roh else json.loads(inhalt)
        except urllib.error.HTTPError as e:
            return {"_status": e.code, **json.loads(e.read())}
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
        a = holen("/api/skizze/schnitt", {"id": sid, "ebene": {"art": "welt", "name": "xy", "versatz": 50}})
        pruefe("schneidet" in a.get("fehler", ""), "Ebene daneben: „%s“" % a.get("fehler"))
        a = holen("/api/skizze/schnitt", {"id": sid, "ebene": {"art": "bereich", "element": 1}})
        pruefe("erkennen" in a.get("fehler", ""), "Bereichs-Ebene ohne Erkennung: „%s“" % a.get("fehler"))
        a = holen("/api/skizze/schnitt", {"id": sid, "ebene": {"art": "welt", "name": "xy", "versatz": 5},
                                          "toleranz": 0.05})
        pruefe(a["zustand"]["skizzen"] == [] and len(a["skizze"]["ketten"]) == 2 and a["abweichung"][0]["max"] < 0.15,
               "Vorschau: 2 Konturen, ohne Projektänderung (%s)" % a["texte"])
        ki = next(i for i, t in enumerate(a["texte"]) if len(t) == 8)
        bi = next(i for i, t in enumerate(a["texte"][ki]) if t.startswith("Bogen"))
        a = holen("/api/skizze/radius", {"kette": ki, "element": bi, "r": 6})
        pruefe(a["texte"][ki][bi] == "Bogen R 6", "Radius in der Vorschau geändert: %s" % a["texte"][ki][bi])
        a = holen("/api/skizze/uebernehmen", {})
        sk_id = a["sid"]
        pruefe(a["zustand"]["skizzen"][0]["name"] == "Skizze1" and a["zustand"]["undo"] == "Skizze1 erzeugt",
               "Übernehmen → %s" % a["zustand"]["skizzen"][0])
        a = holen("/api/feature/extrudieren", {"sid": sk_id, "modus": "auto", "vorschau": True})
        pruefe(a["info"]["operation"] == "neu" and abs(a["info"]["laenge"] - 10) < 0.1 and a["zustand"]["koerper"] == [],
               "Extrusion-Vorschau bis Scan: Länge %.3f" % a["info"]["laenge"])
        a = holen("/api/feature/extrudieren", {"sid": sk_id, "modus": "mitte", "laenge": 10})
        kid = a["koerper"]
        k = a["zustand"]["koerper"][0]
        soll6 = V_BASIS - (1 - math.pi / 4) * (36 - 25) * 10
        pruefe(k["name"] == "Extrusion1" and abs(k["volumen"] - soll6) < 3,
               "Extrusion1: %.1f mm³ (Soll %.1f mit einer R6-Ecke)" % (k["volumen"], soll6))
        n = holen("/api/koerper/netz/%d" % kid)
        ids = np.frombuffer(base64.b64decode(n["kanten_id"]), np.uint32)
        pruefe(len(ids) == len(np.frombuffer(base64.b64decode(n["kanten"]), np.float32)) // 6 and ids.min() >= 1,
               "Netz liefert Kanten-Nummern (%d Kanten)" % len(set(ids.tolist())))
        a = holen("/api/koerper/abweichung", {"id": sid, "toleranz": 0.1, "ausblenden": 2})
        werte = np.frombuffer(base64.b64decode(a["werte"]), np.float32)
        pruefe(np.median(np.abs(werte)) < 0.02 and 0.3 < np.abs(werte).max() < 0.6,
               "Abweichung Scan ↔ Extrusion: Median %.4f, max %.3f (Ecke R6 statt R5: ~0,41)"
               % (np.median(np.abs(werte)), np.abs(werte).max()))
        # scharfe obere Kante (z = 10, waagrecht, lang) - tangentiale Uebergaenge lassen sich nicht runden
        seg = np.frombuffer(base64.b64decode(n["kanten"]), np.float32).reshape(-1, 2, 3)
        oben = [int(i) for i in set(ids.tolist())
                if np.allclose(seg[ids == i][..., 2], 10, atol=1e-3)
                and np.ptp(seg[ids == i][..., 0]) > 40]
        a = holen("/api/feature/runden", {"kid": kid, "kanten": oben[:1], "radius": 1, "vorschau": True})
        pruefe("vorschau" in a and [v["name"] for v in a["zustand"]["koerper"][0]["verlauf"]] == ["Extrusion1"],
               "Rundungs-Vorschau ohne Änderung")
        a = holen("/api/feature/runden", {"kid": kid, "kanten": oben[:1], "radius": 1})
        pruefe(a["zustand"]["koerper"][0]["verlauf"][-1]["name"] == "Rundung1", "Rundung1 im Verlauf")
        a = holen("/api/rueckgaengig", {})
        a = holen("/api/rueckgaengig", {})
        pruefe(a["zustand"]["koerper"] == [] and len(a["zustand"]["skizzen"]) == 1, "2× Rückgängig: Körper weg, Skizze bleibt")
        a = holen("/api/rueckgaengig", {})
        pruefe(a["zustand"]["skizzen"] == [], "3× Rückgängig: Skizze weg")
        a = holen("/api/wiederholen", {})
        a = holen("/api/wiederholen", {})
        pruefe(len(a["zustand"]["skizzen"]) == 1 and len(a["zustand"]["koerper"]) == 1, "Wiederholen stellt beides her")
    finally:
        prozess.terminate()
        prozess.wait(10)


def speichern_test():
    print("Projekt: Skizze speichern/laden")
    from kern.projekt import Projekt
    p = Projekt()
    s = als_scan(platte())
    p.hinzufuegen(s, merken=False)
    E = sk.ebene_welt("xy", 5.0)
    L, zu, _ = sk.schnitt(s, E)
    z = p.skizze_hinzufuegen(sk.skizze_json(sk.skizze_rechnen(L, zu, tol=0.05), E))
    p.feature(ft.extrudieren(z, -5, 5), "Extrusion", "neu", None, {"typ": "extrusion", "skizze": z["id"]})
    q = Projekt.laden(p.speichern())
    pruefe(list(q.skizzen) == [1] and q.skizzen[1]["name"] == "Skizze1" and len(q.skizzen[1]["ketten"]) == 2
           and q.zaehler.get("Extrusion") == 1, "Skizze + Zähler nach Laden da")
    v = kp.kennwerte(ft.extrudieren(q.skizzen[1], -5, 5))["volumen"]
    pruefe(abs(v - V_PLATTE) / V_PLATTE < 0.002, "geladene Skizze extrudiert wieder %.1f mm³" % v)


if __name__ == "__main__":
    kern_test()
    speichern_test()
    http_test()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
