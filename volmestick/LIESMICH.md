# VolmeStick

Windows-Installationsmedien bauen — wie Rufus, aber zusätzlich **als ISO**,
damit sie sich direkt in VMware einbinden lässt.

**Was wo läuft:** Die Weboberfläche ist von überall im Netz voll bedienbar —
Abbild herunterladen, ISO für VMware bauen, Prüfsummen. Gesperrt ist nur, was
die Datenträger des jeweiligen Rechners anfasst: **USB-Sticks lassen sich nur
dort schreiben, wo sie stecken.** Ruft man den Server aus dem Netz auf, wird der
Stick-Bereich deshalb ausgeblendet und stattdessen das Paket für den eigenen
Rechner angeboten (`/paket`).

**Der Server bleibt dabei sauber.** Abbilder gelten als Durchlaufposten:

* Die fertige ISO wird beim Herunterladen automatisch von dort entfernt.
* „Quell-ISO nach dem Bauen entfernen“ ist bei entfernter Bedienung vorausgewählt.
* Eine Leiste zeigt jederzeit, was gerade belegt ist — mit einem Knopf
  „Alles entfernen“.

Für den USB-Stick am Arbeitsplatz: `/paket` öffnen, ZIP laden (ca. 11 MB),
entpacken und `VolmeStick starten.bat` doppelklicken. **Python muss dafür nicht
installiert sein** — das Paket bringt eine eigene Laufzeit im Ordner `runtime`
mit und verändert am Rechner nichts. Unter Linux: `./start.sh`.

Alternativ gibt es **`VolmeStick.exe`** (5,6 MB, eine Datei, fragt selbst nach
Administratorrechten) über den Knopf auf der Startseite. Sie wird unter Linux
mit Wine gebaut — `windows/exe-bauen-mit-wine.sh` erledigt das reproduzierbar
und dokumentiert die Klippen (Wine 6 kann keine MSI-Installer, Python 3.12
startet dort nicht, `get-pip` stirbt still, PyInstaller 6 läuft nicht). Ein
**Lauftest ist damit aber nicht möglich**: Wine 6 kann die fertige EXE nicht
starten. Wenn sie auf deinem Windows zickt, ist das ZIP der sichere Weg.

Auf einem Windows-Rechner mit Python baut `windows\EXE-bauen.bat` dieselbe EXE. Wer die Datenträger eines
kopflosen Rechners doch aus der Ferne bedienen will, startet mit `--fernzugriff`.

> **Stand:** Am 17.08.2026 mit Windows 11 25H2 in VMware durchgespielt — eine
> einzige ISO, Ersteinrichtung ohne Microsoft-Konto. Der USB-Stick-Weg unter
> Windows ist bislang nicht am echten Gerät erprobt.

## ISO für VMware

**Der einfache Weg — eine einzige Datei:**

```bash
python3 vstick.py iso Win11.iso -o Win11-v3d.iso --benutzer kurs
```

**Windows-ISOs tragen zwei Dateisysteme übereinander: ISO9660 und UDF — und
Windows liest ausschließlich das UDF.** Eine Datei, die nur im ISO9660-Teil
steht, ist für das Setup unsichtbar; die ISO bootet dann zwar, aber die
Antwortdatei existiert für Windows nicht. Erkennbar ist UDF an der Kennung
`NSR02`/`NSR03` ab Sektor 16.

VolmeStick prüft das und wählt den Weg:

* **Mit UDF** (alle Windows-ISOs): Die Datei wird über `pycdlib` in ISO9660
  *und* UDF eingetragen. Dafür wird die ISO neu geschrieben — anders kommt man
  an die UDF-Strukturen nicht heran. Dauert bei 7 GB etwa 20 Sekunden.
  Der Name wird dabei als UTF-16BE abgelegt, genau wie Microsoft es tut.
* **Ohne UDF**: Die Datei wird ans Ende angefügt und nur das Wurzelverzeichnis
  umgebogen — schneller, weil nichts neu geschrieben wird.

Die Startsätze (BIOS und UEFI) bleiben in beiden Fällen erhalten. In VMware
bindest du diese eine ISO ein — sonst nichts.

Am echten Objekt geprüft (Win11 25H2, 7,2 GB): `install.wim` byte-identisch
(gleiche SHA256 über 6,86 GB), kein Eintrag verloren, genau ein Eintrag dazu.

Das braucht **kein xorriso** (das es unter Windows nicht gibt) und dauert nur so
lange wie das Kopieren. Passt der neue Eintrag nicht mehr in den vorhandenen
Verzeichnisplatz, zieht das Wurzelverzeichnis ans Ende um; dann werden auch seine
`.`- und `..`-Einträge sowie die der Unterverzeichnisse mitgezogen — sonst sähen
Leser, die diesen Einträgen folgen (xorriso tut das), noch den alten Stand.

Mit `--werkzeug xorriso` lässt sich die ISO stattdessen komplett neu schreiben.

**Die kleine Beilage — wenn die Original-ISO unangetastet bleiben soll:**

```bash
python3 vstick.py antwort -o autounattend.iso --benutzer kurs
```

Ergibt eine 60 KB kleine ISO mit nur der `autounattend.xml`. In VMware als
**zweites** CD-Laufwerk neben die Windows-ISO hängen — Windows Setup sucht die
Datei auf jedem Laufwerk. Diese Variante gibt es auch auf der Startseite des
Servers, weil dabei nichts hochgeladen werden muss.

> **Nicht in den Tailscale-Funnel legen.** Das Werkzeug löscht Datenträger.
> Heimnetz/Tailnet reicht.

## Was es abnimmt

Alles landet in einer `autounattend.xml` im Wurzelverzeichnis des Mediums —
Windows Setup liest sie von selbst. Kein Eingriff ins Abbild, also auch keine
kaputte Signatur.

* Hardware-Sperren aus: TPM 2.0, Secure Boot, RAM, CPU, Datenträger
* Kein Microsoft-Konto: Dafür wird ein **lokales Konto** in die Antwortdatei
  geschrieben — seit Windows 11 24H2 ist das der einzige Weg, der noch wirkt.
  Der früher übliche Schalter `BypassNRO` wird zusätzlich gesetzt, genügt aber
  allein nicht mehr. Das Kennwort wird dabei so kodiert, wie Microsoft es
  erwartet (UTF-16LE + „Password", Base64) — eine leere Klartextangabe lässt
  das Anlegen des Kontos scheitern, und dann fragt die Einrichtung doch wieder
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
| `isopatch.py` | hängt die autounattend.xml in eine bestehende ISO ein, ohne sie neu zu bauen |
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
