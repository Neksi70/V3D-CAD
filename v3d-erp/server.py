#!/usr/bin/env python3
"""V3D ERP – Webserver (Prototyp).

Start:  python3 server.py [PORT]        (Standard 8820, nur 127.0.0.1)
Daten:  ~/.local/share/v3d-erp/erp.db   (SQLite; beim ersten Start mit Testdaten befüllt)
Login:  demo / demo  (nur Testdaten!)

Nur Python-Standardbibliothek.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import threading
import time
import traceback
import urllib.parse
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import bericht
import erp
import seed

HIER = os.path.dirname(os.path.abspath(__file__))
DATEN = os.environ.get("V3D_ERP_DATEN", os.path.expanduser("~/.local/share/v3d-erp"))
os.makedirs(DATEN, exist_ok=True)
DB_PFAD = os.path.join(DATEN, "erp.db")
GEHEIM_PFAD = os.path.join(DATEN, "geheim.txt")
if not os.path.exists(GEHEIM_PFAD):
    with open(GEHEIM_PFAD, "w") as f:
        f.write(secrets.token_hex(32))
    os.chmod(GEHEIM_PFAD, 0o600)
GEHEIM = open(GEHEIM_PFAD).read().strip().encode()
SITZUNG_STD = 12

DB = erp.verbinden(DB_PFAD)
erp.schema_anlegen(DB)
seed.befuellen(DB)
SPERRE = threading.Lock()   # SQLite: eine Schreibverbindung, Anfragen nacheinander


def token_machen(login):
    bis = int(time.time()) + SITZUNG_STD * 3600
    sig = hmac.new(GEHEIM, f"{login}|{bis}".encode(), hashlib.sha256).hexdigest()
    return f"{login}|{bis}|{sig}"


def token_pruefen(tok):
    try:
        login, bis, sig = tok.split("|")
        ok = hmac.compare_digest(sig, hmac.new(GEHEIM, f"{login}|{bis}".encode(), hashlib.sha256).hexdigest())
        return login if ok and int(bis) > time.time() else None
    except Exception:
        return None


ROUTEN = []
# Was die Rolle „werkstatt“ (Tablet in der Produktion) darf – sonst nichts
WERKSTATT_ERLAUBT = re.compile(r"^(GET /api/(ich|grundlagen|einstellungen|werkstatt)|POST /api/meilensteine/\d+/(erledigt|hinweis))$")


def route(methode, muster):
    def deko(fn):
        ROUTEN.append((methode, re.compile("^" + muster + "$"), fn))
        return fn
    return deko


class H(BaseHTTPRequestHandler):
    server_version = "V3D-ERP/0.1"

    def log_message(self, fmt, *args):
        pass

    # ---- Antworten
    def _senden(self, code, daten, typ="application/json; charset=utf-8", kopf=None):
        roh = daten if isinstance(daten, bytes) else json.dumps(daten, ensure_ascii=False, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(roh)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        for k, v in (kopf or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(roh)

    def _benutzer(self):
        c = SimpleCookie(self.headers.get("Cookie", ""))
        return token_pruefen(c["erp"].value) if "erp" in c else None

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 5_000_000:
            raise erp.Fehler("Anfrage zu groß.")
        return json.loads(self.rfile.read(n) or b"{}")

    # ---- Verteiler
    def do_GET(self):
        self._verteilen("GET")

    def do_POST(self):
        self._verteilen("POST")

    def do_DELETE(self):
        self._verteilen("DELETE")

    def _verteilen(self, methode):
        url = urllib.parse.urlparse(self.path)
        pfad = re.sub(r"^/erp", "", url.path) or "/"   # erlaubt Betrieb unter /erp hinter einem Proxy
        q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        if methode == "GET" and pfad in ("/", "/index.html"):
            with open(os.path.join(HIER, "app.html"), "rb") as f:
                return self._senden(200, f.read(), "text/html; charset=utf-8")
        if pfad == "/api/login" and methode == "POST":
            return self._login()
        if pfad == "/api/logout":
            return self._senden(200, {"ok": True}, kopf={"Set-Cookie": "erp=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"})
        benutzer = self._benutzer()
        if pfad.startswith("/api/") and not benutzer:
            return self._senden(401, {"fehler": "Bitte anmelden."})
        if methode in ("POST", "DELETE") and self.headers.get("X-ERP") != "1":     # einfacher CSRF-Schutz
            return self._senden(403, {"fehler": "Ungültige Anfrage."})
        if benutzer and pfad.startswith("/api/"):
            with SPERRE:
                r = DB.execute("SELECT rolle FROM benutzer WHERE login=?", (benutzer,)).fetchone()
            if not r:
                return self._senden(401, {"fehler": "Bitte anmelden."})
            if r["rolle"] == "werkstatt" and not WERKSTATT_ERLAUBT.match(f"{methode} {pfad}"):
                return self._senden(403, {"fehler": "Für das Werkstatt-Tablet nicht freigegeben."})
        for m, rx, fn in ROUTEN:
            t = rx.match(pfad)
            if m == methode and t:
                try:
                    body = self._body() if methode == "POST" else {}
                    with SPERRE:
                        erg = fn(benutzer=benutzer, q=q, body=body, **{k: int(v) if v.isdigit() else v for k, v in t.groupdict().items()})
                    if isinstance(erg, dict) and "__datei" in erg:
                        return self._senden(200, erg["__datei"], erg["typ"], {"Content-Disposition": f'inline; filename="{erg["name"]}"'})
                    return self._senden(200, erg)
                except erp.Fehler as e:
                    return self._senden(400, {"fehler": str(e)})
                except Exception as e:
                    traceback.print_exc()
                    return self._senden(500, {"fehler": f"Interner Fehler: {e}"})
        return self._senden(404, {"fehler": "Nicht gefunden."})

    def _login(self):
        try:
            d = self._body()
        except Exception:
            return self._senden(400, {"fehler": "Ungültige Anfrage."})
        with SPERRE:
            u = DB.execute("SELECT * FROM benutzer WHERE login=?", (d.get("login", ""),)).fetchone()
        if not u or not erp.pw_pruefen(d.get("passwort", ""), u["pw_hash"]):
            time.sleep(0.8)
            return self._senden(403, {"fehler": "Benutzer oder Kennwort falsch."})
        return self._senden(200, {"ok": True, "name": u["name"]},
                            kopf={"Set-Cookie": f"erp={token_machen(u['login'])}; Path=/; Max-Age={SITZUNG_STD*3600}; HttpOnly; SameSite=Strict"})


# ---------------------------------------------------------------- Routen
@route("GET", "/api/ich")
def r_ich(benutzer, **_):
    u = DB.execute("SELECT login,name,rolle FROM benutzer WHERE login=?", (benutzer,)).fetchone()
    return dict(u) if u else {}


@route("GET", "/api/grundlagen")
def r_grundlagen(**_):
    return dict(belegarten=erp.zeilen(DB.execute("SELECT * FROM belegart ORDER BY reihenfolge")),
                folgen=erp.zeilen(DB.execute("SELECT * FROM belegart_folge")),
                zahlungsbedingungen=erp.zeilen(DB.execute("SELECT * FROM zahlungsbedingung")),
                lager=erp.zeilen(DB.execute("SELECT * FROM lager")),
                gruende=["Lieferant liefert später", "Freigabe Kunde verzögert", "Änderungswunsch Kunde", "Kapazität Fertigung",
                         "Nacharbeit / Qualität", "Krankheit / Urlaub", "Sonstiges"])


@route("GET", "/api/suche")
def r_suche(q, **_):
    return erp.suche(DB, q.get("q", ""))


@route("DELETE", "/api/adressen/(?P<aid>\\d+)")
def r_adresse_loeschen(aid, benutzer, **_):
    erp.adresse_loeschen(DB, aid, benutzer)
    return {"ok": True}


@route("DELETE", "/api/artikel/(?P<aid>\\d+)")
def r_artikel_loeschen(aid, benutzer, **_):
    erp.artikel_loeschen(DB, aid, benutzer)
    return {"ok": True}


@route("POST", "/api/belege/(?P<bid>\\d+)/memo")
def r_beleg_memo(bid, body, benutzer, **_):
    return erp.beleg_memo(DB, bid, body.get("memo"), benutzer)


@route("GET", "/api/werkstatt")
def r_werkstatt(q, **_):
    return erp.werkstatt_liste(DB, q.get("bereich", ""))


@route("POST", "/api/meilensteine/(?P<mid>\\d+)/hinweis")
def r_hinweis(mid, body, benutzer, **_):
    return erp.meilenstein_hinweis(DB, mid, body.get("text"), benutzer)


@route("GET", "/api/projekte/(?P<pid>\\d+)/bericht.pdf")
def r_bericht(pid, **_):
    pdf, name = bericht.terminbericht(DB, pid)
    return {"__datei": pdf, "typ": "application/pdf", "name": name}


@route("GET", "/api/einstellungen")
def r_einst(**_):
    return erp.einstellungen(DB)


@route("POST", "/api/einstellungen")
def r_einst_speichern(body, benutzer, **_):
    u = DB.execute("SELECT rolle FROM benutzer WHERE login=?", (benutzer,)).fetchone()
    if not u or u["rolle"] != "admin":
        raise erp.Fehler("Nur Administratoren dürfen die Firmendaten ändern.")
    return erp.einstellungen_speichern(DB, body, benutzer)


@route("GET", "/api/uebersicht")
def r_uebersicht(**_):
    return erp.uebersicht(DB)


@route("GET", "/api/adressen")
def r_adressen(q, **_):
    return erp.adressen_liste(DB, q.get("suche", ""), q.get("rolle", ""))


@route("GET", "/api/adressen/(?P<aid>\\d+)")
def r_adresse(aid, **_):
    return erp.adresse_lesen(DB, aid)


@route("POST", "/api/adressen")
def r_adresse_speichern(body, benutzer, **_):
    return erp.adresse_speichern(DB, body, benutzer)


@route("GET", "/api/artikel")
def r_artikel(q, **_):
    return erp.artikel_liste(DB, q.get("suche", ""))


@route("GET", "/api/artikel/(?P<aid>\\d+)")
def r_artikel1(aid, **_):
    return erp.artikel_lesen(DB, aid)


@route("POST", "/api/artikel")
def r_artikel_speichern(body, benutzer, **_):
    return erp.artikel_speichern(DB, body, benutzer)


@route("GET", "/api/belege")
def r_belege(q, **_):
    return erp.belege_liste(DB, q.get("bereich", "VK"), q.get("suche", ""), q.get("belegart", ""), q.get("status", ""))


@route("GET", "/api/belege/(?P<bid>\\d+)")
def r_beleg(bid, **_):
    return erp.beleg_lesen(DB, bid)


@route("POST", "/api/belege")
def r_beleg_speichern(body, benutzer, **_):
    return erp.beleg_speichern(DB, body, benutzer)


@route("POST", "/api/belege/(?P<bid>\\d+)/verarbeiten")
def r_verarbeiten(bid, benutzer, **_):
    return erp.beleg_verarbeiten(DB, bid, benutzer)


@route("POST", "/api/belege/(?P<bid>\\d+)/weiter")
def r_weiter(bid, body, benutzer, **_):
    return erp.beleg_weiterverarbeiten(DB, bid, body.get("ziel", ""), benutzer)


@route("DELETE", "/api/belege/(?P<bid>\\d+)")
def r_beleg_loeschen(bid, benutzer, **_):
    erp.beleg_loeschen(DB, bid, benutzer)
    return {"ok": True}


@route("GET", "/api/op")
def r_op(q, **_):
    return erp.op_liste(DB, q.get("art", "debitor"))


@route("POST", "/api/op/(?P<oid>\\d+)/zahlung")
def r_zahlung(oid, body, benutzer, **_):
    return erp.zahlung_buchen(DB, oid, body.get("betrag", 0), benutzer)


@route("GET", "/api/projekte")
def r_projekte(**_):
    return erp.projekte_liste(DB)


@route("GET", "/api/projekte/(?P<pid>\\d+)")
def r_projekt(pid, **_):
    return erp.projekt_lesen(DB, pid)


@route("POST", "/api/projekte")
def r_projekt_speichern(body, benutzer, **_):
    return erp.projekt_speichern(DB, body, benutzer)


@route("POST", "/api/projekte/(?P<pid>\\d+)/fixieren")
def r_fixieren(pid, benutzer, **_):
    return erp.plan_fixieren(DB, pid, benutzer)


@route("POST", "/api/meilensteine/(?P<mid>\\d+)/erledigt")
def r_ms_erledigt(mid, body, benutzer, **_):
    p = erp.meilenstein_erledigt(DB, mid, body.get("datum"), benutzer, bool(body.get("zuruecknehmen")))
    rolle = DB.execute("SELECT rolle FROM benutzer WHERE login=?", (benutzer,)).fetchone()["rolle"]
    return {"ok": True} if rolle == "werkstatt" else p      # Werkstatt sieht keine Beträge/Belege


@route("POST", "/api/meilensteine/(?P<mid>\\d+)/verschieben")
def r_ms_verschieben(mid, body, benutzer, **_):
    return erp.meilenstein_verschieben(DB, mid, body.get("neu_ende"), body.get("grund"), body.get("folge", True),
                                       body.get("bemerkung", ""), benutzer)


@route("POST", "/api/projekte/(?P<pid>\\d+)/meilenstein")
def r_ms_neu(pid, body, benutzer, **_):
    with erp.transaktion(DB):
        pos = DB.execute("SELECT COALESCE(MAX(pos),0)+1 p FROM meilenstein WHERE projekt_id=?", (pid,)).fetchone()["p"]
        ende = body.get("plan_ende") or erp.heute()
        if not (body.get("titel") or "").strip():
            raise erp.Fehler("Titel fehlt.")
        DB.execute("""INSERT INTO meilenstein(projekt_id,pos,titel,verantwortlich,ist_meilenstein,plan_start,plan_ende,zugesagt,ausloeser)
                      VALUES(?,?,?,?,?,?,?,?,?)""",
                   (pid, pos, body["titel"], body.get("verantwortlich"), 1 if body.get("ist_meilenstein") else 0,
                    body.get("plan_start") or ende, ende, ende, body.get("ausloeser") or None))
        DB.execute("INSERT INTO projekt_verlauf(projekt_id,zeit,benutzer,text) VALUES(?,?,?,?)",
                   (pid, erp.jetzt(), benutzer, f"Schritt „{body['titel']}“ hinzugefügt"))
    return erp.projekt_lesen(DB, pid)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8820
    host = os.environ.get("V3D_ERP_HOST", "127.0.0.1")
    srv = ThreadingHTTPServer((host, port), H)
    print(f"V3D ERP läuft auf http://{host}:{port}  (Daten: {DB_PFAD})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
