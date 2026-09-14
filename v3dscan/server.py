#!/usr/bin/env python3
# V3D Scan - lokaler Dienst: liefert die Oberflaeche (web/) und rechnet.
#
# Nur 127.0.0.1. Alle Projektaenderungen laufen nacheinander unter einer
# Sperre; Anfragen blockieren, bis die Rechnung fertig ist (die Oberflaeche
# zeigt so lange die Sanduhr).
#
# Punktmasken gehen als base64(np.packbits(..., bitorder="little")) hin und
# her, Punktdaten binaer (siehe _punkte_binaer).

import argparse
import base64
import json
import mimetypes
import os
import struct
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

FASSUNG = "0.1.0"
HIER = os.path.dirname(os.path.abspath(__file__))
if getattr(sys, "frozen", False):
    HIER = getattr(sys, "_MEIPASS", HIER)
WEB = os.path.join(HIER, "web")

from kern import registrierung as rg  # noqa: E402
from kern import werkzeuge as wz  # noqa: E402
from kern.projekt import Projekt  # noqa: E402
from kern.wolke import AUSGEBBAR, einlesen, ausgeben  # noqa: E402

projekt = Projekt()
sperre = threading.Lock()
letzter_puls = [0.0]
vorschau_cache = {}


class Fehler(Exception):
    pass


# --- Hilfen -------------------------------------------------------------------
def maske_b64(m):
    return base64.b64encode(np.packbits(m.astype(bool), bitorder="little")).decode()


def maske_aus_b64(text, n):
    bits = np.unpackbits(np.frombuffer(base64.b64decode(text), np.uint8),
                         bitorder="little")
    if len(bits) < n:
        raise Fehler("Auswahl passt nicht mehr zum Scan - bitte neu wählen.")
    return bits[:n].astype(bool)


def masken_lesen(d):
    aus = {}
    for sid, text in (d.get("masken") or {}).items():
        s = projekt.scan(sid)
        aus[s.id] = maske_aus_b64(text, len(s))
    return aus


def zahl(d, name, standard=None):
    wert = d.get(name, standard)
    if wert is None:
        raise Fehler("Wert „%s“ fehlt." % name)
    try:
        return float(wert)
    except (TypeError, ValueError):
        raise Fehler("„%s“ ist keine Zahl." % name)


def ziel_scans(d):
    ids = d.get("ids")
    if not ids:
        raise Fehler("Kein Scan gewählt.")
    return [projekt.scan(i) for i in ids]


def _punkte_binaer(s):
    """uint32 n, uint32 flags (1=Farbe, 2=Normalen), xyz float32*3n,
    rgb uint8*3n auf 4 Byte aufgefuellt, nrm float32*3n."""
    flags = (1 if s.rgb is not None else 0) | (2 if s.nrm is not None else 0)
    teile = [struct.pack("<II", len(s), flags), s.xyz.tobytes()]
    if s.rgb is not None:
        b = s.rgb.tobytes()
        teile.append(b + b"\0" * (-len(b) % 4))
    if s.nrm is not None:
        teile.append(s.nrm.tobytes())
    return b"".join(teile)


# --- Bereinigen -----------------------------------------------------------------
def bereinigen_masken(d):
    werkzeug = d.get("werkzeug")
    schluessel = json.dumps([d, [(s.id, s.rev) for s in ziel_scans(d)]],
                            sort_keys=True)
    if schluessel in vorschau_cache:
        return vorschau_cache[schluessel]
    masken, extra = {}, {}
    for s in ziel_scans(d):
        if len(s) == 0:
            continue
        if werkzeug == "tisch":
            m, n, dd = wz.tisch_maske(s, zahl(d, "toleranz"), int(zahl(d, "versuch", 0)),
                                      bool(d.get("darunter", True)))
            extra[s.id] = {"normale": n.tolist(), "d": dd}
            # Liegt unter der Ebene viel, ist es vermutlich kein Tisch, sondern
            # eine Flaeche des Objekts (z. B. Sockel-Oberseite nach dem 2. Mal).
            unter = int(np.sum(wz.seite_der_ebene(s.xyz, -n, -dd, zahl(d, "toleranz"))))
            if unter > 0.15 * len(s):
                extra[s.id]["warnung"] = (
                    "„%s“: unter dieser Ebene liegen %d %% der Punkte – das ist "
                    "wahrscheinlich nicht der Tisch. Vorschau prüfen oder „Andere Ebene“."
                    % (s.name, round(100 * unter / len(s))))
        elif werkzeug == "ebene3":
            p = d.get("punkte") or []
            if len(p) != 3:
                raise Fehler("Bitte genau 3 Punkte setzen.")
            n, dd = wz.ebene_aus_punkten(*p)
            if d.get("umdrehen"):
                n, dd = -n, -dd
            m = wz.seite_der_ebene(s.xyz, n, dd, zahl(d, "versatz", 0))
            extra[s.id] = {"normale": n.tolist(), "d": dd}
        elif werkzeug == "statistisch":
            m = wz.ausreisser_statistisch(s, int(zahl(d, "nachbarn")), zahl(d, "sigma"))
        elif werkzeug == "radius":
            m = wz.ausreisser_radius(s, zahl(d, "radius"), int(zahl(d, "min_punkte")))
        elif werkzeug == "inseln":
            m = wz.kleine_inseln(s, zahl(d, "abstand"), zahl(d, "anteil"))
        else:
            raise Fehler("Unbekanntes Werkzeug %s" % werkzeug)
        masken[s.id] = m
    vorschau_cache.clear()
    vorschau_cache[schluessel] = (masken, extra)
    return masken, extra


