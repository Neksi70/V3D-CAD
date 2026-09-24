"""Revolut Business API (nur Lesen, Scope READ).

Einrichtung: V3D Bank erzeugt ein Schlüsselpaar + X.509-Zertifikat. Das Zertifikat
lädt man in Revolut Business unter Einstellungen → APIs → Business API hoch,
trägt dort die Weiterleitungs-URL ein und bekommt die Client-ID. Danach einmal im
Browser freigeben; Revolut leitet auf die Weiterleitungs-URL mit ?code=… — die
Adresse wird in die App kopiert (Code gilt nur 2 Minuten). Der Refresh-Token läuft
nicht ab; Zugriffstokens (40 min) holt sich die App selbst.
"""
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlencode, urlparse

import jwt
import requests
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from . import BankFehler, NeuAnmelden, iso_lokal

PROD = "https://b2b.revolut.com/api/1.0"
SANDBOX = "https://sandbox-b2b.revolut.com/api/1.0"
FREIGABE_PROD = "https://business.revolut.com/app-confirm"
FREIGABE_SANDBOX = "https://sandbox-business.revolut.com/app-confirm"
STATUS = {"completed": "gebucht", "pending": "vorgemerkt", "created": "vorgemerkt", "declined": "abgelehnt",
          "failed": "fehlgeschlagen", "reverted": "storniert"}
ARTEN = {"card_payment": "Kartenzahlung", "card_refund": "Kartenerstattung", "transfer": "Überweisung",
         "exchange": "Umtausch", "topup": "Aufladung", "fee": "Gebühr", "atm": "Geldautomat",
         "refund": "Erstattung", "tax": "Steuer", "charge": "Belastung", "card_chargeback": "Rückbuchung",
         "topup_return": "Rückbuchung", "card_credit": "Gutschrift"}


