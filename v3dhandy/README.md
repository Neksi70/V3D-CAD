# V3D Handy — Claude steuert das Handy

Das Gegenstueck zu „Claude in Chrome" fuers Android-Handy. Eine kleine App
mit Bedienungshilfe (AccessibilityService) liest den Bildschirm jeder App als
Elementbaum, tippt, wischt, schreibt Text und macht Screenshots. Claude spricht
das Ganze ueber MCP an, genau wie den Browser.

## Aufbau
* `server.py` — Python-Stdlib, Port 8794, nur 127.0.0.1. Zwei Seiten:
  * Handy: `POST /api/geraet/warten` (Long-Polling, 25 s), Geraete-Schluessel
    als Bearer. Das Ergebnis des vorigen Befehls kommt im selben Aufruf mit.
  * Claude: `POST /api/mcp/<mcpKey>` — JSON-RPC wie bei V3D Mail (Streamable
    HTTP ohne Ereignisstrom).
* `android/` — Kotlin-App `com.volme3d.handy`, Label „V3D Handy":
  * `BedienService` — die Bedienungshilfe (lesen, tippen, wischen, Text, Screenshot, Apps).
  * `AgentService` — Vordergrund-Dienst mit der Poll-Schleife; die
    Benachrichtigung „Fernsteuerung an" hat einen Stopp-Knopf.
  * `MainActivity` — Server-Adresse, Geraete-Schluessel, Schalter.
* `config.json` — `geraeteKey` (in die App) und `mcpKey` (fuer Claude), beim
  ersten Start gewuerfelt, 0600, nicht im Git.
* `v3dhandy.service` — User-Unit, `systemctl --user status v3dhandy`.
* `V3D-Handy-<Version>.apk` — signierte Release-APK, auch unter
  `https://v3da.tailf05fe9.ts.net/handy/apk` abholbar.

## Erreichbar
`https://v3da.tailf05fe9.ts.net/handy/` — Funnel (`tailscale funnel --bg --set-path /handy 8794`).
Der Funnel schneidet `/handy` ab; der Server versteht beides.

## Einrichten auf dem Handy
1. APK installieren (`/handy/apk`), App oeffnen.
2. „Bedienungshilfen oeffnen" → V3D Handy einschalten (Android warnt, das ist normal).
3. Server-Adresse steht schon drin; Geraete-Schluessel aus `config.json` eintragen, Speichern.
4. Schalter „Fernsteuerung durch Claude erlauben" an. Oben erscheint „● Verbunden".
5. „Akku-Optimierung aus", sonst kappt Android die Verbindung im Ruhezustand.

## Claude anbinden
* Claude Code auf V3DA (schon eingetragen, Nutzer-Ebene):
  `claude mcp add --transport http --scope user v3dhandy http://127.0.0.1:8794/api/mcp/<mcpKey>`
* Claude Desktop / Cowork / Claude.ai: eigener Connector mit
  `https://v3da.tailf05fe9.ts.net/handy/api/mcp/<mcpKey>`

## Werkzeuge
`status`, `bildschirm_lesen`, `screenshot`, `tippen`, `text_eingeben`,
`wischen`, `taste`, `app_oeffnen`, `apps_auflisten`, `warten`.
Ablauf wie bei Claude in Chrome: lesen → mit Element-Nummer tippen → wieder lesen.
Koordinaten sind Bildschirm-Pixel; wer aus dem Screenshot abliest, gibt
`aus_screenshot=true` mit (der Server rechnet den Faktor um).

## Was ich weiss und was nicht
* Getestet im Emulator (Android 14): Einstellungen, Suche mit Texteingabe,
  Chrome inkl. Webinhalt (Links, Texte), Screenshot, Zurueck/Home, Wischen.
* **Chrome liefert den Webinhalt nur, wenn der Dienst wie ein Screenreader
  aussieht** (`feedbackSpoken` + `typeAllMask` in `bedienhilfe.xml`). Mit
  `feedbackGeneric` bleibt der WebView leer — kostete eine Runde.
* Screenshots brauchen einen eingeschalteten, entsperrten Bildschirm. Apps mit
  Kopierschutz (Banking) liefern schwarz. `taste wecken` schaltet den
  Bildschirm an, entsperren kann es nicht.
* `targetSdk` bleibt bewusst 34: ab 35 begrenzt Android dataSync-Vordergrund-
  dienste auf 6 h pro Tag.
* Noch nicht am echten Fold 7 getestet (Handy war beim Bau offline).

## Sicherheit
Das ist Vollzugriff aufs Handy. Der Geraete-Schluessel gehoert nur in die
App, der MCP-Schluessel nur in Claude. Beide stehen in `config.json` und lassen
sich dort tauschen (Dienst neu starten). Der Schalter in der App bzw. „Stopp"
in der Benachrichtigung beendet sofort alles; Bedienungshilfe aus = nichts geht mehr.
Nichts Unumkehrbares (Kaufen, Senden, Loeschen) ohne ausdruecklichen Auftrag —
steht auch in der MCP-Anleitung fuer Claude.

## Bauen
    cd android && JAVA_HOME=/home/v3da/android-toolchain/jdk17 \
      /home/v3da/android-toolchain/gradle/bin/gradle --offline assembleRelease
    cp app/build/outputs/apk/release/app-release.apk ../V3D-Handy-1.0.apk

`keystore.jks` + `signing.properties` (nicht im Git, **nicht loeschen**).

## Test im Emulator
    ~/android-toolchain/sdk/emulator/emulator -avd test34 -no-window -no-audio -no-snapshot &
    adb install -r android/app/build/outputs/apk/debug/app-debug.apk
    adb shell settings put secure enabled_accessibility_services com.volme3d.handy/com.volme3d.handy.BedienService
    adb shell settings put secure accessibility_enabled 1
    adb shell am start -n com.volme3d.handy/.MainActivity --es url http://10.0.2.2:8794 --es key <geraeteKey> --ez start true

Die Intent-Extras gelten nur im Debug-Build. Nach jedem `adb install` den
Dienst so neu starten — ein App-Update beendet den Vordergrund-Dienst.
