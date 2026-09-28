"""Erzeugt kurze Testvideos für den Bildmodus - nur mit Pillow, OpenCV und ffmpeg,
läuft unter Windows und Ubuntu.

    python tests/testvideo.py [zielordner]     # legt alle Varianten an

Inhalt (45 s, 10 fps, 1920x1080) - eine erfundene Programmsitzung:
    0 s  Schritt 1: Programm starten
    4 s  Schritt 2: Datei öffnen
    8 s  Schritt 3: Einstellungen prüfen   (25 s still, nur der Mauszeiger wandert,
                                          ab 23 s steht 0,3 statt 0,2 mm da - nur
                                          EINE Ziffer; das fängt nur die Textprüfung)
   33 s  Schritt 4: Wert eingeben
   37 s  Schritt 5: Speichern
   41 s  zurück zur Übersicht (= Bild von Schritt 1)
"""
import os
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

BREITE, HOEHE, FPS = 1920, 1080, 10
WECHSEL = [0.0, 4.0, 8.0, 33.0, 37.0, 41.0]          # sichtbare Schrittwechsel
ZIFFER_AB = 23.0                                      # 0,2 -> 0,3 mm
LAENGE = 45.0

SCHRITTE = [
    ("Schritt 1: Programm starten", ["Willkommen im Testprogramm", "Neues Projekt anlegen",
                                     "Zuletzt verwendet: Gehäuse Deckel"]),
    ("Schritt 2: Datei öffnen", ["Ordner Dokumente", "Datei Halterung.stl auswählen",
                                 "Knopf Öffnen drücken"]),
    ("Schritt 3: Einstellungen prüfen", ["Schichthöhe 0,2 mm", "Füllung 20 Prozent",
                                         "Stützstrukturen aus"]),
    ("Schritt 4: Wert eingeben", ["Maß Breite 42 mm", "Maß Höhe 17 mm", "Übernehmen klicken"]),
    ("Schritt 5: Speichern", ["Speichern unter Halterung_neu", "Format STL binär",
                              "Fertig gespeichert"]),
]


def _schrift(groesse):
    for name in ("DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                 "arial.ttf", "C:\\Windows\\Fonts\\arial.ttf", "Arial.ttf"):
        try:
            return ImageFont.truetype(name, groesse)
        except OSError:
            continue
    return ImageFont.load_default(size=groesse)       # Pillow >= 10.1


def bildschirm(nr, maus=None, breite=BREITE, hoehe=HOEHE, ersatz=None):
    """Ein 'Programmfenster' als BGR-Array. nr = Index in SCHRITTE,
    ersatz = {zeilen_index: text} für kleine Änderungen."""
    titel, zeilen = SCHRITTE[nr]
    zeilen = [(ersatz or {}).get(i, z) for i, z in enumerate(zeilen)]
    f = breite / 1920.0
    img = Image.new("RGB", (breite, hoehe), (236, 239, 243))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, breite, int(70 * f)], fill=(38, 70, 120))            # Titelleiste
    d.text((int(30 * f), int(14 * f)), "Testprogramm 1.0", font=_schrift(int(36 * f)),
           fill=(255, 255, 255))
    d.rectangle([0, int(70 * f), int(360 * f), hoehe], fill=(214, 220, 228))  # Seitenleiste
    for i, eintrag in enumerate(("Start", "Datei", "Einstellungen", "Maße", "Speichern")):
        farbe = (38, 70, 120) if i == nr else (60, 60, 60)
        d.text((int(40 * f), int((120 + i * 70) * f)), eintrag, font=_schrift(int(34 * f)), fill=farbe)
    d.text((int(430 * f), int(130 * f)), titel, font=_schrift(int(64 * f)), fill=(20, 20, 20))
    for i, z in enumerate(zeilen):
        y = int((280 + i * 110) * f)
        d.rectangle([int(430 * f), y - int(12 * f), int(1700 * f), y + int(76 * f)],
                    outline=(170, 175, 185), width=max(1, int(2 * f)), fill=(250, 250, 252))
        d.text((int(460 * f), y), z, font=_schrift(int(46 * f)), fill=(30, 30, 30))
    if maus:                                                                  # Mauszeiger
        x, y = int(maus[0] * f), int(maus[1] * f)
        d.polygon([(x, y), (x, y + int(40 * f)), (x + int(11 * f), y + int(30 * f)),
                   (x + int(26 * f), y + int(30 * f))], fill=(0, 0, 0), outline=(255, 255, 255))
    return np.array(img)[:, :, ::-1].copy()


def _ablauf():
    """(dauer, bild) in zeitlicher Folge."""
    folge = [(4.0, bildschirm(0)), (4.0, bildschirm(1))]
    for i in range(5):                          # 25 s Stillstand, Maus wandert alle 5 s
        ersatz = {0: "Schichthöhe 0,3 mm"} if 8 + i * 5 >= ZIFFER_AB else None
        folge.append((5.0, bildschirm(2, maus=(1200 + i * 60, 700 + i * 25), ersatz=ersatz)))
    folge += [(4.0, bildschirm(3)), (4.0, bildschirm(4)), (4.0, bildschirm(0))]
    return folge


