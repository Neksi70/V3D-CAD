"""Ansagen erzeugen (ElevenLabs oder lokal VoiceStudio) und für Asterisk aufbereiten.

Asterisk mag am liebsten 8 kHz mono 16-bit PCM als .wav — genau das
liefert die Umwandlung hier ab. Zusaetzlich bleibt eine mp3 fuer die
Vorschau in der Weboberflaeche liegen.
"""
import json, os, re, subprocess, sys, tempfile, wave, requests
import core

API = "https://api.elevenlabs.io/v1"


def _key():
    key = core.cfg("elevenlabs", "apiKey", default="")
    if not key:
        raise RuntimeError("Kein ElevenLabs-Schluessel in config.json hinterlegt")
    return key


def stimmen():
    """Alle im Konto verfuegbaren Stimmen auflisten."""
    r = requests.get(f"{API}/voices", headers={"xi-api-key": _key()}, timeout=30)
    r.raise_for_status()
    return [{"id": v["voice_id"], "name": v["name"],
             "labels": v.get("labels", {})} for v in r.json().get("voices", [])]


# ------------------------------------------------------------ Anbieter
#
# Welche Stimme spricht? config.json:
#   "tts": {"anbieter": "elevenlabs" | "voicestudio",   # Standard fuer alles
#           "ansagen":  null | "elevenlabs" | "voicestudio",  # feste Ansagen
#           "live":     null | "elevenlabs" | "voicestudio",  # Live-Antworten
#           "voicestudio": {"url": "http://127.0.0.1:8840",
#                           "keyDatei": "~/voicestudio/.env",
#                           "stimme": "Volker", "modell": "omnivoice",
#                           "sprache": "de", "speed": 1.0}}
# Fehlt der Block, bleibt alles bei ElevenLabs — so wie bisher.

ANBIETER = ("elevenlabs", "voicestudio")


def anbieter(zweck=None):
    """'elevenlabs' oder 'voicestudio' fuer zweck 'ansagen' / 'live'."""
    wert = core.cfg("tts", zweck, default=None) if zweck else None
    wert = wert or core.cfg("tts", "anbieter", default="elevenlabs")
    return wert if wert in ANBIETER else "elevenlabs"


def _vs(schluessel, default=None):
    return core.cfg("tts", "voicestudio", schluessel, default=default)


def _vs_key():
    """API-Schluessel aus ~/voicestudio/.env (OMNIVOICE_API_KEY=...)."""
    pfad = os.path.expanduser(_vs("keyDatei", "~/voicestudio/.env"))
    try:
        with open(pfad, encoding="utf-8") as fh:
            for zeile in fh:
                if zeile.startswith("OMNIVOICE_API_KEY="):
                    return zeile.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""


# Dauerhafte Verbindung: lokal kostet der Handschlag wenig, aber umsonst
# muss er auch nicht jedes Mal sein.
_vs_sitzung = requests.Session()


def voicestudio_sprich(text, ziel, format="mp3", stimme=None, modell=None,
                       timeout=300):
    """Text -> Audiodatei ueber VoiceStudio (OpenAI-kompatibel, lokal).

    Kein SSML: VoiceStudio liest <break .../> sonst vor. Satzpausen setzt
    das Modell an Punkten von selbst.
    """
    body = {"model": modell or _vs("modell", "omnivoice"),
            "input": text,
            "voice": stimme or _vs("stimme", "Volker"),
            "language": _vs("sprache", "de"),
            "response_format": format,
            "speed": _vs("speed", 1.0)}
    for k, v in (_vs("extra", {}) or {}).items():
        body.setdefault(k, v)
    kopf = {"Content-Type": "application/json"}
    key = _vs_key()
    if key:
        kopf["Authorization"] = f"Bearer {key}"
    url = _vs("url", "http://127.0.0.1:8840").rstrip("/") + "/v1/audio/speech"
    r = _vs_sitzung.post(url, json=body, headers=kopf, timeout=timeout)
    if r.status_code != 200:
        raise RuntimeError(f"VoiceStudio {r.status_code}: {r.text[:300]}")
    os.makedirs(os.path.dirname(ziel) or ".", exist_ok=True)
    with open(ziel, "wb") as fh:
        fh.write(r.content)
    return ziel


