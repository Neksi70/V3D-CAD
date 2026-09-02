"""V3D Anrufannahme — Dienst auf Port 8786.

Nimmt Meldungen von Asterisk entgegen, stösst die Verarbeitung an und
liefert die Weboberflaeche aus. Hinter dem Funnel unter /anrufe.
"""
import json, os, re, shutil, sys, time
from flask import Flask, Response, jsonify, request, send_file

import core, pipeline, tts

core.init_db()
app = Flask(__name__, static_folder=None)
WEB = os.path.join(core.BASE, "web")
SPOOL = "/var/spool/v3dcall"
COOKIE = "v3dcall"


# ------------------------------------------------------------------- Zugang

def erlaubt():
    key = core.cfg("adminKey", default="")
    if not key:
        return True
    mit = request.cookies.get(COOKIE) or request.headers.get("X-V3D-Key") \
        or request.args.get("key", "")
    return mit == key


def wache():
    if not erlaubt():
        return jsonify(fehler="nicht angemeldet"), 401
    return None


def lokal():
    """Nur der eigene Rechner darf Anrufe melden.

    Achtung: hinter dem Tailscale-Funnel kommt JEDER Zugriff aus dem
    Internet mit remote_addr 127.0.0.1 an. Die IP allein taugt darum
    nicht als Schranke — es zaehlt der geteilte Token, den nur der
    Notify-Hook auf dieser Maschine kennt. Weitergeleitete Anfragen
    lehnen wir zusaetzlich rundheraus ab.
    """
    if any(h in request.headers for h in
           ("X-Forwarded-For", "X-Forwarded-Proto", "Tailscale-User-Login")):
        return False
    if request.remote_addr not in ("127.0.0.1", "::1", "localhost"):
        return False
    erwartet = core.cfg("notifyToken", default="")
    mit = request.headers.get("X-V3D-Notify") or request.values.get("token", "")
    return bool(erwartet) and mit == erwartet


def spool_pfad(pfad):
    """Nur Dateien direkt im Asterisk-Spool zulassen.

    Ohne diese Pruefung koennte ein gefaelschter Aufruf einen beliebigen
    Pfad angeben — der Server wuerde die Datei wegschieben.
    """
    if not pfad:
        return ""
    echt = os.path.realpath(pfad)
    if os.path.dirname(echt) != os.path.realpath(SPOOL):
        return ""
    return echt


# --------------------------------------------------------------- Oberflaeche

@app.get("/")
def start():
    return send_file(os.path.join(WEB, "ui.html"))


@app.get("/sw.js")
def serviceworker():
    return send_file(os.path.join(WEB, "sw.js"), mimetype="application/javascript")


@app.get("/manifest.json")
def manifest():
    return send_file(os.path.join(WEB, "manifest.json"), mimetype="application/json")


@app.get("/icon.svg")
def icon():
    return send_file(os.path.join(WEB, "icon.svg"), mimetype="image/svg+xml")


@app.post("/api/login")
def login():
    daten = request.get_json(silent=True) or {}
    if daten.get("key", "") != core.cfg("adminKey", default=""):
        time.sleep(1.0)
        return jsonify(fehler="Schlüssel stimmt nicht"), 403
    antwort = jsonify(ok=True)
    antwort.set_cookie(COOKIE, daten["key"], max_age=365 * 24 * 3600,
                       samesite="Lax", httponly=True, secure=True)
    return antwort


# ------------------------------------------------------- Anruf von Asterisk

@app.post("/api/incoming")
def eingehend():
    if not lokal():
        return jsonify(fehler="nur lokal"), 403
    d = request.get_json(silent=True) or request.form.to_dict() or {}
    cid = re.sub(r"[^A-Za-z0-9._-]", "", (d.get("id") or "").strip())[:64]
    if not cid:
        return jsonify(fehler="id fehlt"), 400

    nummer = (d.get("caller") or "").strip()
    if nummer and nummer in (core.cfg("blocklist", default=[]) or []):
        return jsonify(ok=True, uebersprungen="gesperrte Nummer")

    # Aufnahme aus dem Asterisk-Spool in die eigene Ablage holen
    quelle = spool_pfad((d.get("file") or os.path.join(SPOOL, f"{cid}.wav")).strip())
    ziel = ""
    if quelle and os.path.exists(quelle) and os.path.getsize(quelle) > 1024:
        ziel = os.path.join(core.REC, f"{cid}.wav")
        try:
            shutil.move(quelle, ziel)
        except Exception:
            # Rueckfall ueber Dateisystemgrenzen hinweg — danach den
            # Spool aufraeumen, sonst laeuft er mit der Zeit voll.
            shutil.copy2(quelle, ziel)
            try:
                os.remove(quelle)
            except OSError:
                pass
        os.chmod(ziel, 0o640)

    core.add_call(cid, nummer, (d.get("name") or "").strip(), ziel)
    pipeline.verarbeite_async(cid)
    return jsonify(ok=True, id=cid, audio=bool(ziel))


# --------------------------------------------------------------- Nachrichten

@app.get("/api/calls")
def anrufe():
    if (w := wache()):
        return w
    liste = core.list_calls(int(request.args.get("limit", 200)))
    for a in liste:
        a["hatAudio"] = bool(a.get("audio") and os.path.exists(a["audio"]))
        a.pop("audio", None)
        a.pop("fehler", None)
    return jsonify(calls=liste, ungelesen=sum(1 for a in liste if not a["gelesen"]))


