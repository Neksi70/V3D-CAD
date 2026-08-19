#!/usr/bin/env python3
# VolmeInventar - Einstieg fuer die gebaute EXE.
#
# Die EXE laeuft ohne Konsolenfenster.  Damit gibt es keinen Ort, an dem
# Meldungen landen koennten: jeder Schreibversuch auf stdout wuerde ins Leere
# laufen oder schlimmer, das Programm beenden.  Deshalb wird das Protokoll
# umgelenkt und ein Absturz als Windows-Meldefenster gezeigt - sonst
# verschwindet das Programm beim Doppelklick kommentarlos.

import os
import sys
import tempfile
import traceback

ANWENDUNG = "VolmeInventar"


def protokoll_umlenken():
    if not getattr(sys, "frozen", False) and sys.stdout is not None:
        return None
    ordner = os.path.join(os.environ.get("LOCALAPPDATA")
                          or tempfile.gettempdir(), ANWENDUNG)
    try:
        os.makedirs(ordner, exist_ok=True)
        datei = open(os.path.join(ordner, "protokoll.txt"), "a",
                     encoding="utf-8", buffering=1)
    except OSError:
        class Still:
            def write(self, *a):
                pass

            def flush(self):
                pass
        datei = Still()
    sys.stdout = sys.stderr = datei
    try:
        import time
        datei.write(f"\n=== {ANWENDUNG} gestartet "
                    f"{time.strftime('%d.%m.%Y %H:%M:%S')} ===\n")
    except Exception:                                  # noqa: BLE001
        pass
    return getattr(datei, "name", None)


def meldung(text, art=0x10):
    """0x10 = Fehler, 0x40 = Hinweis."""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, text, ANWENDUNG, art)
    except Exception:                                  # noqa: BLE001
        try:
            sys.__stderr__.write(text + "\n")
        except Exception:                              # noqa: BLE001
            pass


def main():
    protokolldatei = protokoll_umlenken()
    # Bei der gepackten EXE liegen die Module im entpackten Ordner - der
    # muss in den Suchpfad, sonst findet der Import sie nicht.
    basis = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    if basis not in sys.path:
        sys.path.insert(0, basis)
    try:
        import inventar
        # Mit Argumenten auf der Kommandozeile ohne Fenster arbeiten, damit
        # sich das Werkzeug auch in einem Anmeldeskript einsetzen laesst.
        if len(sys.argv) > 1:
            return inventar.hauptprogramm()
        import oberflaeche
        return oberflaeche.starten()
    except Exception:                                  # noqa: BLE001
        spur = traceback.format_exc()
        try:
            print(spur)
        except Exception:                              # noqa: BLE001
            pass
        hinweis = f"{ANWENDUNG} konnte nicht starten.\n\n{spur.strip()[-700:]}"
        if protokolldatei:
            hinweis += f"\n\nProtokoll: {protokolldatei}"
        meldung(hinweis)
        return 1


if __name__ == "__main__":
    sys.exit(main())
