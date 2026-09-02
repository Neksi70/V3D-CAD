#!/bin/bash
# Rollt die Konfiguration neu aus und schneidet dann einen Anrufversuch mit.
#   sudo bash ~/v3dcall/asterisk/testanruf.sh
set -u
BASE="$(cd "$(dirname "$0")/.." && pwd)"
# Zeitstempel im Namen: sonst wertet das Skript stillschweigend
# einen alten Mitschnitt aus, wenn tcpdump nicht startet.
SCHNITT="/tmp/v3dcall-anruf-$(date +%H%M%S).pcap"
ETC_DIALPLAN=/etc/asterisk/extensions_v3dcall.conf
DAUER=${1:-75}

[ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo starten."; exit 1; }

echo "=== Konfiguration neu ausrollen ==="
# Ohne PIPESTATUS verschluckt "| tail" den Fehlschlag von install.sh —
# das Skript lief dann weiter, obwohl Asterisk gar nicht neu gestartet war.
bash "$BASE/asterisk/install.sh" 2>&1 | tail -8
[ "${PIPESTATUS[0]}" -eq 0 ] || { echo "ABBRUCH: install.sh ist fehlgeschlagen."; exit 1; }

# Belegen, dass Asterisk die neue Konfiguration wirklich geladen hat
GESTARTET=$(systemctl show asterisk -p ActiveEnterTimestampMonotonic --value)
DATEI=$(stat -c %Y "$ETC_DIALPLAN" 2>/dev/null || echo 0)
echo
echo "Asterisk gestartet: $(systemctl show asterisk -p ActiveEnterTimestamp --value)"
echo "Dialplan geschrieben: $(date -d @"$DATEI" '+%%a %%Y-%%m-%%d %%H:%%M:%%S %%Z' 2>/dev/null)"
grep -q "exten => $(python3 -c "
import json;print(json.load(open('$BASE/config.json'))['asterisk']['sipUser'])")" \
  "$ETC_DIALPLAN" && echo "Dialplan enthaelt das richtige Ziel." \
  || { echo "ABBRUCH: Ziel fehlt im ausgerollten Dialplan."; exit 1; }

echo
echo "=== Anmeldung ==="
sleep 3
asterisk -rx 'pjsip show registrations' | sed -n '3,6p'
echo "--- angesagte Erreichbarkeit (Contact) ---"
asterisk -rx 'pjsip show registrations' >/dev/null
asterisk -rx 'pjsip show aor fritzbox' | grep -iE "contact|192\.168" | head -5

echo
echo "############################################################"
echo "#  JETZT ANRUFEN:  02331 7397112                           #"
echo "#  Ich schneide $DAUER Sekunden lang mit.                        #"
echo "############################################################"
echo

timeout "$DAUER" tcpdump -n -i any -s0 -w "$SCHNITT" 'port 5060' 2>/dev/null
[ -s "$SCHNITT" ] || { echo "FEHLER: tcpdump hat nichts geschrieben."; exit 1; }

echo "=== Mitschnitt fertig. Was kam an? ==="
tcpdump -n -r "$SCHNITT" 2>/dev/null | grep -iE "INVITE|OPTIONS|REGISTER|SIP/2.0" | head -25
echo
echo "--- Zusammenfassung ---"
GES=$(tcpdump -n -r "$SCHNITT" 2>/dev/null | wc -l)
# INVITE steht im Paketauszug nicht am Zeilenanfang — ohne -a bricht grep
# ausserdem bei den Binaeranteilen ab und meldet faelschlich 0.
INV=$(tcpdump -n -r "$SCHNITT" 2>/dev/null | grep -ac "SIP: INVITE")
echo "  SIP-Pakete gesamt : $GES"
echo "  eingehende INVITEs: $INV"
if [ "$INV" -gt 0 ]; then
  echo "  -> Der Anruf hat Asterisk erreicht."
else
  echo "  -> Kein INVITE. Die Fritzbox reicht den Anruf nicht bis zu uns durch."
fi
echo
echo "=== Anmeldung danach ==="
asterisk -rx 'pjsip show registrations' | sed -n '3,5p'
echo
echo "=== Asterisk-Protokoll ==="
tail -20 /var/log/asterisk/messages | grep -viE "loader.c|deprecated" | tail -10
echo
echo "Mitschnitt liegt unter $SCHNITT"
