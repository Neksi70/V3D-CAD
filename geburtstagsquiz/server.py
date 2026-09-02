#!/usr/bin/env python3
"""Mini-Server fuer das Geburtstags-Quiz: liefert index.html auf jedem Pfad aus.
Laeuft nur auf 127.0.0.1. Start: python3 server.py [port]"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8785
BASE = os.path.dirname(os.path.abspath(__file__))


def seite():
    """Auslieferung bevorzugen: index.live.html traegt die echten, persoenlichen
    Daten und ist nicht versioniert; index.html ist die Arbeitskopie mit Beispiel."""
    live = os.path.join(BASE, "index.live.html")
    return live if os.path.exists(live) else os.path.join(BASE, "index.html")


# Zum Herunterladen des QR-Codes. Auf Endung geprueft, nicht auf den ganzen
# Pfad — der Funnel schneidet das Praefix /geburtstag ab, lokal fehlt es ohnehin.
DATEIEN = {
    "qr.png": ("quiz-qr.png", "image/png"),
    "qr.svg": ("quiz-qr.svg", "image/svg+xml"),
}


class QuizHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        name = self.path.split("?")[0].rstrip("/").rsplit("/", 1)[-1].lower()
        if name in DATEIEN:
            return self.datei(*DATEIEN[name])
        with open(seite(), "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def datei(self, dateiname, typ):
        pfad = os.path.join(BASE, dateiname)
        if not os.path.exists(pfad):
            self.send_error(404, "nicht vorhanden: %s" % dateiname)
            return
        with open(pfad, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Disposition", 'attachment; filename="%s"' % dateiname)
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), QuizHandler).serve_forever()
