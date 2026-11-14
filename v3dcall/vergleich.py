"""Stimmenvergleich ElevenLabs <-> VoiceStudio fuer die Anrufannahme.

Erzeugt eine Tabelle (Zeilen = Texte, Spalten = Stimmen) unter
data/vergleich/: je Probe das Original, eine Telefonfassung (8 kHz, gleiche
Lautheitsangleichung wie im Betrieb) und die gemessene Erzeugungszeit.
Angezeigt unter /anrufe/vergleich (server.py) bzw. als eigenstaendige
Datei data/vergleich/vergleich-komplett.html zum Teilen.

  .venv/bin/python vergleich.py                 # fehlende Proben erzeugen
  .venv/bin/python vergleich.py --nur voicestudio   # nur VoiceStudio-Spalten
  .venv/bin/python vergleich.py --neu ...       # vorhandene neu erzeugen
  .venv/bin/python vergleich.py --html          # nur die Seite neu bauen

Vorhandene Proben werden NICHT neu erzeugt — ElevenLabs-Zeichen sparen.
"""
import base64, html, json, os, shutil, sys, time
import requests
import core, dialog, tts

ZIEL = os.path.join(core.DATA, "vergleich")
ERGEBNIS = os.path.join(ZIEL, "ergebnisse.json")
EL = "https://api.elevenlabs.io/v1"
GEORGE = "JBFqnCBsd6RMkjVDRZzb"


def texte():
    d = core.cfg("dialog", default={}) or {}
    gruss = (d.get("gruesse") or [d.get("begruessung", "")])[0]
    fue = d.get("fueller") or {}
    return [
        {"id": "gruss", "titel": "Begrüßung", "text": gruss, "ansage": "gruss1"},
        {"id": "fueller1", "titel": "Füllwort 1", "text": fue.get("fueller1", ""), "ansage": "fueller1"},
        {"id": "fueller2", "titel": "Füllwort 2", "text": fue.get("fueller2", ""), "ansage": "fueller2"},
        {"id": "preis", "titel": "Antwort: Kurspreis",
         "text": "Der Grundkurs kostet ab 179 € inkl. MwSt. und dauert ein bis zwei Tage. "
                 "Vorkenntnisse brauchen Sie dafür keine."},
        {"id": "weg", "titel": "Antwort: Adresse",
         "text": "Die Volme 3D Akademie finden Sie in Hagen, Tückinger Höhe 15. "
                 "Alle Termine stehen auch auf volme3dakademie.de."},
        {"id": "rueckruf", "titel": "Antwort: Rückruf",
         "text": "Alles klar, Herr Berger. Ich gebe das an Volker weiter, "
                 "er ruft Sie heute Nachmittag unter Ihrer Nummer zurück."},
    ]


def stimmen():
    klon = core.cfg("elevenlabs", "eigeneVoiceId", default="") or core.cfg("elevenlabs", "voiceId")
    return [
        {"id": "el-v3-klon", "titel": "ElevenLabs v3 · Klon Volker", "anbieter": "elevenlabs",
         "art": "v3", "voice": klon, "hinweis": "wie feste Ansagen (eleven_v3, Stability 0)"},
        {"id": "el-turbo-klon", "titel": "ElevenLabs Turbo · Klon Volker", "anbieter": "elevenlabs",
         "art": "turbo", "voice": klon, "hinweis": "wie Live-Antworten (turbo_v2_5)"},
        {"id": "el-turbo-george", "titel": "ElevenLabs Turbo · George", "anbieter": "elevenlabs",
         "art": "turbo", "voice": GEORGE, "hinweis": "Standardstimme"},
        {"id": "vs-omni-volker", "titel": "VoiceStudio OmniVoice · Klon Volker",
         "anbieter": "voicestudio", "modell": "omnivoice", "voice": "Volker",
         "hinweis": "Profil aus /stimme-Aufnahme (15,7 s)"},
        {"id": "vs-omni-standard", "titel": "VoiceStudio OmniVoice · Standard",
         "anbieter": "voicestudio", "modell": "omnivoice", "voice": "default",
         "hinweis": "ohne Klon"},
        {"id": "vs-omni-demo", "titel": "VoiceStudio OmniVoice · Demo-Stimme",
         "anbieter": "voicestudio", "modell": "omnivoice", "voice": "Demo Voice",
         "hinweis": "mitgelieferte (englische) Stimme, spricht Deutsch"},
    ]


