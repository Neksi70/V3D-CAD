#!/usr/bin/env python3
"""Bildmodus über den Server: Hochladen -> automatische Erkennung -> Bilder,
Markdown, JSON, ZIP -> Löschen. Startet eine eigene Server-Instanz mit eigenem
Datenordner, der laufende Dienst bleibt unberührt.

    python tests/bildmodus_server_test.py [port]      (Standard 18792)

Ist in config.json ein Zugangscode gesetzt, meldet sich der Test damit an.
"""
import http.cookiejar
import io
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

HIER = os.path.dirname(os.path.abspath(__file__))
PROJEKT = os.path.dirname(HIER)
sys.path.insert(0, HIER)
import testvideo as tv  # noqa: E402

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 18792
BASIS = f"http://127.0.0.1:{PORT}"
KEKSE = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
FEHLER = 0


def pruefe(bed, text):
    global FEHLER
    print(("  OK   " if bed else "  FEHL ") + text, flush=True)
    if not bed:
        FEHLER += 1


def hole(pfad, roh=False):
    with KEKSE.open(BASIS + pfad, timeout=60) as a:
        daten = a.read()
        return (daten, a.headers) if roh else json.loads(daten)


def schicke(pfad, daten, kopf=None):
    anfrage = urllib.request.Request(BASIS + pfad, data=daten, headers=kopf or {})
    try:
        with KEKSE.open(anfrage, timeout=120) as a:
            return a.status, json.loads(a.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def hochladen(datei, **param):
    param.setdefault("name", os.path.basename(datei))
    with open(datei, "rb") as f:
        return schicke("/api/upload?" + urllib.parse.urlencode(param), f.read(),
                       {"Content-Type": "application/octet-stream"})


def warten(jid, frist=600):
    ende = time.time() + frist
    while time.time() < ende:
        job = hole(f"/api/job?id={jid}")
        if job.get("zustand") in ("fertig", "fehler"):
            return job
        time.sleep(1)
    return hole(f"/api/job?id={jid}")


def sprachvideo(tmp):
    """Kurzes Video mit deutscher Sprache (piper, siehe README) - sonst None."""
    piper = shutil.which("piper") or os.path.expanduser("~/.local/bin/piper")
    stimme = os.path.expanduser("~/.local/share/piper-voices/de_DE-thorsten-medium.onnx")
    if not (os.path.isfile(piper) and os.path.isfile(stimme)):
        return None
    wav = os.path.join(tmp, "stimme.wav")
    satz = "Wir treffen uns am Donnerstag um zehn Uhr in der Werkstatt."
    r = subprocess.run([piper, "--model", stimme, "--output_file", wav], input=satz.encode(),
                       capture_output=True)
    if r.returncode != 0 or not os.path.exists(wav):
        return None
    ziel = os.path.join(tmp, "sprache.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
                    "color=c=teal:s=320x240:r=10", "-i", wav, "-c:v", "libx264", "-pix_fmt",
                    "yuv420p", "-c:a", "aac", "-shortest", ziel], check=True)
    return ziel


