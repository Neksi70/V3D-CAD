# VolmeDriver

Windows-Tool zum **Sichern, Wiederherstellen und Aktualisieren von Treibern** –
eine PowerShell-Datei mit WPF-Oberfläche, keine Installation nötig.

## Einsatz

1. Ordner `volmedriver` (oder nur die beiden Dateien `VolmeDriver.ps1` + `VolmeDriver.cmd`)
   auf den Ziel-PC kopieren (USB-Stick, Fernwartung, …).
2. **`VolmeDriver.cmd` doppelklicken** – das Tool fordert selbst Admin-Rechte an (UAC-Abfrage).

Voraussetzungen: Windows 10/11 mit Windows PowerShell 5.1 (Standard), Internet nur für den Update-Reiter.

## Funktionen

| Reiter | Was passiert | Technik |
|---|---|---|
| **Inventar** | Alle Geräte mit Treiberversion/-datum; Export als HTML-Bericht | WMI `Win32_PnPSignedDriver` |
| **Sichern** | Alle Fremdhersteller-Treiber in einen Ordner exportieren, Inventar-CSV inklusive | `pnputil /export-driver * <Ziel>` |
| **Wiederherstellen** | Gesichertes Treiberpaket (alle INF inkl. Unterordner) installieren – z. B. auf frischem Windows | `pnputil /add-driver *.inf /subdirs /install` |
| **Updates** | Treiber-Updates über Windows Update suchen, auswählen (Mehrfachauswahl in der Liste), herunterladen und installieren | Windows-Update-COM-API (`Microsoft.Update.Session`, Suche `Type='Driver'`) |

Lange Vorgänge laufen im Hintergrund (Runspace), das Protokoll unten zeigt den Fortschritt.
Nach Update-Installation wird bei Bedarf ein Neustart gemeldet.

## Hinweise

- Die Sicherung erfasst nur Fremdhersteller-Treiber (so arbeitet `pnputil /export-driver`);
  Windows-eigene Inbox-Treiber bringt jede Windows-Installation selbst mit.
- „Wiederherstellen" auf einem **anderen** PC-Modell installiert nur die Treiber,
  deren Hardware-IDs dort passen – der Rest wird von pnputil übersprungen.
- Windows Update liefert nicht immer die allerneuesten Hersteller-Treiber
  (z. B. GPU-Treiber von NVIDIA/AMD sind dort oft älter als auf der Herstellerseite).
- Optional lässt sich aus der PS1 mit [ps2exe](https://github.com/MScholtes/PS2EXE)
  eine einzelne EXE bauen: `Invoke-ps2exe .\VolmeDriver.ps1 .\VolmeDriver.exe -requireAdmin`

## Status

Auf dem Linux-Server nur per Code-Review geprüft (kein Windows/pwsh vorhanden) –
**erster Testlauf auf einem echten Windows-PC steht noch aus.**
