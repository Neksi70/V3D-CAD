# Volme3D Druck-Helfer (PowerShell, ohne Installation)
# Lauscht nur auf 127.0.0.1:7777. Oeffnet STLs im Slicer und sammelt Downloads ein.
# Wird ueber die mitgelieferte .bat gestartet. Traegt sich beim ersten Start in den
# Autostart ein. Beenden: Fenster schliessen (oder Strg+C).

$PORT = 7777
$ALLOWED = @('https://v3da.tailf05fe9.ts.net')   # erlaubte Web-Adressen (+ localhost)
$EXTS = @('.stl', '.3mf', '.obj')

function Test-Origin($o) {
    if (-not $o) { return $false }
    if ($ALLOWED -contains $o) { return $true }
    return ($o -like 'http://localhost*') -or ($o -like 'http://127.0.0.1*')
}

function Get-Slicers {
    $ov = $env:VOLME3D_SLICER_CMD
    if ($ov) { return [ordered]@{ bambu = $ov; orca = $ov } }
    $pf   = $env:ProgramFiles
    $pf86 = ${env:ProgramFiles(x86)}
    $lad  = $env:LOCALAPPDATA
    $cand = [ordered]@{
        bambu = @("$pf\Bambu Studio\bambu-studio.exe", "$pf86\Bambu Studio\bambu-studio.exe", "$lad\Programs\Bambu Studio\bambu-studio.exe")
        orca  = @("$pf\OrcaSlicer\orca-slicer.exe", "$pf\OrcaSlicer\OrcaSlicer.exe", "$lad\Programs\OrcaSlicer\orca-slicer.exe", "$lad\Programs\OrcaSlicer\OrcaSlicer.exe")
        prusa = @("$pf\Prusa3D\PrusaSlicer\prusa-slicer.exe")
    }
    $found = [ordered]@{}
    foreach ($key in $cand.Keys) {
        foreach ($p in $cand[$key]) {
            if ($p -and (Test-Path -LiteralPath $p)) { $found[$key] = $p; break }
        }
    }
    return $found
}

function Get-DownloadsDir { return (Join-Path $env:USERPROFILE 'Downloads') }
function Get-LibDir {
    $docs = [Environment]::GetFolderPath('MyDocuments')
    if (-not $docs) { $docs = $env:USERPROFILE }
    $d = Join-Path $docs 'Volme3D-STL'
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    return $d
}
function Get-UniquePath($dir, $name) {
    $tp = Join-Path $dir $name
    if (-not (Test-Path -LiteralPath $tp)) { return $tp }
    $base = [IO.Path]::GetFileNameWithoutExtension($name)
    $ext  = [IO.Path]::GetExtension($name)
    $i = 2
    while (Test-Path -LiteralPath (Join-Path $dir ("{0}_{1}{2}" -f $base, $i, $ext))) { $i++ }
    return (Join-Path $dir ("{0}_{1}{2}" -f $base, $i, $ext))
}
function Invoke-Collect($move) {
    $src = Get-DownloadsDir
    $dst = Get-LibDir
    $copied = 0; $skipped = 0
    if (Test-Path -LiteralPath $src) {
        $files = Get-ChildItem -LiteralPath $src -Recurse -File -ErrorAction SilentlyContinue |
                 Where-Object { $EXTS -contains $_.Extension.ToLower() -and $_.DirectoryName -ne $dst }
        foreach ($f in $files) {
            $tp = Join-Path $dst $f.Name
            try {
                if ((Test-Path -LiteralPath $tp) -and ((Get-Item -LiteralPath $tp).Length -eq $f.Length)) { $skipped++; continue }
                if (Test-Path -LiteralPath $tp) { $tp = Get-UniquePath $dst $f.Name }
                if ($move) { Move-Item -LiteralPath $f.FullName -Destination $tp -Force }
                else       { Copy-Item -LiteralPath $f.FullName -Destination $tp -Force }
                $copied++
            } catch {}
        }
    }
    $count = (Get-ChildItem -LiteralPath $dst -File -ErrorAction SilentlyContinue | Where-Object { $EXTS -contains $_.Extension.ToLower() }).Count
    return [ordered]@{ ok = $true; copied = $copied; skipped = $skipped; dir = $dst; source = $src; count = $count }
}
function Get-LibList {
    $d = Get-LibDir
    $items = @()
    Get-ChildItem -LiteralPath $d -File -ErrorAction SilentlyContinue |
        Where-Object { $EXTS -contains $_.Extension.ToLower() } |
        Sort-Object LastWriteTime -Descending |
        ForEach-Object {
            $items += [ordered]@{ name = $_.Name; size = $_.Length; mtime = [int64]([DateTimeOffset]$_.LastWriteTime).ToUnixTimeMilliseconds() }
        }
    return $items
}
function Get-LibFilePath($name) {
    if (-not $name) { return $null }
    $leaf = Split-Path -Leaf $name
    $p = Join-Path (Get-LibDir) $leaf
    if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
    return $null
}

