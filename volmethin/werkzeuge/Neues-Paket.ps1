<#
.SYNOPSIS
    Packt eine Anwendung in einer VMware-Workstation-VM ein - vom Zuruecksetzen bis zur
    fertigen EXE, auf Wunsch samt Upload an die Verteilstelle.

.DESCRIPTION
    Spult die VM auf ihren Basis-Snapshot zurueck, nimmt den Zustand auf, laesst das Setup
    laufen, nimmt erneut auf, baut die EXE und holt sie auf den Host. Am Ende wird die VM
    wieder zurueckgespult, damit das naechste Paket auf demselben sauberen Stand beginnt.

    Voraussetzungen in der VM (alles vor dem Basis-Snapshot einrichten):
      - VMware Tools installiert
      - VolmeThin nach C:\VolmeThin entpackt (volmethin-cli.exe und stub\)
      - der Grundbestand der Kurs-PCs installiert
      - Windows Update und Defender-Updates abgeschaltet

.EXAMPLE
    .\Neues-Paket.ps1 -Vmx C:\VMs\Paketier\Paketier.vmx -Installer C:\Install\npp.exe `
        -Name "Notepad++" -Version 8.6 -GastBenutzer kurs -GastPasswort geheim -SetupArgumente /S

.EXAMPLE
    .\Neues-Paket.ps1 -Vmx C:\VMs\Paketier\Paketier.vmx -Installer C:\Install\setup.exe `
        -Name "LibreOffice" -Version 7.6.4 -GastBenutzer kurs -GastPasswort geheim `
        -Server http://vhs-server:8790 -Adminschluessel ABC123
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $Vmx,
    [Parameter(Mandatory)] [string] $Installer,
    [Parameter(Mandatory)] [string] $Name,
    [Parameter(Mandatory)] [string] $GastBenutzer,
    [Parameter(Mandatory)] [string] $GastPasswort,

    [string] $Version = "1.0.0",
    [string] $Id,
    [string] $Snapshot = "Basis",

    # Leer lassen fuer eine Installation zum Durchklicken. Sonst z.B. "/S" oder "/quiet".
    [string] $SetupArgumente = "",

    # Startdatei als Makro-Pfad, z.B. "{ProgramFiles}\Firma\app.exe". Leer = automatisch raten.
    [string] $Start = "",

    [ValidateSet("install", "portable")] [string] $Modus = "install",

    [string] $Ausgabe = ".",
    [string] $VolmeThinImGast = "C:\VolmeThin",
    [string] $ArbeitImGast = "C:\Install",

    # Wenn beides gesetzt ist, wandert die fertige EXE gleich in den Katalog.
    [string] $Server = "",
    [string] $Adminschluessel = "",

    # VM am Ende laufen lassen, statt sie zurueckzuspulen (zum Nachsehen bei Fehlern).
    [switch] $VmBehalten
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# ---------------------------------------------------------------- Hilfsmittel

function Finde-Vmrun {
    $kandidaten = @(
        "${env:ProgramFiles(x86)}\VMware\VMware Workstation\vmrun.exe",
        "$env:ProgramFiles\VMware\VMware Workstation\vmrun.exe"
    )
    foreach ($k in $kandidaten) {
        if ($k -and (Test-Path -LiteralPath $k)) { return $k }
    }
    $imPfad = Get-Command vmrun.exe -ErrorAction SilentlyContinue
    if ($imPfad) { return $imPfad.Source }

    throw "vmrun.exe nicht gefunden. Liegt VMware Workstation an einem anderen Ort, den Pfad in die PATH-Variable aufnehmen."
}

<#
    Setzt Pfade im Gast zusammen. Bewusst nicht Join-Path: der Gast ist immer Windows,
    und Join-Path wuerde "C:\..." auf einem Nicht-Windows-Host als Laufwerk deuten.
#>
function GastPfad([string] $ordner, [string] $name) {
    return ($ordner.TrimEnd('\')) + '\' + $name
}

function Schritt([string] $text) {
    Write-Host ""
    Write-Host "== $text" -ForegroundColor Cyan
}

function Vmrun {
    param([Parameter(ValueFromRemainingArguments)] [string[]] $Argumente)

    $ausgabe = & $script:VmrunPfad -T ws @Argumente 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "vmrun $($Argumente[0]) fehlgeschlagen: $ausgabe"
    }
    return $ausgabe
}

<#
    Fuer Befehle, deren Scheitern zum Normalbetrieb gehoert: eine bereits ausgeschaltete VM
    laesst sich nicht anhalten, ein vorhandenes Verzeichnis nicht anlegen.
#>
function VmrunEgal {
    param([Parameter(ValueFromRemainingArguments)] [string[]] $Argumente)
    & $script:VmrunPfad -T ws @Argumente 2>&1 | Out-Null
    $global:LASTEXITCODE = 0
}

function GastVmrunEgal {
    param([Parameter(ValueFromRemainingArguments)] [string[]] $Argumente)
    & $script:VmrunPfad -T ws -gu $GastBenutzer -gp $GastPasswort @Argumente 2>&1 | Out-Null
    $global:LASTEXITCODE = 0
}

function GastVmrun {
    param([Parameter(ValueFromRemainingArguments)] [string[]] $Argumente)

    $ausgabe = & $script:VmrunPfad -T ws -gu $GastBenutzer -gp $GastPasswort @Argumente 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "vmrun $($Argumente[0]) fehlgeschlagen: $ausgabe"
    }
    return $ausgabe
}

<#
    Fuehrt einen Befehl im Gast aus.

    Der Befehl wandert als Batchdatei in den Gast, statt als lange Kommandozeile an
    cmd.exe /c zu gehen: cmd entfernt bei mehreren Anfuehrungszeichen das erste und das
    letzte der Zeile und zerlegt damit genau die Befehle, die Pfade mit Leerzeichen und
    eine Umleitung enthalten. Ueber eine Datei gibt es dieses Problem nicht.

    vmrun reicht die Ausgabe des Gastprogramms nicht durch, darum wird sie im Gast
    umgeleitet und anschliessend abgeholt.
#>
function GastBefehl {
    param(
        [Parameter(Mandatory)] [string] $Befehl,
        [string] $Beschriftung = "",
        [switch] $Interaktiv,
        [switch] $FehlerErlaubt
    )

    $protokollGast = GastPfad $ArbeitImGast "letzter-befehl.txt"
    $skriptHost = Join-Path $script:ArbeitHost "schritt.cmd"
    $skriptGast = GastPfad $ArbeitImGast "schritt.cmd"

    # chcp 65001, damit Umlaute in Namen und Pfaden nicht an der Codepage scheitern.
    $inhalt = "@echo off`r`nchcp 65001 > nul`r`n$Befehl > `"$protokollGast`" 2>&1`r`n"
    [System.IO.File]::WriteAllText($skriptHost, $inhalt, [System.Text.UTF8Encoding]::new($false))
    GastVmrun copyFileFromHostToGuest $Vmx $skriptHost $skriptGast | Out-Null

    $argumente = @("runProgramInGuest", $Vmx)
    if ($Interaktiv) { $argumente += @("-activeWindow", "-interactive") }
    $argumente += @("C:\Windows\System32\cmd.exe", "/c", $skriptGast)

    $fehlgeschlagen = $null
    try { GastVmrun @argumente | Out-Null }
    catch { $fehlgeschlagen = $_ }

    $protokollHost = Join-Path $script:ArbeitHost "gast-ausgabe.txt"
    try {
        GastVmrun copyFileFromGuestToHost $Vmx $protokollGast $protokollHost | Out-Null
        $text = Get-Content -LiteralPath $protokollHost -Raw -ErrorAction SilentlyContinue
        if ($text) { Write-Host $text.TrimEnd() }
    } catch {
        Write-Verbose "Ausgabe des Gastes nicht abholbar: $_"
    }

    if ($fehlgeschlagen -and -not $FehlerErlaubt) {
        throw "$Beschriftung fehlgeschlagen: $fehlgeschlagen"
    }
}

