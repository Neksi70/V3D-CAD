#!/usr/bin/env python3
"""V3D Transkript - gesprochenes Wort aus Video/Sprachnachricht als Text.

Aufruf: python3 server.py [port]
"""
import json
import os
import queue
import re
import shutil
import secrets
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BASIS = os.path.dirname(os.path.abspath(__file__))
DATEN = os.path.join(BASIS, "data")
JOBS = os.path.join(DATEN, "jobs")
MEDIEN = os.path.join(DATEN, "medien")
CONFIG_PFAD = os.path.join(BASIS, "config.json")
MAX_BYTES = 800 * 1024 * 1024          # 800 MB
AUFBEWAHRUNG = 14 * 24 * 3600          # alte Jobs nach 14 Tagen weg

for p in (DATEN, JOBS, MEDIEN):
    os.makedirs(p, exist_ok=True)


# ---------------------------------------------------------------- Konfiguration
def config():
    if not os.path.exists(CONFIG_PFAD):
        cfg = {"code": secrets.token_hex(3), "modell": "small", "sprache": "de"}
        with open(CONFIG_PFAD, "w") as f:
            json.dump(cfg, f, indent=2)
        os.chmod(CONFIG_PFAD, 0o600)
        print(f"[config] neu angelegt, Zugangscode: {cfg['code']}", flush=True)
        return cfg
    with open(CONFIG_PFAD) as f:
        return json.load(f)


CFG = config()
SITZUNGEN_PFAD = os.path.join(DATEN, "sitzungen.json")


def offen():
    """Leerer Code in config.json = kein Tor, jeder darf rein."""
    return not str(CFG.get("code") or "").strip()


def sitzungen_laden():
    """Sitzungen überleben einen Neustart - sonst müsste man den Code
    nach jedem Dienst-Neustart neu eintippen."""
    try:
        with open(SITZUNGEN_PFAD) as f:
            daten = json.load(f)
        grenze = time.time() - 30 * 24 * 3600
        return {k: v for k, v in daten.items() if v > grenze}
    except (OSError, ValueError, AttributeError):
        return {}


SITZUNGEN = sitzungen_laden()


def sitzungen_sichern():
    try:
        tmp = SITZUNGEN_PFAD + ".tmp"
        with open(tmp, "w") as f:
            json.dump(SITZUNGEN, f)
        os.chmod(tmp, 0o600)
        os.replace(tmp, SITZUNGEN_PFAD)
    except OSError:
        pass


# ---------------------------------------------------------------- Job-Verwaltung
def job_pfad(jid):
    return os.path.join(JOBS, f"{jid}.json")


def job_lesen(jid):
    if not re.fullmatch(r"[0-9a-f]{32}", jid or ""):
        return None
    try:
        with open(job_pfad(jid)) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


SCHREIB_SPERRE = threading.Lock()


def job_schreiben(job):
    with SCHREIB_SPERRE:
        tmp = job_pfad(job["id"]) + ".tmp"
        with open(tmp, "w") as f:
            json.dump(job, f)
        os.replace(tmp, job_pfad(job["id"]))


def jobs_liste():
    raus = []
    for name in os.listdir(JOBS):
        if not name.endswith(".json"):
            continue
        job = job_lesen(name[:-5])
        if job:
            raus.append({k: job.get(k) for k in
                         ("id", "name", "zustand", "prozent", "angelegt",
                          "dauer", "modell", "sprache", "fehler")})
    raus.sort(key=lambda j: j.get("angelegt", 0), reverse=True)
    return raus


def aufraeumen():
    grenze = time.time() - AUFBEWAHRUNG
    for name in os.listdir(JOBS):
        pfad = os.path.join(JOBS, name)
        try:
            if os.path.getmtime(pfad) < grenze:
                jid = name[:-5]
                os.remove(pfad)
                for m in os.listdir(MEDIEN):
                    if m.startswith(jid):
                        os.remove(os.path.join(MEDIEN, m))
        except OSError:
            pass


