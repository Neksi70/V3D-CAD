@echo off
set "VOLME3D_SELF=%~f0"
if /i "%~1"=="/server" goto server
title Volme3D Druck-Helfer
echo ============================================
echo   Volme3D Druck-Helfer wird gestartet...
echo ============================================
echo.
rem --- versteckt im Hintergrund starten ---
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath $env:VOLME3D_SELF -ArgumentList '/server' -WindowStyle Hidden" 2>nul
rem --- kurz warten + Status anzeigen (exit 1 = nicht erreichbar -> Fallback) ---
powershell -NoProfile -Command "Start-Sleep -Milliseconds 2200; try{$r=Invoke-RestMethod 'http://127.0.0.1:7777/ping' -TimeoutSec 3; Write-Host ('Helfer laeuft. Gefundene Slicer: ' + (($r.slicers) -join ', ')); exit 0}catch{exit 1}"
if errorlevel 1 goto runhere
echo.
echo Laeuft jetzt UNSICHTBAR im Hintergrund - dieses Fenster kann zu.
timeout /t 6 >nul
exit /b
:runhere
echo Konnte nicht versteckt starten - Helfer laeuft in DIESEM Fenster (offen lassen).
echo.
:server
powershell -NoProfile -ExecutionPolicy Bypass -Command "$c=Get-Content -LiteralPath $env:VOLME3D_SELF -Raw; $m=[char]35+'__'+'PS__'; Invoke-Expression $c.Substring($c.IndexOf($m)+$m.Length)"
exit /b
#__PS__
# ===== Volme3D Druck-Helfer (eingebettetes PowerShell) =====
$PORT = 7777
$ALLOWED = @('https://v3da.tailf05fe9.ts.net')   # erlaubte Web-Adressen (+ localhost)
$EXTS = @('.stl', '.3mf', '.obj')