class Revolut:
    name = "revolut"

    def __init__(self, tresor, http=None):
        self.tresor = tresor
        self.http = http or requests.Session()

    # -------------------------------------------------------------- Einrichtung
    def zertifikat_erzeugen(self, neu=False):
        c = self.tresor.get("revolut")
        if c.get("zertifikat") and not neu:
            return c["zertifikat"]
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "V3D Bank")])
        jetzt = datetime.now(timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                .serial_number(x509.random_serial_number()).not_valid_before(jetzt - timedelta(days=1))
                .not_valid_after(jetzt + timedelta(days=5 * 365)).sign(key, hashes.SHA256()))
        werte = {"private_key": key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                  serialization.NoEncryption()).decode(),
                 "zertifikat": cert.public_bytes(serialization.Encoding.PEM).decode(),
                 # neues Zertifikat = neue Client-ID bei Revolut, alte Freigabe ist wertlos
                 "refresh_token": None, "access_token": None, "client_id": None}
        self.tresor.set("revolut", werte)
        return werte["zertifikat"]

    def konfigurieren(self, client_id, redirect_uri, sandbox):
        if not client_id:
            raise BankFehler("Client-ID fehlt")
        u = urlparse(redirect_uri)
        if u.scheme != "https" or not u.hostname:
            raise BankFehler("Die Weiterleitungs-URL muss mit https:// beginnen")
        if not self.tresor.get("revolut").get("private_key"):
            raise BankFehler("Erst das Zertifikat erzeugen")
        self.tresor.set("revolut", {"client_id": client_id, "redirect_uri": redirect_uri, "sandbox": sandbox,
                                    "refresh_token": None, "access_token": None})

    def freigabe_link(self):
        c = self.tresor.get("revolut")
        basis = FREIGABE_SANDBOX if c.get("sandbox") else FREIGABE_PROD
        return basis + "?" + urlencode({"client_id": c["client_id"], "redirect_uri": c["redirect_uri"],
                                        "response_type": "code", "scope": "READ"})

    def _assertion(self, c):
        return jwt.encode({"iss": urlparse(c["redirect_uri"]).hostname, "sub": c["client_id"],
                           "aud": "https://revolut.com", "exp": int(time.time()) + 300},
                          c["private_key"], algorithm="RS256")

    def _token_holen(self, c, felder):
        felder.update({"client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                       "client_assertion": self._assertion(c)})
        try:
            r = self.http.post(self._basis(c) + "/auth/token", data=felder, timeout=30)
        except requests.RequestException as e:
            raise BankFehler(f"Revolut nicht erreichbar: {e.__class__.__name__}")
        j = _json(r)
        if r.status_code >= 400:
            text = j.get("error_description") or j.get("message") or f"HTTP {r.status_code}"
            if felder["grant_type"] == "refresh_token":
                raise NeuAnmelden(f"Revolut: Freigabe ungültig ({text}) — bitte neu freigeben")
            raise BankFehler(f"Revolut: {text}")
        werte = {"access_token": j["access_token"], "access_bis": time.time() + int(j.get("expires_in", 2399)) - 60}
        if j.get("refresh_token"):
            werte["refresh_token"] = j["refresh_token"]
        self.tresor.set("revolut", werte)
        c.update(werte)
        return c

    def code_einloesen(self, eingabe):
        """Nimmt die komplette Adresse nach der Weiterleitung oder nur den Code."""
        eingabe = eingabe.strip()
        code = (parse_qs(urlparse(eingabe).query).get("code") or [None])[0] if "code=" in eingabe else eingabe
        if not code:
            raise BankFehler("Kein Code gefunden — die komplette Adresse aus der Browserzeile einfügen")
        c = self.tresor.get("revolut")
        if not c.get("client_id"):
            raise BankFehler("Erst Client-ID und Weiterleitungs-URL speichern")
        try:
            self._token_holen(c, {"grant_type": "authorization_code", "code": code})
        except BankFehler as e:
            raise BankFehler(f"{e} — der Code gilt nur 2 Minuten, ggf. Freigabe wiederholen")

    # -------------------------------------------------------------- Abfragen
    def _basis(self, c):
        return SANDBOX if c.get("sandbox") else PROD

    def _zugang(self, neu=False):
        c = self.tresor.get("revolut")
        if not c.get("refresh_token"):
            raise BankFehler("Revolut: noch nicht freigegeben")
        if neu or not c.get("access_token") or c.get("access_bis", 0) < time.time():
            c = self._token_holen(c, {"grant_type": "refresh_token", "refresh_token": c["refresh_token"]})
        return c

    def _get(self, pfad, params=None):
        c = self._zugang()
        for versuch in range(2):
            try:
                r = self.http.get(self._basis(c) + pfad, params=params, timeout=30,
                                  headers={"Authorization": f"Bearer {c['access_token']}"})
            except requests.RequestException as e:
                raise BankFehler(f"Revolut nicht erreichbar: {e.__class__.__name__}")
            if r.status_code == 401 and versuch == 0:
                c = self._zugang(neu=True)
                continue
            j = _json(r)
            if r.status_code >= 400:
                raise BankFehler(f"Revolut: {j.get('message') if isinstance(j, dict) else ''} (HTTP {r.status_code})")
            return j

    def konten(self):
        return [{"ext_id": k["id"], "name": k.get("name") or f"Revolut {k.get('currency')}", "iban": None,
                 "waehrung": k.get("currency"), "saldo": float(k["balance"]) if k.get("balance") is not None else None}
                for k in self._get("/accounts") if k.get("state", "active") == "active"]

    def umsaetze(self, konto_id, seit):
        params = {"account": konto_id, "from": seit.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "count": 1000}
        aus, gesehen = [], set()
        for _ in range(100):
            liste = self._get("/transactions", params)
            for t in liste:
                for leg in t.get("legs", []):
                    if leg.get("account_id") != konto_id:
                        continue
                    eid = f"{t['id']}:{leg.get('leg_id', '')}"
                    if eid in gesehen:
                        continue
                    gesehen.add(eid)
                    gp = leg.get("counterparty") or {}
                    name = (t.get("merchant") or {}).get("name") or gp.get("name") or leg.get("description")
                    art = ARTEN.get(t.get("type"), t.get("type"))
                    text = t.get("reference") or leg.get("description")
                    if gp.get("account_type") == "self" or t.get("type") == "exchange":
                        art = "Umbuchung"  # zwischen eigenen Konten — zählt nicht als Ein-/Ausgabe
                    aus.append({"ext_id": eid, "datum": iso_lokal(t.get("created_at")), "betrag": float(leg["amount"]),
                                "waehrung": leg.get("currency"), "gegenpartei": name, "text": text, "art": art,
                                "status": STATUS.get(t.get("state"), t.get("state"))})
            if len(liste) < params["count"]:
                break
            params["to"] = liste[-1]["created_at"]  # neueste zuerst -> nächste Seite endet beim ältesten
        return aus


def _json(r):
    try:
        return r.json()
    except ValueError:
        return {}
