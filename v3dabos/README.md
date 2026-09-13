# V3D Abos

Android-App, die kostenpflichtige Abos sichtbar macht, ihre tatsächliche Nutzung misst
und beim Kündigen den kürzesten Weg zeigt. Alle Daten bleiben auf dem Handy
(`abos.json` im App-Speicher), die App hat **keine Internet-Berechtigung**.

## Was die App kann – und was Android nicht zulässt

Es gibt **keine Android-Schnittstelle, die fremde Abos auflistet oder kündigt.**
Google Play Billing gibt einer App nur Auskunft über *ihre eigenen* Käufe, und ein
Vertrag lässt sich programmatisch nicht beenden. Jede App, die etwas anderes verspricht,
tut in Wahrheit eins der drei Dinge, die V3D Abos macht:

| Aufgabe | Wie es hier gelöst ist |
|---|---|
| **Nutzung messen** | `UsageStatsManager`: letzte Benutzung und Vordergrundminuten je App über 30/90 Tage. Echte Messung, keine Schätzung. |
| **Abos finden** | (1) installierte Apps gegen einen Katalog bekannter Abo-Dienste, (2) Kontoauszug/Kreditkarten-CSV nach wiederkehrenden Abbuchungen durchsuchen, (3) von Hand. |
| **Kündigen** | Play-Abos per Deep-Link direkt auf ihre Kündigungsseite, Anbieter-Abos über die hinterlegte Kündigungsseite plus fertiges Kündigungsschreiben (Textform, § 126b BGB) per E-Mail/Teilen/Zwischenablage. Den letzten Klick macht der Mensch. |

## Funktionen

- **Monatssumme und Jahreskosten** aller aktiven Abos auf einen Blick
- **Ampel je Abo**: rot = seit ≥ 30 Tagen nicht benutzt, gelb = kaum benutzt oder nicht
  messbar, grün = in Benutzung, grau = gekündigt
- **Kosten je Nutzungsstunde** – macht teure Karteileichen sofort erkennbar
- **„… ungenutzt → x € im Jahr sparen"** als Kopfzeile
- **Kontoauszug-Import**: CSV laden oder Umsätze einfügen; erkennt wiederkehrende
  Buchungen samt Intervall (wöchentlich bis jährlich), auch für Abos ohne App
  (Zeitung, Fitnessstudio, Versicherung)
- **Kündigungsfristen**: letzter Kündigungstag wird aus Zahltermin und Frist gerechnet,
  Zahltermine werden automatisch fortgeschrieben, tägliche Erinnerung per Benachrichtigung
- **Kündigungsschreiben** mit Absender, Kunden-/Vertragsnummer, Widerspruch gegen
  stillschweigende Verlängerung und Bitte um Bestätigung in Textform
- **Export/Import** der Abo-Liste als JSON

## Erste Schritte

1. APK installieren, App öffnen.
2. Den gelben Hinweis antippen → **Zugriff auf Nutzungsdaten** für V3D Abos erlauben.
   (Systemeinstellung, lässt sich nicht per Dialog anfragen.) Ohne sie läuft alles außer
   der Nutzungsmessung.
3. **Apps prüfen** → ankreuzen, was man wirklich bezahlt.
4. **Kontoauszug** → Umsätze mehrerer Monate einfügen; das findet auch Abos ohne App.
5. Beträge und Zahltermine in den Abos nachziehen – der Katalog liefert nur Richtwerte.
6. In den **Einstellungen** Absenderdaten hinterlegen, dann sind Kündigungsschreiben
   sofort fertig.

## Build

```bash
export JAVA_HOME=~/android-toolchain/jdk17
export PATH=$JAVA_HOME/bin:$PATH
export ANDROID_HOME=~/android-toolchain/sdk
~/android-toolchain/gradle/bin/gradle --no-daemon assembleRelease
```
APK: `app/build/outputs/apk/release/app-release.apk`

Tests (reine Auswertungslogik – Kontoauszug-Parser, Bewertung, Kündigungsschreiben):
```bash
~/android-toolchain/gradle/bin/gradle --no-daemon testDebugUnitTest
```

Auf dem Emulator prüfen:
```bash
~/android-toolchain/sdk/emulator/emulator -avd test34 -no-window -no-audio -no-snapshot &
adb install -r app/build/outputs/apk/release/app-release.apk
adb shell appops set com.volme3d.v3dabos GET_USAGE_STATS allow   # Sonderberechtigung setzen
```

## Signatur

`keystore.jks` + `signing.properties` liegen nur lokal (beide in `.gitignore`).
**Nicht löschen** – Updates müssen mit demselben Schlüssel signiert sein, sonst verweigert
Android die Installation über die vorhandene App.

## Aufbau

| Datei | Inhalt |
|---|---|
| `Abo.kt` | Datenmodell, Intervalle, Bewertungslogik (Ampel, Kosten je Stunde, Fristberechnung) |
| `Katalog.kt` | bekannte Abo-Dienste: Paketname, Richtpreis, Kündigungsweg, Buchungstextbausteine |
| `KontoParser.kt` | Kontoauszug → Buchungen → wiederkehrende Abbuchungen |
| `Kuendigung.kt` | Kündigungsschreiben und Play-Deep-Link |
| `NutzungQuelle.kt` | Nutzungsmessung (Tagesblöcke + Ereignisliste), installierte Apps |
| `Store.kt` | Persistenz als JSON, Absenderdaten, Einstellungen |
| `Fristen.kt` | Terminfortschreibung, tägliche Prüfung, Benachrichtigung |
| `*Activity.kt` | Liste, Bearbeiten, App-Prüfung, Kontoauszug-Import, Kündigen, Einstellungen |

### Fallstricke, die schon zugeschlagen haben

- **Aggregierte Nutzungsdaten hinken hinterher.** `queryAndAggregateUsageStats` enthält den
  laufenden Tag oft noch nicht – eine gerade benutzte App sah tot aus. Deshalb kommt
  `queryEvents` der letzten Woche dazu; genommen wird der größere Wert.
- **Datum sieht aus wie ein englischer Betrag.** „05.03.2026" matchte als `05.03` und kippte
  die Erkennung des Zahlenformats. Datumsangaben werden vor der Betragssuche ausmaskiert.
- **`String.format` hängt am Geräte-Locale.** Auf englisch eingestellten Handys stand
  „13.99 €“. Beträge und Daten werden mit `Locale.GERMANY` formatiert.
