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
import platform
import shutil
import sys
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.parse
from urllib.parse import urlparse, parse_qs, unquote

# In einer gebauten EXE liegen die Dateien im Auspackordner von PyInstaller
BASIS = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASIS)
import vstick        # noqa: E402
import unattend      # noqa: E402
import download      # noqa: E402
import linuxisos     # noqa: E402
import bestand       # noqa: E402
import isowriter     # noqa: E402

def _standard_ordner():
    """Abbilder gehoeren dorthin, wo gearbeitet wird. Auf einem Server soll
    ohnehin nichts liegen - der liefert nur die App aus."""
    fuer_downloads = os.path.expanduser("~/Downloads")
    if os.path.isdir(fuer_downloads):
        return os.path.join(fuer_downloads, "VolmeStick")
    return os.path.expanduser("~/VolmeStick-Abbilder")


ISO_ORDNER = _standard_ordner()
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


def _bestandsuebersicht():
    """Was liegt hier gerade herum - damit man es im Blick behaelt und
    mit einem Klick wieder los wird."""
    eintraege = []
    for ordner in (ISO_ORDNER, AUSGABE_ORDNER):
        if not os.path.isdir(ordner):
            continue
        for name in sorted(os.listdir(ordner)):
            if not name.lower().endswith((".iso", ".img", ".teil",
                                          ".unvollstaendig")):
                continue
            pfad = os.path.join(ordner, name)
            eintraege.append({"name": name, "pfad": pfad,
                              "groesse": os.path.getsize(pfad),
                              "gebaut": ordner == AUSGABE_ORDNER})
    frei = shutil.disk_usage(ISO_ORDNER if os.path.isdir(ISO_ORDNER)
                             else os.path.expanduser("~")).free
    return {"dateien": eintraege,
            "belegt": sum(e["groesse"] for e in eintraege),
            "frei": frei, "ordner": ISO_ORDNER}


def _aufraeumen(namen=None):
    """namen=None raeumt alles ab."""
    entfernt = []
    for e in _bestandsuebersicht()["dateien"]:
        if namen and e["name"] not in namen:
            continue
        try:
            os.remove(e["pfad"])
            entfernt.append(e["name"])
        except OSError:
            pass
    return entfernt, _bestandsuebersicht()["frei"]


def _ferner_bestand(adresse):
    """ISO-Liste eines anderen VolmeStick holen - so kommt der Windows-Rechner
    an die Abbilder, die schon auf dem Server liegen."""
    import urllib.request
    if not adresse:
        raise vstick.Fehler("Keine Adresse angegeben")
    if not adresse.startswith(("http://", "https://")):
        adresse = "http://" + adresse
    adresse = adresse.rstrip("/")
    try:
        with urllib.request.urlopen(adresse + "/api/isos", timeout=15) as a:
            daten = json.loads(a.read().decode("utf-8"))
    except Exception as e:
        raise vstick.Fehler(f"{adresse} antwortet nicht: {e}")
    return [{"name": i["name"],
             "uri": f"{adresse}/api/holen/{urllib.parse.quote(i['name'])}",
             "groesse": i.get("groesse"),
             "quelle": "server"}
            for i in daten.get("isos", [])]


def _abgleichen(dateien):
    """Was liegt schon in ~/isos? Erspart den zweiten 7-GB-Download."""
    return bestand.abgleichen(
        dateien, [ISO_ORDNER, AUSGABE_ORDNER],
        groesse_holen=lambda uri: download.ferngroesse(uri))


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


# Aus der Ferne bedienbar ist alles, was Dateiarbeit ist. Gesperrt bleibt nur,
# was die Datentraeger DIESES Rechners anfasst - ein USB-Stick gehoert an den
# Rechner, an dem man sitzt.
FERN_GESPERRT = {"/api/stick", "/api/blockpruefung", "/api/geraete"}
FERNZUGRIFF = False


# Startdatei fuer Windows. Holt sich Adminrechte (ohne die darf Windows keinen
# Datentraeger neu aufteilen) und startet die Oberflaeche im Browser.
STARTER_MIT_PYTHON = """@echo off
title VolmeStick
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Starte mit Administratorrechten neu ...
  powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
  exit /b
)
echo VolmeStick startet - der Browser oeffnet sich gleich.
echo Dieses Fenster bitte offen lassen, es ist der Dienst.
runtime\\python.exe server.py --host 127.0.0.1 --port 8775 --browser
echo.
echo VolmeStick wurde beendet.
pause
"""