# ------------------------------------------------------------- Erzeugen

def _el(stimme, text, ziel):
    """-> (sekunden_gesamt, sekunden_bis_erster_ton). Genau die Einstellungen
    des Betriebs: v3 wie tts.sprich, Turbo wie dialog.sprich."""
    kopf = {"xi-api-key": core.cfg("elevenlabs", "apiKey"), "accept": "audio/mpeg"}
    if stimme["art"] == "v3":
        url = f"{EL}/text-to-speech/{stimme['voice']}"
        body = {"text": dialog.fuer_die_stimme(text), "model_id": "eleven_v3",
                "voice_settings": {"stability": core.cfg("elevenlabs", "stability", default=0.0),
                                   "similarity_boost": core.cfg("elevenlabs", "similarity", default=0.75),
                                   "speed": core.cfg("elevenlabs", "speed", default=1.0)}}
    else:
        url = f"{EL}/text-to-speech/{stimme['voice']}/stream?optimize_streaming_latency=3"
        body = {"text": dialog.mit_satzpausen(dialog.fuer_die_stimme(text)),
                "model_id": core.cfg("dialog", "ttsModel", default="eleven_turbo_v2_5"),
                "voice_settings": {"stability": 0.4, "similarity_boost": 0.75,
                                   "speed": core.cfg("elevenlabs", "speed", default=1.0)}}
    t0 = time.monotonic()
    erster = None
    with requests.post(url, json=body, headers=kopf, timeout=120, stream=True) as r:
        if r.status_code != 200:
            raise RuntimeError(f"ElevenLabs {r.status_code}: {r.text[:200]}")
        with open(ziel, "wb") as fh:
            for happen in r.iter_content(4096):
                if happen and erster is None:
                    erster = time.monotonic() - t0
                fh.write(happen)
    return time.monotonic() - t0, erster


def _vs(stimme, text, ziel):
    t0 = time.monotonic()
    tts.voicestudio_sprich(dialog.fuer_die_stimme(text), ziel, format="wav",
                           stimme=stimme["voice"], modell=stimme["modell"], timeout=900)
    return time.monotonic() - t0, None


def _dauer(pfad):
    import subprocess
    p = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "csv=p=0", pfad], capture_output=True, text=True)
    try:
        return round(float(p.stdout.strip()), 2)
    except ValueError:
        return None


