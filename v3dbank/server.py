#!/usr/bin/env python3
"""V3D Bank — Kontostände und Umsätze von bunq, Revolut Business und SumUp an einem Ort.

Aufruf: python3 server.py [port]

Nur lesend. Lauscht ausschließlich auf der Tailnet-Adresse (config.json "host") —
NICHT in den Funnel hängen: hinter dem Funnel sieht jede Anfrage aus wie 127.0.0.1.
"""
import json
import os
import secrets
import sys
import threading
import time
import traceback
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import csvimport
from banken import BankFehler, NeuAnmelden
from banken.bunq import Bunq
from banken.revolut import Revolut
from banken.sumup import SumUp
from speicher import Speicher
from tresor import Tresor

BASIS = os.path.dirname(os.path.abspath(__file__))
DATEN = os.environ.get("V3DBANK_DATEN") or os.path.join(BASIS, "data")   # Tests: eigenes Verzeichnis
CONFIG_PFAD = os.environ.get("V3DBANK_CONFIG") or os.path.join(BASIS, "config.json")
os.makedirs(DATEN, mode=0o700, exist_ok=True)

SITZUNG_LEERLAUF = 30 * 60           # abmelden nach 30 min ohne Aktivität
ABRUF_INTERVALL = 60 * 60            # Hintergrund-Abruf stündlich, solange der Tresor offen ist
ERSTER_ABRUF_TAGE = 400
UEBERLAPPUNG_TAGE = 14               # vorgemerkte Umsätze ändern noch ihren Status


