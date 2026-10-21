# Auto-Sicherung: das Projekt wird in festem Abstand (nur nach Aenderungen) als .v3dscan in einen Ordner
# geschrieben; die letzten N bleiben. Ordner: V3DSCAN_SICHERUNG, sonst %LOCALAPPDATA%\V3DScan\sicherung
# bzw. ~/.local/share/v3dscan/sicherung.

import os
import re
import time

BEHALTEN = 5
_NAME = re.compile(r"^auto-\d{8}-\d{6}\.v3dscan$")


def ordner():
    o = os.environ.get("V3DSCAN_SICHERUNG")
    if not o:
        if os.environ.get("LOCALAPPDATA"):
            o = os.path.join(os.environ["LOCALAPPDATA"], "V3DScan", "sicherung")
        else:
            o = os.path.join(os.path.expanduser("~"), ".local", "share", "v3dscan", "sicherung")
    os.makedirs(o, exist_ok=True)
    return o


def schreiben(daten, behalten=BEHALTEN):
    """Bytes einer Projektdatei ablegen, Aelteste ueber `behalten` hinaus loeschen -> Name."""
    name = time.strftime("auto-%Y%m%d-%H%M%S.v3dscan")
    pfad = os.path.join(ordner(), name)
    tmp = pfad + ".tmp"
    with open(tmp, "wb") as f:
        f.write(daten)
    os.replace(tmp, pfad)                      # nie eine halbe Datei als Sicherung
    for alt in [e["name"] for e in liste()][behalten:]:
        try:
            os.remove(os.path.join(ordner(), alt))
        except OSError:
            pass
    return name


def liste():
    """Neueste zuerst: [{name, zeit (Unix), groesse}]."""
    aus = []
    for n in os.listdir(ordner()):
        if _NAME.match(n):
            st = os.stat(os.path.join(ordner(), n))
            aus.append({"name": n, "zeit": st.st_mtime, "groesse": st.st_size})
    return sorted(aus, key=lambda e: e["name"], reverse=True)


def lesen(name):
    if not _NAME.match(str(name)):
        raise ValueError("Unbekannte Sicherung.")
    with open(os.path.join(ordner(), name), "rb") as f:
        return f.read()