@app.get("/api/calls/<cid>/audio")
def audio(cid):
    if (w := wache()):
        return w
    a = core.get_call(cid)
    if not a or not a.get("audio") or not os.path.exists(a["audio"]):
        return jsonify(fehler="keine Aufnahme"), 404
    return send_file(a["audio"], mimetype="audio/wav", conditional=True)


@app.post("/api/calls/<cid>/gelesen")
def gelesen(cid):
    if (w := wache()):
        return w
    core.update_call(cid, gelesen=1 if request.get_json(silent=True, force=True) is None
                     or (request.get_json(silent=True) or {}).get("wert", 1) else 0)
    return jsonify(ok=True)


@app.post("/api/calls/<cid>/neu-verarbeiten")
def neu(cid):
    if (w := wache()):
        return w
    pipeline.verarbeite_async(cid)
    return jsonify(ok=True)


@app.delete("/api/calls/<cid>")
def loesche(cid):
    if (w := wache()):
        return w
    a = core.get_call(cid)
    if a and a.get("audio"):
        for p in (a["audio"], os.path.splitext(a["audio"])[0] + ".mp3"):
            if os.path.exists(p):
                os.remove(p)
    with core.db() as con:
        con.execute("DELETE FROM calls WHERE id=?", (cid,))
    return jsonify(ok=True)


# ------------------------------------------------------------------ Push

@app.get("/api/push/key")
def push_key():
    if (w := wache()):
        return w
    return jsonify(key=core.cfg("push", "vapidPublic", default=""))


@app.post("/api/push/anmelden")
def push_an():
    if (w := wache()):
        return w
    sub = request.get_json(silent=True) or {}
    if not sub.get("endpoint"):
        return jsonify(fehler="endpoint fehlt"), 400
    with core.db() as con:
        con.execute("INSERT OR REPLACE INTO subs (endpoint,sub,ts) VALUES (?,?,?)",
                    (sub["endpoint"], json.dumps(sub), int(time.time())))
    return jsonify(ok=True)


@app.post("/api/push/test")
def push_test():
    if (w := wache()):
        return w
    n = pipeline.sende_push({"id": "test", "caller": "030 12345678",
                             "text": "Das ist eine Testnachricht."})
    return jsonify(ok=True, zugestellt=n)


# -------------------------------------------------------------- Einstellungen

GEHEIM = {"apiKey", "pass", "adminKey", "vapidPrivate", "sipPass"}


def _maskiere(node):
    if isinstance(node, dict):
        return {k: ("••••••" if k in GEHEIM and node[k] else _maskiere(v))
                for k, v in node.items()}
    return node


@app.get("/api/einstellungen")
def hole_cfg():
    if (w := wache()):
        return w
    return jsonify(_maskiere(core.full_cfg()))


@app.post("/api/einstellungen")
def setze_cfg():
    if (w := wache()):
        return w
    neu_daten = request.get_json(silent=True) or {}
    alt = core.full_cfg()

    def misch(ziel, quelle):
        for k, v in quelle.items():
            if isinstance(v, dict) and isinstance(ziel.get(k), dict):
                misch(ziel[k], v)
            elif v == "••••••":
                continue          # Platzhalter -> alten Wert behalten
            else:
                ziel[k] = v

    misch(alt, neu_daten)
    core.save_cfg(alt)
    return jsonify(ok=True)


@app.get("/api/stimmen")
def stimmen():
    if (w := wache()):
        return w
    try:
        return jsonify(stimmen=tts.stimmen())
    except Exception as e:
        return jsonify(fehler=str(e)), 400


@app.post("/api/ansage-bauen")
def ansage_bauen():
    if (w := wache()):
        return w
    try:
        ergebnis = tts.baue_alle()
        return jsonify(ok=True, dateien={k: os.path.basename(v["wav"])
                                         for k, v in ergebnis.items()})
    except Exception as e:
        return jsonify(fehler=str(e)), 400


@app.get("/api/ansage-anhoeren")
def ansage_anhoeren():
    if (w := wache()):
        return w
    p = os.path.join(core.SOUNDS, f"{request.args.get('name', 'ansage')}.mp3")
    if not os.path.exists(p):
        return jsonify(fehler="noch nicht erzeugt"), 404
    return send_file(p, mimetype="audio/mpeg")


@app.get("/app.apk")
def apk():
    """Android-App zum Herunterladen — ohne Schluessel, damit man sie
    auf einem frischen Handy installieren kann. Die App selbst kommt
    ohne Zugangsschluessel an keine Daten."""
    pfad = os.path.join(core.BASE, "V3D-Anrufe-1.0.apk")
    if not os.path.exists(pfad):
        return jsonify(fehler="noch nicht gebaut"), 404
    return send_file(pfad, mimetype="application/vnd.android.package-archive",
                     as_attachment=True, download_name="V3D-Anrufe.apk")


@app.get("/api/health")
def health():
    with core.db() as con:
        n = con.execute("SELECT COUNT(*) c FROM calls").fetchone()["c"]
    return jsonify(ok=True, anrufe=n,
                   ansageBereit=os.path.exists(os.path.join(core.SOUNDS, "ansage.wav")))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else core.cfg("port", default=8786)
    app.run(host="127.0.0.1", port=port, threaded=True)
