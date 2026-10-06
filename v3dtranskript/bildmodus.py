#!/usr/bin/env python3
"""V3D Transkript - Bildmodus: stumme Videos als Schlüsselbilder + erkannter Text.

Für Videos ohne (hörbaren) Ton, typischerweise Bildschirmaufnahmen oder mit dem
Handy vom Monitor abgefilmt. Heraus kommt ein Ordner mit PNGs plus Markdown und
JSON, die man zusammen mit den Bildern direkt an Claude geben kann.

server.py nutzt das Modul für den Bildmodus, es läuft aber auch allein
(Windows + Ubuntu):

    python bildmodus.py video.mp4                 # Ergebnis in ./video_bildprotokoll/
    python bildmodus.py video.mp4 -o ausgabe --entzerren --start 1:30 --ende 4:00
    python bildmodus.py --pruefen                 # nur Abhängigkeiten prüfen

Ablauf:
  1. ffprobe/volumedetect: keine oder stille Tonspur -> Bildmodus
  2. ffmpeg select='eq(n,0)+gt(scene,S)+gte(t-prev_selected_t,I)' -> Kandidaten
     mit Zeitstempel und Szenenwert (EIN Dekodierlauf)
  3. optional Monitorfläche finden + Perspektive entzerren (OpenCV)
  4. Perceptual Hash gegen das zuletzt behaltene Bild -> Duplikate raus
  5. zu viele Bilder -> Schwellwert anheben (aus demselben Kandidatenvorrat)
  6. PNG (max. 1280 px breit), Tesseract deu+eng, Markdown + JSON
"""
import argparse
import datetime
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

VERSION = 1
MAX_BREITE = 1280            # Ausgabe-PNGs
ARBEITS_BREITE = 1920        # Kandidaten (Entzerren + OCR brauchen Reserve)
HASH_GROESSE = 16            # pHash 16x16 = 256 Bit; 8x8 übersieht Dialoge
SCHWELLEN_STUFEN = (0.015, 0.02, 0.03, 0.05, 0.08, 0.12, 0.15, 0.2, 0.3, 0.4, 0.6, 1.0)
UNSICHER_UNTER = 40.0        # einzelne Wörter unter dieser Konfidenz melden
SICHER_AB = 70.0             # Wörter ab dieser Konfidenz zählen für die Textprüfung
SICHER_GLEICH = 4            # Hash-Abstand bis hier: gleich, ohne Textprüfung

# Gemessen an Testvideos (tests/testvideo.py): ffmpegs Szenenwert ist bei
# Bildschirmaufnahmen winzig - kompletter Schrittwechsel im gleichen Fenster
# 0,026-0,033, Mausbewegung 0,0008. Mit 0,15 fiele fast jeder Schritt durch.
# pHash-Abstand (256 Bit): Rauschen/Wackeln abgefilmt 2-10, Mauszeiger 12-20,
# eine Zeile anders 36, Schrittwechsel 42-82; nur EINE Ziffer anders: 8.
STANDARD = {
    "schwelle": 0.01,        # 10x über dem Rauschboden von Bildschirmaufnahmen
    "intervall": 10.0,       # spätestens alle 10 s ein Bild
    "max_bilder": 60,
    "toleranz": 24,          # Hamming-Abstand (von 256 Bit), bis zu dem Bilder als gleich gelten
    "entzerren": False,
    "ocr": True,
    "sprachen": "deu+eng",
    "ocr_min_konfidenz": 75.0,   # gemessen: sauberer Text 85-95 %, Buchstabensalat noch 57-70 %
    "stille_db": -50.0,      # Spitzenpegel darunter = stille Tonspur
}

WINDOWS = sys.platform.startswith("win")
_OHNE_FENSTER = {"creationflags": subprocess.CREATE_NO_WINDOW} if WINDOWS else {}


class BildmodusFehler(RuntimeError):
    """Fehler mit einer Meldung, die man dem Nutzer so zeigen kann."""


class AbhaengigkeitFehler(BildmodusFehler):
    pass


# ---------------------------------------------------------------- Protokoll
class Protokoll:
    """Sammelt Meldungen für Log-Datei, JSON und Konsole/Server-Journal."""

    def __init__(self, echo=None):
        self.eintraege = []
        self.echo = echo
        self._sperre = threading.Lock()

    def _neu(self, stufe, text):
        with self._sperre:
            self.eintraege.append({"zeit": datetime.datetime.now().isoformat(timespec="seconds"),
                                   "stufe": stufe, "text": text})
        if self.echo:
            self.echo(stufe, text)

    def info(self, text):
        self._neu("info", text)

    def warnung(self, text):
        self._neu("warnung", text)

    def als_text(self):
        return "\n".join(f"{e['zeit']} [{e['stufe']}] {e['text']}" for e in self.eintraege) + "\n"


# ---------------------------------------------------------------- kleine Hilfen
def _lauf(befehl, timeout=600, eingabe=None, env=None):
    """subprocess.run mit Bytes rein/raus - Dekodieren macht der Aufrufer,
    weil ffmpeg unter Windows Dateinamen in der Konsolen-Codepage ausgibt."""
    return subprocess.run(befehl, input=eingabe, capture_output=True, timeout=timeout,
                          env=env, **_OHNE_FENSTER)


def _dekodieren(b):
    return (b or b"").decode("utf-8", errors="replace")


def _letzte_fehlerzeile(stderr_text):
    grund = ""
    for z in stderr_text.strip().splitlines():
        z = z.strip()
        if z and not z.startswith(("lib", "ffmpeg version", "ffprobe version", "built with",
                                   "configuration:", "Input #", "Stream #", "Metadata:",
                                   "Duration:", "[Parsed_")):
            grund = z
    return grund[:240]


def zeit_lesen(wert):
    """'90', '90.5', '1:30', '01:02:03.5' -> Sekunden; leer -> None."""
    if wert is None:
        return None
    if isinstance(wert, (int, float)):
        if wert < 0:
            raise ValueError("Zeit darf nicht negativ sein")
        return float(wert)
    s = str(wert).strip().replace(",", ".")
    if not s:
        return None
    teile = s.split(":")
    if len(teile) > 3 or not all(re.fullmatch(r"\d+(\.\d+)?", t) for t in teile):
        raise ValueError(f"Zeit '{wert}' nicht lesbar - erlaubt sind z. B. 90, 1:30 oder 00:01:30.5")
    sek = 0.0
    for t in teile:
        sek = sek * 60 + float(t)
    return sek


