#!/usr/bin/env python3
# V3D Scan - Einstieg fuer die gebaute EXE.
#
# Startet den lokalen Dienst und oeffnet die Oberflaeche als eigenes Fenster
# (Edge/Chrome im App-Modus). Schliesst man das Fenster, beendet sich der
# Dienst nach 60 s ohne Puls von selbst. Ohne Konsole landen Fehler in einem
# Meldefenster und in %LOCALAPPDATA%\V3DScan\protokoll.txt.

import os
import socket
import sys
import tempfile
import traceback

PORT = 8797


def protokoll_umlenken():
    if not getattr(sys, "frozen", False) and sys.stdout is not None \
            and sys.stderr is not None:
        return None
    ordner = os.path.join(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir(),
                          "V3DScan")
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
        datei.write("\n=== V3D Scan gestartet %s ===\n" % time.strftime("%d.%m.%Y %H:%M:%S"))
    except Exception:
        pass
    return getattr(datei, "name", None)


def meldung(text, titel="V3D Scan", art=0x40):
    """0x40 = Hinweis, 0x10 = Fehler."""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, text, titel, art)
    except Exception:
        sys.stderr.write(text + "\n")


def antwortet(port):
    import json
    import urllib.request
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/puls" % port, timeout=3) as a:
            return json.loads(a.read().decode("utf-8")).get("fassung", "?")
    except Exception:
        return None


def freier_port(ab, bis):
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


def schritt(text):
    try:
        import time
        sys.stderr.write("%s %s\n" % (time.strftime("%H:%M:%S"), text))
        sys.stderr.flush()
    except Exception:
        pass


def main():
    protokoll_umlenken()
    if os.environ.get("V3DSCAN_STAPEL"):
        # Fehlersuche: haengt der Start, nach n Sekunden alle Stapel ins Protokoll
        import faulthandler
        faulthandler.dump_traceback_later(int(os.environ["V3DSCAN_STAPEL"]),
                                          repeat=True, file=sys.stderr)
    if getattr(sys, "frozen", False):
        os.chdir(os.path.dirname(sys.executable))

    port = freier_port(PORT, PORT + 1)
    if port is None:
        if antwortet(PORT):
            # Laeuft schon: nur ein weiteres Fenster oeffnen.
            import server
            server.browser_oeffnen("http://127.0.0.1:%d/" % PORT)
            return 0
        port = freier_port(PORT + 1, PORT + 12)
        if port is None:
            meldung("Kein freier Port für V3D Scan gefunden.\n\nBitte im Task-Manager "
                    "alle Einträge „V3DScan.exe“ beenden und neu starten.",
                    "V3D Scan", 0x10)
            return 1

    schritt("lade Rechenkern")
    import server
    schritt("Rechenkern geladen")
    dateien = [a for a in sys.argv[1:] if os.path.isfile(a)]
    # V3DSCAN_KEIN_FENSTER=1: nur Dienst (fuer Tests unter Wine)
    fenster = [] if os.environ.get("V3DSCAN_KEIN_FENSTER") else ["--browser"]
    sys.argv = [sys.argv[0], "--host", "127.0.0.1", "--port", str(port), "--auto-ende",
                "60"] + fenster + (["--laden"] + dateien if dateien else [])
    return server.main()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        pfad = protokoll_umlenken()
        sys.stderr.write(traceback.format_exc())
        sys.stderr.flush()
        meldung("V3D Scan konnte nicht starten:\n\n" + traceback.format_exc()[-1200:]
                + (("\n\nEinzelheiten: " + pfad) if pfad else ""),
                "V3D Scan - Fehler", 0x10)
        sys.exit(1)
