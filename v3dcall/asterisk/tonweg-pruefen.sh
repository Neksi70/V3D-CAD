#!/bin/bash
# Prueft, warum bei einem Anruf kein Ton ankommt.
#   sudo bash ~/v3dcall/asterisk/tonweg-pruefen.sh
set -u
DAUER=${1:-60}
SCHNITT="/tmp/v3dcall-ton-$(date +%H%M%S).pcap"
[ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo starten."; exit 1; }

echo "=== Firewall ==="
ufw status verbose | head -12
echo
echo "    Regeln, die den Tonbereich 10000-20000 betreffen:"
ufw status numbered | grep -E "1[0-9]{4}|10000:20000" || echo "      KEINE — hier koennte es klemmen"
echo
echo "=== Anmeldung ==="
asterisk -rx 'pjsip show registrations' | sed -n '3,5p'
echo
echo "############################################################"
echo "#  JETZT ANRUFEN: 02331 7397112                            #"
echo "#  Sprechen Sie ein paar Saetze. $DAUER Sekunden Mitschnitt.       #"
echo "############################################################"
echo
tcpdump -n -i any -s0 -w "$SCHNITT" \
  '(port 5060) or (udp portrange 10000-20000)' >/dev/null 2>&1 &
TPID=$!
sleep "$DAUER"
kill $TPID 2>/dev/null; sleep 1

echo "=== Was lief ueber die Leitung? ==="
SIP=$(tcpdump -n -r "$SCHNITT" 'port 5060' 2>/dev/null | wc -l)
RTP_REIN=$(tcpdump -n -r "$SCHNITT" 'udp portrange 10000-20000 and dst net 192.168.178.0/24' 2>/dev/null | wc -l)
RTP_RAUS=$(tcpdump -n -r "$SCHNITT" 'udp portrange 10000-20000 and src net 192.168.178.0/24' 2>/dev/null | wc -l)
printf "  SIP-Pakete        %6d\n" "$SIP"
printf "  Ton HEREIN        %6d  %s\n" "$RTP_REIN" \
  "$([ "$RTP_REIN" -gt 50 ] && echo '(gut)' || echo '<-- DA FEHLT ES')"
printf "  Ton HINAUS        %6d  %s\n" "$RTP_RAUS" \
  "$([ "$RTP_RAUS" -gt 50 ] && echo '(gut)' || echo '<-- DA FEHLT ES')"
echo
echo "=== Welche Ton-Adressen wurden ausgehandelt? ==="
tcpdump -A -n -r "$SCHNITT" 'port 5060' 2>/dev/null \
  | grep -aE "^c=IN IP4|^m=audio" | sort -u | head -6
echo
echo "=== Asterisk-Protokoll ==="
tail -6 /var/log/asterisk/messages | grep -viE "loader|deprecated"
echo
echo "Mitschnitt: $SCHNITT"