def voicestudio_pcm8k(text):
    """Text -> rohes PCM (8 kHz, 16 bit, mono), lautheitsangeglichen —
    fertig fuer den Datenstrom-Weg (strom.py)."""
    with tempfile.TemporaryDirectory(prefix="vs-") as tmp:
        roh, wav = os.path.join(tmp, "roh.wav"), os.path.join(tmp, "8k.wav")
        voicestudio_sprich(text, roh, format="wav")
        nach_asterisk(roh, wav)
        with wave.open(wav, "rb") as w:
            return w.readframes(w.getnframes())


def sprich(text, ziel_mp3, anbieter_name=None):
    """Text -> mp3 ueber den eingestellten Anbieter der festen Ansagen."""
    if (anbieter_name or anbieter("ansagen")) == "voicestudio":
        import dialog          # Aussprache-Kruecken (Folme, Akademi, inkl. ...)
        return voicestudio_sprich(dialog.fuer_die_stimme(text), ziel_mp3, format="mp3")
    voice = core.cfg("elevenlabs", "voiceId", default="")
    if not voice:
        raise RuntimeError("Keine voiceId in config.json hinterlegt")
    body = {
        "text": text,
        "model_id": core.cfg("elevenlabs", "model", default="eleven_multilingual_v2"),
        "voice_settings": {
            "stability": core.cfg("elevenlabs", "stability", default=0.5),
            "similarity_boost": core.cfg("elevenlabs", "similarity", default=0.75),
            # Sprechtempo: 1.0 = normal, kleiner = langsamer. Das Modell
            # dehnt dabei natuerlich, anders als nachtraegliches Strecken.
            "speed": core.cfg("elevenlabs", "speed", default=1.0),
        },
    }
    r = requests.post(f"{API}/text-to-speech/{voice}", json=body,
                      headers={"xi-api-key": _key(), "accept": "audio/mpeg"}, timeout=120)
    if r.status_code != 200:
        raise RuntimeError(f"ElevenLabs {r.status_code}: {r.text[:300]}")
    os.makedirs(os.path.dirname(ziel_mp3), exist_ok=True)
    with open(ziel_mp3, "wb") as fh:
        fh.write(r.content)
    return ziel_mp3


ZIEL_LAUTHEIT = -16.0      # LUFS, wie bei Rundfunk ueblich
ZIEL_SPITZE = -1.5         # dBFS


def _lautheit(quelle):
    """Gemessene Lautheit in LUFS, oder None."""
    p = subprocess.run(["ffmpeg", "-hide_banner", "-i", quelle,
                        "-af", "ebur128", "-f", "null", "-"],
                       capture_output=True, text=True)
    treffer = re.findall(r"I:\s*(-?\d+\.\d+)\s*LUFS", p.stderr)
    return float(treffer[-1]) if treffer else None