def erzeuge(nur=None, neu=False):
    os.makedirs(ZIEL, exist_ok=True)
    erg = {}
    if os.path.exists(ERGEBNIS):
        with open(ERGEBNIS, encoding="utf-8") as fh:
            erg = json.load(fh)
    zeichen = erg.get("_elevenlabsZeichen", 0)
    vs_warm = False
    for s in stimmen():
        if nur and s["anbieter"] != nur:
            continue
        ordner = os.path.join(ZIEL, s["id"])
        os.makedirs(ordner, exist_ok=True)
        for t in texte():
            schl = f"{s['id']}/{t['id']}"
            alt = erg.get(schl) or {}
            if alt.get("ok") and not neu:
                continue
            endung = "mp3" if s["anbieter"] == "elevenlabs" else "wav"
            orig = os.path.join(ordner, f"{t['id']}.{endung}")
            eintrag = {"stimme": s["id"], "text": t["id"], "t": time.strftime("%Y-%m-%d %H:%M")}
            try:
                if s.get("art") == "v3" and t.get("ansage") and \
                        os.path.exists(os.path.join(core.SOUNDS, t["ansage"] + ".mp3")):
                    # Feste Ansage gibt es schon im Betrieb — die echte nehmen,
                    # kostet keine Zeichen und ist genau das, was Anrufer hoeren.
                    shutil.copy(os.path.join(core.SOUNDS, t["ansage"] + ".mp3"), orig)
                    eintrag.update(vorhanden=True)
                elif s["anbieter"] == "elevenlabs":
                    ges, erster = _el(s, t["text"], orig)
                    zeichen += len(t["text"])
                    eintrag.update(sekunden=round(ges, 2),
                                   ersterTon=round(erster, 2) if erster else None)
                else:
                    if not vs_warm:
                        # Erster Aufruf laedt das Modell — getrennt messen
                        t0 = time.monotonic()
                        _vs(s, "Hallo.", os.path.join(ordner, "_warm.wav"))
                        erg["_vsKaltstart"] = round(time.monotonic() - t0, 2)
                        vs_warm = True
                    ges, _ = _vs(s, t["text"], orig)
                    eintrag.update(sekunden=round(ges, 2))
                tel = os.path.join(ordner, f"{t['id']}.8k.wav")
                tts.nach_asterisk(orig, tel)
                eintrag.update(ok=True, datei=os.path.relpath(orig, ZIEL),
                               telefon=os.path.relpath(tel, ZIEL), dauer=_dauer(orig))
                if eintrag.get("sekunden") and eintrag["dauer"]:
                    eintrag["rtf"] = round(eintrag["sekunden"] / eintrag["dauer"], 2)
            except Exception as ex:
                eintrag.update(ok=False, fehler=str(ex)[:300])
            erg[schl] = eintrag
            print(f"{schl:32} {'ok' if eintrag.get('ok') else 'FEHLER'} "
                  f"{eintrag.get('sekunden', '')} {eintrag.get('fehler', '')[:120]}", flush=True)
            if not eintrag.get("ok") and s["anbieter"] == "voicestudio":
                # Lizenz fehlt / Engine aus: gleiche Meldung fuer alle Texte
                for t2 in texte():
                    k2 = f"{s['id']}/{t2['id']}"
                    if not (erg.get(k2) or {}).get("ok"):
                        erg[k2] = dict(eintrag, text=t2["id"])
                break
    erg["_elevenlabsZeichen"] = zeichen
    with open(ERGEBNIS, "w", encoding="utf-8") as fh:
        json.dump(erg, fh, indent=1, ensure_ascii=False)
    return erg


# ---------------------------------------------------------------- Seite

