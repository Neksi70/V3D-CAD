#!/usr/bin/env python3
# Parametrischer Verlauf: Skizze ändern → Körper rechnet nach (Rundung bleibt über Bezugspunkte),
# Schritte aus-/einschalten, neu aufbauen, fester Zwischenstand, Speichern/Laden.
#
#   python3 tests/test_verlauf.py

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

fehler = []


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def main():
    from test_koerper import _frei
    from test_skizze import als_scan, platte
    from kern.wolke import ausgeben
    port = _frei(18786)
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
        holen("/api/skizze/schnitt", {"id": sid, "ebene": {"art": "welt", "name": "xy", "versatz": 5}, "toleranz": 0.05})
        skid = holen("/api/skizze/uebernehmen", {})["sid"]
        a = holen("/api/feature/extrudieren", {"sid": skid, "modus": "mitte", "laenge": 10, "operation": "neu"})
        kid = a["koerper"]
        v0 = a["zustand"]["koerper"][0]["volumen"]
        # obere lange Kante runden (R1)
        n = holen("/api/koerper/netz/%d" % kid)
        ids = np.frombuffer(base64.b64decode(n["kanten_id"]), np.uint32)
        seg = np.frombuffer(base64.b64decode(n["kanten"]), np.float32).reshape(-1, 2, 3)
        oben = [int(i) for i in set(ids.tolist()) if np.allclose(seg[ids == i][..., 2], 10, atol=1e-3)
                and np.ptp(seg[ids == i][..., 0]) > 40]
        a = holen("/api/feature/runden", {"kid": kid, "kanten": oben[:1], "radius": 1})
        v1 = a["zustand"]["koerper"][0]["volumen"]
        # Rundung läuft (wie in jedem CAD) über die ganze tangentiale Kantenkette = oberer Umriss
        umfang = 2 * (50 + 30) + 2 * math.pi * 5
        rund_soll = (1 - math.pi / 4) * 1 * umfang
        pruefe(abs((v0 - v1) - rund_soll) < 1.0, "Rundung R1 über den oberen Umriss: −%.2f mm³ (Soll %.2f)" % (v0 - v1, rund_soll))
        # Skizze bearbeiten: Bohrung Ø12 → Ø20
        a = holen("/api/skizze/bearbeiten", {"sid": skid})
        ki = next(i for i, t in enumerate(a["texte"]) if len(t) == 1 and t[0].startswith("Kreis"))
        a = holen("/api/skizze/radius", {"kette": ki, "element": 0, "r": 10})
        a = holen("/api/skizze/uebernehmen", {})
        k = a["zustand"]["koerper"][0]
        soll = v1 - math.pi * (100 - 36) * 10
        pruefe(a.get("neu_gerechnet") == [k["name"]] and abs(k["volumen"] - soll) < 2,
               "Skizze Ø12 → Ø20: Körper automatisch nachgerechnet %.1f (Soll %.1f), Rundung erhalten" % (k["volumen"], soll))
        # Rundung (Schritt 2) ausschalten → ohne Rundung; wieder an
        a = holen("/api/verlauf/schalten", {"kid": kid, "index": 1, "aus": True})
        k = a["zustand"]["koerper"][0]
        pruefe(abs(k["volumen"] - (soll + rund_soll)) < 1.0 and k["verlauf"][1]["aus"],
               "„ab hier aus“: Rundung abgeschaltet (%.1f)" % k["volumen"])
        a = holen("/api/verlauf/schalten", {"kid": kid, "index": 1, "aus": False})
        k = a["zustand"]["koerper"][0]
        pruefe(abs(k["volumen"] - soll) < 2 and not k["verlauf"][1]["aus"], "„bis hier an“: Rundung wieder da")
        a = holen("/api/rueckgaengig", {})
        pruefe(a["zustand"]["koerper"][0]["verlauf"][1]["aus"], "Rückgängig stellt den abgeschalteten Zustand her")
        holen("/api/wiederholen", {})
        a = holen("/api/verlauf/neu", {"kid": kid})
        pruefe(a.get("schritte") == 2 and abs(a["zustand"]["koerper"][0]["volumen"] - soll) < 2, "Neu aufbauen: 2 Schritte")
        # fester Zwischenstand: Kopie (nicht nachrechenbar) + danach Spiegeln (nachrechenbar)
        a = holen("/api/feature/verschieben", {"kid": kid, "versatz": [0, 0, 20], "kopie": True})
        kopie = a["koerper"]
        a = holen("/api/feature/spiegeln", {"kid": kopie, "ebene": "xy", "durch": "mitte", "vereinen": False})
        kk = next(x for x in a["zustand"]["koerper"] if x["id"] == kopie)
        pruefe(kk["verlauf"][0]["fest"] and not kk["verlauf"][1]["fest"], "Kopie ist fester Zwischenstand, Spiegeln danach nicht")
        a = holen("/api/verlauf/schalten", {"kid": kopie, "index": 0, "aus": True})
        pruefe("festen Zwischenstand" in a.get("fehler", ""), "fester Schritt lässt sich nicht ausschalten")
        a = holen("/api/verlauf/neu", {"kid": kopie})
        pruefe(a.get("schritte") == 1, "Kopie neu aufbauen: nur der Spiegel-Schritt wird gerechnet")
    finally:
        prozess.terminate()
        prozess.wait(10)


def speichern_test():
    print("Speichern/Laden")
    from kern.projekt import Projekt
    from kern import features as ft, skizze as sk, koerper as kp
    from kern.verlauf import nachrechnen
    p = Projekt()
    E = sk.ebene_welt("xy")
    q = {"ebene": sk.ebene_json(E), "ketten": [{"geschlossen": True, "elemente": [
        {"typ": "kreis", "mitte": [0, 0], "r": 10}]}]}
    z = p.skizze_hinzufuegen(q)
    k = p.feature(ft.extrudieren(z, 0, 10), "Extrusion", "neu", None,
                  {"typ": "extrusion", "skizze": z["id"], "modus": "laenge", "von": 0, "bis": 10, "laenge": 10})
    p.koerper_aendern(k.id, ft.skalieren(k.shape, 2), "Skalieren", {"typ": "skalieren", "faktor": 2})
    q2 = Projekt.laden(p.speichern())
    k2 = q2.koerper[k.id]
    shape, n = nachrechnen(q2, k2)
    pruefe(n == 2 and abs(kp.kennwerte(shape)["volumen"] - math.pi * 100 * 10 * 8) < 1, "geladen + nachgerechnet: 2 Schritte, Volumen ×8")


if __name__ == "__main__":
    print("Server")
    main()
    speichern_test()
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
