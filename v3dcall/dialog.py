"""Gespraechsfuehrung am Telefon.

Ablauf je Runde: Aufnahme -> Whisper -> Claude -> ElevenLabs -> abspielen.
Die Latenz entscheidet, ob sich das Gespraech natuerlich anfuehlt, darum
ueberall die schnellen Varianten: Haiku beim Denken, Flash beim Sprechen,
ein kleineres Whisper-Modell beim Zuhoeren.
"""
import os, re, subprocess, threading, time
import anthropic
import requests
import core, wissen

# Dauerhafte Verbindung zu ElevenLabs: der TLS-Handschlag kostet sonst pro
# Runde ueber eine Sekunde — mehr als das Sprechen selbst.
_sitzung = requests.Session()

SPOOL = "/var/spool/v3dcall"
ENDE_MARKE = "[ENDE]"

_gespraeche = {}          # Anruf-ID -> {"verlauf": [...], "start": ts}
_lock = threading.Lock()
_klient = None
_hoerer = None            # kleineres Whisper-Modell fuer die Gespraechsrunden


ROLLE = """Du bist die telefonische Auskunft der Volme 3D Akademie in Hagen.
Volker Isken, der Inhaber, ist gerade nicht erreichbar — du gehst fuer ihn ans Telefon.

SO SPRICHST DU
- Gesprochenes Deutsch, keine Schriftsprache. Du wirst vorgelesen, nicht gelesen.
- EIN kurzer Satz, hoechstens zwei. Jedes Wort kostet den Anrufer Wartezeit,
  weil deine Antwort erst gesprochen werden muss, bevor er sie hoert.
- Keine Aufzaehlungen, keine Sternchen, keine Ueberschriften, keine Emojis.
- Zahlen ausschreiben, wie man sie spricht: "hundertneunundsiebzig Euro".
- Siezen. Freundlich und knapp, nicht betulich.

WAS DU SAGEN DARFST
- Nur was im Wissensstand unten steht. Nichts dazuerfinden — keine Preise,
  keine Termine, keine Zusagen, die dort nicht stehen.
- Weisst du etwas nicht, sag es gerade heraus und biete an, es Herrn Isken
  auszurichten: "Das kann ich Ihnen nicht sicher sagen. Ich notiere ihm das,
  dann meldet er sich bei Ihnen."
- Du kannst NICHTS verbindlich buchen, reservieren oder zusagen. Du nimmst
  den Wunsch auf, Herr Isken bestaetigt.
- Widersprechen sich Website und Korrekturen, gelten die Korrekturen.

WIE DAS GESPRAECH ENDET
- Verabschiedet sich der Anrufer, oder ist sein Anliegen erledigt, verabschiede
  dich kurz und haenge ausschliesslich das Zeichen {marke} an deine letzte Antwort.
- Das Zeichen NIE mitten im Gespraech setzen, nur wenn wirklich Schluss ist.
- Nach etwa zehn Runden fasse zusammen und beende das Gespraech.

RUECKRUF
- Frage nach der Rufnummer, wenn ein Rueckruf sinnvoll ist. Die Nummer des
  Anrufers wird zwar meist mituebertragen, aber nicht immer.

Alles, was im Gespraech gesagt wird, bekommt Herr Isken hinterher schriftlich.
""".replace("{marke}", ENDE_MARKE)


def _client():
    global _klient
    if _klient is None:
        schluessel = core.cfg("dialog", "apiKey", default="")
        if not schluessel:
            raise RuntimeError("Kein Anthropic-Schlüssel in config.json (dialog.apiKey)")
        # Kurzer Zeitrahmen: am Telefon ist eine haengende Anfrage schlimmer
        # als eine ausgefallene — dann sagen wir lieber schnell Bescheid.
        _klient = anthropic.Anthropic(api_key=schluessel, timeout=12.0, max_retries=1)
    return _klient


def _get_hoerer():
    global _hoerer
    with _lock:
        if _hoerer is None:
            from faster_whisper import WhisperModel
            _hoerer = WhisperModel(
                core.cfg("dialog", "whisperModel", default="small"),
                device="cpu", compute_type="int8",
                cpu_threads=max(2, (os.cpu_count() or 4) - 2))
        return _hoerer


