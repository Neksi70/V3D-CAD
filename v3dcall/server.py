"""V3D Anrufannahme — Dienst auf Port 8786.

Nimmt Meldungen von Asterisk entgegen, stösst die Verarbeitung an und
liefert die Weboberflaeche aus. Hinter dem Funnel unter /anrufe.
"""
import json, os, re, shutil, subprocess, sys, time
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


@app.after_request
def schluessel_merken(antwort):
    """Kommt ein gueltiger Schluessel als ?key= herein, gleich das
    Plaetzchen setzen. Sonst autorisiert die Adresse nur den einen
    Aufruf — alle Nachfragen der Seite laufen ohne Schluessel und
    laufen in "nicht angemeldet"."""
    key = core.cfg("adminKey", default="")
    if key and request.args.get("key") == key and request.cookies.get(COOKIE) != key:
        antwort.set_cookie(COOKIE, key, max_age=365 * 24 * 3600,
                           samesite="Lax", httponly=True, secure=True)
    return antwort


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
        try:
            os.chmod(ziel, 0o640)
        except PermissionError:
            # Nach dem Verschieben gehoert die Datei weiterhin asterisk;
            # Rechte darf nur der Eigentümer aendern. Lesbar ist sie ohnehin,
            # also ist das kein Grund, den ganzen Anruf fallenzulassen.
            pass

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


@app.get("/proben")
def proben():
    """Alle Stimmproben auf einer Seite zum Vergleichen.

    Nimmt den Schluessel auch als ?key= entgegen, damit die Seite auf
    einem Geraet funktioniert, auf dem man noch nicht angemeldet ist.
    """
    if (w := wache()):
        return w
    key = request.args.get("key", "")
    anhang = f"&key={key}" if key else ""
    dateien = sorted(f[:-4] for f in os.listdir(core.SOUNDS)
                     if f.startswith("probe-") and f.endswith(".mp3"))
    if not dateien:
        return "<p>Keine Proben vorhanden.</p>", 404

    bloecke = "".join(
        f'<section><h2>{n[6:].capitalize()}</h2>'
        f'<audio controls preload="none" '
        f'src="api/ansage-anhoeren?name={n}{anhang}"></audio></section>'
        for n in dateien)
    return Response(f"""<!doctype html><html lang="de"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stimmproben</title><style>
body{{margin:0;background:#141821;color:#e8ecf4;
  font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:20px}}
h1{{font-size:19px;margin:0 0 6px}}
p.hinweis{{color:#9aa4bb;font-size:14px;margin:0 0 22px}}
section{{background:#1d222e;border:1px solid #333b4d;border-radius:14px;
  padding:14px 16px;margin-bottom:14px}}
h2{{font-size:16px;margin:0 0 10px}}
audio{{width:100%;height:40px}}
a{{color:#4f8cff}}
</style></head><body>
<h1>Stimmproben</h1>
<p class="hinweis">Dieselbe Ansage, vier Stimmen. Achte auf die Aussprache von
„Anschluss“, „persönlich“, „zurückrufen“ und „Signalton“.</p>
{bloecke}
<p class="hinweis" style="margin-top:24px">
<a href="./">Zurück zur Anrufannahme</a></p>
</body></html>""", mimetype="text/html; charset=utf-8")


# ------------------------------------------------------------- Gespraech

@app.post("/api/dialog")
def dialog_runde():
    """Eine Gespraechsrunde. Wird vom AGI-Skript in Asterisk aufgerufen."""
    if not lokal():
        return jsonify(fehler="nur lokal"), 403
    import dialog
    d = request.get_json(silent=True) or request.form.to_dict() or {}
    cid = re.sub(r"[^A-Za-z0-9._-]", "", (d.get("id") or ""))[:64]
    aufnahme = spool_pfad((d.get("file") or "").strip())
    ziel = os.path.join(SPOOL, f"{cid}-antwort-{re.sub(r'[^0-9]', '', d.get('runde') or '0')}")
    if not cid or not aufnahme:
        return jsonify(fehler="id oder Aufnahme fehlt"), 400
    try:
        r = dialog.runde(cid, aufnahme, ziel)
    except Exception as e:
        # Am Telefon darf ein Fehler nicht in Stille enden — der Anrufer
        # bekommt einen Hinweis und landet im normalen Anrufbeantworter.
        app.logger.exception("Gesprächsrunde fehlgeschlagen")
        return jsonify(fehler=str(e)[:200], ende=True), 200
    # NICHT splitext benutzen: die Asterisk-Anruf-ID enthaelt einen Punkt
    # ("1788382797.0"), splitext wuerde mitten in der ID abschneiden. ziel
    # traegt ohnehin keine Endung — sprich() haengt ".wav" selbst an.
    r["antwortDatei"] = ziel if not r.get("leer") else ""
    return jsonify(**r)


