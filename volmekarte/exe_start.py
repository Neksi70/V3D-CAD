#!/usr/bin/env python3
# VolmeKarte - Einstieg fuer die gebaute EXE.
#
# Die EXE laeuft ohne Konsolenfenster. Fehler landen deshalb in einem
# Windows-Meldefenster und zusaetzlich in einer Protokolldatei.

import os
import socket
import sys
import tempfile
import traceback

PORT = 8785


def protokoll_umlenken():
    """Ohne Konsole gibt es weder stdout noch stderr - jeder Schreibversuch
    darauf wuerde die laufende Anfrage abbrechen."""
    if not getattr(sys, "frozen", False) and sys.stdout is not None \
            and sys.stderr is not None:
        return None
    ordner = os.path.join(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir(),
                          "VolmeKarte")
    try:
        os.makedirs(ordner, exist_ok=True)
        datei = open(os.path.join(ordner, "protokoll.txt"), "a",
                     encoding="utf-8", buffering=1)
    except Exception:
        class Still:
            def write(self, *a):
                pass

            def flush(self):
                pass
        datei = Still()
    sys.stdout = datei
    sys.stderr = datei
    try:
        import time
        datei.write("\n=== VolmeKarte gestartet %s ===\n"
                    % time.strftime("%d.%m.%Y %H:%M:%S"))
    except Exception:
        pass
    return getattr(datei, "name", None)


def meldung(text, titel="VolmeKarte", art=0x40):
    """0x40 = Hinweis, 0x10 = Fehler."""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, text, titel, art)
    except Exception:
        sys.stderr.write(text + "\n")


def belegt(port):
    with socket.socket() as s:
        s.settimeout(0.6)
        return s.connect_ex(("127.0.0.1", port)) == 0


def antwortet(port):
    """Laeuft dort ein GESUNDES VolmeKarte? Eine haengende aeltere Fassung
    haelt sonst den Port, ohne noch zu antworten."""
    import json
    import urllib.request
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/werkzeuge" % port,
                                    timeout=3) as a:
            return json.loads(a.read().decode("utf-8")).get("fassung", "?")
    except Exception:
        return None


def freier_port(ab, bis):
    """Per bind pruefen, nicht per Verbindungsversuch."""
    for p in range(ab, bis):
        probe = socket.socket()
        try:
            probe.bind(("127.0.0.1", p))
            return p
        except OSError:
            continue
        finally:
            probe.close()
    return None


def main():
    protokoll_umlenken()
    if getattr(sys, "frozen", False):
        os.chdir(os.path.dirname(sys.executable))

    import webbrowser
    port = PORT
    if belegt(PORT):
        fassung = antwortet(PORT)
        if fassung:
            webbrowser.open("http://localhost:%d/" % PORT)
            meldung("VolmeKarte läuft bereits (Fassung %s).\n\n"
                    "Die Oberfläche wurde im Browser geöffnet:\n"
                    "http://localhost:%d" % (fassung, PORT))
            return 0
        port = freier_port(PORT + 1, PORT + 12)
        if port is None:
            meldung("Auf Port %d hängt ein Programm, das nicht mehr antwortet, "
                    "und es ist kein freier Port zu finden.\n\n"
                    "Bitte im Task-Manager alle Einträge „VolmeKarte.exe“ "
                    "beenden und noch einmal starten." % PORT,
                    "VolmeKarte", 0x10)
            return 1
        meldung("Auf Port %d hängt noch ein Programm, das nicht mehr "
                "antwortet – vermutlich eine ältere Fassung.\n\n"
                "VolmeKarte startet deshalb auf Port %d." % (PORT, port))

    import server
    if len(sys.argv) == 1:
        sys.argv += ["--host", "127.0.0.1", "--port", str(port), "--browser"]
    return server.main()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        pfad = protokoll_umlenken()
        meldung("VolmeKarte konnte nicht starten:\n\n"
                + traceback.format_exc()[-1200:]
                + (("\n\nEinzelheiten: " + pfad) if pfad else ""),
                "VolmeKarte - Fehler", 0x10)
        sys.exit(1)
