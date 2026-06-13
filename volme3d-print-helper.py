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
import http.server, json, os, sys, tempfile, subprocess, glob, platform, socket, shutil
import urllib.parse

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

# --- STL-Bibliothek (sammeln/auflisten/lesen) ---------------------------------
LIB_EXTS = (".stl", ".3mf", ".obj")

def _downloads_dir():
    if platform.system() == "Windows":
        try:
            import winreg
            key = r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders"
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as k:
                val, _ = winreg.QueryValueEx(k, "{374DE290-123F-4565-9164-39C4925E467B}")
                val = os.path.expandvars(val)
                if os.path.isdir(val):
                    return val
        except Exception:
            pass
    return os.path.join(os.path.expanduser("~"), "Downloads")

def lib_dir():
    base = os.path.join(os.path.expanduser("~"), "Documents")
    if not os.path.isdir(base):
        base = os.path.expanduser("~")
    d = os.path.join(base, "Volme3D-STL")
    os.makedirs(d, exist_ok=True)
    return d

def _unique_path(d, fname):
    tp = os.path.join(d, fname)
    if not os.path.exists(tp):
        return tp
    base, ext = os.path.splitext(fname)
    i = 2
    while os.path.exists(os.path.join(d, "%s_%d%s" % (base, i, ext))):
        i += 1
    return os.path.join(d, "%s_%d%s" % (base, i, ext))

def collect_from_downloads(move=False):
    src = _downloads_dir()
    dst = lib_dir()
    copied = skipped = 0
    if os.path.isdir(src):
        for root, dirs, files in os.walk(src):
            if os.path.abspath(root) == os.path.abspath(dst):
                dirs[:] = []
                continue
            for fn in files:
                if not fn.lower().endswith(LIB_EXTS):
                    continue
                sp = os.path.join(root, fn)
                tp = os.path.join(dst, fn)
                try:
                    if os.path.exists(tp) and os.path.getsize(tp) == os.path.getsize(sp):
                        skipped += 1
                        continue
                    if os.path.exists(tp):
                        tp = _unique_path(dst, fn)
                    if move:
                        shutil.move(sp, tp)
                    else:
                        shutil.copy2(sp, tp)
                    copied += 1
                except Exception:
                    pass
    return {"ok": True, "copied": copied, "skipped": skipped, "dir": dst,
            "source": src, "count": _lib_count(dst)}

def _lib_count(d):
    try:
        return len([f for f in os.listdir(d) if f.lower().endswith(LIB_EXTS)])
    except OSError:
        return 0

def lib_list():
    d = lib_dir()
    out = []
    try:
        for fn in os.listdir(d):
            if fn.lower().endswith(LIB_EXTS):
                p = os.path.join(d, fn)
                try:
                    st = os.stat(p)
                    out.append({"name": fn, "size": st.st_size, "mtime": int(st.st_mtime * 1000)})
                except OSError:
                    pass
    except OSError:
        pass
    out.sort(key=lambda x: x["mtime"], reverse=True)
    return out

def _lib_file_path(name):
    name = os.path.basename(name or "")
    if not name:
        return None
    p = os.path.join(lib_dir(), name)
    return p if os.path.isfile(p) else None

# --- HTTP ---------------------------------------------------------------------
class Handler(http.server.BaseHTTPRequestHandler):
    def _cors(self, origin):
        # Spiegelt erlaubte Origin zurueck (sonst kein CORS-Header)
        if _origin_ok(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Slicer, X-Filename, X-LibFile")
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
        path = self.path.split("?", 1)[0]
        if path == "/ping":
            self._json(200, {
                "ok": True, "app": "volme3d-print-helper", "version": 2,
                "os": platform.system(),
                "slicers": sorted(find_slicers().keys()),
                "libDir": lib_dir(),
            }, origin)
        elif path == "/list":
            if not _origin_ok(origin):
                self._json(403, {"ok": False, "error": "origin not allowed"}, origin)
                return
            self._json(200, {"ok": True, "dir": lib_dir(), "files": lib_list()}, origin)
        elif path == "/file":
            if not _origin_ok(origin):
                self._json(403, {"ok": False, "error": "origin not allowed"}, origin)
                return
            qs = urllib.parse.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            fp = _lib_file_path((qs.get("name") or [""])[0])
            if not fp:
                self._json(404, {"ok": False, "error": "Datei nicht gefunden"}, origin)
                return
            with open(fp, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "model/stl")
            self.send_header("Content-Length", str(len(data)))
            self._cors(origin)
            self.end_headers()
            self.wfile.write(data)
        else:
            self._json(404, {"ok": False, "error": "not found"}, origin)

    def do_POST(self):
        origin = self.headers.get("Origin", "")
        path = self.path.split("?", 1)[0]
        if not _origin_ok(origin):
            self._json(403, {"ok": False, "error": "origin not allowed: " + origin}, origin)
            return
        if path == "/collect":
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            body = self.rfile.read(length) if length else b""
            move = False
            try:
                move = bool(json.loads(body or b"{}").get("move"))
            except Exception:
                pass
            try:
                self._json(200, collect_from_downloads(move=move), origin)
            except Exception as e:
                self._json(500, {"ok": False, "error": str(e)}, origin)
            return
        if path != "/print":
            self._json(404, {"ok": False, "error": "not found"}, origin)
            return

        want = (self.headers.get("X-Slicer", "") or "").lower()
        slicers = find_slicers()
        if not slicers:
            self._json(500, {"ok": False, "error": "Kein Slicer gefunden"}, origin)
            return
        key = want if want in slicers else sorted(slicers.keys())[0]
        exe = slicers[key]

        # Variante A: Datei liegt bereits in der Bibliothek (X-LibFile) -> direkt oeffnen
        libname = self.headers.get("X-LibFile", "")
        if libname:
            path_to_open = _lib_file_path(libname)
            if not path_to_open:
                self._json(404, {"ok": False, "error": "Bibliotheksdatei nicht gefunden"}, origin)
                return
        else:
            # Variante B: Bytes im Body -> in Temp schreiben
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            data = self.rfile.read(length) if length else b""
            if not data:
                self._json(400, {"ok": False, "error": "leere Datei"}, origin)
                return
            fname = os.path.basename(self.headers.get("X-Filename", "modell.stl")) or "modell.stl"
            outdir = os.path.join(tempfile.gettempdir(), "volme3d-print")
            os.makedirs(outdir, exist_ok=True)
            path_to_open = os.path.join(outdir, fname)
            try:
                with open(path_to_open, "wb") as f:
                    f.write(data)
            except OSError as e:
                self._json(500, {"ok": False, "error": "Schreibfehler: " + str(e)}, origin)
                return
        try:
            subprocess.Popen([exe, path_to_open], close_fds=True)
        except Exception as e:
            self._json(500, {"ok": False, "error": "Slicer-Start fehlgeschlagen: " + str(e)}, origin)
            return
        self._json(200, {"ok": True, "slicer": key, "file": os.path.basename(path_to_open)}, origin)

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
