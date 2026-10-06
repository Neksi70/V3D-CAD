#!/usr/bin/env python3
"""V3D Transkript - gesprochenes Wort aus Video/Sprachnachricht als Text.
Videos ohne (hörbaren) Ton laufen im Bildmodus (bildmodus.py): Schlüsselbilder
+ erkannter Text, als Markdown/JSON/ZIP für die Auswertung mit Claude.

Aufruf: python3 server.py [port]
        V3DTR_DATEN=/anderer/ordner python3 server.py 8793   (z. B. für Tests)
"""
import json
import os
import queue
import re
import shutil
import secrets
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, quote

import bildmodus

BASIS = os.path.dirname(os.path.abspath(__file__))
DATEN = os.environ.get("V3DTR_DATEN") or os.path.join(BASIS, "data")
JOBS = os.path.join(DATEN, "jobs")
MEDIEN = os.path.join(DATEN, "medien")
BILDER = os.path.join(DATEN, "bilder")        # je Bildmodus-Job ein Ordner
CONFIG_PFAD = os.path.join(BASIS, "config.json")
MAX_BYTES = 800 * 1024 * 1024          # 800 MB
AUFBEWAHRUNG = 14 * 24 * 3600          # alte Jobs nach 14 Tagen weg
LAUFENDE_ZUSTAENDE = ("wartet", "pruefen", "ton", "transkribiert", "bilder", "ocr")

for p in (DATEN, JOBS, MEDIEN, BILDER):
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
                          "dauer", "modell", "sprache", "fehler", "modus")})
    raus.sort(key=lambda j: j.get("angelegt", 0), reverse=True)
    return raus


def job_dateien_weg(jid):
    """Hochgeladene Datei, Zwischenstände und Bildordner eines Jobs entfernen."""
    for m in os.listdir(MEDIEN):
        if m.startswith(jid):
            try:
                os.remove(os.path.join(MEDIEN, m))
            except OSError:
                pass
    shutil.rmtree(os.path.join(BILDER, jid), ignore_errors=True)


def aufraeumen():
    grenze = time.time() - AUFBEWAHRUNG
    for name in os.listdir(JOBS):
        pfad = os.path.join(JOBS, name)
        try:
            if os.path.getmtime(pfad) < grenze:
                os.remove(pfad)
                job_dateien_weg(name[:-5])
        except OSError:
            pass
    # Bildordner ohne Job (z. B. Absturz mitten im Löschen)
    for jid in os.listdir(BILDER):
        if not os.path.exists(job_pfad(jid)):
            shutil.rmtree(os.path.join(BILDER, jid), ignore_errors=True)


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


class JobGeloescht(Exception):
    pass