def zeit_text(sek, datei=False):
    ms = int(round(max(0.0, sek) * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    if datei:                       # Windows verbietet ':' im Dateinamen
        return f"{h:02d}-{m:02d}-{s:02d}-{ms:03d}"
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def _bild_lesen(pfad):
    """cv2.imread scheitert unter Windows an Umlauten im Pfad - darum über numpy."""
    import cv2
    import numpy as np
    daten = np.fromfile(pfad, dtype=np.uint8)
    bild = cv2.imdecode(daten, cv2.IMREAD_COLOR)
    if bild is None:
        raise BildmodusFehler(f"Bild nicht lesbar: {os.path.basename(pfad)}")
    return bild


def _bild_schreiben(pfad, bild):
    import cv2
    ok, puffer = cv2.imencode(".png", bild, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    if not ok:
        raise BildmodusFehler(f"PNG ließ sich nicht schreiben: {os.path.basename(pfad)}")
    puffer.tofile(pfad)


def _verkleinern(bild, breite):
    import cv2
    h, w = bild.shape[:2]
    if w <= breite:
        return bild
    return cv2.resize(bild, (breite, max(1, round(h * breite / w))), interpolation=cv2.INTER_AREA)


# ---------------------------------------------------------------- Abhängigkeiten
def _plattform(plattform=None):
    if plattform:
        return plattform
    if WINDOWS:
        return "windows"
    return "mac" if sys.platform == "darwin" else "linux"


def tesseract_finden(bevorzugt=None):
    """Reihenfolge: ausdrücklich übergeben, TESSERACT_CMD, PATH, Windows-Standardorte
    (der winget-Installer von UB Mannheim trägt sich NICHT in den PATH ein)."""
    kandidaten = [bevorzugt, os.environ.get("TESSERACT_CMD"), shutil.which("tesseract")]
    if WINDOWS:
        for basis in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"),
                      os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs")):
            if basis:
                kandidaten.append(os.path.join(basis, "Tesseract-OCR", "tesseract.exe"))
    for k in kandidaten:
        if k and os.path.isfile(k):
            return k
    return None


def tesseract_sprachen(befehl):
    try:
        aus = _lauf([befehl, "--list-langs"], timeout=30)
    except (OSError, subprocess.SubprocessError):
        return None
    # Tesseract 3 schrieb die Liste nach stderr, 4/5 nach stdout
    zeilen = (_dekodieren(aus.stdout) + "\n" + _dekodieren(aus.stderr)).splitlines()
    return {z.strip() for z in zeilen
            if z.strip() and not z.lower().startswith(("list of", "error", "warning"))}


_PIP = {"numpy": "numpy", "cv2": "opencv-python-headless", "PIL": "Pillow",
        "imagehash": "ImageHash"}


def abhaengigkeiten_pruefen(ocr=True, sprachen=STANDARD["sprachen"], plattform=None,
                            tesseract_cmd=None, which=shutil.which,
                            modul_da=lambda m: importlib.util.find_spec(m) is not None,
                            tesseract_suche=tesseract_finden, sprachliste=tesseract_sprachen):
    """Liefert eine Liste von Problemen: {"was", "meldung", "abhilfe"}.
    which/modul_da/tesseract_suche/sprachliste sind nur für Tests austauschbar."""
    pf = _plattform(plattform)
    probleme = []

    for prog in ("ffmpeg", "ffprobe"):
        if not which(prog):
            probleme.append({"was": prog, "meldung": f"{prog} nicht gefunden (nicht im PATH).",
                             "abhilfe": {
                                 "windows": "winget install --id Gyan.FFmpeg -e\n"
                                            "(danach ein NEUES Terminal öffnen, damit der PATH greift)",
                                 "linux": "sudo apt install ffmpeg",
                                 "mac": "brew install ffmpeg"}[pf]})
            break                               # beide stecken im selben Paket

    fehlend = [paket for modul, paket in _PIP.items() if not modul_da(modul)]
    if fehlend:
        py = "py" if pf == "windows" else "python3"
        probleme.append({"was": "python",
                         "meldung": "Python-Pakete fehlen: " + ", ".join(fehlend),
                         "abhilfe": f"{py} -m pip install -r requirements-bildmodus.txt\n"
                                    f"(oder einzeln: {py} -m pip install " + " ".join(fehlend) + ")"})

    if ocr:
        befehl = tesseract_suche(tesseract_cmd)
        if not befehl:
            probleme.append({"was": "tesseract",
                             "meldung": "Tesseract (Texterkennung) nicht gefunden.",
                             "abhilfe": {
                                 "windows": "winget install --id UB-Mannheim.TesseractOCR -e\n"
                                            "Landet unter C:\\Program Files\\Tesseract-OCR und wird dort "
                                            "automatisch gefunden (sonst Umgebungsvariable TESSERACT_CMD "
                                            "auf tesseract.exe setzen). Deutsches Sprachpaket siehe unten, "
                                            "falls es danach noch fehlt.",
                                 "linux": "sudo apt install tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng",
                                 "mac": "brew install tesseract tesseract-lang"}[pf]})
        else:
            vorhanden = sprachliste(befehl)
            if vorhanden is None:
                probleme.append({"was": "tesseract",
                                 "meldung": f"Tesseract unter {befehl} lässt sich nicht starten.",
                                 "abhilfe": "Installation reparieren oder TESSERACT_CMD auf eine "
                                            "funktionierende tesseract-Datei setzen."})
            else:
                for code in [s for s in sprachen.split("+") if s]:
                    if code in vorhanden:
                        continue
                    if pf == "windows":
                        tessdata = os.path.join(os.path.dirname(befehl), "tessdata")
                        abhilfe = ("PowerShell ALS ADMINISTRATOR:\n"
                                   f"Invoke-WebRequest -Uri https://github.com/tesseract-ocr/tessdata_fast/"
                                   f"raw/main/{code}.traineddata -OutFile \"{tessdata}\\{code}.traineddata\"")
                    elif pf == "mac":
                        abhilfe = "brew install tesseract-lang"
                    else:
                        abhilfe = f"sudo apt install tesseract-ocr-{code}"
                    probleme.append({"was": f"tesseract-{code}",
                                     "meldung": f"Tesseract-Sprachpaket '{code}' fehlt "
                                                f"(vorhanden: {', '.join(sorted(vorhanden)) or 'keins'}).",
                                     "abhilfe": abhilfe})
    return probleme


def anleitung(probleme):
    if not probleme:
        return "Alle Abhängigkeiten sind da."
    teile = ["Es fehlt etwas:"]
    for p in probleme:
        teile.append(f"\n- {p['meldung']}\n  Installieren mit:\n    "
                     + p["abhilfe"].replace("\n", "\n    "))
    return "\n".join(teile)


# ---------------------------------------------------------------- Video + Ton
def video_info(pfad):
    if not os.path.isfile(pfad):
        raise BildmodusFehler(f"Datei nicht gefunden: {pfad}")
    if os.path.getsize(pfad) == 0:
        raise BildmodusFehler("Die Datei ist leer (0 Byte).")
    try:
        aus = _lauf(["ffprobe", "-v", "error", "-show_entries",
                     "format=duration,format_name:stream=index,codec_type,codec_name,width,height,"
                     "avg_frame_rate,duration,channels,sample_rate",
                     "-of", "json", pfad], timeout=120)
    except FileNotFoundError:
        raise AbhaengigkeitFehler(anleitung(abhaengigkeiten_pruefen(ocr=False)))
    except subprocess.TimeoutExpired:
        raise BildmodusFehler("ffprobe hängt an dieser Datei (über 2 Minuten) - Datei beschädigt?")
    try:
        daten = json.loads(_dekodieren(aus.stdout) or "{}")
    except ValueError:
        daten = {}
    stroeme = daten.get("streams") or []
    if aus.returncode != 0 or not stroeme:
        grund = _letzte_fehlerzeile(_dekodieren(aus.stderr))
        raise BildmodusFehler("Die Datei ist kein lesbares Video"
                              + (f" (ffprobe: {grund})" if grund else "")
                              + " - beschädigt oder unvollständig übertragen?")

    def zahl(x):
        try:
            v = float(x)
            return v if v == v and v > 0 else None      # NaN/0 raus
        except (TypeError, ValueError):
            return None

    video = next((s for s in stroeme if s.get("codec_type") == "video"
                  and s.get("codec_name") not in ("mjpeg", "png", "bmp")), None)
    if video is None:                                   # Titelbild als einzige Bildspur
        video = next((s for s in stroeme if s.get("codec_type") == "video"), None)
    audio = [s for s in stroeme if s.get("codec_type") == "audio"]
    dauer = zahl((daten.get("format") or {}).get("duration"))
    if dauer is None:
        dauer = max([zahl(s.get("duration")) or 0 for s in stroeme] or [0]) or None
    fps = None
    if video and video.get("avg_frame_rate") and "/" in video["avg_frame_rate"]:
        z, n = video["avg_frame_rate"].split("/", 1)
        fps = round(float(z) / float(n), 3) if zahl(z) and zahl(n) else None
    return {
        "dauer": round(dauer, 3) if dauer else None,
        "format": (daten.get("format") or {}).get("format_name"),
        "video": None if not video else {
            "codec": video.get("codec_name"), "breite": video.get("width"),
            "hoehe": video.get("height"), "fps": fps},
        "audio": [{"codec": a.get("codec_name"), "kanaele": a.get("channels"),
                   "abtastrate": a.get("sample_rate")} for a in audio],
    }


def tonspur_pruefen(pfad, info=None, start=None, ende=None, stille_db=STANDARD["stille_db"]):
    """-> {"hat_ton", "still", "max_db", "mittel_db", "grund"}"""
    info = info or video_info(pfad)
    if not info["audio"]:
        return {"hat_ton": False, "still": True, "max_db": None, "mittel_db": None,
                "grund": "keine Tonspur"}
    befehl = ["ffmpeg", "-hide_banner", "-nostdin", "-nostats"]
    if start:
        befehl += ["-ss", f"{start:.3f}"]
    befehl += ["-i", pfad]
    if ende is not None:
        befehl += ["-t", f"{max(0.1, ende - (start or 0)):.3f}"]
    befehl += ["-map", "0:a:0", "-vn", "-sn", "-dn", "-af", "volumedetect", "-f", "null", "-"]
    try:
        aus = _lauf(befehl, timeout=1800)
    except subprocess.TimeoutExpired:
        return {"hat_ton": True, "still": False, "max_db": None, "mittel_db": None,
                "grund": "Lautstärkeanalyse abgebrochen (Zeitlimit) - Ton angenommen"}
    text = _dekodieren(aus.stderr)
    m_max = re.search(r"max_volume:\s*(-?inf|-?[\d.]+) dB", text)
    m_mit = re.search(r"mean_volume:\s*(-?inf|-?[\d.]+) dB", text)
    if not m_max:
        return {"hat_ton": True, "still": True, "max_db": None, "mittel_db": None,
                "grund": "Tonspur nicht dekodierbar ("
                         + (_letzte_fehlerzeile(text) or "keine Pegel") + ")"}
    max_db = -999.0 if "inf" in m_max.group(1) else float(m_max.group(1))   # -inf = digital still
    mit_db = None
    if m_mit and "inf" not in m_mit.group(1):
        mit_db = float(m_mit.group(1))
    still = max_db <= stille_db
    return {"hat_ton": True, "still": still, "max_db": max_db, "mittel_db": mit_db,
            "grund": (f"Tonspur still (Spitze {max_db:.1f} dB ≤ {stille_db:.0f} dB)" if still
                      else f"Tonspur hörbar (Spitze {max_db:.1f} dB)")}


def modus_erkennen(pfad, start=None, ende=None, stille_db=STANDARD["stille_db"]):
    """-> (modus "bild"|"ton", grund, info, ton)"""
    info = video_info(pfad)
    if info["video"] is None:
        return "ton", "keine Bildspur (reine Tonaufnahme)", info, None
    ton = tonspur_pruefen(pfad, info, start, ende, stille_db)
    return ("bild" if ton["still"] else "ton"), ton["grund"], info, ton


# ---------------------------------------------------------------- Kandidaten per ffmpeg
_FPS_OPTION = None


def _fps_option():
    """-vsync ist ab ffmpeg 5.1 veraltet (-fps_mode), 4.x kennt nur -vsync."""
    global _FPS_OPTION
    if _FPS_OPTION is None:
        try:
            kopf = _dekodieren(_lauf(["ffmpeg", "-hide_banner", "-version"], timeout=30).stdout)
        except (OSError, subprocess.SubprocessError):
            kopf = ""
        m = re.search(r"version\s+n?(\d+)\.(\d+)", kopf)
        alt = bool(m) and (int(m.group(1)), int(m.group(2))) < (5, 1)
        _FPS_OPTION = ["-vsync", "vfr"] if alt else ["-fps_mode", "vfr"]
    return _FPS_OPTION


_META_ZEIT = re.compile(r"\[Parsed_metadata_\d+ @ [^\]]+\] frame:\s*\d+\s+pts:\s*-?\d+\s+pts_time:\s*(-?[\d.eE+-]+)")
_META_SZENE = re.compile(r"\[Parsed_metadata_\d+ @ [^\]]+\] lavfi\.scene_score=([\d.eE+-]+)")


def _metadaten_lesen(text):
    """Paare (pts_time, scene_score) in Ausgabereihenfolge."""
    paare, zeit = [], None
    for zeile in text.splitlines():
        m = _META_ZEIT.search(zeile)
        if m:
            zeit = float(m.group(1))
            continue
        m = _META_SZENE.search(zeile)
        if m and zeit is not None:
            paare.append((zeit, float(m.group(1))))
            zeit = None
    return paare


def _kandidaten_lauf(pfad, ordner, start, t_grenze, laenge, schwelle, intervall, pool_max,
                     fortschritt, abbrechen_pruefen):
    """Ein ffmpeg-Lauf. t_grenze = -t (None = bis zum Ende), laenge nur für den
    Fortschritt. -> (kandidaten, ueberlauf, ffmpeg_warnung)"""
    for alt in os.listdir(ordner):
        os.remove(os.path.join(ordner, alt))
    auswahl = f"select='eq(n,0)+gt(scene,{schwelle:.4f})+gte(t-prev_selected_t,{intervall:.3f})'"
    kette = (f"{auswahl},metadata=mode=print:key=lavfi.scene_score,"
             f"scale='min(iw,{ARBEITS_BREITE})':-2:flags=area,format=rgb24")
    befehl = ["ffmpeg", "-hide_banner", "-nostdin", "-nostats", "-loglevel", "info", "-y"]
    if start:
        befehl += ["-ss", f"{start:.3f}"]
    befehl += ["-i", pfad]
    if t_grenze is not None:
        befehl += ["-t", f"{t_grenze:.3f}"]
    # '%' im Ordnernamen würde der image2-Muxer als Platzhalter lesen
    muster = os.path.join(ordner.replace("%", "%%"), "k%06d.png")
    befehl += ["-map", "0:v:0", "-an", "-sn", "-dn", "-vf", kette] + _fps_option() + [
        "-f", "image2", muster]

    log_pfad = os.path.join(os.path.dirname(ordner), "ffmpeg_kandidaten.log")
    ueberlauf = False
    with open(log_pfad, "wb") as log:
        proc = subprocess.Popen(befehl, stdout=subprocess.DEVNULL, stderr=log, **_OHNE_FENSTER)
        try:
            gelesen = 0
            letzte_zeit = 0.0
            while proc.poll() is None:
                time.sleep(0.4)
                if abbrechen_pruefen:
                    abbrechen_pruefen()
                anzahl = sum(1 for e in os.scandir(ordner) if e.name.endswith(".png"))
                if anzahl > pool_max:
                    ueberlauf = True
                    proc.kill()
                    break
                with open(log_pfad, "rb") as f:
                    f.seek(gelesen)
                    neu = f.read()
                    gelesen += len(neu)
                for m in _META_ZEIT.finditer(_dekodieren(neu)):
                    letzte_zeit = float(m.group(1))
                if fortschritt and laenge:
                    fortschritt(min(1.0, letzte_zeit / laenge), anzahl)
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.wait()

    with open(log_pfad, "rb") as f:
        stderr = _dekodieren(f.read())
    if ueberlauf:
        return None, True, None
    dateien = sorted(n for n in os.listdir(ordner) if n.endswith(".png"))
    paare = _metadaten_lesen(stderr)
    warnung = None
    if proc.returncode != 0:
        grund = _letzte_fehlerzeile(stderr) or f"Rückgabewert {proc.returncode}"
        if not dateien:
            if re.search(r"Invalid data|moov atom|could not find codec|Decoder .* not found",
                         stderr, re.I):
                raise BildmodusFehler("ffmpeg kann die Bildspur nicht dekodieren - Datei "
                                      f"beschädigt oder Format nicht unterstützt ({grund}).")
            raise BildmodusFehler(f"ffmpeg brach ab, ohne ein Bild zu liefern ({grund}).")
        warnung = (f"ffmpeg meldete einen Fehler (Datei teilweise beschädigt?), "
                   f"verwendet werden die {len(dateien)} lesbaren Bilder: {grund}")
    if len(paare) != len(dateien):
        n = min(len(paare), len(dateien))
        warnung = ((warnung + " / ") if warnung else "") + (
            f"{len(dateien)} Bilder, aber {len(paare)} Zeitstempel - nutze die ersten {n}")
        for ueberzaehlig in dateien[n:]:
            os.remove(os.path.join(ordner, ueberzaehlig))
        dateien, paare = dateien[:n], paare[:n]
    kandidaten = []
    for i, (datei, (t, szene)) in enumerate(zip(dateien, paare)):
        kandidaten.append({"datei": os.path.join(ordner, datei), "t": (start or 0.0) + t,
                           "szenenwert": round(szene, 4), "erstes": i == 0})
    return kandidaten, False, warnung


# ---------------------------------------------------------------- Entzerren
def _punkte_ordnen(pts):
    import numpy as np
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)],
                     pts[np.argmax(s)], pts[np.argmax(d)]], dtype=np.float32)  # ol, or, ur, ul


