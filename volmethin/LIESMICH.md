# VolmeThin

Anwendungen einmal installieren, als Paket einfangen und als **eine einzige EXE**
auf die Kurs-PCs bringen. Angelehnt an VMware ThinApp Setup Capture.

## So laeuft es

1. **Vorher aufnehmen** – Zustand von Dateisystem und Registry wird festgehalten.
2. **Installieren** – Setup ganz normal durchklicken, Programm einmal starten und schliessen.
3. **Nachher aufnehmen** – der Unterschied ist das Paket.
4. **Bauen** – Paket wird hinten an den Launcher (Stub) gehaengt: fertig ist die Einzeldatei.

Auf dem Kurs-PC: Doppelklick. Beim ersten Mal packt der Launcher alles aus und schreibt
die Registry-Eintraege, danach startet er nur noch das Programm.

## Bedienung

Oberflaeche: `VolmeThin.exe` (fragt beim Start nach Adminrechten – noetig fuer Program Files und HKLM).

Kommandozeile fuer wiederkehrende Sachen:

```
volmethin-cli vorher  vorher.snap
volmethin-cli nachher vorher.snap --out libreoffice.v3pkg --name "LibreOffice" --version 7.6.4
volmethin-cli bauen   libreoffice.v3pkg --out LibreOffice.exe
volmethin-cli info    LibreOffice.exe
```

## Die zwei Betriebsarten

| | **Installieren** (Standard) | **Portabel** |
|---|---|---|
| Dateien | an die Originalpfade (`C:\Program Files\...`) | `%LOCALAPPDATA%\VolmeThin\<id>\<version>` |
| Registry | in die echten Zweige | HKLM/HKCR werden nach HKCU umgebogen |
| Rechte | Adminrechte beim ersten Start | keine noetig |
| Ergebnis | wie eine normale Installation, nur aus einer Datei | Rechner bleibt sauber, `Nach dem Beenden aufraeumen` moeglich |

Portabel funktioniert nur, solange die Anwendung ihre HKLM-Eintraege nicht zwingend
braucht. Es gibt **keine** Umleitung von Dateizugriffen zur Laufzeit – dafuer waere
API-Hooking noetig, das VolmeThin bewusst nicht macht. Fuer Kursraeume mit Adminzugang
ist der Installationsmodus der verlaessliche Weg.

## Aufbau

| Teil | Aufgabe |
|---|---|
| `src/VolmeThin.Core` | Paketformat `.v3pkg`, Pfad-Makros, Overlay-Anhang, Registry-Zugriff |
| `src/VolmeThin.Capture` | Snapshots, Ausschlusslisten, Diff, Paketbau |
| `src/VolmeThin.Stub` | Launcher-EXE, die spaeter das Paket traegt (12 MB, ohne .NET auf dem Ziel) |
| `src/VolmeThin.Builder` | Kommandozeile + Zusammenbau + Symbolwechsel |
| `src/VolmeThin.App` | WPF-Oberflaeche in drei Schritten |
| `tests/VolmeThin.Tests` | Testlaeufer fuer Paket, Overlay und Pfad-Makros |

Paketformat: ZIP mit `package.json` und `files/00001.bin`. Inhaltsgleiche Dateien
werden nur einmal gespeichert. In der Einzeldatei haengt dieses ZIP hinter dem Stub,
abgeschlossen von `[int64 Laenge][int32 Version]["V3THINPK"]`.

## Bauen

```
./publish.sh          # erzeugt build/VolmeThin (laeuft auch unter Linux)
dotnet run --project tests/VolmeThin.Tests
```

Der Stub laesst sich auf einem Windows-Rechner deutlich kleiner bekommen
(12 MB -> ca. 4 MB), weil dort NativeAOT verfuegbar ist:

```
dotnet publish src\VolmeThin.Stub -c Release -p:PublishAot=true -p:PublishSingleFile=false -o build\stub
```

## Was VolmeThin nicht macht

- **Keine echte Virtualisierung.** Kein API-Hooking, keine Sandbox. Der Installationsmodus
  installiert wirklich, nur eben aus einer Datei und ohne Klickstrecke.
- **Keine Dienste und Treiber.** Werte unter `HKLM\SYSTEM\CurrentControlSet\Services`
  werden mitgenommen, aber kein Dienst registriert oder gestartet.
- **WinSxS bleibt aussen vor.** Bringt ein Setup VC- oder .NET-Runtimes ueber MSI mit,
  fehlen die im Paket. Solche Runtimes gehoeren einmal separat auf die Kurs-PCs.
- **Keine Signatur.** Unsignierte EXEs mit unbekanntem Namen bekommen beim ersten Start
  den SmartScreen-Hinweis "Weitere Informationen -> Trotzdem ausfuehren".