# ---------------------------------------------------------------- Ton + Whisper
def tondauer(pfad):
    try:
        aus = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", pfad],
            capture_output=True, text=True, timeout=120)
        return float(aus.stdout.strip())
    except (ValueError, OSError, subprocess.SubprocessError):
        return 0.0


def ton_extrahieren(quelle, ziel):
    """Tonspur nach 16 kHz mono WAV - das Format, das Whisper mag."""
    proc = subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", quelle,
         "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", ziel],
        capture_output=True, text=True, timeout=3600)
    if proc.returncode != 0 or not os.path.exists(ziel) or os.path.getsize(ziel) < 1024:
        grund = ""
        for z in proc.stderr.strip().splitlines():
            z = z.strip()
            if z and not z.startswith(("lib", "ffmpeg version", "built with",
                                       "configuration:")):
                grund = z
        if "Invalid data" in grund or "moov atom" in grund or not grund:
            raise RuntimeError("Aus dieser Datei ließ sich keine Tonspur lesen - "
                               "ist es wirklich ein Video oder eine Sprachnachricht?")
        if "does not contain any stream" in grund or "Output file" in grund:
            raise RuntimeError("Die Datei enthält keine Tonspur (stummes Video).")
        raise RuntimeError("Tonspur ging nicht: " + grund[:200])
    return ziel


_MODELLE = {}
_MODELL_SPERRE = threading.Lock()


def modell_holen(name):
    with _MODELL_SPERRE:
        if name not in _MODELLE:
            from faster_whisper import WhisperModel
            print(f"[whisper] lade Modell {name} ...", flush=True)
            _MODELLE[name] = WhisperModel(name, device="cpu", compute_type="int8",
                                          cpu_threads=max(2, (os.cpu_count() or 4) - 2))
        return _MODELLE[name]


