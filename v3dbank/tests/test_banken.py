"""Revolut/SumUp/CSV/Tresor ohne Netz: Antworten nach dem Format der offiziellen OpenAPI-Beschreibungen.
Aufruf: python3 -m pytest tests/test_banken.py  (oder python3 tests/test_banken.py)"""
import json, os, sys, tempfile
from datetime import datetime, timedelta
from urllib.parse import parse_qs
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import jwt
from tresor import Tresor
from banken import NeuAnmelden
from banken.revolut import Revolut
from banken.sumup import SumUp
import csvimport
from speicher import Speicher


class Antwort:
    def __init__(self, code, daten): self.status_code, self._d = code, daten
    def json(self): return self._d


class Netz:
    """Nimmt Anfragen auf und beantwortet sie über eine Funktion (methode, url, params, data) -> Antwort."""
    def __init__(self, fn): self.fn, self.log = fn, []
    def get(self, url, params=None, **kw): self.log.append(("GET", url, dict(params or {}), kw)); return self.fn("GET", url, params or {}, None)
    def post(self, url, data=None, **kw): self.log.append(("POST", url, data, kw)); return self.fn("POST", url, {}, data)


def tresor():
    t = Tresor(tempfile.mkdtemp() + "/t.json"); t.anlegen("0123456789ab"); return t


def test_tresor():
    t = tresor(); t.set("x", {"a": 1}); t.zuschliessen()
    assert not t.aufschliessen("falschfalsch") and t.aufschliessen("0123456789ab") and t.get("x") == {"a": 1}
    roh = open(t.pfad).read(); assert '"a"' not in roh  # verschlüsselt


def test_revolut():
    t = tresor()
    tx = [{"id": "t1", "type": "card_payment", "state": "completed", "created_at": "2026-09-20T10:00:00.000000Z",
           "merchant": {"name": "Bambu Lab"}, "legs": [{"leg_id": "l1", "account_id": "A", "amount": -49.9, "currency": "EUR", "description": "Bambu"}]},
          {"id": "t2", "type": "transfer", "state": "pending", "created_at": "2026-09-19T08:00:00Z", "reference": "Rechnung 17",
           "legs": [{"leg_id": "l2", "account_id": "A", "amount": 300, "currency": "EUR", "counterparty": {"name": "Kunde GmbH", "account_type": "external"}},
                    {"leg_id": "l3", "account_id": "B", "amount": -300, "currency": "EUR"}]}]
    def fn(m, url, params, data):
        if url.endswith("/auth/token"):
            if data["grant_type"] == "refresh_token" and data["refresh_token"] == "kaputt":
                return Antwort(400, {"error": "invalid_grant", "error_description": "refresh token revoked"})
            return Antwort(200, {"access_token": "AT", "expires_in": 2399, "refresh_token": "RT", "token_type": "bearer"})
        if url.endswith("/accounts"):
            return Antwort(200, [{"id": "A", "name": "Main", "balance": 1234.5, "currency": "EUR", "state": "active"},
                                 {"id": "Z", "name": "Alt", "balance": 0, "currency": "USD", "state": "inactive"}])
        if url.endswith("/transactions"):
            return Antwort(200, tx)
    netz = Netz(fn); r = Revolut(t, netz)
    cert = r.zertifikat_erzeugen(); assert "BEGIN CERTIFICATE" in cert
    r.konfigurieren("CLIENT", "https://example.com/cb", False)
    assert "client_id=CLIENT" in r.freigabe_link() and "scope=READ" in r.freigabe_link()
    r.code_einloesen("https://example.com/cb?code=oa_prod_123")
    m, url, data, kw = netz.log[-1]
    assert data["grant_type"] == "authorization_code" and data["code"] == "oa_prod_123" and "client_id" not in data
    claims = jwt.decode(data["client_assertion"], options={"verify_signature": False})
    assert claims["iss"] == "example.com" and claims["sub"] == "CLIENT" and claims["aud"] == "https://revolut.com" and isinstance(claims["exp"], int)
    k = r.konten(); assert k == [{"ext_id": "A", "name": "Main", "iban": None, "waehrung": "EUR", "saldo": 1234.5}]
    u = r.umsaetze("A", datetime.now() - timedelta(days=30))
    assert [x["betrag"] for x in u] == [-49.9, 300] and u[0]["gegenpartei"] == "Bambu Lab" and u[1]["status"] == "vorgemerkt"
    assert u[0]["datum"] == "2026-09-20 12:00:00"  # UTC -> Berlin (Sommerzeit)
    assert netz.log[-1][2]["account"] == "A" and netz.log[-1][3]["headers"]["Authorization"] == "Bearer AT"
    t.set("revolut", {"refresh_token": "kaputt", "access_token": None})
    try: r.konten(); assert False
    except NeuAnmelden: pass