def bild_verarbeiten(jid, job, quelle, grund, sprache=None, prozent_ab=0):
    """Bildmodus: Schlüsselbilder + OCR nach data/bilder/<jid>/. Das Ergebnis
    landet zusätzlich als Segmente/Text im Job - damit gehen auch .txt/.srt.
    sprache = Whisper-Segmente -> Modus "beides": Gesprochenes je Bild."""
    ordner = os.path.join(BILDER, jid)
    shutil.rmtree(ordner, ignore_errors=True)
    opts = job.get("bild") or {}
    job.update(modus="bild", modus_grund=grund, zustand="bilder",
               prozent=max(2, prozent_ab))
    job_schreiben(job)
    letzte = [0.0]

    def pruefen():
        if job_lesen(jid) is None:
            raise JobGeloescht()

    def fortschritt(zustand, prozent, text):
        if time.time() - letzte[0] < 1.0:
            return
        letzte[0] = time.time()
        pruefen()
        prozent = prozent_ab + prozent * (100 - prozent_ab) / 100
        job.update(zustand=zustand, prozent=int(min(99, prozent)), schritt=text)
        job_schreiben(job)

    def echo(stufe, text):
        print(f"[job {jid}] {'!! ' if stufe == 'warnung' else ''}{text}", flush=True)

    erg = bildmodus.ausfuehren(
        quelle, ordner, start=opts.get("start"), ende=opts.get("ende"),
        schwelle=opts.get("schwelle", bildmodus.STANDARD["schwelle"]),
        intervall=opts.get("intervall", bildmodus.STANDARD["intervall"]),
        max_bilder=opts.get("max_bilder", bildmodus.STANDARD["max_bilder"]),
        toleranz=opts.get("toleranz", bildmodus.STANDARD["toleranz"]),
        entzerren_an=bool(opts.get("entzerren")), ocr_an=opts.get("ocr", True),
        ocr_fehlt="ueberspringen", tesseract_cmd=CFG.get("tesseract") or None,
        modus_grund=grund, quelle_name=job.get("name"),
        protokoll=bildmodus.Protokoll(echo), fortschritt=fortschritt,
        abbrechen_pruefen=pruefen, arbeitsordner=MEDIEN)
    if sprache is not None:
        bildmodus.sprache_zuordnen(erg, sprache, job.get("modell"))
        bildmodus.protokoll_schreiben(erg, ordner)
        job = job_lesen(jid)
        if job is None:
            raise JobGeloescht()

        def block(b):
            o = ((b.get("ocr") or {}).get("text") or "").strip()
            return (f"[{bildmodus.zeit_text(b['zeit'])}] Bild {b['nr']}\n"
                    f"Gesprochen: {b.get('gesprochen') or '(nichts)'}"
                    + (f"\nText im Bild: {o}" if o else ""))
        job.update(
            modus="beides", modus_grund=grund, segmente=sprache,
            text="\n\n".join(block(b) for b in erg["bilder"]),
            bilder=[{k: b.get(k) for k in ("nr", "zeit", "zeit_text", "datei", "breite",
                                            "hoehe", "grund", "text_geaendert", "entzerrt",
                                            "ocr", "gesprochen")}
                    for b in erg["bilder"]],
            statistik=erg["statistik"], einstellungen=erg["einstellungen"],
            hinweise=(job.get("hinweise") or [])
            + [e["text"] for e in erg["log"] if e["stufe"] == "warnung"],
            dauer=erg["video"].get("dauer") or job.get("dauer"), zustand="fertig",
            prozent=100, beendet=time.time(), schritt=None)
        job_schreiben(job)
        return
    segmente = []
    for i, b in enumerate(erg["bilder"]):
        naechste = erg["bilder"][i + 1]["zeit"] if i + 1 < len(erg["bilder"]) else (
            erg["ausschnitt"]["ende"] or b["zeit"] + 2)
        text = ((b.get("ocr") or {}).get("text") or "").strip()
        segmente.append({"start": b["zeit"], "ende": max(naechste, b["zeit"] + 0.5),
                         "text": f"[Bild {b['nr']}] " + (text.replace("\n", " / ") or "(kein Text)")})
    job = job_lesen(jid)
    if job is None:
        raise JobGeloescht()
    job.update(
        modus="bild", modus_grund=grund, segmente=segmente,
        text="\n\n".join(f"[{bildmodus.zeit_text(b['zeit'])}] Bild {b['nr']}\n"
                          + (((b.get("ocr") or {}).get("text") or "").strip() or "(kein Text)")
                          for b in erg["bilder"]),
        bilder=[{k: b.get(k) for k in ("nr", "zeit", "zeit_text", "datei", "breite", "hoehe",
                                        "grund", "text_geaendert", "entzerrt", "ocr")}
                for b in erg["bilder"]],
        statistik=erg["statistik"], einstellungen=erg["einstellungen"],
        hinweise=[e["text"] for e in erg["log"] if e["stufe"] == "warnung"],
        dauer=erg["video"].get("dauer"), zustand="fertig", prozent=100,
        beendet=time.time(), schritt=None)
    job_schreiben(job)