@app.post("/api/dialog/begruessung")
def dialog_begruessung():
    """Begruessung fuer den Gespraechsmodus erzeugen (einmalig, gecacht)."""
    if (w := wache()):
        return w
    import dialog
    text = core.cfg("dialog", "begruessung", default="")
    if not text:
        return jsonify(fehler="kein Begrüßungstext hinterlegt"), 400
    try:
        p = tts.baue("dialog-begruessung", text)
        return jsonify(ok=True, datei=os.path.basename(p["wav"]))
    except Exception as e:
        return jsonify(fehler=str(e)), 400


@app.get("/wissen")
def wissen_seite():
    if (w := wache()):
        return w
    return send_file(os.path.join(WEB, "wissen.html"))


@app.get("/api/wissen")
def wissen_lesen():
    if (w := wache()):
        return w
    import wissen as W
    return jsonify(
        korrekturen=(open(W.KORREKTUREN, encoding="utf-8").read()
                     if os.path.exists(W.KORREKTUREN) else ""),
        websiteZeichen=(os.path.getsize(W.WEBSITE) if os.path.exists(W.WEBSITE) else 0),
        websiteStand=(time.strftime("%d.%m.%Y %H:%M",
                      time.localtime(os.path.getmtime(W.WEBSITE)))
                      if os.path.exists(W.WEBSITE) else ""))


@app.post("/api/wissen")
def wissen_speichern():
    if (w := wache()):
        return w
    import wissen as W
    os.makedirs(W.WISSEN, exist_ok=True)
    with open(W.KORREKTUREN, "w", encoding="utf-8") as fh:
        fh.write((request.get_json(silent=True) or {}).get("korrekturen", ""))
    return jsonify(ok=True)


@app.post("/api/wissen/website-holen")
def wissen_holen():
    if (w := wache()):
        return w
    import wissen as W
    try:
        inhalt = W.hole_website()
        return jsonify(ok=True, zeichen=len(inhalt), seiten=inhalt.count("# Seite:"))
    except Exception as e:
        return jsonify(fehler=str(e)), 400


# ------------------------------------------------------- Eigene Stimme

STIMME = os.path.join(core.DATA, "stimme")


@app.get("/stimme")
def stimme_seite():
    if (w := wache()):
        return w
    return send_file(os.path.join(WEB, "stimme.html"))


@app.post("/api/stimme/aufnahme")
def stimme_aufnahme():
    if (w := wache()):
        return w
    datei = request.files.get("audio")
    if not datei:
        return jsonify(fehler="keine Aufnahme empfangen"), 400
    os.makedirs(STIMME, exist_ok=True)

    nummer = 1 + max([int(re.search(r"(\d+)", f).group(1))
                      for f in os.listdir(STIMME) if f.endswith(".mp3")] or [0])
    roh = os.path.join(STIMME, f"roh-{nummer:02d}")
    datei.save(roh)
    ziel = os.path.join(STIMME, f"stimme-{nummer:02d}.mp3")
    try:
        # Fuer das Klonen zaehlt Qualitaet: 44,1 kHz, mono, ordentliche Rate.
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", roh,
                        "-ar", "44100", "-ac", "1", "-b:a", "128k", ziel], check=True)
    except subprocess.CalledProcessError:
        return jsonify(fehler="Aufnahme konnte nicht umgewandelt werden"), 400
    finally:
        if os.path.exists(roh):
            os.remove(roh)

    return jsonify(ok=True, nummer=nummer, sekunden=pipeline.dauer(ziel),
                   gesamt=stimme_bestand())


def stimme_bestand():
    if not os.path.isdir(STIMME):
        return {"anzahl": 0, "sekunden": 0.0}
    dateien = sorted(f for f in os.listdir(STIMME) if f.endswith(".mp3"))
    return {"anzahl": len(dateien),
            "sekunden": round(sum(pipeline.dauer(os.path.join(STIMME, f))
                                  for f in dateien), 1),
            "dateien": dateien}