def _winkel_ok(quad):
    import numpy as np
    for i in range(4):
        a, b, c = quad[i - 1], quad[i], quad[(i + 1) % 4]
        v1, v2 = a - b, c - b
        cos = float(np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-9))
        winkel = np.degrees(np.arccos(max(-1.0, min(1.0, cos))))
        if not 50 <= winkel <= 130:
            return False
    return True


def _ui_rechteck(quad, breite, hoehe):
    """Exakt achsparallel UND am Bildrand: das ist ein Bereich einer echten
    Bildschirmaufnahme (Inhaltsfläche, Seitenleiste), kein abgefilmter Monitor -
    der steht nie pixelgenau gerade im Handybild und bis an den Rand."""
    import numpy as np
    for i in range(4):
        dx, dy = quad[(i + 1) % 4] - quad[i]
        winkel = abs(np.degrees(np.arctan2(dy, dx))) % 90
        if min(winkel, 90 - winkel) > 0.8:
            return False
    return any(x <= 2 or y <= 2 or x >= breite - 3 or y >= hoehe - 3 for x, y in quad)


def monitor_finden(bild):
    """Sucht die Monitorfläche als größtes plausibles Viereck.
    -> 4x2 float32 (oben links, oben rechts, unten rechts, unten links) oder None."""
    import cv2
    import numpy as np
    h, w = bild.shape[:2]
    f = 640.0 / w if w > 640 else 1.0
    klein = cv2.resize(bild, (round(w * f), round(h * f)), interpolation=cv2.INTER_AREA) if f < 1 else bild
    kh, kw = klein.shape[:2]
    flaeche = float(kh * kw)
    grau = cv2.GaussianBlur(cv2.cvtColor(klein, cv2.COLOR_BGR2GRAY), (5, 5), 0)

    konturen = []
    # a) Kanten: der Monitorrand ist fast immer die längste geschlossene Kante
    kanten = cv2.dilate(cv2.Canny(grau, 30, 90), np.ones((3, 3), np.uint8), iterations=2)
    konturen += list(cv2.findContours(kanten, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)[0])
    # b) Helligkeit: leuchtender Bildschirm vor dunklerer Umgebung
    _, sw = cv2.threshold(grau, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    sw = cv2.morphologyEx(sw, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8), iterations=2)
    konturen += list(cv2.findContours(sw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0])

    gefunden = []                               # (Fläche, Viereck)
    for k in konturen:
        if cv2.contourArea(k) < 0.12 * flaeche:
            continue
        huelle = cv2.convexHull(k)
        h_flaeche = cv2.contourArea(huelle)
        umfang = cv2.arcLength(huelle, True)
        for eps in (0.02, 0.03, 0.05, 0.08):
            naeherung = cv2.approxPolyDP(huelle, eps * umfang, True)
            if len(naeherung) == 4:
                break
        else:
            continue
        if not cv2.isContourConvex(naeherung):
            continue
        q_flaeche = cv2.contourArea(naeherung)
        if q_flaeche > 0.97 * flaeche:          # ganzes Bild = schon ein Bildschirmfoto
            continue
        if not 0.85 <= q_flaeche / max(h_flaeche, 1.0) <= 1.15:
            continue
        quad = _punkte_ordnen(naeherung)
        if not _winkel_ok(quad):
            continue
        if _ui_rechteck(quad, kw, kh):
            continue
        breite = max(np.linalg.norm(quad[1] - quad[0]), np.linalg.norm(quad[2] - quad[3]))
        hoehe = max(np.linalg.norm(quad[3] - quad[0]), np.linalg.norm(quad[2] - quad[1]))
        if not 0.3 <= breite / max(hoehe, 1.0) <= 3.5:
            continue
        gefunden.append((q_flaeche, quad))
    if not gefunden:
        return None
    return (max(gefunden, key=lambda x: x[0])[1] / f).astype(np.float32)


