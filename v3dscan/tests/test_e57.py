#!/usr/bin/env python3
# E57-Leser (kern/e57.py): Rundreise schreiben -> lesen, Posen, Bitpackung ueber
# mehrere Pakete, Geschwindigkeit, kaputte Dateien. Liegt irgendwo eine echte
# .e57, wird sie zusaetzlich gelesen (nur Bericht, kein Fehler).
#
#   python3 tests/test_e57.py

import os
import shutil
import subprocess
import sys
import tempfile
import time

import numpy as np

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HIER, ".."))

from kern import e57  # noqa: E402

fehler = []
TMP = tempfile.mkdtemp(prefix="test_e57_")


def pruefe(bedingung, text):
    print(("  ok   " if bedingung else "  FEHLER ") + text)
    if not bedingung:
        fehler.append(text)


def pfad(name):
    return os.path.join(TMP, name)


def crc_ok(p):
    """Jede Seite: CRC-32C (big-endian) am Seitenende stimmt."""
    roh = np.fromfile(p, dtype=np.uint8).reshape(-1, 1024)
    soll = e57._crc32c_seiten(roh[:, :1020])
    ist = roh[:, 1020:].copy().view(">u4").reshape(-1)
    return bool((soll == ist).all())


def crc_bekannt():
    # Pruefwert CRC-32C("123456789") = 0xE3069283
    zeile = np.frombuffer(b"123456789", dtype=np.uint8).reshape(1, -1)
    return int(e57._crc32c_seiten(zeile)[0]) == 0xE3069283


def fall_a():
    print("(a) double xyz + Farbe + Intensitaet")
    rng = np.random.default_rng(1)
    n = 5000
    xyz = rng.uniform(-50, 50, (n, 3))
    farben = rng.integers(0, 256, (n, 3)) / 255.0
    inten = rng.random(n).astype(np.float32)
    p = pfad("a.e57")
    e57.schreiben(p, [{"xyz": xyz, "farben": farben, "intensitaet": inten, "name": "Kiste <1>"}])
    pruefe(crc_bekannt(), "CRC-32C Pruefwert 0xE3069283")
    pruefe(crc_ok(p), "CRC aller Seiten stimmt")
    d = e57.lesen(p)
    pruefe(d["scans"] == 1 and d["namen"] == ["Kiste <1>"], "1 Scan, Name %s" % d["namen"])
    pruefe(d["xyz"].shape == (n, 3) and d["xyz"].dtype == np.float64, "xyz %s %s" % (d["xyz"].shape, d["xyz"].dtype))
    pruefe(np.array_equal(d["xyz"], xyz), "xyz bitgenau")
    pruefe(d["farben"] is not None and np.abs(d["farben"] - farben).max() < 1e-6, "Farben 0..1 stimmen")
    pruefe(d["intensitaet"] is not None and np.abs(d["intensitaet"] - inten).max() < 1e-6, "Intensitaet stimmt")


def fall_b():
    print("(b) ScaledInteger xyz, mehrere Pakete, > 1 Seite")
    rng = np.random.default_rng(2)
    n = 20000
    xyz = rng.uniform([-1, 0, 5], [1, 3, 5.5], (n, 3))
    p = pfad("b.e57")
    e57.schreiben(p, [{"xyz": xyz, "name": "skaliert"}], xyz_skala=0.0001, punkte_je_paket=777)
    groesse = os.path.getsize(p)
    pruefe(groesse > 10 * 1024, "Datei ueber viele Seiten (%d Byte)" % groesse)
    pruefe(crc_ok(p), "CRC aller Seiten stimmt")
    d = e57.lesen(p)
    abw = np.abs(d["xyz"] - xyz).max()
    pruefe(len(d["xyz"]) == n, "Punktzahl %d" % len(d["xyz"]))
    pruefe(abw <= 0.00005 + 1e-12, "max. Abweichung %.2e <= halbe Skala" % abw)
    pruefe(d["farben"] is None and d["intensitaet"] is None, "ohne Farbe/Intensitaet -> None")
    # ungerade Bitbreiten (krumme Grenzen) ebenfalls
    xyz2 = rng.uniform(-123.456, 789.01, (3001, 3))
    e57.schreiben(p, [{"xyz": xyz2}], xyz_skala=0.001, punkte_je_paket=100)
    d = e57.lesen(p)
    pruefe(np.abs(d["xyz"] - xyz2).max() <= 0.0005 + 1e-9, "zweite Bitbreite (Skala 0.001) stimmt")
    # Einzelpunkt + konstantes Feld (Bitbreite 0)
    e57.schreiben(p, [{"xyz": [[1.0, 2.0, 3.0]]}], xyz_skala=0.01)
    d = e57.lesen(p)
    pruefe(np.allclose(d["xyz"], [[1, 2, 3]]), "Einzelpunkt (Bitbreite 0)")


