#!/usr/bin/env python3
# Kleiner Ausliefer-Dienst fuer VolmeInventar.exe.
#
# Laeuft nur auf 127.0.0.1; oeffentlich erreichbar wird er ueber den
# Tailscale-Funnel unter /inventar.
#
# Der Dienst ist bewusst PFAD-UNABHAENGIG gebaut.  Der Funnel schneidet den
# Praefix ab: die Seite liegt fuer den Besucher unter /inventar, hier kommt
# sie als "/" an.  Ein Verweis, den wir aus dem Anfragepfad bauen, zeigt
# deshalb auf "/VolmeInventar.exe" - und damit im Browser am Dienst vorbei.
#
# Loesung: der Download haengt an der ABFRAGE ("?laden=1"), nicht am Pfad.
# Die loest der Browser gegen die aktuelle Adresse auf, der Praefix bleibt
# also erhalten, egal wie der Dienst eingehaengt ist.  Der Dateiname kommt
# ueber Content-Disposition.  Zusaetzlich bleibt ".../VolmeInventar.exe"
# gueltig, damit sich auch eine saubere Adresse weitergeben laesst.

import hashlib
import http.server
import os
import time
import urllib.parse

PORT = 8784
BASIS = os.path.dirname(os.path.abspath(__file__))
DATEI = os.path.join(BASIS, "dist", "VolmeInventar.exe")
NAME = "VolmeInventar.exe"

# Pruefsumme ist teuer (10 MB lesen) - also merken und nur neu bilden, wenn
# sich die Datei geaendert hat.  Sonst rechnet jeder Seitenaufruf mit.
_merk = {"stempel": None, "pruefsumme": None}


def datei_angaben():
    try:
        zustand = os.stat(DATEI)
    except OSError:
        return None
    stempel = (zustand.st_mtime, zustand.st_size)
    if _merk["stempel"] != stempel:
        h = hashlib.sha256()
        with open(DATEI, "rb") as f:
            for brocken in iter(lambda: f.read(1 << 20), b""):
                h.update(brocken)
        _merk["stempel"] = stempel
        _merk["pruefsumme"] = h.hexdigest()
    return {
        "groesse": zustand.st_size,
        "geaendert": time.localtime(zustand.st_mtime),
        "pruefsumme": _merk["pruefsumme"],
    }


SEITE = """<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VolmeInventar herunterladen</title>
<style>
:root {{ --grund:#f6f7f9; --karte:#fff; --linie:#dfe3e8; --schrift:#1b1f24;
  --leise:#5b6672; --betont:#0b6bcb; }}
@media (prefers-color-scheme: dark) {{
  :root {{ --grund:#15181c; --karte:#1d2126; --linie:#2f353c; --schrift:#e8eaed;
    --leise:#9aa4b0; --betont:#6ba8f5; }}
}}
* {{ box-sizing:border-box; }}
body {{ margin:0; padding:32px 20px; background:var(--grund);
  color:var(--schrift); font:16px/1.6 "Segoe UI",system-ui,sans-serif;
  display:flex; justify-content:center; }}
.blatt {{ width:100%; max-width:620px; }}
h1 {{ font-size:26px; margin:0 0 6px; }}
.unter {{ color:var(--leise); margin:0 0 26px; }}
.karte {{ background:var(--karte); border:1px solid var(--linie);
  border-radius:12px; padding:22px; margin-bottom:18px; }}
a.laden {{ display:inline-block; background:var(--betont); color:#fff;
  text-decoration:none; padding:13px 26px; border-radius:9px;
  font-weight:600; font-size:17px; }}
a.laden:hover {{ filter:brightness(1.1); }}
dl {{ display:grid; grid-template-columns:auto 1fr; gap:6px 16px;
  margin:18px 0 0; font-size:14px; }}
dt {{ color:var(--leise); }}
dd {{ margin:0; font-family:Consolas,ui-monospace,monospace;
  word-break:break-all; }}
ul {{ margin:8px 0 0; padding-left:22px; }}
li {{ margin-bottom:5px; }}
.fuss {{ color:var(--leise); font-size:13px; text-align:center;
  margin-top:26px; }}
.fehlt {{ color:#b3261e; font-weight:600; }}
</style></head><body><div class="blatt">
<h1>VolmeInventar</h1>
<p class="unter">Liest aus, welche Programme auf einem Windows-11-Rechner
installiert sind und welche Verknuepfungen angelegt wurden.</p>
<div class="karte">
{download}
</div>
<div class="karte">
<b>So geht's</b>
<ul>
<li>Datei herunterladen und doppelt anklicken - keine Installation noetig.</li>
<li>Windows meldet sich beim ersten Start mit "Computer geschuetzt"
    (die Datei ist nicht signiert): <i>Weitere Informationen</i> &rarr;
    <i>Trotzdem ausfuehren</i>.</li>
<li>Administratorrechte braucht das Programm nicht. Es wird nur gelesen -
    nichts installiert, nichts veraendert, nichts gesendet.</li>
<li>Windows-eigene Programme zaehlen nicht mit; der Schalter oben im
    Fenster holt sie bei Bedarf zurueck.</li>
</ul>
</div>
<div class="fuss">Volme3D &middot; VolmeInventar</div>
</div></body></html>
"""