def entzerren(bild, quad):
    import cv2
    import numpy as np
    ol, orr, ur, ul = quad
    breite = int(round(max(np.linalg.norm(orr - ol), np.linalg.norm(ur - ul))))
    hoehe = int(round(max(np.linalg.norm(ul - ol), np.linalg.norm(ur - orr))))
    if breite > ARBEITS_BREITE:
        hoehe = int(round(hoehe * ARBEITS_BREITE / breite))
        breite = ARBEITS_BREITE
    ziel = np.array([[0, 0], [breite - 1, 0], [breite - 1, hoehe - 1], [0, hoehe - 1]], np.float32)
    matrix = cv2.getPerspectiveTransform(quad.astype(np.float32), ziel)
    gerade = cv2.warpPerspective(bild, matrix, (breite, hoehe), flags=cv2.INTER_CUBIC,
                                 borderMode=cv2.BORDER_REPLICATE)
    return _rand_abschneiden(gerade)


def _rand_abschneiden(bild, max_anteil=0.12):
    """Das gefundene Viereck ist meist die Außenkante des Gehäuses. Nach dem
    Entzerren liegt der Rahmen als gleichmäßig dunkler Streifen an den Kanten -
    solche Zeilen/Spalten (dunkel UND ohne Struktur) werden abgeschnitten.
    Zeilen mit Inhalt (auch dunkle Titelleisten mit Schrift) bleiben stehen."""
    import cv2
    import numpy as np
    grau = cv2.cvtColor(bild, cv2.COLOR_BGR2GRAY).astype(np.float32)
    h, w = grau.shape

    def rand(profil_mittel, profil_streu, grenze):
        n = 0
        while n < grenze and profil_mittel[n] < 50 and profil_streu[n] < 14:
            n += 1
        return n

    zm, zs = grau.mean(axis=1), grau.std(axis=1)
    sm, ss = grau.mean(axis=0), grau.std(axis=0)
    oben = rand(zm, zs, int(h * max_anteil))
    unten = rand(zm[::-1], zs[::-1], int(h * max_anteil))
    links = rand(sm, ss, int(w * max_anteil))
    rechts = rand(sm[::-1], ss[::-1], int(w * max_anteil))
    if oben + unten >= h * 0.5 or links + rechts >= w * 0.5:
        return bild                              # ganzes Bild dunkel - nichts anfassen
    return bild[oben:h - unten, links:w - rechts]


def aufbereiten(bild, breite=MAX_BREITE):
    """Für abgefilmte Monitore: Moiré dämpfen, Kontrast heben, nachschärfen."""
    import cv2
    # Moiré ist ein feines Interferenzmuster: erst leicht weichzeichnen, dann
    # flächengemittelt verkleinern, Reste per Non-Local-Means glätten
    bild = cv2.GaussianBlur(bild, (0, 0), 0.7)
    bild = _verkleinern(bild, breite)
    bild = cv2.fastNlMeansDenoisingColored(bild, None, 4, 4, 5, 15)
    lab = cv2.cvtColor(bild, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(l)
    bild = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)
    weich = cv2.GaussianBlur(bild, (0, 0), 1.2)
    return cv2.addWeighted(bild, 1.6, weich, -0.6, 0)


# ---------------------------------------------------------------- Hash + Auswahl
def _phash(bild):
    import cv2
    import imagehash
    from PIL import Image
    klein = _verkleinern(bild, 512)
    return imagehash.phash(Image.fromarray(cv2.cvtColor(klein, cv2.COLOR_BGR2GRAY)),
                           hash_size=HASH_GROESSE)


def _nach_schwelle(kandidaten, schwelle, intervall):
    """Wendet Schwelle + Mindestintervall auf den Kandidatenvorrat an - dieselbe
    Regel wie der ffmpeg-select, nur ohne neu zu dekodieren."""
    gewaehlt, letzte = [], None
    for k in kandidaten:
        if k["erstes"]:
            grund = "start"
        elif k["szenenwert"] > schwelle:
            grund = "szenenwechsel"
        elif letzte is not None and k["t"] - letzte >= intervall - 1e-3:
            grund = "intervall"
        else:
            continue
        gewaehlt.append(dict(k, grund=grund))
        letzte = k["t"]
    return gewaehlt


def _duplikate_entfernen(gewaehlt, toleranz, textpruefung=None):
    """Vergleich immer mit dem zuletzt BEHALTENEN Bild: ein Rücksprung auf eine
    frühere Ansicht bleibt als eigener Schritt erhalten.

    textpruefung(neu, alt) -> True, wenn sich der erkannte Text unterscheidet.
    Sie entscheidet nur Grenzfälle (SICHER_GLEICH < Abstand <= toleranz): pHash
    kann eine geänderte Ziffer (Abstand ~8) nicht von einem Mauszeiger (~12-20)
    trennen, die Texterkennung schon.
    -> (behalten, anzahl_entfernt, anzahl_textgeprueft, anzahl_wegen_text_behalten)"""
    behalten, weg, geprueft, wegen_text = [], 0, 0, 0
    for k in gewaehlt:
        if behalten:
            abstand = k["hash"] - behalten[-1]["hash"]
            text_anders = False
            if abstand <= toleranz:
                if textpruefung is None or abstand <= SICHER_GLEICH:
                    weg += 1
                    continue
                geprueft += 1
                if not textpruefung(k, behalten[-1]):
                    weg += 1
                    continue
                text_anders = True
                wegen_text += 1
            k = dict(k, hash_abstand=int(abstand), text_geaendert=text_anders)
        else:
            k = dict(k, hash_abstand=None, text_geaendert=False)
        behalten.append(k)
    return behalten, weg, geprueft, wegen_text


def _wort(w):
    return "".join(c for c in w.lower() if c.isalnum())


def _text_unterscheidet(a, b):
    """Ein sicher erkanntes Wort der einen Seite fehlt der anderen ganz."""
    if a.get("fehler") or b.get("fehler"):
        return False
    return bool((a["_sicher"] - b["_alle"]) or (b["_sicher"] - a["_alle"]))


