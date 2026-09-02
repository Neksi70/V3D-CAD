#!/bin/bash
# Richtet Asterisk fuer die V3D Anrufannahme ein.
# Aufruf:  sudo ~/v3dcall/asterisk/install.sh
set -euo pipefail

BASE="$(cd "$(dirname "$0")/.." && pwd)"
EIGNER="$(stat -c %U "$BASE")"
ETC=/etc/asterisk
SPOOL=/var/spool/v3dcall
SOUNDS=/var/lib/asterisk/sounds/v3d

[ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo starten."; exit 1; }

lies() { python3 -c "
import json,sys
d=json.load(open('$BASE/config.json'))
for k in sys.argv[1].split('.'): d=d[k]
print(d)" "$1"; }

REGISTRAR="$(lies asterisk.registrar)"
SIPUSER="$(lies asterisk.sipUser)"
SIPPASS="$(lies asterisk.sipPass)"
MAXSEC="$(lies asterisk.maxSeconds)"
SILENCE="$(lies asterisk.silenceSeconds)"

if [ -z "$SIPPASS" ]; then
  echo "FEHLER: asterisk.sipPass ist in config.json noch leer."
  echo "Erst in der Fritzbox ein IP-Telefon anlegen, dann Zugangsdaten eintragen."
  exit 1
fi

echo "==> 1/6  Asterisk installieren"
if ! command -v asterisk >/dev/null; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y asterisk
fi

echo "==> 2/6  Ablage fuer Aufnahmen ($SPOOL)"
# Asterisk schreibt hinein, der V3D-Dienst liest heraus -> gemeinsame Gruppe
install -d -o asterisk -g "$EIGNER" -m 2775 "$SPOOL"

echo "==> 3/6  Notify-Hook nach /usr/local/bin"
install -m 0755 "$BASE/bin/v3dcall-notify" /usr/local/bin/v3dcall-notify
# Geteilter Token — nur root und Asterisk duerfen ihn lesen
lies notifyToken > /etc/v3dcall.token
chown root:asterisk /etc/v3dcall.token
chmod 0640 /etc/v3dcall.token

echo "==> 4/6  Ansagen bereitstellen ($SOUNDS)"
install -d -o asterisk -g asterisk -m 0755 "$SOUNDS"
for n in ansage danke beep; do
  if [ -f "$BASE/data/sounds/$n.wav" ]; then
    install -o asterisk -g asterisk -m 0644 "$BASE/data/sounds/$n.wav" "$SOUNDS/$n.wav"
    echo "    $n.wav uebernommen"
  else
    echo "    WARNUNG: $n.wav fehlt noch — erst in der Weboberflaeche erzeugen"
  fi
done

echo "==> 5/6  Konfiguration schreiben"
cp -n "$ETC/pjsip.conf"      "$ETC/pjsip.conf.vor-v3dcall"      2>/dev/null || true
cp -n "$ETC/extensions.conf" "$ETC/extensions.conf.vor-v3dcall" 2>/dev/null || true

sed -e "s|@@REGISTRAR@@|$REGISTRAR|g" \
    -e "s|@@CLIENTURI@@|sip:${SIPUSER}@${REGISTRAR}|g" \
    -e "s|@@USER@@|$SIPUSER|g" \
    -e "s|@@PASS@@|$SIPPASS|g" \
    "$BASE/asterisk/pjsip_v3dcall.conf" > "$ETC/pjsip_v3dcall.conf"
chown root:asterisk "$ETC/pjsip_v3dcall.conf"; chmod 0640 "$ETC/pjsip_v3dcall.conf"

sed -e "s|@@MAXSEC@@|$MAXSEC|g" -e "s|@@SILENCE@@|$SILENCE|g" \
    "$BASE/asterisk/extensions_v3dcall.conf" > "$ETC/extensions_v3dcall.conf"
chown root:asterisk "$ETC/extensions_v3dcall.conf"; chmod 0640 "$ETC/extensions_v3dcall.conf"

# Nur pjsip soll Port 5060 belegen — chan_sip stillegen
if ! grep -q "^noload = chan_sip.so" "$ETC/modules.conf"; then
  sed -i 's|^\[modules\]|[modules]\nnoload = chan_sip.so|' "$ETC/modules.conf"
fi

# Eigene Dateien einbinden, Standardinhalt neutralisieren
if ! grep -q 'pjsip_v3dcall.conf' "$ETC/pjsip.conf"; then
  printf '\n#include "pjsip_v3dcall.conf"\n' >> "$ETC/pjsip.conf"
fi
if ! grep -q 'extensions_v3dcall.conf' "$ETC/extensions.conf"; then
  printf '\n#include "extensions_v3dcall.conf"\n' >> "$ETC/extensions.conf"
fi

echo "==> 6/6  Asterisk neu starten"
systemctl enable asterisk >/dev/null 2>&1 || true
systemctl restart asterisk
sleep 3
systemctl is-active --quiet asterisk && echo "    Asterisk laeuft" || { echo "    Asterisk startet nicht"; journalctl -u asterisk -n 30 --no-pager; exit 1; }

echo
echo "Fertig. Anmeldung an der Fritzbox pruefen:"
echo "    sudo asterisk -rx 'pjsip show registrations'"
echo "Erwartet:  fritzbox_reg/sip:${SIPUSER}@${REGISTRAR}   ...   Registered"
