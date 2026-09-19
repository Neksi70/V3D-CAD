#!/usr/bin/env python3
"""Mini-Server für V3D Kristall (2D-Foto → 3D-Punktwolke für K9-Glaslaser).

GET  /                 → app.html
GET  /lib/…            → Three.js + OrbitControls
POST /api/tiefe        → Bild (Rohbytes, JPEG/PNG) → JSON mit Tiefenkarte
                         (Depth Anything V2 Small) und optional Personen-Maske (MODNet)
                         Query: fein=1 (höhere Auflösung), person=1 (Maske mitrechnen)

Beide Modelle laufen per onnxruntime auf der CPU, Lizenz Apache-2.0.
Läuft nur auf 127.0.0.1 (öffentlich über den Funnel-Pfad /kristall).
Start: python3 server.py [port]"""
import base64, http.server, io, json, os, sys, threading

import numpy as np
from PIL import Image

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8799
BASE = os.path.dirname(os.path.abspath(__file__))
MAX_BILD = 25 * 1024 * 1024
# CPU-Rechnung: höchstens 2 Bilder gleichzeitig, der Rest wartet kurz
SLOTS = threading.BoundedSemaphore(2)
TYPEN = {".js": "text/javascript; charset=utf-8", ".txt": "text/plain; charset=utf-8",
         ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml"}

_sitzungen = {}
_lade_lock = threading.Lock()


def sitzung(name):
    """ONNX-Sitzung erst beim ersten Bedarf laden (spart RAM, solange niemand rechnet)."""
    with _lade_lock:
        if name not in _sitzungen:
            import onnxruntime as ort
            opt = ort.SessionOptions()
            opt.intra_op_num_threads = 4
            _sitzungen[name] = ort.InferenceSession(
                os.path.join(BASE, "modelle", name + ".onnx"), opt,
                providers=["CPUExecutionProvider"])
        return _sitzungen[name]


def auf_raster(w, h, lang, teiler):
    """Längste Seite auf `lang`, beide Seiten Vielfache von `teiler`."""
    f = lang / max(w, h)
    return (max(teiler, round(w * f / teiler) * teiler),
            max(teiler, round(h * f / teiler) * teiler))


def tiefe(bild, fein):
    w, h = auf_raster(bild.width, bild.height, 812 if fein else 518, 14)
    x = np.asarray(bild.resize((w, h), Image.BICUBIC), np.float32) / 255.0
    x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    d = sitzung("tiefe").run(None, {"pixel_values": x})[0][0]   # Disparität: groß = nah
    lo, hi = float(d.min()), float(d.max())
    d = (d - lo) / (hi - lo if hi > lo else 1.0)
    return d.shape[1], d.shape[0], d


def person(bild):
    w, h = auf_raster(bild.width, bild.height, 672, 32)
    x = np.asarray(bild.resize((w, h), Image.BILINEAR), np.float32) / 127.5 - 1.0
    x = x.transpose(2, 0, 1)[None].astype(np.float32)
    m = sitzung("modnet").run(None, {"input": x})[0][0, 0]
    return m.shape[1], m.shape[0], np.clip(m, 0, 1)


def b64_u16(a):
    return base64.b64encode((np.clip(a, 0, 1) * 65535 + 0.5).astype("<u2").tobytes()).decode()


class Handler(http.server.BaseHTTPRequestHandler):
    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode(), "application/json; charset=utf-8")

    def do_GET(self):
        pfad = self.path.split("?")[0]
        if "/lib/" in pfad:
            name = os.path.basename(pfad)
            datei = os.path.join(BASE, "lib", name)
            if not os.path.isfile(datei):
                return self._json(404, {"error": "unbekannt"})
            with open(datei, "rb") as f:
                return self._send(200, f.read(), TYPEN.get(os.path.splitext(name)[1], "application/octet-stream"))
        with open(os.path.join(BASE, "app.html"), "rb") as f:
            self._send(200, f.read(), "text/html; charset=utf-8")

    def do_POST(self):
        pfad, _, query = self.path.partition("?")
        if not pfad.endswith("/api/tiefe"):
            return self._json(404, {"error": "unbekannt"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return self._json(400, {"error": "Kein Bild"})
        if n > MAX_BILD:
            return self._json(413, {"error": "Bild zu groß (max. 25 MB)"})
        daten = self.rfile.read(n)
        q = dict(p.split("=", 1) for p in query.split("&") if "=" in p)
        try:
            bild = Image.open(io.BytesIO(daten))
            bild.load()
        except Exception:
            return self._json(422, {"error": "Bild nicht lesbar"})
        if bild.mode in ("RGBA", "LA", "P"):
            bild = bild.convert("RGBA")
            unter = Image.new("RGB", bild.size, (0, 0, 0))
            unter.paste(bild, mask=bild.split()[3])
            bild = unter
        else:
            bild = bild.convert("RGB")
        if not SLOTS.acquire(timeout=90):
            return self._json(503, {"error": "Server ausgelastet — bitte gleich noch einmal"})
        try:
            tw, th, d = tiefe(bild, q.get("fein") == "1")
            antwort = {"tiefe": {"w": tw, "h": th, "daten": b64_u16(d)}}
            if q.get("person") == "1":
                pw, ph, m = person(bild)
                antwort["person"] = {"w": pw, "h": ph, "daten": b64_u16(m)}
        except Exception as e:
            return self._json(500, {"error": "Tiefenschätzung fehlgeschlagen: %s" % e})
        finally:
            SLOTS.release()
        self._json(200, antwort)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("V3D Kristall auf http://127.0.0.1:%d" % PORT, flush=True)
    srv.serve_forever()
