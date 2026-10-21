#!/usr/bin/env python3
# V3D Scan als Dienst fuer V3D CAD: „🪄 Scan → CAD“ direkt im Browser-CAD.
#
# Derselbe Rechenkern wie die EXE (kern/automatik.py + kern/cad_bauplan.py), ohne Oberflaeche.
# V3D CAD schickt das Netz (Binaer-STL, mm, Z oben) ueber volme3d_server.py (/api/scan2cad/…)
# hierher und baut den gelieferten Bauplan selbst nach (v3dApi.bauplan).
#
#   POST   /auftrag          Rohdaten (STL/PLY/OBJ/3MF …), Kopf X-Name → {id, platz}
#   GET    /auftrag/<id>     {status: wartet|laeuft|fertig|fehler, platz, zeilen, sekunden, ergebnis?, fehler?}
#   DELETE /auftrag/<id>     wartenden Auftrag streichen (laufende rechnen zu Ende, Ergebnis verfaellt)
#   GET    /health
#
# Nur 127.0.0.1. Ein Auftrag nach dem anderen (ein Scan braucht 1–2 min und viel Speicher),
# Ergebnisse 30 min abholbar.
#
#   python3 cad_dienst.py [--port 3014]

import argparse
import multiprocessing as mp
import queue
import json
import os
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
import uuid
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HIER)

from kern import automatik  # noqa: E402
from kern import cad_bauplan  # noqa: E402
from kern import netz as nz  # noqa: E402
from kern.projekt import Projekt  # noqa: E402
from kern.wolke import EINLESBAR, einlesen  # noqa: E402

MAX_BYTES = 300 * 1024 * 1024
MAX_DREIECKE = 600000          # groessere Netze vorher vereinfachen (Automatik braucht keine Feinheit darunter)
MAX_WARTEND = 8
HALTEN_S = 30 * 60
VERWAIST_S = 45               # so lange ohne Statusabfrage = Seite zu/abgestuerzt -> Auftrag abbrechen

auftraege = {}                 # id -> dict
schlange = deque()
sperre = threading.Lock()
neu = threading.Condition(sperre)


def _platz(aid):
    """Platz in der Schlange; verwaiste Auftraege davor (Seite zu) zaehlen nicht."""
    jetzt = time.time()
    vor = 0
    for x in schlange:
        if x == aid:
            return vor + 1
        a = auftraege.get(x)
        if a is not None and not _verwaist(a, jetzt):
            vor += 1
    return 0


def _kind(pfad, name, q):
    """Eigener Prozess je Auftrag: laesst sich mitten im Rechnen beenden (Seite zu, Abbrechen)
    und gibt den Speicher von Open3D/OCP danach sicher frei."""
    try:
        s = einlesen(pfad, name)
        if s.tri is not None and len(s.tri) > MAX_DREIECKE:
            q.put(("zeile", "Netz vereinfacht: %d → %d Dreiecke" % (len(s.tri), MAX_DREIECKE)))
            s, _ = nz.vereinfachen(s, MAX_DREIECKE)
        p = Projekt()
        p.hinzufuegen(s)
        erg = automatik.scan_zu_cad(p, s.id, fortschritt=lambda z: q.put(("zeile", z)))
        k = p.koerper_holen(erg["koerper"])
        erg.pop("protokoll", None)
        erg["bauplan"] = cad_bauplan.bauplan(p, k)
        q.put(("fertig", erg))
    except automatik.Abbruch as ex:
        q.put(("fehler", str(ex)))
    except Exception as ex:
        traceback.print_exc()
        q.put(("fehler", "Umwandlung fehlgeschlagen: %s" % ex))


def _verwaist(a, jetzt):
    return a.get("abgebrochen") or jetzt - a.get("abfrage", a["angelegt"]) > VERWAIST_S


def arbeiter():
    ctx = mp.get_context("spawn")
    while True:
        with neu:
            while not schlange:
                neu.wait()
            aid = schlange.popleft()
            a = auftraege.get(aid)
            if a is None:
                continue
            if _verwaist(a, time.time()):          # niemand wartet mehr (Seite zu) -> gar nicht erst rechnen
                a.update(status="abgebrochen", ende=time.time())
                a.pop("daten", None)
                continue
            a["status"], a["start"] = "laeuft", time.time()
            daten = a.pop("daten")
        with tempfile.TemporaryDirectory() as tmp:
            pfad = os.path.join(tmp, "scan" + (os.path.splitext(a["name"])[1].lower() or ".stl"))
            with open(pfad, "wb") as f:
                f.write(daten)
            del daten
            q = ctx.Queue()
            kind = ctx.Process(target=_kind, args=(pfad, a["name"], q), daemon=True)
            kind.start()
            ergebnis = None
            while ergebnis is None:
                try:
                    art, wert = q.get(timeout=0.5)
                except queue.Empty:
                    with sperre:
                        weg = _verwaist(a, time.time())
                    if weg:
                        kind.terminate()
                        ergebnis = ("abgebrochen", None)
                        print("Auftrag %s abgebrochen (Seite zu oder Abbrechen)" % aid[:8], flush=True)
                    elif not kind.is_alive():
                        ergebnis = ("fehler", "Rechenprozess unerwartet beendet (Speicher?)")
                    continue
                if art == "zeile":
                    with sperre:
                        a["zeilen"].append(wert)
                else:
                    ergebnis = (art, wert)
            kind.join(5)
            if kind.is_alive():
                kind.kill()
        art, wert = ergebnis
        with sperre:
            if art == "fertig":
                a.update(status="fertig", ergebnis=wert, ende=time.time())
            elif art == "abgebrochen":
                a.update(status="abgebrochen", ende=time.time())
            else:
                a.update(status="fehler", fehler=wert, ende=time.time())


