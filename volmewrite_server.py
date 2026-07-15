#!/usr/bin/env python3
"""Liefert volmewrite.html aus — für den Funnel-Pfad /schreiben (Port 8772)."""
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8772
FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'volmewrite.html')


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            with open(FILE, 'rb') as f:
                data = f.read()
        except OSError:
            self.send_error(500, 'volmewrite.html nicht lesbar')
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(data)

    def do_HEAD(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()

    def log_message(self, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


if __name__ == '__main__':
    with Server(('127.0.0.1', PORT), Handler) as srv:
        print(f'VolmeWrite auf http://127.0.0.1:{PORT}')
        srv.serve_forever()
