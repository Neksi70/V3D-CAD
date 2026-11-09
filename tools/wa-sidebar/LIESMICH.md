# WA Seitenleiste

Schmale Leiste am Bildschirmrand (wie die Opera-Seitenleiste) mit
**WhatsApp privat** und **WhatsApp Business** nebeneinander, unabhängig vom Browser.
Läuft mit der Edge-Engine (WebView2), die bei Windows 10/11 schon installiert ist.

## Start
`WaSidebar.exe` irgendwohin legen (z. B. `C:\Tools\WaSidebar\`) und starten.
Beim ersten Start klappt die Leiste auf: bei **P** (privat) und **B** (Business)
jeweils einmal mit dem Handy den QR-Code scannen. Danach bleiben beide angemeldet.

## Bedienung
| Aktion | So geht's |
|---|---|
| Dienst öffnen / wieder zuklappen | Icon in der Leiste anklicken |
| Leiste auf-/zuklappen | **Strg+Alt+W** oder Tray-Icon anklicken |
| Direkt zu Dienst 1, 2, … | Strg+Umschalt+Alt+1, 2, … |
| Breite ändern | Am inneren Rand der offenen Leiste ziehen |
| Anheften (Fenster weichen aus) | Pin-Knopf unten in der Leiste |
| Einstellungen | „⋯“ unten in der Leiste oder Rechtsklick aufs Tray-Icon |

## V3D Tools in der Leiste
Menü „⋯“ → **V3D Tools auswählen …**: Alle Tools erscheinen nach Bereichen sortiert zum Anhaken.
Die Liste kommt live von https://v3da.tailf05fe9.ts.net/tools/. Neue Tools tauchen also
automatisch auf. Ist die Seite nicht erreichbar, gilt eine eingebaute Liste.
- V3D Tools haben eckige Icons und stehen unter WhatsApp. Bei vielen Tools mit dem Mausrad scrollen.
- Alle V3D Tools teilen sich ein Anmelde-Profil. Einmal anmelden reicht also für alle Tools auf demselben Server.
- Sie laden erst beim ersten Klick.
- Rechtsklick auf ein Icon → „Im Browser öffnen“.
- **Angemeldet bleiben:** Sitzungen der V3D Tools überstehen einen Neustart (30 Tage).
- **PIN merken:** Bei reinen PIN-Anmeldungen (Mail, Rechnung, Familie …) merkt sich die Leiste
  die PIN nach der ersten erfolgreichen Anmeldung und trägt sie künftig selbst ein.
  - Gespeichert wird sie verschlüsselt mit Windows (DPAPI) in `pins.dat`, lesbar nur für dein Windows-Konto.
  - Eine falsche PIN wird automatisch vergessen.
  - Seiten mit E-Mail + Passwort fasst die Leiste nicht an.
  - Abschalten oder löschen geht im Menü „⋯“.
- Google-Anmeldung (z. B. V3D CAD) öffnet sich in einem kleinen Fenster der App.

Im Menü: Seite links/rechts, Bildschirm, Benachrichtigungen, **Mit Windows starten**,
Dienst hinzufügen (z. B. Telegram, Signal-Web, Outlook), Beenden.
Rechtsklick auf ein Dienst-Icon: neu laden / entfernen.

- Ungelesene Nachrichten: rote Zahl am Icon, roter Punkt am Tray-Icon.
- Neue Nachricht: Windows-Benachrichtigung. Ein Klick darauf öffnet den Chat.
- Links aus Chats öffnen sich im normalen Browser.
- Fenster schließen (Alt+F4) blendet nur aus. Wirklich beenden über das Menü.

## Daten
`%LOCALAPPDATA%\WaSidebar\`: `settings.json` plus je Dienst ein eigener Profilordner
unter `profiles\`. Ordner löschen = abmelden.

## Selbst bauen
.NET 8 SDK, dann im Ordner `tools/wa-sidebar`:
```
dotnet publish -c Release -o out
```
Ergebnis: `out\WaSidebar.exe` (eigenständig, braucht kein installiertes .NET).
