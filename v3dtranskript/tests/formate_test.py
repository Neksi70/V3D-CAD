#!/usr/bin/env python3
"""Schickt dieselbe Aufnahme in allen ueblichen Sprach-/Videoformaten durch.

Aufruf: python3 tests/formate_test.py [port]
Braucht ffmpeg und eine Sprachaufnahme unter /tmp/test_stimme.wav
(erzeugen z.B. mit piper, siehe README).
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

PORT = sys.argv[1] if len(sys.argv) > 1 else "8792"
BASIS = f"http://127.0.0.1:{PORT}"
QUELLE = "/tmp/test_stimme.wav"
ERWARTET = "donnerstag"          # kommt in der Testaufnahme vor

FORMATE = [
    ("whatsapp.opus", ["-c:a", "libopus", "-b:a", "24k"]),
    ("telegram.ogg", ["-c:a", "libopus", "-b:a", "24k"]),
    ("vorbis.oga", ["-c:a", "libvorbis", "-q:a", "3"]),
    ("sprachmemo.m4a", ["-c:a", "aac", "-b:a", "64k"]),
    ("handy.3gp", ["-c:a", "aac", "-b:a", "48k", "-f", "3gp"]),
    ("diktat.mp3", ["-c:a", "libmp3lame", "-b:a", "64k"]),
    ("roh.aac", ["-c:a", "aac", "-b:a", "64k", "-f", "adts"]),
    ("original.wav", ["-c:a", "pcm_s16le"]),
    ("16k_mono.wav", ["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"]),
    ("video.mp4", None),          # Sonderfall: Bildspur dazu
]


def hole(pfad):
    with urllib.request.urlopen(BASIS + pfad) as a:
        return json.load(a)


def hoch(pfad, name):
    with open(pfad, "rb") as f:
        daten = f.read()
    anfrage = urllib.request.Request(
        f"{BASIS}/api/upload?name={urllib.parse.quote(name)}&modell=small&sprache=de",
        data=daten, headers={"Content-Type": "application/octet-stream"})
    with urllib.request.urlopen(anfrage) as a:
        return json.load(a)["id"]


def main():
    if not os.path.exists(QUELLE):
        print(f"FEHLT: {QUELLE} - erst eine Sprachaufnahme erzeugen")
        return 1
    ids, schlecht = {}, 0
    for name, args in FORMATE:
        ziel = f"/tmp/fmt_{name}"
        if args is None:
            befehl = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
                      "-i", "color=c=teal:s=320x240:r=15", "-i", QUELLE,
                      "-c:v", "libx264", "-pix_fmt", "yuv420p",
                      "-c:a", "aac", "-shortest", ziel]
        else:
            befehl = ["ffmpeg", "-y", "-loglevel", "error", "-i", QUELLE] + args + [ziel]
        if subprocess.run(befehl, capture_output=True).returncode != 0:
            print(f"  ÜBERSPRUNGEN {name} (ffmpeg kann das hier nicht bauen)")
            continue
        ids[hoch(ziel, "fmt_" + name)] = name

    frist = time.time() + 600
    while time.time() < frist:
        zustaende = {j["id"]: j["zustand"] for j in hole("/api/jobs")["jobs"]}
        if all(zustaende.get(i) in ("fertig", "fehler") for i in ids):
            break
        time.sleep(3)

    for jid, name in ids.items():
        job = hole(f"/api/job?id={jid}")
        text = (job.get("text") or "").lower()
        ok = job.get("zustand") == "fertig" and ERWARTET in text
        print(f"  {'OK  ' if ok else 'FEHL'} {name:16} "
              + (text[:48] if ok else (job.get("fehler") or text)[:70]))
        if not ok:
            schlecht += 1
        anfrage = urllib.request.Request(BASIS + "/api/loeschen",
                                         data=json.dumps({"id": jid}).encode())
        urllib.request.urlopen(anfrage).read()     # Testjob wieder wegräumen

    print("\n" + ("FEHLGESCHLAGEN" if schlecht else f"alle {len(ids)} Formate gehen"))
    return 1 if schlecht else 0


if __name__ == "__main__":
    import urllib.parse
    sys.exit(main())
