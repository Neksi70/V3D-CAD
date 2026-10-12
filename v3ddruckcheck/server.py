#!/usr/bin/env python3
"""Mini-Server für V3D Druckcheck (alles läuft im Browser, hier nur Auslieferung).

GET  /                       → index.html
GET  …/v3d-druckcheck.html   → dieselbe Datei als Download (offline per Doppelklick nutzbar)
Läuft nur auf 127.0.0.1 (öffentlich über den Funnel-Pfad /druckcheck).
Start: python3 server.py [port]"""
import http.server, os, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8810
BASE = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        pfad = os.path.join(BASE, "index.html")
        if not os.path.exists(pfad):
            body, code, ctype = b"Noch nicht gebaut: python3 bauen.py", 503, "text/plain; charset=utf-8"
        else:
            with open(pfad, "rb") as f:
                body, code, ctype = f.read(), 200, "text/html; charset=utf-8"
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        if self.path.split("?")[0].endswith("v3d-druckcheck.html"):
            self.send_header("Content-Disposition", 'attachment; filename="V3D-Druckcheck.html"')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
