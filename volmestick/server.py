#!/usr/bin/env python3
# VolmeStick - Weboberflaeche (Standard: Port 8775).
#
# ACHTUNG: Dieses Werkzeug kann Datentraeger loeschen. Es gehoert ins
# Heimnetz/Tailnet - NICHT in den Tailscale-Funnel.
#
#   python3 server.py [--port 8775] [--host 0.0.0.0] [--isos ~/isos]

import argparse
import json
import mimetypes
import os
import shutil
import sys
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

BASIS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASIS)
import vstick        # noqa: E402
import unattend      # noqa: E402
import download      # noqa: E402

ISO_ORDNER = os.path.expanduser("~/isos")
AUSGABE_ORDNER = os.path.join(ISO_ORDNER, "fertig")
AUFTRAEGE = {}
SPERRE = threading.Lock()


def auftrag_neu(art):
    kennung = uuid.uuid4().hex[:12]
    with SPERRE:
        AUFTRAEGE[kennung] = {"art": art, "prozent": 0, "text": "wartet ...",
                              "fertig": False, "fehler": "", "ergebnis": None,
                              "protokoll": [], "start": time.time()}
    return kennung


def auftrag_melden(kennung, prozent, text=""):
    with SPERRE:
        a = AUFTRAEGE.get(kennung)
        if not a:
            return
        a["prozent"] = int(prozent)
        if text:
            a["text"] = text
            if not a["protokoll"] or a["protokoll"][-1] != text:
                a["protokoll"].append(text)
                del a["protokoll"][:-200]


def auftrag_laufen(kennung, funktion):
    def arbeit():
        try:
            ergebnis = funktion(lambda p, t="": auftrag_melden(kennung, p, t))
            with SPERRE:
                AUFTRAEGE[kennung].update(fertig=True, prozent=100,
                                          ergebnis=ergebnis, text="Fertig")
        except Exception as e:
            with SPERRE:
                AUFTRAEGE[kennung].update(fertig=True, fehler=str(e),
                                          text="Fehler: " + str(e))
            traceback.print_exc()
    threading.Thread(target=arbeit, daemon=True).start()


def isos_auflisten():
    treffer = []
    for ordner in (ISO_ORDNER, AUSGABE_ORDNER):
        if not os.path.isdir(ordner):
            continue
        for name in sorted(os.listdir(ordner)):
            if not name.lower().endswith(".iso"):
                continue
            pfad = os.path.join(ordner, name)
            treffer.append({"name": name, "pfad": pfad,
                            "groesse": os.path.getsize(pfad),
                            "ausgabe": ordner == AUSGABE_ORDNER})
    return treffer


def erlaubter_pfad(pfad):
    """Nur ISOs aus den bekannten Ordnern oder aus dem Heimverzeichnis."""
    p = os.path.realpath(os.path.expanduser(pfad))
    heim = os.path.realpath(os.path.expanduser("~"))
    if not p.lower().endswith(".iso"):
        raise vstick.Fehler("Nur .iso-Dateien")
    if not (p.startswith(heim) or p.startswith("/mnt/") or p.startswith("/media/")):
        raise vstick.Fehler("Pfad ausserhalb des erlaubten Bereichs")
    if not os.path.isfile(p):
        raise vstick.Fehler(f"Nicht gefunden: {p}")
    return p


