# V3D Notebook-Agent: Claude (Chat/Cowork ueber den V3D-Mail-Connector) kann auf diesem Notebook
# Dateien laden/entpacken, PowerShell ausfuehren, Programme starten und per winget installieren.
# Weg: V3DA (100.125.34.44) --Tailscale--> hier Port 8933 --> node agent.js (Aufgabenplanung, Admin)
#
# Start in einer ADMIN-PowerShell:
#   irm "https://v3da.tailf05fe9.ts.net/ablage/api/datei?pfad=v3d-notebook-agent-einrichten.ps1" -OutFile $env:TEMP\v3d-agent.ps1
#   powershell -ExecutionPolicy Bypass -File $env:TEMP\v3d-agent.ps1
#
# Erneut ausfuehren ist gefahrlos: ersetzt Agent, Aufgabe und Firewall-Regel, erzeugt einen NEUEN Token.
# Der Token steht NICHT in diesem Skript: der Server holt ihn beim ersten Auftrag einmalig ab
# (nur in den ersten 24 Stunden, nur von V3DA).
# ERZEUGT aus notebook-agent/einrichten.vorlage.ps1 + agent.js durch notebook-agent/bauen.sh

$ErrorActionPreference = 'Stop'
trap {
    Write-Host "`nFEHLER: $_" -ForegroundColor Red
    Write-Host "Zeile $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim())"
    Read-Host "`nEnter zum Schliessen"
    exit 1
}
$Port    = 8933
$Server  = '100.125.34.44'          # V3DA - nur der darf rein
$Basis   = Join-Path $env:ProgramData 'V3D'
$Aufgabe = 'V3D Notebook-Agent'

function Schritt($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Gut($t)     { Write-Host "   OK  $t" -ForegroundColor Green }
function Warn($t)    { Write-Host "   !!  $t" -ForegroundColor Yellow }

# 0) Adminrechte
Schritt 'Adminrechte pruefen'
$ich = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$ich).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Bitte in einer PowerShell "Als Administrator ausfuehren" starten.'
}
$Konto = $ich.Name
Gut "Admin, Konto: $Konto"
if ($Konto -notmatch '\\V3D$') { Warn "Der Agent laeuft spaeter fuer $Konto - ist das Volkers Konto?" }

