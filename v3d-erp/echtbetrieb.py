#!/usr/bin/env python3
"""Frische Datenbank für den Echtbetrieb aus dem Testsystem erzeugen – OHNE Test-Belege.

Übernommen werden: Einstellungen (Firmendaten, Briefpapier, Formulare, Nummernformate), Benutzer, Zahlungs-
bedingungen, Lager, Belegarten, Mahnstufen, Kennzeichen-Definitionen – mit --mit-stammdaten auch Adressen,
Artikel, Kundenpreise und Kennzeichen-Werte. Alles mit Bewegung (Belege, Chargen, Produktion, Offene Posten,
Projekte, Lager, Bank, Mahnungen, Dokumente, Protokoll, Archiv) bleibt leer; die Nummernkreise beginnen neu
(Startnummern danach unter Einstellungen → Nummernkreise setzen, z. B. Anschluss an myfactory).

Die laufende Datenbank wird NICHT angefasst. Umstellen danach von Hand:
  systemctl --user stop v3d-erp
  python3 sicherung.py --name vor-echtbetrieb          # (läuft auch bei gestopptem Dienst)
  mv ~/.local/share/v3d-erp/erp.db ~/.local/share/v3d-erp/erp-testbetrieb.db   (+ -wal/-shm)
  mv <ziel> ~/.local/share/v3d-erp/erp.db
  systemctl --user start v3d-erp

  python3 echtbetrieb.py /tmp/erp-echt.db [--mit-stammdaten]
"""
import argparse
import os
import sqlite3
import sys

DATEN = os.environ.get("V3D_ERP_DATEN") or os.path.expanduser("~/.local/share/v3d-erp")

BEWEGUNG = ["beleg_archiv", "charge_bewegung", "fertigung", "charge", "dokument", "mahnung_posten", "mahnung", "bankumsatz", "bankimport",
            "offener_posten", "lagerbewegung", "beleg_verknuepfung", "beleg_position", "projekt_verlauf", "meilenstein", "mail",
            "beleg", "projekt", "protokoll", "nummernkreis"]
STAMM = ["kennzeichen_wert", "kundenpreis", "ansprechpartner", "kunde", "lieferant", "artikel", "adresse"]


def erzeugen(ziel, mit_stammdaten=False):
    if os.path.exists(ziel):
        raise SystemExit(f"{ziel} existiert schon – bitte anderen Namen wählen.")
    src = sqlite3.connect(os.path.join(DATEN, "erp.db"))
    dst = sqlite3.connect(ziel)
    src.backup(dst)
    src.close()
    tabellen = {r[0] for r in dst.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    dst.execute("PRAGMA foreign_keys = OFF")
    leer = BEWEGUNG + ([] if mit_stammdaten else STAMM)
    for t in leer:
        if t in tabellen:
            dst.execute(f"DELETE FROM {t}")
    dst.execute("DELETE FROM sqlite_sequence WHERE name IN (%s)" % ",".join("?" * len(leer)), leer)
    dst.execute("DELETE FROM einstellung WHERE schluessel LIKE 'seed_%'")     # Testdaten-Marker
    dst.commit()
    dst.execute("VACUUM")
    zahlen = {t: dst.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ("beleg", "adresse", "artikel", "benutzer", "einstellung") if t in tabellen}
    ok = dst.execute("PRAGMA integrity_check").fetchone()[0]
    dst.close()
    return zahlen, ok


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("ziel")
    a.add_argument("--mit-stammdaten", action="store_true", help="Kunden, Lieferanten, Artikel aus dem Testsystem übernehmen")
    x = a.parse_args()
    zahlen, ok = erzeugen(x.ziel, x.mit_stammdaten)
    print(f"{x.ziel}: {zahlen}, Prüfung {ok}")
    sys.exit(0 if ok == "ok" else 1)