# ---------------------------------------------------------------- OCR
def _tsv_auswerten(tsv, min_konfidenz):
    zeilen = {}
    reihenfolge = []
    konf_summe, zeichen, unsicher = 0.0, 0, []
    sicher, alle = set(), set()
    kopf = None
    for zeile in tsv.splitlines():
        teile = zeile.split("\t")
        if kopf is None:
            kopf = teile
            continue
        if len(teile) != len(kopf):
            continue
        d = dict(zip(kopf, teile))
        if d.get("level") != "5":
            continue
        wort = (d.get("text") or "").strip()
        try:
            konf = float(d.get("conf", "-1"))
        except ValueError:
            konf = -1.0
        if not wort:
            continue
        # Rauschen aus Symbolen/Rahmenlinien (|, —, ®) nicht als Text führen
        if konf < 30 and not any(c.isalnum() for c in wort):
            continue
        schluessel = (int(d["block_num"]), int(d["par_num"]), int(d["line_num"]))
        if schluessel not in zeilen:
            zeilen[schluessel] = []
            reihenfolge.append(schluessel)
        zeilen[schluessel].append(wort)
        norm = _wort(wort)
        if norm:
            alle.add(norm)
            if konf >= SICHER_AB:
                sicher.add(norm)
        if konf >= 0:
            konf_summe += konf * len(wort)
            zeichen += len(wort)
            if konf < UNSICHER_UNTER and len(unsicher) < 40:
                unsicher.append(wort)
    text_teile, letzter_block = [], None
    for s in reihenfolge:
        if letzter_block is not None and s[0] != letzter_block:
            text_teile.append("")
        text_teile.append(" ".join(zeilen[s]))
        letzter_block = s[0]
    woerter = sum(len(v) for v in zeilen.values())
    konfidenz = round(konf_summe / zeichen, 1) if zeichen else None
    return {"text": "\n".join(text_teile).strip(), "konfidenz": konfidenz,
            "schwach": konfidenz is not None and konfidenz < min_konfidenz,
            "woerter": woerter, "unsichere_woerter": unsicher, "fehler": None,
            "_sicher": sicher, "_alle": alle}     # _-Felder nur intern (Textprüfung)


def ocr(bild, befehl, sprachen=STANDARD["sprachen"], min_konfidenz=STANDARD["ocr_min_konfidenz"],
        glaetten=False):
    """Tesseract über stdin/stdout (kein Pfad-Ärger mit Umlauten unter Windows).
    Schwache Erkennung wird gekennzeichnet, nicht verworfen."""
    import cv2
    grau = cv2.cvtColor(bild, cv2.COLOR_BGR2GRAY)
    if glaetten:
        grau = cv2.GaussianBlur(grau, (0, 0), 0.6)
    h, w = grau.shape[:2]
    if w < 1800:                   # Bildschirmschrift ist für Tesseract meist zu klein
        f = min(3.0, 2400.0 / w)
        grau = cv2.resize(grau, (round(w * f), round(h * f)), interpolation=cv2.INTER_CUBIC)
    ok, png = cv2.imencode(".png", grau)
    if not ok:
        return {"text": "", "konfidenz": None, "schwach": True, "woerter": 0,
                "unsichere_woerter": [], "fehler": "Bild ließ sich nicht kodieren"}
    env = dict(os.environ, OMP_THREAD_LIMIT="1")   # wir parallelisieren selbst
    try:
        aus = _lauf([befehl, "stdin", "stdout", "-l", sprachen, "--psm", "3", "tsv"],
                    eingabe=png.tobytes(), timeout=300, env=env)
    except subprocess.TimeoutExpired:
        return {"text": "", "konfidenz": None, "schwach": True, "woerter": 0,
                "unsichere_woerter": [], "fehler": "Tesseract-Zeitlimit (5 min) überschritten"}
    except OSError as e:
        return {"text": "", "konfidenz": None, "schwach": True, "woerter": 0,
                "unsichere_woerter": [], "fehler": f"Tesseract startet nicht: {e}"}
    if aus.returncode != 0:
        return {"text": "", "konfidenz": None, "schwach": True, "woerter": 0,
                "unsichere_woerter": [],
                "fehler": "Tesseract-Fehler: " + (_letzte_fehlerzeile(_dekodieren(aus.stderr))
                                                   or f"Rückgabewert {aus.returncode}")}
    return _tsv_auswerten(_dekodieren(aus.stdout), min_konfidenz)


# ---------------------------------------------------------------- Ausgabe
def _zaun(text):
    """Code-Zaun, der länger ist als jede Backtick-Folge im OCR-Text."""
    laengste = max([len(m) for m in re.findall(r"`+", text)] or [0])
    return "`" * max(3, laengste + 1)


def markdown_bauen(erg):
    v = erg["video"]
    e = erg["einstellungen"]
    s = erg["statistik"]
    a = erg["ausschnitt"]
    z = []
    beides = erg.get("modus") == "beides"
    z.append(f"# Bildprotokoll: {erg['quelle']}")
    z.append("")
    if beides:
        z.append("Video mit Ton, zerlegt in Szenenbilder. Unter jedem Bild steht, was ab "
                 "diesem Zeitpunkt bis zum nächsten Bild gesprochen wird (Spracherkennung), "
                 "und der Text, der im Bild zu sehen ist (OCR). Beides ist maschinell erkannt "
                 "und kann Fehler enthalten - im Zweifel gilt das Bild.")
        z.append("")
        z.append("**Auftrag für die Auswertung:** Fasse das Video Schritt für Schritt zusammen: "
                 "was gezeigt und was dazu gesagt wird. Nenne zu jedem Schritt die Bildnummer "
                 "und den Zeitstempel. Lücken zwischen zwei Bildern bitte als Vermutung "
                 "kennzeichnen.")
    else:
        z.append("Stummes Video, zerlegt in Schlüsselbilder. Jedes Bild zeigt einen sichtbar "
                 "neuen Zustand des Bildschirms, in zeitlicher Reihenfolge. Der Text unter "
                 "jedem Bild ist maschinell erkannt (OCR) und kann Fehler enthalten - im Zweifel "
                 "gilt das Bild.")
        z.append("")
        z.append("**Auftrag für die Auswertung:** Beschreibe anhand der Bilder Schritt für Schritt, "
                 "was die Person macht: welches Programm bzw. welche Seite, welche Menüs, "
                 "Schaltflächen und Eingaben, und was am Ende herauskommt. Nenne zu jedem Schritt "
                 "die Bildnummer und den Zeitstempel. Lücken zwischen zwei Bildern bitte als "
                 "Vermutung kennzeichnen.")
    z.append("")
    z.append("| | |")
    z.append("|---|---|")
    z.append(f"| Video | `{erg['quelle']}` |")
    if v.get("dauer"):
        z.append(f"| Länge | {zeit_text(v['dauer'])} |")
    if v.get("breite"):
        z.append(f"| Auflösung | {v['breite']}×{v['hoehe']}"
                 + (f", {v['fps']:g} fps" if v.get("fps") else "") + " |")
    z.append(f"| Ausschnitt | {zeit_text(a['start'])} – {zeit_text(a['ende'])} |")
    z.append(f"| {'Modus' if beides else 'Warum Bildmodus'} | {erg.get('modus_grund') or '-'} |")
    if beides:
        sp = erg.get("sprache") or {}
        z.append(f"| Spracherkennung | Whisper ({sp.get('modell') or '-'}), "
                 f"{sp.get('abschnitte', 0)} Abschnitte |")
    z.append(f"| Bilder | {len(erg['bilder'])} (aus {s['kandidaten']} Kandidaten, "
             f"{s['duplikate_entfernt']} Duplikate entfernt) |")
    z.append(f"| Szenen-Schwellwert | {e['schwelle']:g}"
             + (f" (automatisch angehoben von {e['schwelle_start']:g})"
                if e["schwelle"] != e["schwelle_start"] else "") + " |")
    z.append(f"| Mindestintervall | {e['intervall']:g} s"
             + (f" (angehoben von {e['intervall_start']:g} s)"
                if e["intervall"] != e["intervall_start"] else "") + " |")
    z.append(f"| Monitor entzerrt | {'ja' if e['entzerren'] else 'nein'} |")
    z.append("| Texterkennung | "
             + (f"Tesseract, {e['sprachen']}, schwach unter {e['ocr_min_konfidenz']:g} %"
                if e["ocr"] else "aus") + " |")
    z.append("")
    for b in erg["bilder"]:
        z.append("---")
        z.append("")
        z.append(f"## Bild {b['nr']} · {b['zeit_text']}")
        z.append("")
        z.append(f"![Bild {b['nr']} bei {b['zeit_text']}]({b['datei']})")
        z.append("")
        anlass = {"start": "Anfang des Ausschnitts", "szenenwechsel": "Szenenwechsel",
                  "intervall": "Mindestintervall (kein Szenenwechsel dazwischen)"}[b["grund"]]
        if b.get("text_geaendert"):
            anlass += ", Text geändert (Bild sonst fast gleich)"
        z.append(f"*Datei `{b['datei']}` · Anlass: {anlass} · Szenenwert {b['szenenwert']:.3f}"
                 + (f" · Abstand zum vorigen Bild {b['hash_abstand']}/{HASH_GROESSE ** 2} Bit"
                    if b.get("hash_abstand") is not None else "") + "*")
        z.append("")
        if beides:
            gesagt = (b.get("gesprochen") or "").strip()
            if gesagt:
                z.append("**Gesprochen:**")
                z.append("")
                z.append("> " + gesagt.replace("\n", "\n> "))
            else:
                z.append("*Dazu wird nichts gesagt.*")
            z.append("")
        o = b.get("ocr")
        if o is None:
            continue
        if o.get("fehler"):
            z.append(f"**Texterkennung fehlgeschlagen:** {o['fehler']}")
        elif not o["text"]:
            z.append("*Kein Text erkannt.*")
        else:
            if o["schwach"]:
                z.append(f"⚠️ **Schwache Erkennung** (Ø Konfidenz {o['konfidenz']:.0f} %) - "
                         "Text unsicher, bitte am Bild prüfen.")
            else:
                z.append(f"**{'Text im Bild' if beides else 'Erkannter Text'}** "
                         f"(Ø Konfidenz {o['konfidenz']:.0f} %):")
            z.append("")
            zaun = _zaun(o["text"])
            z.append(zaun + "text")
            z.append(o["text"])
            z.append(zaun)
            if o["unsichere_woerter"]:
                z.append("")
                z.append("Unsichere Wörter: " + ", ".join(f"`{w}`" for w in o["unsichere_woerter"][:20]))
        z.append("")
    meldungen = [m for m in erg["log"] if m["stufe"] == "warnung"]
    if meldungen:
        z.append("---")
        z.append("")
        z.append("## Hinweise aus der Verarbeitung")
        z.append("")
        for m in meldungen:
            z.append(f"- {m['text']}")
        z.append("")
    return "\n".join(z)