@app.get("/api/stimme/bestand")
def stimme_stand():
    if (w := wache()):
        return w
    return jsonify(**stimme_bestand(),
                   geklont=bool(core.cfg("elevenlabs", "eigeneVoiceId", default="")))


@app.get("/api/stimme/anhoeren/<name>")
def stimme_anhoeren(name):
    if (w := wache()):
        return w
    p = os.path.join(STIMME, os.path.basename(name))
    if not p.endswith(".mp3") or not os.path.exists(p):
        return jsonify(fehler="nicht gefunden"), 404
    return send_file(p, mimetype="audio/mpeg")


@app.delete("/api/stimme/aufnahme/<name>")
def stimme_loeschen(name):
    if (w := wache()):
        return w
    p = os.path.join(STIMME, os.path.basename(name))
    if p.endswith(".mp3") and os.path.exists(p):
        os.remove(p)
    return jsonify(ok=True, gesamt=stimme_bestand())


@app.post("/api/stimme/klonen")
def stimme_klonen():
    if (w := wache()):
        return w
    import requests
    stand = stimme_bestand()
    if stand["sekunden"] < 60:
        return jsonify(fehler=f"Nur {stand['sekunden']:.0f} Sekunden Material — "
                              "für ein gutes Ergebnis sollten es mindestens 60 sein."), 400

    dateien = [("files", (f, open(os.path.join(STIMME, f), "rb"), "audio/mpeg"))
               for f in stand["dateien"]]
    try:
        r = requests.post("https://api.elevenlabs.io/v1/voices/add",
                          headers={"xi-api-key": core.cfg("elevenlabs", "apiKey")},
                          data={"name": "Volker Isken",
                                "description": "Eigene Stimme für die Anrufannahme"},
                          files=dateien, timeout=180)
    finally:
        for _, (_, fh, _) in dateien:
            fh.close()

    if r.status_code != 200:
        return jsonify(fehler=f"ElevenLabs {r.status_code}: {r.text[:300]}"), 400
    vid = r.json().get("voice_id")
    c = core.full_cfg()
    c["elevenlabs"]["eigeneVoiceId"] = vid
    core.save_cfg(c)
    return jsonify(ok=True, voiceId=vid)


@app.post("/api/stimme/probe")
def stimme_probe():
    """Ansage mit der geklonten Stimme erzeugen, zum Vergleich."""
    if (w := wache()):
        return w
    vid = core.cfg("elevenlabs", "eigeneVoiceId", default="")
    if not vid:
        return jsonify(fehler="noch keine eigene Stimme erzeugt"), 400
    c = core.full_cfg()
    gemerkt = c["elevenlabs"]["voiceId"]
    c["elevenlabs"]["voiceId"] = vid
    core.save_cfg(c)
    try:
        tts.baue("probe-eigene", core.cfg("ansage", "text"))
    except Exception as e:
        return jsonify(fehler=str(e)), 400
    finally:
        c = core.full_cfg()
        c["elevenlabs"]["voiceId"] = gemerkt
        core.save_cfg(c)
    return jsonify(ok=True)


@app.post("/api/stimme/uebernehmen")
def stimme_uebernehmen():
    """Eigene Stimme als die der Anrufannahme festlegen."""
    if (w := wache()):
        return w
    vid = core.cfg("elevenlabs", "eigeneVoiceId", default="")
    if not vid:
        return jsonify(fehler="noch keine eigene Stimme erzeugt"), 400
    c = core.full_cfg()
    c["elevenlabs"]["voiceId"] = vid
    core.save_cfg(c)
    try:
        tts.baue_alle()
    except Exception as e:
        return jsonify(fehler=str(e)), 400
    return jsonify(ok=True, hinweis="Jetzt noch: sudo ~/v3dcall/asterisk/install.sh")


@app.get("/api/health")
def health():
    with core.db() as con:
        n = con.execute("SELECT COUNT(*) c FROM calls").fetchone()["c"]
    return jsonify(ok=True, anrufe=n,
                   ansageBereit=os.path.exists(os.path.join(core.SOUNDS, "ansage.wav")))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else core.cfg("port", default=8786)
    app.run(host="127.0.0.1", port=port, threaded=True)
