# V3D Setup - Windows-Rechner inventarisieren, Treiber sichern, neu einrichten.
# Server: V3DA (V3D Setup). Datei bewusst reines ASCII (Umlaute als ae/oe/ue),
# damit Windows PowerShell 5.1 sie nicht falsch dekodiert.
param(
    [ValidateSet('Menue', 'Inventar', 'TreiberSichern', 'TreiberZurueck', 'Installieren', 'Updates', 'Neuinstallation', 'Weiter')]
    [string]$Modus = 'Menue',
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

function Log([string]$t, [string]$farbe = 'Gray') {
    $z = '{0:HH:mm:ss} {1}' -f (Get-Date), $t
    Write-Host $z -ForegroundColor $farbe
    try { Add-Content -Path $LogDatei -Value $z -Encoding UTF8 } catch {}
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
    $wc = New-Object Net.WebClient
    try { $wc.DownloadFile($url, $ziel) } finally { $wc.Dispose() }
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
    try { $f.CopyTo($s, 1048576) } finally { $f.Close(); $s.Close() }
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
    Start-Sleep -Seconds 30
    Restart-Computer -Force
    exit
}

# ---------------------------------------------------------------- 1) Inventar
function Do-Inventar {
    Log 'Lese installierte Programme ...' 'Cyan'
    $progs = Hole-Programme
    Log ("{0} Programme gefunden" -f $progs.Count)
    $ids = @()
    $wg = Finde-Winget
    if ($wg) {
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
    $json = $inv | ConvertTo-Json -Depth 5
    Set-Content -Path (Join-Path $Arbeit "inventar_$env:COMPUTERNAME.json") -Value $json -Encoding UTF8
    $r = Invoke-RestMethod -UseBasicParsing -Uri "$Server/api/inventar" -Method Post `
        -Body ([Text.Encoding]::UTF8.GetBytes($json)) -ContentType 'application/json; charset=utf-8'
    Log "Inventar auf V3DA gespeichert: $($r.datei)" 'Green'
    Log "Zum Abhaken oeffnen: $($r.link)" 'Green'
    try { Start-Process $r.link } catch {}
}

# ---------------------------------------------------------------- 2) Treiber sichern
function Do-TreiberSichern {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $stempel = Get-Date -Format 'yyyyMMdd-HHmmss'
    $ordner = Join-Path $Arbeit "treiber_$stempel"
    Log 'Exportiere Drittanbieter-Treiber (pnputil) ...' 'Cyan'
    New-Item -ItemType Directory -Force -Path $ordner | Out-Null
    & pnputil.exe /export-driver * $ordner | Out-Null
    $anzahl = @(Get-ChildItem -Path $ordner -Filter *.inf -Recurse).Count
    if ($anzahl -eq 0) { Log 'Keine Treiber exportiert.' 'Red'; return }
    Get-WindowsDriver -Online -ErrorAction SilentlyContinue |
        Select-Object OriginalFileName, ProviderName, ClassName, Version, Date |
        Export-Csv -Path (Join-Path $ordner 'inventar.csv') -NoTypeInformation -Encoding UTF8
    $zip = "$ordner.zip"
    Log "$anzahl Treiber - packe ZIP ..."
    [IO.Compression.ZipFile]::CreateFromDirectory($ordner, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
    $mb = [math]::Round((Get-Item $zip).Length / 1MB)
    $cs = Get-CimInstance Win32_ComputerSystem
    $modell = [uri]::EscapeDataString("$($cs.Manufacturer) $($cs.Model)")
    Log "Lade $mb MB auf V3DA hoch ..."
    $r = Lade-Hoch $zip "$Server/api/treiber?host=$env:COMPUTERNAME&name=$stempel&anzahl=$anzahl&modell=$modell"
    Log "Treiber gesichert: $($r.datei)" 'Green'
    Log "Lokale Kopie (z.B. fuer USB-Stick): $zip"
    Remove-Item -Recurse -Force $ordner
}

# ---------------------------------------------------------------- 3) Treiber zurueck
function Do-TreiberZurueck {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = $TreiberZip
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
    $ordner = Join-Path $Arbeit ('treiber_ein_' + (Get-Date -Format 'HHmmss'))
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $ordner)
    Log 'Spiele Treiber ein (pnputil /add-driver /install) ...' 'Cyan'
    $aus = & pnputil.exe /add-driver "$ordner\*.inf" /subdirs /install 2>&1
    $code = $LASTEXITCODE
    $aus | Select-Object -Last 6 | ForEach-Object { Log "  $_" }
    if ($code -eq 3010) { $script:Neustart = $true }
    Log "Treiber eingespielt (Code $code)" 'Green'
}

# ---------------------------------------------------------------- 4) Programme
function Starte-Installer([string]$datei, [string]$typ, [string]$argumente) {
    switch -Regex ($typ) {
        '^(msi|wix)$' {
            $p = Start-Process msiexec.exe -ArgumentList ("/i `"$datei`" $argumente") -PassThru
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
    if (-not $p.WaitForExit(45 * 60 * 1000)) { Log '  Zeitlimit (45 min) - laeuft im Hintergrund weiter' 'Yellow'; return 0 }
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
    $n = 0
    foreach ($p in $pakete) {
        $n++
        $kopf = '[{0}/{1}] {2}' -f $n, $pakete.Count, $p.name
        $nn = Normname $p.name
        if ($nn -and $vorhanden.ContainsKey($nn)) {
            Log "$kopf - schon installiert ($($vorhanden[$nn]))" 'DarkGray'
            [void]$ergebnis.Add([pscustomobject]@{ Programm = $p.name; Ergebnis = 'schon da' }); continue
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
            [void]$ergebnis.Add([pscustomobject]@{ Programm = $p.name; Ergebnis = $txt }); continue
        }
        try {
            $ziel = Join-Path $ordner ($p.datei -replace '/', '_')
            $lokal = $null
            if ($Quelle) { $lokal = Join-Path $Quelle ($p.datei -replace '/', '\') }
            if ($lokal -and (Test-Path $lokal)) { Copy-Item $lokal $ziel -Force }
            else { Lade-Herunter $p.url $ziel }
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
            Log "$kopf - installiere ($typ $($p.args)) ..."
            $code = Starte-Installer $start $typ ([string]$p.args)
            $ok = @($p.codes) -contains $code
            if ($code -eq 3010 -or $code -eq 1641) { $script:Neustart = $true }
            if ($ok) { Log "$kopf - OK" 'Green' } else { Log "$kopf - Fehlercode $code" 'Red' }
            [void]$ergebnis.Add([pscustomobject]@{ Programm = $p.name; Ergebnis = $(if ($ok) { 'installiert' } else { "Fehler $code" }) })
        } catch {
            Log "$kopf - FEHLER: $($_.Exception.Message)" 'Red'
            [void]$ergebnis.Add([pscustomobject]@{ Programm = $p.name; Ergebnis = 'Fehler' })
        }
    }
    Write-Host ''
    $ergebnis | Format-Table -AutoSize | Out-String | ForEach-Object { Log $_ }
    try { Remove-Item -Recurse -Force $ordner } catch {}
}

# ---------------------------------------------------------------- 5) Updates
function Do-Updates {
    $wg = Finde-Winget
    if ($wg) {
        Log 'winget: alle Programme aktualisieren ...' 'Cyan'
        & $wg source update --disable-interactivity 2>&1 | Out-Null
        & $wg upgrade --all --silent --include-unknown --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1 |
            Where-Object { $_ -match '\S' -and $_ -notmatch '^\s*[-\\|/]\s*$' -and $_ -notmatch '[\u2580-\u259F]' } |
            ForEach-Object { Log "  $_" }
    } else {
        Log 'winget nicht verfuegbar (frisches Windows? erst Store-Update von App Installer abwarten)' 'Yellow'
    }

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
        if ($sammlung.Count -eq 0) { Log 'Windows Update: nichts mehr offen.' 'Green'; break }
        foreach ($u in $sammlung) { Log "  - $($u.Title)" }
        Log "Lade $($sammlung.Count) Updates ..."
        $lader = $sitzung.CreateUpdateDownloader()
        $lader.Updates = $sammlung
        [void]$lader.Download()
        Log 'Installiere ...'
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
    for ($i = 0; $i -lt $liste.Count; $i++) {
        $s = $liste[$i]
        Log "===== $s =====" 'Cyan'
        switch ($s) {
            'Inventar' { Do-Inventar }
            'TreiberSichern' { Do-TreiberSichern }
            'TreiberZurueck' { Do-TreiberZurueck }
            'Installieren' { Do-Installieren }
            'Updates' { Do-Updates }
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

Log "V3D Setup gestartet (Modus $Modus)"
switch ($Modus) {
    'Menue' { Menue }
    'Neuinstallation' { Fuehre-Aus @('TreiberZurueck', 'Installieren', 'Updates') }
    'Weiter' {
        Unregister-ScheduledTask -TaskName $AufgabeName -Confirm:$false -ErrorAction SilentlyContinue
        if (-not (Test-Path $ZustandDatei)) { Log 'Nichts fortzusetzen.'; break }
        $z = Get-Content $ZustandDatei -Raw | ConvertFrom-Json
        if ([int]$z.runde -gt 8) { Log 'Zu viele Neustarts - Abbruch. Bitte Log ansehen.' 'Red'; Remove-Item $ZustandDatei; break }
        if ($z.profil) { $script:Profil = [string]$z.profil }
        if ($z.quelle) { $Quelle = [string]$z.quelle }
        Log "Fortsetzung nach Neustart (Runde $($z.runde)): $($z.schritte -join ', ')" 'Cyan'
        Fuehre-Aus @($z.schritte)
        Read-Host 'Enter zum Schliessen'
    }
    default { Fuehre-Aus @($Modus) }
}