STARTER_OHNE_PYTHON = """@echo off
title VolmeStick
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -Verb RunAs -FilePath '%~f0'"
  exit /b
)
where python >nul 2>&1 || (
  echo In diesem Paket fehlt die Python-Laufzeit und auf dem Rechner ist
  echo ebenfalls keine installiert. Bitte das Paket erneut herunterladen.
  pause
  exit /b 1
)
python server.py --host 127.0.0.1 --port 8775 --browser
pause
"""


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class Griff(BaseHTTPRequestHandler):
    server_version = "VolmeStick"

    def log_message(self, format, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    # -- Hilfen
    def _ist_lokal(self):
        return self.client_address[0] in ("127.0.0.1", "::1", "localhost")

    def _darf(self, pfad):
        if FERNZUGRIFF or self._ist_lokal() or pfad not in FERN_GESPERRT:
            return True
        self._json({"fehler":
                    "Datentraeger lassen sich nur an dem Rechner beschreiben, an "
                    "dem sie stecken. Dafuer bitte VolmeStick auf dem eigenen "
                    "Rechner starten - das Paket dazu gibt es ueber den Knopf oben."},
                   403)
        return False

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
            if not self._darf(pfad):
                return
            if pfad in ("/", "/index.html"):
                return self._datei(os.path.join(BASIS, "web", "ui.html"),
                                   "text/html; charset=utf-8")
            if pfad in ("/paket", "/paket.html"):
                return self._datei(os.path.join(BASIS, "web", "verteil.html"),
                                   "text/html; charset=utf-8")
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
                name = os.path.basename(unquote(pfad.rsplit("/", 1)[-1]))
                danach_weg = parse_qs(weg.query).get("aufraeumen", ["0"])[0] == "1"
                for ordner in (AUSGABE_ORDNER, ISO_ORDNER):
                    ziel = os.path.join(ordner, name)
                    if os.path.isfile(ziel):
                        self._datei(ziel)
                        if danach_weg:
                            # Heruntergeladen heisst: hier nicht mehr gebraucht.
                            try:
                                os.remove(ziel)
                            except OSError:
                                pass
                        return
                self.send_error(404)
                return
            if pfad == "/api/quelle/winfuture":
                return self._json({"eintraege": download.winfuture_seiten()})
            if pfad == "/api/quelle/server":
                adresse = parse_qs(weg.query).get("adresse", [""])[0]
                return self._json({"eintraege": [{"id": adresse or "",
                                                  "name": "Bestand auf " + (adresse or "?")}]})
            if pfad == "/api/quelle/linux":
                return self._json({"eintraege": linuxisos.distributionen()})
            if pfad == "/api/windows-paket":
                return self._paket()
            if pfad == "/api/exe":
                exe = os.path.join(BASIS, "build", "VolmeStick.exe")
                if not os.path.isfile(exe):
                    return self._fehler("Es liegt keine gebaute EXE bereit", 404)
                return self._datei(exe, "application/octet-stream")
            if pfad == "/api/bestand":
                return self._json(_bestandsuebersicht())
            if pfad == "/api/werkzeuge":
                return self._json({
                    "rechner": platform.node(),
                    "lokal": self._ist_lokal() or FERNZUGRIFF,
                    "xorriso": bool(vstick._xorriso()),
                    "system": "Windows" if vstick.IST_WINDOWS else "Linux",
                    "root": (os.name != "nt" and os.geteuid() == 0),
                })
            self.send_error(404)
        except (vstick.Fehler, download.DownloadFehler,
                linuxisos.QuellenFehler) as e:
            self._fehler(e)
        except Exception as e:
            traceback.print_exc()
            self._fehler(e, 500)

    LAUFZEIT = os.path.expanduser("~/.cache/volmestick/python-embed-amd64.zip")
    LAUFZEIT_QUELLE = ("https://www.python.org/ftp/python/3.12.10/"
                       "python-3.12.10-embed-amd64.zip")

    def _laufzeit(self):
        """Eingebettetes Windows-Python beilegen, damit auf dem Zielrechner
        nichts installiert werden muss. Wird einmal geholt und gemerkt."""
        if os.path.isfile(self.LAUFZEIT):
            return self.LAUFZEIT
        try:
            import urllib.request
            os.makedirs(os.path.dirname(self.LAUFZEIT), exist_ok=True)
            vorlaeufig = self.LAUFZEIT + ".teil"
            with urllib.request.urlopen(self.LAUFZEIT_QUELLE, timeout=60) as a, \
                    open(vorlaeufig, "wb") as f:
                shutil.copyfileobj(a, f)
            os.replace(vorlaeufig, self.LAUFZEIT)
            return self.LAUFZEIT
        except Exception as e:
            sys.stderr.write(f"Laufzeit nicht ladbar: {e}\n")
            return None

    def _paket(self):
        """Alles, was der Windows-Rechner braucht, als ZIP - mitsamt Python,
        damit ein Doppelklick genuegt."""
        import io
        import zipfile
        dateien = ["vstick.py", "unattend.py", "iso9660.py", "isowriter.py",
                   "isopatch.py", "wim.py", "download.py", "linuxisos.py",
                   "bestand.py", "server.py", "LIESMICH.md", "start.sh",
                   "web/ui.html", "web/verteil.html",
                   "windows/vstick_gui.pyw", "windows/EXE-bauen.bat"]
        if getattr(sys, "frozen", False):
            return self._json({"fehler":
                               "Diese Fassung laeuft bereits auf deinem Rechner - "
                               "das Paket wird hier nicht gebraucht."}, 400)
        puffer = io.BytesIO()
        with zipfile.ZipFile(puffer, "w", zipfile.ZIP_DEFLATED) as z:
            for name in dateien:
                voll = os.path.join(BASIS, name)
                if os.path.isfile(voll):
                    z.write(voll, "VolmeStick/" + name)

            laufzeit = self._laufzeit()
            if laufzeit:
                with zipfile.ZipFile(laufzeit) as lz:
                    for eintrag in lz.namelist():
                        inhalt = lz.read(eintrag)
                        if eintrag.endswith("._pth"):
                            # Bei eingebettetem Python bestimmt diese Datei den
                            # GESAMTEN Suchpfad - das Skriptverzeichnis kommt
                            # nicht von selbst dazu. ".." ist der Ordner
                            # darueber, in dem VolmeStick liegt.
                            erste = inhalt.decode().splitlines()[0].strip()
                            inhalt = (erste + "\r\n.\r\n..\r\n").encode()
                        z.writestr("VolmeStick/runtime/" + eintrag, inhalt)
                z.writestr("VolmeStick/VolmeStick starten.bat", STARTER_MIT_PYTHON)
            else:
                z.writestr("VolmeStick/VolmeStick starten.bat", STARTER_OHNE_PYTHON)

        roh = puffer.getvalue()
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Length", str(len(roh)))
        self.send_header("Content-Disposition",
                         'attachment; filename="VolmeStick.zip"')
        self.end_headers()
        self.wfile.write(roh)

    # -- POST
    def do_POST(self):
        weg = urlparse(self.path).path
        try:
            if not self._darf(weg):
                return
            if weg == "/api/analyse":
                d = self._koerper()
                return self._json(vstick.analysiere(erlaubter_pfad(d.get("pfad", ""))))

            if weg == "/api/xml":
                d = self._koerper()
                opt = d.get("optionen") or {}
                return self._json({"xml": unattend.baue_unattend(opt),
                                   "zusammenfassung": unattend.zusammenfassung(opt)})

            if weg == "/api/aufraeumen":
                d = self._koerper()
                namen = d.get("namen")
                entfernt, frei = _aufraeumen(namen)
                return self._json({"entfernt": entfernt, "frei": frei})

            if weg == "/api/antwort-iso":
                import tempfile
                d = self._koerper()
                xml = unattend.baue_unattend(d.get("optionen") or {})
                with tempfile.TemporaryDirectory() as tmp:
                    ziel = os.path.join(tmp, "autounattend.iso")
                    isowriter.antwort_iso(ziel, xml)
                    roh = open(ziel, "rb").read()
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(roh)))
                self.send_header("Content-Disposition",
                                 'attachment; filename="autounattend.iso"')
                self.end_headers()
                self.wfile.write(roh)
                return

            if weg == "/api/iso":
                d = self._koerper()
                quelle = erlaubter_pfad(d.get("pfad", ""))
                os.makedirs(AUSGABE_ORDNER, exist_ok=True)
                name = os.path.basename(d.get("ziel") or "").strip()
                if not name.lower().endswith(".iso"):
                    grund = os.path.splitext(os.path.basename(quelle))[0]
                    name = f"{grund}-v3d.iso"
                ziel = os.path.join(AUSGABE_ORDNER, name)
                quelle_weg = bool(d.get("quelle_loeschen"))

                def bauen(f):
                    r = vstick.baue_iso(quelle, ziel, d.get("optionen") or {}, f)
                    if quelle_weg:
                        try:
                            os.remove(quelle)
                            r["quelle_entfernt"] = os.path.basename(quelle)
                        except OSError:
                            pass
                    return r

                kennung = auftrag_neu("iso")
                auftrag_laufen(kennung, bauen)
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

            if weg == "/api/quelle/dateien":
                d = self._koerper()
                quelle, kennung = d.get("quelle"), str(d.get("id", ""))
                if quelle == "server":
                    dateien = _ferner_bestand(kennung)
                elif quelle == "winfuture":
                    dateien = download.winfuture_dateien(kennung)
                elif quelle == "linux":
                    dateien = linuxisos.dateien(kennung)
                else:
                    return self._fehler("Unbekannte Quelle")
                return self._json({"dateien": _abgleichen(dateien)})

            if weg == "/api/laden":
                d = self._koerper()
                uri = d.get("uri", "")
                if not uri.startswith("https://"):
                    return self._fehler("Ungueltige Adresse")
                kennung = auftrag_neu("download")
                auftrag_laufen(kennung, lambda f: download.herunterladen(
                    uri, ISO_ORDNER, d.get("name"), f,
                    referer=d.get("referer"), sha256=d.get("sha256") or None))
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
        except (vstick.Fehler, download.DownloadFehler,
                linuxisos.QuellenFehler) as e:
            self._fehler(e)
        except Exception as e:
            traceback.print_exc()
            self._fehler(e, 500)


