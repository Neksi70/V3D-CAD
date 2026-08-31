#!/usr/bin/env python3
"""Kleiner APK-Verteiler für den Funnel-Pfad :10000/apk (Port 8779).

Serviert nur .apk-Dateien aus diesem Ordner plus eine Übersichtsseite.
Der Funnel schneidet das /apk-Präfix ab, hier kommt also / an.
"""
import html
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8779


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        pfad = self.path.split('?', 1)[0].lstrip('/')
        if pfad in ('', 'index.html'):
            return self.uebersicht()
        name = os.path.basename(pfad)  # keine Unterordner, kein ..
        voll = os.path.join(ROOT, name)
        if not name.endswith('.apk') or not os.path.isfile(voll):
            self.send_error(404)
            return
        with open(voll, 'rb') as f:
            daten = f.read()
        self.send_response(200)
        self.send_header('Content-Type', 'application/vnd.android.package-archive')
        self.send_header('Content-Disposition', f'attachment; filename="{name}"')
        self.send_header('Content-Length', str(len(daten)))
        self.end_headers()
        self.wfile.write(daten)

    def uebersicht(self):
        zeilen = []
        for name in sorted(os.listdir(ROOT)):
            if not name.endswith('.apk'):
                continue
            mb = os.path.getsize(os.path.join(ROOT, name)) / 1e6
            n = html.escape(name)
            zeilen.append(f'<li><a href="{n}">{n}</a> <small>({mb:.1f} MB)</small></li>')
        seite = ('<!doctype html><meta charset="utf-8">'
                 '<meta name="viewport" content="width=device-width, initial-scale=1">'
                 '<title>Volme 3D — Apps</title>'
                 '<body style="font-family:sans-serif;background:#1c2030;color:#eee;'
                 'max-width:32em;margin:3em auto;padding:0 1em">'
                 '<h1>Volme 3D — Apps</h1><ul style="line-height:2">'
                 + '\n'.join(zeilen) +
                 '</ul><p><small>Installation: Datei antippen, „Unbekannte Apps '
                 'installieren" für den Browser erlauben.</small></p>').encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(seite)))
        self.end_headers()
        self.wfile.write(seite)

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
