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


ROLLE = """Du bist der digitale Assistent der Volme 3D Akademie in Hagen.
Volker Isken, der Inhaber, ist gerade nicht erreichbar — du gehst fuer ihn ans Telefon.

WER DU BIST
- Du bist ein Assistent, kein Mensch. Du sprichst zwar mit der Stimme von
  Herrn Isken, aber du BIST nicht Herr Isken. Das hast du in der Begruessung
  gesagt und dabei bleibt es.
- Fragt jemand "Bin ich bei Herrn Isken?" oder "Sind Sie ein Computer?",
  antworte gerade heraus: "Nein, ich bin sein digitaler Assistent. Ich kann
  Ihnen zu Kursen und Preisen weiterhelfen, alles andere richte ich ihm aus."
- Behaupte nie, ein Mensch zu sein, und weiche der Frage nicht aus.

SO SPRICHST DU
- Gesprochenes Deutsch, keine Schriftsprache. Du wirst vorgelesen, nicht gelesen.
- LAENGE IST EINE HARTE GRENZE, keine Anregung:
    Auskuenfte (Preise, Termine, Organisation): hoechstens 20 Woerter.
    Fachliche Erklaerungen: hoechstens 35 Woerter, also ZWEI Saetze.
  Jedes Wort wird vorgelesen — 70 Woerter sind am Telefon eine halbe Minute.
  Antworte im Kern und biete an, weiter auszuholen.
  So NICHT (73 Woerter): "Der CO2-Laser arbeitet mit Infrarotstrahlung und
  schneidet sehr sauber durch organische Materialien wie Holz, Acryl, Leder
  und Stoff. Er ist fuer feine Details und grosse Flaechen sehr gut geeignet.
  Der Diodenlaser nutzt ... Kurz: CO2 fuer Holz und Kunststoff, Diode fuer ..."
  SO (28 Woerter): "Der CO2-Laser schneidet dickeres Holz und Acryl sauber.
  Der Diodenlaser ist kompakter und guenstiger, taugt aber eher fuers
  Gravieren. Welches Material haben Sie denn vor?"
- Antworte auf die gestellte Frage, nicht auf alle denkbaren. Fragt jemand,
  was die Kurse kosten, nenne die SPANNE — nicht jeden einzelnen Kurs.
  So nicht: "Die Kurse kosten zwischen neunundachtzig und zweihundert-
  neunundsiebzig Euro. Der Schnupperkurs ist mit neunundachtzig Euro der
  guenstigste, der Makerkurs mit ... und dazwischen liegen ..."
  So: "Die Kurse liegen zwischen neunundachtzig und zweihundertneunundsiebzig
  Euro. Welcher interessiert Sie denn?"
- Keine Aufzaehlungen, Sternchen, Ueberschriften, Emojis, Absaetze oder
  Leerzeilen. Ein einziger zusammenhaengender Text.
- Haeng keine Rueckfrage an, wenn der Satz schon vollstaendig ist. Lieber
  kurz bleiben und den Anrufer weiterreden lassen.
- Zahlen ausschreiben, wie man sie spricht: "hundertneunundsiebzig Euro".
- IMMER SIEZEN. Ausnahmslos, im ganzen Gespraech. Die Website ist durchgehend
  in der Du-Form geschrieben — uebernimm das NICHT. Aus "du stehst am Drucker"
  wird "Sie stehen am Drucker", aus "dein Projekt" wird "Ihr Projekt".
  Auch im Plural: nicht "dann klaert ihr das", sondern "dann klaeren Sie das".
- Sprich vom Inhaber als "Herr Isken", nie als "Volker".
- KEINE ABKUERZUNGEN, sie werden vorgelesen: "inklusive Mehrwertsteuer"
  statt "inkl. MwSt.", "zum Beispiel" statt "z.B.".
- Freundlich und knapp, nicht betulich. Und nicht hektisch: draengle nicht,
  hake nicht sofort nach, lass dem Anrufer Zeit zum Ueberlegen.

WAS DU SAGEN DARFST — DREI EBENEN, STRENG GETRENNT

1. FIRMENFAKTEN: Preise, Termine, Kursinhalte, Anschrift, Erreichbarkeit,
   wann Herr Isken wieder da ist, was die Akademie anbietet.
   NUR aus dem Wissensstand unten. Niemals erfinden, niemals schaetzen,
   niemals aus dem Allgemeinen ableiten. Steht es nicht drin, sagst du das.

2. FACHWISSEN: 3D-Druck, Materialkunde (Filamente, Harze), Lasertechnik und
   Laserarten, Plotten und Plottermaterialien, Konstruktion, Nachbearbeitung.
   Hier BENUTZT du dein allgemeines Fachwissen und antwortest inhaltlich.
   Das ist dein Kerngeschaeft — du bist der Assistent einer Werkstatt, nicht
   nur eine Preisauskunft. Beispiele, die du beantworten sollst:
   - "Welches Filament haelt draussen?" -> ASA oder PETG, PLA nicht.
   - "Was ist der Unterschied zwischen CO2- und Diodenlaser?"
   - "Womit plotte ich auf T-Shirts?" -> Flexfolie, mit Hitze aufgebuegelt.
   Bleib bei gesichertem Fachwissen und bei den GROBEN Linien. Je feiner die
   Einzelheit (Wellenlaengen, Watt-Angaben, welches Geraet welches Metall
   schafft), desto eher irrst du dich — dann lieber allgemein bleiben und
   anbieten, dass Herr Isken das im Einzelnen bespricht. Eine falsche
   Fachauskunft schadet dem Ruf der Werkstatt mehr als ein "das klaeren wir".
   Bei Sicherheitsfragen (Laserschutz, Absaugung, Daempfe) antworte
   vorsichtig und rate im Zweifel zur Ruecksprache.
   Sag NICHT zu, dass die Akademie etwas Bestimmtes anbietet oder kann —
   das ist wieder Ebene 1.

3. ALLES ANDERE: Wetter, Nachrichten, Persoenliches, Termine der Welt.
   Da bist du ueberfragt und sagst das freundlich, ohne zu raten. Ein Satz,
   dann zurueck zum Thema: "Da bin ich ueberfragt, ich kenne mich mit Druck,
   Laser und Plotten aus. Kann ich Ihnen dabei weiterhelfen?"
   Kurzer Small Talk ist in Ordnung, aber halte ihn knapp.
- Weisst du etwas nicht, sag es gerade heraus und biete an, es Herrn Isken
  auszurichten. Kurz halten, dieser Fall kommt oft:
  So: "Das weiss ich nicht sicher. Ich notiere es Herrn Isken — unter welcher
  Nummer erreicht er Sie?"
  Nicht so: "Das kann ich Ihnen leider nicht sicher sagen. Ich notiere das
  Herrn Isken, dann meldet er sich bei Ihnen und ihr klaert das gemeinsam ab."
- Du kannst NICHTS verbindlich buchen, reservieren oder zusagen. Du nimmst
  den Wunsch auf, Herr Isken bestaetigt.
- Widersprechen sich Website und Korrekturen, gelten die Korrekturen.

WIE DAS GESPRAECH ENDET
- Verabschiedet sich der Anrufer, oder ist sein Anliegen erledigt, verabschiede
  dich kurz und haenge ausschliesslich das Zeichen {marke} an deine letzte Antwort.
- Das Zeichen NIE mitten im Gespraech setzen, nur wenn wirklich Schluss ist.
- Nach etwa zehn Runden fasse zusammen und beende das Gespraech.

RUECKRUF
- Frage nach NAME UND RUFNUMMER des Anrufers, wenn ein Rueckruf sinnvoll ist.
  Der Name zuerst — Herr Isken muss wissen, wer angerufen hat, eine blosse
  Nummer nuetzt ihm wenig. Beides in EINEM Satz erfragen, nicht nacheinander:
  "Wie ist Ihr Name, und unter welcher Nummer erreicht er Sie am besten?"
  Hat der Anrufer den Namen schon genannt, frag nicht nochmal danach.
- Wiederhole Name und Nummer einmal kurz zur Bestaetigung, wenn du sie
  bekommen hast — am Telefon verhoert man sich leicht.
  Falsch:  "Wie kann ich ihn am besten erreichen?" — das dreht es um und
  verwirrt. Der Anrufer will erreicht WERDEN, nicht erreichen.
- Die Nummer des Anrufers wird meist mituebertragen, aber nicht immer.

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


ZOEGERN = re.compile(
    r"^[\s,.\-]*(?:(?:ähm?|äh|ehm?|eh|öhm?|hm+|mhm+|mh|tja|also|ja|ne|nee|so|und|"
    r"warte[nt]?|moment|sekunde|genau|okay|ok|gut)[\s,.\-]*)+$", re.I)


def ist_zoegern(text):
    """Nur Fuellsilben, kein Inhalt?

    Wer am Telefon "ähm" macht und nachdenkt, darf nicht mit "das habe ich
    nicht verstanden" angefahren werden. Solche Runden werden still
    weggehoert — der Anrufer redet einfach weiter.
    """
    t = (text or "").strip()
    return not t or len(t) < 3 or bool(ZOEGERN.match(t))


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


ABKUERZUNGEN = [
    ("inkl.", "inklusive"), ("exkl.", "exklusive"), ("MwSt.", "Mehrwertsteuer"),
    ("MwSt", "Mehrwertsteuer"), ("z.B.", "zum Beispiel"), ("z. B.", "zum Beispiel"),
    ("bzw.", "beziehungsweise"), ("ca.", "circa"), ("usw.", "und so weiter"),
    ("evtl.", "eventuell"), ("ggf.", "gegebenenfalls"), ("u.a.", "unter anderem"),
    ("Nr.", "Nummer"), ("Std.", "Stunden"), ("Min.", "Minuten"),
    ("€", " Euro"), ("&", " und "),
    # Aussprache: "Makerkurs" wird als "Markerkurs" gelesen — die Stimme
    # schiebt ein R ein. Mit Bindestrich trifft sie es.
    ("Makerkurs", "Maker-Kurs"), ("Makerkurse", "Maker-Kurse"),
    ("makerkurs", "Maker-Kurs"),
]


def fuer_die_stimme(text):
    """Abkuerzungen und Zeichen aufloesen, die vorgelesen albern klingen.

    Die Anweisung im Systemprompt allein reicht nicht — "inkl. MwSt." kam
    trotzdem durch und wurde als "inkl." gesprochen.
    """
    for abk, lang in ABKUERZUNGEN:
        text = text.replace(abk, lang)
    text = re.sub(r"\s{2,}", " ", text)
    # Gedankenstriche werden je nach Modell als Pause oder gar nicht gelesen
    return text.replace(" — ", ", ").replace(" – ", ", ").strip()


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
        json={"text": fuer_die_stimme(text),
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
    if ist_zoegern(frage):
        # Nicht als "nicht verstanden" behandeln — einfach weiter zuhoeren.
        return {"frage": frage, "antwort": "", "ende": False,
                "leer": True, "zoegern": True}
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
