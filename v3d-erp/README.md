# V3D ERP (Arbeitstitel) – Prototyp

Schlankes ERP für GSB Hagen als Ersatz für myfactory: Verkauf, Einkauf, Lager, offene Posten und **Projekte mit Termin-Zeitstrahl**.
Vertraute Begriffe und Abläufe wie myfactory, aber eigene Umsetzung. Siehe `docs/datenmodell.md`.

**Nur Testdaten (erfunden).** Login im Prototyp: `demo` / `demo`.

## Starten
```
python3 server.py            # http://127.0.0.1:8820
V3D_ERP_HOST=100.125.34.44 python3 server.py   # nur im Tailnet
```
Daten: `~/.local/share/v3d-erp/erp.db` (beim ersten Start mit Testdaten befüllt). Neu anfangen = Datei löschen.
Dienst: `systemctl --user {start|stop|restart} v3d-erp` (Unit: `v3d-erp.service`).

## Tests
```
python3 -m unittest test_erp test_import -v
```

## Datenübernahme aus myfactory
```
python3 import_myfactory.py kunden      kunden.xlsx                 # Probelauf, ändert nichts
python3 import_myfactory.py kunden      kunden.xlsx --ausfuehren
python3 import_myfactory.py lieferanten lieferanten.xlsx --ausfuehren
python3 import_myfactory.py artikel     artikel.xlsx --ausfuehren   # inkl. Bestand
python3 import_myfactory.py op-kunden   op_kunden.csv --ausfuehren  # nach den Stammdaten!
```
Das Protokoll enthält nie Inhalte, nur Spalten, Anzahlen und Zeilennummern. Der Kunde kann es also weitergeben.

## Dateien
- `schema.sql` – Datenmodell (SQLite, PostgreSQL-tauglich)
- `erp.py` – Geschäftslogik (Belegkette, Lager, OP, Projekte)
- `server.py` – Webserver + JSON-API (nur Standardbibliothek)
- `app.html` – Oberfläche
- `seed.py` – erfundene Testdaten
- `import_myfactory.py` – Datenübernahme
- `docs/` – Datenmodell, Server-Vorschlag für GSB