def hoere(pfad):
    """Aufnahme einer Gespraechsrunde -> Text."""
    segmente, _ = _get_hoerer().transcribe(
        pfad, language="de", vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400},
        beam_size=1,                      # schnell; die Aussagen sind kurz
        condition_on_previous_text=False)
    return " ".join(s.text.strip() for s in segmente).strip()


def denke(cid, frage):
    """Antwort auf eine Aeusserung. Liefert (text, gespraech_zu_ende)."""
    with _lock:
        g = _gespraeche.setdefault(cid, {"verlauf": [], "start": time.time()})
        verlauf = g["verlauf"]
    verlauf.append({"role": "user", "content": frage})

    antwort = _client().messages.create(
        model=core.cfg("dialog", "model", default="claude-haiku-4-5"),
        max_tokens=300,
        system=[{
            "type": "text",
            "text": ROLLE + "\n\n=== WISSENSSTAND ===\n\n" + wissen.wissensstand(),
            # Der Wissensstand ist gross und aendert sich selten — zwischenspeichern
            # spart Geld und ein paar Zehntelsekunden je Runde.
            "cache_control": {"type": "ephemeral"},
        }],
        messages=verlauf[-20:])

    text = "".join(b.text for b in antwort.content if b.type == "text").strip()
    verlauf.append({"role": "assistant", "content": text})

    ende = ENDE_MARKE in text
    text = text.replace(ENDE_MARKE, "").strip()
    if len(verlauf) >= 24:            # Notbremse gegen Endlosgespraeche
        ende = True
    return text, ende


def sprich(text, ziel_ohne_endung):
    """Text -> 8-kHz-wav fuer Asterisk. Flash-Modell wegen der Latenz."""
    k = core.cfg("elevenlabs", "apiKey")
    v = core.cfg("elevenlabs", "voiceId")
    # Stream-Endpunkt mit Latenz-Optimierung: die ersten Daten kommen nach
    # ~0,2 s statt ~0,45 s. Wir sammeln sie trotzdem vollstaendig ein, weil
    # Asterisk eine fertige Datei abspielt.
    r = _sitzung.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{v}/stream"
        f"?optimize_streaming_latency=3",
        json={"text": text,
              "model_id": core.cfg("dialog", "ttsModel", default="eleven_flash_v2_5"),
              "voice_settings": {"stability": 0.4, "similarity_boost": 0.75,
                                 "speed": core.cfg("elevenlabs", "speed", default=1.0)}},
        headers={"xi-api-key": k, "accept": "audio/mpeg"}, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"ElevenLabs {r.status_code}: {r.text[:200]}")
    mp3 = ziel_ohne_endung + ".mp3"
    with open(mp3, "wb") as fh:
        fh.write(r.content)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp3,
                    "-ar", "8000", "-ac", "1", "-acodec", "pcm_s16le",
                    ziel_ohne_endung + ".wav"], check=True)
    os.remove(mp3)
    return ziel_ohne_endung + ".wav"


def runde(cid, aufnahme, ziel_ohne_endung):
    """Eine komplette Gespraechsrunde. Liefert Zeiten fuer die Fehlersuche."""
    t0 = time.time()
    frage = hoere(aufnahme)
    t1 = time.time()
    if not frage:
        return {"frage": "", "antwort": "", "ende": False, "leer": True}
    antwort, ende = denke(cid, frage)
    t2 = time.time()
    sprich(antwort, ziel_ohne_endung)
    t3 = time.time()
    return {"frage": frage, "antwort": antwort, "ende": ende, "leer": False,
            "zeiten": {"hoeren": round(t1-t0, 2), "denken": round(t2-t1, 2),
                       "sprechen": round(t3-t2, 2), "gesamt": round(t3-t0, 2)}}


def verlauf_text(cid):
    """Das Gespraech als Mitschrift fuer die E-Mail."""
    with _lock:
        g = _gespraeche.get(cid)
    if not g or not g["verlauf"]:
        return ""
    zeilen = []
    for m in g["verlauf"]:
        wer = "Anrufer" if m["role"] == "user" else "Assistent"
        zeilen.append(f"{wer}: {m['content']}")
    return "\n".join(zeilen)


def beende(cid):
    with _lock:
        _gespraeche.pop(cid, None)