def main():
    tmp = tempfile.mkdtemp(prefix="bm_server_")
    daten = os.path.join(tmp, "daten")
    videos = {
        "stumm": tv.bildschirm_video(os.path.join(tmp, "Bildschirm Übung.mp4")),
        "still": tv.bildschirm_video(os.path.join(tmp, "still.mp4"), ton="still"),
        "abgefilmt": tv.abgefilmt_video(os.path.join(tmp, "abgefilmt.mp4")),
        "piepton": tv.bildschirm_video(os.path.join(tmp, "piepton.mp4"), ton="ton"),
        "sprache": sprachvideo(tmp),
    }
    with socket.socket() as s:
        if s.connect_ex(("127.0.0.1", PORT)) == 0:
            print(f"Port {PORT} ist belegt - anderen Port angeben")
            return 2
    env = dict(os.environ, V3DTR_DATEN=daten)
    server = subprocess.Popen([sys.executable, os.path.join(PROJEKT, "server.py"), str(PORT)],
                              env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(100):
            try:
                ping = hole("/api/ping")
                break
            except OSError:
                time.sleep(0.2)
        else:
            print("Server startet nicht")
            return 1
        if not ping["offen"]:
            with open(os.path.join(PROJEKT, "config.json"), encoding="utf-8") as f:
                code = json.load(f)["code"]
            status, _ = schicke("/api/login", json.dumps({"code": code}).encode())
            pruefe(status == 200, "Anmeldung")

        print("1. stummes Video, Modus automatisch")
        status, a = hochladen(videos["stumm"], modus="auto", max_bilder="20")
        pruefe(status == 200 and a.get("id"), "Upload angenommen")
        job = warten(a["id"])
        pruefe(job["zustand"] == "fertig", f"Job fertig ({job.get('fehler') or job['zustand']})")
        pruefe(job.get("modus") == "bild", "automatisch Bildmodus")
        pruefe("keine Tonspur" in (job.get("modus_grund") or ""), f"Grund: {job.get('modus_grund')}")
        bilder = job.get("bilder") or []
        pruefe(len(bilder) >= len(tv.WECHSEL), f"{len(bilder)} Bilder")
        mit_ocr = job["einstellungen"]["ocr"]
        print(f"     (Texterkennung {'an' if mit_ocr else 'AUS - Tesseract fehlt dem Server'})")
        if mit_ocr:
            pruefe("Schritt 4" in job["text"], "OCR-Text im Job")
        else:
            pruefe(any("Texterkennung übersprungen" in h for h in job.get("hinweise", [])),
                   "Hinweis auf fehlendes Tesseract")

        png, kopf = hole(f"/api/bild?id={a['id']}&datei=" + bilder[0]["datei"].split("/")[1], roh=True)
        pruefe(png[:8] == b"\x89PNG\r\n\x1a\n" and kopf["Content-Type"] == "image/png", "Bild abrufbar")
        try:
            hole(f"/api/bild?id={a['id']}&datei=../../config.json", roh=True)
            pruefe(False, "Pfad-Ausbruch abgewiesen")
        except urllib.error.HTTPError as e:
            pruefe(e.code == 404, "Pfad-Ausbruch abgewiesen")

        md, kopf = hole(f"/api/md?id={a['id']}", roh=True)
        pruefe("filename*=UTF-8''Bildschirm%20%C3%9Cbung_bildprotokoll.md" in kopf["Content-Disposition"],
               "Markdown-Download mit Umlaut-Dateiname")
        pruefe(b"## Bild 1" in md, "Markdown hat Bildabschnitte")
        js = json.loads(hole(f"/api/json?id={a['id']}", roh=True)[0])
        pruefe(len(js["bilder"]) == len(bilder), "JSON passt zum Job")

        zipdaten, _ = hole(f"/api/zip?id={a['id']}", roh=True)
        with zipfile.ZipFile(io.BytesIO(zipdaten)) as z:
            namen = z.namelist()
            wurzel = namen[0].split("/")[0]
            pruefe(f"{wurzel}/bildprotokoll.md" in namen, "ZIP: Markdown")
            pngs = [n for n in namen if n.startswith(f"{wurzel}/bilder/") and n.endswith(".png")]
            pruefe(len(pngs) == len(bilder), f"ZIP: {len(pngs)} Bilder")
            md_zip = z.read(f"{wurzel}/bildprotokoll.md").decode()
            pruefe(all(f"]({b['datei']})" in md_zip and f"{wurzel}/{b['datei']}" in namen
                       for b in bilder), "ZIP: Bildpfade im Markdown stimmen")

        txt, _ = hole(f"/api/txt?id={a['id']}", roh=True)
        pruefe(b"Bild 1" in txt, ".txt auch im Bildmodus")

        print("2. stille Tonspur, abgefilmt + entzerren, Ausschnitt")
        status, b = hochladen(videos["still"], modus="auto", start="0:30", ende="42")
        job2 = warten(b["id"])
        pruefe(job2.get("modus") == "bild" and "still" in job2.get("modus_grund", ""),
               f"stille Tonspur -> Bildmodus ({job2.get('modus_grund')})")
        pruefe(all(29.9 <= x["zeit"] <= 42 for x in job2["bilder"]), "Ausschnitt eingehalten")
        status, c = hochladen(videos["abgefilmt"], modus="bild", entzerren="1")
        job3 = warten(c["id"])
        pruefe(job3.get("zustand") == "fertig" and len(job3["bilder"]) == 3
               and all(x["entzerrt"] for x in job3["bilder"]),
               f"abgefilmt: {len(job3.get('bilder') or [])} Bilder, entzerrt")

        print("3. Eingaben prüfen")
        status, f = hochladen(videos["stumm"], modus="bild", schwelle="7")
        pruefe(status == 400 and "schwelle" in f.get("fehler", ""), "falscher Schwellwert -> 400")
        status, f = hochladen(videos["stumm"], modus="bild", start="1:00", ende="0:10")
        pruefe(status == 400, "Ende vor Start -> 400")

        print("4. Ton-Weg: Sprache bleibt Whisper, Ton ohne Sprache fällt auf Bilder zurück")
        weitere = []
        status, t = hochladen(videos["piepton"], modus="auto")
        job4 = warten(t["id"])
        weitere.append(t["id"])
        pruefe(job4.get("modus") == "bild"
               and "ohne erkennbare Sprache" in (job4.get("modus_grund") or ""),
               f"Piepton -> Whisper findet nichts -> Bildmodus ({job4.get('modus_grund')})")
        if videos.get("sprache"):
            status, t = hochladen(videos["sprache"], modus="auto", modell="base")
            job5 = warten(t["id"])
            weitere.append(t["id"])
            pruefe(job5.get("modus") == "ton" and "donnerstag" in (job5.get("text") or "").lower(),
                   f"Sprachvideo -> Transkript wie bisher: {(job5.get('text') or job5.get('fehler'))[:60]!r}")
        else:
            print("     (übersprungen: piper nicht da, keine Sprachprobe)")

        print("5. Löschen räumt Bildordner weg")
        for jid in [a["id"], b["id"], c["id"]] + weitere:
            schicke("/api/loeschen", json.dumps({"id": jid}).encode())
        pruefe(os.listdir(os.path.join(daten, "bilder")) == [], "Bildordner leer")
        pruefe(os.listdir(os.path.join(daten, "medien")) == [], "Medienordner leer")
    finally:
        server.terminate()
        try:
            server.wait(10)
        except subprocess.TimeoutExpired:
            server.kill()
        if FEHLER:
            print("\n--- Server-Ausgabe ---\n" + server.stdout.read().decode(errors="replace")[-4000:])
        server.stdout.close()
        shutil.rmtree(tmp, ignore_errors=True)
    print("\n" + ("FEHLGESCHLAGEN: " + str(FEHLER) if FEHLER else "alles OK"))
    return 1 if FEHLER else 0


if __name__ == "__main__":
    sys.exit(main())
