# V3D Setup

Windows-11-Rechner neu aufsetzen: Programme abhaken, Installer auf V3DA laden,
silent installieren, Treiber sichern/zurückspielen, alle Updates durchziehen.

- Oberfläche: http://192.168.178.254:8819 (Heimnetz) bzw. http://100.125.34.44:8819 (Tailnet). **Nicht im Funnel.**
- Dienst: `systemctl --user restart v3dsetup` (server.py, nur Python-stdlib + PyYAML)
- Daten: `daten/` (gitignored): `katalog/index.db` (winget-Index), `inventare/`, `profile/` (abgehakte Listen),
  `depot/<paket>/` (Installer + info.json), `treiber/<rechner>/*.zip`, `zuordnung.json` (Hand-Zuordnungen)

## Ablauf
1. Alter Rechner: Starter `V3D-Setup.cmd` (Download auf der Seite) → *1) Inventar senden*, *2) Treiber sichern*
2. Web: Programme ankreuzen → *Auf V3DA herunterladen* (holt die aktuelle Version aus dem winget-Manifest, prüft SHA-256)
3. Neuer Rechner: Starter → *3) Alles* = Treiber zurück → Programme silent → winget upgrade + Windows Update;
   bei Neustart geht es per geplanter Aufgabe „V3D-Setup-Weiter“ nach der Anmeldung weiter (max. 8 Runden).

## Woher die Silent-Schalter kommen
`katalog.py` liest den winget-Index (`cdn.winget.microsoft.com/cache/source.msix`) direkt auf Linux:
Paket → Manifest-YAML → Installer (x64 > neutral > x86, machine-Scope, de-Locale bevorzugt),
`InstallerSwitches.Silent` oder Standard je Typ (msi `/quiet /norestart`, nullsoft `/S`, inno `/VERYSILENT …`).
Zuordnung Inventar → Paket: ProductCode/ARP-Schlüssel zuerst, dann normierter Name, dann `winget export`.
Programme ohne winget-Paket: „Eigener Installer“ hochladen + Parameter eintragen.

## Rechner-Karten (Steuerung im Browser)
Der Starter läuft standardmäßig im **Agent-Modus**: Der PC meldet sich per `POST /api/agent/puls` (alle ~3 s,
bei Arbeit mit jeder Protokollzeile) und holt dabei Aufträge ab. Im Puls stecken Status, Schritte, Fortschritt,
Ergebnis je Programm und neue Protokollzeilen → Karte in der Weboberfläche. Aufträge: `POST /api/rechner/auftrag`
(Inventar, TreiberSichern, AlterRechner, Alles, Installieren, TreiberZurueck, Updates, Beenden).
Nach einem Neustart setzt die geplante Aufgabe fort und geht danach wieder in den Agent-Modus.
Lange Windows-Update-Aufrufe blockieren den Puls – „online“ gilt beim Arbeiten bis 30 min ohne Puls.
Das alte Konsolenmenü gibt es noch mit `-Modus Menue`.

## Windows-Skript
`windows/V3D-Setup.ps1` – PowerShell 5.1, reines ASCII (+BOM beim Ausliefern), `__SERVER__` wird beim
Ausliefern durch die aufgerufene Adresse ersetzt. Parameter: `-Modus`, `-Profil`, `-Quelle` (Ordner/UNC mit
Depot-Kopie, Layout wie `daten/depot`), `-TreiberZip` (lokale Treiber-ZIP, falls noch kein Netz), `-OhneNeustart`.
Log: `C:\ProgramData\V3DSetup\log_*.txt`.

## Test
    V3DSETUP_DATEN=/tmp/x V3DSETUP_PORT=18819 python3 server.py &   # eigene Testdaten!
    python3 test_ablauf.py