class Griff(BaseHTTPRequestHandler):
    server_version = "VolmeStick"

    def log_message(self, format, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    # -- Hilfen
    def _json(self, daten, code=200):
        roh = json.dumps(daten, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(roh)))
        self.end_headers()
        self.wfile.write(roh)

    def _fehler(self, text, code=400):
        self._json({"fehler": str(text)}, code)

    def _koerper(self):
        laenge = int(self.headers.get("Content-Length") or 0)
        if laenge <= 0:
            return {}
        return json.loads(self.rfile.read(laenge) or b"{}")

    def _datei(self, pfad, typ=None):
        if not os.path.isfile(pfad):
            self.send_error(404)
            return
        typ = typ or (mimetypes.guess_type(pfad)[0] or "application/octet-stream")
        groesse = os.path.getsize(pfad)
        self.send_response(200)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(groesse))
        if typ == "application/octet-stream":
            self.send_header("Content-Disposition",
                             f'attachment; filename="{os.path.basename(pfad)}"')
        self.end_headers()
        with open(pfad, "rb") as f:
            shutil.copyfileobj(f, self.wfile, 1024 * 1024)

    # -- GET
    def do_GET(self):
        weg = urlparse(self.path)
        pfad = weg.path
        try:
            if pfad in ("/", "/index.html"):
                return self._datei(os.path.join(BASIS, "web", "ui.html"), "text/html; charset=utf-8")
            if pfad == "/api/isos":
                return self._json({"isos": isos_auflisten(), "ordner": ISO_ORDNER})
            if pfad == "/api/geraete":
                alle = parse_qs(weg.query).get("alle", ["0"])[0] == "1"
                return self._json({"geraete": vstick.geraete(alle=alle),
                                   "root": (os.name != "nt" and os.geteuid() == 0)})
            if pfad.startswith("/api/status/"):
                kennung = pfad.rsplit("/", 1)[-1]
                with SPERRE:
                    a = AUFTRAEGE.get(kennung)
                if not a:
                    return self._fehler("Unbekannter Auftrag", 404)
                return self._json(a)
            if pfad.startswith("/api/holen/"):
                name = unquote(pfad.rsplit("/", 1)[-1])
                ziel = os.path.join(AUSGABE_ORDNER, os.path.basename(name))
                return self._datei(ziel)
            if pfad == "/api/ms/ausgaben":
                produkt = parse_qs(weg.query).get("produkt", ["windows11"])[0]
                return self._json({"ausgaben": download.ausgaben(produkt)})
            if pfad == "/api/werkzeuge":
                return self._json({
                    "xorriso": bool(vstick._xorriso()),
                    "system": "Windows" if vstick.IST_WINDOWS else "Linux",
                    "root": (os.name != "nt" and os.geteuid() == 0),
                })
            self.send_error(404)
        except (vstick.Fehler, download.DownloadFehler) as e:
            self._fehler(e)
        except Exception as e:
            traceback.print_exc()
            self._fehler(e, 500)

    # -- POST
    def do_POST(self):
        weg = urlparse(self.path).path
        try:
            if weg == "/api/analyse":
                d = self._koerper()
                return self._json(vstick.analysiere(erlaubter_pfad(d.get("pfad", ""))))

            if weg == "/api/xml":
                d = self._koerper()
                opt = d.get("optionen") or {}
                return self._json({"xml": unattend.baue_unattend(opt),
                                   "zusammenfassung": unattend.zusammenfassung(opt)})

            if weg == "/api/iso":
                d = self._koerper()
                quelle = erlaubter_pfad(d.get("pfad", ""))
                os.makedirs(AUSGABE_ORDNER, exist_ok=True)
                name = os.path.basename(d.get("ziel") or "").strip()
                if not name.lower().endswith(".iso"):
                    grund = os.path.splitext(os.path.basename(quelle))[0]
                    name = f"{grund}-v3d.iso"
                ziel = os.path.join(AUSGABE_ORDNER, name)
                kennung = auftrag_neu("iso")
                auftrag_laufen(kennung, lambda f: vstick.baue_iso(
                    quelle, ziel, d.get("optionen") or {}, f))
                return self._json({"auftrag": kennung, "ziel": os.path.basename(ziel)})

            if weg == "/api/stick":
                d = self._koerper()
                quelle = erlaubter_pfad(d.get("pfad", ""))
                geraet = d.get("geraet", "")
                if d.get("bestaetigung") != "loeschen":
                    return self._fehler("Bestaetigung fehlt")
                kennung = auftrag_neu("stick")
                auftrag_laufen(kennung, lambda f: vstick.stick_schreiben(
                    quelle, geraet, d.get("optionen") or {}, f,
                    erzwingen=bool(d.get("erzwingen")),
                    label=(d.get("label") or "V3D_WIN"),
                    modus=(d.get("modus") or "auto"),
                    schema=(d.get("schema") or "gpt"),
                    dateisystem=(d.get("dateisystem") or "auto"),
                    schnell=d.get("schnell", True)))
                return self._json({"auftrag": kennung})

            if weg == "/api/pruefsumme":
                d = self._koerper()
                quelle = erlaubter_pfad(d.get("pfad", ""))
                kennung = auftrag_neu("pruefsumme")
                auftrag_laufen(kennung, lambda f: vstick.pruefsummen(quelle, f))
                return self._json({"auftrag": kennung})

            if weg == "/api/blockpruefung":
                d = self._koerper()
                if d.get("bestaetigung") != "loeschen":
                    return self._fehler("Bestaetigung fehlt")
                kennung = auftrag_neu("blockpruefung")
                auftrag_laufen(kennung, lambda f: vstick.blockpruefung(
                    d.get("geraet", ""), f, int(d.get("durchgaenge") or 1),
                    bool(d.get("gruendlich")), bool(d.get("erzwingen"))))
                return self._json({"auftrag": kennung})

            if weg == "/api/ms/sprachen":
                d = self._koerper()
                sid, liste = download.sprachen(d.get("ausgabe"), d.get("produkt", "windows11"))
                return self._json({"sitzung": sid, "sprachen": liste})

            if weg == "/api/ms/links":
                d = self._koerper()
                return self._json({"links": download.links(
                    d.get("sitzung"), d.get("sprache"), d.get("produkt", "windows11"))})

            if weg == "/api/ms/laden":
                d = self._koerper()
                uri = d.get("uri", "")
                if not uri.startswith("https://"):
                    return self._fehler("Ungueltige Adresse")
                kennung = auftrag_neu("download")
                auftrag_laufen(kennung, lambda f: download.herunterladen(
                    uri, ISO_ORDNER, d.get("name"), f))
                return self._json({"auftrag": kennung})

            if weg == "/api/hochladen":
                name = os.path.basename(unquote(self.headers.get("X-Dateiname", "")))
                if not name.lower().endswith(".iso"):
                    return self._fehler("Nur .iso-Dateien")
                os.makedirs(ISO_ORDNER, exist_ok=True)
                ziel = os.path.join(ISO_ORDNER, name)
                laenge = int(self.headers.get("Content-Length") or 0)
                rest = laenge
                with open(ziel, "wb") as f:
                    while rest > 0:
                        block = self.rfile.read(min(4 * 1024 * 1024, rest))
                        if not block:
                            break
                        f.write(block)
                        rest -= len(block)
                if rest > 0:
                    os.remove(ziel)
                    return self._fehler("Uebertragung abgebrochen")
                return self._json({"pfad": ziel, "groesse": os.path.getsize(ziel)})

            self.send_error(404)
        except (vstick.Fehler, download.DownloadFehler) as e:
            self._fehler(e)
        except Exception as e:
            traceback.print_exc()
            self._fehler(e, 500)


def main():
    global ISO_ORDNER, AUSGABE_ORDNER
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8775)
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--isos", default=ISO_ORDNER)
    a = p.parse_args()
    ISO_ORDNER = os.path.expanduser(a.isos)
    AUSGABE_ORDNER = os.path.join(ISO_ORDNER, "fertig")
    os.makedirs(AUSGABE_ORDNER, exist_ok=True)
    srv = ThreadingHTTPServer((a.host, a.port), Griff)
    print(f"VolmeStick laeuft auf http://{a.host}:{a.port}  (ISOs: {ISO_ORDNER})")
    if not vstick._xorriso():
        print("Hinweis: xorriso fehlt - ISO-Bau nur eingeschraenkt. "
              "sudo apt install xorriso")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