def _menge(bytes_):
    return f"{bytes_ / 1048576:.1f} MB".replace(".", ",")


class Ausliefern(http.server.BaseHTTPRequestHandler):
    server_version = "VolmeInventar"

    def _kopf(self, code, art, laenge, dateiname=None):
        self.send_response(code)
        self.send_header("Content-Type", art)
        self.send_header("Content-Length", str(laenge))
        if dateiname:
            self.send_header("Content-Disposition",
                             f'attachment; filename="{dateiname}"')
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

    def _seite(self):
        angaben = datei_angaben()
        if not angaben:
            block = ('<p class="fehlt">Die Datei steht gerade nicht bereit.</p>'
                     '<p>Vermutlich laeuft ein neuer Bau. Bitte spaeter noch '
                     'einmal versuchen.</p>')
        else:
            # Reine Abfrage als Verweis: der Browser loest sie gegen die
            # aktuelle Adresse auf und behaelt den Praefix bei, ohne dass der
            # Dienst ihn kennen muss.
            block = (
                f'<a class="laden" href="?laden=1" download="{NAME}">'
                f'{NAME} herunterladen</a>'
                f'<dl>'
                f'<dt>Groesse</dt><dd>{_menge(angaben["groesse"])}</dd>'
                f'<dt>Stand</dt><dd>'
                f'{time.strftime("%d.%m.%Y %H:%M", angaben["geaendert"])}</dd>'
                f'<dt>SHA-256</dt><dd>{angaben["pruefsumme"]}</dd>'
                f'</dl>')
        return SEITE.format(download=block).encode("utf-8")

    def do_HEAD(self):
        self.do_GET(nur_kopf=True)

    def do_GET(self, nur_kopf=False):
        zerlegt = urllib.parse.urlparse(self.path)
        pfad = zerlegt.path
        gewuenscht = "laden" in urllib.parse.parse_qs(zerlegt.query)
        if gewuenscht or pfad.rstrip("/").endswith(NAME):
            angaben = datei_angaben()
            if not angaben:
                text = b"Datei nicht verfuegbar"
                self._kopf(503, "text/plain; charset=utf-8", len(text))
                if not nur_kopf:
                    self.wfile.write(text)
                return
            self._kopf(200, "application/octet-stream", angaben["groesse"],
                       dateiname=NAME)
            if nur_kopf:
                return
            with open(DATEI, "rb") as f:
                # Haeppchenweise senden: 10 MB am Stueck in den Speicher zu
                # legen ist unnoetig, und ein Abbruch der Gegenseite soll den
                # Dienst nicht mitreissen.
                try:
                    while True:
                        brocken = f.read(1 << 16)
                        if not brocken:
                            break
                        self.wfile.write(brocken)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            return
        seite = self._seite()
        self._kopf(200, "text/html; charset=utf-8", len(seite))
        if not nur_kopf:
            self.wfile.write(seite)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT),
                                    Ausliefern).serve_forever()
