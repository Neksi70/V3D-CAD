# Marchi Group – Zentraleinkauf

Einkaufsprogramm für die Marchi Group (Dortmund): Rubriken (Stahl, Aluminium,
Edelstahl … frei erweiterbar, mit Unterrubriken), Artikel, Lieferanten, Kunden
und Bestellvorgänge mit druckbarem Bestellschein (Marchi-Logo).

- Start: `python3 server.py 8811` – Dienst `marchi-einkauf.service` (User-systemd)
- Daten: `daten.db` (SQLite, nicht versioniert)
- PIN: `~/.config/marchi-einkauf/config.json` (beim ersten Start erzeugt, Log zeigt sie).
  Neue PIN: Datei löschen und Dienst neu starten.
- Kunden-Import: Reiter „Kunden" → „Kundendatei einlesen" (CSV mit ; , oder Tab,
  UTF-8 oder Windows-Kodierung, oder .xlsx). Spalten werden automatisch erkannt;
  Abgleich über Kundennummer, sonst Name + PLZ → vorhandene werden aktualisiert.
- Logos: von marchi-group.com (logo-weiss.svg = Original-Footer-Logo,
  logo-dunkel.svg = dieselbe Datei in Schwarz, logo-icon-blau.svg = Favicon).
- Test: `node test_ui.mjs URL PIN kunden.csv kunden.xlsx [ausgabeordner]`
  (legt Testdaten an – nur gegen eine Wegwerf-DB laufen lassen).
