# V3D Browser-Bruecke: Claude (Server, Chat, Cowork) steuert den echten Chrome auf diesem Notebook.
# Ersatz fuer "Claude in Chrome". Weg: V3DA (100.125.34.44) --Tailscale--> hier Port 8931
#   --> Playwright MCP (--extension) --> Erweiterung "Playwright MCP Bridge" --> dein Chrome.
# Ausfuehren: Rechtsklick > "Mit PowerShell ausfuehren"
#   oder: powershell -ExecutionPolicy Bypass -File .\v3d-browser-bruecke-einrichten.ps1

$ErrorActionPreference = 'Stop'
trap {
    Write-Host "`nFEHLER: $_" -ForegroundColor Red
    Write-Host "Zeile $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim())"
    Read-Host "`nEnter zum Schliessen"
    exit 1
}
$Port   = 8931
$Server = '100.125.34.44'          # V3DA - nur der darf rein
$Ordner = Join-Path $env:LOCALAPPDATA 'V3DBrowserBruecke'
$Store  = 'https://chromewebstore.google.com/detail/playwright-mcp-bridge/mmlmfjhmonkocbjadbfplnigmagldckm'

function Schritt($t) { Write-Host "`n== $t" -ForegroundColor Cyan }

# 1) Tailscale-IP
Schritt 'Tailscale pruefen'
$ts = @("$env:ProgramFiles\Tailscale\tailscale.exe", 'tailscale') |
    Where-Object { Get-Command $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
if (-not $ts) { throw 'Tailscale nicht gefunden.' }
$Ip = (& $ts ip -4 | Select-Object -First 1).Trim()
if ($Ip -notmatch '^100\.') { throw "Keine Tailscale-IP ($Ip) - ist Tailscale angemeldet?" }
Write-Host "Tailscale-IP dieses Notebooks: $Ip"

# 2) Node.js
Schritt 'Node.js pruefen'
function Pfad-Neu {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ";$env:ProgramFiles\nodejs"
}
Pfad-Neu
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    Write-Host 'Node.js fehlt - versuche winget ...'
    try { winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements } catch { Write-Host "winget: $_" }
    Pfad-Neu
}
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    Write-Host 'winget ging nicht - lade Node.js direkt von nodejs.org ...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $lts = (Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing | Where-Object { $_.lts } | Select-Object -First 1).version
    $msi = Join-Path $env:TEMP "node-$lts-x64.msi"
    Invoke-WebRequest "https://nodejs.org/dist/$lts/node-$lts-x64.msi" -OutFile $msi -UseBasicParsing
    Write-Host "Installiere Node.js $lts (Admin-Abfrage bestaetigen) ..."
    Start-Process msiexec.exe -Verb RunAs -Wait -ArgumentList '/i', "`"$msi`"", '/qn', '/norestart'
    Pfad-Neu
}
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw 'Node.js konnte nicht installiert werden.' }
& node --version

# 3) Erweiterung + Token
Schritt 'Erweiterung "Playwright MCP Bridge"'
Write-Host 'Im Chrome oder Edge: Erweiterung hinzufuegen, dann auf ihr Symbol klicken.'
Write-Host 'Dort steht ein Token (PLAYWRIGHT_MCP_EXTENSION_TOKEN=...). Den Wert hinter = kopieren.'
Start-Process $Store
$Token = (Read-Host 'Token einfuegen (leer = Chrome fragt bei jeder Verbindung nach)').Trim()
if ($Token -match '=') { $Token = $Token.Split('=')[-1].Trim() }
# Edge oder Chrome? Dort, wo die Erweiterung installiert ist
$ExtId = 'mmlmfjhmonkocbjadbfplnigmagldckm'
$Browser = 'chrome'
if (Test-Path "$env:LOCALAPPDATA\Microsoft\Edge\User Data\*\Extensions\$ExtId") { $Browser = 'msedge' }
if (Test-Path "$env:LOCALAPPDATA\Google\Chrome\User Data\*\Extensions\$ExtId") { $Browser = 'chrome' }
Write-Host "Browser: $Browser"

# 4) Startdateien
Schritt 'Dienst-Dateien anlegen'
New-Item -ItemType Directory -Force -Path $Ordner | Out-Null
$cmd = @"
@echo off
rem V3D Browser-Bruecke - startet sich nach Absturz neu
set PLAYWRIGHT_MCP_EXTENSION_TOKEN=$Token
:schleife
call npx -y @playwright/mcp@latest --extension --browser $Browser --host $Ip --port $Port --allowed-hosts $($Ip):$Port >> "%~dp0log.txt" 2>&1
timeout /t 10 /nobreak >nul
goto schleife
"@
[IO.File]::WriteAllText((Join-Path $Ordner 'start.cmd'), $cmd, [Text.Encoding]::ASCII)
$vbs = "CreateObject(""WScript.Shell"").Run """"""$Ordner\start.cmd"""""", 0, False"
[IO.File]::WriteAllText((Join-Path $Ordner 'start.vbs'), $vbs, [Text.Encoding]::ASCII)

# Autostart (unsichtbar) - kein Admin noetig
$wsh = New-Object -ComObject WScript.Shell
$lnk = $wsh.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'V3D Browser-Bruecke.lnk'))
$lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
$lnk.Arguments  = "`"$Ordner\start.vbs`""
$lnk.Save()
Write-Host "Ordner: $Ordner (Log: log.txt)"

# 5) Firewall: Port nur fuer V3DA (braucht einmal Admin)
Schritt 'Firewall-Regel (Admin-Abfrage)'
$fw = "Remove-NetFirewallRule -DisplayName 'V3D Browser-Bruecke' -ErrorAction SilentlyContinue; " +
      "New-NetFirewallRule -DisplayName 'V3D Browser-Bruecke' -Direction Inbound -Protocol TCP " +
      "-LocalPort $Port -RemoteAddress $Server -Action Allow | Out-Null"
Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-Command', $fw
Write-Host "Regel: TCP $Port eingehend nur von $Server"

# 6) Starten
Schritt 'Starten'
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*V3DBrowserBruecke*" -or $_.CommandLine -like "*playwright*mcp*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Process "$env:WINDIR\System32\wscript.exe" "`"$Ordner\start.vbs`""
Start-Sleep 15
$ok = Test-NetConnection -ComputerName $Ip -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue
if ($ok) { Write-Host "Laeuft: http://$($Ip):$Port/mcp" -ForegroundColor Green }
else { Write-Host "Noch nicht erreichbar - in 30 s nochmal pruefen, sonst $Ordner\log.txt ansehen." -ForegroundColor Yellow }
Write-Host "`nDem Claude auf dem Server sagen: Tailscale-IP $Ip"
Read-Host "`nEnter zum Schliessen"
