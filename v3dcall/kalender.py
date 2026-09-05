"""Kalender-Anbindung an V3D Familie.

Volker pflegt seine Termine in seinem eigenen Familien-Organizer auf Port
8787 — nicht bei goneo. Gelesen wird dessen ICS-Feed, geschrieben ueber
dessen Schnittstelle.
"""
import datetime
import json
import time
import urllib.request
import ssl

import core

_ctx = ssl.create_default_context()
_ctx.check_hostname = False
_ctx.verify_mode = ssl.CERT_NONE          # eigenes Zertifikat auf localhost


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
        titel = str(e.get("SUMMARY") or "belegt").strip()
        # Familienkalender: fremde Termine machen nur die Zeit belegt, ihr
        # INHALT geht den Telefonassistenten nichts an. "Neurologe Sylvia"
        # darf er nicht kennen — er soll nur wissen, dass die Zeit weg ist.
        wem = core.cfg("kalender", "nurPerson", default="")
        if wem and f"({wem})" not in titel:
            titel = "privat belegt"
        raus.append({
            "start": (d.strftime("%Y-%m-%d") if ganztags
                      else d.strftime("%Y-%m-%dT%H:%M:%S")),
            "summary": titel,
            "quelle": "abo",
        })
    return raus


def termine_alle(tage=14):
    """Alle angebundenen Kalender, zusammengefuehrt."""
    raus = []
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
    """Unverbindlichen Wunschtermin in V3D Familie eintragen.

    Nicht mehr bei goneo — dort schaut niemand hin. V3D Familie ist der
    Kalender, der tatsaechlich gepflegt wird, und der Eintrag erscheint
    damit sofort auf dem Handy.

    Deutlich als Vorschlag gekennzeichnet; bestaetigen muss Volker.
    """
    basis = core.cfg("kalender", "familieBasis", default="http://127.0.0.1:8787")
    sid = core.cfg("kalender", "familieSid", default="")
    if not sid:
        raise RuntimeError("Keine Sitzung fuer V3D Familie hinterlegt")

    def ortszeit(iso):
        """UTC-ISO -> Ortszeit ohne Zone, so wie V3D Familie sie speichert."""
        import datetime
        d = datetime.datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ")
        return (d + datetime.timedelta(hours=2 if time.localtime().tm_isdst else 1)
                ).strftime("%Y-%m-%dT%H:%M")

    r = urllib.request.Request(
        basis + "/api/termin",
        data=json.dumps({
            "titel": "VORSCHLAG: " + titel,
            "start": ortszeit(start_iso),
            "ende": ortszeit(ende_iso),
            "mid": core.cfg("kalender", "familieMid", default=1),
            "notiz": (notiz + "\n\nUnverbindlich vom Telefonassistenten "
                      "vorgemerkt. Bitte bestaetigen oder loeschen.").strip(),
        }).encode(),
        headers={"Content-Type": "application/json",
                 "Cookie": "v3dfam_sid=" + sid})
    with urllib.request.urlopen(r, timeout=25) as a:
        return json.loads(a.read().decode())
