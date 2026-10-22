#!/usr/bin/env python3
"""Benutzer verwalten (Kennwörter werden zufällig erzeugt und einmal angezeigt).

  python3 benutzer.py liste
  python3 benutzer.py anlegen <login> "<Name>" <admin|benutzer|werkstatt>
  python3 benutzer.py kennwort <login>
  python3 benutzer.py loeschen <login>
"""
import os
import secrets
import sys

import erp

DB_PFAD = os.path.join(os.environ.get("V3D_ERP_DATEN", os.path.expanduser("~/.local/share/v3d-erp")), "erp.db")


def neues_kennwort():
    zeichen = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "-".join("".join(secrets.choice(zeichen) for _ in range(4)) for _ in range(3))


def main(a):
    db = erp.verbinden(DB_PFAD)
    erp.schema_anlegen(db)
    if not a or a[0] == "liste":
        for r in db.execute("SELECT login, name, rolle FROM benutzer ORDER BY login"):
            print(f"{r['login']:<12} {r['rolle']:<10} {r['name']}")
    elif a[0] == "anlegen" and len(a) == 4:
        if a[3] not in ("admin", "benutzer", "werkstatt"):
            sys.exit("Rolle muss admin, benutzer oder werkstatt sein.")
        pw = neues_kennwort()
        db.execute("INSERT INTO benutzer(login,name,pw_hash,rolle) VALUES(?,?,?,?)", (a[1], a[2], erp.pw_hash(pw), a[3]))
        print(f"Angelegt: {a[1]} ({a[3]})  Kennwort: {pw}")
    elif a[0] == "kennwort" and len(a) == 2:
        pw = neues_kennwort()
        if not db.execute("UPDATE benutzer SET pw_hash=? WHERE login=?", (erp.pw_hash(pw), a[1])).rowcount:
            sys.exit("Benutzer nicht gefunden.")
        print(f"Neues Kennwort für {a[1]}: {pw}")
    elif a[0] == "loeschen" and len(a) == 2:
        db.execute("DELETE FROM benutzer WHERE login=?", (a[1],))
        print("Gelöscht.")
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
