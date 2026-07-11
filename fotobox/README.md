# Fotobox-Portal

Eltern-Galerie für Fotobox-Bilder: Registrierung mit E-Mail (oder Google),
danach Fotos ansehen, auswählen und als ZIP herunterladen.
Schwarz/Orange im Volme-3D-Look.

**Öffentliche Adresse:** https://v3da.tailf05fe9.ts.net/fotos

## Fotos online stellen

1. Ordner anlegen: `~/fotobox/photos/<datum-veranstaltung>/` (z. B. `2026-07-05-kita-sommerfest`)
2. JPGs reinkopieren — fertig, kein Neustart nötig.
3. Optional `event.json` in den Ordner legen:

```json
{ "title": "Kita-Sommerfest 2026", "code": "7777" }
```

- `title`: Anzeigename der Galerie (sonst wird der Ordnername genommen)
- `code`: Zugangscode (steht z. B. auf der Karte an der Fotobox). Ohne `code`
  sieht jeder Registrierte die Galerie. **Empfehlung bei Kinderfotos: immer einen Code setzen.**

Der Ordner `2026-07-05-kita-sommerfest` ist eine Test-Galerie (Code 7777) — löschen, wenn nicht mehr gebraucht.

## Buchungskalender

- Öffentlich (kein Login nötig): https://v3da.tailf05fe9.ts.net/fotos/buchen
- Belegte Tage (angefragt oder bestätigt) sind rot markiert und nicht wählbar.
- Pakete/Preise stehen in `server.js` in der `PACKAGES`-Konstante:
  Fotobox 89 €/Tag · mit Fotodrucker & Fotoflatrate 169 €/Tag.
- Neue Anfragen erscheinen im Admin unter „Buchungen“ (Status **angefragt**) —
  dort **Bestätigen** oder **Stornieren** (Storno gibt den Tag wieder frei).
  Der Kunde bekommt keine automatische Mail — melde dich per E-Mail (mailto-Link in der Liste).

## E-Mail-Adressen abrufen (Admin)

- Übersicht: `https://v3da.tailf05fe9.ts.net/fotos/admin?key=<adminKey aus config.json>`
- CSV-Export für Mailings: gleicher Link mit `/admin.csv`
- Die Spalte `werbung_ok` zeigt, wer die Werbe-Einwilligung angehakt hat —
  **nur an diese Adressen Werbung schicken** (Einwilligung + Zeitstempel werden gespeichert).

## Google-Anmeldung aktivieren (optional)

Der „Mit Google anmelden“-Button erscheint automatisch, sobald Zugangsdaten eingetragen sind:

1. https://console.cloud.google.com → Projekt anlegen → „APIs & Dienste“ → „Anmeldedaten“
2. „OAuth-Client-ID erstellen“ → Typ „Webanwendung“
3. Autorisierte Weiterleitungs-URI: `https://v3da.tailf05fe9.ts.net/fotos/auth/google/callback`
4. Client-ID und Client-Secret in `config.json` bei `googleClientId` / `googleClientSecret` eintragen
5. `systemctl --user restart fotobox.service`

## Betrieb

- Dienst: `fotobox.service` (Port 8788, nur localhost), Logs: `journalctl --user -u fotobox.service`
- Funnel-Pfad: `tailscale funnel --bg --set-path=/fotos http://127.0.0.1:8788` (eingerichtet)
- Daten: `data/users.json` (Registrierungen), `data/downloads.jsonl` (ZIP-Downloads)
- Thumbnails werden per ffmpeg in `cache/` erzeugt (beim ersten Aufruf)
- Keine npm-Abhängigkeiten — nur Node ≥ 18, ffmpeg und zip.