function Sende-AnVerteilstelle {
    param([string] $Datei, [string] $Server, [string] $Schluessel)

    Add-Type -AssemblyName System.Net.Http
    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromMinutes(30)
    $client.DefaultRequestHeaders.Add("X-VT-Admin", $Schluessel)

    $strom = [System.IO.File]::OpenRead($Datei)
    try {
        $inhalt = [System.Net.Http.MultipartFormDataContent]::new()
        $teil = [System.Net.Http.StreamContent]::new($strom)
        $inhalt.Add($teil, "datei", [System.IO.Path]::GetFileName($Datei))

        $ziel = "$($Server.TrimEnd('/'))/api/upload"
        try {
            $antwort = $client.PostAsync($ziel, $inhalt).GetAwaiter().GetResult()
        }
        catch {
            # Sonst steht hier nur "Error while copying content to a stream", was niemandem hilft.
            throw "Verteilstelle unter $Server nicht erreichbar. Laeuft der Server und ist der Port freigegeben? ($($_.Exception.Message))"
        }

        $text = $antwort.Content.ReadAsStringAsync().GetAwaiter().GetResult()

        if ($antwort.StatusCode -eq [System.Net.HttpStatusCode]::Unauthorized) {
            throw "Der Adminschluessel stimmt nicht."
        }
        if (-not $antwort.IsSuccessStatusCode) {
            throw "Verteilstelle hat abgelehnt ($([int]$antwort.StatusCode)): $text"
        }
        Write-Host "  In den Katalog eingetragen." -ForegroundColor Green
    }
    finally {
        $strom.Dispose()
        $client.Dispose()
    }
}

# ---------------------------------------------------------------- Vorbereiten

if (-not (Test-Path -LiteralPath $Vmx)) { throw "VM nicht gefunden: $Vmx" }
if (-not (Test-Path -LiteralPath $Installer)) { throw "Installer nicht gefunden: $Installer" }
if ($Server -and -not $Adminschluessel) { throw "Zum Hochladen wird auch -Adminschluessel gebraucht." }