NAMEN = {"tisch": "Tisch entfernt", "ebene3": "Schnittebene", "statistisch":
         "Ausreißer entfernt", "radius": "Ausreißer entfernt", "inseln":
         "Kleine Inseln entfernt"}


# --- Befehle -------------------------------------------------------------------
def befehl(name, d):
    p = projekt
    if name == "zustand":
        return {}
    if name == "scan/setzen":
        s = p.scan(d["id"])
        if "sichtbar" in d:
            s.sichtbar = bool(d["sichtbar"])
        if "fest" in d:
            for andere in p.scans.values():
                andere.fest = False
            s.fest = bool(d["fest"])
        if d.get("name"):
            s.name = str(d["name"])[:120]
        if d.get("farbe"):
            s.farbe = str(d["farbe"])[:9]
        return {}
    if name == "scan/entfernen":
        p.entfernen(d["id"])
        return {}
    if name == "rueckgaengig":
        return {"text": p.rueckgaengig()}
    if name == "wiederholen":
        return {"text": p.wiederholen()}
    if name == "auswahl/loeschen":
        return {"geloescht": p.loeschen(masken_lesen(d))}
    if name == "auswahl/abtrennen":
        neu = p.abtrennen(masken_lesen(d))
        return {"neu": neu.id if neu else None}
    if name == "auswahl/verbunden":
        s = p.scan(d["id"])
        idx = int(d["index"])
        if not 0 <= idx < len(s):
            raise Fehler("Punkt nicht gefunden.")
        return {"maske": maske_b64(wz.verbunden(s, idx, zahl(d, "abstand")))}
    if name == "info/punktabstand":
        s = p.scan(d["id"])
        return {"abstand": round(wz.punktabstand(s), 4)}

    if name == "bereinigen/vorschau":
        masken, extra = bereinigen_masken(d)
        return {"masken": {sid: maske_b64(m) for sid, m in masken.items()},
                "anzahl": int(sum(m.sum() for m in masken.values())),
                "extra": extra}
    if name == "bereinigen/anwenden":
        masken, _ = bereinigen_masken(d)
        vorschau_cache.clear()
        return {"geloescht": p.loeschen(masken, NAMEN.get(d.get("werkzeug"), "Bereinigt"))}

    if name in ("ausduennen/vorschau", "ausduennen/anwenden"):
        voxel = zahl(d, "voxel")
        if voxel <= 0:
            raise Fehler("Voxelgröße muss größer als 0 sein.")
        vorher = nachher = 0
        for s in ziel_scans(d):
            neu = wz.ausduennen(s, voxel)
            vorher += len(s)
            nachher += len(neu)
            if name.endswith("anwenden"):
                p.ersetzen(s.id, neuer_scan=neu, text="Ausgedünnt (%.2f mm)" % voxel)
        return {"vorher": vorher, "nachher": nachher}

    if name == "normalen":
        for s in ziel_scans(d):
            nrm = wz.normalen_berechnen(s, zahl(d, "radius"), int(zahl(d, "nachbarn", 30)),
                                        d.get("ausrichtung", "aussen"))
            p.ersetzen(s.id, nrm=nrm, text="Normalen berechnet")
        return {}

    if name.startswith("ausrichten/"):
        return ausrichten(name.split("/", 1)[1], d)

    if name == "zusammenfuehren":
        neu = p.zusammenfuehren([int(i) for i in d.get("ids") or []],
                                zahl(d, "voxel", 0))
        return {"neu": neu.id, "anzahl": len(neu)}
    raise Fehler("Unbekannter Befehl %s" % name)


