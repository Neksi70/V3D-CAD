#!/bin/bash
# Schneidet einen Anmeldeversuch vollstaendig mit und zeigt ihn im Klartext.
# Asterisk versucht es alle 60 s neu -> 100 s Mitschnitt faengt sicher einen.
#   sudo bash ~/v3dcall/asterisk/anmeldung-pruefen.sh
set -u
DAUER=${1:-100}
SCHNITT="/tmp/v3dcall-anmeldung-$(date +%H%M%S).pcap"   # nie eine alte Datei lesen
[ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo starten."; exit 1; }

echo "=== Zustand vorher ==="
asterisk -rx 'pjsip show registrations' | sed -n '3,5p'
echo
echo "Schneide $DAUER Sekunden mit ($SCHNITT) — bitte warten, nichts tun."
tcpdump -n -i any -s0 -w "$SCHNITT" 'port 5060' >/dev/null 2>&1 &
TPID=$!
sleep 2
kill -0 $TPID 2>/dev/null || { echo "FEHLER: tcpdump laeuft nicht."; exit 1; }

# NIEMALS 'send unregister' benutzen: die zweite Abmeldung bekommt ein 404,
# und auf ein 404 stellt Asterisk die Anmeldung DAUERHAFT ein
# ("Fatal response '404' ... stopping outbound registration").
# Genau das hat hier die Anmeldung zerschossen. Nur neu anmelden.
asterisk -rx 'pjsip send register fritzbox_reg' >/dev/null 2>&1

sleep "$DAUER"
kill $TPID 2>/dev/null; sleep 1

echo
echo "=== Zustand nachher ==="
asterisk -rx 'pjsip show registrations' | sed -n '3,5p'
echo
echo "=== Anmeldeverkehr im Klartext ==="
tcpdump -A -n -r "$SCHNITT" 2>/dev/null \
  | awk '/REGISTER sip:|SIP\/2\.0 [0-9]{3}/{drucke=1} drucke' \
  | grep -aE "REGISTER sip:|SIP/2\.0 [0-9]{3}|^(Via|From|To|Contact|CSeq|Call-ID|WWW-Auth|Warning|Expires|User-Agent):" \
  | head -60
echo
echo "=== Paketuebersicht ==="
tcpdump -n -r "$SCHNITT" 2>/dev/null | head -25
echo
echo "Pakete gesamt: $(tcpdump -n -r "$SCHNITT" 2>/dev/null | wc -l)   Datei: $SCHNITT"
