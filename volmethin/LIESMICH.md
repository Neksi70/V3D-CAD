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

## Aufnehmen gehoert in eine VM

Nicht auf dem Arbeitsrechner packen. Zwei Gruende, der zweite ist der wichtigere:

1. Ein Arbeitsrechner rauscht. Defender-Definitionen, Browser-Update, OneDrive - alles
   landet zwischen den beiden Aufnahmen im Diff und damit im Paket.
2. **Der Diff zeigt nur Neues.** Bringen zwei Programme dieselbe VC-Runtime mit, steckt sie
   nur im ersten Paket - beim zweiten war sie schon da. Auf dem Kurs-PC startet Programm
   zwei dann nicht. Darum nach jedem Paket auf den Basis-Snapshot zurueckspulen.

Ablauf je Programm: VM auf *Basis* zurueck -> vorher aufnehmen -> installieren ->
nachher aufnehmen -> EXE bauen -> hochladen -> VM zurueck auf *Basis*.

### Die Basis muss dem Kurs-PC entsprechen

Was in der Basis schon vorhanden ist, taucht im Diff nicht auf und fehlt im Paket. Also
gehoert alles, was auf den Kurs-PCs ohnehin liegt (VC-Runtimes, .NET, Office), auch in die
Basis - sonst schleppt es jedes Paket unnoetig mit. Umgekehrt gilt genauso: was in der Basis
steckt, muss auf dem Kurs-PC wirklich da sein. Gleiche Windows-Fassung nehmen.

Basis einmal herrichten: Windows frisch aufsetzen, Updates durchziehen, den Grundbestand der
Kurs-PCs installieren, Windows Update und Defender-Updates fuer die Aufnahmezeit abschalten,
dann Snapshot "Basis".

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

## Verteilstelle

Der Server steht in der VHS, die Kurs-PCs fragen bei ihm nach. Kein Anfassen der einzelnen
Rechner mehr: im Browser anhaken, welcher Raum was bekommt, den Rest machen die Agenten.

```
VolmeThin (Arbeitsplatz)  --Upload-->  Verteilserver (VHS)  <--fragt nach--  Agent (Kurs-PC)
```

**Server einrichten** (einmalig, auf dem VHS-Rechner):

```
volmethin-server.exe
```

Beim ersten Start entsteht `config.json` neben der EXE mit Port (Vorgabe 8790), Admin- und
Agentschluessel. Die Weboberflaeche laeuft auf `http://<rechner>:8790`. Damit er dauerhaft
laeuft, als Dienst eintragen:

```
sc create VolmeThinServer binPath= "C:\VolmeThin-Server\volmethin-server.exe" start= auto
sc start VolmeThinServer
netsh advfirewall firewall add rule name="VolmeThin" dir=in action=allow protocol=TCP localport=8790
```

**Kurs-PC anbinden** (einmalig pro Rechner, als Administrator):

```
VolmeThinAgent.exe einrichten --server http://vhs-server:8790 --schluessel <Agentschluessel> --raum "Kursraum 1"
```

Der Agent kopiert sich nach `%ProgramData%\VolmeThin\Agent`, traegt sich als Dienst ein und
meldet sich fortan alle fuenf Minuten. Weitere Befehle: `jetzt` (sofort nachfragen, zum
Ausprobieren), `stand`, `entfernen`.

**Betrieb**: Fertige EXE in der Weboberflaeche ablegen oder direkt aus VolmeThin hochladen.
Dann im Bereich *Zuweisung* anhaken, welcher Raum sie bekommt. Der naechste Nachfragezyklus
holt sie. In der Rechnerliste steht pro Programm, ob es liegt, offen ist oder gescheitert ist.

Laedt man eine neue Fassung mit gleicher Kennung hoch, ziehen alle Rechner automatisch nach -
die alte Paketdatei wird dabei geloescht, damit der Server nicht zulaeuft.

### Benutzerteil ueber Active Setup

Der Agent laeuft als Systemdienst. Dessen `HKCU` ist das Dienstprofil und nicht das des
Kursteilnehmers. Alles unter `HKCU` traegt der Stub darum nicht selbst ein, sondern
hinterlegt sich als Active-Setup-Komponente. Windows ruft die EXE dann einmal pro Benutzer
bei der ersten Anmeldung mit `--vt-benutzer` auf und der Benutzerteil landet im richtigen
Profil. Dafuer muss die EXE liegen bleiben: sie wohnt unter
`%ProgramData%\VolmeThin\installiert\<kennung>.exe` und darf nicht aufgeraeumt werden.

### Schalter des Stubs

| Schalter | Wirkung |
|---|---|
| ohne | einrichten (falls noetig) und Anwendung starten |
| `--vt-einrichten` | nur einrichten, nichts starten, kein Fenster - das nutzt der Agent |
| `--vt-benutzer` | nur die HKCU-Werte schreiben - das ruft Active Setup auf |
| `--vt-info` | Paketangaben anzeigen |

Alles Uebrige wird an die gestartete Anwendung durchgereicht.

## Aufbau

| Teil | Aufgabe |
|---|---|
| `src/VolmeThin.Core` | Paketformat `.v3pkg`, Pfad-Makros, Overlay-Anhang, Registry-Zugriff |
| `src/VolmeThin.Capture` | Snapshots, Ausschlusslisten, Diff, Paketbau |
| `src/VolmeThin.Stub` | Launcher-EXE, die spaeter das Paket traegt (12 MB, ohne .NET auf dem Ziel) |
| `src/VolmeThin.Builder` | Kommandozeile + Zusammenbau + Symbolwechsel |
| `src/VolmeThin.App` | WPF-Oberflaeche in drei Schritten |
| `src/VolmeThin.Server` | Verteilserver mit Weboberflaeche (ASP.NET Core, JSON-Dateien statt Datenbank) |
| `src/VolmeThin.Agent` | Windows-Dienst auf den Kurs-PCs, holt zugewiesene Programme |
| `tests/VolmeThin.Tests` | Testlaeufer fuer Paket, Overlay und Pfad-Makros |
| `tests/server-test.sh` | Durchstich: bauen, hochladen, zuweisen, abholen, zurueckmelden |

Paketformat: ZIP mit `package.json` und `files/00001.bin`. Inhaltsgleiche Dateien
werden nur einmal gespeichert. In der Einzeldatei haengt dieses ZIP hinter dem Stub,
abgeschlossen von `[int64 Laenge][int32 Version]["V3THINPK"]`.

## Bauen

```
./publish.sh                          # erzeugt alle drei Pakete unter build/
dotnet run --project tests/VolmeThin.Tests
./tests/server-test.sh                # braucht vorher ./publish.sh
```

Es entstehen drei Ordner: `VolmeThin` (Arbeitsplatz), `VolmeThin-Server` (VHS-Rechner),
`VolmeThin-Agent` (Kurs-PCs, 15 MB).

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
- **Der Server kennt keine Benutzer.** Ein Adminschluessel fuer die Oberflaeche, ein
  Agentschluessel fuer die Anmeldung. Fuer ein Hausnetz reicht das; ins offene Internet
  gehoert er nur hinter HTTPS.
- **Keine Signatur.** Unsignierte EXEs mit unbekanntem Namen bekommen beim ersten Start
  den SmartScreen-Hinweis "Weitere Informationen -> Trotzdem ausfuehren".
