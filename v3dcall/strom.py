"""Gespraech im Datenstrom — der fluessige Weg.

Statt Runde fuer Runde Dateien herumzureichen (aufnehmen bis 2 s Stille ->
Whisper -> Claude -> ElevenLabs -> abspielen) laeuft hier alles gleichzeitig:

  Asterisk --AudioSocket--> Silero (Sprechpausen) + Scribe (Echtzeit-Text)
           <--20-ms-Takt--- ElevenLabs (je Satz gestreamt) <-- Claude (gestreamt)

Das Satzende gilt nach ~0,6 s Pause statt nach starren 2 s, der erste Satz
wird gesprochen, waehrend Claude noch am zweiten schreibt, und wer dem
Assistenten ins Wort faellt, bringt ihn zum Schweigen.

Einstieg: das AGI-Skript meldet den Anruf ueber /api/strom/anmelden an und
uebergibt ihn per `EXEC AudioSocket <uuid>,127.0.0.1:<port>` hierher. Die
Mitschrift landet in dialog._gespraeche und die Aufnahmen als
{cid}-rN.wav im Spool — genau dort, wo pipeline.py sie nach dem Auflegen
fuer die E-Mail einsammelt. Am Mail-Weg aendert sich also nichts.

AudioSocket-Protokoll (Asterisk 18): je Paket 1 Byte Art, 2 Byte Laenge
(big endian), Nutzlast. 0x00 Auflegen, 0x01 UUID (16 Byte), 0x10 Ton
(slin, 8 kHz, 16 bit mono), 0xff Fehler.
"""
import asyncio
import base64
import glob
import json
import logging
import os
import random
import re
import threading
import time
import uuid
import wave

import aiohttp
import numpy as np

import core
import dialog
import tts

log = logging.getLogger("strom")

SPOOL = dialog.SPOOL
RATE = 8000
FRAME = 320                      # Bytes je 20 ms
ZEITEN = os.path.join(core.DATA, "strom-zeiten.jsonl")

ART_AUFLEGEN, ART_UUID, ART_TON, ART_FEHLER = 0x00, 0x01, 0x10, 0xFF


def einstellungen():
    """Alle Stellschrauben an einer Stelle; einmal je Anruf gelesen."""
    s = core.cfg("dialog", "strom", default={}) or {}
    d = {
        "aktiv": False,
        "port": 18786,              # 8796 ist schon vergeben
        # Pause, nach der ein Satz als beendet gilt. Laenger, wenn der Satz
        # hoerbar offen ist ("... und", "..., also").
        "endpunktMs": 600,
        "endpunktOffenMs": 1300,
        # So lange muss der Anrufer sprechen, bis der Assistent verstummt.
        # Kuerzer faengt jedes "mhm" und Echo, laenger wirkt stur.
        "unterbrechenMs": 450,
        # Kommt bis dahin kein Ton, ein kurzes "Okay." — nur bei laengeren
        # Aeusserungen, eine Rueckfrage mit einem Wort braucht das nicht.
        # Nicht zu knapp: die Antwort kommt meist nach ~2 s, ein Fuellwort
        # kurz davor schiebt sie um seine eigene Laenge nach hinten.
        "fuellerMs": 2600,
        "stilleNachfrageS": 8,
        "gainDb": 0.0,
        "sttModell": "scribe_v2_realtime",
    }
    d.update({k: v for k, v in s.items() if v is not None})
    return d


# ------------------------------------------------------------ Anmeldungen

_anmeldungen = {}                 # uuid -> {cid, nummer, ergebnis, t}
_anm_lock = threading.Lock()
_laeuft = {"port": None}


def anmelden(cid, nummer):
    """Vom AGI-Skript aufgerufen, bevor es den Anruf herueberreicht."""
    e = einstellungen()
    if not e["aktiv"] or not _laeuft["port"]:
        return None
    u = str(uuid.uuid4())
    with _anm_lock:
        jetzt = time.time()
        for k in [k for k, v in _anmeldungen.items() if jetzt - v["t"] > 3600]:
            _anmeldungen.pop(k, None)
        _anmeldungen[u] = {"cid": cid, "nummer": nummer,
                           "ergebnis": "angemeldet", "t": jetzt}
    return {"uuid": u, "port": _laeuft["port"]}


def ergebnis(u):
    with _anm_lock:
        return (_anmeldungen.get(u) or {}).get("ergebnis", "unbekannt")


def _setze_ergebnis(u, wert):
    with _anm_lock:
        if u in _anmeldungen:
            _anmeldungen[u]["ergebnis"] = wert


# --------------------------------------------------------------- Bausteine