if (-not $Id) {
    $Id = ($Name.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
    if (-not $Id) { $Id = "paket" }
}

$script:VmrunPfad = Finde-Vmrun
$script:ArbeitHost = Join-Path ([System.IO.Path]::GetTempPath()) "volmethin-$([guid]::NewGuid().ToString('N').Substring(0,8))"
New-Item -ItemType Directory -Path $script:ArbeitHost -Force | Out-Null

$Ausgabe = (Resolve-Path -LiteralPath $Ausgabe).Path
$zielExe = Join-Path $Ausgabe "$Id.exe"
$cli = GastPfad $VolmeThinImGast "volmethin-cli.exe"
$installerImGast = GastPfad $ArbeitImGast (Split-Path -Leaf $Installer)
$vorherSnap = GastPfad $ArbeitImGast "vorher.snap"
$paketImGast = GastPfad $ArbeitImGast "$Id.v3pkg"
$exeImGast = GastPfad $ArbeitImGast "$Id.exe"

Write-Host "VolmeThin - neues Paket" -ForegroundColor White
Write-Host "  VM        : $Vmx"
Write-Host "  Snapshot  : $Snapshot"
Write-Host "  Programm  : $Name $Version (Kennung $Id)"
Write-Host "  Installer : $Installer"
Write-Host "  Ziel      : $zielExe"

try {
    Schritt "VM auf '$Snapshot' zuruecksetzen"
    VmrunEgal stop $Vmx hard          # laeuft sie noch, erst anhalten
    Vmrun revertToSnapshot $Vmx $Snapshot | Out-Null
    Vmrun start $Vmx | Out-Null

    Schritt "Auf VMware Tools warten"
    $bereit = $false
    foreach ($versuch in 1..60) {
        try {
            GastVmrun listProcessesInGuest $Vmx | Out-Null
            $bereit = $true
            break
        } catch {
            Start-Sleep -Seconds 5
        }
    }
    if (-not $bereit) {
        throw "Der Gast meldet sich nicht. Sind VMware Tools installiert und stimmen -GastBenutzer und -GastPasswort?"
    }
    Write-Host "  Gast ist bereit."

    Schritt "Installer in die VM reichen"
    GastVmrunEgal createDirectoryInGuest $Vmx $ArbeitImGast
    GastVmrun copyFileFromHostToGuest $Vmx $Installer $installerImGast | Out-Null
    Write-Host "  $installerImGast"

    Schritt "Zustand vor der Installation aufnehmen"
    GastBefehl -Befehl "`"$cli`" vorher `"$vorherSnap`"" -Beschriftung "Aufnahme"

    Schritt "Installation"
    if ($SetupArgumente) {
        Write-Host "  Setup laeuft still: $SetupArgumente"
        GastBefehl -Befehl "`"$installerImGast`" $SetupArgumente" -Beschriftung "Setup" -Interaktiv
    }
    else {
        Write-Host "  Setup wird im Fenster der VM geoeffnet." -ForegroundColor Yellow
        GastBefehl -Befehl "start `"`" `"$installerImGast`"" -Beschriftung "Setup" -Interaktiv -FehlerErlaubt
        Write-Host ""
        Write-Host "  Jetzt in der VM installieren, das Programm einmal starten und wieder schliessen." -ForegroundColor Yellow
        Read-Host "  Danach hier die Eingabetaste druecken"
    }

    Schritt "Zustand nach der Installation aufnehmen und Paket schreiben"
    $nachher = "`"$cli`" nachher `"$vorherSnap`" --out `"$paketImGast`" --name `"$Name`" --id $Id --version $Version --modus $Modus"
    if ($Start) { $nachher += " --start `"$Start`"" }
    GastBefehl -Befehl $nachher -Beschriftung "Paketbau"

    Schritt "EXE bauen"
    GastBefehl -Befehl "`"$cli`" bauen `"$paketImGast`" --out `"$exeImGast`"" -Beschriftung "EXE-Bau"

    Schritt "Ergebnis abholen"
    GastVmrun copyFileFromGuestToHost $Vmx $exeImGast $zielExe | Out-Null
    $mb = [math]::Round((Get-Item -LiteralPath $zielExe).Length / 1MB)
    Write-Host "  $zielExe ($mb MB)" -ForegroundColor Green

    if ($Server) {
        Schritt "An die Verteilstelle schicken"
        Sende-AnVerteilstelle -Datei $zielExe -Server $Server -Schluessel $Adminschluessel
    }
}
finally {
    if ($VmBehalten) {
        Write-Host ""
        Write-Host "VM laeuft weiter (-VmBehalten). Vor dem naechsten Paket zuruecksetzen!" -ForegroundColor Yellow
    }
    else {
        Schritt "VM wieder auf '$Snapshot' zuruecksetzen"
        try {
            VmrunEgal stop $Vmx hard
            Vmrun revertToSnapshot $Vmx $Snapshot | Out-Null
            Write-Host "  Sauberer Stand fuer das naechste Paket."
        } catch {
            Write-Warning "Zuruecksetzen fehlgeschlagen: $_"
        }
    }
    Remove-Item -LiteralPath $script:ArbeitHost -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Fertig." -ForegroundColor Green
