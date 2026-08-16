#!/usr/bin/env python3
# VolmeStick - Einstieg fuer die gebaute EXE.
#
# Die EXE laeuft ohne Konsolenfenster. Damit gibt es keinen Ort, an dem
# Meldungen landen koennten - Fehler werden deshalb als Windows-Meldefenster
# gezeigt, und beendet wird die Anwendung ueber den Knopf in der Oberflaeche.

import os
import socket
import sys
import tempfile
import traceback

PORT = 8775


def protokoll_umlenken():
    """Ohne Konsolenfenster gibt es weder stdout noch stderr - jeder
    Schreibversuch darauf wuerde die laufende Anfrage abbrechen. Also
    schreiben wir in eine Datei, die zugleich bei der Fehlersuche hilft."""
    if sys.stdout is not None and sys.stderr is not None:
        return None
    ordner = os.path.join(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir(),
                          "VolmeStick")
    try:
        os.makedirs(ordner, exist_ok=True)
        datei = open(os.path.join(ordner, "protokoll.txt"), "a", encoding="utf-8",
                     buffering=1)
    except Exception:
        class Still:
            def write(self, *a):
                pass

            def flush(self):
                pass
        datei = Still()
    if sys.stdout is None:
        sys.stdout = datei
    if sys.stderr is None:
        sys.stderr = datei
    return getattr(datei, "name", None)


def meldung(text, titel="VolmeStick", art=0x40):
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


def main():
    protokoll_umlenken()
    if getattr(sys, "frozen", False):
        os.chdir(os.path.dirname(sys.executable))

    if belegt(PORT):
        # Schon gestartet - dann einfach die vorhandene Oberflaeche zeigen
        import webbrowser
        webbrowser.open(f"http://localhost:{PORT}/")
        meldung(f"VolmeStick läuft bereits.\n\n"
                f"Die Oberfläche wurde im Browser geöffnet:\n"
                f"http://localhost:{PORT}")
        return 0

    import server
    if len(sys.argv) == 1:
        sys.argv += ["--host", "127.0.0.1", "--port", str(PORT), "--browser"]
    return server.main()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        pfad = protokoll_umlenken()
        meldung("VolmeStick konnte nicht starten:\n\n" + traceback.format_exc()[-1200:]
                + (f"\n\nEinzelheiten: {pfad}" if pfad else ""),
                "VolmeStick - Fehler", 0x10)
        sys.exit(1)
