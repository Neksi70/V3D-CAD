#!/usr/bin/env python3
# Grundkoerper aus erkannten Formen + STEP/IGES (Etappe "Körper").
#
#   python3 tests/test_koerper.py

import json
import math
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))

from kern import erkennung as er  # noqa: E402
from kern import koerper as kp  # noqa: E402
from kern.projekt import Projekt  # noqa: E402
from kern.wolke import einlesen  # noqa: E402

DATEN = os.path.join(HIER, "daten")
fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def volumen(shape):
    return kp.kennwerte(shape)["volumen"]


def innen(shape, p):
    from OCP.BRepClass3d import BRepClass3d_SolidClassifier
    from OCP.TopAbs import TopAbs_IN
    from OCP.gp import gp_Pnt
    c = BRepClass3d_SolidClassifier(shape, gp_Pnt(*p), 1e-6)
    return c.State() == TopAbs_IN


def platte():
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
    return BRepPrimAPI_MakeBox(100, 60, 15).Shape()


def projekt_mit_erkennung():
    pfad = os.path.join(DATEN, "testteil.ply")
    if not os.path.exists(pfad):
        import cad_testteil
        cad_testteil.erzeugen(DATEN)
    soll = json.load(open(os.path.join(DATEN, "testteil_soll.json")))
    s = einlesen(pfad)
    s.transformiere(np.array(soll["matrix"]))
    p = Projekt()
    p.hinzufuegen(s, merken=False)
    t = time.time()
    e = er.erkennen(s)
    print("  " + e["zusammenfassung"], "(%.1f s)" % (time.time() - t))
    p.erkennung[s.id] = {"rev": s.rev, "labels": e["labels"],
                         "elemente": [er.als_json(x) for x in e["elemente"]],
                         "freiform": e["freiform"], "zusammenfassung": e["zusammenfassung"],
                         "toleranz": e["toleranz"]}
    return p, s, p.erkennung[s.id]["elemente"]


def finde(elemente, typ, **lage):
    for el in elemente:
        if el["typ"] != typ:
            continue
        p = el.get("punkt") or el.get("mitte")
        if all(abs(p["xyz".index(k)] - v) < 1.0 for k, v in lage.items()):
            return el
    raise AssertionError("Element %s %s nicht gefunden" % (typ, lage))