function Test-Origin($o) {
    if (-not $o) { return $false }
    if ($ALLOWED -contains $o) { return $true }
    return ($o -like 'http://localhost*') -or ($o -like 'http://127.0.0.1*')
}
function Find-SlicerExe($folders, $exes) {
    foreach ($folder in $folders) {
        if (-not $folder -or -not (Test-Path -LiteralPath $folder)) { continue }
        foreach ($n in $exes) { $p = Join-Path $folder $n; if (Test-Path -LiteralPath $p) { return $p } }
        # Fallback: erste sinnvolle .exe im Ordner (keine Deinstaller/Updater/Crashpad)
        $e = Get-ChildItem -LiteralPath $folder -Filter *.exe -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '(?i)unins|setup|redist|crashpad|update|bsa' } | Sort-Object Length -Descending | Select-Object -First 1
        if ($e) { return $e.FullName }
    }
    return $null
}
function Get-Slicers {
    $ov = $env:VOLME3D_SLICER_CMD
    if ($ov) { return [ordered]@{ bambu = $ov; orca = $ov } }
    $pf = $env:ProgramFiles; $pf86 = ${env:ProgramFiles(x86)}; $lad = $env:LOCALAPPDATA
    $defs = [ordered]@{
        bambu     = @{ f = @("$pf\Bambu Studio", "$pf86\Bambu Studio", "$lad\Programs\Bambu Studio");                         e = @('bambu-studio.exe') }
        orca      = @{ f = @("$pf\OrcaSlicer", "$lad\Programs\OrcaSlicer");                                                    e = @('orca-slicer.exe', 'OrcaSlicer.exe') }
        anycubic  = @{ f = @("$pf\Anycubic Slicer Next", "$pf\AnycubicSlicerNext", "$lad\Programs\Anycubic Slicer Next", "$lad\Programs\AnycubicSlicerNext"); e = @('AnycubicSlicerNext.exe', 'AnycubicSlicer.exe', 'anycubic-slicer.exe') }
        elegoo    = @{ f = @("$pf\ElegooSlicer", "$pf\Elegoo Slicer", "$lad\Programs\ElegooSlicer", "$lad\Programs\Elegoo Slicer"); e = @('ElegooSlicer.exe', 'elegoo-slicer.exe') }
        snapmaker = @{ f = @("$pf\Snapmaker Orca", "$pf\SnapmakerOrca", "$lad\Programs\Snapmaker Orca", "$lad\Programs\SnapmakerOrca"); e = @('SnapmakerOrca.exe', 'Snapmaker Orca.exe', 'snapmaker-orca.exe', 'orca-slicer.exe') }
        prusa     = @{ f = @("$pf\Prusa3D\PrusaSlicer");                                                                       e = @('prusa-slicer.exe') }
    }
    $found = [ordered]@{}
    foreach ($key in $defs.Keys) { $p = Find-SlicerExe $defs[$key].f $defs[$key].e; if ($p) { $found[$key] = $p } }
    return $found
}
function Get-DownloadCandidates {
    $cands = New-Object System.Collections.Generic.List[string]
    try {
        $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders'
        $g = '{374DE290-123F-4565-9164-39C4925E467B}'
        $v = (Get-ItemProperty -Path $key -Name $g -ErrorAction SilentlyContinue).$g
        if ($v) { $cands.Add([Environment]::ExpandEnvironmentVariables($v)) }
    } catch {}
    if ($env:USERPROFILE)        { $cands.Add((Join-Path $env:USERPROFILE 'Downloads')) }
    if ($env:OneDrive)           { $cands.Add((Join-Path $env:OneDrive 'Downloads')) }
    if ($env:OneDriveConsumer)   { $cands.Add((Join-Path $env:OneDriveConsumer 'Downloads')) }
    if ($env:OneDriveCommercial) { $cands.Add((Join-Path $env:OneDriveCommercial 'Downloads')) }
    $seen = @{}; $out = @()
    foreach ($d in $cands) {
        if ($d -and (Test-Path -LiteralPath $d)) {
            try { $full = (Resolve-Path -LiteralPath $d).Path } catch { $full = $d }
            if (-not $seen.ContainsKey($full.ToLower())) { $seen[$full.ToLower()] = $true; $out += $full }
        }
    }
    return $out
}
function Get-LibDir {
    $docs = [Environment]::GetFolderPath('MyDocuments'); if (-not $docs) { $docs = $env:USERPROFILE }
    $d = Join-Path $docs 'Volme3D-STL'
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    return $d
}
function Get-UniquePath($dir, $name) {
    $tp = Join-Path $dir $name
    if (-not (Test-Path -LiteralPath $tp)) { return $tp }
    $base = [IO.Path]::GetFileNameWithoutExtension($name); $ext = [IO.Path]::GetExtension($name); $i = 2
    while (Test-Path -LiteralPath (Join-Path $dir ("{0}_{1}{2}" -f $base, $i, $ext))) { $i++ }
    return (Join-Path $dir ("{0}_{1}{2}" -f $base, $i, $ext))
}
function Invoke-Collect($move) {
    $srcs = Get-DownloadCandidates; $dst = Get-LibDir; $copied = 0; $skipped = 0
    foreach ($src in $srcs) {
        $files = Get-ChildItem -LiteralPath $src -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $EXTS -contains $_.Extension.ToLower() -and $_.DirectoryName -ne $dst }
        foreach ($f in $files) {
            $tp = Join-Path $dst $f.Name
            try {
                if ((Test-Path -LiteralPath $tp) -and ((Get-Item -LiteralPath $tp).Length -eq $f.Length)) { if ($move) { try { Remove-Item -LiteralPath $f.FullName -Force } catch {} }; $skipped++; continue }
                if (Test-Path -LiteralPath $tp) { $tp = Get-UniquePath $dst $f.Name }
                if ($move) { Move-Item -LiteralPath $f.FullName -Destination $tp -Force } else { Copy-Item -LiteralPath $f.FullName -Destination $tp -Force }
                $copied++
            } catch {}
        }
    }
    $count = (Get-ChildItem -LiteralPath $dst -File -ErrorAction SilentlyContinue | Where-Object { $EXTS -contains $_.Extension.ToLower() }).Count
    return [ordered]@{ ok = $true; copied = $copied; skipped = $skipped; dir = $dst; source = ($srcs -join '; '); count = $count }
}
function Get-LibList {
    $d = Get-LibDir; $items = @()
    Get-ChildItem -LiteralPath $d -File -ErrorAction SilentlyContinue | Where-Object { $EXTS -contains $_.Extension.ToLower() } | Sort-Object LastWriteTime -Descending | ForEach-Object {
        $items += [ordered]@{ name = $_.Name; size = $_.Length; mtime = [int64]([DateTimeOffset]$_.LastWriteTime).ToUnixTimeMilliseconds() }
    }
    return $items
}
function Get-LibFilePath($name) {
    if (-not $name) { return $null }
    $p = Join-Path (Get-LibDir) (Split-Path -Leaf $name)
    if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
    return $null
}
function Read-Headers($stream) {
    $bytes = New-Object System.Collections.Generic.List[byte]; $buf = New-Object byte[] 1
    while ($true) {
        $n = $stream.Read($buf, 0, 1); if ($n -le 0) { break }
        $bytes.Add($buf[0]); $c = $bytes.Count
        if ($c -ge 4 -and $bytes[$c-4] -eq 13 -and $bytes[$c-3] -eq 10 -and $bytes[$c-2] -eq 13 -and $bytes[$c-1] -eq 10) { break }
        if ($c -gt 65536) { break }
    }
    return [System.Text.Encoding]::ASCII.GetString($bytes.ToArray())
}
function Read-Body($stream, $len) {
    $body = New-Object byte[] $len; $read = 0
    while ($read -lt $len) { $r = $stream.Read($body, $read, $len - $read); if ($r -le 0) { break }; $read += $r }
    return $body
}
function Send-Bytes($stream, $status, $extraHeaders, $contentType, $bodyBytes) {
    if ($null -eq $bodyBytes) { $bodyBytes = New-Object byte[] 0 }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append("HTTP/1.1 $status`r`n"); [void]$sb.Append("Content-Type: $contentType`r`n")
    [void]$sb.Append("Content-Length: $($bodyBytes.Length)`r`n"); [void]$sb.Append("Connection: close`r`n")
    foreach ($k in $extraHeaders.Keys) { [void]$sb.Append("$k`: $($extraHeaders[$k])`r`n") }
    [void]$sb.Append("`r`n")
    $head = [System.Text.Encoding]::ASCII.GetBytes($sb.ToString())
    $stream.Write($head, 0, $head.Length)
    if ($bodyBytes.Length -gt 0) { $stream.Write($bodyBytes, 0, $bodyBytes.Length) }
    $stream.Flush()
}
function New-Cors($origin) {
    $h = [ordered]@{}
    if (Test-Origin $origin) { $h['Access-Control-Allow-Origin'] = $origin }
    $h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    $h['Access-Control-Allow-Headers'] = 'Content-Type, X-Slicer, X-Filename, X-LibFile'
    $h['Access-Control-Allow-Private-Network'] = 'true'
    return $h
}
function Send-Json($stream, $status, $obj, $origin) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress -Depth 6))
    Send-Bytes $stream $status (New-Cors $origin) 'application/json' $bytes
}
function Write-Line($stream, $text) {
    $b = [System.Text.Encoding]::UTF8.GetBytes($text + "`n"); $stream.Write($b, 0, $b.Length); $stream.Flush()
}
function Stream-Collect($stream, $origin, $move) {
    $cors = New-Cors $origin
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append("HTTP/1.1 200 OK`r`n"); [void]$sb.Append("Content-Type: application/x-ndjson`r`n"); [void]$sb.Append("Connection: close`r`n")
    foreach ($k in $cors.Keys) { [void]$sb.Append("$k`: $($cors[$k])`r`n") }
    [void]$sb.Append("`r`n")
    $h = [System.Text.Encoding]::ASCII.GetBytes($sb.ToString()); $stream.Write($h, 0, $h.Length); $stream.Flush()
    $srcs = Get-DownloadCandidates; $dst = Get-LibDir
    $all = @()
    foreach ($src in $srcs) { $all += Get-ChildItem -LiteralPath $src -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $EXTS -contains $_.Extension.ToLower() -and $_.DirectoryName -ne $dst } }
    $total = $all.Count; $copied = 0; $skipped = 0; $i = 0
    foreach ($f in $all) {
        $i++; $tp = Join-Path $dst $f.Name
        try {
            if ((Test-Path -LiteralPath $tp) -and ((Get-Item -LiteralPath $tp).Length -eq $f.Length)) { if ($move) { try { Remove-Item -LiteralPath $f.FullName -Force } catch {} }; $skipped++ }
            else { if (Test-Path -LiteralPath $tp) { $tp = Get-UniquePath $dst $f.Name }; if ($move) { Move-Item -LiteralPath $f.FullName -Destination $tp -Force } else { Copy-Item -LiteralPath $f.FullName -Destination $tp -Force }; $copied++ }
        } catch {}
        Write-Line $stream (@{ i = $i; n = $total; name = $f.Name } | ConvertTo-Json -Compress)
    }
    $count = (Get-ChildItem -LiteralPath $dst -File -ErrorAction SilentlyContinue | Where-Object { $EXTS -contains $_.Extension.ToLower() }).Count
    Write-Line $stream (([ordered]@{ done = $true; ok = $true; copied = $copied; skipped = $skipped; dir = $dst; source = ($srcs -join '; '); count = $count }) | ConvertTo-Json -Compress)
}
function Handle-Client($client) {
    $stream = $client.GetStream()
    $headerText = Read-Headers $stream
    if (-not $headerText) { return }
    $lines = $headerText -split "`r`n"; $parts = $lines[0] -split ' '
    if ($parts.Count -lt 2) { return }
    $method = $parts[0]; $rawpath = $parts[1]; $path = ($rawpath -split '\?')[0]
    $query = ''; if ($rawpath -match '\?') { $query = ($rawpath -split '\?', 2)[1] }
    $headers = @{}
    for ($i = 1; $i -lt $lines.Count; $i++) { $ln = $lines[$i]; $idx = $ln.IndexOf(':'); if ($idx -gt 0) { $headers[$ln.Substring(0, $idx).Trim().ToLower()] = $ln.Substring($idx + 1).Trim() } }
    $origin = $headers['origin']; $cors = New-Cors $origin
    if ($method -eq 'OPTIONS') { Send-Bytes $stream '204 No Content' $cors 'text/plain' (New-Object byte[] 0); return }
    if ($method -eq 'GET' -and $path -eq '/ping') { Send-Json $stream '200 OK' ([ordered]@{ ok = $true; app = 'volme3d-print-helper'; version = 3; os = 'Windows'; slicers = @((Get-Slicers).Keys); libDir = (Get-LibDir) }) $origin; return }
    if ($method -eq 'GET' -and $path -eq '/list') {
        if (-not (Test-Origin $origin)) { Send-Json $stream '403 Forbidden' (@{ ok = $false; error = 'origin not allowed' }) $origin; return }
        Send-Json $stream '200 OK' ([ordered]@{ ok = $true; dir = (Get-LibDir); files = @(Get-LibList) }) $origin; return
    }
    if ($method -eq 'GET' -and $path -eq '/file') {
        if (-not (Test-Origin $origin)) { Send-Json $stream '403 Forbidden' (@{ ok = $false; error = 'origin not allowed' }) $origin; return }
        $name = ''; foreach ($kv in ($query -split '&')) { if ($kv -like 'name=*') { $name = [System.Uri]::UnescapeDataString($kv.Substring(5)) } }
        $fp = Get-LibFilePath $name
        if (-not $fp) { Send-Json $stream '404 Not Found' (@{ ok = $false; error = 'Datei nicht gefunden' }) $origin; return }
        Send-Bytes $stream '200 OK' (New-Cors $origin) 'model/stl' ([System.IO.File]::ReadAllBytes($fp)); return
    }
    if ($method -eq 'POST' -and ($path -eq '/collect' -or $path -eq '/print')) {
        if (-not (Test-Origin $origin)) { Send-Json $stream '403 Forbidden' (@{ ok = $false; error = "origin not allowed: $origin" }) $origin; return }
        $len = 0; if ($headers.ContainsKey('content-length')) { [void][int]::TryParse($headers['content-length'], [ref]$len) }
        $body = if ($len -gt 0) { Read-Body $stream $len } else { New-Object byte[] 0 }
        if ($path -eq '/collect') {
            $move = $false
            try { if ($body.Length -gt 0) { $j = [System.Text.Encoding]::UTF8.GetString($body) | ConvertFrom-Json; if ($j.move) { $move = $true } } } catch {}
            try { Stream-Collect $stream $origin $move } catch {}
            return
        }
        $want = ''; if ($headers.ContainsKey('x-slicer')) { $want = $headers['x-slicer'].ToLower() }
        $slicers = Get-Slicers
        if ($slicers.Count -eq 0) { Send-Json $stream '500 Error' (@{ ok = $false; error = 'Kein Slicer gefunden' }) $origin; return }
        $key = if ($slicers.Contains($want)) { $want } else { @($slicers.Keys)[0] }
        $exe = $slicers[$key]; $toOpen = $null
        if ($headers.ContainsKey('x-libfile') -and $headers['x-libfile']) {
            $toOpen = Get-LibFilePath $headers['x-libfile']
            if (-not $toOpen) { Send-Json $stream '404 Not Found' (@{ ok = $false; error = 'Bibliotheksdatei nicht gefunden' }) $origin; return }
        } else {
            if ($body.Length -eq 0) { Send-Json $stream '400 Bad Request' (@{ ok = $false; error = 'leere Datei' }) $origin; return }
            $fname = 'modell.stl'; if ($headers.ContainsKey('x-filename') -and $headers['x-filename']) { $fname = Split-Path -Leaf $headers['x-filename'] }
            $outdir = Join-Path $env:TEMP 'volme3d-print'; if (-not (Test-Path -LiteralPath $outdir)) { New-Item -ItemType Directory -Path $outdir -Force | Out-Null }
            $toOpen = Join-Path $outdir $fname; [System.IO.File]::WriteAllBytes($toOpen, $body)
        }
        try { Start-Process -FilePath $exe -ArgumentList ('"' + $toOpen + '"') | Out-Null }
        catch { Send-Json $stream '500 Error' (@{ ok = $false; error = "Slicer-Start fehlgeschlagen: $_" }) $origin; return }
        Send-Json $stream '200 OK' ([ordered]@{ ok = $true; slicer = $key; file = (Split-Path -Leaf $toOpen) }) $origin; return
    }
    Send-Json $stream '404 Not Found' (@{ ok = $false; error = 'not found' }) $origin
}
function Install-Autostart {
    try {
        $startup = [Environment]::GetFolderPath('Startup'); if (-not $startup) { return }
        $self = $env:VOLME3D_SELF; if (-not $self) { return }
        $vbsPath = Join-Path $startup 'Volme3D-Druck-Helfer.vbs'
        $inner = '$c=Get-Content -LiteralPath ''' + $self + ''' -Raw; $m=[char]35+''__''+''PS__''; Invoke-Expression $c.Substring($c.IndexOf($m)+$m.Length)'
        $run = 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "' + $inner.Replace('"','""') + '"'
        $vbs = 'CreateObject("WScript.Shell").Run "' + $run.Replace('"','""') + '", 0, False'
        Set-Content -LiteralPath $vbsPath -Value $vbs -Encoding ASCII
    } catch {}
}
Install-Autostart
try { $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $PORT); $listener.Start() }
catch { Write-Host "Konnte Port $PORT nicht oeffnen (laeuft der Helfer schon?): $_"; Start-Sleep 5; exit 1 }
$sl = Get-Slicers
Write-Host "Volme3D Druck-Helfer laeuft auf http://127.0.0.1:$PORT"
if ($sl.Count -gt 0) { Write-Host ("Gefundene Slicer: " + (($sl.Keys | ForEach-Object { "$_ -> $($sl[$_])" }) -join ', ')) } else { Write-Host "Gefundene Slicer: KEINE (Pfad in der Datei pruefen)" }
$autoSec = 30; if ($env:VOLME3D_AUTO_SEC) { try { $autoSec = [int]$env:VOLME3D_AUTO_SEC } catch {} }
Write-Host "Autostart eingerichtet. Neue Downloads werden automatisch alle $autoSec s in die Bibliothek verschoben."
Write-Host "Fenster kann offen bleiben (oder schliessen - Autostart startet neu)."
$lastAuto = Get-Date   # erstes Auto-Verschieben nach $autoSec (Server antwortet sofort)
while ($true) {
    if ($listener.Pending()) {
        $client = $listener.AcceptTcpClient()
        try { Handle-Client $client } catch {} finally { try { $client.Close() } catch {} }
    } else {
        Start-Sleep -Milliseconds 250
    }
    if (((Get-Date) - $lastAuto).TotalSeconds -ge $autoSec) {
        $lastAuto = Get-Date
        try { Invoke-Collect $true | Out-Null } catch {}   # automatisch: VERSCHIEBEN
    }
}
