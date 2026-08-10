#!/usr/bin/env python3
"""Mini-Server fuer das Fragenquiz: liefert index.html auf jedem Pfad aus.
Laeuft nur auf 127.0.0.1, oeffentlich via Tailscale Funnel unter /quiz."""
import http.server
import os

PORT = 8769
BASE = os.path.dirname(os.path.abspath(__file__))

class QuizHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        with open(os.path.join(BASE, "index.html"), "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass

if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), QuizHandler)
    server.serve_forever()
