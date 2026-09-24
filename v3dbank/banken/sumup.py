"""SumUp — Kartenverkäufe und Auszahlungen über die Händler-API (API-Schlüssel sup_sk_…).

Das SumUp-Geschäftskonto selbst hat KEINE öffentliche API (nur über lizenzierte
PSD2-Dienstleister). Dessen Umsätze kommen per CSV-Export aus me.sumup.com
(Geschäftskonto → Herunterladen) über den CSV-Import der App.

Hier gibt es ein Pseudo-Konto "SumUp Kasse": Verkäufe positiv, Erstattungen und
Auszahlungen aufs Bankkonto negativ. Einen Saldo liefert die API nicht.
"""
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs

import requests

from . import BankFehler, NeuAnmelden, iso_lokal

BASIS = "https://api.sumup.com"
STATUS = {"SUCCESSFUL": "gebucht", "PAID_OUT": "gebucht", "PENDING": "vorgemerkt", "FAILED": "fehlgeschlagen",
          "CANCELLED": "storniert", "REFUNDED": "erstattet", "CHARGE_BACK": "rückbelastet"}


class SumUp:
    name = "sumup"

    def __init__(self, tresor, http=None):
        self.tresor = tresor
        self.http = http or requests.Session()

    def _get(self, pfad, params=None):
        c = self.tresor.get("sumup")
        if not c.get("api_key"):
            raise BankFehler("SumUp: noch kein API-Schlüssel hinterlegt")
        try:
            r = self.http.get(BASIS + pfad, params=params, timeout=30,
                              headers={"Authorization": f"Bearer {c['api_key']}", "Accept": "application/json"})
        except requests.RequestException as e:
            raise BankFehler(f"SumUp nicht erreichbar: {e.__class__.__name__}")
        try:
            j = r.json()
        except ValueError:
            j = {}
        if r.status_code == 401:
            raise NeuAnmelden("SumUp: API-Schlüssel ungültig oder widerrufen")
        if r.status_code >= 400:
            text = j.get("message") or j.get("error_message") or j.get("detail") if isinstance(j, dict) else None
            raise BankFehler(f"SumUp: {text or 'HTTP ' + str(r.status_code)}")
        return j

    def _haendler(self):
        c = self.tresor.get("sumup")
        if c.get("merchant_code"):
            return c["merchant_code"]
        j = self._get("/v0.1/memberships")
        codes = [m["resource"]["id"] for m in j.get("items", [])
                 if (m.get("resource") or {}).get("type") == "merchant"]
        if not codes:
            raise BankFehler("SumUp: kein Händlerkonto zu diesem Schlüssel gefunden")
        self.tresor.set("sumup", {"merchant_code": codes[0]})
        return codes[0]

    def konten(self):
        mc = self._haendler()
        return [{"ext_id": mc, "name": "SumUp Kasse", "iban": None, "waehrung": "EUR", "saldo": None}]

    def umsaetze(self, konto_id, seit):
        mc = konto_id
        aus = []
        # Verkäufe / Erstattungen
        params = {"limit": 100, "order": "ascending",
                  "oldest_time": seit.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
        pfad = f"/v2.1/merchants/{mc}/transactions/history"
        for _ in range(500):
            j = self._get(pfad, params)
            for t in j.get("items", []):
                erstattung = t.get("type") == "REFUND"
                betrag = float(t.get("amount") or 0)
                karte = " ".join(x for x in (t.get("payment_type"), t.get("card_type")) if x) or None
                aus.append({"ext_id": t.get("id") or t.get("transaction_code"), "datum": iso_lokal(t["timestamp"]),
                            "betrag": -abs(betrag) if erstattung else betrag, "waehrung": t.get("currency"),
                            "gegenpartei": "SumUp-Kunde",
                            "text": f"{'SumUp-Erstattung' if erstattung else 'SumUp-Verkauf'} {t.get('transaction_code') or ''}".strip(),
                            "art": ("Erstattung " if erstattung else "Kartenzahlung ") + (karte or ""),
                            "status": STATUS.get(t.get("status"), (t.get("status") or "").lower())})
            weiter = next((l.get("href") for l in j.get("links", []) if l.get("rel") == "next"), None)
            if not weiter or not j.get("items"):
                break
            # href ist nur ein Query-String (limit=…&oldest_ref=…) — an den Pfad hängen
            params = {k: v[0] for k, v in parse_qs(weiter.split("?")[-1]).items()}

        # Auszahlungen aufs Bankkonto (verlassen die "Kasse")
        start = seit.date()
        while start <= datetime.now().date():
            ende = min(start + timedelta(days=90), datetime.now().date())
            liste = self._get(f"/v1.0/merchants/{mc}/payouts",
                              {"start_date": start.isoformat(), "end_date": ende.isoformat(), "limit": 9999,
                               "order": "asc", "format": "json"})
            for p in liste if isinstance(liste, list) else liste.get("items", []):
                betrag = abs(float(p.get("amount") or 0))
                gebuehr = float(p.get("fee") or 0)
                art = "Auszahlung" if p.get("type") == "PAYOUT" else (p.get("type") or "").replace("_", " ").title()
                text = f"SumUp Auszahlung {p.get('reference') or ''}".strip()
                if gebuehr:
                    text += f" (Gebühr {gebuehr:.2f})"
                aus.append({"ext_id": f"payout:{p.get('id')}:{p.get('type')}:{p.get('transaction_code') or ''}",
                            "datum": iso_lokal(p["date"] + "T12:00:00", naiv_ist_utc=False) if len(str(p.get("date"))) == 10
                            else iso_lokal(p["date"]),
                            "betrag": -betrag, "waehrung": p.get("currency"), "gegenpartei": "Eigenes Bankkonto",
                            "text": text, "art": art, "status": STATUS.get(p.get("status"), (p.get("status") or "").lower())})
            start = ende + timedelta(days=1)
        return aus
