# VolmeStick

Windows-Installationsmedien bauen — wie Rufus, aber zusätzlich **als ISO**,
damit sie sich direkt in VMware einbinden lässt.

Kern in Python, zwei Oberflächen:

| | wo | wofür |
|---|---|---|
| Weboberfläche | `python3 server.py` → `http://<server>:8775` | ISO bauen (VMware), ISO bei Microsoft holen, Prüfsummen |
| Windows-Fenster | `windows/VolmeStick.exe` | USB-Stick am Arbeitsplatz schreiben |
| Kommandozeile | `python3 vstick.py …` | alles, skriptbar |

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
| `download.py` | holt offizielle ISOs bei Microsoft |
| `server.py`, `web/ui.html` | Weboberfläche |
| `windows/vstick_gui.pyw` | Windows-Fenster |

## Was Rufus kann und VolmeStick (noch) nicht

* Windows To Go (Windows direkt vom Stick betreiben)
* Persistente Partition für Linux-Live-Systeme
* FreeDOS-, Syslinux-, GRUB-, ReactOS-Medien
* Cluster-Größe wählen, „erweiterte Bezeichnung/Symbole"
* Prüfung auf zurückgezogene UEFI-Bootloader (DBX), `SkuSiPolicy.p7b`
* Die „stille" Installation, die die Zielplatte ohne Rückfrage löscht — bewusst nicht.

Der Microsoft-Download läuft über Microsofts Bot-Schutz („Sentinel"). Von
Server- und VPN-Adressen wird er oft abgewiesen; vom heimischen Anschluss
klappt er in der Regel. Sonst: ISO von Hand laden und hochladen.
