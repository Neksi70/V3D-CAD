#!/usr/bin/env python3
"""Mini-Server fuer V3D Licht.

Liefert app.html auf jedem Pfad aus, dazu die drei Dateien, die das Handy
braucht, um die Seite wie eine App zu behandeln: Manifest, Symbol und einen
kleinen Service Worker (damit das Werkzeug im Keller ohne Netz laeuft).
Laeuft nur auf 127.0.0.1. Start: python3 server.py [port]
"""
import http.server, os, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8793
BASE = os.path.dirname(os.path.abspath(__file__))

MANIFEST = """{
  "name": "V3D Licht — Lichtplanung",
  "short_name": "V3D Licht",
  "description": "Licht planen, messen und dem Kunden zeigen",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0b0f16",
  "theme_color": "#0b0f16",
  "icons": [
    {"src": "icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable"}
  ]
}"""

ICON = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
<defs><radialGradient id="g" cx="50%" cy="38%" r="62%">
<stop offset="0" stop-color="#2a3242"/><stop offset="1" stop-color="#0b0f16"/></radialGradient>
<linearGradient id="l" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#ffe9a8"/><stop offset="1" stop-color="#ff9d1c"/></linearGradient></defs>
<rect width="192" height="192" rx="42" fill="url(#g)"/>
<circle cx="96" cy="82" r="52" fill="#ffc233" opacity=".18"/>
<path d="M96 30a40 40 0 0 0-24 72c4 3 6 8 6.7 12.7l.7 8.7h33.2l.7-8.7c.7-4.7 2.7-9.7 6.7-12.7A40 40 0 0 0 96 30z"
      fill="url(#l)"/>
<path d="M78 138h36M82 152h28" stroke="#ffe9a8" stroke-width="9" stroke-linecap="round"/>
</svg>"""

SW = """// V3D Licht — haelt die App offline verfuegbar (Netz zuerst, Kopie als Rueckfall)
const CACHE = 'v3dlicht-1';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n))))
    .then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(a => {
      const kopie = a.clone();
      caches.open(CACHE).then(c => c.put(e.request, kopie));
      return a;
    }).catch(() => caches.match(e.request).then(t => t || caches.match('./')))
  );
});"""

EXTRA = {
    "manifest.webmanifest": ("application/manifest+json", MANIFEST),
    "icon.svg": ("image/svg+xml", ICON),
    "sw.js": ("text/javascript; charset=utf-8", SW),
}


class Handler(http.server.BaseHTTPRequestHandler):
    def _sende(self, typ, body, cache="no-cache"):
        body = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(200)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        if self.path.rstrip("/").endswith("sw.js"):
            self.send_header("Service-Worker-Allowed", "/")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        name = self.path.split("?")[0].rstrip("/").rsplit("/", 1)[-1]
        if name in EXTRA:
            typ, inhalt = EXTRA[name]
            self._sende(typ, inhalt)
            return
        try:
            with open(os.path.join(BASE, "app.html"), "rb") as f:
                body = f.read()
        except OSError:
            self.send_error(500, "app.html fehlt")
            return
        self._sende("text/html; charset=utf-8", body)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("V3D Licht auf http://127.0.0.1:%d" % PORT, flush=True)
    srv.serve_forever()
