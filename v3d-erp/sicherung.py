#!/usr/bin/env python3
"""Konsistente Sicherung der ERP-Datenbank – auch im laufenden Betrieb.

NICHT einfach erp.db kopieren: im WAL-Modus stehen die jüngsten Änderungen in erp.db-wal,
eine Dateikopie von erp.db allein ist dann veraltet. Hier läuft die SQLite-Backup-Funktion.

  python3 sicherung.py                 # → <Daten>/sicherungen/erp-JJJJMMTT-HHMM.db, behält die letzten 30
  python3 sicherung.py --name vor-update
  python3 sicherung.py --behalten 60
  python3 sicherung.py --kopie /mnt/frigate/backups/v3d-erp   # zusätzlich auf zweite Platte: DB + Archiv + Dokumente
"""
import argparse
import datetime
import glob
import os
import shutil
import sqlite3
import sys

DATEN = os.environ.get("V3D_ERP_DATEN") or os.path.expanduser("~/.local/share/v3d-erp")


def sichern(name="", behalten=30):
    ordner = os.path.join(DATEN, "sicherungen")
    os.makedirs(ordner, exist_ok=True)
    ziel = os.path.join(ordner, f"erp-{datetime.datetime.now():%Y%m%d-%H%M%S}{'-' + name if name else ''}.db")
    src = sqlite3.connect(os.path.join(DATEN, "erp.db"))
    dst = sqlite3.connect(ziel)
    src.backup(dst)
    dst.close()
    src.close()
    chk = sqlite3.connect(f"file:{ziel}?mode=ro", uri=True)
    ok = chk.execute("PRAGMA integrity_check").fetchone()[0]
    belege = chk.execute("SELECT COUNT(*) FROM beleg").fetchone()[0]
    chk.close()
    if ok != "ok":
        raise SystemExit(f"Sicherung beschädigt: {ok}")
    alte = sorted(glob.glob(os.path.join(ordner, "erp-*.db")))
    for f in alte[:-behalten] if behalten else []:
        os.remove(f)
    return ziel, belege


def kopieren(ziel, db_datei, behalten=60):
    """Zweitkopie: Datenbank-Sicherung + Archiv-/Dokumentdateien (nur neue Dateien; Archiv ist ohnehin unveränderlich)."""
    os.makedirs(os.path.join(ziel, "db"), exist_ok=True)
    shutil.copy2(db_datei, os.path.join(ziel, "db", os.path.basename(db_datei)))
    neu = 0
    for unter in ("archiv", "dokumente"):
        quelle = os.path.join(DATEN, unter)
        for wurzel, _, dateien in os.walk(quelle):
            for f in dateien:
                q = os.path.join(wurzel, f)
                z = os.path.join(ziel, unter, os.path.relpath(q, quelle))
                if not os.path.exists(z) or os.path.getsize(z) != os.path.getsize(q):
                    os.makedirs(os.path.dirname(z), exist_ok=True)
                    shutil.copy2(q, z)
                    neu += 1
    alte = sorted(glob.glob(os.path.join(ziel, "db", "erp-*.db")))
    for f in alte[:-behalten] if behalten else []:
        os.remove(f)
    return neu


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("--name", default="")
    a.add_argument("--behalten", type=int, default=30)
    a.add_argument("--kopie", default=os.environ.get("V3D_ERP_KOPIE", ""), help="zweites Sicherungsziel (andere Platte)")
    x = a.parse_args()
    ziel, belege = sichern(x.name, x.behalten)
    print(f"{ziel}  ({belege} Belege, Prüfung ok)")
    if x.kopie:
        try:
            n = kopieren(x.kopie, ziel)
            print(f"Kopie → {x.kopie} ({n} neue Archiv-/Dokumentdateien)")
        except OSError as e:
            print(f"FEHLER Zweitkopie {x.kopie}: {e}", file=sys.stderr)
            sys.exit(2)
    sys.exit(0)