def aufraeumen():
    while True:
        time.sleep(60)
        jetzt = time.time()
        with sperre:
            for aid in [k for k, a in auftraege.items() if a.get("ende") and jetzt - a["ende"] > HALTEN_S]:
                auftraege.pop(aid, None)


class Handler(BaseHTTPRequestHandler):
    server_version = "V3DScanDienst/1"

    def log_message(self, fmt, *args):
        zeile = args[0] if args else ""
        if "/health" not in zeile and not (zeile.startswith("GET /auftrag/") and "?d=" in zeile):
            sys.stderr.write("%s %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    def _json(self, code, d):
        roh = json.dumps(d, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(roh)))
        self.end_headers()
        self.wfile.write(roh)

    def _id(self):
        teile = self.path.split("?", 1)[0].strip("/").split("/")
        return teile[1] if len(teile) == 2 and teile[0] == "auftrag" else None

    def do_GET(self):
        if self.path.startswith("/health"):
            with sperre:
                laeuft = sum(1 for a in auftraege.values() if a["status"] == "laeuft")
            # wartende Auftraege ohne Abfrage gleich streichen (Platz in der Schlange frei)
                return self._json(200, {"ok": True, "wartend": len(schlange), "laeuft": laeuft})
        aid = self._id()
        with sperre:
            a = auftraege.get(aid)
            if a is None:
                return self._json(404, {"fehler": "Auftrag unbekannt oder abgelaufen."})
            a["abfrage"] = time.time()
            diag = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("d")
            if diag:          # Diagnose der Seite (Blockaden, Speicher) – nur ins Protokoll
                sys.stderr.write("%s diag %s %s %s\n" % (time.strftime("%H:%M:%S"), aid[:8], a["status"], diag[0][:300]))
            aus = {"status": a["status"], "platz": _platz(aid), "zeilen": list(a["zeilen"]),
                   "sekunden": round(time.time() - (a.get("start") or a["angelegt"]), 1)}
            if a["status"] == "fertig":
                aus["ergebnis"] = a["ergebnis"]
            if a["status"] == "fehler":
                aus["fehler"] = a["fehler"]
            if a["status"] == "abgebrochen":
                aus["fehler"] = "Abgebrochen."
        return self._json(200, aus)

    def do_POST(self):
        if self.path.split("?", 1)[0].rstrip("/") != "/auftrag":
            return self._json(404, {"fehler": "nicht gefunden"})
        laenge = int(self.headers.get("Content-Length") or 0)
        if laenge <= 0:
            return self._json(400, {"fehler": "Keine Daten."})
        if laenge > MAX_BYTES:
            return self._json(413, {"fehler": "Scan zu groß (über %d MB)." % (MAX_BYTES // 1048576)})
        name = os.path.basename(urllib.parse.unquote(self.headers.get("X-Name") or "scan.stl"))[:120]
        if os.path.splitext(name)[1].lower() not in EINLESBAR:
            return self._json(400, {"fehler": "Dateiformat %s wird nicht unterstützt." % os.path.splitext(name)[1]})
        daten = self.rfile.read(laenge)
        with neu:
            if len(schlange) >= MAX_WARTEND:
                return self._json(503, {"fehler": "Gerade sind viele Scans in Arbeit – bitte in ein paar Minuten noch einmal."})
            aid = uuid.uuid4().hex
            auftraege[aid] = {"name": name, "daten": daten, "status": "wartet", "zeilen": [], "angelegt": time.time(),
                              "abfrage": time.time()}
            schlange.append(aid)
            neu.notify()
            platz = _platz(aid)
        return self._json(200, {"id": aid, "platz": platz})

    def do_DELETE(self):
        aid = self._id()
        with sperre:
            a = auftraege.get(aid)
            if a is not None:
                a["abgebrochen"] = True            # laufend: der Arbeiter beendet den Rechenprozess
                if aid in schlange:
                    schlange.remove(aid)
                    a.update(status="abgebrochen", ende=time.time())
                    a.pop("daten", None)
        return self._json(200, {"ok": a is not None})


def main():
    ap = argparse.ArgumentParser(description="V3D Scan → CAD als Dienst")
    ap.add_argument("--port", type=int, default=3014)
    args = ap.parse_args()
    threading.Thread(target=arbeiter, daemon=True).start()
    threading.Thread(target=aufraeumen, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print("V3D Scan → CAD Dienst auf 127.0.0.1:%d" % args.port, flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
