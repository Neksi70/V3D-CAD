#!/bin/bash
# Rollt die Konfiguration neu aus und schneidet dann einen Anrufversuch mit.
#   sudo bash ~/v3dcall/asterisk/testanruf.sh
set -u
BASE="$(cd "$(dirname "$0")/.." && pwd)"
SCHNITT=/tmp/v3dcall-anruf.pcap
DAUER=${1:-75}

[ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo starten."; exit 1; }

echo "=== Konfiguration neu ausrollen ==="
bash "$BASE/asterisk/install.sh" 2>&1 | tail -8 || exit 1

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

timeout "$DAUER" tcpdump -n -i any -s0 -w "$SCHNITT" 'udp port 5060 or tcp port 5060' 2>/dev/null

echo "=== Mitschnitt fertig. Was kam an? ==="
tcpdump -n -r "$SCHNITT" 2>/dev/null | grep -iE "INVITE|OPTIONS|REGISTER|SIP/2.0" | head -25
echo
echo "--- Zusammenfassung ---"
GES=$(tcpdump -n -r "$SCHNITT" 2>/dev/null | wc -l)
INV=$(tcpdump -A -n -r "$SCHNITT" 2>/dev/null | grep -c "^INVITE")
echo "  SIP-Pakete gesamt : $GES"
echo "  eingehende INVITEs: $INV"
if [ "$INV" -gt 0 ]; then
  echo "  -> Der Anruf hat Asterisk erreicht."
else
  echo "  -> Kein INVITE. Die Fritzbox reicht den Anruf nicht bis zu uns durch."
fi
echo
echo "=== Asterisk-Protokoll ==="
tail -20 /var/log/asterisk/messages | grep -viE "loader.c|deprecated" | tail -10
echo
echo "Mitschnitt liegt unter $SCHNITT"
