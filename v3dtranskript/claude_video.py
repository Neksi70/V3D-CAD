#!/usr/bin/env python3
"""Video in einem Rutsch durch V3D Transkript schicken (fuer Claude).

    python3 claude_video.py <video> [-o ordner] [--modus beides|ton|bild|auto] [--modell small]

Laedt beim laufenden Dienst (:8792) hoch, wartet auf das Ergebnis und legt ab:
    <ordner>/transkript.txt      Gesprochenes mit Zeitmarken
    <ordner>/<name>_bildprotokoll/bildprotokoll.md   Schluesselbilder + OCR + Gesprochenes je Bild
    <ordner>/<name>_bildprotokoll/bilder/*.png       die Schluesselbilder
Standard-Ordner: /tmp/v3dtr_<dateiname>/. Der Job wird danach aus der Live-Liste
geloescht, ausser mit --behalten.
"""
import argparse, io, json, os, sys, time, urllib.parse, urllib.request, zipfile

BASIS = os.environ.get("V3DTR_URL", "http://127.0.0.1:8792")


def hol(pfad, roh=False):
    with urllib.request.urlopen(BASIS + pfad, timeout=60) as r:
        daten = r.read()
    return daten if roh else json.loads(daten)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("-o", "--ordner")
    ap.add_argument("--modus", default="beides", choices=("auto", "ton", "bild", "beides"))
    ap.add_argument("--modell", default="small", choices=("tiny", "base", "small", "medium"))
    ap.add_argument("--sprache", default="de")
    ap.add_argument("--behalten", action="store_true", help="Job in der Live-Liste lassen")
    a = ap.parse_args()

    name = os.path.basename(a.video)
    ordner = a.ordner or "/tmp/v3dtr_" + os.path.splitext(name)[0]
    os.makedirs(ordner, exist_ok=True)

    q = urllib.parse.urlencode({"name": name, "modus": a.modus,
                                "modell": a.modell, "sprache": a.sprache})
    with open(a.video, "rb") as f:
        req = urllib.request.Request(BASIS + "/api/upload?" + q, data=f.read(), method="POST",
                                     headers={"Content-Type": "application/octet-stream"})
    with urllib.request.urlopen(req, timeout=600) as r:
        antwort = json.loads(r.read())
    if not antwort.get("ok"):
        sys.exit("Upload fehlgeschlagen: %s" % antwort)
    jid = antwort["id"]
    print("Job", jid, "– warte …", file=sys.stderr)

    while True:
        job = hol("/api/job?id=" + jid)
        if job.get("zustand") in ("fertig", "fehler"):
            break
        time.sleep(3)
    if job["zustand"] == "fehler":
        sys.exit("Fehler: %s" % job.get("fehler") or job)

    with open(os.path.join(ordner, "transkript.txt"), "wb") as f:
        f.write(hol("/api/zeit?id=" + jid, roh=True))
    try:
        zipfile.ZipFile(io.BytesIO(hol("/api/zip?id=" + jid, roh=True))).extractall(ordner)
    except Exception:
        pass  # kein Bildprotokoll (z. B. reine Tonspur)
    if not a.behalten:
        urllib.request.urlopen(urllib.request.Request(
            BASIS + "/api/loeschen", data=json.dumps({"id": jid}).encode(), method="POST",
            headers={"Content-Type": "application/json"}), timeout=30).read()

    print(ordner)
    for wurzel, _, dateien in os.walk(ordner):
        for d in sorted(dateien):
            print("  " + os.path.relpath(os.path.join(wurzel, d), ordner))


if __name__ == "__main__":
    main()
