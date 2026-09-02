"""Ansagen mit ElevenLabs erzeugen und für Asterisk aufbereiten.

Asterisk mag am liebsten 8 kHz mono 16-bit PCM als .wav — genau das
liefert die Umwandlung hier ab. Zusaetzlich bleibt eine mp3 fuer die
Vorschau in der Weboberflaeche liegen.
"""
import os, subprocess, sys, requests
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


def sprich(text, ziel_mp3):
    """Text -> mp3 ueber ElevenLabs."""
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


def nach_asterisk(quelle, ziel_wav):
    """Beliebiges Audio -> 8 kHz mono PCM16 .wav, leicht normalisiert."""
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", quelle,
         "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "8000", "-ac", "1",
         "-acodec", "pcm_s16le", ziel_wav],
        check=True)
    return ziel_wav


def baue(name, text):
    """Eine Ansage komplett erzeugen: mp3 (Vorschau) + wav (Asterisk)."""
    mp3 = os.path.join(core.SOUNDS, f"{name}.mp3")
    wav = os.path.join(core.SOUNDS, f"{name}.wav")
    sprich(text, mp3)
    nach_asterisk(mp3, wav)
    return {"mp3": mp3, "wav": wav}


def baue_alle():
    ergebnis = {}
    for name, schluessel in (("ansage", "text"), ("danke", "danke")):
        text = (core.cfg("ansage", schluessel, default="") or "").strip()
        if text:
            ergebnis[name] = baue(name, text)
    return ergebnis


if __name__ == "__main__":
    if "--stimmen" in sys.argv:
        for v in stimmen():
            print(f"{v['id']}  {v['name']:<22} {v['labels']}")
    else:
        for name, pfade in baue_alle().items():
            groesse = os.path.getsize(pfade["wav"])
            print(f"{name}: {pfade['wav']} ({groesse} Bytes)")
