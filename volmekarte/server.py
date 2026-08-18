#!/usr/bin/env python3
"""VolmeKarte - Weboberflaeche (Standard: Port 8785).

Klappkarten und Postkarten drucken, ohne sich mit dem Ausschiessen zu
plagen: Masse eingeben, Bilder und Text setzen, PDF erzeugen.

  python3 server.py [--port 8785] [--host 127.0.0.1] [--browser]
"""

import argparse
import json
import mimetypes
import os
import platform
import re
import subprocess
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

BASIS = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASIS)

import karte      # noqa: E402
import render     # noqa: E402

FASSUNG = "1.0"
WEB = os.path.join(BASIS, "web")

# Anfragen mit eingebetteten Bildern werden gross - aber nicht beliebig.
GRENZE_BYTES = 160 * 1024 * 1024


def _ausgabeordner():
    heim = os.path.expanduser("~")
    dl = os.path.join(heim, "Downloads")
    if os.path.isdir(dl):
        return os.path.normpath(os.path.join(dl, "VolmeKarte"))
    return os.path.normpath(os.path.join(heim, "VolmeKarte"))


ORDNER = _ausgabeordner()
ENTWUERFE = os.path.join(ORDNER, "Entwürfe")

# Gaengige Bogen- und Kartenformate. Millimeter, immer Breite x Hoehe.
VORLAGEN = [
    {"name": "A6 Klappkarte hoch (aus A5, Querfalz)",
     "bogen": [148, 210], "falz": "quer"},
    {"name": "A6 Klappkarte quer (aus A5, Längsfalz)",
     "bogen": [210, 148], "falz": "laengs"},
    {"name": "A5 Klappkarte hoch (aus A4, Längsfalz)",
     "bogen": [297, 210], "falz": "laengs"},
    {"name": "A5 Klappkarte quer (aus A4, Querfalz)",
     "bogen": [210, 297], "falz": "quer"},
    {"name": "DIN lang Klappkarte (aus A4, Querfalz)",
     "bogen": [210, 297], "falz": "quer", "karte": [210, 105]},
    {"name": "Quadratisch 145 mm (aus 290 × 145, Längsfalz)",
     "bogen": [290, 145], "falz": "laengs"},
    {"name": "Klappkarte 100 × 150 (Bogen 200 × 150, Längsfalz)",
     "bogen": [200, 150], "falz": "laengs"},
    {"name": "Klappkarte 200 × 150 (Bogen 200 × 300, Querfalz)",
     "bogen": [200, 300], "falz": "quer"},
    {"name": "Postkarte A6 flach (aus A6)",
     "bogen": [148, 105], "falz": "keine"},
    {"name": "Postkarte DIN lang flach",
     "bogen": [210, 105], "falz": "keine"},
]