# 1) Tailscale-IP
Schritt 'Tailscale pruefen'
$ts = @("$env:ProgramFiles\Tailscale\tailscale.exe", 'tailscale') |
    Where-Object { Get-Command $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
if (-not $ts) { throw 'Tailscale nicht gefunden.' }
$Ip = (& $ts ip -4 | Select-Object -First 1).Trim()
if ($Ip -notmatch '^100\.') { throw "Keine Tailscale-IP ($Ip) - ist Tailscale angemeldet?" }
Gut "Tailscale-IP: $Ip"

# 2) Node.js
Schritt 'Node.js pruefen'
function Pfad-Neu {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ";$env:ProgramFiles\nodejs"
}
Pfad-Neu
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Node.js fehlt - versuche winget ...'
    try { winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements } catch { Warn "winget: $_" }
    Pfad-Neu
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'winget ging nicht - lade Node.js direkt von nodejs.org ...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $lts = (Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing | Where-Object { $_.lts } | Select-Object -First 1).version
    $msi = Join-Path $env:TEMP "node-$lts-x64.msi"
    Invoke-WebRequest "https://nodejs.org/dist/$lts/node-$lts-x64.msi" -OutFile $msi -UseBasicParsing
    Start-Process msiexec.exe -Wait -ArgumentList '/i', "`"$msi`"", '/qn', '/norestart'
    Pfad-Neu
}
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { throw 'Node.js konnte nicht installiert werden.' }
$nv = & $Node --version
if ([int]($nv -replace '^v(\d+).*', '$1') -lt 18) { throw "Node.js $nv ist zu alt (mind. 18)." }
Gut "Node.js $nv ($Node)"

# 3) Alten Agenten stoppen
Schritt 'Alten Agenten stoppen (falls vorhanden)'
Stop-ScheduledTask -TaskPath '\V3D\' -TaskName $Aufgabe -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*\V3D\agent.js*' -or $_.CommandLine -like '*\V3D\start.vbs*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host "   beendet: PID $($_.ProcessId) $($_.Name)" }

# 4) Dateien
Schritt "Dateien in $Basis"
New-Item -ItemType Directory -Force -Path $Basis | Out-Null
# Nur Administratoren, SYSTEM und dieses Konto (der Token liegt hier)
& icacls $Basis /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' "*$($ich.User.Value):(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "icacls fehlgeschlagen ($LASTEXITCODE)" }
$utf8 = New-Object Text.UTF8Encoding $false

$AgentJs = @'
__AGENT_JS__
'@
[IO.File]::WriteAllText((Join-Path $Basis 'agent.js'), $AgentJs, $utf8)

$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$cfg = [ordered]@{
    token     = -join ($b | ForEach-Object { $_.ToString('x2') })
    ip        = $Ip
    port      = $Port
    erlaubt   = @($Server)
    gekoppelt = $false
    erstellt  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}
[IO.File]::WriteAllText((Join-Path $Basis 'agent-config.json'), (ConvertTo-Json -InputObject $cfg), $utf8)

# start.vbs: Node unsichtbar, nach Absturz nach 10 s neu
$vbs = @'
Set sh = CreateObject("WScript.Shell")
Do
  sh.Run """NODE"" ""AGENT""", 0, True
  WScript.Sleep 10000
Loop
'@
$vbs = $vbs.Replace('NODE', $Node).Replace('AGENT', (Join-Path $Basis 'agent.js'))
[IO.File]::WriteAllText((Join-Path $Basis 'start.vbs'), $vbs, [Text.Encoding]::ASCII)
Gut 'agent.js, agent-config.json (neuer Token), start.vbs'

# 5) Firewall
Schritt 'Firewall-Regel'
Remove-NetFirewallRule -DisplayName $Aufgabe -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $Aufgabe -Direction Inbound -Protocol TCP -LocalPort $Port `
    -RemoteAddress $Server -Action Allow -Profile Any | Out-Null
Gut "TCP $Port eingehend nur von $Server"

# 6) Aufgabenplanung: bei Anmeldung, hoechste Rechte, in Volkers Sitzung (Fenster sichtbar)
Schritt 'Aufgabenplanung'
$akt   = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" -Argument "`"$Basis\start.vbs`""
$ausl  = New-ScheduledTaskTrigger -AtLogOn -User $Konto
$wer   = New-ScheduledTaskPrincipal -UserId $Konto -LogonType Interactive -RunLevel Highest
$einst = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskPath '\V3D\' -TaskName $Aufgabe -Action $akt -Trigger $ausl -Principal $wer -Settings $einst -Force | Out-Null
Gut "Aufgabe \V3D\$Aufgabe (bei Anmeldung von $Konto, hoechste Rechte)"

# 7) Starten + Diagnose
Schritt 'Starten'
Start-ScheduledTask -TaskPath '\V3D\' -TaskName $Aufgabe
$ok = $false
for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
    Start-Sleep 1
    $c = New-Object Net.Sockets.TcpClient
    try { $c.Connect($Ip, $Port); $ok = $true } catch { } finally { $c.Close() }
}

Schritt 'Diagnose'
$t = Get-ScheduledTask -TaskPath '\V3D\' -TaskName $Aufgabe
Write-Host "   Aufgabe:   $($t.State)  (letztes Ergebnis $((Get-ScheduledTaskInfo $t).LastTaskResult))"
$fw = Get-NetFirewallRule -DisplayName $Aufgabe -ErrorAction SilentlyContinue
Write-Host "   Firewall:  $(if ($fw) { 'Regel da, ' + ($fw | Get-NetFirewallAddressFilter).RemoteAddress } else { 'FEHLT' })"
$proz = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*\V3D\agent.js*' }
Write-Host "   Prozess:   $(if ($proz) { 'node PID ' + $proz.ProcessId + ', Sitzung ' + $proz.SessionId } else { 'LAEUFT NICHT' })"
$log = Join-Path $Basis 'agent.log'
if (Test-Path $log) { Write-Host '   Log (letzte Zeilen):'; Get-Content $log -Tail 6 | ForEach-Object { Write-Host "     $_" } }
if ($ok) {
    Gut "Agent lauscht auf $($Ip):$Port"
    Write-Host "`nFertig. Claude kann jetzt die Werkzeuge notebook_* benutzen." -ForegroundColor Green
    Write-Host 'Wichtig: Der erste Auftrag von Claude muss innerhalb von 24 Stunden kommen (Kopplung).'
} else {
    Warn "Port $Port antwortet nicht. Bitte diese Ausgabe als Screenshot an Claude schicken."
}
Read-Host "`nEnter zum Schliessen"