def verarbeiten(jid):
    job = job_lesen(jid)
    if not job:
        return
    try:
        quelle = os.path.join(MEDIEN, job["datei"])
        modus = job.get("modus_wunsch") or "auto"
        opts = job.get("bild") or {}
        if modus == "bild":
            bild_verarbeiten(jid, job, quelle, "Bildmodus gewählt")
            return
        if modus == "auto":
            job["zustand"] = "pruefen"
            job["prozent"] = 1
            job_schreiben(job)
            erkannt, grund, info, _ = bildmodus.modus_erkennen(
                quelle, bildmodus.zeit_lesen(opts.get("start")),
                bildmodus.zeit_lesen(opts.get("ende")))
            job["modus_grund"] = grund
            if erkannt == "bild":
                bild_verarbeiten(jid, job, quelle, "automatisch: " + grund)
                return
            job["hat_bildspur"] = info["video"] is not None

        beides = modus == "beides"
        job["modus"] = "ton"
        job["zustand"] = "ton"
        job["prozent"] = 2
        job_schreiben(job)

        # nicht schlicht jid + ".wav": bei einem hochgeladenen .wav waere das
        # dieselbe Datei wie die Quelle und ffmpeg bricht ab
        wav = os.path.join(MEDIEN, jid + "_16k.wav")
        try:
            ton_extrahieren(quelle, wav)
        except RuntimeError as e:
            if not beides:
                raise
            # Video ohne Tonspur: Bilder gibt es trotzdem
            job["hinweise"] = [f"Kein Ton verschriftlicht: {e}"]
            bild_verarbeiten(jid, job, quelle, "Ton + Bilder gewählt", sprache=[],
                             prozent_ab=5)
            return

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
            condition_on_previous_text=False,
            word_timestamps=beides)

        job["erkannte_sprache"] = getattr(info, "language", None)
        gesammelt = []
        letzte_meldung = 0.0
        for seg in segmente:
            text = (seg.text or "").strip()
            if text:
                eintrag = {"start": round(seg.start, 2), "ende": round(seg.end, 2),
                           "text": text}
                if beides and getattr(seg, "words", None):
                    # Abschnitte beginnen oft schon in der Pause davor, Wortanfänge
                    # liegen etwas zu früh - fürs Bild zählt die Mitte jedes Worts
                    eintrag["woerter"] = [[round((w.start + w.end) / 2, 2), w.word]
                                          for w in seg.words]
                gesammelt.append(eintrag)
            if time.time() - letzte_meldung > 1.5:
                letzte_meldung = time.time()
                if laenge > 0:
                    anteil = 45 if beides else 93
                    job["prozent"] = min(98, 5 + int(seg.end / laenge * anteil))
                job["segmente"] = gesammelt
                job_schreiben(job)
            if job_lesen(jid) is None:      # Job wurde gelöscht
                return

        if beides:
            try:
                os.remove(wav)
            except OSError:
                pass
            if not gesammelt:
                job["hinweise"] = ["In der Tonspur wurde keine Sprache erkannt."]
            bild_verarbeiten(jid, job, quelle, "Ton + Bilder gewählt", sprache=gesammelt,
                             prozent_ab=50)
            return
        if not gesammelt and modus == "auto" and job.get("hat_bildspur"):
            # Ton war da, aber nichts Gesprochenes (Rauschen, Musik ohne Text)
            try:
                os.remove(wav)
            except OSError:
                pass
            bild_verarbeiten(jid, job, quelle,
                             "automatisch: Tonspur ohne erkennbare Sprache ("
                             + (job.get("modus_grund") or "") + ")")
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
    except JobGeloescht:
        job_dateien_weg(jid)
        print(f"[job {jid}] gelöscht während der Verarbeitung", flush=True)
    except Exception as e:                                   # noqa: BLE001
        if job_lesen(jid) is None:                           # inzwischen gelöscht
            job_dateien_weg(jid)
            return
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