def seite(erg, eingebettet=False, key=""):
    """HTML der Vergleichstabelle. eingebettet=True: Audio als data:-URL,
    die Datei funktioniert dann ohne Server (zum Teilen)."""
    def quelle(rel):
        if eingebettet:
            pfad = os.path.join(ZIEL, rel)
            mime = "audio/mpeg" if rel.endswith(".mp3") else "audio/wav"
            with open(pfad, "rb") as fh:
                return f"data:{mime};base64,{base64.b64encode(fh.read()).decode()}"
        return f"vergleich/{rel}" + (f"?key={key}" if key else "")

    kopf = "".join(f"<th>{html.escape(s['titel'])}<small>{html.escape(s['hinweis'])}</small></th>"
                   for s in stimmen())
    zeilen = ""
    for t in texte():
        zellen = ""
        for s in stimmen():
            e = erg.get(f"{s['id']}/{t['id']}") or {}
            if not e.get("ok"):
                grund = e.get("fehler") or "noch nicht erzeugt"
                if "model_licence_required" in grund or "Licence not accepted" in grund:
                    grund = "Lizenz für OmniVoice (CC-BY-NC) noch nicht freigegeben"
                zellen += f'<td class="leer">{html.escape(grund[:160])}</td>'
                continue
            if e.get("vorhanden"):
                zeit = '<span class="zeit">vorhandene Ansage</span>'
            else:
                z = f"{e['sekunden']:.2f} s"
                if e.get("ersterTon"):
                    z += f" · 1. Ton {e['ersterTon']:.2f} s"
                if e.get("rtf"):
                    z += f" · ×{e['rtf']:.2f} Echtzeit"
                klasse = "gut" if e["sekunden"] <= 1.0 else "mittel" if e["sekunden"] <= 2.5 else "schlecht"
                zeit = f'<span class="zeit {klasse}">{z}</span>'
            zellen += (f'<td><audio controls preload="none" class="tel" '
                       f'src="{quelle(e["telefon"])}"></audio>'
                       f'<audio controls preload="none" class="orig" '
                       f'src="{quelle(e["datei"])}"></audio>'
                       f'{zeit}<span class="zeit">Länge {e.get("dauer") or "?"} s</span></td>')
        zeilen += (f'<tr><th class="text">{html.escape(t["titel"])}'
                   f'<small>{html.escape(t["text"])}</small></th>{zellen}</tr>')
    kalt = erg.get("_vsKaltstart")
    info = (f"VoiceStudio-Kaltstart (Modell laden): {kalt:.1f} s · " if kalt else "") + \
        f"ElevenLabs-Zeichen für diese Proben: {erg.get('_elevenlabsZeichen', 0)}"
    return f"""<!doctype html><html lang="de"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stimmenvergleich</title><style>
body{{margin:0;background:#141821;color:#e8ecf4;
  font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:16px}}
h1{{font-size:19px;margin:0 0 6px}}
p.hinweis{{color:#9aa4bb;font-size:14px;margin:0 0 14px;max-width:70em}}
.wrap{{overflow-x:auto}}
table{{border-collapse:separate;border-spacing:6px}}
th,td{{background:#1d222e;border:1px solid #333b4d;border-radius:10px;padding:8px;
  vertical-align:top;min-width:210px}}
th{{text-align:left;font-size:14px}} th small{{display:block;color:#9aa4bb;font-weight:400}}
th.text{{min-width:230px;max-width:280px;position:sticky;left:0;z-index:1}}
td.leer{{color:#8a6d6d;font-size:13px}}
audio{{width:100%;height:36px}}
body:not(.original) audio.orig, body.original audio.tel{{display:none}}
.zeit{{display:block;font-size:12.5px;color:#9aa4bb}}
.gut{{color:#6ad38a}} .mittel{{color:#e6c35c}} .schlecht{{color:#ef7a7a}}
label{{display:inline-block;margin:0 0 12px;cursor:pointer}}
a{{color:#4f8cff}}
</style></head><body>
<h1>Stimmenvergleich ElevenLabs ↔ VoiceStudio</h1>
<p class="hinweis">Zeilen = Texte, Spalten = Stimmen. Standardmäßig hörst du die
<b>Telefonfassung</b> (8 kHz, gleiche Lautheitsangleichung wie im Betrieb) — so
klingt es beim Anrufer. Zeit = Erzeugung der ganzen Probe; bei ElevenLabs Turbo
zusätzlich, wann der erste Ton kam (zählt beim Datenstrom-Gespräch). Ziel am
Telefon: ~2 s vom Satzende bis zum ersten Ton, davon gehen ~1,5 s schon an Claude.
<br>{html.escape(info)}</p>
<label><input type="checkbox" onchange="document.body.classList.toggle('original',this.checked)">
Original statt Telefonfassung abspielen</label>
<div class="wrap"><table><tr><th class="text">Text</th>{kopf}</tr>{zeilen}</table></div>
<p class="hinweis" style="margin-top:18px">Stand: {time.strftime('%d.%m.%Y %H:%M')} ·
neu erzeugen: <code>~/v3dcall/.venv/bin/python ~/v3dcall/vergleich.py [--nur voicestudio]</code></p>
</body></html>"""


def schreibe_seiten(erg):
    with open(os.path.join(ZIEL, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(seite(erg))
    komplett = os.path.join(ZIEL, "vergleich-komplett.html")
    with open(komplett, "w", encoding="utf-8") as fh:
        fh.write(seite(erg, eingebettet=True))
    return komplett


if __name__ == "__main__":
    nur = sys.argv[sys.argv.index("--nur") + 1] if "--nur" in sys.argv else None
    if "--html" in sys.argv:
        with open(ERGEBNIS, encoding="utf-8") as fh:
            erg = json.load(fh)
    else:
        erg = erzeuge(nur=nur, neu="--neu" in sys.argv)
    print("Seite:", schreibe_seiten(erg))
