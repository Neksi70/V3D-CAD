#!/usr/bin/env python3
"""Statischer Server fuer Ballast mit No-Cache-Headern (Handys cachen sonst alte Staende)."""
import functools
import http.server

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

http.server.ThreadingHTTPServer(
    ('0.0.0.0', 8773),  # auch im Tailnet erreichbar (http://100.125.34.44:8773)
    functools.partial(Handler, directory='/home/v3da/ballast')
).serve_forever()