def main():
    print("Erkennung am ausgerichteten Testteil")
    p, s, el = projekt_mit_erkennung()
    bohr5 = finde(el, "bohrung", x=15, y=15)
    bohr8 = finde(el, "bohrung", x=32, y=30)
    zapfen = finde(el, "zapfen", x=50, y=30)
    kugel = finde(el, "kugel", x=50, y=50)
    kegel = finde(el, "kegel", x=15, y=30)
    rundung = next(e for e in el if e["typ"] == "rundung")
    ebene = next(e for e in el if e["typ"] == "ebene")

    print("Zylinder (Bohrung Ø 5,02, Nennmaß 5)")
    par = kp.grundkoerper_parameter(bohr5, True, 0)
    pruefe(abs(par["radius"] - 2.5) < 1e-9, "Nennmaß: r = %.4f" % par["radius"])
    pruefe(abs(abs(par["achse"][2]) - 1) < 1e-12, "Achse eingerastet %s" % par["achse"])
    pruefe(np.hypot(par["punkt"][0] - 15, par["punkt"][1] - 15) < 0.05 and abs(par["punkt"][2] - 7.5) < 0.2,
           "Achsmitte (%.3f, %.3f, %.3f) soll (15, 15, 7,5)" % tuple(par["punkt"]))
    v = volumen(kp.baue(par))
    pruefe(abs(v - math.pi * 2.5 ** 2 * par["hoehe"]) < 1e-6 * v and abs(par["hoehe"] - 15) < 0.3,
           "Volumen %.2f = π·2,5²·%.2f" % (v, par["hoehe"]))
    gem = kp.grundkoerper_parameter(bohr5, False, 0)
    pruefe(abs(gem["radius"] - 2.51) < 0.01, "Messwert ohne Nennmaß: r = %.4f" % gem["radius"])
    lang = kp.grundkoerper_parameter(bohr5, True, 20)
    pruefe(abs(lang["hoehe"] - 1.2 * par["hoehe"]) < 1e-9
           and np.allclose(np.add(lang["basis"], np.multiply(lang["achse"], lang["hoehe"] / 2)), par["punkt"]),
           "Verlängern 20 %%: %.2f → %.2f mm, symmetrisch" % (par["hoehe"], lang["hoehe"]))

    print("Rundung R 5 (Teilzylinder → Vollzylinder)")
    pr = kp.grundkoerper_parameter(rundung, True, 0)
    pruefe(pr["radius"] == 5.0, "Rundung nimmt radius_nenn: r = %.3f" % pr["radius"])

    print("Kugel (Kuppel r 7)")
    pk = kp.grundkoerper_parameter(kugel, False, 0)
    v = volumen(kp.baue(pk))
    pruefe(abs(pk["radius"] - 7) < 0.03 and np.linalg.norm(np.subtract(pk["mitte"], [50, 50, 15])) < 0.1,
           "Mitte %s, r = %.3f" % (np.round(pk["mitte"], 3).tolist(), pk["radius"]))
    pruefe(abs(v - 4 / 3 * math.pi * pk["radius"] ** 3) < 1e-4 * v, "Kugelvolumen %.2f" % v)
    pkn = kp.grundkoerper_parameter(kugel, True, 50)
    pruefe(pkn["radius"] == 7.0, "Kugel Nennmaß Ø 14, Verlängern ohne Wirkung")

    print("Kegelstumpf r 6 (z 15) → r 3 (z 25)")
    pg = kp.grundkoerper_parameter(kegel, False, 0)
    form = kp.baue(pg)
    # Achse zeigt zum wachsenden Radius: hier nach unten (-Z), Basis = kleiner Radius oben
    pruefe(pg["achse"][2] < -0.999, "Achse Richtung wachsender Radius: %s" % np.round(pg["achse"], 4).tolist())
    pruefe(abs(pg["r_max"] - 6) < 0.1 and abs(pg["r_min"] - 3) < 0.1,
           "r_max %.3f (soll 6), r_min %.3f (soll 3)" % (pg["r_max"], pg["r_min"]))
    pruefe(innen(form, (15 + 5.5, 30, 15.3)) and not innen(form, (15 + 5.5, 30, 24.7))
           and innen(form, (15 + 2.7, 30, 24.7)),
           "breites Ende unten (z 15), schmales oben (z 25) – Punktprobe")
    h = pg["hoehe"]
    soll_v = math.pi * h / 3 * (pg["r_max"] ** 2 + pg["r_max"] * pg["r_min"] + pg["r_min"] ** 2)
    v = volumen(form)
    pruefe(abs(v - soll_v) < 1e-4 * v and abs(v - 659.73) < 0.03 * 659.73,
           "Volumen %.2f (Kegelstumpf soll 659,73)" % v)
    pgn = kp.grundkoerper_parameter(kegel, True, 0)
    pruefe(abs(math.degrees(2 * pgn["halbwinkel"]) - kegel["winkel_nenn"]) < 1e-9,
           "Nennwinkel %.2f° statt %.2f°" % (kegel["winkel_nenn"], kegel["winkel_grad"]))
    pgl = kp.grundkoerper_parameter(kegel, False, 20)
    pruefe(abs(pgl["hoehe"] - 1.2 * h) < 1e-6 and pgl["r_max"] > pg["r_max"] and pgl["r_min"] < pg["r_min"],
           "Kegel verlängert: Ø %.2f → %.2f, Höhe %.2f" % (2 * pgl["r_max"], 2 * pgl["r_min"], pgl["hoehe"]))
    spitz = kp.grundkoerper_parameter(kegel, False, 500)
    pruefe(spitz["r_min"] == 0.0 and volumen(kp.baue(spitz)) > 0, "Verlängern endet an der Kegelspitze")

    print("Ebene")
    try:
        kp.grundkoerper_parameter(ebene, True, 0)
        pruefe(False, "Ebene muss abgelehnt werden")
    except ValueError as e:
        pruefe("Referenzebenen" in str(e), "Ebene: „%s“" % e)

    print("Körper im Projekt: neu, abziehen, vereinen")
    pruefe(kp.standard_operation(bohr5, False) == "neu" and kp.standard_operation(bohr5, True) == "abziehen"
           and kp.standard_operation(zapfen, True) == "neu", "Standard-Operation je Typ")
    basis = p.koerper_hinzufuegen(platte(), "Platte")
    v0 = volumen(basis.shape)
    k = p.grundkoerper(kp.baue(lang), "Zylinder", "abziehen", basis,
                       {"scan": s.id, "element": bohr5["id"]}, lang)
    v1 = volumen(k.shape)
    soll = math.pi * 2.5 ** 2 * 15
    pruefe(k.id == basis.id and abs((v0 - v1) - soll) < 1e-3 * soll,
           "Bohrung abziehen: −%.3f mm³ (soll π·2,5²·15 = %.3f)" % (v0 - v1, soll))
    pruefe(k.verlauf[-1]["name"] == "Grundkörper1 (Zylinder, abgezogen)", "Verlauf: %s" % k.verlauf[-1]["name"])
    pz = kp.grundkoerper_parameter(zapfen, True, 0)
    k = p.grundkoerper(kp.baue(pz), "Zylinder", "vereinen", p.koerper_holen(basis.id))
    v2 = volumen(k.shape)
    ueber = pz["punkt"][2] + pz["hoehe"] / 2 - 15          # Teil oberhalb der Platte
    soll = math.pi * 10 ** 2 * ueber
    pruefe(abs((v2 - v1) - soll) < 1e-4 * soll and abs(pz["hoehe"] - 10) < 0.3,
           "Zapfen vereinen: +%.2f mm³ (soll π·10²·%.3f = %.2f)" % (v2 - v1, ueber, soll))
    neu = p.grundkoerper(kp.baue(pk), "Kugel", "neu")
    pruefe(neu.name == "Grundkörper3 (Kugel)" and len(p.koerper) == 2, "neuer Körper „%s“" % neu.name)
    z = p.zustand()["koerper"]
    pruefe([x["name"] for x in z] == ["Platte", "Grundkörper3 (Kugel)"] and z[0]["dreiecke"] > 0
           and abs(z[0]["volumen"] - v2) < 0.01 and z[0]["groesse"][:2] == [100, 60]
           and abs(z[0]["groesse"][2] - 25) < 0.3
           and [v["name"] for v in z[0]["verlauf"]] == ["Platte", "Grundkörper1 (Zylinder, abgezogen)",
                                                         "Grundkörper2 (Zylinder, vereint)"],
           "zustand(): %s" % [(x["name"], x["dreiecke"], x["volumen"], x["groesse"]) for x in z])
    netz = p.koerper_holen(basis.id).daten()["netz"]
    pruefe(len(netz["kanten"]) > 0 and netz["tri"].max() < len(netz["xyz"]),
           "Netz: %d Dreiecke, %d Kantensegmente" % (len(netz["tri"]), len(netz["kanten"])))

    print("Rückgängig / Wiederholen")
    rev = p.koerper_holen(basis.id).rev
    p.rueckgaengig()                                   # Kugel weg
    pruefe(len(p.koerper) == 1, "Kugel rückgängig")
    p.rueckgaengig()                                   # Zapfen weg
    kb = p.koerper_holen(basis.id)
    pruefe(abs(volumen(kb.shape) - v1) < 1e-6 and len(kb.verlauf) == 2 and kb.rev > rev,
           "Zapfen rückgängig: %.2f mm³, rev %d → %d" % (volumen(kb.shape), rev, kb.rev))
    p.rueckgaengig()                                   # Bohrung weg
    pruefe(abs(volumen(p.koerper_holen(basis.id).shape) - v0) < 1e-6, "Bohrung rückgängig")
    p.wiederholen()
    p.wiederholen()
    p.wiederholen()
    pruefe(len(p.koerper) == 2 and abs(volumen(p.koerper_holen(basis.id).shape) - v2) < 1e-6
           and p.grundkoerper_zaehler == 3, "dreimal Wiederholen stellt alles her")
    p.koerper_setzen(neu.id, sichtbar=False, name="Kuppel")
    pruefe(not p.koerper_holen(neu.id).sichtbar and p.koerper_holen(neu.id).name == "Kuppel", "setzen")
    p.rueckgaengig()
    pruefe(p.koerper_holen(neu.id).sichtbar and p.koerper_holen(neu.id).name == "Grundkörper3 (Kugel)",
           "setzen rückgängig")
    p.koerper_entfernen(neu.id)
    pruefe(neu.id not in p.koerper, "entfernen")
    p.rueckgaengig()
    pruefe(neu.id in p.koerper, "entfernen rückgängig")

    print("Speichern / Laden")
    q = Projekt.laden(p.speichern())
    pruefe(len(q.koerper) == 2 and abs(volumen(q.koerper_holen(basis.id).shape) - v2) < 1e-6
           and q.koerper_holen(basis.id).verlauf == p.koerper_holen(basis.id).verlauf
           and q.grundkoerper_zaehler == 3 and q.naechster_koerper == p.naechster_koerper,
           "Körper + Verlauf + Zähler überstehen die Projektdatei")
    q.grundkoerper(kp.baue(pz), "Zylinder", "neu")
    pruefe(list(q.koerper)[-1] == 3 and q.koerper[3].name == "Grundkörper4 (Zylinder)", "Nummern laufen weiter")

    print("STEP / IGES")
    for fmt in ("step", "iges"):
        daten = kp.exportieren([p.koerper_holen(basis.id).shape], fmt)
        zurueck = kp.einlesen(daten, fmt)
        vz = volumen(zurueck)
        pruefe(abs(vz - v2) < 1e-4 * v2, "%s: %d kB, Volumen %.3f (soll %.3f)" % (fmt.upper(), len(daten) // 1024, vz, v2))
    step = kp.exportieren([k.shape for k in p.koerper.values()], "step").decode("latin-1")
    pruefe("SI_UNIT(.MILLI.,.METRE.)" in step, "STEP in mm")
    alle = kp.einlesen(step.encode("latin-1"), "step")
    pruefe(abs(volumen(alle) - (v2 + volumen(neu.shape))) < 1e-3 * v2, "alle Körper in einer STEP-Datei")

    print("HTTP")
    http_test(s)

    print()
    print("FEHLER: %d" % len(fehler) if fehler else "Alles in Ordnung.")
    return 1 if fehler else 0


def _frei(port):
    with socket.socket() as so:
        try:
            so.bind(("127.0.0.1", port))
            return port
        except OSError:
            so.bind(("127.0.0.1", 0))
            return so.getsockname()[1]


def http_test(scan):
    port = _frei(18797)
    basis = "http://127.0.0.1:%d" % port
    prozess = subprocess.Popen([sys.executable, os.path.join(HIER, "..", "server.py"), "--port", str(port)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def holen(pfad, daten=None, roh=False):
        if daten is not None and not isinstance(daten, bytes):
            daten = json.dumps(daten).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request(basis + pfad, data=daten), timeout=300) as r:
                inhalt = r.read()
                return (inhalt, dict(r.headers)) if roh else json.loads(inhalt)
        except urllib.error.HTTPError as e:
            return {"_status": e.code, **json.loads(e.read())}
    try:
        for _ in range(100):
            try:
                holen("/api/puls")
                break
            except OSError:
                time.sleep(0.2)
        from kern.wolke import ausgeben
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            ausgeben(scan, os.path.join(tmp, "t.ply"), "ply")
            z = holen("/api/import?name=testteil.ply", open(os.path.join(tmp, "t.ply"), "rb").read())
        sid = z["neu"]
        erk = holen("/api/formen/erkennen", {"id": sid})["erkennung"]
        bohr = next(e for e in erk["elemente"] if e["typ"] == "bohrung" and e["durchmesser_nenn"] == 8)
        zapf = next(e for e in erk["elemente"] if e["typ"] == "zapfen")
        a = holen("/api/koerper/aus_form", {"id": sid, "element": bohr["id"], "vorschau": True})
        pruefe(a["info"]["operation"] == "neu" and a["zustand"]["koerper"] == [] and
               len(np.frombuffer(__import__("base64").b64decode(a["vorschau"]["tri"]), np.uint32)) > 0,
               "Vorschau ohne Projektänderung: %s" % a["info"]["text"])
        a = holen("/api/koerper/aus_form", {"id": sid, "element": zapf["id"], "nennmass": True,
                                            "verlaengern": 0, "operation": None, "ziel": None})
        kid = a["koerper"]
        pruefe(a["zustand"]["koerper"][0]["name"] == "Grundkörper1 (Zylinder)"
               and a["zustand"]["undo"] == "Grundkörper1 (Zylinder) erzeugt",
               "Zapfen → %s" % a["zustand"]["koerper"][0]["name"])
        a = holen("/api/koerper/aus_form", {"id": sid, "element": bohr["id"], "vorschau": True})
        pruefe(a["info"]["operation"] == "abziehen" and a["info"]["ziel"] == kid,
               "Bohrung: Standard jetzt abziehen von Körper %s" % a["info"]["ziel"])
        n = holen("/api/koerper/netz/%d" % kid)
        import base64
        xyz = np.frombuffer(base64.b64decode(n["xyz"]), np.float32).reshape(-1, 3)
        tri = np.frombuffer(base64.b64decode(n["tri"]), np.uint32).reshape(-1, 3)
        kanten = np.frombuffer(base64.b64decode(n["kanten"]), np.float32).reshape(-1, 2, 3)
        pruefe(len(tri) == a["zustand"]["koerper"][0]["dreiecke"] and tri.max() < len(xyz) and len(kanten) > 0,
               "Netz: %d Punkte, %d Dreiecke, %d Kantensegmente" % (len(xyz), len(tri), len(kanten)))
        a = holen("/api/koerper/setzen", {"kid": kid, "name": "Welle", "sichtbar": False})
        pruefe(a["zustand"]["koerper"][0]["name"] == "Welle" and not a["zustand"]["koerper"][0]["sichtbar"], "setzen")
        a = holen("/api/rueckgaengig", {})
        pruefe(a["zustand"]["koerper"][0]["name"] == "Grundkörper1 (Zylinder)", "rückgängig per HTTP")
        for fmt, endung in (("step", ".step"), ("iges", ".igs")):
            daten, kopf = holen("/api/koerper/export/%d?format=%s" % (kid, fmt), roh=True)
            vz = volumen(kp.einlesen(daten, fmt))
            pruefe(endung in kopf.get("Content-Disposition", "") and abs(vz - math.pi * 100 * 10) < 0.03 * 3141.6,
                   "Export %s: %s, Volumen %.1f" % (fmt, kopf.get("Content-Disposition"), vz))
        daten, kopf = holen("/api/koerper/export/alle?format=step", roh=True)
        pruefe(daten.startswith(b"ISO-10303-21"), "Export alle (STEP)")
        f = holen("/api/koerper/export/99?format=step")
        pruefe(f.get("_status") == 400 and "Körper 99" in f.get("fehler", ""), "Fehler: %s" % f.get("fehler"))
        f = holen("/api/koerper/export/%d?format=dxf" % kid)
        pruefe(f.get("_status") == 400, "unbekanntes Format: %s" % f.get("fehler"))
        eb = next(e for e in erk["elemente"] if e["typ"] == "ebene")
        f = holen("/api/koerper/aus_form", {"id": sid, "element": eb["id"]})
        pruefe(f.get("_status") == 400 and "Referenzebenen" in f.get("fehler", ""), "Ebene: %s" % f.get("fehler"))
        a = holen("/api/koerper/entfernen", {"kid": kid})
        pruefe(a["zustand"]["koerper"] == [], "entfernen")
    finally:
        prozess.terminate()
        try:
            prozess.wait(10)
        except subprocess.TimeoutExpired:
            prozess.kill()


if __name__ == "__main__":
    sys.path.insert(0, HIER)
    sys.exit(main())
