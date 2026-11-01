#!/bin/bash
# Richtet auf V3DA die Windows-Freigabe \\v3da.tailf05fe9.ts.net\stl ein
# (Ziel: externe Platte /mnt/frigate/backups/Volme3D-STL) – nur übers Tailnet erreichbar.
# Aufruf: sudo bash ~/stl-freigabe-einrichten.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo starten: sudo bash $0"; exit 1; }

ZIEL=/mnt/frigate/backups/Volme3D-STL
mountpoint -q /mnt/frigate || { echo "Externe Platte /mnt/frigate ist nicht eingehängt – abgebrochen."; exit 1; }
install -d -o v3da -g v3da "$ZIEL"

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq samba

[ -f /etc/samba/smb.conf.orig ] || cp /etc/samba/smb.conf /etc/samba/smb.conf.orig
cat > /etc/samba/smb.conf <<'EOF'
# V3DA: nur die STL-Freigabe, nur über Tailscale (Original: smb.conf.orig)
[global]
   workgroup = WORKGROUP
   server string = V3DA
   interfaces = lo tailscale0
   bind interfaces only = yes
   smb ports = 445
   disable netbios = yes
   server min protocol = SMB2_10
   map to guest = never
   load printers = no
   printing = bsd
   printcap name = /dev/null
   disable spoolss = yes
   log file = /var/log/samba/log.%m
   max log size = 1000

[stl]
   path = /mnt/frigate/backups/Volme3D-STL
   valid users = v3da
   force user = v3da
   read only = no
   create mask = 0664
   directory mask = 0775
EOF
testparm -s >/dev/null

# smbd erst starten, wenn tailscale0 da ist (sonst lauscht er nach dem Booten nirgends)
mkdir -p /etc/systemd/system/smbd.service.d
cat > /etc/systemd/system/smbd.service.d/tailscale.conf <<'EOF'
[Unit]
After=tailscaled.service network-online.target
Wants=network-online.target
[Service]
ExecStartPre=/bin/sh -c 'for i in $(seq 60); do ip link show tailscale0 >/dev/null 2>&1 && exit 0; sleep 1; done; exit 0'
EOF
systemctl daemon-reload
systemctl disable --now nmbd 2>/dev/null || true
systemctl enable smbd
systemctl restart smbd

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow in on tailscale0 to any port 445 proto tcp
fi

echo
echo "Jetzt das Samba-Passwort für den Benutzer v3da festlegen (frei wählbar, braucht Windows gleich):"
smbpasswd -a v3da
echo
echo "Fertig. Freigabe: \\\\v3da.tailf05fe9.ts.net\\stl"
ss -ltn | grep ':445 ' || echo "WARNUNG: smbd lauscht nicht auf 445 – journalctl -u smbd prüfen"