def fall_c():
    print("(c) zwei Scans mit Pose")
    a = np.array([[1.0, 0, 0], [0, 2.0, 0], [0, 0, 3.0]])
    b = np.array([[1.0, 1.0, 0], [2.0, 0, 1.0]])
    s = np.sqrt(0.5)
    p = pfad("c.e57")
    e57.schreiben(p, [
        {"xyz": a, "name": "links", "farben": np.ones((3, 3))},
        {"xyz": b, "name": "rechts", "pose": {"rotation": (s, 0, 0, s), "translation": (10, 20, 30)},
         "intensitaet": np.full(2, 0.25)}])
    d = e57.lesen(p)
    pruefe(d["scans"] == 2 and d["namen"] == ["links", "rechts"], "2 Scans %s" % d["namen"])
    # 90 Grad um Z: (x,y,z) -> (-y,x,z), dann verschieben
    soll_b = np.array([[-1 + 10, 1 + 20, 30], [0 + 10, 2 + 20, 31]])
    pruefe(np.allclose(d["xyz"][:3], a), "Scan 1 unveraendert")
    pruefe(np.allclose(d["xyz"][3:], soll_b, atol=1e-12), "Scan 2 in Weltkoordinaten: %s" % d["xyz"][3:].round(6).tolist())
    pruefe(d["farben"].shape == (5, 3) and np.allclose(d["farben"][3:], 0.5), "fehlende Farben grau aufgefuellt")
    pruefe(np.allclose(d["intensitaet"], [0, 0, 0, 0.25, 0.25]), "Intensitaet zusammengefuehrt")


def fall_d():
    print("(d) eine Million Punkte")
    rng = np.random.default_rng(4)
    n = 1_000_000
    xyz = rng.normal(0, 100, (n, 3))
    farben = rng.integers(0, 256, (n, 3)) / 255.0
    inten = rng.random(n).astype(np.float32)
    for skala, name in ((None, "double"), (0.0001, "ScaledInteger")):
        p = pfad("d.e57")
        t0 = time.time()
        e57.schreiben(p, [{"xyz": xyz, "farben": farben, "intensitaet": inten}], xyz_skala=skala,
                      punkte_je_paket=50000)
        t1 = time.time()
        d = e57.lesen(p)
        t2 = time.time()
        genau = 1e-12 if skala is None else skala / 2 + 1e-9
        pruefe(len(d["xyz"]) == n and np.abs(d["xyz"] - xyz).max() <= genau, "%s: Werte stimmen" % name)
        pruefe(t2 - t1 < 10, "%s: lesen %.2f s (schreiben %.2f s, %.1f MB)"
               % (name, t2 - t1, t1 - t0, os.path.getsize(p) / 1e6))