def zeit_srt(sek):
    ms = int(round(sek * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def verarbeiten(jid):
    job = job_lesen(jid)
    if not job:
        return
    try:
        job["zustand"] = "ton"
        job["prozent"] = 2
        job_schreiben(job)

        quelle = os.path.join(MEDIEN, job["datei"])
        # nicht schlicht jid + ".wav": bei einem hochgeladenen .wav waere das
        # dieselbe Datei wie die Quelle und ffmpeg bricht ab
        wav = os.path.join(MEDIEN, jid + "_16k.wav")
        ton_extrahieren(quelle, wav)

        laenge = tondauer(wav)
        job["dauer"] = round(laenge, 1)
        job["zustand"] = "transkribiert"
        job["prozent"] = 5
        job_schreiben(job)

        modell = modell_holen(job.get("modell") or "small")
        sprache = job.get("sprache") or None
        segmente, info = modell.transcribe(
            wav,
            language=None if sprache in (None, "", "auto") else sprache,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
            beam_size=5,
            condition_on_previous_text=False)

        job["erkannte_sprache"] = getattr(info, "language", None)
        gesammelt = []
        letzte_meldung = 0.0
        for seg in segmente:
            text = (seg.text or "").strip()
            if text:
                gesammelt.append({"start": round(seg.start, 2),
                                  "ende": round(seg.end, 2),
                                  "text": text})
            if time.time() - letzte_meldung > 1.5:
                letzte_meldung = time.time()
                if laenge > 0:
                    job["prozent"] = min(98, 5 + int(seg.end / laenge * 93))
                job["segmente"] = gesammelt
                job_schreiben(job)
            if job_lesen(jid) is None:      # Job wurde gelöscht
                return

        job["segmente"] = gesammelt
        job["text"] = " ".join(s["text"] for s in gesammelt).strip()
        job["zustand"] = "fertig"
        job["prozent"] = 100
        job["beendet"] = time.time()
        job_schreiben(job)
        try:
            os.remove(wav)
        except OSError:
            pass
    except Exception as e:                                   # noqa: BLE001
        job = job_lesen(jid) or job
        job["zustand"] = "fehler"
        job["fehler"] = str(e)[:500]
        job_schreiben(job)
        print(f"[job {jid}] Fehler: {e}", flush=True)


WARTESCHLANGE = queue.Queue()


def arbeiter():
    while True:
        jid = WARTESCHLANGE.get()
        try:
            verarbeiten(jid)
        finally:
            WARTESCHLANGE.task_done()


# ---------------------------------------------------------------- HTTP
def sicherer_name(name):
    name = os.path.basename(name or "aufnahme")
    name = re.sub(r"[^\w.\- ()]+", "_", name, flags=re.UNICODE)
    return name[:120] or "aufnahme"


class Handler(BaseHTTPRequestHandler):
    server_version = "V3DTranskript/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print(f"[http] {self.address_string()} {fmt % args}", flush=True)

    # -- Hilfen ---------------------------------------------------
    def sende(self, code, koerper=b"", typ="application/json; charset=utf-8",
              extra=None):
        if isinstance(koerper, str):
            koerper = koerper.encode()
        self.send_response(code)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(koerper)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(koerper)

    def json_raus(self, obj, code=200, extra=None):
        self.sende(code, json.dumps(obj, ensure_ascii=False), extra=extra)

    def angemeldet(self):
        if offen():
            return True
        keks = self.headers.get("Cookie", "")
        for teil in keks.split(";"):
            k, _, v = teil.strip().partition("=")
            if k == "v3dtrsess" and v in SITZUNGEN:
                return True
        return False

    def json_rein(self, grenze=1 << 20):
        laenge = int(self.headers.get("Content-Length") or 0)
        if laenge <= 0 or laenge > grenze:
            return {}
        try:
            return json.loads(self.rfile.read(laenge).decode())
        except ValueError:
            return {}

    # -- GET ------------------------------------------------------
    def do_GET(self):
        u = urlparse(self.path)
        pfad = u.path.rstrip("/") or "/"
        q = parse_qs(u.query)

        if pfad in ("/", "/app.html", "/transkript"):
            try:
                with open(os.path.join(BASIS, "app.html"), "rb") as f:
                    self.sende(200, f.read(), "text/html; charset=utf-8")
            except OSError:
                self.sende(500, b"app.html fehlt", "text/plain; charset=utf-8")
            return

        if pfad == "/api/ping":
            self.json_raus({"ok": True, "angemeldet": self.angemeldet(),
                            "offen": offen()})
            return

        if not self.angemeldet():
            self.json_raus({"fehler": "nicht angemeldet"}, 401)
            return

        if pfad == "/api/jobs":
            self.json_raus({"jobs": jobs_liste()})
            return

        if pfad == "/api/job":
            job = job_lesen((q.get("id") or [""])[0])
            if not job:
                self.json_raus({"fehler": "unbekannt"}, 404)
                return
            self.json_raus(job)
            return

        if pfad in ("/api/txt", "/api/srt", "/api/zeit"):
            job = job_lesen((q.get("id") or [""])[0])
            if not job or job.get("zustand") != "fertig":
                self.json_raus({"fehler": "nicht fertig"}, 404)
                return
            stamm = os.path.splitext(job.get("name") or "transkript")[0]
            segmente = job.get("segmente") or []
            if pfad == "/api/txt":
                inhalt, endung = (job.get("text") or ""), "txt"
            elif pfad == "/api/zeit":
                inhalt = "\n".join(
                    f"[{zeit_srt(s['start'])[:-4]}] {s['text']}" for s in segmente)
                endung = "txt"
            else:
                teile = []
                for i, s in enumerate(segmente, 1):
                    teile.append(f"{i}\n{zeit_srt(s['start'])} --> "
                                 f"{zeit_srt(s['ende'])}\n{s['text']}\n")
                inhalt, endung = "\n".join(teile), "srt"
            self.sende(200, inhalt, "text/plain; charset=utf-8",
                       {"Content-Disposition":
                        f'attachment; filename="{sicherer_name(stamm)}.{endung}"'})
            return

        self.json_raus({"fehler": "unbekannter Pfad"}, 404)

    # -- POST -----------------------------------------------------
    def do_POST(self):
        u = urlparse(self.path)
        pfad = u.path.rstrip("/") or "/"
        q = parse_qs(u.query)

        if pfad == "/api/login":
            if offen():
                self.json_raus({"ok": True})
                return
            daten = self.json_rein()
            if str(daten.get("code", "")).strip() == str(CFG.get("code")):
                sid = secrets.token_urlsafe(24)
                SITZUNGEN[sid] = time.time()
                sitzungen_sichern()
                self.json_raus({"ok": True}, extra={
                    "Set-Cookie": f"v3dtrsess={sid}; Path=/; HttpOnly; "
                                  f"SameSite=Lax; Max-Age=2592000"})
            else:
                time.sleep(1.0)
                self.json_raus({"fehler": "Code stimmt nicht"}, 403)
            return

        if not self.angemeldet():
            self.json_raus({"fehler": "nicht angemeldet"}, 401)
            return

        if pfad == "/api/upload":
            laenge = int(self.headers.get("Content-Length") or 0)
            if laenge <= 0:
                self.json_raus({"fehler": "leere Datei"}, 400)
                return
            if laenge > MAX_BYTES:
                self.json_raus({"fehler": "Datei zu groß (max 800 MB)"}, 413)
                return

            name = sicherer_name((q.get("name") or ["aufnahme"])[0])
            modell = (q.get("modell") or ["small"])[0]
            if modell not in ("tiny", "base", "small", "medium"):
                modell = "small"
            sprache = (q.get("sprache") or ["de"])[0]
            if sprache not in ("de", "en", "auto", "nl", "fr", "es", "it", "tr", "pl", "ru"):
                sprache = "de"

            jid = uuid.uuid4().hex
            endung = os.path.splitext(name)[1][:8] or ".bin"
            dateiname = jid + endung
            ziel = os.path.join(MEDIEN, dateiname)
            gelesen = 0
            try:
                with open(ziel, "wb") as f:
                    while gelesen < laenge:
                        brocken = self.rfile.read(min(1 << 20, laenge - gelesen))
                        if not brocken:
                            break
                        f.write(brocken)
                        gelesen += len(brocken)
            except OSError as e:
                self.json_raus({"fehler": f"Speichern fehlgeschlagen: {e}"}, 500)
                return
            if gelesen < laenge:
                try:
                    os.remove(ziel)
                except OSError:
                    pass
                self.json_raus({"fehler": "Übertragung abgebrochen"}, 400)
                return

            job = {"id": jid, "name": name, "datei": dateiname, "modell": modell,
                   "sprache": sprache, "zustand": "wartet", "prozent": 0,
                   "angelegt": time.time(), "groesse": gelesen,
                   "segmente": [], "text": ""}
            job_schreiben(job)
            WARTESCHLANGE.put(jid)
            self.json_raus({"ok": True, "id": jid,
                            "position": WARTESCHLANGE.qsize()})
            return

        if pfad == "/api/loeschen":
            jid = (self.json_rein().get("id") or "")
            job = job_lesen(jid)
            if not job:
                self.json_raus({"fehler": "unbekannt"}, 404)
                return
            try:
                os.remove(job_pfad(jid))
            except OSError:
                pass
            for m in os.listdir(MEDIEN):
                if m.startswith(jid):
                    try:
                        os.remove(os.path.join(MEDIEN, m))
                    except OSError:
                        pass
            self.json_raus({"ok": True})
            return

        self.json_raus({"fehler": "unbekannter Pfad"}, 404)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8792
    if not shutil.which("ffmpeg"):
        print("!! ffmpeg fehlt - ohne das geht keine Tonspur", flush=True)
    aufraeumen()
    # abgebrochene Jobs (Neustart mitten im Lauf) wieder einreihen
    for j in jobs_liste():
        if j["zustand"] in ("wartet", "ton", "transkribiert"):
            WARTESCHLANGE.put(j["id"])
    threading.Thread(target=arbeiter, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    srv.daemon_threads = True
    print(f"V3D Transkript läuft auf http://127.0.0.1:{port} "
          + ("OHNE Zugangscode - offen für jeden, der die Adresse kennt"
             if offen() else f"(Code: {CFG.get('code')})"), flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