def ausrichten(was, d):
    p = projekt
    if was == "anwenden":
        matrizen = {int(k): v for k, v in (d.get("matrizen") or {}).items()}
        if not matrizen:
            raise Fehler("Keine Ausrichtung zum Anwenden.")
        p.transformieren(matrizen, d.get("text") or "Ausgerichtet")
        return {}
    if was == "global":
        scans = ziel_scans(d)
        return rg.global_ausrichten(scans, zahl(d, "voxel"), zahl(d, "fang"))

    bewegt, fest = p.scan(d.get("bewegt")), p.scan(d.get("fest"))
    if bewegt.id == fest.id:
        raise Fehler("Bewegter und fester Scan sind derselbe.")
    if was == "auto":
        grob = rg.grob_automatisch(bewegt, fest, zahl(d, "voxel"))
        fein = rg.fein_icp(bewegt, fest, zahl(d, "fang"), start=grob["matrix"],
                           voxel=zahl(d, "voxel") / 2)
        fein["grob"] = grob
        return fein
    if was == "paare":
        ergebnis = rg.aus_punktpaaren(d.get("punkte_bewegt"), d.get("punkte_fest"))
        if d.get("icp"):
            fein = rg.fein_icp(bewegt, fest, zahl(d, "fang"), start=ergebnis["matrix"],
                               voxel=zahl(d, "voxel"))
            fein["paare"] = ergebnis
            return fein
        return ergebnis
    if was == "icp":
        return rg.fein_icp(bewegt, fest, zahl(d, "fang"),
                           iterationen=int(zahl(d, "iterationen", 60)),
                           methode=d.get("methode", "ebene"), start=d.get("start"),
                           voxel=zahl(d, "voxel"))
    if was == "abweichung":
        abst = rg.abweichung(bewegt, fest, d.get("matrix"))
        return {"werte": base64.b64encode(abst.astype(np.float32).tobytes()).decode(),
                "median": round(float(np.median(abst)), 4) if len(abst) else 0,
                "p95": round(float(np.percentile(abst, 95)), 4) if len(abst) else 0}
    raise Fehler("Unbekannter Ausrichte-Befehl %s" % was)