def _ffmpeg_video(roh_args, ziel, ton=None):
    """Kodiert mit libx264, fällt auf mpeg4 zurück, falls ein ffmpeg ohne x264 da ist.
    ton: None = keine Tonspur, 'still' = Nullsignal, 'ton' = hörbarer Sinus."""
    ton_args = []
    if ton == "still":
        ton_args = ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono"]
    elif ton == "ton":
        ton_args = ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100"]
    for codec in (["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"],
                  ["-c:v", "mpeg4", "-q:v", "3", "-pix_fmt", "yuv420p"]):
        befehl = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"] + roh_args + ton_args
        befehl += ["-map", "0:v:0"] + (["-map", "1:a:0", "-c:a", "aac", "-shortest"] if ton else [])
        befehl += codec + ["-r", str(FPS), "-t", str(LAENGE), ziel]
        if subprocess.run(befehl, capture_output=True).returncode == 0:
            return ziel
    raise RuntimeError("ffmpeg konnte das Testvideo nicht kodieren")


def bildschirm_video(ziel, ton=None):
    """Die Programmsitzung als echte Bildschirmaufnahme (kein Abfilmen)."""
    ordner = ziel + "_bilder"
    os.makedirs(ordner, exist_ok=True)
    zeilen = []
    for i, (dauer, bild) in enumerate(_ablauf()):
        name = f"s{i:02d}.png"
        Image.fromarray(bild[:, :, ::-1]).save(os.path.join(ordner, name))
        zeilen.append(f"file '{name}'\nduration {dauer}\n")
    zeilen.append(f"file 's{len(_ablauf()) - 1:02d}.png'\n")    # concat braucht das letzte doppelt
    liste = os.path.join(ordner, "liste.txt")
    with open(liste, "w", encoding="utf-8") as f:
        f.writelines(zeilen)
    try:
        _ffmpeg_video(["-f", "concat", "-safe", "0", "-i", liste, "-t", str(LAENGE)], ziel, ton)
    finally:
        shutil.rmtree(ordner, ignore_errors=True)
    return ziel


MONITOR_ECKEN = np.float32([[190, 95], [1105, 135], [1075, 640], [205, 615]])  # in 1280x720


def abgefilmt_video(ziel, schritte=(0, 3, 4), sekunden=4.0, seed=7):
    """Simuliert eine Handyaufnahme vom Monitor: Perspektive, dunkler Rahmen,
    Wackeln, Rauschen und ein leichtes Moiré-Muster."""
    import cv2
    rng = np.random.default_rng(seed)
    w, h = 1280, 720
    quelle = np.float32([[0, 0], [959, 0], [959, 539], [0, 539]])
    hinter = np.full((h, w, 3), (58, 52, 48), np.uint8)
    cv2.rectangle(hinter, (0, 560), (w, h), (40, 45, 60), -1)                  # Tischkante
    yy, xx = np.mgrid[0:h, 0:w]
    moire = (np.sin(xx * 0.9 + yy * 0.31) * 7).astype(np.float32)[..., None]
    befehl = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo",
              "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", str(FPS), "-i", "-",
              "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", ziel]
    proc = subprocess.Popen(befehl, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for nr in schritte:
            inhalt = cv2.resize(bildschirm(nr), (960, 540), interpolation=cv2.INTER_AREA)
            for _ in range(int(sekunden * FPS)):
                ecken = MONITOR_ECKEN + rng.normal(0, 2.0, (4, 2)).astype(np.float32)
                m = cv2.getPerspectiveTransform(quelle, ecken)
                bild = hinter.copy()
                rahmen = ecken.copy()                                          # Monitorgehäuse
                mitte = rahmen.mean(axis=0)
                rahmen = (rahmen - mitte) * 1.05 + mitte
                cv2.fillConvexPoly(bild, rahmen.astype(np.int32), (18, 18, 20))
                bildschirm_teil = cv2.warpPerspective(inhalt, m, (w, h))
                maske = cv2.warpPerspective(np.full((540, 960), 255, np.uint8), m, (w, h))
                bild[maske > 0] = bildschirm_teil[maske > 0]
                bild = bild.astype(np.float32)
                bild[maske > 0] += moire[maske > 0]
                bild += rng.normal(0, 5, bild.shape).astype(np.float32)
                bild = cv2.GaussianBlur(np.clip(bild, 0, 255).astype(np.uint8), (0, 0), 0.8)
                proc.stdin.write(bild.tobytes())
        proc.stdin.close()
        fehler = proc.stderr.read().decode(errors="replace")
        if proc.wait() != 0:
            raise RuntimeError("ffmpeg (abgefilmt): " + fehler)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        proc.stderr.close()
    return ziel


def alle(ordner):
    os.makedirs(ordner, exist_ok=True)
    raus = {
        "stumm": bildschirm_video(os.path.join(ordner, "stumm.mp4")),
        "still": bildschirm_video(os.path.join(ordner, "stille_tonspur.mp4"), ton="still"),
        "ton": bildschirm_video(os.path.join(ordner, "mit_ton.mp4"), ton="ton"),
        "abgefilmt": abgefilmt_video(os.path.join(ordner, "abgefilmt.mp4")),
    }
    kaputt = os.path.join(ordner, "kaputt.mp4")
    with open(raus["stumm"], "rb") as f:
        anfang = f.read(4096)
    with open(kaputt, "wb") as f:                # MP4-Kopf ohne moov-Atom
        f.write(anfang[:64] + os.urandom(20000))
    raus["kaputt"] = kaputt
    nur_ton = os.path.join(ordner, "nur_ton.m4a")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
                    "sine=frequency=300:duration=3", "-c:a", "aac", nur_ton], check=True)
    raus["nur_ton"] = nur_ton
    return raus


if __name__ == "__main__":
    ziel = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.getcwd(), "testvideos")
    for k, v in alle(ziel).items():
        print(f"{k:10} {v}")