def fall_e():
    print("(e) kaputte Dateien")

    def fehlertext(p):
        try:
            e57.lesen(p)
        except ValueError as e:
            return str(e)
        except Exception as e:   # noqa: BLE001 - jede andere Ausnahme ist ein Fehler
            return "FALSCHE AUSNAHME %s: %s" % (type(e).__name__, e)
        return "KEIN FEHLER"

    p = pfad("e.e57")
    with open(p, "wb") as f:
        f.write(b"das ist keine Punktwolke" * 10)
    t = fehlertext(p)
    pruefe("Signatur" in t, "falsche Signatur -> \"%s\"" % t)
    with open(p, "wb") as f:
        f.write(b"ASTM")
    t = fehlertext(p)
    pruefe("zu kurz" in t, "zu kurz -> \"%s\"" % t)
    e57.schreiben(pfad("ok.e57"), [{"xyz": np.random.default_rng(5).random((5000, 3))}])
    roh = open(pfad("ok.e57"), "rb").read()
    with open(p, "wb") as f:
        f.write(roh[:len(roh) // 2])
    t = fehlertext(p)
    pruefe("abgeschnitten" in t, "abgeschnitten -> \"%s\"" % t)
    # XML zerstoeren
    kaputt = bytearray(roh)
    xml_off = int.from_bytes(roh[24:32], "little")
    kaputt[xml_off:xml_off + 30] = b"\xff" * 30
    with open(p, "wb") as f:
        f.write(kaputt)
    t = fehlertext(p)
    pruefe("XML" in t, "zerstoertes XML -> \"%s\"" % t)
    # Abschnittskopf zerstoeren
    kaputt = bytearray(roh)
    kaputt[48] = 7
    with open(p, "wb") as f:
        f.write(kaputt)
    t = fehlertext(p)
    pruefe("sectionId" in t or "beschaedigt" in t, "zerstoerter Abschnitt -> \"%s\"" % t)
    t = fehlertext(pfad("gibt_es_nicht.e57"))
    pruefe(t.startswith("E57-Datei kann nicht gelesen"), "fehlende Datei -> \"%s\"" % t)


def echte_dateien():
    print("echte .e57 auf dem System")
    try:
        aus = subprocess.run("find / -xdev -iname '*.e57' -not -path '/proc/*' 2>/dev/null | head -5",
                             shell=True, capture_output=True, text=True, timeout=30).stdout
    except subprocess.TimeoutExpired:
        aus = ""
    gefunden = [z for z in aus.splitlines() if z.strip() and not z.startswith(TMP)]
    if not gefunden:
        print("  (keine gefunden)")
    for p in gefunden:
        try:
            t0 = time.time()
            d = e57.lesen(p)
            x = d["xyz"]
            print("  %s: %d Punkte, %d Scans, Box %s .. %s, Farbe %s, Intensitaet %s (%.1f s)"
                  % (p, len(x), d["scans"], x.min(0).round(3).tolist() if len(x) else "-",
                     x.max(0).round(3).tolist() if len(x) else "-", d["farben"] is not None,
                     d["intensitaet"] is not None, time.time() - t0))
        except Exception as e:  # noqa: BLE001 - nur Bericht
            print("  %s: nicht lesbar: %s" % (p, e))


def fall_dienst():
    """Import ueber den Dienst wie in der Oberflaeche (Datei -> /api/import)."""
    import json
    import subprocess
    import urllib.request
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from test_koerper import _frei
    port = _frei(18795)
    basis = "http://127.0.0.1:%d" % port
    server = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py")
    prozess = subprocess.Popen([sys.executable, server, "--port", str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(basis + "/api/puls", timeout=1)
                break
            except OSError:
                time.sleep(0.2)
        pfad = os.path.join(TMP, "dienst.e57")
        rng = np.random.default_rng(3)
        e57.schreiben(pfad, [{"xyz": rng.random((5000, 3)) * 50, "farben": rng.random((5000, 3)), "name": "s"}])
        a = json.loads(urllib.request.urlopen(urllib.request.Request(basis + "/api/import?name=scan.e57",
                                                                     data=open(pfad, "rb").read()), timeout=120).read())
        sc = [x for x in a["scans"] if x["id"] == a["neu"]]
        pruefe(bool(sc) and sc[0]["anzahl"] == 5000, "Import über den Dienst: %s" % (sc[0] if sc else a))
    finally:
        prozess.terminate()
        prozess.wait(10)


if __name__ == "__main__":
    fall_dienst()
    fall_a()
    fall_b()
    fall_c()
    fall_d()
    fall_e()
    echte_dateien()
    shutil.rmtree(TMP, ignore_errors=True)
    print("\n" + ("ALLES OK" if not fehler else "%d FEHLER" % len(fehler)))
    sys.exit(1 if fehler else 0)
