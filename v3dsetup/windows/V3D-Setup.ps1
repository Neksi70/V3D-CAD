# V3D Setup - Windows-Rechner inventarisieren, Treiber sichern, neu einrichten.
# Server: V3DA (V3D Setup). Datei bewusst reines ASCII (Umlaute als ae/oe/ue),
# damit Windows PowerShell 5.1 sie nicht falsch dekodiert.
param(
    # Agent = Rechner meldet sich bei V3DA an und wird ueber die Weboberflaeche gesteuert
    [ValidateSet('Agent', 'Menue', 'Inventar', 'TreiberSichern', 'TreiberZurueck', 'Installieren', 'Updates', 'Neuinstallation', 'Weiter')]
    [string]$Modus = 'Agent',
    [string]$Server = '__SERVER__',
    [string]$Profil = '',
    # optional: Ordner/Netzwerkpfad mit einer Kopie des Depots (z.B. USB-Stick oder \\nas\setup)
    [string]$Quelle = '',
    # optional: Treiber-ZIP lokal (USB), falls der Rechner noch kein Netz hat
    [string]$TreiberZip = '',
    [switch]$OhneNeustart
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$Server = $Server.TrimEnd('/')
$Arbeit = Join-Path $env:ProgramData 'V3DSetup'
New-Item -ItemType Directory -Force -Path $Arbeit | Out-Null
$LogDatei = Join-Path $Arbeit ('log_{0:yyyyMMdd}.txt' -f (Get-Date))
$ZustandDatei = Join-Path $Arbeit 'zustand.json'
$SkriptKopie = Join-Path $Arbeit 'V3D-Setup.ps1'
$AufgabeName = 'V3D-Setup-Weiter'
$script:Neustart = $false
$script:Agent = $false
$script:TreiberWahl = $null
$script:Puffer = New-Object System.Collections.ArrayList
$script:LetzterPuls = [datetime]::MinValue
$script:Z = @{ status = 'bereit'; aufgabe = ''; schritte = @(); fortschritt = $null; ergebnisse = $null }

function Log([string]$t, [string]$farbe = 'Gray') {
    $z = '{0:HH:mm:ss} {1}' -f (Get-Date), $t
    Write-Host $z -ForegroundColor $farbe
    try { Add-Content -Path $LogDatei -Value $z -Encoding UTF8 } catch {}
    if ($script:Agent) {
        [void]$script:Puffer.Add(@{ z = (Get-Date -Format 'HH:mm:ss'); t = $t; f = $farbe })
        if (((Get-Date) - $script:LetzterPuls).TotalSeconds -ge 2) { [void](Puls) }
    }
}

# ---------------------------------------------------------------- Verbindung zur Weboberflaeche
function Puls {
    # meldet Zustand + neue Protokollzeilen, holt einen Auftrag ab (oder $null)
    if (-not $script:Agent) { return $null }
    $script:LetzterPuls = Get-Date
    $neu = @($script:Puffer.ToArray())
    $b = @{ host = $env:COMPUTERNAME; status = $script:Z.status; aufgabe = $script:Z.aufgabe
            schritte = @($script:Z.schritte); fortschritt = $script:Z.fortschritt; log = $neu }
    if ($null -ne $script:Z.ergebnisse) { $b.ergebnisse = @($script:Z.ergebnisse.ToArray()) }
    if ($script:Z.installer) { $b.installer = $script:Z.installer }
    if (-not $script:Z.kennt) {
        $cs = Get-CimInstance Win32_ComputerSystem
        $os = Get-CimInstance Win32_OperatingSystem
        $b.modell = "$($cs.Manufacturer) $($cs.Model)"
        $b.os = "$($os.Caption) $($os.Version)"
        $b.benutzer = $env:USERNAME
    }
    try {
        $json = $b | ConvertTo-Json -Depth 6 -Compress
        $r = Invoke-RestMethod -UseBasicParsing -Uri "$Server/api/agent/puls" -Method Post -TimeoutSec 8 `
            -Body ([Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'application/json; charset=utf-8'
        $script:Puffer.RemoveRange(0, $neu.Count)
        $script:Z.kennt = $true
        # Steuerbefehle merken, egal welcher Puls sie abholt (auch der aus Log)
        if ($r.auftrag -and $r.auftrag.aktion -eq 'Ueberspringen') { $script:Steuer = $r.auftrag; return $null }
        return $r.auftrag
    } catch {
        return $null    # V3DA kurz weg - Zeilen bleiben im Puffer und gehen beim naechsten Mal mit
    }
}

function Fortschritt([double]$n, [double]$gesamt, [string]$text) {
    $script:Z.fortschritt = @{ n = [math]::Round($n, 3); gesamt = $gesamt; text = $text }
    if ($script:Agent) { [void](Puls) }
}

# Teilfortschritt fuer Uebertragungen: Anteil 0..1 wird auf [basis, basis+spanne] von gesamt abgebildet
$script:Teil = $null
function Teil-Fortschritt([double]$anteil, [string]$zusatz) {
    $t = $script:Teil
    if (-not $t) { return }
    if (((Get-Date) - $script:LetzterPuls).TotalSeconds -lt 1.5) { return }
    Fortschritt ($t.basis + $t.spanne * $anteil) $t.gesamt ($t.text + $zusatz)
}

function Kopiere-Strom($von, $nach, [long]$laenge) {
    $puffer = New-Object byte[] 1048576
    [long]$fertig = 0
    while (($n = $von.Read($puffer, 0, $puffer.Length)) -gt 0) {
        $nach.Write($puffer, 0, $n)
        $fertig += $n
        if ($laenge -gt 0) {
            Teil-Fortschritt ($fertig / $laenge) (' ({0} / {1} MB)' -f [math]::Round($fertig / 1MB), [math]::Round($laenge / 1MB))
        } else {
            Teil-Fortschritt 0 (' ({0} MB)' -f [math]::Round($fertig / 1MB))
        }
    }
}

function Schritt-Zustand([string]$name, [string]$zustand) {
    foreach ($s in $script:Z.schritte) { if ($s.name -eq $name) { $s.zustand = $zustand } }
    if ($script:Agent) { [void](Puls) }
}

function Ergebnis([string]$programm, [string]$text, [string]$art) {
    if ($null -eq $script:Z.ergebnisse) { $script:Z.ergebnisse = New-Object System.Collections.ArrayList }
    [void]$script:Z.ergebnisse.Add(@{ programm = $programm; ergebnis = $text; art = $art })
}

# ---------------------------------------------------------------- Admin
$ich = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $ich.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    if (-not $PSCommandPath) { Write-Host 'Bitte als Administrator starten.' -ForegroundColor Red; return }
    $argl = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Modus', $Modus, '-Server', $Server)
    if ($Profil) { $argl += @('-Profil', "`"$Profil`"") }
    if ($Quelle) { $argl += @('-Quelle', "`"$Quelle`"") }
    if ($TreiberZip) { $argl += @('-TreiberZip', "`"$TreiberZip`"") }
    if ($OhneNeustart) { $argl += '-OhneNeustart' }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argl
    return
}

# Kopie des Skripts fuer die Fortsetzung nach einem Neustart
if ($PSCommandPath -and ($PSCommandPath -ne $SkriptKopie)) {
    Copy-Item -Path $PSCommandPath -Destination $SkriptKopie -Force
} elseif (-not $PSCommandPath) {
    try { Invoke-WebRequest -UseBasicParsing -Uri "$Server/V3D-Setup.ps1" -OutFile $SkriptKopie } catch {}
}

# ---------------------------------------------------------------- Hilfen
function Api([string]$pfad) {
    return Invoke-RestMethod -UseBasicParsing -Uri ($Server + $pfad) -TimeoutSec 60
}

function Normname([string]$n) {
    if (-not $n) { return '' }
    $n = $n -replace '\([^)]*\)|\[[^\]]*\]', ' '
    $n = $n -replace '\bv?\d+(\.\d+)+[a-z0-9.-]*\b', ' '
    $n = $n -replace '\b(x64|x86|x86_64|amd64|arm64|64[- ]?bit|32[- ]?bit|win64|win32|version|ver)\b', ' '
    return ($n.ToLower() -replace '[^0-9a-z\u00c0-\uffff]', '')
}

function Hole-Programme {
    $zweige = @(
        @{ P = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'; S = 'Rechner 64-Bit' },
        @{ P = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'; S = 'Rechner 32-Bit' },
        @{ P = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'; S = 'Benutzer' }
    )
    $liste = New-Object System.Collections.ArrayList
    $gesehen = @{}
    foreach ($z in $zweige) {
        $schluessel = @(Get-ChildItem -Path $z.P -ErrorAction SilentlyContinue)
        foreach ($k in $schluessel) {
            try { $e = Get-ItemProperty -Path $k.PSPath -ErrorAction Stop } catch { continue }
            if (-not $e.DisplayName) { continue }
            if ($e.SystemComponent -eq 1) { continue }
            if ($e.ParentKeyName) { continue }
            if ($e.ReleaseType -and ($e.ReleaseType -match 'Update|Hotfix')) { continue }
            $id = "$($e.DisplayName)|$($e.DisplayVersion)"
            if ($gesehen.ContainsKey($id)) { continue }
            $gesehen[$id] = 1
            [void]$liste.Add([ordered]@{
                name        = [string]$e.DisplayName
                version     = [string]$e.DisplayVersion
                publisher   = [string]$e.Publisher
                key         = [string]$k.PSChildName
                scope       = $z.S
                installdate = [string]$e.InstallDate
            })
        }
    }
    return , $liste
}

# pnputil schreibt in der DOS-Codepage (850) - sonst wird aus "hinzugefuegt" "hinzugef?gt"
function Mit-Oem([scriptblock]$befehl) {
    $alt = [Console]::OutputEncoding
    try {
        [Console]::OutputEncoding = [Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
        & $befehl
    } finally { [Console]::OutputEncoding = $alt }
}

function Finde-Winget {
    $c = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    $pfad = Get-ChildItem -Path "$env:ProgramFiles\WindowsApps\Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe\winget.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
    if ($pfad) { return $pfad.FullName }
    try {
        Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe -ErrorAction Stop
        $c = Get-Command winget.exe -ErrorAction SilentlyContinue
        if ($c) { return $c.Source }
    } catch {}
    return $null
}

function Lade-Herunter([string]$url, [string]$ziel) {
    $req = [Net.HttpWebRequest]::Create($url)
    $req.Timeout = 120000
    $req.ReadWriteTimeout = 600000
    $resp = $req.GetResponse()
    $ein = $resp.GetResponseStream()
    $aus = [IO.File]::Create($ziel)
    try { Kopiere-Strom $ein $aus $resp.ContentLength } finally { $aus.Close(); $ein.Close(); $resp.Close() }
}

function Lade-Hoch([string]$datei, [string]$url) {
    $req = [Net.HttpWebRequest]::Create($url)
    $req.Method = 'PUT'
    $req.AllowWriteStreamBuffering = $false
    $req.ContentType = 'application/zip'
    $req.ContentLength = (Get-Item $datei).Length
    $req.Timeout = 3600000
    $req.ReadWriteTimeout = 3600000
    $s = $req.GetRequestStream()
    $f = [IO.File]::OpenRead($datei)
    try { Kopiere-Strom $f $s $f.Length } finally { $f.Close(); $s.Close() }
    $resp = $req.GetResponse()
    $sr = New-Object IO.StreamReader($resp.GetResponseStream())
    $text = $sr.ReadToEnd()
    $resp.Close()
    return ($text | ConvertFrom-Json)
}

function Waehle-Profil {
    if ($script:Profil) { return $script:Profil }
    $namen = @(Api '/api/profile')
    if ($namen.Count -le 1) { $script:Profil = [string]$namen[0]; return $script:Profil }
    Write-Host ''
    for ($i = 0; $i -lt $namen.Count; $i++) { Write-Host ('  {0}) {1}' -f ($i + 1), $namen[$i]) }
    $w = Read-Host 'Welche Liste installieren? (Nummer)'
    $script:Profil = [string]$namen[[int]$w - 1]
    return $script:Profil
}

function Speichere-Zustand($schritte) {
    $alt = $null
    if (Test-Path $ZustandDatei) { $alt = Get-Content $ZustandDatei -Raw | ConvertFrom-Json }
    $runde = 0
    if ($alt) { $runde = [int]$alt.runde }
    @{ schritte = @($schritte); server = $Server; profil = $script:Profil; quelle = $Quelle; runde = $runde + 1 } |
        ConvertTo-Json | Set-Content -Path $ZustandDatei -Encoding UTF8
}

function Neustart-Mit-Fortsetzung($restSchritte) {
    Speichere-Zustand $restSchritte
    $benutzer = "$env:USERDOMAIN\$env:USERNAME"
    $arg = "-NoProfile -ExecutionPolicy Bypass -File `"$SkriptKopie`" -Modus Weiter -Server `"$Server`""
    $a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
    $t = New-ScheduledTaskTrigger -AtLogOn -User $benutzer
    $p = New-ScheduledTaskPrincipal -UserId $benutzer -LogonType Interactive -RunLevel Highest
    Register-ScheduledTask -TaskName $AufgabeName -Action $a -Trigger $t -Principal $p -Force | Out-Null
    Log ('Neustart noetig - es geht nach der Anmeldung automatisch weiter mit: ' + ($restSchritte -join ', ')) 'Yellow'
    if ($OhneNeustart) { Log 'Bitte selbst neu starten (-OhneNeustart).' 'Yellow'; return }
    Log 'Neustart in 30 Sekunden (Strg+C bricht ab) ...' 'Yellow'
    $script:Z.status = 'neustart'
    [void](Puls)
    Start-Sleep -Seconds 30
    Restart-Computer -Force
    exit
}

# ---------------------------------------------------------------- 1) Inventar
function Do-Inventar {
    Fortschritt 0 3 'lese installierte Programme'
    Log 'Lese installierte Programme ...' 'Cyan'
    $progs = Hole-Programme
    Log ("{0} Programme gefunden" -f $progs.Count)
    $ids = @()
    $wg = Finde-Winget
    if ($wg) {
        Fortschritt 1 3 'frage winget nach Paket-IDs'
        Log 'Frage winget nach Paket-IDs ...'
        $tmp = Join-Path $Arbeit 'winget-export.json'
        try {
            & $wg export -o $tmp --accept-source-agreements --disable-interactivity 2>&1 | Out-Null
            if (Test-Path $tmp) {
                $ex = Get-Content $tmp -Raw | ConvertFrom-Json
                foreach ($src in $ex.Sources) { foreach ($p in $src.Packages) { $ids += [string]$p.PackageIdentifier } }
                Log ("winget kennt {0} davon" -f $ids.Count)
            }
        } catch { Log "winget export ging nicht: $($_.Exception.Message)" 'Yellow' }
    }
    $cs = Get-CimInstance Win32_ComputerSystem
    $os = Get-CimInstance Win32_OperatingSystem
    $inv = [ordered]@{
        host       = $env:COMPUTERNAME
        zeit       = (Get-Date -Format 'yyyy-MM-dd HH:mm')
        os         = "$($os.Caption) $($os.Version)"
        modell     = "$($cs.Manufacturer) $($cs.Model)"
        benutzer   = $env:USERNAME
        programme  = @($progs)
        winget_ids = @($ids)
    }
    Fortschritt 2 3 'sende Programmliste an V3DA'
    $json = $inv | ConvertTo-Json -Depth 5
    Set-Content -Path (Join-Path $Arbeit "inventar_$env:COMPUTERNAME.json") -Value $json -Encoding UTF8
    $r = Invoke-RestMethod -UseBasicParsing -Uri "$Server/api/inventar" -Method Post `
        -Body ([Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'application/json; charset=utf-8'
    Fortschritt 3 3 ("{0} Programme gesendet" -f $progs.Count)
    Log "Inventar auf V3DA gespeichert: $($r.datei)" 'Green'
    Log "Zum Abhaken oeffnen: $($r.link)" 'Green'
    if (-not $script:Agent) { try { Start-Process $r.link } catch {} }
}

# ---------------------------------------------------------------- 2) Treiber sichern
function Do-TreiberSichern {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $stempel = Get-Date -Format 'yyyyMMdd-HHmmss'
    $ordner = Join-Path $Arbeit "treiber_$stempel"
    Fortschritt 2 100 'exportiere Treiber (pnputil)'
    Log 'Exportiere Drittanbieter-Treiber (pnputil) ...' 'Cyan'
    New-Item -ItemType Directory -Force -Path $ordner | Out-Null
    & pnputil.exe /export-driver * $ordner | Out-Null
    $anzahl = @(Get-ChildItem -Path $ordner -Filter *.inf -Recurse).Count
    if ($anzahl -eq 0) { Log 'Keine Treiber exportiert.' 'Red'; return }
    Get-WindowsDriver -Online -ErrorAction SilentlyContinue |
        Select-Object OriginalFileName, ProviderName, ClassName, Version, Date |
        Export-Csv -Path (Join-Path $ordner 'inventar.csv') -NoTypeInformation -Encoding UTF8
    $zip = "$ordner.zip"
    Fortschritt 12 100 "$anzahl Treiber - packe ZIP"
    Log "$anzahl Treiber - packe ZIP ..."
    # Datei fuer Datei packen (mit Fortschritt) und schnell statt stark:
    # Treiber sind meist schon komprimiert, 'Optimal' kostet bei ~2 GB rund 10 Minuten fuer kaum Gewinn
    Add-Type -AssemblyName System.IO.Compression
    $dateien = @(Get-ChildItem -Path $ordner -Recurse -File)
    $summe = ($dateien | Measure-Object -Property Length -Sum).Sum
    [long]$gepackt = 0
    $zs = [IO.File]::Create($zip)
    $za = New-Object IO.Compression.ZipArchive($zs, [IO.Compression.ZipArchiveMode]::Create)
    try {
        $script:Teil = @{ basis = 12; spanne = 18; gesamt = 100; text = 'packe Treiber' }
        foreach ($d in $dateien) {
            $rel = $d.FullName.Substring($ordner.Length + 1)
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($za, $d.FullName, $rel, [IO.Compression.CompressionLevel]::Fastest)
            $gepackt += $d.Length
            if ($summe -gt 0) { Teil-Fortschritt ($gepackt / $summe) (' ({0} / {1} MB)' -f [math]::Round($gepackt / 1MB), [math]::Round($summe / 1MB)) }
        }
    } finally { $za.Dispose(); $zs.Close(); $script:Teil = $null }
    $mb = [math]::Round((Get-Item $zip).Length / 1MB)
    $cs = Get-CimInstance Win32_ComputerSystem
    $modell = [uri]::EscapeDataString("$($cs.Manufacturer) $($cs.Model)")
    Log "Lade $mb MB auf V3DA hoch ..."
    $script:Teil = @{ basis = 30; spanne = 70; gesamt = 100; text = 'lade Treiber hoch' }
    Fortschritt 30 100 'lade Treiber hoch'
    $r = Lade-Hoch $zip "$Server/api/treiber?host=$env:COMPUTERNAME&name=$stempel&anzahl=$anzahl&modell=$modell"
    $script:Teil = $null
    Fortschritt 100 100 "$anzahl Treiber gesichert"
    Log "Treiber gesichert: $($r.datei)" 'Green'
    Log "Lokale Kopie (z.B. fuer USB-Stick): $zip"
    Remove-Item -Recurse -Force $ordner
}

# ---------------------------------------------------------------- 3) Treiber zurueck
function Do-TreiberZurueck {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = $TreiberZip
    if (-not $zip -and $script:Agent) {
        $w = $script:TreiberWahl
        if (-not $w) {
            # nichts gewaehlt: neueste Sicherung vom gleichen Modell nehmen
            $cs = Get-CimInstance Win32_ComputerSystem
            $meinModell = "$($cs.Manufacturer) $($cs.Model)"
            $w = @(Api '/api/treiber') | Where-Object { $_.modell -eq $meinModell } | Select-Object -First 1
            if (-not $w) { Log 'Keine Treiber-Sicherung gewaehlt und keine vom gleichen Modell - uebersprungen.' 'Yellow'; return }
        }
        $zip = Join-Path $Arbeit $w.datei
        Log "Lade Treiber $($w.host)/$($w.datei) ..." 'Cyan'
        $script:Teil = @{ basis = 0; spanne = 60; gesamt = 100; text = 'lade Treiber' }
        Lade-Herunter ("$Server/treiber/{0}/{1}" -f [uri]::EscapeDataString($w.host), [uri]::EscapeDataString($w.datei)) $zip
    }
    if (-not $zip) {
        $liste = @(Api '/api/treiber')
        if ($liste.Count -eq 0) { Log 'Auf V3DA liegen keine Treiber-Sicherungen.' 'Yellow'; return }
        $cs = Get-CimInstance Win32_ComputerSystem
        $meinModell = "$($cs.Manufacturer) $($cs.Model)"
        Write-Host ''
        Write-Host "Dieser Rechner: $meinModell" -ForegroundColor Cyan
        for ($i = 0; $i -lt $liste.Count; $i++) {
            $e = $liste[$i]
            $mark = ''
            if ($e.modell -and ($e.modell -eq $meinModell)) { $mark = '  <- gleiches Modell' }
            Write-Host ('  {0}) {1}  {2}  {3} Treiber  {4} MB  {5}{6}' -f ($i + 1), $e.host, $e.zeit, $e.anzahl, [math]::Round($e.groesse / 1MB), $e.modell, $mark)
        }
        $w = Read-Host 'Welche Sicherung einspielen? (Nummer, leer = keine)'
        if (-not $w) { return }
        $e = $liste[[int]$w - 1]
        $zip = Join-Path $Arbeit $e.datei
        Log "Lade Treiber $($e.host)/$($e.datei) ..." 'Cyan'
        Lade-Herunter ("$Server/treiber/{0}/{1}" -f [uri]::EscapeDataString($e.host), [uri]::EscapeDataString($e.datei)) $zip
    }
    $script:Teil = $null
    Fortschritt 60 100 'entpacke Treiber'
    $ordner = Join-Path $Arbeit ('treiber_ein_' + (Get-Date -Format 'HHmmss'))
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $ordner)
    Fortschritt 70 100 'spiele Treiber ein (dauert etwas)'
    Log 'Spiele Treiber ein (pnputil /add-driver /install) ...' 'Cyan'
    $aus = Mit-Oem { & pnputil.exe /add-driver "$ordner\*.inf" /subdirs /install 2>&1 }
    $code = $LASTEXITCODE
    $aus | Select-Object -Last 6 | ForEach-Object { Log "  $_" }
    if ($code -eq 3010) { $script:Neustart = $true }
    Fortschritt 100 100 'Treiber eingespielt'
    # 259 = einige Treiber ohne passendes Geraet - normal bei einer Sicherung von allem
    Log "Treiber eingespielt (Code $code$(if ($code -eq 259) { ': einige ohne passendes Geraet, normal' }))" 'Green'
}

# ---------------------------------------------------------------- 4) Programme
function Starte-Installer([string]$datei, [string]$typ, [string]$argumente) {
    switch -Regex ($typ) {
        '^(msi|wix)$' {
            # MSI-Protokoll, damit bei Fehler 1603 & Co. der Grund in der Weboberflaeche steht
            $script:MsiLog = Join-Path $Arbeit ('msi_' + ([IO.Path]::GetFileNameWithoutExtension($datei) -replace '[^\w.-]', '_') + '.log')
            $p = Start-Process msiexec.exe -ArgumentList ("/i `"$datei`" $argumente /l*v `"$($script:MsiLog)`"") -PassThru
        }
        '^(msix|appx)$' {
            Add-AppxPackage -Path $datei -ErrorAction Stop
            return 0
        }
        default {
            if ($argumente) { $p = Start-Process -FilePath $datei -ArgumentList $argumente -PassThru }
            else { $p = Start-Process -FilePath $datei -PassThru }
        }
    }
    $null = $p.Handle   # sonst liefert ExitCode bei -PassThru ohne -Wait oft nichts
    # manche Installer starten am Ende das Programm und kehren nie zurueck -> Zeitlimit
    $start = Get-Date
    $script:Steuer = $null
    $script:Z.installer = @{ programm = $script:AktuellesProgramm; seit = $start.ToString('HH:mm:ss'); pid = $p.Id }
    try {
        while (-not $p.WaitForExit(3000)) {
            [void](Puls)
            if ($script:Steuer) {
                $script:Steuer = $null
                Log '  Uebersprungen auf Wunsch aus der Weboberflaeche - beende den Installer' 'Yellow'
                & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null
                return -999
            }
            $min = [int]((Get-Date) - $start).TotalMinutes
            if ($min -ge 5 -and $min % 5 -eq 0 -and $script:LetzteWarnung -ne $min) {
                $script:LetzteWarnung = $min
                Log "  laeuft seit $min min - wartet evtl. ein Fenster auf Eingabe? (in der Weboberflaeche: Ueberspringen)" 'Yellow'
            }
            if ($min -gt 45) { Log '  Zeitlimit (45 min) - laeuft im Hintergrund weiter' 'Yellow'; return -998 }
        }
    } finally { $script:Z.installer = $null }
    return $p.ExitCode
}

function Do-Installieren {
    $prof = Waehle-Profil
    $plan = Api ("/api/plan?profil=" + [uri]::EscapeDataString($prof))
    $pakete = @($plan.pakete)
    Log ("Liste '{0}': {1} Programme" -f $prof, $pakete.Count) 'Cyan'
    $vorhanden = @{}
    foreach ($p in (Hole-Programme)) { $vorhanden[(Normname $p.name)] = $p.version }
    $wg = $null
    $ordner = Join-Path $Arbeit 'pakete'
    New-Item -ItemType Directory -Force -Path $ordner | Out-Null
    $ergebnis = New-Object System.Collections.ArrayList
    $script:Z.ergebnisse = New-Object System.Collections.ArrayList
    $n = 0
    foreach ($p in $pakete) {
        $n++
        $kopf = '[{0}/{1}] {2}' -f $n, $pakete.Count, $p.name
        Fortschritt ($n - 1) $pakete.Count $p.name
        $nn = Normname $p.name
        if ($nn -and $vorhanden.ContainsKey($nn)) {
            Log "$kopf - schon installiert ($($vorhanden[$nn]))" 'DarkGray'
            [void]$ergebnis.Add([pscustomobject]@{ Programm = $p.name; Ergebnis = 'schon da' })
            Ergebnis $p.name ('schon installiert ' + $vorhanden[$nn]) 'da'; continue
        }
        if ($p.problem -or -not $p.url) {
            if (-not $wg) { $wg = Finde-Winget }
            if ($wg -and $p.quelle -eq 'winget') {
                Log "$kopf - $($p.problem) -> versuche winget" 'Yellow'
                & $wg install --id $p.id -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1 |
                    Select-Object -Last 2 | ForEach-Object { Log "  $_" }
                $txt = 'winget, Code ' + $LASTEXITCODE
            } else {
                Log "$kopf - uebersprungen: $($p.problem)" 'Yellow'
                $txt = 'uebersprungen'
            }
            [void]$ergebnis.Add([pscustomobject]@{ Programm = $p.name; Ergebnis = $txt })
            Ergebnis $p.name $txt $(if ($txt -eq 'winget, Code 0') { 'ok' } else { 'skip' }); continue
        }
        try {
            $ziel = Join-Path $ordner ($p.datei -replace '/', '_')
            $lokal = $null
            if ($Quelle) { $lokal = Join-Path $Quelle ($p.datei -replace '/', '\') }
            if ($lokal -and (Test-Path $lokal)) { Copy-Item $lokal $ziel -Force }
            else {
                # Laden = erste Haelfte des Pakets, Installieren = zweite
                $script:Teil = @{ basis = $n - 1; spanne = 0.5; gesamt = $pakete.Count; text = 'lade ' + $p.name }
                Fortschritt ($n - 1) $pakete.Count ("lade " + $p.name)
                Lade-Herunter $p.url $ziel
                $script:Teil = $null
            }
            if ($p.sha256) {
                $h = (Get-FileHash -Path $ziel -Algorithm SHA256).Hash.ToLower()
                if ($h -ne $p.sha256) { throw 'Pruefsumme falsch' }
            }
            $start = $ziel
            $typ = [string]$p.typ
            if ($p.nested) {
                $aus = Join-Path $ordner ([IO.Path]::GetFileNameWithoutExtension($ziel))
                Expand-Archive -Path $ziel -DestinationPath $aus -Force
                $start = Join-Path $aus ($p.nested -replace '/', '\')
            }
            Fortschritt ($n - 0.5) $pakete.Count ("installiere " + $p.name)
            $script:AktuellesProgramm = $p.name
            Log "$kopf - installiere ($typ $($p.args)) ..."
            $code = Starte-Installer $start $typ ([string]$p.args)
            if ($code -eq -999 -or $code -eq -998) {
                $txt = $(if ($code -eq -999) { 'uebersprungen (von Hand)' } else { 'Zeitlimit 45 min' })
                [void]$ergebnis.Add([pscustomobject]@{ Programm = $p.name; Ergebnis = $txt })
                Ergebnis $p.name $txt 'skip'; continue
            }
            $ok = @($p.codes) -contains $code
            if ($code -eq 3010 -or $code -eq 1641) { $script:Neustart = $true }
            if ($ok) { Log "$kopf - OK" 'Green' } else {
                Log "$kopf - Fehlercode $code" 'Red'
                if ($script:MsiLog -and (Test-Path $script:MsiLog)) {
                    # die aussagekraeftigen Zeilen: Fehlermeldungen und die fehlgeschlagene Aktion
                    Get-Content $script:MsiLog -Encoding Unicode -ErrorAction SilentlyContinue |
                        Where-Object { $_ -match 'Error \d{4}|Fehler \d{4}|returned value 3|R.ckgabewert 3|Installation failed|1603' } |
                        Select-Object -First 6 | ForEach-Object { Log ('    MSI: ' + $_.Trim()) 'Red' }
                    Log "    ganzes Protokoll: $($script:MsiLog)" 'DarkGray'
                }
            }
            $script:MsiLog = $null
            [void]$ergebnis.Add([pscustomobject]@{ Programm = $p.name; Ergebnis = $(if ($ok) { 'installiert' } else { "Fehler $code" }) })
            if ($ok) { Ergebnis $p.name ('installiert ' + $p.version) 'ok' } else { Ergebnis $p.name "Fehlercode $code" 'fehler' }
        } catch {
            Log "$kopf - FEHLER: $($_.Exception.Message)" 'Red'
            [void]$ergebnis.Add([pscustomobject]@{ Programm = $p.name; Ergebnis = 'Fehler' })
            Ergebnis $p.name $_.Exception.Message 'fehler'
        }
    }
    Fortschritt $pakete.Count $pakete.Count 'fertig'
    Write-Host ''
    $ergebnis | Format-Table -AutoSize | Out-String | ForEach-Object { Log $_ }
    try { Remove-Item -Recurse -Force $ordner } catch {}
}

# ---------------------------------------------------------------- 5) Updates
function Do-Updates {
    $wg = Finde-Winget
    if ($wg) {
        Fortschritt 0 2 'winget: Programme aktualisieren'
        Log 'winget: alle Programme aktualisieren ...' 'Cyan'
        & $wg source update --disable-interactivity 2>&1 | Out-Null
        & $wg upgrade --all --silent --include-unknown --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1 |
            Where-Object { $_ -match '\S' -and $_ -notmatch '^\s*[-\\|/]\s*$' -and $_ -notmatch '[\u2580-\u259F]' } |
            ForEach-Object { Log "  $_" }
    } else {
        Log 'winget nicht verfuegbar (frisches Windows? erst Store-Update von App Installer abwarten)' 'Yellow'
    }

    Fortschritt 1 2 'Windows Update: suche Updates'
    Log 'Windows Update (inkl. Treiber und Microsoft-Produkte) ...' 'Cyan'
    $sitzung = New-Object -ComObject Microsoft.Update.Session
    $sitzung.ClientApplicationID = 'V3D Setup'
    try {
        $sm = New-Object -ComObject Microsoft.Update.ServiceManager
        $sm.ClientApplicationID = 'V3D Setup'
        [void]$sm.AddService2('7971f918-a847-4430-9279-4a52d1efe18d', 7, '')
    } catch {}
    for ($runde = 1; $runde -le 3; $runde++) {
        $sucher = $sitzung.CreateUpdateSearcher()
        $treffer = $sucher.Search('IsInstalled=0 and IsHidden=0')
        $sammlung = New-Object -ComObject Microsoft.Update.UpdateColl
        foreach ($u in $treffer.Updates) {
            if ($u.InstallationBehavior.CanRequestUserInput) { continue }
            if (-not $u.EulaAccepted) { $u.AcceptEula() }
            [void]$sammlung.Add($u)
        }
        if ($sammlung.Count -eq 0) { Fortschritt 2 2 'Windows Update: alles aktuell'; Log 'Windows Update: nichts mehr offen.' 'Green'; break }
        foreach ($u in $sammlung) { Log "  - $($u.Title)" }
        Fortschritt 1 2 ("Windows Update Runde $runde - lade $($sammlung.Count) Updates")
        Log "Lade $($sammlung.Count) Updates ..."
        $lader = $sitzung.CreateUpdateDownloader()
        $lader.Updates = $sammlung
        [void]$lader.Download()
        Log 'Installiere ...'
        Fortschritt 1.5 2 ("Windows Update Runde $runde - installiere $($sammlung.Count) Updates")
        $inst = $sitzung.CreateUpdateInstaller()
        $inst.Updates = $sammlung
        $res = $inst.Install()
        Log ("Windows Update Runde {0}: Ergebnis {1}" -f $runde, $res.ResultCode) 'Green'
        if ($res.RebootRequired) { $script:Neustart = $true; break }
    }
}

# ---------------------------------------------------------------- Ablauf
function Fuehre-Aus($schritte) {
    $liste = @($schritte)
    $script:Z.schritte = @($liste | ForEach-Object { @{ name = $_; zustand = 'offen' } })
    for ($i = 0; $i -lt $liste.Count; $i++) {
        $s = $liste[$i]
        Log "===== $s =====" 'Cyan'
        $script:Z.fortschritt = $null
        Schritt-Zustand $s 'laeuft'
        try {
        switch ($s) {
            'Inventar' { Do-Inventar }
            'TreiberSichern' { Do-TreiberSichern }
            'TreiberZurueck' { Do-TreiberZurueck }
            'Installieren' { Do-Installieren }
            'Updates' { Do-Updates }
        }
        Schritt-Zustand $s 'fertig'
        } catch {
            Log "FEHLER in $($s): $($_.Exception.Message)" 'Red'
            Schritt-Zustand $s 'fehler'
            if (-not $script:Agent) { throw }
        }
        if ($script:Neustart) {
            $rest = @()
            if ($i + 1 -lt $liste.Count) { $rest = $liste[($i + 1)..($liste.Count - 1)] }
            # nach Updates immer noch einmal nachsehen, ob neue kommen
            if ($s -eq 'Updates' -or ($rest -contains 'Updates')) { if (-not ($rest -contains 'Updates')) { $rest += 'Updates' } }
            if ($rest.Count -gt 0) { Neustart-Mit-Fortsetzung $rest; return }
            Log 'Bitte den Rechner neu starten.' 'Yellow'
        }
    }
    if (Test-Path $ZustandDatei) { Remove-Item $ZustandDatei -Force }
    Unregister-ScheduledTask -TaskName $AufgabeName -Confirm:$false -ErrorAction SilentlyContinue
    Log 'Fertig.' 'Green'
}

function Menue {
    while ($true) {
        Write-Host ''
        Write-Host '  V3D Setup' -ForegroundColor DarkYellow
        Write-Host "  Server: $Server"
        Write-Host ''
        Write-Host '  ALTER RECHNER'
        Write-Host '   1) Inventar senden (Programmliste zum Abhaken auf V3DA)'
        Write-Host '   2) Treiber sichern (auf V3DA)'
        Write-Host ''
        Write-Host '  NEUER RECHNER'
        Write-Host '   3) Alles: Treiber zurueck + Programme + Updates'
        Write-Host '   4) Nur abgehakte Programme installieren'
        Write-Host '   5) Nur Treiber zurueckspielen'
        Write-Host ''
        Write-Host '  JEDER RECHNER'
        Write-Host '   6) Updates (winget + Windows Update, mit Neustarts)'
        Write-Host '   0) Ende'
        $w = Read-Host 'Auswahl'
        try {
            switch ($w) {
                '1' { Fuehre-Aus @('Inventar') }
                '2' { Fuehre-Aus @('TreiberSichern') }
                '3' { Fuehre-Aus @('TreiberZurueck', 'Installieren', 'Updates') }
                '4' { Fuehre-Aus @('Installieren') }
                '5' { Fuehre-Aus @('TreiberZurueck') }
                '6' { Fuehre-Aus @('Updates') }
                '0' { return }
            }
        } catch { Log "FEHLER: $($_.Exception.Message)" 'Red' }
    }
}

function Agent {
    $script:Agent = $true
    $script:Z.status = 'bereit'
    Write-Host ''
    Write-Host '  V3D Setup ist mit V3DA verbunden.' -ForegroundColor DarkYellow
    Write-Host "  Steuerung im Browser: $Server" -ForegroundColor DarkYellow
    Write-Host '  Dieses Fenster offen lassen. Schliessen = Verbindung beenden.'
    Write-Host ''
    while ($true) {
        $a = Puls
        if ($a) {
            if ($a.aktion -eq 'Beenden') { Log 'Verbindung beendet.' 'Yellow'; $script:Z.status = 'getrennt'; [void](Puls); return }
            $script:Neustart = $false
            $script:Profil = [string]$a.profil
            $script:TreiberWahl = $a.treiber
            if ($a.neustart -eq $false) { $script:OhneNeustart = $true }
            $script:Z.status = 'arbeitet'
            $script:Z.aufgabe = [string]$a.titel
            $script:Z.ergebnisse = $null
            Log "Auftrag aus der Weboberflaeche: $($a.titel)" 'Cyan'
            try { Fuehre-Aus @($a.schritte) } catch { Log "FEHLER: $($_.Exception.Message)" 'Red' }
            $script:Z.status = 'bereit'
            [void](Puls)
        }
        Start-Sleep -Seconds 3
    }
}

Log "V3D Setup gestartet (Modus $Modus)"
switch ($Modus) {
    'Agent' {
        if ($Server -notmatch '^https?://') { Write-Host 'Server unbekannt - bitte ueber den Starter von V3DA aufrufen.' -ForegroundColor Red; break }
        Agent
    }
    'Menue' { Menue }
    'Neuinstallation' { Fuehre-Aus @('TreiberZurueck', 'Installieren', 'Updates') }
    'Weiter' {
        Unregister-ScheduledTask -TaskName $AufgabeName -Confirm:$false -ErrorAction SilentlyContinue
        if (-not (Test-Path $ZustandDatei)) { Log 'Nichts fortzusetzen.'; break }
        $z = Get-Content $ZustandDatei -Raw | ConvertFrom-Json
        if ([int]$z.runde -gt 8) { Log 'Zu viele Neustarts - Abbruch. Bitte Log ansehen.' 'Red'; Remove-Item $ZustandDatei; break }
        if ($z.profil) { $script:Profil = [string]$z.profil }
        if ($z.quelle) { $Quelle = [string]$z.quelle }
        $script:Agent = $true
        $script:Z.status = 'arbeitet'
        $script:Z.aufgabe = 'Fortsetzung nach Neustart'
        Log "Fortsetzung nach Neustart (Runde $($z.runde)): $($z.schritte -join ', ')" 'Cyan'
        Fuehre-Aus @($z.schritte)
        Agent   # danach weiter fuer die Weboberflaeche erreichbar
    }
    default { Fuehre-Aus @($Modus) }
}