def nach_asterisk(quelle, ziel_wav):
    """Beliebiges Audio -> 8 kHz mono PCM16 .wav, auf gleiche Lautheit gebracht.

    KEIN loudnorm: bei kurzem Material (unter ~3 s) misst es keinen
    Dynamikumfang (input_lra = 0) und verrechnet sich massiv — die
    Fuellwoerter landeten bei -35 LUFS statt -16, also fast 20 dB unter der
    Begruessung und im Telefonat kaum hoerbar.

    Stattdessen schlicht: Lautheit messen, Differenz als Verstaerkung
    anwenden, Begrenzer dahinter gegen Uebersteuern. Funktioniert bei einer
    Sekunde genauso wie bei einer Minute.
    """
    gemessen = _lautheit(quelle)
    filt = []
    if gemessen is not None:
        verstaerkung = ZIEL_LAUTHEIT - gemessen
        verstaerkung = max(-20.0, min(20.0, verstaerkung))   # Notbremse
        filt.append(f"volume={verstaerkung:.2f}dB")
        filt.append(f"alimiter=limit={10 ** (ZIEL_SPITZE / 20):.4f}")
    befehl = ["ffmpeg", "-y", "-loglevel", "error", "-i", quelle]
    if filt:
        befehl += ["-af", ",".join(filt)]
    befehl += ["-ar", "8000", "-ac", "1", "-acodec", "pcm_s16le", ziel_wav]
    subprocess.run(befehl, check=True)
    return ziel_wav


def baue(name, text, ordner=None, anbieter_name=None):
    """Eine Ansage komplett erzeugen: mp3 (Vorschau) + wav (Asterisk)."""
    ordner = ordner or core.SOUNDS
    mp3 = os.path.join(ordner, f"{name}.mp3")
    wav = os.path.join(ordner, f"{name}.wav")
    sprich(text, mp3, anbieter_name)
    nach_asterisk(mp3, wav)
    return {"mp3": mp3, "wav": wav}


def dialog_ansagen():
    """Alle festen Saetze des Gespraechsmodus: Dateiname -> Text.

    Dieselben Namen, die asterisk/install.sh nach /var/lib/asterisk
    kopiert und strom.py per ansage() abspielt.
    """
    d = core.cfg("dialog", default={}) or {}
    texte = {}
    for name in ("nachfrage", "stoerung"):
        if d.get(name):
            texte[name] = d[name]
    if d.get("begruessung"):
        texte["dialog-begruessung"] = d["begruessung"]
    for gruppe in ("fueller", "kurzfueller", "dankfueller", "wochenfueller"):
        texte.update({k: v for k, v in (d.get(gruppe) or {}).items() if v})
    for i, t in enumerate(d.get("gruesse") or [], 1):
        texte[f"gruss{i}"] = t
    for name, schluessel in (("ansage", "text"), ("danke", "danke")):
        t = (core.cfg("ansage", schluessel, default="") or "").strip()
        if t:
            texte[name] = t
    return texte


def baue_dialog_ansagen(ordner, anbieter_name):
    """Alle festen Ansagen in einen EIGENEN Ordner erzeugen (nie direkt in
    data/sounds — dort liegen die ElevenLabs-Fassungen, die bei eleven_v3
    jedes Mal anders klingen und nicht verloren gehen sollen)."""
    os.makedirs(ordner, exist_ok=True)
    ergebnis = {}
    for name, text in dialog_ansagen().items():
        ergebnis[name] = baue(name, text, ordner, anbieter_name)
    return ergebnis


def baue_alle():
    ergebnis = {}
    for name, schluessel in (("ansage", "text"), ("danke", "danke")):
        text = (core.cfg("ansage", schluessel, default="") or "").strip()
        if text:
            ergebnis[name] = baue(name, text)
    return ergebnis


if __name__ == "__main__":
    if "--dialog-ansagen" in sys.argv:
        # python tts.py --dialog-ansagen <ordner> <elevenlabs|voicestudio>
        i = sys.argv.index("--dialog-ansagen")
        ordner, name = sys.argv[i + 1], sys.argv[i + 2]
        for n, pfade in baue_dialog_ansagen(ordner, name).items():
            print(f"{n}: {pfade['wav']}")
    elif "--stimmen" in sys.argv:
        for v in stimmen():
            print(f"{v['id']}  {v['name']:<22} {v['labels']}")
    else:
        for name, pfade in baue_alle().items():
            groesse = os.path.getsize(pfade["wav"])
            print(f"{name}: {pfade['wav']} ({groesse} Bytes)")
