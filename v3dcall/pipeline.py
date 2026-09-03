"""Aufnahme -> Text -> E-Mail -> Push."""
import json, os, smtplib, ssl, subprocess, threading, time, traceback
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid, parseaddr

import core

_modell = None
_modell_lock = threading.Lock()
_queue_lock = threading.Lock()


# ---------------------------------------------------------------- Transkript

def _get_modell():
    global _modell
    with _modell_lock:
        if _modell is None:
            from faster_whisper import WhisperModel
            _modell = WhisperModel(
                core.cfg("whisper", "model", default="medium"),
                device="cpu",
                compute_type=core.cfg("whisper", "compute", default="int8"),
                cpu_threads=max(2, (os.cpu_count() or 4) - 2))
        return _modell


def dauer(pfad):
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", pfad],
            capture_output=True, text=True, check=True).stdout.strip()
        return round(float(out), 1)
    except Exception:
        return 0.0


def transkribiere(pfad):
    """Aufnahme -> Text. Leise/leere Aufnahmen liefern einen leeren String."""
    segmente, _info = _get_modell().transcribe(
        pfad,
        language=core.cfg("whisper", "language", default="de"),
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 700},
        beam_size=5,
        condition_on_previous_text=False)
    return " ".join(s.text.strip() for s in segmente).strip()


# --------------------------------------------------------------------- Mail

def _wandle_mp3(wav):
    """Kleine mp3 fuers Postfach — 8-kHz-wav ist unnoetig gross."""
    mp3 = os.path.splitext(wav)[0] + ".mp3"
    try:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav,
                        "-codec:a", "libmp3lame", "-b:a", "48k", mp3], check=True)
        return mp3
    except Exception:
        return wav


def _nummer_lesbar(nummer):
    if not nummer:
        return "unbekannt (Rufnummer unterdrückt)"
    return nummer


def sende_mail(anruf):
    m = core.cfg("mail", default={}) or {}
    if not m.get("to") or not m.get("pass"):
        raise RuntimeError("Mail-Zugangsdaten unvollständig (mail.to / mail.pass)")

    wann = time.strftime("%d.%m.%Y um %H:%M Uhr", time.localtime(anruf["ts"]))
    nummer = _nummer_lesbar(anruf.get("caller"))
    text = (anruf.get("text") or "").strip()

    gespraech = "\nAnrufer:" in ("\n" + text) and "Assistent:" in text
    if gespraech:
        betreff = f"Gespräch mit {nummer}"
        koerper = (
            f"Anruf am {wann}\n"
            f"Von: {nummer}\n"
            f"Dauer: {anruf.get('seconds', 0):.0f} Sekunden\n"
            f"\n{'-' * 52}\n\n{text}\n\n{'-' * 52}\n\n"
            "Die Aufnahme der Anruferseite hängt an dieser E-Mail.\n")
        msg = EmailMessage()
        name, adresse = parseaddr(m.get("from") or m["user"])
        absender = adresse or m["user"]
        msg["From"] = formataddr((name or "V3D Anrufannahme", absender))
        msg["To"] = m["to"]
        msg["Subject"] = betreff
        msg["Date"] = formatdate(anruf["ts"], localtime=True)
        msg["Message-ID"] = make_msgid(domain=absender.rsplit("@", 1)[-1])
        msg.set_content(koerper)
        _haenge_audio_an(msg, m, anruf, wann)
        _versende(m, msg)
        return betreff

    if text:
        betreff = f"Neue Nachricht von {nummer}"
        koerper = (
            f"Anruf am {wann}\n"
            f"Von: {nummer}\n"
            + (f"Name: {anruf['name']}\n" if anruf.get("name") else "")
            + f"Länge: {anruf.get('seconds', 0):.0f} Sekunden\n"
            f"\n{'-' * 52}\n\n{text}\n\n{'-' * 52}\n\n"
            "Die Aufnahme hängt an dieser E-Mail.\n")
    else:
        betreff = f"Anruf von {nummer} — ohne Nachricht"
        koerper = (
            f"Anruf am {wann}\n"
            f"Von: {nummer}\n\n"
            "Es wurde keine verständliche Nachricht hinterlassen.\n")

    msg = EmailMessage()
    name, adresse = parseaddr(m.get("from") or m["user"])
    absender = adresse or m["user"]
    msg["From"] = formataddr((name or "V3D Anrufannahme", absender))
    msg["To"] = m["to"]
    msg["Subject"] = betreff
    # Date und Message-ID gehoeren in jede Mail. Ohne Date sortieren
    # Mailprogramme die Nachricht ans Listenende (V3D Mail zeigte sie
    # gar nicht mehr oben an), ohne Message-ID brechen Threading und
    # Doppelerkennung, und Spamfilter rechnen es an.
    # Der Zeitstempel ist der des Anrufs, nicht der des Versands.
    msg["Date"] = formatdate(anruf["ts"], localtime=True)
    msg["Message-ID"] = make_msgid(domain=absender.rsplit("@", 1)[-1])
    msg.set_content(koerper)

    _haenge_audio_an(msg, m, anruf, wann)
    _versende(m, msg)
    return betreff


def _haenge_audio_an(msg, m, anruf, wann):
    audio = anruf.get("audio")
    if not (m.get("attachAudio", True) and audio and os.path.exists(audio)):
        return
    anhang = _wandle_mp3(audio)
    with open(anhang, "rb") as fh:
        daten = fh.read()
    endung = os.path.splitext(anhang)[1].lstrip(".").lower()
    # "audio/mp3" ist kein gueltiger MIME-Typ — manche Postfaecher
    # zeigen den Anhang dann nicht als abspielbar an.
    subtyp = {"mp3": "mpeg", "wav": "wav", "ogg": "ogg"}.get(endung, endung)
    stempel = time.strftime("%Y-%m-%d_%H-%M", time.localtime(anruf["ts"]))
    msg.add_attachment(daten, maintype="audio", subtype=subtyp,
                       filename=f"Nachricht_{stempel}.{endung}")


