#!/usr/bin/env python3
"""V3D ERP – Webserver (Prototyp).

Start:  python3 server.py [PORT]        (Standard 8820, nur 127.0.0.1)
Daten:  ~/.local/share/v3d-erp/erp.db   (SQLite; beim ersten Start mit Testdaten befüllt)
Login:  demo / demo  (nur Testdaten!)

Nur Python-Standardbibliothek.
"""
import datetime
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
import erechnung
import erp
import finanzen
import produktion
import seed
import zusatz

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

erp.DOK_ORDNER = os.path.join(DATEN, "dokumente")
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
FEHLVERSUCHE = {}      # Anmeldesperre: Schlüssel → (Anzahl, letzter Versuch)
# Was die Rolle „werkstatt“ (Tablet in der Produktion) darf – sonst nichts
WERKSTATT_ERLAUBT = re.compile(r"^(GET /api/(ich|grundlagen|einstellungen|werkstatt|produktion(/[a-z]+)?)|POST /api/meilensteine/\d+/(erledigt|hinweis)"
                               r"|POST /api/produktion/start|POST /api/fertigung/\d+/(pause|weiter|beenden|zurueck|freigeben)|DELETE /api/fertigung/\d+)$")


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
        if n > 36_000_000:
            raise erp.Fehler("Anfrage zu groß.")
        return json.loads(self.rfile.read(n) or b"{}")

    # ---- Verteiler
    def do_GET(self):
        self._verteilen("GET")

    def do_POST(self):
        self._verteilen("POST")

    def do_DELETE(self):
        self._verteilen("DELETE")

    def _cookie(self, wert, alter):
        """Cookie nur für den eigenen Pfad; über HTTPS (Funnel) zusätzlich Secure."""
        pfad = "/erp" if self.unter_erp else "/"
        sicher = "; Secure" if self.headers.get("X-Forwarded-Proto", "") == "https" or self.unter_erp else ""
        return f"erp={wert}; Path={pfad}; Max-Age={alter}; HttpOnly; SameSite=Strict{sicher}"

    def _verteilen(self, methode):
        url = urllib.parse.urlparse(self.path)
        self.unter_erp = url.path == "/erp" or url.path.startswith("/erp/")
        if url.path == "/erp":                         # ohne Schrägstrich würden relative api/-Aufrufe ins Leere gehen
            self.send_response(301)
            self.send_header("Location", "/erp/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        pfad = re.sub(r"^/erp", "", url.path) or "/"   # erlaubt Betrieb unter /erp hinter einem Proxy
        q = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        if methode == "GET" and pfad in ("/", "/index.html"):
            with open(os.path.join(HIER, "app.html"), "rb") as f:
                return self._senden(200, f.read(), "text/html; charset=utf-8")
        if pfad == "/api/login" and methode == "POST":
            return self._login()
        if pfad == "/api/logout":
            return self._senden(200, {"ok": True}, kopf={"Set-Cookie": self._cookie("", 0)})
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
                        kopf = {"Content-Disposition": f"{'attachment' if erg.get('anhang') else 'inline'}; filename*=UTF-8''{urllib.parse.quote(erg['name'])}"}
                        if erg.get("sandbox"):
                            kopf["Content-Security-Policy"] = "sandbox"
                        return self._senden(200, erg["__datei"], erg["typ"], kopf)
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
        login = str(d.get("login", ""))[:60]
        # Hinter dem Funnel ist die Absender-IP immer 127.0.0.1 → Sperre je Benutzername (+ X-Forwarded-For)
        quelle = (self.headers.get("X-Forwarded-For") or self.client_address[0]).split(",")[0].strip()
        jetzt_ = time.time()
        for k in (f"u:{login}", f"ip:{quelle}"):
            sp = FEHLVERSUCHE.get(k)
            if sp and sp[0] >= 10 and jetzt_ - sp[1] < 900:
                return self._senden(429, {"fehler": "Zu viele Fehlversuche – bitte 15 Minuten warten."})
        with SPERRE:
            u = DB.execute("SELECT * FROM benutzer WHERE login=?", (login,)).fetchone()
        if not u or not erp.pw_pruefen(d.get("passwort", ""), u["pw_hash"]):
            for k in (f"u:{login}", f"ip:{quelle}"):
                n, t0 = FEHLVERSUCHE.get(k, (0, jetzt_))
                FEHLVERSUCHE[k] = (n + 1 if jetzt_ - t0 < 900 else 1, jetzt_)
            time.sleep(0.8)
            return self._senden(403, {"fehler": "Benutzer oder Kennwort falsch."})
        FEHLVERSUCHE.pop(f"u:{login}", None)
        return self._senden(200, {"ok": True, "name": u["name"]}, kopf={"Set-Cookie": self._cookie(token_machen(u["login"]), SITZUNG_STD * 3600)})


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


@route("GET", "/api/chargen")
def r_chargen(q, **_):
    return erp.chargen_liste(DB, q.get("suche", ""), int(q["adresse"]) if q.get("adresse") else None,
                             int(q["artikel"]) if q.get("artikel") else None, q.get("offen") == "1")


@route("GET", "/api/chargen/(?P<cid>\\d+)")
def r_charge(cid, **_):
    return erp.charge_lesen(DB, cid)


@route("POST", "/api/chargen/(?P<cid>\\d+)/ausschuss")
def r_ausschuss(cid, body, benutzer, **_):
    return erp.charge_ausschuss(DB, cid, body.get("menge"), body.get("grund"), benutzer)


@route("POST", "/api/dokumente")
def r_dok_neu(body, benutzer, **_):
    import base64
    try:
        daten = base64.b64decode(body.get("daten") or "", validate=True)
    except Exception:
        raise erp.Fehler("Datei konnte nicht gelesen werden.")
    return erp.dokument_speichern(DB, body.get("objekt"), int(body.get("objekt_id") or 0), body.get("name"), daten, body.get("mime"), benutzer)


@route("GET", "/api/dokumente/(?P<did>\\d+)")
def r_dok(did, **_):
    d, daten = erp.dokument_datei(DB, did)
    sicher = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain"}   # nie SVG/HTML inline
    typ = d["mime"] if d["mime"] in sicher else "application/octet-stream"
    return {"__datei": daten, "typ": typ, "name": "".join(ch for ch in d["name"] if ch.isprintable() and ch not in '"\\;'), "sandbox": True}


# ---------------------------------------------------------------- Mahnwesen
@route("GET", "/api/mahnstufen")
def r_mahnstufen(**_):
    return finanzen.mahnstufen(DB)


@route("POST", "/api/mahnstufen")
def r_mahnstufen_sp(body, benutzer, **_):
    return finanzen.mahnstufen_speichern(DB, body.get("stufen") or [], benutzer)


@route("GET", "/api/mahnvorschlag")
def r_mahnvorschlag(q, **_):
    return finanzen.mahnvorschlag(DB, q.get("stichtag") or None)


@route("GET", "/api/mahnungen")
def r_mahnungen(**_):
    return finanzen.mahnungen_liste(DB)


@route("POST", "/api/mahnungen")
def r_mahnungen_neu(body, benutzer, **_):
    return finanzen.mahnungen_erstellen(DB, [int(x) for x in body.get("adressen") or []], body.get("stichtag") or None,
                                        int(body.get("frist_tage") or 10), benutzer)


@route("GET", "/api/mahnungen/(?P<mid>\\d+)/pdf")
def r_mahnung_pdf(mid, **_):
    pdf, name = bericht.mahnung_pdf(DB, mid)
    return {"__datei": pdf, "typ": "application/pdf", "name": name}


@route("POST", "/api/op/(?P<oid>\\d+)/mahnsperre")
def r_mahnsperre(oid, body, benutzer, **_):
    return finanzen.mahnsperre(DB, oid, bool(body.get("an")), benutzer)


# ---------------------------------------------------------------- Kontoauszug / Zahlungsabgleich
@route("POST", "/api/bank/import")
def r_bank_import(body, benutzer, **_):
    import base64
    try:
        daten = base64.b64decode(body.get("daten") or "", validate=True)
    except Exception:
        raise erp.Fehler("Datei konnte nicht gelesen werden.")
    return finanzen.kontoauszug_importieren(DB, body.get("name") or "kontoauszug", daten, benutzer)


@route("GET", "/api/bank/umsaetze")
def r_bank_umsaetze(q, **_):
    return finanzen.umsaetze(DB, q.get("status", "offen"))


@route("POST", "/api/bank/umsaetze/(?P<uid>\\d+)/zuordnen")
def r_bank_zuordnen(uid, body, benutzer, **_):
    return finanzen.zuordnen(DB, uid, int(body.get("op_id") or 0), body.get("skonto") or 0, benutzer)


@route("POST", "/api/bank/umsaetze/(?P<uid>\\d+)/ignorieren")
def r_bank_ignorieren(uid, body, benutzer, **_):
    return finanzen.ignorieren(DB, uid, bool(body.get("zurueck")), benutzer)


@route("POST", "/api/bank/alle-sicheren")
def r_bank_alle(benutzer, **_):
    return finanzen.alle_sicheren_zuordnen(DB, benutzer)


@route("GET", "/api/bank/beispiel.csv")
def r_bank_beispiel(**_):
    return {"__datei": finanzen.beispiel_kontoauszug(DB), "typ": "text/csv; charset=windows-1252", "name": "Beispiel-Kontoauszug.csv"}


# ---------------------------------------------------------------- Kundenpreise
@route("GET", "/api/kundenpreise")
def r_kp(q, **_):
    return zusatz.kundenpreise(DB, int(q["adresse"]) if q.get("adresse") else None, int(q["artikel"]) if q.get("artikel") else None)


@route("POST", "/api/kundenpreise")
def r_kp_sp(body, benutzer, **_):
    return zusatz.kundenpreis_speichern(DB, body, benutzer)


@route("DELETE", "/api/kundenpreise/(?P<kid>\\d+)")
def r_kp_lo(kid, benutzer, **_):
    zusatz.kundenpreis_loeschen(DB, kid, benutzer)
    return {"ok": True}


@route("GET", "/api/preis")
def r_preis(q, **_):
    return zusatz.preis_finden(DB, int(q.get("adresse") or 0), int(q.get("artikel") or 0), float(q.get("menge") or 1), q.get("datum") or None)


# ---------------------------------------------------------------- Kennzeichen
@route("GET", "/api/kennzeichen/(?P<objekt>adresse|artikel)")
def r_kz_defs(objekt, **_):
    return zusatz.kz_defs(DB, objekt)


@route("POST", "/api/kennzeichen/(?P<objekt>adresse|artikel)")
def r_kz_defs_sp(objekt, body, benutzer, **_):
    return zusatz.kz_defs_speichern(DB, objekt, body.get("felder") or [], benutzer)


@route("GET", "/api/kennzeichen/(?P<objekt>adresse|artikel)/(?P<oid>\\d+)")
def r_kz_werte(objekt, oid, **_):
    return zusatz.kz_werte(DB, objekt, oid)


@route("POST", "/api/kennzeichen/(?P<objekt>adresse|artikel)/(?P<oid>\\d+)")
def r_kz_werte_sp(objekt, oid, body, benutzer, **_):
    return zusatz.kz_werte_speichern(DB, objekt, oid, body.get("werte") or {}, benutzer)


@route("GET", "/api/kennzeichen/(?P<objekt>adresse|artikel)/filter")
def r_kz_filter(objekt, q, **_):
    return zusatz.kz_filter(DB, objekt, int(q.get("feld") or 0), q.get("wert", ""))



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

# ---------------------------------------------------------------- Mengenabgleich / Sammel-Lieferschein
@route("GET", "/api/belege/(?P<bid>\\d+)/abweichungen")
def r_abweichungen(bid, **_):
    return erp.mengen_abweichung(DB, bid)


@route("POST", "/api/belege/(?P<bid>\\d+)/ab_angleichen")
def r_ab_angleichen(bid, benutzer, **_):
    return erp.ab_angleichen(DB, bid, benutzer)


@route("GET", "/api/offene_positionen")
def r_offene_positionen(q, **_):
    return erp.offene_auftragspositionen(DB, int(q["adresse"]) if q.get("adresse") else None)


@route("POST", "/api/lieferschein/sammel")
def r_sammel_ls(body, benutzer, **_):
    return erp.sammel_lieferschein(DB, int(body.get("adresse_id") or 0), body.get("auswahl") or [], benutzer)


# ---------------------------------------------------------------- Produktion (Rückmeldung je Palette/Charge)
@route("GET", "/api/produktion")
def r_produktion(q, **_):
    von = (datetime.date.today() - datetime.timedelta(days=int(q.get("tage") or 1))).isoformat()
    return {"laufend": produktion.liste(DB, laufend=True), "erledigt": [f for f in produktion.liste(DB, von=von) if f["ende"]],
            **produktion.grundlagen(DB)}


@route("GET", "/api/produktion/chargen")
def r_produktion_chargen(q, **_):
    return produktion.charge_suchen(DB, q.get("suche"))


@route("GET", "/api/produktion/fortschritt")
def r_produktion_fortschritt(q, **_):
    if q.get("charge"):
        return produktion.fortschritt(DB, [int(q["charge"])])
    if q.get("projekt"):
        return produktion.fortschritt(DB, produktion.chargen_fuer_projekt(DB, int(q["projekt"])))
    return produktion.fortschritt(DB)


@route("GET", "/api/produktion/liste")
def r_produktion_liste(q, **_):
    return produktion.liste(DB, charge_id=int(q["charge"]) if q.get("charge") else None, projekt_id=int(q["projekt"]) if q.get("projekt") else None)


@route("POST", "/api/produktion/start")
def r_produktion_start(body, benutzer, **_):
    return produktion.starten(DB, body, benutzer)


@route("POST", "/api/fertigung/(?P<fid>\\d+)/pause")
def r_fertigung_pause(fid, benutzer, **_):
    return produktion.pause(DB, fid, True, benutzer)


@route("POST", "/api/fertigung/(?P<fid>\\d+)/weiter")
def r_fertigung_weiter(fid, benutzer, **_):
    return produktion.pause(DB, fid, False, benutzer)


@route("POST", "/api/fertigung/(?P<fid>\\d+)/beenden")
def r_fertigung_beenden(fid, body, benutzer, **_):
    return produktion.beenden(DB, fid, body, benutzer)


@route("POST", "/api/fertigung/(?P<fid>\\d+)/zurueck")
def r_fertigung_zurueck(fid, benutzer, **_):
    return produktion.zuruecknehmen(DB, fid, benutzer)


@route("POST", "/api/fertigung/(?P<fid>\\d+)/freigeben")
def r_fertigung_freigeben(fid, body, benutzer, **_):
    return produktion.freigeben(DB, fid, bool(body.get("an", True)), benutzer)


@route("DELETE", "/api/fertigung/(?P<fid>\\d+)")
def r_fertigung_loeschen(fid, benutzer, **_):
    return produktion.loeschen(DB, fid, benutzer)


# ---------------------------------------------------------------- Beleg-PDF / E-Rechnung
@route("GET", "/api/belege/(?P<bid>\\d+)/pdf")
def r_beleg_pdf(bid, **_):
    pdf, name = bericht.beleg_pdf(DB, bid)
    return {"__datei": pdf, "typ": "application/pdf", "name": name}


@route("GET", "/api/belege/(?P<bid>\\d+)/xrechnung")
def r_xrechnung(bid, **_):
    xml, name = erechnung.xrechnung(DB, bid)
    return {"__datei": xml.encode() if isinstance(xml, str) else xml, "typ": "application/xml; charset=utf-8", "name": name, "anhang": True}


@route("GET", "/api/belege/(?P<bid>\\d+)/zugferd")
def r_zugferd(bid, **_):
    pdf, name = erechnung.zugferd(DB, bid)
    return {"__datei": pdf, "typ": "application/pdf", "name": name, "anhang": True}


@route("POST", "/api/erechnung/einlesen")
def r_erechnung_einlesen(body, benutzer, **_):
    import base64
    try:
        daten = base64.b64decode(body.get("daten") or "", validate=True)
    except Exception:
        raise erp.Fehler("Datei konnte nicht gelesen werden.")
    if not daten:
        raise erp.Fehler("Leere Datei.")
    return erechnung.einlesen(DB, (body.get("name") or "")[:200], daten, benutzer)



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
