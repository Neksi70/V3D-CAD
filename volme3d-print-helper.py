#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Volme3D Print Helper  -  lokaler Ein-Klick-Druck-Dienst
=======================================================
Laeuft auf DEINEM Desktop (wo Browser + Slicer + STL-Ordner sind).
Lauscht nur auf 127.0.0.1 (nicht aus dem Netz erreichbar) und oeffnet
vom Volme3D-Web-App geschickte STL-Dateien direkt im Slicer.

Start (Windows):   pythonw volme3d-print-helper.py
Start (Linux/Mac): python3 volme3d-print-helper.py

Sicherheit: Es werden nur Anfragen von der erlaubten Volme3D-Adresse
(ALLOWED_ORIGINS) ausgefuehrt - sonst koennte jede Webseite den Slicer
ausloesen.
"""
import http.server, json, os, sys, tempfile, subprocess, glob, platform, socket

PORT = 7777

# Nur diese Web-Adressen duerfen drucken. Trag hier ggf. deine Volme3D-URL ein.
ALLOWED_ORIGINS = {
    "https://v3da.tailf05fe9.ts.net",
}
# localhost (zum Testen) wird zusaetzlich automatisch akzeptiert.

def _origin_ok(origin):
    if not origin:
        return False
    if origin in ALLOWED_ORIGINS:
        return True
    return origin.startswith("http://localhost") or origin.startswith("http://127.0.0.1")

# --- Slicer-Erkennung ---------------------------------------------------------
def _expand(p):
    return os.path.expandvars(os.path.expanduser(p))

def find_slicers():
    # Test-Override: VOLME3D_SLICER_CMD=/pfad/zum/programm  -> als "bambu" gemeldet
    ov = os.environ.get("VOLME3D_SLICER_CMD")
    if ov:
        return {"bambu": ov, "orca": ov}

    sysname = platform.system()
    if sysname == "Windows":
        cand = {
            "bambu": [
                r"%ProgramFiles%\Bambu Studio\bambu-studio.exe",
                r"%ProgramW6432%\Bambu Studio\bambu-studio.exe",
                r"%LOCALAPPDATA%\Programs\Bambu Studio\bambu-studio.exe",
            ],
            "orca": [
                r"%ProgramFiles%\OrcaSlicer\orca-slicer.exe",
                r"%ProgramFiles%\OrcaSlicer\OrcaSlicer.exe",
                r"%ProgramW6432%\OrcaSlicer\orca-slicer.exe",
                r"%LOCALAPPDATA%\Programs\OrcaSlicer\orca-slicer.exe",
                r"%LOCALAPPDATA%\Programs\OrcaSlicer\OrcaSlicer.exe",
            ],
            "prusa": [
                r"%ProgramFiles%\Prusa3D\PrusaSlicer\prusa-slicer.exe",
                r"%ProgramFiles%\Prusa3D\PrusaSlicer\prusa-slicer-console.exe",
            ],
        }
    elif sysname == "Darwin":
        cand = {
            "bambu": ["/Applications/BambuStudio.app/Contents/MacOS/BambuStudio"],
            "orca":  ["/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer"],
            "prusa": ["/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer"],
        }
    else:  # Linux
        cand = {
            "bambu": ["bambu-studio", "BambuStudio",
                      _expand("~/Applications/*ambu*.AppImage")],
            "orca":  ["orca-slicer", "OrcaSlicer",
                      _expand("~/Applications/*rca*.AppImage")],
            "prusa": ["prusa-slicer", "PrusaSlicer",
                      _expand("~/Applications/*rusa*.AppImage")],
        }

    found = {}
    for key, paths in cand.items():
        for p in paths:
            p = _expand(p)
            # PATH-Lookup (Linux/Mac Befehlsnamen)
            if os.sep not in p and "/" not in p:
                from shutil import which
                w = which(p)
                if w:
                    found[key] = w
                    break
                continue
            # Glob (Versions-Unterordner / AppImages)
            if any(ch in p for ch in "*?"):
                hits = sorted(glob.glob(p))
                if hits:
                    found[key] = hits[-1]
                    break
                continue
            if os.path.isfile(p):
                found[key] = p
                break
    return found

# --- HTTP ---------------------------------------------------------------------
class Handler(http.server.BaseHTTPRequestHandler):
    def _cors(self, origin):
        # Spiegelt erlaubte Origin zurueck (sonst kein CORS-Header)
        if _origin_ok(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Slicer, X-Filename")
        # Private Network Access: HTTPS-Seite -> localhost braucht diese Freigabe (Chrome)
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, code, obj, origin=""):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors(origin)
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        origin = self.headers.get("Origin", "")
        self.send_response(204)
        self._cors(origin)
        self.end_headers()

    def do_GET(self):
        origin = self.headers.get("Origin", "")
        if self.path.startswith("/ping"):
            self._json(200, {
                "ok": True, "app": "volme3d-print-helper", "version": 1,
                "os": platform.system(),
                "slicers": sorted(find_slicers().keys()),
            }, origin)
        else:
            self._json(404, {"ok": False, "error": "not found"}, origin)

    def do_POST(self):
        origin = self.headers.get("Origin", "")
        if not self.path.startswith("/print"):
            self._json(404, {"ok": False, "error": "not found"}, origin)
            return
        if not _origin_ok(origin):
            # Schutz: fremde Webseiten duerfen den Slicer NICHT ausloesen
            self._json(403, {"ok": False, "error": "origin not allowed: " + origin}, origin)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        data = self.rfile.read(length) if length else b""
        if not data:
            self._json(400, {"ok": False, "error": "leere Datei"}, origin)
            return
        fname = os.path.basename(self.headers.get("X-Filename", "modell.stl")) or "modell.stl"
        want = (self.headers.get("X-Slicer", "") or "").lower()

        slicers = find_slicers()
        if not slicers:
            self._json(500, {"ok": False, "error": "Kein Slicer gefunden"}, origin)
            return
        key = want if want in slicers else sorted(slicers.keys())[0]
        exe = slicers[key]

        outdir = os.path.join(tempfile.gettempdir(), "volme3d-print")
        os.makedirs(outdir, exist_ok=True)
        path = os.path.join(outdir, fname)
        try:
            with open(path, "wb") as f:
                f.write(data)
        except OSError as e:
            self._json(500, {"ok": False, "error": "Schreibfehler: " + str(e)}, origin)
            return
        try:
            subprocess.Popen([exe, path], close_fds=True)
        except Exception as e:
            self._json(500, {"ok": False, "error": "Slicer-Start fehlgeschlagen: " + str(e)}, origin)
            return
        self._json(200, {"ok": True, "slicer": key, "file": fname}, origin)

    def log_message(self, *args):
        pass  # still

def main():
    try:
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError as e:
        print("Konnte Port %d nicht oeffnen: %s" % (PORT, e))
        print("Laeuft der Helfer evtl. schon?")
        sys.exit(1)
    sl = find_slicers()
    print("Volme3D Print Helper laeuft auf http://127.0.0.1:%d" % PORT)
    print("Betriebssystem:", platform.system())
    print("Gefundene Slicer:", ", ".join("%s -> %s" % (k, v) for k, v in sl.items()) or "KEINE (Pfad pruefen)")
    print("Erlaubte Web-Adressen:", ", ".join(sorted(ALLOWED_ORIGINS)), "(+ localhost)")
    print("Beenden mit Strg+C.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nBeendet.")

if __name__ == "__main__":
    main()
