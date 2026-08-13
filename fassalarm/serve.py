#!/usr/bin/env python3
"""Statischer Server fuer Fass-Alarm mit No-Cache-Headern (Handys cachen sonst alte Staende)."""
import functools
import http.server

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

http.server.ThreadingHTTPServer(
    ('127.0.0.1', 8771),
    functools.partial(Handler, directory='/home/v3da/fassalarm')
).serve_forever()
