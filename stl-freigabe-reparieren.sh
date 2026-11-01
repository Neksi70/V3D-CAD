#!/bin/bash
# Korrigiert die STL-Freigabe: Samba hoerte nur auf 127.0.0.1. Aufruf: sudo bash ~/stl-freigabe-reparieren.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo starten: sudo bash $0"; exit 1; }
sed -i -e '/^   interfaces = lo tailscale0$/d' -e '/^   bind interfaces only = yes$/d' /etc/samba/smb.conf
grep -q '^   hosts allow' /etc/samba/smb.conf || sed -i '/^\[global\]$/a\   hosts allow = 127.0.0.1 ::1 100.64.0.0/10 fd7a:115c:a1e0::/48\n   hosts deny = ALL' /etc/samba/smb.conf
testparm -s >/dev/null
systemctl restart smbd
sleep 1
ss -ltn | grep ':445 '
pdbedit -L | grep -q '^v3da:' && echo "Samba-Benutzer v3da: vorhanden" || { echo "Samba-Passwort fuer v3da setzen:"; smbpasswd -a v3da; }
echo "Fertig."
