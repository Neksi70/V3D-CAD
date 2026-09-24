#!/usr/bin/env python3
"""Mini-Server für V3D CAM — 3D-CAM für Fräsen (Rohteil, Schruppen, G-Code).

GET  /                → v3dcam.html
GET  /cam-kern.js     → ~/cam-kern.js — EINE QUELLE, kein Abzug. Derselbe
                        Rechenkern, den V3D CAD benutzt; siehe Kopf jener Datei.
GET  /lib/…           → three.min.js, manifold.js/.wasm aus ~/lib
POST /api/step        → STEP (Rohbytes) → Binär-STL über das lokale OCCT-Backend

Läuft nur auf 127.0.0.1 (öffentlich später über den Funnel-Pfad /cam).
Start: python3 server.py [port]"""
import http.server, json, os, ssl, sys, threading, urllib.request

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8803
BASE = os.path.dirname(os.path.abspath(__file__))
HEIM = os.path.dirname(BASE)                      # ~ — dort liegen cam-kern.js und lib/
OCCT = "https://127.0.0.1:3001/api/occt-step2stl"
MAX_STEP = 80 * 1024 * 1024
STEP_SLOTS = threading.BoundedSemaphore(2)        # V3D CAD soll den OCCT-Pool behalten
SSL_CTX = ssl._create_unverified_context()

# Nur diese Pfade gehen raus. Der Kern und die Bibliotheken liegen bewusst
# AUSSERHALB dieses Ordners — kopiert wird nichts, sonst driften die Fassungen.
ERLAUBT = {
    "/v3dcam.html":       (os.path.join(BASE, "v3dcam.html"), "text/html; charset=utf-8"),
    "/cam-kern.js":       (os.path.join(HEIM, "cam-kern.js"), "text/javascript; charset=utf-8"),
    "/lib/three.min.js":  (os.path.join(HEIM, "lib/three.min.js"), "text/javascript; charset=utf-8"),
    "/lib/manifold.js":   (os.path.join(HEIM, "lib/manifold.js"), "text/javascript; charset=utf-8"),
    "/lib/manifold.wasm": (os.path.join(HEIM, "lib/manifold.wasm"), "application/wasm"),
}


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body, ctype, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _err(self, code, msg):
        self._send(code, json.dumps({"error": msg}).encode(), "application/json; charset=utf-8")

    def do_GET(self):
        pfad = self.path.split("?")[0]
        if pfad == "/":
            pfad = "/v3dcam.html"
        eintrag = ERLAUBT.get(pfad)
        if not eintrag:
            return self._err(404, "Nicht gefunden")
        datei, ctype = eintrag
        if not os.path.exists(datei):
            return self._err(503, "Fehlt: " + os.path.basename(datei))
        with open(datei, "rb") as f:
            self._send(200, f.read(), ctype)

    def do_POST(self):
        if self.path.split("?")[0] != "/api/step":
            return self._err(404, "Nicht gefunden")
        laenge = int(self.headers.get("Content-Length") or 0)
        if laenge <= 0 or laenge > MAX_STEP:
            return self._err(413, "STEP-Datei fehlt oder ist zu groß")
        roh = self.rfile.read(laenge)
        # Das OCCT-Backend teilt sich V3D CAD; mehr als zwei Auftraege parallel
        # wuerden dort die Warteschlange fuer den Editor zustellen.
        if not STEP_SLOTS.acquire(blocking=False):
            return self._err(503, "Gerade zu viele STEP-Aufträge — gleich nochmal")
        try:
            import base64
            anfrage = urllib.request.Request(
                OCCT, data=json.dumps({"stepBase64": base64.b64encode(roh).decode()}).encode(),
                headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(anfrage, timeout=300, context=SSL_CTX) as a:
                antwort = json.loads(a.read().decode())
            if antwort.get("error"):
                return self._err(502, "OCCT: " + str(antwort["error"])[:300])
            stl = base64.b64decode(antwort["stlBase64"])
            self._send(200, stl, "application/octet-stream")
        except Exception as e:
            self._err(502, "OCCT nicht erreichbar: " + str(e)[:200])
        finally:
            STEP_SLOTS.release()

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("V3D CAM auf http://127.0.0.1:%d" % PORT, flush=True)
    srv.serve_forever()