def sprache_zuordnen(erg, segmente, modell=None):
    """Modus "beides": jedem Bild das Gesprochene von seinem Zeitpunkt bis zum
    nächsten Bild zuordnen (Abschnittsbeginn zählt). Was vor dem ersten Bild
    gesagt wird, gehört zum ersten Bild."""
    bilder = erg["bilder"]
    for b in bilder:
        b["gesprochen"] = ""
    if bilder:
        teile = [[] for _ in bilder]

        def bild_zu(zeit):
            i = 0
            while i + 1 < len(bilder) and zeit >= bilder[i + 1]["zeit"]:
                i += 1
            return i
        for seg in segmente:
            if seg.get("woerter"):          # genauer: jedes Wort (Mitte) zu seinem Bild
                for mitte, wort in seg["woerter"]:
                    teile[bild_zu(mitte)].append(wort)
            else:
                teile[bild_zu(seg["start"])].append(" " + (seg.get("text") or "").strip())
        for b, t in zip(bilder, teile):
            b["gesprochen"] = "".join(t).strip()
    erg["modus"] = "beides"
    erg["sprache"] = {"modell": modell, "abschnitte": len(segmente)}
    return erg


def protokoll_schreiben(erg, ausgabe):
    with open(os.path.join(ausgabe, "bildprotokoll.json"), "w", encoding="utf-8") as f:
        json.dump(erg, f, ensure_ascii=False, indent=2)
    with open(os.path.join(ausgabe, "bildprotokoll.md"), "w", encoding="utf-8") as f:
        f.write(markdown_bauen(erg))


def _ausgabe_vorbereiten(ausgabe, ueberschreiben):
    bilder = os.path.join(ausgabe, "bilder")
    if os.path.isdir(ausgabe) and os.listdir(ausgabe):
        eigene = {"bilder", "bildprotokoll.md", "bildprotokoll.json", "bildmodus.log"}
        fremd = set(os.listdir(ausgabe)) - eigene
        if not ueberschreiben:
            raise BildmodusFehler(f"Ausgabeordner '{ausgabe}' ist nicht leer - anderen Ordner "
                                  "wählen oder --ueberschreiben angeben.")
        if fremd:
            raise BildmodusFehler(f"Ausgabeordner '{ausgabe}' enthält fremde Dateien "
                                  f"({', '.join(sorted(fremd)[:5])}) - zum Schutz nicht überschrieben.")
        if os.path.isdir(bilder):
            for n in os.listdir(bilder):
                if re.fullmatch(r"bild_\d+_t[\d-]+\.png", n):
                    os.remove(os.path.join(bilder, n))
    os.makedirs(bilder, exist_ok=True)
    return bilder


