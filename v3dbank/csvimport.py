"""Kontoauszug als CSV einlesen — für alles, was keine API hat (SumUp-Geschäftskonto,
alte Auszüge, andere Banken). Spalten werden über ihre Überschrift erkannt,
Trennzeichen und Zahlenformat (1.234,56 / 1,234.56) automatisch.
"""
import csv
import hashlib
import io
import re
from datetime import datetime

SPALTEN = {
    "datum": ["buchungsdatum", "buchungstag", "datum", "date", "completed date", "date completed",
              "transaction date", "started date", "valuta", "wertstellung", "created", "zeitpunkt"],
    "betrag": ["betrag", "amount", "summe", "umsatz", "total amount", "betrag (eur)", "amount (eur)"],
    "ein": ["eingang", "gutschrift", "haben", "paid in", "money in", "credit", "einnahme"],
    "aus": ["ausgang", "lastschrift", "soll", "paid out", "money out", "debit", "ausgabe"],
    "gegenpartei": ["empfänger", "auftraggeber", "zahlungsempfänger", "zahlungspflichtiger", "name",
                    "gegenpartei", "counterparty", "payee", "payer", "beguenstigter/zahlungspflichtiger",
                    "begünstigter/zahlungspflichtiger", "empfänger/auftraggeber", "händler", "merchant"],
    "text": ["verwendungszweck", "beschreibung", "description", "reference", "referenz", "buchungstext",
             "details", "zahlungsreferenz", "notiz"],
    "waehrung": ["währung", "waehrung", "currency", "payment currency"],
    "status": ["status", "state"],
    "art": ["typ", "type", "art", "umsatzart", "transaction type"],
}


def _norm(s):
    return re.sub(r"\s+", " ", str(s or "").strip().lower().lstrip("﻿"))


def zahl(s):
    s = str(s or "").strip().replace("€", "").replace("EUR", "").replace(" ", "").replace(" ", "")
    if not s:
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        v = float(s)
    except ValueError:
        return None
    return -abs(v) if neg else v


FORMATE = ["%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M", "%d.%m.%Y", "%d.%m.%y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M",
           "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y/%m/%d"]


def datum(s):
    s = str(s or "").strip()
    s = re.sub(r"(\.\d+)?(Z|[+-]\d\d:?\d\d)$", "", s)
    for f in FORMATE:
        try:
            return datetime.strptime(s, f).strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            pass
    return None


def _spalte(kopf, art, belegt):
    """Erst exakte Treffer, dann Teilstring — so gewinnt 'Betrag' vor 'Betrag Gebühr'."""
    for kandidat in SPALTEN[art]:
        for i, h in enumerate(kopf):
            if i not in belegt and h == kandidat:
                return i
    for kandidat in SPALTEN[art]:
        for i, h in enumerate(kopf):
            if i not in belegt and kandidat in h and "gebühr" not in h and "fee" not in h and "saldo" not in h \
                    and "balance" not in h:
                return i
    return None


def einlesen(text, konto_key):
    """-> (umsaetze, info). konto_key fließt in die ext_id ein, damit gleiche Zeilen
    in verschiedenen Konten nicht kollidieren; derselbe Auszug zweimal = keine Dubletten."""
    text = text.lstrip("﻿")
    probe = "\n".join(text.splitlines()[:20])
    try:
        dialekt = csv.Sniffer().sniff(probe, delimiters=";,\t|")
    except csv.Error:
        dialekt = csv.excel
        dialekt.delimiter = ";" if probe.count(";") > probe.count(",") else ","
    zeilen = [z for z in csv.reader(io.StringIO(text), dialekt) if any(c.strip() for c in z)]
    # Kopfzeile = erste Zeile, in der Datum und (Betrag oder Ein/Aus) erkannt werden (Vorspann überspringen).
    for kz in range(min(15, len(zeilen))):
        kopf = [_norm(h) for h in zeilen[kz]]
        belegt = set()
        idx = {}
        for art in ("datum", "betrag", "ein", "aus", "waehrung", "status", "gegenpartei", "text", "art"):
            i = _spalte(kopf, art, belegt)
            if i is not None:
                idx[art] = i
                belegt.add(i)
        if "datum" in idx and ("betrag" in idx or "ein" in idx or "aus" in idx):
            break
    else:
        raise ValueError("Keine Spalten für Datum und Betrag gefunden")

    def feld(z, art):
        i = idx.get(art)
        return z[i].strip() if i is not None and i < len(z) else ""

    aus, gesehen, uebersprungen = [], {}, 0
    for z in zeilen[kz + 1:]:
        d = datum(feld(z, "datum"))
        if "betrag" in idx:
            b = zahl(feld(z, "betrag"))
        else:
            e, a = zahl(feld(z, "ein")), zahl(feld(z, "aus"))
            b = (e or 0) - abs(a or 0) if (e is not None or a is not None) else None
        if not d or b is None:
            uebersprungen += 1
            continue
        u = {"datum": d, "betrag": b, "waehrung": feld(z, "waehrung") or "EUR",
             "gegenpartei": feld(z, "gegenpartei") or None, "text": feld(z, "text") or None,
             "art": feld(z, "art") or None, "status": feld(z, "status").lower() or "gebucht"}
        roh = f"{konto_key}|{d}|{b:.2f}|{u['gegenpartei']}|{u['text']}"
        n = gesehen.get(roh, 0)
        gesehen[roh] = n + 1  # zwei identische Zeilen am selben Tag bleiben zwei Umsätze
        u["ext_id"] = "csv:" + hashlib.sha1(f"{roh}|{n}".encode()).hexdigest()[:20]
        aus.append(u)
    erkannt = {k: zeilen[kz][i] for k, i in idx.items()}
    return aus, {"spalten": erkannt, "uebersprungen": uebersprungen}
