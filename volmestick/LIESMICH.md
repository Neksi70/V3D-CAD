# VolmeStick

Windows-Installationsmedien bauen — wie Rufus, aber zusätzlich **als ISO**,
damit sie sich direkt in VMware einbinden lässt.

**Grundsatz: VolmeStick arbeitet immer nur für den Rechner, auf dem es läuft.**
Ein USB-Stick lässt sich nur dort beschreiben, wo er steckt — also läuft die App
auf deinem Arbeitsplatz, nicht auf dem Server.

Der Server (V3DA) ist reine **Verteilstelle**: Ruft man ihn aus dem Netz auf,
zeigt er nur eine Startseite mit dem Paket zum Selberstarten. Alle arbeitenden
Endpunkte antworten von außen mit 403 — es landen also keine Abbilder auf dem
Server, und niemand kann dessen Datenträger anfassen.

| Aufruf | was passiert |
|---|---|
| `localhost:8775` | die volle App: Abbilder laden, Stick schreiben, ISO bauen |
| `<server>:8775` aus dem Netz | Startseite: Paket herunterladen + Antwort-ISO erzeugen |

So kommst du auf deinem Rechner los:

* **Windows** — ZIP von der Startseite, entpacken,
  `windows\Weboberflaeche-starten.bat` doppelklicken (holt sich selbst
  Administratorrechte und öffnet den Browser). Alternativ `windows\EXE-bauen.bat`
  für `VolmeStick.exe` (Fenster im Rufus-Aufbau) und `VolmeStick-Web.exe`.
* **Linux** — `./start.sh` (startet sich per sudo neu und öffnet den Browser).

Wer es doch aus dem Netz voll bedienen will — etwa ein Linux-Rechner, an dem der
Stick steckt, ohne Bildschirm — startet mit `--fernzugriff`. Dann werden die
Datenträger *dieses* Rechners angeboten.

## ISO für VMware: die Antwort-ISO

Für eine virtuelle Maschine braucht es weder Stick noch ISO-Umbau. Windows Setup
sucht die `autounattend.xml` auf **jedem** angeschlossenen Laufwerk. VolmeStick
erzeugt deshalb eine 60 KB kleine ISO, die nur diese Datei enthält:

```bash
python3 vstick.py antwort -o autounattend.iso --benutzer kurs
```

In VMware die Original-ISO wie gewohnt einbinden und ein **zweites CD-Laufwerk**
mit `autounattend.iso` hinzufügen — fertig. Die große ISO bleibt unangetastet,
und es braucht kein `xorriso` (das es unter Windows ohnehin nicht gibt).

Den kompletten Umbau der großen ISO gibt es weiterhin (`vstick.py iso`), er
lohnt sich aber vor allem, wenn das Medium ohne Zweitlaufwerk auskommen muss.

> **Nicht in den Tailscale-Funnel legen.** Das Werkzeug löscht Datenträger.
> Heimnetz/Tailnet reicht.

## Was es abnimmt

Alles landet in einer `autounattend.xml` im Wurzelverzeichnis des Mediums —
Windows Setup liest sie von selbst. Kein Eingriff ins Abbild, also auch keine
kaputte Signatur.

* Hardware-Sperren aus: TPM 2.0, Secure Boot, RAM, CPU, Datenträger
* Kein Microsoft-Konto, Installation ohne Internet (BypassNRO)
* Datenerhebung aus: Telemetrie, Werbe-ID, vorgeschlagene Apps, Datenschutzfragen
* Keine automatische BitLocker-Verschlüsselung
* Aufgeräumtes Windows: Copilot, OneDrive-Zwang, Outlook/Dev-Home-Nachinstallation,
  Schnellstart, Widgets, Chat-Symbol, Bing-Suche im Startmenü
* Lokales Konto (Administrator), Computername, Sprache/Tastatur/Zeitzone, Edition
* Dateiendungen im Explorer, interne Platten offline lassen (Windows-vom-Stick)

## Abbild herunterladen

| Quelle | was |
|---|---|
| **WinFuture** | Windows 11 / 10 (Deutsch), Spiegel der Microsoft-ISOs |
| **Linux** | Ubuntu, Mint, Debian, Fedora, openSUSE, Arch, Pop!_OS, Kali, Rocky, AlmaLinux |
| **anderer VolmeStick** | der Abbild-Bestand eines zweiten Rechners im Netz |

Die Linux-Adressen werden bei den offiziellen Projektspiegeln **live aufgelöst** —
es steht also nie eine veraltete Fassung in der Liste. Bei WinFuture sind die
Adressen zeitsigniert und werden erst unmittelbar vor dem Laden geholt.

*Microsofts eigene Download-API ist absichtlich nicht angebunden: sie weist
Anfragen von Server- und VPN-Adressen über ihren Bot-Schutz ab. WinFuture
liefert denselben deutschen Datenbestand ohne diese Sperre.*

### Nichts zweimal laden

Abbilder landen in `~/Downloads/VolmeStick` (bzw. `~/VolmeStick-Abbilder`).
Vor dem Anzeigen wird mit diesem Bestand abgeglichen:

