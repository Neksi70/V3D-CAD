# V3D Antwort

WhatsApp-Nachricht → Knopf „🤖 Mit Claude antworten“ → nette Antwort mit Terminvorschlägen → Senden.

## Teile
- `server.py` (`v3dantwort.service`, 127.0.0.1:8821, Funnel `/antwort`): holt freie Zeiten aus
  V3D-Mail-Kalender + Familienkalender (über `~/v3d-mail-mcp/v3dmcp`) und fragt `claude -p` ohne Werkzeuge
  in einem leeren Ordner (`/tmp/v3dantwort-leer`, damit kein Projekt-CLAUDE.md/Hooks mitlaufen). ~4–8 s.
  Protokolliert nur Längen/Dauer, keine Inhalte. Schlüssel in `config.json` (600, nicht im git).
- `android/` (com.volme3d.antwort): BlaseService (Bedienungshilfe) zeigt in WhatsApp-Chats einen schwebenden 🤖 (TYPE_ACCESSIBILITY_OVERLAY), liest sichtbare Nachrichten (links = Gegenüber) und fügt die Antwort per ACTION_SET_TEXT ins Feld `entry` ein. Dazu NotificationListener liest WhatsApp + WhatsApp Business, legt eine
  eigene Benachrichtigung mit Knopf daneben. „Senden“ nutzt den Antworten-Knopf (RemoteInput) der
  WhatsApp-Benachrichtigung; ist die weg → Kopieren + Chat öffnen. Außerdem Teilen-Ziel / Text markieren.
  `keystore.jks` + `signing.properties` NIE löschen (gitignored).
- `android-test-wa/`: Attrappe mit Paketname com.whatsapp – NUR Emulator. `.Start` = Benachrichtigung mit Antworten-Knopf, `.Chat` = Chat-Bildschirm mit WhatsApps View-IDs (entry, message_text, conversation_contact_name) für den schwebenden Knopf.
- `index.html`: Web-Variante (Text einfügen → Antwort), `https://v3da.tailf05fe9.ts.net/antwort/?key=…`

## Terminregeln (config.json überschreibt STANDARD in server.py)
Mo–Fr, je Tag max. ein Vorschlag pro Fenster 9–12 / 14–16 / 16–18, 60 min, 30 min Puffer,
2 h Abstand, ab 20 h Vorlauf, 14 Tage. Ganztägige Einträge blocken nur bei Feiertag oder Wörtern
wie Urlaub/Messe/krank; Familientermine nur, wenn `person` Volker/leer ist.

## Bauen / Testen
    python3 test_server.py
    cd android && JAVA_HOME=~/android-toolchain/jdk17 ~/android-toolchain/gradle/bin/gradle --no-daemon assembleRelease
Einrichtung am Handy: `https://v3da.tailf05fe9.ts.net/antwort/einrichten?key=<key>` → Link tippen.
