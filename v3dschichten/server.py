#!/usr/bin/env python3
"""Mini-Server für V3D Schichthöhe.

GET  /                       → index.html (Online-Version, klein)
GET  …/v3d-schichten.html    → offline.html als Download (eine Datei inkl. STEP-Leser)
POST …/api/step              → STEP (Rohbytes) → Binär-STL über das lokale OCCT-Backend
                               (fein vernetzt, damit die Krümmung erkannt wird)
Läuft nur auf 127.0.0.1 (öffentlich über den Funnel-Pfad /schichten).
Start: python3 server.py [port]"""
import base64, http.server, json, os, ssl, sys, threading, urllib.request

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8798
BASE = os.path.dirname(os.path.abspath(__file__))
OCCT = "https://127.0.0.1:3001/api/occt-step2stl"
MAX_STEP = 80 * 1024 * 1024
# öffentliches Tool: höchstens 2 STEP-Aufträge gleichzeitig, damit V3D CAD den Pool behält
STEP_SLOTS = threading.BoundedSemaphore(2)
SSL_CTX = ssl._create_unverified_context()   # Backend hat ein Zertifikat für den ts.net-Namen


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
        offline = self.path.split("?")[0].endswith("v3d-schichten.html")
        pfad = os.path.join(BASE, "offline.html" if offline else "index.html")
        if not os.path.exists(pfad):
            return self._err(503, "Noch nicht gebaut: python3 bauen.py")
        with open(pfad, "rb") as f:
            body = f.read()
        extra = {"Content-Disposition": 'attachment; filename="V3D-Schichthoehe.html"'} if offline else None
        self._send(200, body, "text/html; charset=utf-8", extra)

    def do_POST(self):
        if not self.path.split("?")[0].endswith("/api/step"):
            return self._err(404, "unbekannt")
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return self._err(400, "Keine Datei")
        if n > MAX_STEP:
            return self._err(413, "STEP-Datei zu groß (max. 80 MB)")
        data = self.rfile.read(n)
        if not STEP_SLOTS.acquire(timeout=60):
            return self._err(503, "Server ausgelastet — bitte gleich noch einmal")
        try:
            req = urllib.request.Request(OCCT, json.dumps({
                "stepBase64": base64.b64encode(data).decode(),
                "linDeflection": 0.02, "angDeflection": 0.1,
            }).encode(), {"Content-Type": "application/json"})
            with urllib.request.urlopen(req, context=SSL_CTX, timeout=240) as r:
                j = json.loads(r.read())
        except Exception as e:
            return self._err(502, "STEP-Umwandlung nicht erreichbar: %s" % e)
        finally:
            STEP_SLOTS.release()
        if j.get("error") or not j.get("stlBase64"):
            return self._err(422, j.get("error") or "STEP ohne Geometrie")
        self._send(200, base64.b64decode(j["stlBase64"]), "application/octet-stream")

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("V3D Schichthöhe auf http://127.0.0.1:%d" % PORT, flush=True)
    srv.serve_forever()