# --- HTTP-Hilfen -------------------------------------------------------------
function Read-Headers($stream) {
    $bytes = New-Object System.Collections.Generic.List[byte]
    $buf = New-Object byte[] 1
    while ($true) {
        $n = $stream.Read($buf, 0, 1)
        if ($n -le 0) { break }
        $bytes.Add($buf[0])
        $c = $bytes.Count
        if ($c -ge 4 -and $bytes[$c-4] -eq 13 -and $bytes[$c-3] -eq 10 -and $bytes[$c-2] -eq 13 -and $bytes[$c-1] -eq 10) { break }
        if ($c -gt 65536) { break }
    }
    return [System.Text.Encoding]::ASCII.GetString($bytes.ToArray())
}
function Read-Body($stream, $len) {
    $body = New-Object byte[] $len
    $read = 0
    while ($read -lt $len) {
        $r = $stream.Read($body, $read, $len - $read)
        if ($r -le 0) { break }
        $read += $r
    }
    return $body
}
function Send-Bytes($stream, $status, $extraHeaders, $contentType, $bodyBytes) {
    if ($null -eq $bodyBytes) { $bodyBytes = New-Object byte[] 0 }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append("HTTP/1.1 $status`r`n")
    [void]$sb.Append("Content-Type: $contentType`r`n")
    [void]$sb.Append("Content-Length: $($bodyBytes.Length)`r`n")
    [void]$sb.Append("Connection: close`r`n")
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
    $json = ($obj | ConvertTo-Json -Compress -Depth 6)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    Send-Bytes $stream $status (New-Cors $origin) 'application/json' $bytes
}