def _versende(m, msg):
    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL(m["smtpHost"], int(m.get("smtpPort", 465)), context=ctx,
                          timeout=60) as s:
        s.login(m["user"], m["pass"])
        s.send_message(msg)


# --------------------------------------------------------------------- Push

def sende_push(anruf):
    pub = core.cfg("push", "vapidPublic", default="")
    priv = core.cfg("push", "vapidPrivate", default="")
    if not pub or not priv:
        return 0
    from pywebpush import webpush, WebPushException

    text = (anruf.get("text") or "").strip()
    nutzlast = json.dumps({
        "title": f"Anruf von {_nummer_lesbar(anruf.get('caller'))}",
        "body": (text[:180] + "…") if len(text) > 180 else (text or "Ohne Nachricht"),
        "id": anruf["id"],
    })

    zugestellt = 0
    with core.db() as con:
        abos = con.execute("SELECT endpoint, sub FROM subs").fetchall()
    for zeile in abos:
        try:
            webpush(subscription_info=json.loads(zeile["sub"]), data=nutzlast,
                    vapid_private_key=priv,
                    vapid_claims={"sub": core.cfg("push", "subject",
                                                  default="mailto:admin@localhost")})
            zugestellt += 1
        except WebPushException as e:
            # 404/410 = Abo vom Browser verworfen -> aufräumen
            if getattr(e, "response", None) is not None and e.response.status_code in (404, 410):
                with core.db() as con:
                    con.execute("DELETE FROM subs WHERE endpoint=?", (zeile["endpoint"],))
        except Exception:
            pass
    return zugestellt


# ------------------------------------------------------------ Gesamtablauf

def _gespraech_einsammeln(cid):
    """Im Gespraechsmodus liegen die Aufnahmen rundenweise im Spool.

    Liefert (Mitschrift, zusammengefuegte Aufnahme) — oder (None, None),
    wenn es kein Gespraech war.
    """
    import glob
    import dialog
    mitschrift = dialog.verlauf_text(cid)
    if not mitschrift:
        return None, None, ""

    runden = sorted(glob.glob(f"/var/spool/v3dcall/{cid}-r*.wav"))
    zusammen = None
    if runden:
        liste = os.path.join(core.REC, f"{cid}-teile.txt")
        with open(liste, "w", encoding="utf-8") as fh:
            for r in runden:
                fh.write(f"file '{r}'\n")
        zusammen = os.path.join(core.REC, f"{cid}.wav")
        try:
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat",
                            "-safe", "0", "-i", liste, "-c", "copy", zusammen],
                           check=True)
        except subprocess.CalledProcessError:
            zusammen = None
        finally:
            os.remove(liste)
    for r in runden:                      # Spool aufraeumen
        try:
            os.remove(r)
        except OSError:
            pass
    for a in glob.glob(f"/var/spool/v3dcall/{cid}-antwort-*"):
        try:
            os.remove(a)
        except OSError:
            pass
    # Auswertung VOR dem Aufraeumen — danach ist der Verlauf weg.
    kurzfassung = ""
    try:
        kurzfassung = dialog.auswertung(cid, (core.get_call(cid) or {}).get("caller"))
    except Exception:
        pass
    dialog.beende(cid)
    return mitschrift, zusammen, kurzfassung


def verarbeite(cid):
    """Kompletter Durchlauf für einen Anruf. Läuft im Hintergrund-Thread."""
    anruf = core.get_call(cid)
    if not anruf:
        return
    try:
        # War es ein Gespraech, ist die Mitschrift schon da — dann muss
        # Whisper nicht noch einmal ueber alles laufen.
        mitschrift, zusammen, kurzfassung = _gespraech_einsammeln(cid)
        if mitschrift:
            if kurzfassung:
                mitschrift = (kurzfassung + "\n\n" + "=" * 52
                              + "\nGESPRÄCH IM WORTLAUT\n" + "=" * 52
                              + "\n\n" + mitschrift)
            if zusammen and os.path.exists(zusammen):
                core.update_call(cid, audio=zusammen, seconds=dauer(zusammen))
                anruf["audio"] = zusammen
            core.update_call(cid, text=mitschrift, status="Gespräch")
            anruf["text"] = mitschrift
            anruf["seconds"] = core.get_call(cid)["seconds"]
            sende_mail(anruf)
            core.update_call(cid, gemailt=1, status="fertig")
            sende_push(anruf)
            return

        pfad = anruf.get("audio") or ""
        if pfad and os.path.exists(pfad):
            core.update_call(cid, status="transkribiert gerade",
                             seconds=dauer(pfad))
            anruf = core.get_call(cid)
            text = transkribiere(pfad)
            core.update_call(cid, text=text)
            anruf["text"] = text
        else:
            core.update_call(cid, status="ohne Aufnahme")
            anruf["text"] = ""

        anruf["seconds"] = core.get_call(cid)["seconds"]
        betreff = sende_mail(anruf)
        core.update_call(cid, gemailt=1,
                         status="fertig" if anruf["text"] else "ohne Nachricht")
        sende_push(anruf)
        return betreff
    except Exception:
        core.update_call(cid, status="Fehler", fehler=traceback.format_exc()[-1500:])
        raise


def verarbeite_async(cid):
    threading.Thread(target=lambda: _still(cid), daemon=True).start()


def _still(cid):
    try:
        verarbeite(cid)
    except Exception:
        traceback.print_exc()