def _oeffnen(pfad, drucken=False):
    """Datei mit dem Standardprogramm oeffnen bzw. drucken."""
    try:
        if platform.system() == "Windows":
            if drucken:
                try:
                    os.startfile(pfad, "print")     # noqa: E1101
                    return True, ""
                except Exception:
                    os.startfile(pfad)              # noqa: E1101
                    return True, ("Der Drucken-Befehl war nicht verfügbar – "
                                  "das PDF wurde stattdessen geöffnet.")
            os.startfile(pfad)                      # noqa: E1101
            return True, ""
        befehl = "xdg-open" if platform.system() != "Darwin" else "open"
        subprocess.Popen([befehl, pfad],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True, ""
    except Exception as fehler:
        return False, str(fehler)


def _sauberer_name(name, standard="Karte"):
    name = re.sub(r"[^\w \-.äöüÄÖÜß]", "", str(name or "")).strip()
    return (name or standard)[:60]


def _aufbau_aus(daten):
    a = daten.get("aufbau") or {}
    return karte.Aufbau(
        bogen_b=a.get("bogen_b", 210), bogen_h=a.get("bogen_h", 297),
        falz=a.get("falz", "quer"), falz_pos=a.get("falz_pos"),
        wenden=a.get("wenden", "lang"),
        karte_b=a.get("karte_b"), karte_h=a.get("karte_h"),
        versatz_x=a.get("versatz_x", 0), versatz_y=a.get("versatz_y", 0))


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class Griff(BaseHTTPRequestHandler):
    server_version = "VolmeKarte/" + FASSUNG
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        if os.environ.get("VOLMEKARTE_LEISE"):
            return
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    # -- Antworten -----------------------------------------------------
    def _senden(self, kode, koerper, art="application/json; charset=utf-8",
                kopf=None):
        if isinstance(koerper, str):
            koerper = koerper.encode("utf-8")
        self.send_response(kode)
        self.send_header("Content-Type", art)
        self.send_header("Content-Length", str(len(koerper)))
        self.send_header("Cache-Control", "no-store")
        for k, w in (kopf or {}).items():
            self.send_header(k, w)
        self.end_headers()
        try:
            self.wfile.write(koerper)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, daten, kode=200):
        self._senden(kode, json.dumps(daten, ensure_ascii=False))

    def _fehler(self, text, kode=400):
        self._json({"fehler": str(text)}, kode)

    def _koerper(self):
        laenge = int(self.headers.get("Content-Length") or 0)
        if laenge <= 0:
            return {}
        if laenge > GRENZE_BYTES:
            raise ValueError("Die Anfrage ist zu groß (über %d MB). Bitte "
                             "kleinere Bilder verwenden."
                             % (GRENZE_BYTES // (1024 * 1024)))
        roh = bytearray()
        rest = laenge
        while rest > 0:
            teil = self.rfile.read(min(rest, 1 << 20))
            if not teil:
                break
            roh += teil
            rest -= len(teil)
        return json.loads(bytes(roh).decode("utf-8"))

    # -- GET -----------------------------------------------------------
    def do_GET(self):
        pfad = unquote(urlparse(self.path).path)
        try:
            if pfad in ("/", "/index.html"):
                return self._datei(os.path.join(WEB, "ui.html"))
            if pfad == "/api/werkzeuge":
                return self._json({"fassung": FASSUNG, "name": "VolmeKarte",
                                   "ordner": ORDNER,
                                   "system": platform.system()})
            if pfad == "/api/vorlagen":
                return self._json({"vorlagen": VORLAGEN})
            if pfad == "/api/entwuerfe":
                return self._json({"entwuerfe": self._entwurfsliste()})
            if pfad.startswith("/api/entwurf/"):
                return self._entwurf_lesen(pfad[len("/api/entwurf/"):])
            if pfad.startswith("/web/"):
                ziel = os.path.normpath(os.path.join(WEB, pfad[5:]))
                if ziel.startswith(WEB):
                    return self._datei(ziel)
            self._fehler("Nicht gefunden: " + pfad, 404)
        except Exception as fehler:
            traceback.print_exc()
            self._fehler(fehler, 500)

    def _datei(self, pfad):
        if not os.path.isfile(pfad):
            return self._fehler("Datei fehlt: " + os.path.basename(pfad), 404)
        art = mimetypes.guess_type(pfad)[0] or "application/octet-stream"
        if art.startswith("text/") or art.endswith("javascript"):
            art += "; charset=utf-8"
        with open(pfad, "rb") as f:
            self._senden(200, f.read(), art)

    def _entwurfsliste(self):
        if not os.path.isdir(ENTWUERFE):
            return []
        aus = []
        for name in sorted(os.listdir(ENTWUERFE)):
            if not name.endswith(".vkarte.json"):
                continue
            voll = os.path.join(ENTWUERFE, name)
            aus.append({"name": name[:-len(".vkarte.json")],
                        "groesse": os.path.getsize(voll),
                        "geaendert": os.path.getmtime(voll)})
        aus.sort(key=lambda e: e["geaendert"], reverse=True)
        return aus

    def _entwurf_lesen(self, name):
        name = _sauberer_name(name)
        pfad = os.path.join(ENTWUERFE, name + ".vkarte.json")
        if not os.path.isfile(pfad):
            return self._fehler("Entwurf nicht gefunden: " + name, 404)
        with open(pfad, "rb") as f:
            self._senden(200, f.read(), "application/json; charset=utf-8")

    # -- POST ----------------------------------------------------------
    def do_POST(self):
        pfad = unquote(urlparse(self.path).path)
        try:
            daten = self._koerper()
        except ValueError as fehler:
            return self._fehler(fehler, 413)
        except Exception as fehler:
            return self._fehler("Anfrage nicht lesbar: %s" % fehler, 400)

        try:
            if pfad == "/api/plan":
                return self._plan(daten)
            if pfad == "/api/pdf":
                return self._pdf(daten)
            if pfad == "/api/testdruck":
                return self._testdruck(daten)
            if pfad == "/api/entwurf":
                return self._entwurf_schreiben(daten)
            if pfad == "/api/beenden":
                self._json({"ok": True})
                threading.Timer(0.4, lambda: os._exit(0)).start()
                return
            self._fehler("Unbekannter Aufruf: " + pfad, 404)
        except ValueError as fehler:
            self._fehler(fehler, 400)
        except Exception as fehler:
            traceback.print_exc()
            self._fehler(fehler, 500)

    def _plan(self, daten):
        """Die Anordnung fuer die Vorschau „so kommt es aus dem Drucker“."""
        auf = _aufbau_aus(daten)
        return self._json({
            "bogen": [auf.bogen_b, auf.bogen_h],
            "karte": [auf.karte_b, auf.karte_h],
            "falz": auf.falz,
            "falz_pos": auf.falz_pos,
            "falzlinie": auf.falzlinie(),
            "rueckseite_drehen": auf.rueckseite_drehen,
            "seiten": auf.anordnung(),
            "panels": [{"kennung": k, "name": auf.beschriftung(k)}
                       for k in auf.panels()],
            "druckfolge": [{"kennung": k, "name": auf.beschriftung(k)}
                           for k in auf.druckfolge()],
            "einlegefolge": auf.einlegefolge(),
            "hinweis": auf.einlegehinweis(),
        })

    def _schreiben(self, name, roh):
        os.makedirs(ORDNER, exist_ok=True)
        pfad = os.path.join(ORDNER, name)
        with open(pfad, "wb") as f:
            f.write(roh)
        return pfad

    def _pdf(self, daten):
        auf = _aufbau_aus(daten)
        panels = daten.get("panels") or {}
        name = _sauberer_name(daten.get("dateiname"), "Karte")
        einzeln = bool(daten.get("einzelseiten"))
        roh = render.bauen(auf, panels,
                           hilfslinien=bool(daten.get("hilfslinien", True)),
                           titel=name, einzelseiten=einzeln)
        pfad = self._schreiben(
            "%s_%s.pdf" % (name, time.strftime("%Y-%m-%d_%H%M%S")), roh)
        anmerkung = ""
        if daten.get("drucken"):
            ok, anmerkung = _oeffnen(pfad, drucken=True)
        elif daten.get("oeffnen", True):
            ok, anmerkung = _oeffnen(pfad)
        hinweis = auf.einlegehinweis()
        if einzeln:
            hinweis = ("Je Panel eine Seite in %g × %g mm, einseitig drucken. "
                       % (auf.karte_b, auf.karte_h)
                       + " | ".join(auf.einlegefolge())
                       + " | Erst einmal auf normalem Papier proben – wie "
                         "herum der Drucker einzieht, ist von Gerät zu Gerät "
                         "verschieden.")
        self._json({"ok": True, "pfad": pfad, "groesse": len(roh),
                    "hinweis": hinweis, "anmerkung": anmerkung})

    def _testdruck(self, daten):
        auf = _aufbau_aus(daten)
        roh = render.testdruck(auf)
        pfad = self._schreiben("Testdruck_%s.pdf"
                               % time.strftime("%Y-%m-%d_%H%M%S"), roh)
        anmerkung = ""
        if daten.get("oeffnen", True):
            ok, anmerkung = _oeffnen(pfad)
        self._json({"ok": True, "pfad": pfad, "hinweis": auf.einlegehinweis(),
                    "anmerkung": anmerkung})

    def _entwurf_schreiben(self, daten):
        name = _sauberer_name(daten.get("name"), "Entwurf")
        os.makedirs(ENTWUERFE, exist_ok=True)
        pfad = os.path.join(ENTWUERFE, name + ".vkarte.json")
        with open(pfad, "w", encoding="utf-8") as f:
            json.dump(daten.get("entwurf") or {}, f, ensure_ascii=False)
        self._json({"ok": True, "pfad": pfad, "name": name})


def main():
    p = argparse.ArgumentParser(description="VolmeKarte")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8785)
    p.add_argument("--browser", action="store_true")
    args = p.parse_args()

    os.makedirs(ORDNER, exist_ok=True)
    srv = Server((args.host, args.port), Griff)
    adresse = "http://%s:%d/" % (
        "localhost" if args.host in ("0.0.0.0", "127.0.0.1") else args.host,
        args.port)
    print("VolmeKarte %s läuft auf %s" % (FASSUNG, adresse))
    print("Ausgabeordner: %s" % ORDNER)
    if args.browser:
        import webbrowser
        threading.Timer(0.6, lambda: webbrowser.open(adresse)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nBeendet.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