def bild_optionen(q):
    """Upload-Parameter für den Bildmodus prüfen. -> (optionen, fehler)"""
    def zahl(name, standard, typ, lo, hi):
        roh = (q.get(name) or [""])[0].strip().replace(",", ".")
        if not roh:
            return standard
        wert = typ(float(roh))
        if not lo <= wert <= hi:
            raise ValueError(f"{name} muss zwischen {lo} und {hi} liegen")
        return wert

    try:
        std = bildmodus.STANDARD
        opts = {
            "entzerren": (q.get("entzerren") or ["0"])[0] == "1",
            "ocr": (q.get("ocr") or ["1"])[0] != "0",
            "schwelle": zahl("schwelle", std["schwelle"], float, 0.001, 1.0),
            "intervall": zahl("intervall", std["intervall"], float, 0.5, 3600),
            "max_bilder": zahl("max_bilder", std["max_bilder"], int, 1, 500),
            "toleranz": zahl("toleranz", std["toleranz"], int, 0, 128),
        }
        for k in ("start", "ende"):
            roh = (q.get(k) or [""])[0].strip()
            if roh:
                bildmodus.zeit_lesen(roh)            # nur prüfen
                opts[k] = roh
        s_, e_ = bildmodus.zeit_lesen(opts.get("start")), bildmodus.zeit_lesen(opts.get("ende"))
        if s_ is not None and e_ is not None and e_ <= s_:
            raise ValueError("Endzeit muss nach der Startzeit liegen")
        return opts, None
    except ValueError as e:
        return None, str(e)


