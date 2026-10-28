#!/usr/bin/env python3
"""Konsistente Sicherung der ERP-Datenbank – auch im laufenden Betrieb.

NICHT einfach erp.db kopieren: im WAL-Modus stehen die jüngsten Änderungen in erp.db-wal,
eine Dateikopie von erp.db allein ist dann veraltet. Hier läuft die SQLite-Backup-Funktion.

  python3 sicherung.py                 # → <Daten>/sicherungen/erp-JJJJMMTT-HHMM.db, behält die letzten 30
  python3 sicherung.py --name vor-update
  python3 sicherung.py --behalten 60
"""
import argparse
import datetime
import glob
import os
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


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("--name", default="")
    a.add_argument("--behalten", type=int, default=30)
    x = a.parse_args()
    ziel, belege = sichern(x.name, x.behalten)
    print(f"{ziel}  ({belege} Belege, Prüfung ok)")
    sys.exit(0)
