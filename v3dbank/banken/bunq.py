"""bunq — offizielle Public API (nur lesend genutzt).

Ablauf beim ersten Mal: eigenes RSA-Schlüsselpaar -> /installation -> /device-server
(registriert den API-Schlüssel für dieses Gerät) -> /session-server. Schlüsselpaar,
Installations-Token und Sitzung liegen im Tresor; läuft die Sitzung ab, wird nur
/session-server wiederholt.
"""
import base64
import json
import time
import uuid

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from . import BankFehler, NeuAnmelden, iso_lokal

PROD = "https://api.bunq.com/v1"
SANDBOX = "https://public-api.sandbox.bunq.com/v1"
AGENT = "V3D-Bank/1.0"
ARTEN = {"MASTERCARD": "Kartenzahlung", "IDEAL": "iDEAL", "BUNQ": "bunq-intern", "EBA_SCT": "Überweisung",
         "SWIFT": "Auslandsüberweisung", "SAVINGS": "Sparen", "INTEREST": "Zinsen", "SOFORT": "Sofort"}


class Bunq:
    name = "bunq"

    def __init__(self, tresor, http=None):
        self.tresor = tresor
        self.http = http or requests.Session()

    # -------------------------------------------------------------- Basis
    def _cfg(self):
        c = self.tresor.get("bunq")
        if not c.get("api_key"):
            raise BankFehler("bunq: noch kein API-Schlüssel hinterlegt")
        return c

    def _basis(self, c):
        return SANDBOX if c.get("sandbox") else PROD

    def _signatur(self, c, body):
        key = serialization.load_pem_private_key(c["private_key"].encode(), password=None)
        sig = key.sign(body, padding.PKCS1v15(), hashes.SHA256())
        return base64.b64encode(sig).decode()

    def _anfrage(self, methode, pfad, c, token=None, daten=None):
        body = json.dumps(daten).encode() if daten is not None else b""
        kopf = {"User-Agent": AGENT, "Cache-Control": "no-cache", "X-Bunq-Language": "de_DE",
                "X-Bunq-Region": "de_DE", "X-Bunq-Geolocation": "0 0 0 0 000",
                "X-Bunq-Client-Request-Id": str(uuid.uuid4()), "Content-Type": "application/json"}
        if token:
            kopf["X-Bunq-Client-Authentication"] = token
        if body and c.get("private_key"):
            kopf["X-Bunq-Client-Signature"] = self._signatur(c, body)
        url = pfad if pfad.startswith("http") else self._basis(c) + pfad
        try:
            r = self.http.request(methode, url, data=body or None, headers=kopf, timeout=30)
        except requests.RequestException as e:
            raise BankFehler(f"bunq nicht erreichbar: {e.__class__.__name__}")
        try:
            j = r.json()
        except ValueError:
            j = {}
        if r.status_code >= 400:
            text = "; ".join(e.get("error_description_translated") or e.get("error_description", "")
                             for e in j.get("Error", [])) or f"HTTP {r.status_code}"
            fehler = NeuAnmelden if r.status_code == 401 else BankFehler
            raise fehler(f"bunq: {text}")
        return j

    @staticmethod
    def _teile(j):
        """bunq packt alles in Response: [{Typ: {...}}, ...] — in ein Dict Typ -> Inhalt wandeln."""
        aus = {}
        for eintrag in j.get("Response", []):
            for typ, inhalt in eintrag.items():
                aus.setdefault(typ, inhalt)
        return aus

    # -------------------------------------------------------------- Anmeldung
    def einrichten(self):
        """Installation + Gerät anmelden (einmalig pro API-Schlüssel)."""
        c = self._cfg()
        if not c.get("private_key"):
            key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            c["private_key"] = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                 serialization.NoEncryption()).decode()
            self.tresor.set("bunq", {"private_key": c["private_key"]})
        if not c.get("installation_token"):
            pub = serialization.load_pem_private_key(c["private_key"].encode(), None).public_key()
            pem = pub.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
            t = self._teile(self._anfrage("POST", "/installation", c, daten={"client_public_key": pem}))
            c["installation_token"] = t["Token"]["token"]
            self.tresor.set("bunq", {"installation_token": c["installation_token"]})
        if not c.get("geraet_ok"):
            try:
                self._anfrage("POST", "/device-server", c, token=c["installation_token"],
                              daten={"description": "V3D Bank", "secret": c["api_key"], "permitted_ips": ["*"]})
            except BankFehler:
                # "*" geht nur, wenn in der bunq-App "Alle IP-Adressen erlauben" gesetzt ist —
                # sonst bindet bunq den Schlüssel an die aktuelle IP des Servers.
                self._anfrage("POST", "/device-server", c, token=c["installation_token"],
                              daten={"description": "V3D Bank", "secret": c["api_key"]})
            self.tresor.set("bunq", {"geraet_ok": True})
            c["geraet_ok"] = True
        return c

    def _sitzung(self, neu=False):
        c = self._cfg()
        if not neu and c.get("session_token") and c.get("session_bis", 0) > time.time() + 60:
            return c
        c = self.einrichten()
        t = self._teile(self._anfrage("POST", "/session-server", c, token=c["installation_token"],
                                      daten={"secret": c["api_key"]}))
        nutzer = t.get("UserPerson") or t.get("UserCompany") or t.get("UserApiKey") or t.get("UserPaymentServiceProviderApiKey")
        if not nutzer:
            raise BankFehler("bunq: Sitzung ohne Nutzerdaten")
        # Sitzungsdauer ist pro Nutzer einstellbar (session_timeout, Sekunden); vorsichtig kürzen.
        dauer = int(nutzer.get("session_timeout") or 3600)
        werte = {"session_token": t["Token"]["token"], "user_id": nutzer["id"],
                 "session_bis": time.time() + max(300, dauer - 300)}
        self.tresor.set("bunq", werte)
        c.update(werte)
        return c

    def _get(self, pfad):
        c = self._sitzung()
        try:
            return self._anfrage("GET", pfad.format(u=c["user_id"]), c, token=c["session_token"])
        except NeuAnmelden:
            c = self._sitzung(neu=True)
            return self._anfrage("GET", pfad.format(u=c["user_id"]), c, token=c["session_token"])

    # -------------------------------------------------------------- Daten
    def konten(self):
        j = self._get("/user/{u}/monetary-account?count=100")
        aus = []
        for eintrag in j.get("Response", []):
            for typ, k in eintrag.items():
                if k.get("status") not in (None, "ACTIVE"):
                    continue
                iban = next((a["value"] for a in k.get("alias", []) if a.get("type") == "IBAN"), None)
                saldo = k.get("balance") or {}
                aus.append({"ext_id": k["id"], "name": k.get("description") or typ.replace("MonetaryAccount", ""),
                            "iban": iban, "waehrung": saldo.get("currency") or k.get("currency"),
                            "saldo": float(saldo["value"]) if saldo.get("value") is not None else None})
        return aus

    def umsaetze(self, konto_id, seit):
        grenze = seit.strftime("%Y-%m-%d %H:%M:%S")
        pfad = f"/user/{{u}}/monetary-account/{konto_id}/payment?count=200"
        aus = []
        for _ in range(50):  # max. 10 000 Buchungen pro Abruf
            j = self._get(pfad)
            fertig = False
            for eintrag in j.get("Response", []):
                p = eintrag.get("Payment")
                if not p:
                    continue
                datum = iso_lokal(p["created"])
                if datum < grenze:
                    fertig = True
                    continue
                gp = p.get("counterparty_alias") or {}
                name = gp.get("display_name") or (gp.get("label_user") or {}).get("display_name")
                aus.append({"ext_id": p["id"], "datum": datum, "betrag": float(p["amount"]["value"]),
                            "waehrung": p["amount"].get("currency"), "gegenpartei": name,
                            "text": p.get("description"), "art": ARTEN.get(p.get("type"), p.get("type")),
                            "status": "gebucht"})
            aeltere = (j.get("Pagination") or {}).get("older_url")
            if fertig or not aeltere:
                break
            pfad = aeltere[3:] if aeltere.startswith("/v1/") else aeltere  # enthält die User-ID schon
        return aus

    # -------------------------------------------------------------- Sandbox
    @staticmethod
    def sandbox_nutzer_anlegen(http=None):
        """Testnutzer in der bunq-Sandbox (ohne Anmeldung) — liefert dessen API-Schlüssel."""
        http = http or requests
        r = http.post(SANDBOX + "/sandbox-user-person", headers={
            "User-Agent": AGENT, "Cache-Control": "no-cache", "X-Bunq-Client-Request-Id": str(uuid.uuid4()),
            "X-Bunq-Language": "de_DE", "X-Bunq-Region": "de_DE", "X-Bunq-Geolocation": "0 0 0 0 000",
            "Content-Type": "application/json"}, data="{}", timeout=30)
        r.raise_for_status()
        for e in r.json()["Response"]:
            if "ApiKey" in e:
                return e["ApiKey"]["api_key"]
        raise BankFehler("bunq-Sandbox: kein API-Schlüssel erhalten")