def bild_ordner(job):
    if not job or job.get("modus") not in ("bild", "beides") or job.get("zustand") != "fertig":
        return None
    ordner = os.path.join(BILDER, job["id"])
    return ordner if os.path.isdir(ordner) else None


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
        if "Cache-Control" not in (extra or {}):
            self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(koerper)

    def json_raus(self, obj, code=200, extra=None):
        self.sende(code, json.dumps(obj, ensure_ascii=False), extra=extra)

    @staticmethod
    def anhang(dateiname):
        """HTTP-Header sind latin-1: Umlaute nur über filename* (RFC 5987)."""
        ascii_name = dateiname.encode("ascii", "replace").decode().replace("?", "_")
        return (f'attachment; filename="{ascii_name}"; '
                f"filename*=UTF-8''{quote(dateiname)}")

    def zip_senden(self, ordner, wurzel):
        """Ordner so packen, wie das Markdown ihn erwartet: <wurzel>/bildprotokoll.md
        + <wurzel>/bilder/*.png. PNGs sind schon komprimiert -> nur speichern."""
        with tempfile.TemporaryFile() as tmp:
            with zipfile.ZipFile(tmp, "w") as z:
                for datei in ("bildprotokoll.md", "bildprotokoll.json", "bildmodus.log"):
                    pfad = os.path.join(ordner, datei)
                    if os.path.exists(pfad):
                        z.write(pfad, f"{wurzel}/{datei}", compress_type=zipfile.ZIP_DEFLATED)
                bilder = os.path.join(ordner, "bilder")
                for name in sorted(os.listdir(bilder)):
                    z.write(os.path.join(bilder, name), f"{wurzel}/bilder/{name}",
                            compress_type=zipfile.ZIP_STORED)
            groesse = tmp.tell()
            tmp.seek(0)
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(groesse))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Disposition", self.anhang(wurzel + ".zip"))
            self.end_headers()
            if self.command != "HEAD":
                shutil.copyfileobj(tmp, self.wfile, 1 << 20)

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

        if pfad == "/api/bild":
            job = job_lesen((q.get("id") or [""])[0])
            name = (q.get("datei") or [""])[0]
            ordner = bild_ordner(job)
            if not ordner or not re.fullmatch(r"bild_\d+_t[\d-]+\.png", name):
                self.json_raus({"fehler": "unbekannt"}, 404)
                return
            try:
                with open(os.path.join(ordner, "bilder", name), "rb") as f:
                    self.sende(200, f.read(), "image/png",
                               {"Cache-Control": "private, max-age=86400"})
            except OSError:
                self.json_raus({"fehler": "unbekannt"}, 404)
            return

        if pfad in ("/api/md", "/api/json", "/api/zip"):
            job = job_lesen((q.get("id") or [""])[0])
            ordner = bild_ordner(job)
            if not ordner:
                self.json_raus({"fehler": "kein Bildprotokoll"}, 404)
                return
            stamm = sicherer_name(os.path.splitext(job.get("name") or "video")[0])
            if pfad == "/api/zip":
                self.zip_senden(ordner, stamm + "_bildprotokoll")
                return
            endung = pfad.rsplit("/", 1)[1]
            with open(os.path.join(ordner, "bildprotokoll." + endung), "rb") as f:
                inhalt = f.read()
            typ = ("text/markdown; charset=utf-8" if endung == "md"
                   else "application/json; charset=utf-8")
            self.sende(200, inhalt, typ, {"Content-Disposition": self.anhang(
                f"{stamm}_bildprotokoll.{endung}")})
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
                       {"Content-Disposition": self.anhang(f"{sicherer_name(stamm)}.{endung}")})
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
            modus_wunsch = (q.get("modus") or ["auto"])[0]
            if modus_wunsch not in ("auto", "ton", "bild", "beides"):
                modus_wunsch = "auto"
            bild, fehler = bild_optionen(q)
            if fehler:
                self.json_raus({"fehler": "Bildmodus: " + fehler}, 400)
                return

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
                   "sprache": sprache, "modus_wunsch": modus_wunsch, "bild": bild,
                   "zustand": "wartet", "prozent": 0,
                   "angelegt": time.time(), "groesse": gelesen,
                   "segmente": [], "text": ""}
            job_schreiben(job)
            WARTESCHLANGE.put(jid)
            self.json_raus({"ok": True, "id": jid,
                            "position": WARTESCHLANGE.qsize()})
            return

        if pfad == "/api/nochmal":
            # fertigen Job mit anderem Modus neu rechnen - ohne neuen Upload
            # (z. B. Transkript fertig, jetzt noch die Szenenbilder dazu)
            alt = job_lesen((q.get("id") or [""])[0])
            modus_wunsch = (q.get("modus") or ["beides"])[0]
            if not alt or modus_wunsch not in ("auto", "ton", "bild", "beides"):
                self.json_raus({"fehler": "unbekannt"}, 404)
                return
            quelle = os.path.join(MEDIEN, alt.get("datei") or "")
            if not alt.get("datei") or not os.path.isfile(quelle):
                self.json_raus({"fehler": "Originaldatei nicht mehr da - bitte neu hochladen"}, 410)
                return
            bild, fehler = bild_optionen(q)
            if fehler:
                self.json_raus({"fehler": "Bildmodus: " + fehler}, 400)
                return
            jid = uuid.uuid4().hex
            dateiname = jid + os.path.splitext(alt["datei"])[1]
            ziel = os.path.join(MEDIEN, dateiname)
            try:
                os.link(quelle, ziel)
            except OSError:
                shutil.copyfile(quelle, ziel)
            job = {"id": jid, "name": alt["name"], "datei": dateiname,
                   "modell": alt.get("modell") or "small",
                   "sprache": alt.get("sprache") or "de", "modus_wunsch": modus_wunsch,
                   "bild": bild, "zustand": "wartet", "prozent": 0,
                   "angelegt": time.time(), "groesse": alt.get("groesse"),
                   "segmente": [], "text": ""}
            job_schreiben(job)
            WARTESCHLANGE.put(jid)
            self.json_raus({"ok": True, "id": jid, "position": WARTESCHLANGE.qsize()})
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
            # läuft der Job gerade, räumt der Arbeiter beim nächsten Fortschritt
            # selbst auf (JobGeloescht); hier schon mal alles Fertige weg
            job_dateien_weg(jid)
            self.json_raus({"ok": True})
            return

        self.json_raus({"fehler": "unbekannter Pfad"}, 404)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8792
    if not shutil.which("ffmpeg"):
        print("!! ffmpeg fehlt - ohne das geht keine Tonspur", flush=True)
    probleme = bildmodus.abhaengigkeiten_pruefen(tesseract_cmd=CFG.get("tesseract") or None)
    if probleme:
        print("!! Bildmodus: " + bildmodus.anleitung(probleme).replace("\n", "\n!! "),
              flush=True)
    aufraeumen()
    # abgebrochene Jobs (Neustart mitten im Lauf) wieder einreihen
    for j in jobs_liste():
        if j["zustand"] in LAUFENDE_ZUSTAENDE:
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