* **schon da** — Datei liegt vollständig vor (Größenvergleich per HEAD-Abfrage).
  Statt eines Downloads gibt es „Diese verwenden“, das sie direkt als Quelle setzt.
* **unvollständig** — angefangener Download, wird per Range fortgesetzt.
* **neuere Fassung** — z. B. `Win11_25H2_German_x64.iso`, wo `Win11_24H2_German_x64.iso`
  liegt. Nur dann lohnt der Download wirklich, und genau das steht dann dran.

Die Zusammengehörigkeit erkennt `bestand.py` am Dateinamen: versionsartige
Bestandteile werden ausgeblendet, der Rest muss übereinstimmen. `Win10` und
`Win11` oder `x64` und `Arm64` fallen dabei ausdrücklich **nicht** zusammen.

Wo die Quelle eine `SHA256SUMS`-Datei mitliefert (bei Linux fast überall), wird die
Prüfsumme **während des Ladens** mitgerechnet und am Ende verglichen. Stimmt sie
nicht, landet die Datei als `.unvollstaendig` daneben statt auf dem Stick.

Linux-Abbilder sind Hybrid-ISOs: sie werden 1:1 geschrieben (DD-Modus), das
erkennt der Schreibmodus „Automatisch" von selbst.

## Bedienung

```bash
python3 vstick.py analyse  Win11.iso                   # was steckt drin?
python3 vstick.py iso      Win11.iso -o Win11-v3d.iso --benutzer kurs
python3 vstick.py geraete                              # Wechseldatenträger
sudo python3 vstick.py stick Win11.iso /dev/sdb --benutzer kurs
python3 vstick.py pruefsumme Win11.iso
sudo python3 vstick.py blockpruefung /dev/sdb          # Fälschung? (löscht alles)
```

Standardmäßig sind alle Umgehungen **an**. Abschalten mit `--kein-hardware-bypass`,
`--mit-microsoft-konto`, `--mit-datenerhebung`, `--mit-bitlocker`, `--kein-qol`.

Weiter: `--modus auto|windows|dd|leer`, `--schema gpt|mbr`,
`--dateisystem auto|fat32|ntfs|exfat`, `--label`, `--langsam-formatieren`.

## Stick-Aufbau

* **GPT + FAT32** (Standard) — startet auf jeder UEFI-Firmware, auch in VMware.
* Ist `install.wim` größer als 4 GB (Windows 11 Multi-Edition), wird der Stick
  **zweigeteilt**: FAT32 zum Starten, NTFS für das Abbild. Windows Setup findet
  das Abbild auf der zweiten Partition.
* **MBR** für alte BIOS-Rechner. Der BIOS-Bootcode kommt unter Windows aus
  `boot\bootsect.exe` der ISO, unter Linux aus `ms-sys` (falls installiert) —
  sonst startet der Stick nur über UEFI, und das Programm sagt es.

## Bauen

ISO-Umbau braucht `xorriso` (überträgt BIOS- und UEFI-Startsätze 1:1):

```bash
sudo apt install xorriso
```

Fehlt es, gibt es einen Notnagel über `genisoimage` — der taugt aber nur für
Abbilder unter 4 GB.

Windows-EXE (auf einem Windows-Rechner, Python 3.10+ mit `tkinter`):

```
windows\EXE-bauen.bat
```

Ergebnis: `windows\dist\VolmeStick.exe`, fordert beim Start Administratorrechte an.

## Dateien

| Datei | Inhalt |
|---|---|
| `vstick.py` | Kern: Analyse, ISO-Bau, Stick schreiben, Prüfsummen, Blockprüfung |
| `unattend.py` | erzeugt die `autounattend.xml` |
| `iso9660.py` | eigener ISO9660/Joliet-Leser (kein root, kein 7z nötig, auch > 4 GB) |
| `wim.py` | liest die Editionsliste aus `install.wim`/`.esd` |
| `download.py` | Windows-Abbilder vom WinFuture-Spiegel, Download mit Prüfsumme |
| `linuxisos.py` | löst die Downloadadressen von zehn Linux-Distributionen live auf |
| `bestand.py` | erkennt, was schon da ist und was ein echter Versionswechsel wäre |
| `isowriter.py` | schreibt die kleine Antwort-ISO (ISO9660 + Joliet, reines Python) |
| `web/verteil.html` | Startseite für Aufrufe aus dem Netz |
| `server.py`, `web/ui.html` | Weboberfläche |
| `windows/vstick_gui.pyw` | Windows-Fenster |

## Was Rufus kann und VolmeStick (noch) nicht

* Windows To Go (Windows direkt vom Stick betreiben)
* Persistente Partition für Linux-Live-Systeme
* FreeDOS-, Syslinux-, GRUB-, ReactOS-Medien
* Cluster-Größe wählen, „erweiterte Bezeichnung/Symbole"
* Prüfung auf zurückgezogene UEFI-Bootloader (DBX), `SkuSiPolicy.p7b`
* Die „stille" Installation, die die Zielplatte ohne Rückfrage löscht — bewusst nicht.

Windows-Abbilder kommen ausschließlich über den WinFuture-Spiegel; Microsofts
eigene Download-API sperrt automatisierte Abrufe.