class Vad:
    """Silero-Sprachwahrscheinlichkeit, fortlaufend ueber den ganzen Anruf.

    Die Hilfsklasse von faster-whisper setzt den inneren Zustand bei jedem
    Aufruf zurueck — fuer 20-ms-Happen taugt das nicht. Darum dasselbe
    Modell, aber mit durchgereichtem Zustand. Das Modell will 16 kHz in
    512er-Fenstern; das Telefon liefert 8 kHz, also verdoppeln.
    """
    _sitzung = None

    @classmethod
    def modell(cls):
        if cls._sitzung is None:
            import onnxruntime
            from faster_whisper.vad import get_assets_path
            o = onnxruntime.SessionOptions()
            o.inter_op_num_threads = 1
            o.intra_op_num_threads = 1
            o.log_severity_level = 4
            cls._sitzung = onnxruntime.InferenceSession(
                os.path.join(get_assets_path(), "silero_vad_v6.onnx"),
                providers=["CPUExecutionProvider"], sess_options=o)
        return cls._sitzung

    def __init__(self):
        self.h = np.zeros((1, 1, 128), dtype=np.float32)
        self.c = np.zeros((1, 1, 128), dtype=np.float32)
        self.kontext = np.zeros(64, dtype=np.float32)
        self.puffer = np.zeros(0, dtype=np.float32)
        self.p = 0.0

    def __call__(self, pcm):
        x = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
        if not len(x):
            return self.p
        hoch = np.interp(np.arange(len(x) * 2) / 2.0, np.arange(len(x)), x)
        self.puffer = np.concatenate([self.puffer, hoch.astype(np.float32)])
        while len(self.puffer) >= 512:
            stueck, self.puffer = self.puffer[:512], self.puffer[512:]
            ein = np.concatenate([self.kontext, stueck])[None, :]
            out, self.h, self.c = self.modell().run(
                None, {"input": ein, "h": self.h, "c": self.c})
            self.kontext = stueck[-64:]
            self.p = float(np.ravel(out)[0])
        return self.p


def lies_wav(pfad):
    """8-kHz-Ansage als rohes slin, oder b"" wenn es sie nicht gibt."""
    try:
        with wave.open(pfad) as w:
            if w.getframerate() != RATE or w.getsampwidth() != 2 or w.getnchannels() != 1:
                log.warning("Ansage %s hat falsches Format", pfad)
                return b""
            return w.readframes(w.getnframes())
    except Exception:
        return b""