def config():
    std = {"host": "100.125.34.44", "port": 8801}
    if not os.path.exists(CONFIG_PFAD):
        fd = os.open(CONFIG_PFAD, os.O_WRONLY | os.O_CREAT, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(std, f, indent=2)
        return std
    with open(CONFIG_PFAD) as f:
        return {**std, **json.load(f)}


CFG = config()
TRESOR = Tresor(os.path.join(DATEN, "tresor.json"))
DB = Speicher(os.path.join(DATEN, "bank.db"))
BANKEN = {"bunq": Bunq(TRESOR), "revolut": Revolut(TRESOR), "sumup": SumUp(TRESOR)}
BANK_NAMEN = {"bunq": "bunq", "revolut": "Revolut Business", "sumup": "SumUp", "csv": "CSV-Import"}

SITZUNGEN = {}                       # token -> letzte Aktivität (nur im Speicher: Neustart = neu anmelden)
FEHLVERSUCHE = []                    # Zeitpunkte falscher Passwörter
ABRUF_LOCK = threading.Lock()


# ---------------------------------------------------------------- Abruf
def bank_eingerichtet(name):
    if not TRESOR.offen():
        return False
    c = TRESOR.get(name)
    return bool(c.get("api_key") or c.get("refresh_token"))


def abrufen(nur=None):
    """Alle eingerichteten Banken abfragen. Ergebnis pro Bank: {ok, neu, meldung}."""
    if not TRESOR.offen():
        return {"fehler": "Tresor ist zu"}
    with ABRUF_LOCK:
        ergebnis = {}
        letzte = DB.abrufe()
        for name, bank in BANKEN.items():
            if nur and name != nur or not bank_eingerichtet(name):
                continue
            try:
                vorher = letzte.get(name)
                if vorher and vorher["ok"] and DB.anzahl(name):
                    seit = datetime.fromtimestamp(vorher["zuletzt"]) - timedelta(days=UEBERLAPPUNG_TAGE)
                else:
                    seit = datetime.now() - timedelta(days=ERSTER_ABRUF_TAGE)
                neu = 0
                for k in bank.konten():
                    kid = DB.konto_speichern(name, k)
                    neu += DB.umsaetze_speichern(name, kid, bank.umsaetze(k["ext_id"], seit))
                DB.abruf_melden(name, True, f"{neu} neue Umsätze")
                ergebnis[name] = {"ok": True, "neu": neu}
            except NeuAnmelden as e:
                DB.abruf_melden(name, False, str(e))
                ergebnis[name] = {"ok": False, "meldung": str(e), "neu_anmelden": True}
            except BankFehler as e:
                DB.abruf_melden(name, False, str(e))
                ergebnis[name] = {"ok": False, "meldung": str(e)}
            except Exception as e:  # nie Details mit evtl. Geheimnissen in die App
                traceback.print_exc()
                DB.abruf_melden(name, False, f"Interner Fehler ({e.__class__.__name__})")
                ergebnis[name] = {"ok": False, "meldung": f"Interner Fehler ({e.__class__.__name__})"}
        return ergebnis


def hintergrund():
    while True:
        time.sleep(60)
        try:
            if not TRESOR.offen():
                continue
            letzte = DB.abrufe()
            faellig = any(bank_eingerichtet(n) and time.time() - (letzte.get(n) or {}).get("zuletzt", 0) > ABRUF_INTERVALL
                          for n in BANKEN)
            if faellig:
                print("[abruf]", abrufen(), flush=True)
        except Exception:
            traceback.print_exc()


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "V3DBank"
    sys_version = ""

    def log_message(self, fmt, *args):  # keine URLs mit Suchbegriffen ins Journal
        pass

    # ------------------------------------------------------------ Antworten
    def _senden(self, code, body, typ="application/json; charset=utf-8", kopf=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
                         "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'")
        for k, v in (kopf or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _fehler(self, code, meldung):
        self._senden(code, {"fehler": meldung})

    def _json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 20 * 1024 * 1024:
            raise ValueError("Anfrage zu groß")
        return json.loads(self.rfile.read(n) or b"{}")

    # ------------------------------------------------------------ Anmeldung
    def _token(self):
        for teil in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = teil.strip().partition("=")
            if k == "v3dbank":
                return v
        return None

    def _angemeldet(self):
        t = self._token()
        zuletzt = SITZUNGEN.get(t) if t else None
        if not zuletzt or time.time() - zuletzt > SITZUNG_LEERLAUF or not TRESOR.offen():
            SITZUNGEN.pop(t, None)
            return False
        SITZUNGEN[t] = time.time()
        return True

    def _sitzung_starten(self, extra=None):
        t = secrets.token_urlsafe(32)
        SITZUNGEN[t] = time.time()
        self._senden(200, {"ok": True, **(extra or {})},
                     kopf={"Set-Cookie": f"v3dbank={t}; HttpOnly; SameSite=Strict; Path=/"})

    def _bremse(self):
        """Nach 5 Fehlversuchen in 10 min: Anmeldung 10 min gesperrt."""
        jetzt = time.time()
        FEHLVERSUCHE[:] = [t for t in FEHLVERSUCHE if jetzt - t < 600]
        return len(FEHLVERSUCHE) >= 5

    # ------------------------------------------------------------ GET
    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path in ("/", "/index.html"):
                with open(os.path.join(BASIS, "app.html"), "rb") as f:
                    return self._senden(200, f.read(), "text/html; charset=utf-8")
            if u.path == "/logo.svg":
                with open(os.path.join(BASIS, "logo.svg"), "rb") as f:
                    return self._senden(200, f.read(), "image/svg+xml")
            if u.path == "/api/status":
                return self._senden(200, {"angelegt": TRESOR.angelegt(), "offen": TRESOR.offen(),
                                          "angemeldet": self._angemeldet()})
            if not u.path.startswith("/api/"):
                return self._fehler(404, "Nicht gefunden")
            if not self._angemeldet():
                return self._fehler(401, "Bitte anmelden")
            return self._api_get(u.path, q)
        except Exception as e:
            traceback.print_exc()
            return self._fehler(500, f"Interner Fehler ({e.__class__.__name__})")

    def _api_get(self, pfad, q):
        if pfad == "/api/uebersicht":
            abrufe = DB.abrufe()
            banken = []
            for n in BANKEN:
                a = abrufe.get(n) or {}
                banken.append({"id": n, "name": BANK_NAMEN[n], "eingerichtet": bank_eingerichtet(n),
                               "zuletzt": a.get("zuletzt"), "ok": a.get("ok"), "meldung": a.get("meldung")})
            heute = datetime.now()
            monat = heute.strftime("%Y-%m")
            naechster = (heute.replace(day=1) + timedelta(days=32)).replace(day=1).strftime("%Y-%m")
            return self._senden(200, {"konten": DB.konten(), "banken": banken,
                                      "monat": DB.auswertung(monat + "-01", naechster + "-01"),
                                      "neueste": DB.umsaetze(limit=8)})
        if pfad == "/api/umsaetze":
            return self._senden(200, {"umsaetze": DB.umsaetze(q.get("von"), q.get("bis"), q.get("bank"), q.get("konto"),
                                                              q.get("kategorie"), q.get("suche"),
                                                              min(int(q.get("limit") or 500), 5000)),
                                      "kategorien": DB.kategorien()})
        if pfad == "/api/auswertung":
            jahr = int(q.get("jahr") or datetime.now().year)
            return self._senden(200, {"jahr": jahr, "zeilen": DB.auswertung(f"{jahr}-01-01", f"{jahr + 1}-01-01")})
        if pfad == "/api/regeln":
            return self._senden(200, {"regeln": DB.regeln(), "kategorien": DB.kategorien()})
        if pfad == "/api/einstellungen":
            return self._senden(200, einstellungen())
        if pfad == "/api/export.csv":
            zeilen = DB.umsaetze(q.get("von"), q.get("bis"), q.get("bank"), q.get("konto"), q.get("kategorie"),
                                 q.get("suche"), 100000)
            out = ["Datum;Bank;Konto;Gegenpartei;Verwendungszweck;Art;Kategorie;Betrag;Währung;Notiz"]
            for z in zeilen:
                felder = [z["datum"], BANK_NAMEN.get(z["bank"], z["bank"]), z["konto_name"], z["gegenpartei"],
                          z["text"], z["art"], z["kategorie"], f"{z['betrag']:.2f}".replace(".", ","),
                          z["waehrung"], z["notiz"]]
                out.append(";".join('"' + str(f or "").replace('"', '""') + '"' for f in felder))
            return self._senden(200, "﻿" + "\r\n".join(out), "text/csv; charset=utf-8",
                                {"Content-Disposition": 'attachment; filename="umsaetze.csv"'})
        return self._fehler(404, "Nicht gefunden")

    # ------------------------------------------------------------ POST
    def do_POST(self):
        u = urlparse(self.path)
        # Schutz gegen fremde Seiten, die Formulare hierher schicken (zusätzlich zu SameSite=Strict)
        if self.headers.get("X-V3D") != "1":
            return self._fehler(403, "Fehlender Kopf")
        try:
            d = self._json()
        except (ValueError, json.JSONDecodeError):
            return self._fehler(400, "Ungültige Anfrage")
        try:
            if u.path == "/api/einrichten":
                if TRESOR.angelegt():
                    return self._fehler(409, "Schon eingerichtet")
                TRESOR.anlegen(str(d.get("passwort") or ""))
                return self._sitzung_starten()
            if u.path == "/api/anmelden":
                if self._bremse():
                    return self._fehler(429, "Zu viele Fehlversuche — bitte 10 Minuten warten")
                pw = str(d.get("passwort") or "")
                ok = TRESOR.pruefen(pw) if TRESOR.offen() else TRESOR.aufschliessen(pw)
                if not ok:
                    FEHLVERSUCHE.append(time.time())
                    time.sleep(1)
                    return self._fehler(403, "Falsches Passwort")
                FEHLVERSUCHE.clear()
                return self._sitzung_starten()
            if u.path == "/api/abmelden":
                SITZUNGEN.pop(self._token(), None)
                return self._senden(200, {"ok": True}, kopf={"Set-Cookie": "v3dbank=; Max-Age=0; Path=/"})
            if not self._angemeldet():
                return self._fehler(401, "Bitte anmelden")
            return self._api_post(u.path, d)
        except (ValueError, BankFehler) as e:
            return self._fehler(400, str(e))
        except PermissionError as e:
            return self._fehler(401, str(e))
        except Exception as e:
            traceback.print_exc()
            return self._fehler(500, f"Interner Fehler ({e.__class__.__name__})")

    def _api_post(self, pfad, d):
        if pfad == "/api/sperren":
            SITZUNGEN.clear()
            TRESOR.zuschliessen()
            return self._senden(200, {"ok": True}, kopf={"Set-Cookie": "v3dbank=; Max-Age=0; Path=/"})
        if pfad == "/api/passwort":
            if not TRESOR.pruefen(str(d.get("alt") or "")):
                return self._fehler(403, "Bisheriges Passwort stimmt nicht")
            TRESOR.passwort_aendern(str(d.get("neu") or ""))
            return self._senden(200, {"ok": True})
        if pfad == "/api/abrufen":
            return self._senden(200, {"ergebnis": abrufen(d.get("bank"))})
        if pfad == "/api/umsatz":
            DB.umsatz_setzen(int(d["id"]), d.get("kategorie"), d.get("notiz"))
            return self._senden(200, {"ok": True})
        if pfad == "/api/regel":
            DB.regel_neu(str(d.get("muster") or ""), str(d.get("kategorie") or ""))
            return self._senden(200, {"ok": True})
        if pfad == "/api/regel/loeschen":
            DB.regel_loeschen(int(d["id"]))
            DB.regeln_anwenden()
            return self._senden(200, {"ok": True})
        if pfad == "/api/konto/ausblenden":
            DB.konto_ausblenden(str(d["id"]), bool(d.get("aktiv")))
            return self._senden(200, {"ok": True})
        if pfad == "/api/import":
            name = str(d.get("konto") or "").strip()
            if not name:
                raise ValueError("Kontonamen angeben")
            key = "csv-" + "".join(c for c in name.lower() if c.isalnum())[:40]
            umsaetze, info = csvimport.einlesen(str(d.get("text") or ""), key)
            if not umsaetze:
                raise ValueError("Keine Umsätze erkannt")
            kid = DB.konto_speichern("csv", {"ext_id": key, "name": name, "waehrung": umsaetze[0]["waehrung"],
                                             "saldo": d.get("saldo")})
            neu = DB.umsaetze_speichern("csv", kid, umsaetze)
            return self._senden(200, {"ok": True, "gelesen": len(umsaetze), "neu": neu, **info})
        if pfad.startswith("/api/bank/"):
            return self._bank_post(pfad[len("/api/bank/"):], d)
        return self._fehler(404, "Nicht gefunden")

    def _bank_post(self, pfad, d):
        if pfad == "bunq":
            key = str(d.get("api_key") or "").strip()
            if not key:
                raise ValueError("API-Schlüssel fehlt")
            TRESOR.loeschen("bunq")  # neuer Schlüssel = neue Installation
            TRESOR.set("bunq", {"api_key": key, "sandbox": bool(d.get("sandbox"))})
            BANKEN["bunq"].konten()   # sofort prüfen
            return self._senden(200, {"ok": True, "abruf": abrufen("bunq")})
        if pfad == "bunq/sandbox":
            TRESOR.loeschen("bunq")
            TRESOR.set("bunq", {"api_key": Bunq.sandbox_nutzer_anlegen(), "sandbox": True})
            return self._senden(200, {"ok": True, "abruf": abrufen("bunq")})
        if pfad == "revolut/zertifikat":
            return self._senden(200, {"zertifikat": BANKEN["revolut"].zertifikat_erzeugen(bool(d.get("neu")))})
        if pfad == "revolut":
            BANKEN["revolut"].konfigurieren(str(d.get("client_id") or "").strip(),
                                            str(d.get("redirect_uri") or "").strip(), bool(d.get("sandbox")))
            return self._senden(200, {"ok": True, "link": BANKEN["revolut"].freigabe_link()})
        if pfad == "revolut/code":
            BANKEN["revolut"].code_einloesen(str(d.get("code") or ""))
            return self._senden(200, {"ok": True, "abruf": abrufen("revolut")})
        if pfad == "sumup":
            key = str(d.get("api_key") or "").strip()
            if not key:
                raise ValueError("API-Schlüssel fehlt")
            TRESOR.loeschen("sumup")
            TRESOR.set("sumup", {"api_key": key})
            BANKEN["sumup"].konten()
            return self._senden(200, {"ok": True, "abruf": abrufen("sumup")})
        if pfad == "entfernen":
            bank = str(d.get("bank") or "")
            if bank not in BANKEN:
                raise ValueError("Unbekannte Bank")
            TRESOR.loeschen(bank)
            return self._senden(200, {"ok": True})
        return self._fehler(404, "Nicht gefunden")


def einstellungen():
    """Was in der App angezeigt wird — nie die Geheimnisse selbst."""
    b = TRESOR.get("bunq")
    r = TRESOR.get("revolut")
    s = TRESOR.get("sumup")
    return {
        "bunq": {"eingerichtet": bool(b.get("api_key")), "sandbox": bool(b.get("sandbox")),
                 "schluessel_ende": (b.get("api_key") or "")[-4:]},
        "revolut": {"eingerichtet": bool(r.get("refresh_token")), "client_id": r.get("client_id"),
                    "redirect_uri": r.get("redirect_uri"), "sandbox": bool(r.get("sandbox")),
                    "zertifikat": r.get("zertifikat"),
                    "link": BANKEN["revolut"].freigabe_link() if r.get("client_id") and r.get("redirect_uri") else None},
        "sumup": {"eingerichtet": bool(s.get("api_key")), "schluessel_ende": (s.get("api_key") or "")[-4:],
                  "haendler": s.get("merchant_code")},
    }


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(CFG["port"])
    threading.Thread(target=hintergrund, daemon=True).start()
    while True:  # Tailnet-Adresse gibt es erst, wenn tailscaled läuft
        try:
            srv = ThreadingHTTPServer((CFG["host"], port), Handler)
            break
        except OSError as e:
            print(f"[start] {CFG['host']}:{port} noch nicht verfügbar ({e}), neuer Versuch in 5 s", flush=True)
            time.sleep(5)
    print(f"[start] V3D Bank auf http://{CFG['host']}:{port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
