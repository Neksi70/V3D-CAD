"""Kalender-Anbindung über V3D Mail.

V3D Mail spricht bereits CalDAV mit goneo — das bauen wir nicht nochmal,
sondern rufen dessen Schnittstelle auf 127.0.0.1:8783 auf.
"""
import datetime
import json
import urllib.request
import ssl

import core

_ctx = ssl.create_default_context()
_ctx.check_hostname = False
_ctx.verify_mode = ssl.CERT_NONE          # eigenes Zertifikat auf localhost


def _ruf(pfad, nutzlast):
    basis = core.cfg("kalender", "basis", default="https://127.0.0.1:8783/api")
    nutzlast = dict(nutzlast, acc=core.cfg("kalender", "konto", default=""))
    r = urllib.request.Request(
        basis + pfad, data=json.dumps(nutzlast).encode(),
        headers={"Content-Type": "application/json",
                 "Cookie": "v3dmail_sid=" + core.cfg("kalender", "sid", default="")})
    with urllib.request.urlopen(r, timeout=25, context=_ctx) as a:
        return json.loads(a.read().decode())


def termine(tage=14):
    """Termine der naechsten Tage, aufsteigend."""
    jetzt = datetime.datetime.now(datetime.timezone.utc)
    d = _ruf("/cal/events", {
        "start": jetzt.strftime("%Y%m%dT000000Z"),
        "end": (jetzt + datetime.timedelta(days=tage)).strftime("%Y%m%dT235959Z")})
    ev = d.get("events") or []
    return sorted(ev, key=lambda e: str(e.get("start") or ""))


def belegung_text(tage=14):
    """Kurzfassung fuer den Systemprompt — was in den naechsten Tagen ansteht.

    Bewusst knapp: das geht in JEDE erste Aeusserung ein und kostet dort
    Zeit. Nur Tag, Uhrzeit und Titel, keine Beschreibungen.
    """
    try:
        ev = termine(tage)
    except Exception:
        return ""
    if not ev:
        return ("Im Kalender stehen fuer die naechsten zwei Wochen KEINE Termine. "
                "Das heisst NICHT, dass Volker frei ist — der Kalender ist "
                "moeglicherweise nicht vollstaendig gepflegt.")
    TAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag",
            "Samstag", "Sonntag"]
    zeilen = []
    for e in ev[:25]:
        s = str(e.get("start") or "")
        try:
            dt = datetime.datetime.strptime(s[:16], "%Y-%m-%dT%H:%M")
            wann = f"{TAGE[dt.weekday()]} {dt.strftime('%d.%m.')} um {dt.strftime('%H:%M')}"
        except ValueError:
            try:
                dt = datetime.datetime.strptime(s[:10], "%Y-%m-%d")
                wann = f"{TAGE[dt.weekday()]} {dt.strftime('%d.%m.')} ganztaegig"
            except ValueError:
                continue
        zeilen.append(f"- {wann}: {str(e.get('summary') or 'belegt')[:48]}")
    return ("Termine der naechsten zwei Wochen (nur was eingetragen ist):\n"
            + "\n".join(zeilen))


def vormerken(start_iso, ende_iso, titel, notiz=""):
    """Unverbindlichen Wunschtermin eintragen.

    Deutlich als Vorschlag gekennzeichnet — Volker bestaetigt oder verwirft.
    """
    return _ruf("/cal/save", {"ev": {
        "start": start_iso, "end": ende_iso,
        "summary": "VORSCHLAG: " + titel,
        "description": (notiz + "\n\nUnverbindlich vom Telefonassistenten "
                        "vorgemerkt. Bitte bestaetigen oder loeschen.").strip(),
    }})