# ---------------------------------------------------------------- Hauptablauf
def ausfuehren(video, ausgabe, *, start=None, ende=None, schwelle=STANDARD["schwelle"],
               intervall=STANDARD["intervall"], max_bilder=STANDARD["max_bilder"],
               toleranz=STANDARD["toleranz"], entzerren_an=STANDARD["entzerren"],
               ocr_an=STANDARD["ocr"], sprachen=STANDARD["sprachen"],
               ocr_min_konfidenz=STANDARD["ocr_min_konfidenz"], ocr_fehlt="fehler",
               tesseract_cmd=None, modus_grund=None, quelle_name=None, protokoll=None,
               fortschritt=None, abbrechen_pruefen=None, arbeitsordner=None,
               ueberschreiben=False):
    """Führt den Bildmodus aus und schreibt bilder/, bildprotokoll.md/.json/bildmodus.log.

    fortschritt(zustand, prozent, text)   zustand: "bilder" | "ocr"
    abbrechen_pruefen()                   darf eine Ausnahme werfen (Job gelöscht)
    ocr_fehlt                             "fehler" = abbrechen, "ueberspringen" = ohne OCR weiter
    Rückgabe: das Ergebnis-Dict (Inhalt von bildprotokoll.json)."""
    beginn = time.time()
    p = protokoll or Protokoll()
    melde = fortschritt or (lambda *a: None)

    start = zeit_lesen(start)
    ende = zeit_lesen(ende)
    if not 0 < schwelle <= 1:
        raise BildmodusFehler("Schwellwert muss zwischen 0 und 1 liegen (z. B. 0.15).")
    if intervall <= 0:
        raise BildmodusFehler("Mindestintervall muss größer als 0 Sekunden sein.")
    if max_bilder < 1:
        raise BildmodusFehler("Bildobergrenze muss mindestens 1 sein.")
    if toleranz < 0:
        raise BildmodusFehler("Toleranz darf nicht negativ sein.")

    probleme = abhaengigkeiten_pruefen(ocr=ocr_an, sprachen=sprachen, tesseract_cmd=tesseract_cmd)
    hart = [x for x in probleme if not x["was"].startswith("tesseract")]
    if hart:
        raise AbhaengigkeitFehler(anleitung(hart))
    ocr_befehl = None
    if ocr_an:
        weich = [x for x in probleme if x["was"].startswith("tesseract")]
        if weich:
            if ocr_fehlt != "ueberspringen":
                raise AbhaengigkeitFehler(anleitung(weich)
                                          + "\n\n(Ohne Texterkennung weiter: Option --kein-ocr)")
            p.warnung("Texterkennung übersprungen - " + anleitung(weich).replace("\n", " "))
            ocr_an = False
        else:
            ocr_befehl = tesseract_finden(tesseract_cmd)

    info = video_info(video)
    if info["video"] is None:
        raise BildmodusFehler("Die Datei hat keine Bildspur (reine Tonaufnahme) - dafür ist "
                              "der Sprachmodus da.")
    dauer = info["dauer"]
    anfang = start or 0.0
    if dauer:
        if anfang >= dauer:
            raise BildmodusFehler(f"Startzeit {zeit_text(anfang)} liegt hinter dem Videoende "
                                  f"({zeit_text(dauer)}).")
        if ende is not None and ende > dauer + 0.05:
            p.warnung(f"Endzeit {zeit_text(ende)} liegt hinter dem Videoende - "
                      f"verwende {zeit_text(dauer)}.")
            ende = dauer
    if ende is not None and ende <= anfang:
        raise BildmodusFehler("Endzeit muss nach der Startzeit liegen.")
    schluss = ende if ende is not None else dauer
    laenge = (schluss - anfang) if schluss else None

    p.info(f"Video: {quelle_name or os.path.basename(video)}, "
           f"{info['video']['breite']}×{info['video']['hoehe']}, {info['video']['codec']}, "
           f"Länge {zeit_text(dauer) if dauer else 'unbekannt'}; Ausschnitt "
           f"{zeit_text(anfang)} – {zeit_text(schluss) if schluss else 'Ende'}")

    bilder_ordner = _ausgabe_vorbereiten(ausgabe, ueberschreiben)
    arbeit = tempfile.mkdtemp(prefix="v3dbild_", dir=arbeitsordner)
    try:
        # 1) Kandidaten: ein ffmpeg-Lauf, bei Überlauf mit höherer Schwelle neu
        vorrat = os.path.join(arbeit, "kandidaten")
        os.makedirs(vorrat)
        s_basis, i_basis = schwelle, intervall
        pool_max = max(600, max_bilder * 10) + (int(laenge / intervall) if laenge else 0)
        while True:
            kandidaten, ueberlauf, warnung = _kandidaten_lauf(
                video, vorrat, start, (ende - anfang) if ende is not None else None, laenge,
                s_basis, i_basis, pool_max,
                lambda anteil, n: melde("bilder", 2 + anteil * 58,
                                        f"Schlüsselbilder suchen … {n} Kandidaten"),
                abbrechen_pruefen)
            if not ueberlauf:
                break
            hoeher = [s for s in SCHWELLEN_STUFEN if s > s_basis]
            if hoeher:
                p.warnung(f"Mehr als {pool_max} Kandidaten bei Schwellwert {s_basis:g} "
                          f"(unruhiges Bild?) - Schwellwert auf {hoeher[0]:g} angehoben, neuer Lauf.")
                s_basis = hoeher[0]
            else:
                p.warnung(f"Auch bei Schwellwert {s_basis:g} über {pool_max} Kandidaten - "
                          f"Mindestintervall von {i_basis:g} s auf {i_basis * 2:g} s verdoppelt.")
                i_basis *= 2
        if warnung:
            p.warnung(warnung)
        if not kandidaten:
            raise BildmodusFehler("Aus dem Video ließ sich kein einziges Bild lesen.")
        p.info(f"{len(kandidaten)} Kandidaten (Schwellwert {s_basis:g}, Intervall {i_basis:g} s)")

        # 2) optional entzerren, dann Hash je Kandidat
        ohne_monitor, letzte_lage = 0, None
        for n, k in enumerate(kandidaten):
            if abbrechen_pruefen and n % 20 == 0:
                abbrechen_pruefen()
            bild = _bild_lesen(k["datei"])
            k["quad"] = None
            if entzerren_an:
                quad = monitor_finden(bild)
                if quad is None:
                    ohne_monitor += 1
                    quad = letzte_lage
                letzte_lage = quad if quad is not None else letzte_lage
                k["quad"] = quad
                if quad is not None:
                    bild = entzerren(bild, quad)
            k["hash"] = _phash(bild)
            melde("bilder", 60 + 8 * (n + 1) / len(kandidaten), "Bilder vergleichen …")
        if entzerren_an:
            if all(k["quad"] is None for k in kandidaten):
                p.warnung("Entzerren: keine Monitorfläche gefunden - Bilder bleiben unverändert. "
                          "Ist es vielleicht eine echte Bildschirmaufnahme?")
            elif ohne_monitor:
                p.info(f"Entzerren: in {ohne_monitor} von {len(kandidaten)} Kandidaten keine "
                       "Monitorfläche gefunden, dort die zuletzt erkannte Lage verwendet.")

        # 3) Auswahl + Duplikate; zu viele -> Schwellwert/Intervall anheben.
        #    Textprüfung nur bei echten Bildschirmaufnahmen: abgefilmt ist schon
        #    das Rauschen ein Grenzfall, und dort schwankt auch die OCR.
        ocr_cache = {}

        def ocr_von(k):
            if k["datei"] not in ocr_cache:
                ocr_cache[k["datei"]] = ocr(_bild_lesen(k["datei"]), ocr_befehl, sprachen,
                                            ocr_min_konfidenz)
                melde("bilder", 69, f"Grenzfälle per Text prüfen … {len(ocr_cache)}")
            return ocr_cache[k["datei"]]

        textpruefung = None
        if ocr_an and not entzerren_an:
            textpruefung = lambda neu, alt: _text_unterscheidet(ocr_von(neu), ocr_von(alt))  # noqa: E731
        s_akt, i_akt = s_basis, i_basis
        while True:
            gewaehlt = _nach_schwelle(kandidaten, s_akt, i_akt)
            behalten, doppelt, geprueft, wegen_text = _duplikate_entfernen(
                gewaehlt, toleranz, textpruefung)
            if len(behalten) <= max_bilder:
                break
            # nächste Stufe, die wirklich weniger Bilder ergibt - Stufen ohne
            # Wirkung überspringen, statt sie einzeln zu protokollieren
            wirksam = [s for s in SCHWELLEN_STUFEN if s > s_akt
                       and len(_nach_schwelle(kandidaten, s, i_akt)) < len(gewaehlt)]
            if wirksam:
                p.warnung(f"Bildobergrenze {max_bilder} überschritten ({len(behalten)} Bilder bei "
                          f"Schwellwert {s_akt:g}) - Schwellwert automatisch auf {wirksam[0]:g} angehoben.")
                s_akt = wirksam[0]
            else:
                neu = i_akt * 1.5
                p.warnung(f"Bildobergrenze {max_bilder} auch bei Schwellwert {s_akt:g} überschritten "
                          f"({len(behalten)} Bilder) - Mindestintervall von {i_akt:g} s auf {neu:g} s angehoben.")
                i_akt = neu
        p.info(f"{len(gewaehlt)} Bilder nach Schwellwert, {doppelt} nahezu gleiche entfernt, "
               f"{len(behalten)} bleiben")
        if geprueft:
            p.info(f"Textprüfung: {geprueft} fast gleiche Bilder per OCR verglichen, "
                   f"{wegen_text} wegen geänderten Textes behalten")

        # 4) exportieren (+ aufbereiten) und OCR - parallel je Bild
        stellen = max(3, len(str(len(behalten))))

        def ein_bild(nr, k):
            if abbrechen_pruefen:
                abbrechen_pruefen()
            bild = _bild_lesen(k["datei"])
            if k.get("quad") is not None:
                bild = entzerren(bild, k["quad"])
            raus = aufbereiten(bild) if entzerren_an else _verkleinern(bild, MAX_BREITE)
            name = f"bild_{nr:0{stellen}d}_t{zeit_text(k['t'], datei=True)}.png"
            _bild_schreiben(os.path.join(bilder_ordner, name), raus)
            eintrag = {
                "nr": nr, "zeit": round(k["t"], 3), "zeit_text": zeit_text(k["t"]),
                "datei": "bilder/" + name, "breite": int(raus.shape[1]), "hoehe": int(raus.shape[0]),
                "grund": k["grund"], "szenenwert": k["szenenwert"],
                "hash_abstand": k.get("hash_abstand"), "text_geaendert": k.get("text_geaendert"),
                "phash": str(k["hash"]),
                "entzerrt": (k.get("quad") is not None) if entzerren_an else None,
                "ocr": None}
            if ocr_an:
                ergebnis = ocr_cache.get(k["datei"]) if not entzerren_an else None
                if ergebnis is None:
                    ergebnis = ocr(bild, ocr_befehl, sprachen, ocr_min_konfidenz,
                                   glaetten=entzerren_an)
                eintrag["ocr"] = {x: y for x, y in ergebnis.items() if not x.startswith("_")}
            return eintrag

        ergebnisse = []
        arbeiter = max(1, min(4, (os.cpu_count() or 2) // 2))
        zustand = "ocr" if ocr_an else "bilder"
        with ThreadPoolExecutor(max_workers=arbeiter) as pool:
            auftraege = [pool.submit(ein_bild, nr, k) for nr, k in enumerate(behalten, 1)]
            try:
                for fertig, auftrag in enumerate(as_completed(auftraege), 1):
                    ergebnisse.append(auftrag.result())
                    melde(zustand, 70 + 28 * fertig / len(auftraege),
                          ("Text erkennen … " if ocr_an else "Bilder speichern … ")
                          + f"{fertig}/{len(auftraege)}")
            except BaseException:
                for a in auftraege:
                    a.cancel()
                raise
        ergebnisse.sort(key=lambda e: e["nr"])

        if ocr_an:
            schwach = sum(1 for e in ergebnisse if e["ocr"] and e["ocr"]["schwach"])
            kaputt = [e for e in ergebnisse if e["ocr"] and e["ocr"]["fehler"]]
            if schwach:
                p.info(f"Texterkennung: {schwach} von {len(ergebnisse)} Bildern mit schwacher "
                       f"Konfidenz (< {ocr_min_konfidenz:g} %) - gekennzeichnet, nicht verworfen.")
            for e in kaputt:
                p.warnung(f"Texterkennung für Bild {e['nr']} fehlgeschlagen: {e['ocr']['fehler']}")

        erg = {
            "version": VERSION,
            "quelle": quelle_name or os.path.basename(video),
            "erstellt": datetime.datetime.now().isoformat(timespec="seconds"),
            "modus": "bild",
            "modus_grund": modus_grund,
            "video": dict(info["video"], dauer=dauer, format=info["format"],
                          tonspuren=len(info["audio"])),
            "ausschnitt": {"start": round(anfang, 3),
                           "ende": round(schluss, 3) if schluss else None},
            "einstellungen": {
                "schwelle_start": schwelle, "schwelle": s_akt,
                "intervall_start": intervall, "intervall": round(i_akt, 3),
                "max_bilder": max_bilder, "toleranz": toleranz,
                "hash": f"pHash {HASH_GROESSE}x{HASH_GROESSE}",
                "entzerren": bool(entzerren_an), "ocr": bool(ocr_an),
                "sprachen": sprachen, "ocr_min_konfidenz": ocr_min_konfidenz},
            "statistik": {"kandidaten": len(kandidaten), "nach_schwelle": len(gewaehlt),
                          "duplikate_entfernt": doppelt, "textgeprueft": geprueft,
                          "wegen_text_behalten": wegen_text, "bilder": len(ergebnisse),
                          "laufzeit_s": round(time.time() - beginn, 1)},
            "bilder": ergebnisse,
            "log": p.eintraege,
        }
        if erg["ausschnitt"]["ende"] is None and ergebnisse:
            erg["ausschnitt"]["ende"] = ergebnisse[-1]["zeit"]
        p.info(f"Fertig: {len(ergebnisse)} Bilder in {erg['statistik']['laufzeit_s']:g} s")
        erg["log"] = p.eintraege
        protokoll_schreiben(erg, ausgabe)
        with open(os.path.join(ausgabe, "bildmodus.log"), "w", encoding="utf-8") as f:
            f.write(p.als_text())
        return erg
    finally:
        shutil.rmtree(arbeit, ignore_errors=True)


# ---------------------------------------------------------------- Kommandozeile
def _konsole_utf8():
    for strom in (sys.stdout, sys.stderr):
        try:
            strom.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def main(argv=None):
    _konsole_utf8()
    ap = argparse.ArgumentParser(
        prog="bildmodus.py",
        description="Stummes Video (Bildschirmaufnahme / abgefilmter Monitor) -> Schlüsselbilder, "
                    "OCR-Text, Markdown + JSON für die Auswertung mit Claude.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    ap.add_argument("video", nargs="?", help="Videodatei")
    ap.add_argument("-o", "--ausgabe", help="Ausgabeordner (Standard: <video>_bildprotokoll)")
    ap.add_argument("--modus", choices=("auto", "bild"), default="auto",
                    help="auto = nur wenn die Tonspur fehlt oder still ist; bild = immer")
    ap.add_argument("--start", help="Startzeit, z. B. 90 oder 1:30")
    ap.add_argument("--ende", help="Endzeit, z. B. 4:00")
    ap.add_argument("--schwelle", type=float, default=STANDARD["schwelle"],
                    help="Szenenwechsel-Schwellwert 0..1 (kleiner = empfindlicher)")
    ap.add_argument("--intervall", type=float, default=STANDARD["intervall"],
                    help="spätestens alle N Sekunden ein Bild")
    ap.add_argument("--max-bilder", type=int, default=STANDARD["max_bilder"],
                    help="Obergrenze; darüber wird der Schwellwert automatisch angehoben")
    ap.add_argument("--toleranz", type=int, default=STANDARD["toleranz"],
                    help=f"Duplikat-Toleranz: Hamming-Abstand des pHash (0..{HASH_GROESSE ** 2})")
    ap.add_argument("--entzerren", action="store_true",
                    help="abgefilmter Monitor: Fläche finden, Perspektive entzerren, Moiré/Kontrast")
    ap.add_argument("--kein-ocr", action="store_true", help="Texterkennung abschalten")
    ap.add_argument("--sprachen", default=STANDARD["sprachen"], help="Tesseract-Sprachen")
    ap.add_argument("--ocr-min-konfidenz", type=float, default=STANDARD["ocr_min_konfidenz"],
                    help="darunter gilt die Erkennung als schwach (wird markiert)")
    ap.add_argument("--stille-db", type=float, default=STANDARD["stille_db"],
                    help="Spitzenpegel in dB, bis zu dem eine Tonspur als still gilt")
    ap.add_argument("--tesseract", help="Pfad zu tesseract(.exe), falls nicht gefunden")
    ap.add_argument("--ueberschreiben", action="store_true",
                    help="vorhandenes Ergebnis im Ausgabeordner ersetzen")
    ap.add_argument("--pruefen", action="store_true", help="nur Abhängigkeiten prüfen")
    ap.add_argument("-q", "--leise", action="store_true", help="nur Ergebnis und Fehler ausgeben")
    a = ap.parse_args(argv)

    if a.pruefen:
        probleme = abhaengigkeiten_pruefen(ocr=not a.kein_ocr, sprachen=a.sprachen,
                                           tesseract_cmd=a.tesseract)
        print(anleitung(probleme))
        if not probleme:
            print(f"ffmpeg: {shutil.which('ffmpeg')}")
            if not a.kein_ocr:
                print(f"tesseract: {tesseract_finden(a.tesseract)}")
        return 4 if probleme else 0
    if not a.video:
        ap.error("Videodatei fehlt (oder --pruefen angeben)")

    probleme = abhaengigkeiten_pruefen(ocr=not a.kein_ocr, sprachen=a.sprachen,
                                       tesseract_cmd=a.tesseract)
    if probleme:
        print(anleitung(probleme), file=sys.stderr)
        if not a.kein_ocr and all(x["was"].startswith("tesseract") for x in probleme):
            print("\n(Ohne Texterkennung weiter: Option --kein-ocr)", file=sys.stderr)
        return 4

    def echo(stufe, text):
        if not a.leise or stufe == "warnung":
            print(("WARNUNG: " if stufe == "warnung" else "") + text, file=sys.stderr, flush=True)

    letzte = [0.0]

    def fortschritt(zustand, prozent, text):
        if not a.leise and time.time() - letzte[0] > 2:
            letzte[0] = time.time()
            print(f"  {prozent:5.1f} %  {text}", file=sys.stderr, flush=True)

    try:
        start = zeit_lesen(a.start)
        ende = zeit_lesen(a.ende)
        grund = "Bildmodus per Option erzwungen"
        if a.modus == "auto":
            modus, grund, _, _ = modus_erkennen(a.video, start, ende, a.stille_db)
            if modus == "ton":
                print(f"Das Video hat hörbaren Ton ({grund}) - dafür ist der Sprachmodus "
                      "von V3D Transkript da (server.py). Bildmodus trotzdem: --modus bild",
                      file=sys.stderr)
                return 3
            echo("info", f"Automatisch Bildmodus: {grund}")
        stamm = os.path.splitext(os.path.basename(a.video))[0]
        ausgabe = a.ausgabe or os.path.join(os.getcwd(), f"{stamm}_bildprotokoll")
        erg = ausfuehren(
            a.video, ausgabe, start=start, ende=ende, schwelle=a.schwelle,
            intervall=a.intervall, max_bilder=a.max_bilder, toleranz=a.toleranz,
            entzerren_an=a.entzerren, ocr_an=not a.kein_ocr, sprachen=a.sprachen,
            ocr_min_konfidenz=a.ocr_min_konfidenz, tesseract_cmd=a.tesseract,
            modus_grund=grund, protokoll=Protokoll(echo), fortschritt=fortschritt,
            ueberschreiben=a.ueberschreiben)
    except ValueError as e:                     # Zeitangaben
        print(f"Fehler: {e}", file=sys.stderr)
        return 2
    except BildmodusFehler as e:
        print(f"Fehler: {e}", file=sys.stderr)
        return 4 if isinstance(e, AbhaengigkeitFehler) else 1
    except KeyboardInterrupt:
        print("abgebrochen", file=sys.stderr)
        return 130
    print(f"{len(erg['bilder'])} Bilder -> {os.path.join(ausgabe, 'bilder')}")
    print(f"Markdown: {os.path.join(ausgabe, 'bildprotokoll.md')}")
    print(f"JSON:     {os.path.join(ausgabe, 'bildprotokoll.json')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
