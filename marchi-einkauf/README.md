# Marchi Group – Zentraleinkauf

Einkaufsprogramm für die Marchi Group (Dortmund), gebaut für einen Einkäufer,
der lieber telefoniert als tippt.

- **🎤 Telefonat eintragen**: nach dem Gespräch ins Handy sprechen (Live-Erkennung
  im Browser, sonst Whisper auf dem Server). Claude macht daraus Lieferant,
  Artikel, Menge, Preis, Konditionen; fehlende Lieferanten/Artikel werden angelegt.
- **Anruf-Brücke**: 📞-Knöpfe rufen per `tel:` an; kommt man zurück in die App,
  öffnet sich „Was hat X angeboten?" (localStorage `me_anruf`).
- **Preisspiegel** je Artikel: Rangfolge, Abstand zum Günstigsten, Vergleichspreis,
  „Noch nicht gefragt" (Lieferanten der Rubrik), Bestellen beim Günstigsten.
- **Ersparnis & Bonus**: (Vergleichspreis − bezahlter Preis) × Menge. Vergleichspreis
  = mengengewichteter Ø der 12 Monate vor „zuständig seit" (Altpreise + frühere
  Bestellungen), sonst letzter Preis davor, sonst „bisher bezahlt" am Artikel.
  Angebotsvergleich (Ø der Angebote − bezahlt) separat. Bonus = % der Ersparnis.
- **Altpreise einlesen** (CSV/XLSX-Export des alten Programms), Kunden-Import,
  Rubriken (erweiterbar), Lieferanten, Bestellungen mit Bestellschein.

Technik
- `python3 server.py 8811`, Dienst `marchi-einkauf.service` (User-systemd), nur Stdlib
  (+ lokales Whisper „small"). Daten: `daten.db` (nicht versioniert).
- PIN: `~/.config/marchi-einkauf/config.json` (neue PIN: Datei löschen, Dienst neu starten).
  8 Fehlversuche in 10 min → Sperre. Sitzungen liegen in der DB (überleben Neustarts).
- KI: `"ki": {"key", "model"}` in obiger config, sonst Schlüssel aus V3D Mail.
- Mikrofon im Handy-Browser braucht **HTTPS** (Funnel-Pfad, z. B. /einkauf –
  `app.html` setzt dafür `<base href>`).
- Test: `node test_ui.mjs URL PIN altpreise.csv [ausgabeordner]` – NUR gegen eine
  Wegwerf-Kopie (legt Daten an, ruft die KI auf).