# --- HTTP -------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "V3DScan/" + FASSUNG

    def log_message(self, fmt, *args):
        if "/api/puls" not in (args[0] if args else ""):
            sys.stderr.write("%s %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    def _senden(self, code, daten, typ="application/json; charset=utf-8", kopf=None):
        if isinstance(daten, (dict, list)):
            daten = json.dumps(daten, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(daten)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (kopf or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(daten)

    def _fehler(self, e):
        text = str(e) if isinstance(e, (Fehler, ValueError, KeyError)) else \
            "Interner Fehler: %s" % e
        if isinstance(e, KeyError) and e.args:
            text = str(e.args[0])
        if not isinstance(e, (Fehler, ValueError, KeyError)):
            traceback.print_exc()
        self._senden(400, {"fehler": text})

    def _koerper(self):
        n = int(self.headers.get("Content-Length") or 0)
        daten = bytearray()
        while len(daten) < n:
            stueck = self.rfile.read(min(4 << 20, n - len(daten)))
            if not stueck:
                break
            daten += stueck
        return bytes(daten)

    def _lokal(self):
        # Nur fuer Aufrufe vom eigenen Rechner gedacht; fremde Host-Header
        # (DNS-Rebinding) abweisen.
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("127.0.0.1", "localhost")

    def do_GET(self):
        if not self._lokal():
            return self._senden(403, {"fehler": "nur lokal"})
        url = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(url.query))
        pfad = url.path
        try:
            if pfad == "/api/puls":
                letzter_puls[0] = time.time()
                return self._senden(200, {"ok": True, "fassung": FASSUNG})
            if pfad == "/api/zustand":
                with sperre:
                    return self._senden(200, dict(projekt.zustand(), fassung=FASSUNG,
                                                  formate=list(AUSGEBBAR)))
            if pfad.startswith("/api/punkte/"):
                with sperre:
                    s = projekt.scan(pfad.rsplit("/", 1)[1])
                    daten = _punkte_binaer(s)
                return self._senden(200, daten, "application/octet-stream",
                                    {"X-Rev": str(s.rev)})
            if pfad.startswith("/api/export/"):
                fmt = q.get("format", "ply")
                with sperre:
                    s = projekt.scan(pfad.rsplit("/", 1)[1])
                    with tempfile.TemporaryDirectory() as tmp:
                        datei = os.path.join(tmp, "x." + fmt)
                        ausgeben(s, datei, fmt)
                        with open(datei, "rb") as f:
                            daten = f.read()
                name = os.path.splitext(s.name)[0] + "." + fmt
                return self._senden(200, daten, "application/octet-stream", {
                    "Content-Disposition": "attachment; filename*=UTF-8''"
                    + urllib.parse.quote(name)})
            if pfad == "/api/projekt/speichern":
                with sperre:
                    daten = projekt.speichern()
                return self._senden(200, daten, "application/octet-stream", {
                    "Content-Disposition": "attachment; filename=\"projekt.v3dscan\""})
            return self._datei(pfad)
        except Exception as e:
            self._fehler(e)

    def _datei(self, pfad):
        if pfad in ("", "/"):
            pfad = "/index.html"
        voll = os.path.normpath(os.path.join(WEB, pfad.lstrip("/")))
        if not voll.startswith(os.path.normpath(WEB) + os.sep) or not os.path.isfile(voll):
            return self._senden(404, {"fehler": "nicht gefunden"})
        typ = mimetypes.guess_type(voll)[0] or "application/octet-stream"
        if voll.endswith(".js"):
            typ = "text/javascript; charset=utf-8"
        with open(voll, "rb") as f:
            self._senden(200, f.read(), typ)

    def do_POST(self):
        global projekt
        if not self._lokal():
            return self._senden(403, {"fehler": "nur lokal"})
        url = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(url.query))
        pfad = url.path
        try:
            if pfad == "/api/import":
                name = os.path.basename(q.get("name") or "scan.ply")
                daten = self._koerper()
                with tempfile.TemporaryDirectory() as tmp:
                    datei = os.path.join(tmp, "import" + os.path.splitext(name)[1].lower())
                    with open(datei, "wb") as f:
                        f.write(daten)
                    scan = einlesen(datei, name)
                with sperre:
                    projekt.hinzufuegen(scan)
                    return self._senden(200, dict(projekt.zustand(), neu=scan.id))
            if pfad == "/api/projekt/laden":
                daten = self._koerper()
                neu = Projekt.laden(daten)
                with sperre:
                    projekt = neu
                    vorschau_cache.clear()
                    return self._senden(200, projekt.zustand())
            if pfad == "/api/projekt/neu":
                with sperre:
                    projekt = Projekt()
                    vorschau_cache.clear()
                    return self._senden(200, projekt.zustand())
            if pfad.startswith("/api/"):
                roh = self._koerper()
                d = json.loads(roh.decode("utf-8")) if roh else {}
                t = time.time()
                with sperre:
                    ergebnis = befehl(pfad[5:], d)
                    ergebnis["zustand"] = projekt.zustand()
                ergebnis["dauer"] = round(time.time() - t, 2)
                return self._senden(200, ergebnis)
            self._senden(404, {"fehler": "nicht gefunden"})
        except Exception as e:
            self._fehler(e)


def browser_oeffnen(url):
    """Unter Windows als eigenes App-Fenster (Edge/Chrome --app), sonst Browser."""
    if os.name == "nt":
        import subprocess
        kandidaten = []
        for basis in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"),
                      os.environ.get("LOCALAPPDATA")):
            if basis:
                kandidaten += [os.path.join(basis, "Microsoft", "Edge", "Application",
                                            "msedge.exe"),
                               os.path.join(basis, "Google", "Chrome", "Application",
                                            "chrome.exe")]
        for exe in kandidaten:
            if os.path.isfile(exe):
                try:
                    subprocess.Popen([exe, "--app=" + url, "--new-window"])
                    return
                except OSError:
                    pass
    import webbrowser
    webbrowser.open(url)


def waechter(max_stille):
    """Beendet den Dienst, wenn die Oberflaeche geschlossen wurde (kein Puls)."""
    while True:
        time.sleep(5)
        if letzter_puls[0] and time.time() - letzter_puls[0] > max_stille:
            os._exit(0)


def main():
    ap = argparse.ArgumentParser(description="V3D Scan")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8797)
    ap.add_argument("--browser", action="store_true")
    ap.add_argument("--auto-ende", type=int, default=0,
                    help="Sekunden ohne Puls bis zum Beenden (0 = nie)")
    ap.add_argument("--laden", nargs="*", default=[], help="Dateien beim Start laden")
    a = ap.parse_args()
    for datei in a.laden:
        projekt.hinzufuegen(einlesen(datei), merken=False)
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    srv.daemon_threads = True
    url = "http://127.0.0.1:%d/" % a.port
    print("V3D Scan %s läuft auf %s" % (FASSUNG, url))
    if a.auto_ende:
        threading.Thread(target=waechter, args=(a.auto_ende,), daemon=True).start()
    if a.browser:
        threading.Timer(0.3, browser_oeffnen, args=(url,)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
