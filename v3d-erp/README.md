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
.venv/bin/python -m unittest $(ls test_*.py | sed 's/.py//')    # alle (mit KoSIT-Prüfung, falls ~/tools/kosit da ist)
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
- `datev.py` – DATEV-Export (Buchungsstapel EXTF, SKR03/SKR04, Konten in den Einstellungen)
- `auswertung.py` – Liquiditätsplanung (Wochenvorschau) und Umsatzauswertung (Jahr gegen Vorjahr)
- `inventur.py` – Inventur: eröffnen → zählen → abschließen (Differenzen zum Stichtag ins Lager)
- `seed.py` – erfundene Testdaten
- `import_myfactory.py` – Datenübernahme
- `docs/` – Datenmodell, Server-Vorschlag für GSB

## Umsatzsteuer-Sonderfälle
Am Kunden (Kunden-/Lieferantendaten → Umsatzsteuer): EU-Lieferung, EU-Leistung (Reverse Charge), § 13b, Drittland.
Am Beleg wird der Steuerfall eingefroren und lässt sich im Entwurf ändern. Kleinunternehmer (§ 19) ist ein Schalter in den Einstellungen.
Wirkung: 0 % auf allen Positionen, Pflichthinweis auf AN/AB/RE/GS, E-Rechnung mit Kategorie K/AE/G/E und Befreiungsgrund.
Beim Verarbeiten einer Rechnung wird geprüft, ob USt-IdNr. und Land passen. `test_steuerfall` lässt jede Variante vom KoSIT-Prüfer validieren.
