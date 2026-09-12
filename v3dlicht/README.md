# V3D Licht — Lichtplanung & Luxmeter für Elektriker

Einzelne HTML-Datei (`app.html`), ausgeliefert von `server.py` auf Port **8793**,
öffentlich unter `https://v3da.tailf05fe9.ts.net/licht` (Funnel-Pfad `/licht`).
Kein Netzzugriff, keine Abhängigkeiten — alles rechnet im Browser, Projekte liegen
im `localStorage` des Geräts.

## Bedienung auf dem Handy
- Untere Leiste mit Sinnbildern, **Wischen** wechselt den Schritt, grüner Punkt = erledigt
- Raummaße per Schieberegler (Grundriss wächst live mit), Zahl direkt daneben eintippbar
- Im Leuchten-Blatt läuft oben eine **Ergebniszeile** mit (Stückzahl · erreichte Lux), während
  man Typen durchprobiert; die Leuchtenzahl erscheint als Reihe aufleuchtender Lampen
- Luxmeter als **Rundinstrument**: Ring füllt sich bis zum Sollwert, kurze Vibration beim Treffer
- „Zum Startbildschirm hinzufügen" liefert Symbol + Vollbild (`manifest.webmanifest`, `icon.svg`);
  ein Service Worker (`sw.js`, Netz zuerst, Kopie als Rückfall) hält die App **offline** nutzbar —
  wichtig im Keller und im Rohbau. Alle drei liefert `server.py` direkt aus.
- `prefers-reduced-motion` schaltet sämtliche Bewegung ab

## Reiter
1. **Raum** — Maße, Nutzungsart (Katalog nach DIN EN 12464-1: Soll-Lux, UGR, Ra, Uo),
   Reflexionsgrade, Wartungsfaktor → Raumindex k, Raumwirkungsgrad, Lichtstrombedarf
2. **Leuchten** — Katalog mit Richtwerten oder eigene Leuchte aus dem Datenblatt;
   Stückzahl, Raster, Plausibilitätswarnungen (Abstand/Höhe, UGR, IP, lm/W, W/m²)
3. **Verteilung** — Beleuchtungsstärke-Karte auf der Nutzebene, Ē/Emin/Emax/Uo
4. **Messen** — Handy als Luxmeter (Kamera bzw. Umgebungslichtsensor), Kalibrierung,
   Messraster-Vorschlag, Protokoll mit Uo-Bewertung
5. **Energie** — Bestand vs. Neuanlage, kWh/a, Kosten, CO₂, Amortisation
6. **Elektro** — Betriebsstrom, Leuchten je LS-Schalter (Einschaltstrom), Stromkreise,
   Spannungsfall, Steuerungsvorschläge, Notbeleuchtung
7. **Bericht** — druckbare Zusammenfassung mit Grafiken, Stückliste, Prüfliste,
   JSON-Export/-Import

## Rechenwege
- **Lichtstromverfahren**: Φ = (Ē · A) / (η_R · MF), η_R aus tabellierten Raumwirkungs-
  graden über dem Raumindex, korrigiert um die Reflexionsgrade (`ETA_TAB`, `reflKorrektur`).
- **Punktrechnung** für die Karte: E = Σ I(θ)·cos θ / d² mit I(θ) = I₀·cos^s θ,
  s aus dem Halbstreuwinkel; dazu ein Interreflexionssockel nach Ulbricht/Sumpner.
  Die Karte wird auf das Lichtstromverfahren **normiert** — die Punktrechnung liefert
  die Form der Verteilung, die Tabelle das Niveau. (Ohne Normierung lagen beide
  Verfahren rund 40 % auseinander.)
- **Einschaltstrom**: Richtwert aus Impulsladung (A·µs) je LS-Charakteristik,
  an Hersteller-Tabellen angeglichen. Datenblatt hat Vorrang.

## Luxmeter-Genauigkeit
Liefert das Gerät `exposureTime` und `iso`, wird über den Belichtungswert gerechnet
(EV → Leuchtdichte → Beleuchtungsstärke über den Reflexionsgrad der Messfläche).
Sonst nur Bildhelligkeit — dann ist **Kalibrieren gegen ein echtes Luxmeter Pflicht**.
Der Faktor wird je Gerät gespeichert. Für Abnahmemessungen bleibt ein Messgerät
der Klasse C nötig; das ist in der App auch so vermerkt.

## Betrieb
```
systemctl --user restart v3dlicht.service     # Dienst
tailscale serve status | grep licht           # Funnel-Pfad
```
Funnel-Pfad neu setzen (nie `tailscale serve --set-path`, das killt 443):
```
tailscale funnel --bg --https=443 --set-path /licht http://127.0.0.1:8793
```

## Tests (Playwright, gegen den laufenden Dienst)
```
node tests/rechnung_test.mjs    # Rechenkern, Raster, Bericht
node tests/kamera_test.mjs      # Messweg mit simulierter Kamera, Kalibrierung
node tests/handy_test.mjs       # Handy-Layout, Druckansicht, Speichern
node tests/oberflaeche_test.mjs # Startkarte, Regler, Ergebniszeile, Wischen, App-Dateien
```