function Handle-Client($client) {
    $stream = $client.GetStream()
    $headerText = Read-Headers $stream
    if (-not $headerText) { return }
    $lines = $headerText -split "`r`n"
    $reqLine = $lines[0]
    $parts = $reqLine -split ' '
    if ($parts.Count -lt 2) { return }
    $method = $parts[0]
    $rawpath = $parts[1]
    $path = ($rawpath -split '\?')[0]
    $query = ''
    if ($rawpath -match '\?') { $query = ($rawpath -split '\?', 2)[1] }

    $headers = @{}
    for ($i = 1; $i -lt $lines.Count; $i++) {
        $ln = $lines[$i]
        $idx = $ln.IndexOf(':')
        if ($idx -gt 0) { $headers[$ln.Substring(0, $idx).Trim().ToLower()] = $ln.Substring($idx + 1).Trim() }
    }
    $origin = $headers['origin']
    $cors = New-Cors $origin

    if ($method -eq 'OPTIONS') { Send-Bytes $stream '204 No Content' $cors 'text/plain' (New-Object byte[] 0); return }

    if ($method -eq 'GET' -and $path -eq '/ping') {
        Send-Json $stream '200 OK' ([ordered]@{ ok = $true; app = 'volme3d-print-helper'; version = 2; os = 'Windows'; slicers = @((Get-Slicers).Keys); libDir = (Get-LibDir) }) $origin
        return
    }
    if ($method -eq 'GET' -and $path -eq '/list') {
        if (-not (Test-Origin $origin)) { Send-Json $stream '403 Forbidden' (@{ ok = $false; error = 'origin not allowed' }) $origin; return }
        Send-Json $stream '200 OK' ([ordered]@{ ok = $true; dir = (Get-LibDir); files = @(Get-LibList) }) $origin
        return
    }
    if ($method -eq 'GET' -and $path -eq '/file') {
        if (-not (Test-Origin $origin)) { Send-Json $stream '403 Forbidden' (@{ ok = $false; error = 'origin not allowed' }) $origin; return }
        $name = ''
        foreach ($kv in ($query -split '&')) { if ($kv -like 'name=*') { $name = [System.Uri]::UnescapeDataString($kv.Substring(5)) } }
        $fp = Get-LibFilePath $name
        if (-not $fp) { Send-Json $stream '404 Not Found' (@{ ok = $false; error = 'Datei nicht gefunden' }) $origin; return }
        $data = [System.IO.File]::ReadAllBytes($fp)
        Send-Bytes $stream '200 OK' (New-Cors $origin) 'model/stl' $data
        return
    }
    if ($method -eq 'POST' -and ($path -eq '/collect' -or $path -eq '/print')) {
        if (-not (Test-Origin $origin)) { Send-Json $stream '403 Forbidden' (@{ ok = $false; error = "origin not allowed: $origin" }) $origin; return }
        $len = 0
        if ($headers.ContainsKey('content-length')) { [void][int]::TryParse($headers['content-length'], [ref]$len) }
        $body = if ($len -gt 0) { Read-Body $stream $len } else { New-Object byte[] 0 }

        if ($path -eq '/collect') {
            $move = $false
            try { if ($body.Length -gt 0) { $j = [System.Text.Encoding]::UTF8.GetString($body) | ConvertFrom-Json; if ($j.move) { $move = $true } } } catch {}
            try { Send-Json $stream '200 OK' (Invoke-Collect $move) $origin } catch { Send-Json $stream '500 Error' (@{ ok = $false; error = "$_" }) $origin }
            return
        }
        # /print
        $want = ''
        if ($headers.ContainsKey('x-slicer')) { $want = $headers['x-slicer'].ToLower() }
        $slicers = Get-Slicers
        if ($slicers.Count -eq 0) { Send-Json $stream '500 Error' (@{ ok = $false; error = 'Kein Slicer gefunden' }) $origin; return }
        $key = if ($slicers.Contains($want)) { $want } else { @($slicers.Keys)[0] }
        $exe = $slicers[$key]

        $toOpen = $null
        if ($headers.ContainsKey('x-libfile') -and $headers['x-libfile']) {
            $toOpen = Get-LibFilePath $headers['x-libfile']
            if (-not $toOpen) { Send-Json $stream '404 Not Found' (@{ ok = $false; error = 'Bibliotheksdatei nicht gefunden' }) $origin; return }
        } else {
            if ($body.Length -eq 0) { Send-Json $stream '400 Bad Request' (@{ ok = $false; error = 'leere Datei' }) $origin; return }
            $fname = 'modell.stl'
            if ($headers.ContainsKey('x-filename') -and $headers['x-filename']) { $fname = Split-Path -Leaf $headers['x-filename'] }
            $outdir = Join-Path $env:TEMP 'volme3d-print'
            if (-not (Test-Path -LiteralPath $outdir)) { New-Item -ItemType Directory -Path $outdir -Force | Out-Null }
            $toOpen = Join-Path $outdir $fname
            [System.IO.File]::WriteAllBytes($toOpen, $body)
        }
        try { Start-Process -FilePath $exe -ArgumentList $toOpen | Out-Null }
        catch { Send-Json $stream '500 Error' (@{ ok = $false; error = "Slicer-Start fehlgeschlagen: $_" }) $origin; return }
        Send-Json $stream '200 OK' ([ordered]@{ ok = $true; slicer = $key; file = (Split-Path -Leaf $toOpen) }) $origin
        return
    }
    Send-Json $stream '404 Not Found' (@{ ok = $false; error = 'not found' }) $origin
}

function Install-Autostart {
    try {
        $startup = [Environment]::GetFolderPath('Startup')
        if (-not $startup) { return }
        $me = $PSCommandPath
        if (-not $me) { return }
        $vbsPath = Join-Path $startup 'Volme3D-Druck-Helfer.vbs'
        $cmd = 'powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $me + '"'
        $vbs = 'CreateObject("WScript.Shell").Run "' + $cmd.Replace('"', '""') + '", 0, False'
        Set-Content -LiteralPath $vbsPath -Value $vbs -Encoding ASCII
    } catch {}
}

# --- Start -------------------------------------------------------------------
Install-Autostart
try {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $PORT)
    $listener.Start()
} catch {
    Write-Host "Konnte Port $PORT nicht oeffnen (laeuft der Helfer schon?): $_"
    Start-Sleep 5; exit 1
}
$sl = Get-Slicers
Write-Host "Volme3D Druck-Helfer laeuft auf http://127.0.0.1:$PORT"
if ($sl.Count -gt 0) { Write-Host ("Gefundene Slicer: " + (($sl.Keys | ForEach-Object { "$_ -> $($sl[$_])" }) -join ', ')) }
else { Write-Host "Gefundene Slicer: KEINE (Pfad pruefen)" }
Write-Host "Autostart eingerichtet. Dieses Fenster kann offen bleiben oder geschlossen werden (Autostart startet neu)."
while ($true) {
    $client = $listener.AcceptTcpClient()
    try { Handle-Client $client } catch {} finally { try { $client.Close() } catch {} }
}