def test_sumup():
    t = tresor(); t.set("sumup", {"api_key": "sup_sk_test"})
    seiten = {None: {"items": [{"id": "u1", "transaction_code": "TX1", "amount": 25.0, "currency": "EUR", "timestamp": "2026-09-01T09:00:00Z",
                                "status": "SUCCESSFUL", "type": "PAYMENT", "payment_type": "POS", "card_type": "VISA"}],
                      "links": [{"rel": "next", "href": "limit=100&oldest_ref=u1&order=ascending"}]},
              "u1": {"items": [{"id": "u2", "transaction_code": "TX2", "amount": 10.0, "currency": "EUR", "timestamp": "2026-09-02T09:00:00Z",
                                "status": "SUCCESSFUL", "type": "REFUND"}], "links": []}}
    def fn(m, url, params, data):
        if url.endswith("/v0.1/memberships"):
            return Antwort(200, {"items": [{"id": "mem", "resource": {"id": "MC123", "type": "merchant", "name": "Volme"}}]})
        if "/transactions/history" in url:
            return Antwort(200, seiten[params.get("oldest_ref")])
        if "/payouts" in url:
            return Antwort(200, [{"id": 7, "type": "PAYOUT", "amount": 14.5, "fee": 0.5, "currency": "EUR", "date": "2026-09-03", "status": "SUCCESSFUL", "reference": "ABC"}]
                           if params["start_date"] <= "2026-09-03" <= params["end_date"] else [])
    netz = Netz(fn); s = SumUp(t, netz)
    assert s.konten()[0]["ext_id"] == "MC123"
    u = s.umsaetze("MC123", datetime(2026, 8, 1))
    assert [x["betrag"] for x in u] == [25.0, -10.0, -14.5], u
    assert netz.log[0][3]["headers"]["Authorization"] == "Bearer sup_sk_test"
    db = Speicher(":memory:"); kid = db.konto_speichern("sumup", s.konten()[0])
    assert db.umsaetze_speichern("sumup", kid, u) == 3
    kat = {x["betrag"]: x["kategorie"] for x in db.umsaetze()}
    assert kat == {25.0: "Einnahmen Kasse", -10.0: "Einnahmen Kasse", -14.5: "Umbuchung"}, kat
    assert db.umsaetze_speichern("sumup", kid, u) == 0


def test_csv():
    rev = "Date started (UTC),Date completed (UTC),ID,Type,Description,Reference,Payer,Card number,Orig currency,Orig amount,Payment currency,Amount,Fee,Balance\n" \
          "2026-09-01,2026-09-01,abc,CARD_PAYMENT,Amazon,,,,EUR,-12.5,EUR,-12.5,0,100\n2026-09-02,2026-09-02,abd,TRANSFER,Kunde,Re 5,,,EUR,1000,EUR,\"1,000.00\",0,1100\n"
    u, info = csvimport.einlesen(rev, "k")
    assert [x["betrag"] for x in u] == [-12.5, 1000.0], (u, info)
    de = "Kontoauszug\n\nDatum;Beschreibung;Eingang;Ausgang\n01.09.2026;Miete;;1.200,00\n02.09.2026;Kunde;350,00;\n"
    u, _ = csvimport.einlesen(de, "k"); assert [x["betrag"] for x in u] == [-1200.0, 350.0]


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"): f(); print("ok", n)
