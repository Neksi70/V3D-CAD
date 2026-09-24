"""Bank-Anbindungen. Jede liefert dieselbe Form:

konten()          -> [{ext_id, name, iban, waehrung, saldo}]
umsaetze(ext_id, seit: datetime) -> [{ext_id, datum, betrag, waehrung, gegenpartei, text, art, status}]

datum ist ein ISO-String in lokaler Zeit (Europe/Berlin), betrag negativ = Ausgabe.
"""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

BERLIN = ZoneInfo("Europe/Berlin")


class BankFehler(Exception):
    """Fehlermeldung, die so in der App angezeigt werden darf (keine Geheimnisse drin)."""


class NeuAnmelden(BankFehler):
    """Zugriff abgelaufen — Nutzer muss die Freigabe in der Bank neu erteilen."""


def iso_lokal(wert, naiv_ist_utc=True):
    """Beliebigen Zeitstempel der Bank in 'YYYY-MM-DD HH:MM:SS' Berliner Zeit wandeln."""
    if isinstance(wert, (int, float)):
        dt = datetime.fromtimestamp(wert, timezone.utc)
    else:
        s = str(wert).strip().replace("Z", "+00:00")
        if " " in s and "T" not in s:
            s = s.replace(" ", "T", 1)
        if "." in s:  # Mikrosekunden mit beliebig vielen Stellen kürzen
            kopf, rest = s.split(".", 1)
            ziffern = rest[:len(rest) - len(rest.lstrip("0123456789"))]  # nur die führenden Ziffern
            zone = rest[len(ziffern):]
            s = f"{kopf}.{ziffern[:6].ljust(6, '0')}{zone}"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc if naiv_ist_utc else BERLIN)
    return dt.astimezone(BERLIN).strftime("%Y-%m-%d %H:%M:%S")
