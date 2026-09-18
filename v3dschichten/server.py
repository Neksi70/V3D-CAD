#!/usr/bin/env python3
"""Mini-Server für V3D Schichthöhe: liefert die gebaute index.html aus.
…/v3d-schichten.html = dieselbe Datei als Download (Offline-Version).
Läuft nur auf 127.0.0.1 (öffentlich über den Funnel-Pfad /schichten).
Start: python3 server.py [port]"""
import http.server, os, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8798
BASE = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        pfad = os.path.join(BASE, "index.html")
        if not os.path.exists(pfad):
            self.send_error(503, "Noch nicht gebaut: python3 bauen.py")
            return
        with open(pfad, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        if self.path.split("?")[0].endswith("v3d-schichten.html"):
            self.send_header("Content-Disposition", 'attachment; filename="V3D-Schichthoehe.html"')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("V3D Schichthöhe auf http://127.0.0.1:%d" % PORT, flush=True)
    srv.serve_forever()