def main():
    global ISO_ORDNER, AUSGABE_ORDNER, FERNZUGRIFF
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8775)
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--isos", default=ISO_ORDNER)
    p.add_argument("--fernzugriff", action="store_true",
                   help="Auch aus dem Netz voll bedienbar (dann werden die "
                        "Datentraeger DIESES Rechners angeboten)")
    p.add_argument("--browser", action="store_true",
                   help="Oberflaeche gleich im Browser oeffnen (lokaler Betrieb)")
    a = p.parse_args()
    FERNZUGRIFF = a.fernzugriff
    ISO_ORDNER = os.path.expanduser(a.isos)
    AUSGABE_ORDNER = os.path.join(ISO_ORDNER, "fertig")
    os.makedirs(AUSGABE_ORDNER, exist_ok=True)
    try:
        srv = Server((a.host, a.port), Griff)
    except OSError as e:
        if e.errno == 98:
            print(f"Port {a.port} ist schon belegt. Wer da lauscht:")
            os.system(f"ss -ltnp 2>/dev/null | grep ':{a.port} ' || true")
            print(f"Entweder den laufenden VolmeStick benutzen "
                  f"(http://localhost:{a.port}) oder mit --port einen anderen waehlen.")
            return 1
        raise
    print(f"VolmeStick laeuft auf http://{a.host}:{a.port}  (ISOs: {ISO_ORDNER})")
    print(f"Datentraeger dieses Rechners ({platform.node()}) werden bedient - "
          "ein USB-Stick muss HIER stecken.")
    print("Aufrufe aus dem Netz bekommen nur die Startseite mit dem Paket zum "
          "Selberstarten." if not FERNZUGRIFF else
          "ACHTUNG: --fernzugriff ist an, das Netz darf diesen Rechner voll bedienen.")
    if a.browser:
        import webbrowser
        webbrowser.open(f"http://localhost:{a.port}/")
    if not vstick._xorriso():
        print("Hinweis: xorriso fehlt - ISO-Bau nur eingeschraenkt. "
              "sudo apt install xorriso")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nBeendet.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
