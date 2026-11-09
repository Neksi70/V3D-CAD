#!/usr/bin/env python3
# emmc-Upload für Bambu H2-Serie über Port 6000 (BambuTunnelLocal).
# Nutzt bambu6000_client.py (Open-Source-Nachbau von Bambus Netzwerk-Plugin,
# ClusterM/open-bamboo-networking). Studio lädt so auf den internen Speicher (emmc);
# FTP/SD löst den "AMS-Zuordnungstabelle nicht abrufbar"-Bug [0700-8012] aus.
# Aufruf: emmc_upload.py <ip> <access_code> <local_path> <remote_name>
import sys
import bambu6000_client as b


def main():
    ip, code, local_path, remote_name = sys.argv[1:5]
    s = b.connect_session(ip, code, quiet=True)
    try:
        s.upload_file(local_path, "emmc", remote_name)
        print("OK")
    finally:
        s.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print("ERR: " + str(e), file=sys.stderr)
        sys.exit(1)
