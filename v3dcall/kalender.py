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


def _ics_termine(url, tage):
    """Einen Abo-Kalender (ICS) lesen. Wiederkehrende Termine werden aufgeklappt."""
    import datetime
    import icalendar
    import recurring_ical_events
    r = urllib.request.Request(url, headers={"User-Agent": "V3D-Anrufannahme"})
    with urllib.request.urlopen(r, timeout=25, context=_ctx) as a:
        kal = icalendar.Calendar.from_ical(a.read())
    heute = datetime.date.today()
    raus = []
    for e in recurring_ical_events.of(kal).between(heute, heute + datetime.timedelta(days=tage)):
        d = e.get("DTSTART").dt
        ganztags = not isinstance(d, datetime.datetime)
        raus.append({
            "start": (d.strftime("%Y-%m-%d") if ganztags
                      else d.strftime("%Y-%m-%dT%H:%M:%S")),
            "summary": str(e.get("SUMMARY") or "belegt").strip(),
            "quelle": "abo",
        })
    return raus


def termine_alle(tage=14):
    """Eigener Kalender plus alle Abo-Kalender, zusammengefuehrt."""
    raus = []
    try:
        raus += termine(tage)
    except Exception:
        pass
    for url in (core.cfg("kalender", "icsQuellen", default=[]) or []):
        try:
            raus += _ics_termine(url, tage)
        except Exception:
            pass          # eine unerreichbare Quelle darf den Anruf nicht stoeren
    return sorted(raus, key=lambda e: str(e.get("start") or ""))


def belegung_text(tage=14):
    """Kurzfassung fuer den Systemprompt — was in den naechsten Tagen ansteht.

    Bewusst knapp: das geht in JEDE erste Aeusserung ein und kostet dort
    Zeit. Nur Tag, Uhrzeit und Titel, keine Beschreibungen.
    """
    ev = termine_alle(tage)
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


def kalenderliste():
    """Alle Kalender des Kontos neu ermitteln (nach dem Hinzufuegen eines Abos)."""
    return (_ruf("/cal/setup", {}) or {}).get("calendars") or []


def vormerken(start_iso, ende_iso, titel, notiz=""):
    """Unverbindlichen Wunschtermin eintragen.

    Deutlich als Vorschlag gekennzeichnet — Volker bestaetigt oder verwirft.

    Das Ziel ist FEST hinterlegt (kalender.schreibkalender). Abo-Kalender
    sind nur lesbar — landete eines davon an erster Stelle, wuerde das
    Eintragen sonst fehlschlagen.
    """
    ziel = core.cfg("kalender", "schreibkalender", default="")
    return _ruf("/cal/save", {"calendar": ziel, "ev": {
        "start": start_iso, "end": ende_iso,
        "summary": "VORSCHLAG: " + titel,
        "description": (notiz + "\n\nUnverbindlich vom Telefonassistenten "
                        "vorgemerkt. Bitte bestaetigen oder loeschen.").strip(),
    }})