def schreibe_wav(pfad, pcm):
    try:
        with wave.open(pfad, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(pcm)
    except Exception:
        log.exception("Aufnahme %s nicht geschrieben", pfad)


def ansage(name):
    return lies_wav(os.path.join(core.SOUNDS, name + ".wav"))


def zufall_ansage(muster):
    da = sorted(glob.glob(os.path.join(core.SOUNDS, muster + ".wav")))
    return lies_wav(random.choice(da)) if da else b""


def verstaerke(pcm, db):
    if not db:
        return pcm
    x = np.frombuffer(pcm, dtype="<i2").astype(np.float32) * (10 ** (db / 20))
    # weicher Begrenzer statt hartem Abschneiden
    x = np.tanh(x / 32768.0 * 1.2) / np.tanh(1.2) * 32767.0
    return x.astype("<i2").tobytes()


# Satzgrenzen im gestreamten Text. Nicht trennen nach Zahlen ("8. Oktober",
# "8.09.") und gaengigen Abkuerzungen — dort macht die Stimme sonst eine
# Pause mitten im Satz.
_ABK = {"z.b", "b", "ca", "bzw", "inkl", "exkl", "nr", "usw", "evtl", "ggf",
        "u.a", "d.h", "dr", "hr", "fr", "st", "std", "min", "mwst", "tel", "vgl"}


def naechster_satz(puffer, mindest=12, erster=False):
    """(satz, rest) sobald ein Satz abgeschlossen ist, sonst (None, puffer).

    Beim ersten Satz einer Antwort darf auch ein Komma trennen, wenn schon
    genug Text dasteht — der Anrufer wartet genau auf diesen Anfang."""
    for m in re.finditer(r"[.!?…:](?=\s)", puffer):
        i = m.end()
        if i < mindest:
            continue
        vorher = puffer[:m.start()]
        wort = re.search(r"([\w.]+)$", vorher)
        if m.group() == "." and wort:
            w = wort.group(1).lower()
            if w in _ABK or w[-1:].isdigit():
                continue
        return puffer[:i].strip(), puffer[i:]
    if erster and len(puffer) >= 45:
        k = puffer.rfind(", ", 30)
        if k > 0 and not re.search(r"\d$", puffer[:k]):
            return puffer[:k + 1].strip(), puffer[k + 1:]
    return None, puffer


# Hoerbar offene Satzenden — hier holt der Anrufer nur Luft.
OFFEN = re.compile(r"(?:,|\b(?:und|oder|aber|also|weil|dass|ob|wenn|der|die|das|"
                   r"ein|eine|einen|mit|fuer|für|von|zum|zur|ich|wir|ähm|äh|ehm)"
                   r")\s*$", re.I)


# ------------------------------------------------------------- Zuhoerer

class Scribe:
    """ElevenLabs Echtzeit-Erkennung. Commit von Hand: wann ein Satz zu Ende
    ist, entscheidet unser eigener Silero, damit Unterbrechen und Satzende
    auf derselben Grundlage stehen."""

    def __init__(self, sitzung, e):
        self.sitzung = sitzung
        self.e = e
        self.ws = None
        self.teil = ""                       # Zwischenstand seit dem letzten Commit
        self.wartend = []                    # Futures fuer ausstehende Commits
        self.verwaist = 0
        self.kaputt = False
        self._leser = None

    async def verbinde(self):
        if self.e["sttModell"] in ("whisper", "lokal"):
            # Ohne ElevenLabs: gar nicht erst versuchen, jede Runde geht an
            # das lokale Whisper (dialog.hoere) — langsamer, aber kostenlos.
            log.info("Spracherkennung lokal (Whisper), Scribe abgeschaltet")
            self.kaputt = True
            return False
        url = ("wss://api.elevenlabs.io/v1/speech-to-text/realtime"
               f"?model_id={self.e['sttModell']}&audio_format=pcm_8000"
               "&language_code=de&commit_strategy=manual&enable_logging=false")
        try:
            self.ws = await self.sitzung.ws_connect(
                url, headers={"xi-api-key": core.cfg("elevenlabs", "apiKey")},
                heartbeat=15, timeout=aiohttp.ClientWSTimeout(ws_close=5))
            m = await asyncio.wait_for(self.ws.receive_json(), 5)
            if m.get("message_type") != "session_started":
                raise RuntimeError(f"Scribe: {m}")
            self._leser = asyncio.create_task(self._lies())
            return True
        except Exception as ex:
            log.warning("Scribe nicht erreichbar, nehme Whisper: %s", ex)
            self.kaputt = True
            return False

    async def _lies(self):
        try:
            async for msg in self.ws:
                if msg.type != aiohttp.WSMsgType.TEXT:
                    continue
                d = json.loads(msg.data)
                art = d.get("message_type")
                if art == "partial_transcript":
                    self.teil = d.get("text", "")
                elif art == "committed_transcript":
                    if self.verwaist:
                        self.verwaist -= 1
                        continue
                    if self.wartend:
                        f = self.wartend.pop(0)
                        if not f.done():
                            f.set_result(d.get("text", ""))
                elif art == "warning":
                    log.info("Scribe-Hinweis: %s", d)
                elif art and art.endswith("error") or art in (
                        "quota_exceeded", "rate_limited", "chunk_size_exceeded"):
                    log.warning("Scribe meldet %s: %s", art, d.get("error"))
                    if art in ("auth_error", "quota_exceeded"):
                        self.kaputt = True
        except Exception as ex:
            log.warning("Scribe-Verbindung weg: %s", ex)
        else:
            log.warning("Scribe hat die Verbindung geschlossen (Code %s)",
                        self.ws.close_code)
        self.kaputt = True
        for f in self.wartend:
            if not f.done():
                f.set_result(None)
        self.wartend.clear()

    async def ton(self, pcm):
        if self.kaputt or not self.ws:
            return
        try:
            await self.ws.send_json({"message_type": "input_audio_chunk",
                                     "audio_base_64": base64.b64encode(pcm).decode(),
                                     "commit": False, "sample_rate": RATE})
        except Exception as ex:
            log.warning("Scribe: Senden gescheitert: %r", ex)
            self.kaputt = True

    async def commit(self, frist=1.5):
        """Satz abschliessen -> Endtext (None = hat nicht geklappt)."""
        if self.kaputt or not self.ws:
            log.info("Scribe nicht verfuegbar -> Whisper")
            return None
        f = asyncio.get_running_loop().create_future()
        self.wartend.append(f)
        try:
            await self.ws.send_json({"message_type": "input_audio_chunk",
                                     "audio_base_64": "", "commit": True,
                                     "sample_rate": RATE})
            text = await asyncio.wait_for(asyncio.shield(f), frist)
        except asyncio.TimeoutError:
            log.warning("Scribe: kein Endtext nach %.1f s, nehme Zwischenstand", frist)
            # Kommt er doch noch, gehoert er zu diesem Satz — nicht zum naechsten.
            if f in self.wartend:
                self.wartend.remove(f)
                self.verwaist += 1
            text = self.teil or None
        except Exception as ex:
            log.warning("Scribe: Commit gescheitert: %r", ex)
            text = None
        self.teil = ""
        return text

    async def schliesse(self):
        try:
            if self.ws:
                await self.ws.close()
        except Exception:
            pass
        if self._leser:
            self._leser.cancel()


# -------------------------------------------------------------- Sprecher

class Sprecher:
    """Spielt Ton im 20-ms-Takt in den Anruf. Asterisk reicht jedes Paket
    sofort als RTP weiter; wer schneller schickt, bekommt Knackser. Ein
    kleiner Vorlauf (60 ms) glaettet Schwankungen der eigenen Schleife."""

    VORLAUF = 0.06

    def __init__(self, schreiber):
        self.w = schreiber
        self.q = asyncio.Queue()
        self.gesprochen = []                 # Saetze, die ganz zu hoeren waren
        self.laufend = None                  # Satz, der gerade zu hoeren ist
        self.ende_bis = 0.0                  # wann der letzte Ton verklingt
        self.erster_ton = None               # erstes Paket seit neu()
        self._gen = 0                        # stopp() zaehlt hoch -> Rest verwerfen
        self._rest = b""
        self._aufgabe = asyncio.create_task(self._lauf())

    def spielt(self):
        return not self.q.empty() or time.monotonic() < self.ende_bis

    def neu(self):
        self.gesprochen = []
        self.laufend = None
        self.erster_ton = None

    def was_zu_hoeren_war(self):
        teile = list(self.gesprochen)
        if self.laufend:
            teile.append(self.laufend.rstrip(".!?") + " …")
        return " ".join(teile)

    def satz_beginn(self, text):
        self.q.put_nowait((self._gen, "beginn", text))

    def ton(self, pcm):
        if pcm:
            self.q.put_nowait((self._gen, "ton", pcm))

    def satz_fertig(self, text):
        self.q.put_nowait((self._gen, "satz", text))

    def stopp(self):
        self._gen += 1
        while not self.q.empty():
            try:
                self.q.get_nowait()
            except asyncio.QueueEmpty:
                break
        self._rest = b""
        self.ende_bis = time.monotonic()

    async def fertig(self):
        """Warten, bis alles gesagt ist."""
        while self.spielt():
            await asyncio.sleep(0.02)

    async def _lauf(self):
        takt = time.monotonic()
        while True:
            gen, art, daten = await self.q.get()
            if gen != self._gen:
                continue
            if art == "beginn":
                self.laufend = daten
                continue
            if art == "satz":
                self.gesprochen.append(daten)
                self.laufend = None
                continue
            daten = self._rest + daten
            n = len(daten) - len(daten) % FRAME
            self._rest = daten[n:]
            for i in range(0, n, FRAME):
                jetzt = time.monotonic()
                if takt < jetzt:
                    takt = jetzt           # Luecke: neu einsetzen statt nachholen
                warte = takt - jetzt - self.VORLAUF
                if warte > 0:
                    await asyncio.sleep(warte)
                if gen != self._gen:       # waehrenddessen gestoppt
                    break
                try:
                    self.w.write(bytes([ART_TON]) + FRAME.to_bytes(2, "big")
                                 + daten[i:i + FRAME])
                except Exception:
                    return
                if self.erster_ton is None:
                    self.erster_ton = time.monotonic()
                takt += 0.02
                self.ende_bis = takt


# -------------------------------------------------------------- Ein Anruf

class Anruf:
    def __init__(self, reader, writer, sitzung):
        self.r, self.w = reader, writer
        self.sitzung = sitzung
        self.e = einstellungen()
        self.u = None
        self.cid = None
        self.nummer = None
        self.aufgelegt = False
        self.vad = Vad()
        self.sprecher = None
        self.stt = None
        # Zuhoeren
        self.vorlauf = []                    # letzte ~300 ms vor dem Sprechbeginn
        self.satz_pcm = []                   # Ton der laufenden Aeusserung
        self.im_satz = False
        self.sprache_ms = 0                  # zusammenhaengend gesprochen
        self.stille_ms = 0
        self.satz_ms = 0
        self.runde = 0
        self.antworten = 0
        self.ereignis = asyncio.Queue()      # ("satz", pcm, ms) / ("unterbrochen",)
        self.antwort_laeuft = False
        self.antwort_ton = None
        self.mitschnitt = None               # Anrufbeantworter: alles mitschneiden
        self.denk_abbruch = False
        self.zuletzt_gehoert = time.monotonic()

    # ---------------------------------------------------------- Empfang
    async def paket(self):
        kopf = await self.r.readexactly(3)
        n = int.from_bytes(kopf[1:3], "big")
        return kopf[0], (await self.r.readexactly(n) if n else b"")

    async def empfang(self):
        """Liest den Ton des Anrufers und entscheidet Satzende/Unterbrechen."""
        try:
            while True:
                art, daten = await self.paket()
                if art == ART_TON:
                    await self._ton(daten)
                elif art in (ART_AUFLEGEN, ART_FEHLER):
                    break
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        self.aufgelegt = True
        self.ereignis.put_nowait(("aufgelegt",))

    async def _ton(self, pcm):
        e = self.e
        if self.mitschnitt is not None:
            self.mitschnitt.append(pcm)
        p = self.vad(pcm)
        spricht = p > 0.5 or (self.im_satz and p > 0.35)
        wir_reden = self.sprecher.spielt() or self.antwort_laeuft

        if spricht:
            self.sprache_ms += 20
            self.stille_ms = 0
        else:
            self.sprache_ms = 0
            self.stille_ms += 20

        if not self.im_satz:
            self.vorlauf.append(pcm)
            if len(self.vorlauf) > 15:
                self.vorlauf.pop(0)
            # Waehrend wir reden, nur echte Einwuerfe durchlassen
            schwelle = e["unterbrechenMs"] if wir_reden else 120
            if self.sprache_ms >= schwelle:
                self.im_satz = True
                self.satz_pcm = list(self.vorlauf)
                self.satz_ms = 20 * len(self.vorlauf)
                self.vorlauf = []
                for v in self.satz_pcm:
                    await self.stt.ton(v)
                if wir_reden:
                    self.ereignis.put_nowait(("unterbrochen",))
            elif not wir_reden:
                await self.stt.ton(pcm)       # Stille gehoert zum Takt der Erkennung
            else:
                # Waehrend wir reden: digitale Stille statt Anrufer-Ton. Scribe
                # schliesst nach ~15 s ohne Daten die Verbindung (Code 1000),
                # und ein gemurmeltes "mhm" soll nicht in den naechsten Satz.
                await self.stt.ton(bytes(len(pcm)))
            return

        self.satz_pcm.append(pcm)
        self.satz_ms += 20
        await self.stt.ton(pcm)
        grenze = e["endpunktOffenMs"] if OFFEN.search(self.stt.teil or "") else e["endpunktMs"]
        if self.stille_ms >= grenze or self.satz_ms > 30000:
            self.im_satz = False
            self.zuletzt_gehoert = time.monotonic()
            self.ereignis.put_nowait(("satz", b"".join(self.satz_pcm), self.satz_ms))
            self.satz_pcm = []

    # ----------------------------------------------------------- Ablauf
    async def los(self):
        art, daten = await self.paket()
        if art != ART_UUID or len(daten) != 16:
            log.warning("AudioSocket ohne UUID (%s)", art)
            return
        self.u = str(uuid.UUID(bytes=daten))
        with _anm_lock:
            a = _anmeldungen.get(self.u)
        if not a:
            log.warning("Unbekannte Anruf-UUID %s", self.u)
            return
        self.cid, self.nummer = a["cid"], a["nummer"]
        _setze_ergebnis(self.u, "laeuft")
        log.info("Anruf %s (%s) im Datenstrom", self.cid, self.nummer or "ohne Nummer")

        self.sprecher = Sprecher(self.w)
        self.stt = Scribe(self.sitzung, self.e)
        loop = asyncio.get_running_loop()
        # Waehrend die Begruessung laeuft: Zwischenspeicher fuellen, Erkennung verbinden
        loop.run_in_executor(None, dialog.vorwaermen)
        asyncio.create_task(_elevenlabs_anwaermen(self.sitzung))
        verbunden = asyncio.create_task(self.stt.verbinde())
        empfang = asyncio.create_task(self.empfang())
        try:
            gruss = zufall_ansage("gruss[0-9]") or ansage("dialog-begruessung")
            self.sprecher.ton(gruss)
            await verbunden
            ende = await self.gespraech()
            _setze_ergebnis(self.u, "ende" if ende else "aufgelegt")
            if not self.aufgelegt:
                self.sprecher.ton(ansage("danke"))
                await self.sprecher.fertig()
                await asyncio.sleep(0.3)
        except Exception:
            log.exception("Datenstrom-Gespraech %s gescheitert", self.cid)
            _setze_ergebnis(self.u, "fehler")
            if not self.aufgelegt:
                await self.anrufbeantworter()
        finally:
            log.info("Anruf %s endet (%s)", self.cid, ergebnis(self.u))
            empfang.cancel()
            try:
                await asyncio.wait_for(self.stt.schliesse(), 3)
            except Exception:
                pass
            try:
                self.w.write(bytes([ART_AUFLEGEN, 0, 0]))
                await self.w.drain()
                self.w.close()
            except Exception:
                pass

    async def gespraech(self):
        """Liefert True, wenn das Gespraech ordentlich zu Ende ging."""
        e = self.e
        max_runden = core.cfg("dialog", "maxRunden", default=12)
        nachfragen = 0
        offen = ""                           # Satzanfang, falls der Anrufer weitersprach
        while True:
            try:
                ev = await asyncio.wait_for(self.ereignis.get(), 0.5)
            except asyncio.TimeoutError:
                if self.aufgelegt:
                    return False
                # Niemand spricht — nach einer Weile freundlich nachfragen
                if (not self.sprecher.spielt() and not self.im_satz
                        and time.monotonic() - max(self.zuletzt_gehoert,
                                                   self.sprecher.ende_bis) > e["stilleNachfrageS"]):
                    nachfragen += 1
                    if nachfragen >= 3:
                        return True
                    self.sprecher.ton(ansage("nachfrage"))
                    self.zuletzt_gehoert = time.monotonic()
                continue

            if ev[0] == "aufgelegt":
                return False
            if ev[0] == "unterbrochen":
                # Einwurf waehrend Begruessung/Nachfrage: Ansage abbrechen
                self.sprecher.stopp()
                continue
            _, pcm, ms = ev
            t_ende = time.monotonic()
            self.runde += 1
            schreibe_wav(os.path.join(SPOOL, f"{self.cid}-r{self.runde}.wav"), pcm)

            text = await self.stt.commit()
            t_text = time.monotonic()
            if text is None:
                text = await asyncio.get_running_loop().run_in_executor(
                    None, dialog.hoere, os.path.join(SPOOL, f"{self.cid}-r{self.runde}.wav"))
            text = (text or "").strip()
            if dialog.ist_zoegern(text):
                # Nur "aehm" — weiter zuhoeren, nichts sagen.
                if text:
                    offen = (offen + " " + text).strip()
                continue
            nachfragen = 0
            frage = (offen + " " + text).strip()
            offen = ""
            log.info("Runde %d: %s", self.runde, frage[:100])

            erg = await self.antworte(frage, ms, t_ende)
            erg.update(runde=self.runde, cid=self.cid, sprechMs=ms,
                       textMs=round((t_text - t_ende) * 1000))
            self._zeiten(erg)
            if erg.get("weitergesprochen"):
                # Der Anrufer war noch nicht fertig: Antwort verworfen, der
                # bisherige Satz wird dem naechsten vorangestellt.
                offen = frage
                continue
            self.antworten += 1
            if erg.get("ende") or self.antworten >= max_runden:
                await self.sprecher.fertig()
                return True
            if self.aufgelegt:
                return False

    async def antworte(self, frage, ms, t_ende):
        """Claude streamen, Satz fuer Satz sprechen. Faellt der Anrufer ins
        Wort, sofort still sein."""
        loop = asyncio.get_running_loop()
        texte = asyncio.Queue()
        self.denk_abbruch = False
        self.antwort_laeuft = True
        self.sprecher.neu()
        t = {"ersterSatzMs": None}
        self.antwort_ton = None               # erster Ton der ANTWORT, nicht des Fuellworts

        def stueck(d):
            loop.call_soon_threadsafe(texte.put_nowait, d)

        denken = loop.run_in_executor(
            None, lambda: dialog.denke_strom(self.cid, frage, self.nummer,
                                             stueck=stueck,
                                             abbruch=lambda: self.denk_abbruch))
        denken.add_done_callback(lambda f: loop.call_soon_threadsafe(texte.put_nowait, None))

        async def sprich_saetze():
            puffer, vorher = "", ""
            while True:
                d = await texte.get()
                if d is None:
                    satz, puffer = puffer.strip(), ""
                    if satz:
                        await self.sage(satz, vorher)
                    return
                puffer += d
                while True:
                    satz, puffer = naechster_satz(puffer, erster=not vorher)
                    if not satz:
                        break
                    if t["ersterSatzMs"] is None:
                        t["ersterSatzMs"] = round((time.monotonic() - t_ende) * 1000)
                    await self.sage(satz, vorher)
                    vorher = (vorher + " " + satz)[-300:]

        async def fueller():
            await asyncio.sleep(self.e["fuellerMs"] / 1000)
            if self.antwort_ton is None and not self.denk_abbruch and ms > 1500:
                self.sprecher.ton(zufall_ansage("dank[0-9]") if self.runde == 1
                                  else zufall_ansage("kurz[0-9]"))

        async def sprich_und_warte():
            await sprich_saetze()
            # Erst wenn der letzte Ton verklungen ist, ist die Antwort durch —
            # bis dahin kann der Anrufer noch ins Wort fallen.
            await self.sprecher.fertig()

        sprecher_aufgabe = asyncio.create_task(sprich_und_warte())
        fueller_aufgabe = asyncio.create_task(fueller())
        ergebnis = {"unterbrochen": False}
        try:
            while not sprecher_aufgabe.done():
                ev_aufgabe = asyncio.create_task(self.ereignis.get())
                fertig, _ = await asyncio.wait({sprecher_aufgabe, ev_aufgabe},
                                               return_when=asyncio.FIRST_COMPLETED)
                if ev_aufgabe not in fertig:
                    ev_aufgabe.cancel()
                    try:
                        # Kam genau jetzt doch ein Ereignis, nicht verlieren
                        self.ereignis.put_nowait(await ev_aufgabe)
                    except asyncio.CancelledError:
                        pass
                    break
                ev = ev_aufgabe.result()
                if ev[0] == "aufgelegt":
                    self.ereignis.put_nowait(ev)
                    self.denk_abbruch = True
                    break
                if ev[0] == "unterbrochen":
                    self.denk_abbruch = True
                    self.sprecher.stopp()
                    ergebnis["unterbrochen"] = True
                    # Noch keine Antwort zu hoeren? Dann hat er nur weitergesprochen.
                    if self.antwort_ton is None:
                        ergebnis["weitergesprochen"] = True
                    break
                # ein neuer Satz waehrend der Antwort: gehoert in die Hauptschleife
                self.ereignis.put_nowait(ev)
        finally:
            fueller_aufgabe.cancel()
            if not sprecher_aufgabe.done():
                sprecher_aufgabe.cancel()

        try:
            text, ende = await denken
        except Exception:
            self.antwort_laeuft = False
            raise
        self.antwort_laeuft = False
        if ergebnis.get("weitergesprochen"):
            dialog.nimm_letzte_runde_zurueck(self.cid)
        elif ergebnis["unterbrochen"]:
            dialog.kuerze_letzte_antwort(self.cid, self.sprecher.was_zu_hoeren_war())
            ende = False
        erster = self.sprecher.erster_ton
        ergebnis.update(ende=ende, antwort=text[:200],
                        ersterSatzMs=t["ersterSatzMs"],
                        ersterTonMs=round((erster - t_ende) * 1000) if erster else None,
                        antwortTonMs=round((self.antwort_ton - t_ende) * 1000)
                        if self.antwort_ton else None)
        return ergebnis

    async def sage(self, satz, vorher=""):
        """Einen Satz ueber ElevenLabs sprechen, der Ton geht stueckweise
        direkt in den Anruf."""
        if self.denk_abbruch:
            return
        satz = satz.replace(dialog.ENDE_MARKE, "").strip()
        gesprochen = dialog.fuer_die_stimme(satz)
        if not gesprochen:
            return
        if tts.anbieter("live") == "voicestudio":
            await self._sage_lokal(satz, gesprochen, vorher)
            return
        v = core.cfg("elevenlabs", "voiceId")
        koerper = {"text": gesprochen,
                   "model_id": core.cfg("dialog", "ttsModel", default="eleven_turbo_v2_5"),
                   "voice_settings": {"stability": 0.4, "similarity_boost": 0.75,
                                      "speed": core.cfg("elevenlabs", "speed", default=1.0)}}
        if vorher:
            koerper["previous_text"] = dialog.fuer_die_stimme(vorher)
        async with self.sitzung.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{v}/stream"
                f"?output_format=pcm_8000&optimize_streaming_latency=3",
                json=koerper, headers={"xi-api-key": core.cfg("elevenlabs", "apiKey")},
                timeout=aiohttp.ClientTimeout(total=30)) as r:
            if r.status != 200:
                raise RuntimeError(f"ElevenLabs {r.status}: {(await r.text())[:200]}")
            self.sprecher.satz_beginn(satz)
            # Jeder Satz kommt einzeln von ElevenLabs und endet praktisch ohne
            # Nachlauf — direkt aneinandergehaengt klang es, als fehlten alle
            # Punkte. Darum vor jedem Folgesatz Stille einschieben; nach einem
            # Komma (der erste Satz darf dort trennen) nur eine kurze.
            self._satzpause(vorher)
            rest = b""
            async for happen in r.content.iter_chunked(1600):
                if self.denk_abbruch:
                    return
                happen = rest + happen
                n = len(happen) - len(happen) % 2
                rest = happen[n:]
                if n and self.antwort_ton is None:
                    self.antwort_ton = time.monotonic()
                self.sprecher.ton(verstaerke(happen[:n], self.e["gainDb"]))
        self.sprecher.satz_fertig(satz)

    def _satzpause(self, vorher):
        if vorher:
            ms = core.cfg("dialog", "satzpauseMs", default=450)
            if not vorher.rstrip().endswith((".", "!", "?")):
                ms //= 3
            self.sprecher.ton(b"\0\0" * (RATE * ms // 1000))

    async def _sage_lokal(self, satz, gesprochen, vorher):
        """Wie sage(), aber ueber VoiceStudio: der Satz kommt am Stueck
        (kein Streaming), wird auf 8 kHz und gleiche Lautheit gebracht und
        dann in den Anruf gegeben."""
        pcm = await asyncio.get_running_loop().run_in_executor(
            None, tts.voicestudio_pcm8k, gesprochen)
        if self.denk_abbruch:
            return
        self.sprecher.satz_beginn(satz)
        self._satzpause(vorher)
        if self.antwort_ton is None:
            self.antwort_ton = time.monotonic()
        self.sprecher.ton(verstaerke(pcm, self.e["gainDb"]))
        self.sprecher.satz_fertig(satz)

    async def anrufbeantworter(self):
        """Wenn das Gespraech nicht laeuft: Stoerungsansage, Ton, Nachricht
        aufnehmen — wie der klassische Anrufbeantworter."""
        self.denk_abbruch = True
        self.antwort_laeuft = False
        self.sprecher.stopp()
        self.sprecher.ton(ansage("stoerung") + ansage("beep"))
        await self.sprecher.fertig()
        self.runde += 1
        self.mitschnitt = []
        beginn, gesprochen = time.monotonic(), False
        while not self.aufgelegt and time.monotonic() - beginn < 180:
            await asyncio.sleep(0.1)
            gesprochen = gesprochen or self.im_satz
            if gesprochen and self.stille_ms >= 4000:
                break
            if not gesprochen and time.monotonic() - beginn > 15:
                break
        if self.mitschnitt:
            schreibe_wav(os.path.join(SPOOL, f"{self.cid}-r{self.runde}.wav"),
                         b"".join(self.mitschnitt))
        self.mitschnitt = None
        if not self.aufgelegt:
            self.sprecher.ton(ansage("danke"))
            await self.sprecher.fertig()

    def _zeiten(self, erg):
        erg["t"] = time.strftime("%Y-%m-%d %H:%M:%S")
        log.info("Zeiten Runde %s: Text %s ms, erster Satz %s ms, erster Ton %s ms%s",
                 erg.get("runde"), erg.get("textMs"), erg.get("ersterSatzMs"),
                 erg.get("ersterTonMs"), " (unterbrochen)" if erg.get("unterbrochen") else "")
        try:
            with open(ZEITEN, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(erg, ensure_ascii=False) + "\n")
        except Exception:
            pass


# -------------------------------------------------------------- Server

async def _elevenlabs_anwaermen(sitzung):
    try:
        async with sitzung.get("https://api.elevenlabs.io/v1/models",
                               headers={"xi-api-key": core.cfg("elevenlabs", "apiKey")},
                               timeout=aiohttp.ClientTimeout(total=10)) as r:
            await r.read()
    except Exception:
        pass


async def _server(port):
    # Verbindungen lange offen halten: aiohttp schliesst sie sonst nach 15 s
    # Leerlauf, und jeder neue TLS-Handschlag kostet den ersten Satz ~0,7 s.
    sitzung = aiohttp.ClientSession(
        connector=aiohttp.TCPConnector(keepalive_timeout=300))
    # Verbindung zu ElevenLabs schon mal aufbauen: der TLS-Handschlag kostete
    # im Test 0,7 s — beim ersten Satz des ersten Anrufs genau zu viel.
    await _elevenlabs_anwaermen(sitzung)
    Vad.modell()

    async def verbindung(reader, writer):
        await Anruf(reader, writer, sitzung).los()

    srv = await asyncio.start_server(verbindung, "127.0.0.1", port)
    _laeuft["port"] = port
    log.info("Datenstrom-Gespraech lauscht auf 127.0.0.1:%d", port)
    async with srv:
        await srv.serve_forever()


def starte(port=None):
    """Im Hintergrund starten (aus server.py)."""
    port = port or einstellungen()["port"]

    def lauf():
        try:
            asyncio.run(_server(port))
        except Exception:
            log.exception("Datenstrom-Server beendet")
            _laeuft["port"] = None

    threading.Thread(target=lauf, daemon=True, name="strom").start()
