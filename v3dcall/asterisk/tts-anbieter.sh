#!/bin/bash
# Stimme der Anrufannahme umschalten: ElevenLabs <-> VoiceStudio (lokal).
#
#   bash ~/v3dcall/asterisk/tts-anbieter.sh status
#   bash ~/v3dcall/asterisk/tts-anbieter.sh voicestudio [ansagen|live|alles]
#   bash ~/v3dcall/asterisk/tts-anbieter.sh elevenlabs  [ansagen|live|alles]
#   bash ~/v3dcall/asterisk/tts-anbieter.sh stt whisper|scribe
#
# live    = Live-Antworten des Assistenten (dialog.py + strom.py)
#           -> config.json tts.live, danach Dienst-Neustart (ohne sudo)
# ansagen = feste Saetze (Begruessungen, Fuellwoerter, Stoerung, Danke ...)
#           voicestudio: erzeugt alles neu nach data/sounds-voicestudio/,
#             sichert die ElevenLabs-Fassungen EINMALIG nach
#             data/sounds-elevenlabs/ und kopiert dann nach data/sounds/
#           elevenlabs: holt die gesicherten Fassungen zurueck (kostet
#             keine Zeichen, klingt genau wie vorher)
#           danach `sudo asterisk/install.sh` (Runden-Modus/AGI)
# stt     = Spracherkennung im Datenstrom-Modus: scribe (ElevenLabs) oder
#           whisper (lokal) -> dialog.strom.sttModell, Dienst-Neustart
#
# Laeuft als v3da (NICHT mit sudo starten) — fragt sudo nur fuer install.sh.
set -euo pipefail
BASE="$(cd "$(dirname "$0")/.." && pwd)"
PY="$BASE/.venv/bin/python"
SOUNDS="$BASE/data/sounds"
SICHER="$BASE/data/sounds-elevenlabs"
VS="$BASE/data/sounds-voicestudio"
[ "$(id -u)" -ne 0 ] || { echo "Bitte OHNE sudo starten (fragt selbst nach)."; exit 1; }

cfg_setzen() {   # cfg_setzen <python-Ausdruck auf c>
  "$PY" - "$1" <<PY
import sys; sys.path.insert(0, "$BASE")
import core
c = core.full_cfg()
t = c.setdefault("tts", {})
t.setdefault("anbieter", "elevenlabs")
t.setdefault("voicestudio", {"url": "http://127.0.0.1:8840",
                             "keyDatei": "~/voicestudio/.env",
                             "stimme": "Volker", "modell": "omnivoice",
                             "sprache": "de", "speed": 1.0})
exec(sys.argv[1])
core.save_cfg(c)
PY
}

status() {
  "$PY" - <<PY
import sys; sys.path.insert(0, "$BASE")
import core, tts
print("  feste Ansagen :", tts.anbieter("ansagen"))
print("  Live-Antworten:", tts.anbieter("live"))
print("  Erkennung     :", core.cfg("dialog", "strom", "sttModell", default="scribe_v2_realtime"),
      "(Datenstrom)")
print("  VoiceStudio   :", core.cfg("tts", "voicestudio", default="(nicht eingerichtet)"))
PY
  [ -d "$SICHER" ] && echo "  Sicherung ElevenLabs-Ansagen: $SICHER ($(ls "$SICHER"/*.wav 2>/dev/null | wc -l) wav)"
  return 0
}

neustart() {
  echo "==> V3D-Dienst neu starten (laufende Anrufe brechen ab!)"
  systemctl --user restart v3dcall.service
  sleep 3
  systemctl --user is-active v3dcall.service
}

vs_pruefen() {
  echo "==> Pruefe VoiceStudio (Probesatz mit der eingestellten Stimme)"
  "$PY" - <<PY
import sys, time, tempfile, os; sys.path.insert(0, "$BASE")
import tts
t0 = time.time()
with tempfile.TemporaryDirectory() as d:
    try:
        tts.voicestudio_sprich("Hallo, hier ist die Folme 3D Akademi.", os.path.join(d, "p.wav"),
                               format="wav", timeout=900)
    except Exception as e:
        print("    FEHLER:", str(e)[:200]); raise SystemExit(1)
print(f"    OK in {time.time()-t0:.1f} s")
PY
}

case "${1:-}" in
  status) status; exit 0 ;;
  stt)
    case "${2:-}" in
      whisper) WERT=whisper ;;
      scribe)  WERT=scribe_v2_realtime ;;
      *) echo "Aufruf: $0 stt whisper|scribe"; exit 1 ;;
    esac
    cfg_setzen "c['dialog'].setdefault('strom', {})['sttModell'] = '$WERT'"
    neustart; status; exit 0 ;;
  elevenlabs|voicestudio) ZIEL=$1 ;;
  *) sed -n 2,22p "$0"; exit 1 ;;
esac
WAS=${2:-alles}
case "$WAS" in ansagen|live|alles) ;; *) echo "Teil: ansagen|live|alles"; exit 1 ;; esac

[ "$ZIEL" = voicestudio ] && { cfg_setzen "pass"; vs_pruefen; }

if [ "$WAS" = live ] || [ "$WAS" = alles ]; then
  echo "==> Live-Antworten -> $ZIEL"
  cfg_setzen "t['live'] = '$ZIEL'"
fi

if [ "$WAS" = ansagen ] || [ "$WAS" = alles ]; then
  if [ "$ZIEL" = voicestudio ]; then
    if [ ! -d "$SICHER" ]; then
      echo "==> Sichere ElevenLabs-Ansagen nach $SICHER"
      cp -a "$SOUNDS" "$SICHER"
    fi
    echo "==> Erzeuge feste Ansagen mit VoiceStudio nach $VS (dauert auf CPU)"
    "$PY" "$BASE/tts.py" --dialog-ansagen "$VS" voicestudio
    cp -f "$VS"/*.wav "$VS"/*.mp3 "$SOUNDS"/
  else
    [ -d "$SICHER" ] || { echo "Keine Sicherung $SICHER — die Ansagen sind schon die von ElevenLabs."; }
    if [ -d "$SICHER" ]; then
      echo "==> Hole ElevenLabs-Ansagen aus $SICHER zurueck"
      cp -f "$SICHER"/*.wav "$SICHER"/*.mp3 "$SOUNDS"/
    fi
  fi
  cfg_setzen "t['ansagen'] = '$ZIEL'"
fi

neustart
if [ "$WAS" = ansagen ] || [ "$WAS" = alles ]; then
  echo "==> Ansagen nach Asterisk uebernehmen (sudo)"
  sudo bash "$BASE/asterisk/install.sh" | tail -4
fi
status
