@echo off
set "VOLME3D_SELF=%~f0"
if /i "%~1"=="/server" goto server
title Volme3D Druck-Helfer
echo ============================================
echo   Volme3D Druck-Helfer wird gestartet...
echo ============================================
echo.
echo Beende evtl. laufenden alten Helfer und starte neu...
rem --- alten Helfer auf Port 7777 beenden (Update), dann versteckt neu starten ---
powershell -NoProfile -ExecutionPolicy Bypass -Command "try{ Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction Stop | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 900 }catch{}; Start-Process -FilePath $env:VOLME3D_SELF -ArgumentList '/server' -WindowStyle Hidden" 2>nul
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
$ALLOWED = @('https://v3da.tailf05fe9.ts.net','https://v3dcad.volme3dakademie.de')   # erlaubte Web-Adressen (+ localhost)
$EXTS = @('.stl', '.3mf', '.obj', '.step', '.stp')

function Test-Origin($o) {
    if (-not $o) { return $false }
    if ($ALLOWED -contains $o) { return $true }
    return ($o -like 'http://localhost*') -or ($o -like 'http://127.0.0.1*') -or ($o -like 'http://192.168.*')
}
function Find-SlicerExe($folders, $exes) {
    foreach ($pattern in $folders) {
        if (-not $pattern) { continue }
        # Wildcard-Ordner (z.B. "...\Snapmaker*Orca*") gegen abweichende Versions-/Namensvarianten aufloesen
        $dirs = if ($pattern -match '[*?]') {
            @(Get-ChildItem -Path (Split-Path -Parent $pattern) -Directory -Filter (Split-Path -Leaf $pattern) -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName } | Sort-Object -Descending)
        } else { @($pattern) }
        foreach ($folder in $dirs) {
            if (-not $folder -or -not (Test-Path -LiteralPath $folder)) { continue }
            foreach ($n in $exes) { $p = Join-Path $folder $n; if (Test-Path -LiteralPath $p) { return $p } }
            # Fallback: erste sinnvolle .exe im Ordner (keine Deinstaller/Updater/Crashpad)
            $e = Get-ChildItem -LiteralPath $folder -Filter *.exe -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '(?i)unins|setup|redist|crashpad|update|bsa' } | Sort-Object Length -Descending | Select-Object -First 1
            if ($e) { return $e.FullName }
        }
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
        snapmaker = @{ f = @("$pf\Snapmaker Orca", "$pf\SnapmakerOrca", "$lad\Programs\Snapmaker Orca", "$lad\Programs\SnapmakerOrca", "$pf\Snapmaker*Orca*", "$pf86\Snapmaker*Orca*", "$lad\Programs\Snapmaker*Orca*"); e = @('SnapmakerOrca.exe', 'Snapmaker Orca.exe', 'snapmaker-orca.exe', 'orca-slicer.exe') }
        sovol     = @{ f = @("$pf\SovolSlicer", "$pf\Sovol Slicer", "$lad\Programs\SovolSlicer", "$lad\Programs\Sovol Slicer", "$pf\Sovol*"); e = @('SovolSlicer.exe', 'sovol-slicer.exe') }
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
# --- Benutzerdefinierter Ordner ("Ordner waehlen" aus Firefox/Safari): der Helfer
# oeffnet den Windows-Ordnerdialog und bedient /list,/file,/print dann aus diesem
# Ordner statt aus der Bibliothek. Merkt sich die Wahl in %APPDATA%\Volme3D. ---
$CFGDIR = Join-Path $env:APPDATA 'Volme3D'
$CFGFILE = Join-Path $CFGDIR 'helper-dir.txt'
function Get-CustomDir {
    try {
        if (Test-Path -LiteralPath $CFGFILE) {
            $p = (Get-Content -LiteralPath $CFGFILE -Raw -ErrorAction Stop).Trim()
            if ($p -and (Test-Path -LiteralPath $p -PathType Container)) { return $p }
        }
    } catch {}
    return $null
}
function Set-CustomDir($p) {
    try {
        if ($p) {
            if (-not (Test-Path -LiteralPath $CFGDIR)) { New-Item -ItemType Directory -Path $CFGDIR -Force | Out-Null }
            Set-Content -LiteralPath $CFGFILE -Value $p -Encoding UTF8
        } elseif (Test-Path -LiteralPath $CFGFILE) { Remove-Item -LiteralPath $CFGFILE -Force }
    } catch {}
}
function Get-RootDir { $c = Get-CustomDir; if ($c) { return $c } return (Get-LibDir) }
function Show-FolderDialog($initial) {
    try {
        Add-Type -AssemblyName System.Windows.Forms | Out-Null
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = 'Volme3D: Ordner mit STL/3MF/OBJ-Dateien waehlen'
        $dlg.ShowNewFolderButton = $false
        if ($initial -and (Test-Path -LiteralPath $initial)) { $dlg.SelectedPath = $initial }
        # unsichtbares TopMost-Fenster als Besitzer, sonst landet der Dialog hinter anderen Fenstern
        $owner = New-Object System.Windows.Forms.Form
        $owner.TopMost = $true
        $r = $dlg.ShowDialog($owner)
        $sel = $dlg.SelectedPath
        $owner.Dispose(); $dlg.Dispose()
        if ($r -eq [System.Windows.Forms.DialogResult]::OK -and $sel) { return $sel }
    } catch {}
    return $null
}
function Get-UniquePath($dir, $name) {
    $tp = Join-Path $dir $name
    if (-not (Test-Path -LiteralPath $tp)) { return $tp }
    $base = [IO.Path]::GetFileNameWithoutExtension($name); $ext = [IO.Path]::GetExtension($name); $i = 2
    while (Test-Path -LiteralPath (Join-Path $dir ("{0}_{1}{2}" -f $base, $i, $ext))) { $i++ }
    return (Join-Path $dir ("{0}_{1}{2}" -f $base, $i, $ext))
}
# Ziel-Pfad im Lib-Ordner, der die Unterordner-Struktur unterhalb des Quell-Roots spiegelt.
function Get-CollectTarget($dst, $srcRoot, $f) {
    $srcRoot = $srcRoot.TrimEnd('\')
    $sub = ''
    if ($f.DirectoryName.Length -gt $srcRoot.Length -and $f.DirectoryName.Substring(0, $srcRoot.Length).ToLower() -eq $srcRoot.ToLower()) {
        $sub = $f.DirectoryName.Substring($srcRoot.Length).TrimStart('\')
    }
    $tdir = if ($sub) { Join-Path $dst $sub } else { $dst }
    if (-not (Test-Path -LiteralPath $tdir)) { New-Item -ItemType Directory -Path $tdir -Force | Out-Null }
    return (Join-Path $tdir $f.Name)
}
function Invoke-Collect($move) {
    $srcs = Get-DownloadCandidates; $dst = Get-LibDir; $dstLow = $dst.TrimEnd('\').ToLower(); $copied = 0; $skipped = 0
    # gewaehlten Anzeige-Ordner nie leerraeumen (falls er in den Downloads liegt)
    $cust = Get-CustomDir; $custLow = if ($cust) { $cust.TrimEnd('\').ToLower() } else { $null }
    foreach ($src in $srcs) {
        $files = Get-ChildItem -LiteralPath $src -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $EXTS -contains $_.Extension.ToLower() -and -not $_.FullName.ToLower().StartsWith($dstLow) -and (-not $custLow -or -not $_.FullName.ToLower().StartsWith($custLow)) }
        foreach ($f in $files) {
            try {
                $tp = Get-CollectTarget $dst $src $f
                if ((Test-Path -LiteralPath $tp) -and ((Get-Item -LiteralPath $tp).Length -eq $f.Length)) { if ($move) { try { Remove-Item -LiteralPath $f.FullName -Force } catch {} }; $skipped++; continue }
                if (Test-Path -LiteralPath $tp) { $tp = Get-UniquePath (Split-Path -Parent $tp) $f.Name }
                if ($move) { Move-Item -LiteralPath $f.FullName -Destination $tp -Force } else { Copy-Item -LiteralPath $f.FullName -Destination $tp -Force }
                $copied++
            } catch {}
        }
    }
    $count = (Get-ChildItem -LiteralPath $dst -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $EXTS -contains $_.Extension.ToLower() }).Count
    return [ordered]@{ ok = $true; copied = $copied; skipped = $skipped; dir = $dst; source = ($srcs -join '; '); count = $count }
}
function Get-LibList {
    $d = Get-RootDir; $items = @(); $baseLen = $d.TrimEnd('\').Length
    Get-ChildItem -LiteralPath $d -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $EXTS -contains $_.Extension.ToLower() } | Sort-Object LastWriteTime -Descending | ForEach-Object {
        $rel = ($_.FullName.Substring($baseLen).TrimStart('\')) -replace '\\', '/'
        $items += [ordered]@{ name = $rel; size = $_.Length; mtime = [int64]([DateTimeOffset]$_.LastWriteTime).ToUnixTimeMilliseconds() }
    }
    return $items
}
function Hdr($h, $n) { if ($h.ContainsKey($n) -and $h[$n]) { try { return [System.Uri]::UnescapeDataString($h[$n]) } catch { return $h[$n] } } return '' }
# Nimmt einen relativen Pfad (mit / oder \) und loest ihn sicher unterhalb des aktiven Ordners auf (kein '..').
function Get-LibFilePath($name) {
    if (-not $name) { return $null }
    $parts = ($name -replace '/', '\') -split '\\' | Where-Object { $_ -ne '' -and $_ -ne '.' -and $_ -ne '..' }
    if ($parts.Count -eq 0) { return $null }
    $p = Join-Path (Get-RootDir) ($parts -join '\')
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
    $h['Access-Control-Allow-Headers'] = 'Content-Type, X-Slicer, X-Filename, X-LibFile, X-NewName, X-Pid'
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
    $srcs = Get-DownloadCandidates; $dst = Get-LibDir; $dstLow = $dst.TrimEnd('\').ToLower()
    $cust = Get-CustomDir; $custLow = if ($cust) { $cust.TrimEnd('\').ToLower() } else { $null }
    $pairs = @()
    foreach ($src in $srcs) { Get-ChildItem -LiteralPath $src -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $EXTS -contains $_.Extension.ToLower() -and -not $_.FullName.ToLower().StartsWith($dstLow) -and (-not $custLow -or -not $_.FullName.ToLower().StartsWith($custLow)) } | ForEach-Object { $pairs += [pscustomobject]@{ f = $_; src = $src } } }
    $total = $pairs.Count; $copied = 0; $skipped = 0; $i = 0
    foreach ($pair in $pairs) {
        $f = $pair.f; $i++
        try {
            $tp = Get-CollectTarget $dst $pair.src $f
            if ((Test-Path -LiteralPath $tp) -and ((Get-Item -LiteralPath $tp).Length -eq $f.Length)) { if ($move) { try { Remove-Item -LiteralPath $f.FullName -Force } catch {} }; $skipped++ }
            else { if (Test-Path -LiteralPath $tp) { $tp = Get-UniquePath (Split-Path -Parent $tp) $f.Name }; if ($move) { Move-Item -LiteralPath $f.FullName -Destination $tp -Force } else { Copy-Item -LiteralPath $f.FullName -Destination $tp -Force }; $copied++ }
        } catch {}
        Write-Line $stream (@{ i = $i; n = $total; name = $f.Name } | ConvertTo-Json -Compress)
    }
    $count = (Get-ChildItem -LiteralPath $dst -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $EXTS -contains $_.Extension.ToLower() }).Count
    Write-Line $stream (([ordered]@{ done = $true; ok = $true; copied = $copied; skipped = $skipped; dir = $dst; source = ($srcs -join '; '); count = $count }) | ConvertTo-Json -Compress)
}
# ===== Slicer-Steuerung fuer den V3D Druck-Assistenten (ab v13) =====
# Alle fuenf Slicer (Bambu Studio, Snapmaker Orca, ElegooSlicer, Anycubic Slicer Next, SovolSlicer) sind
# Bambu-/Orca-Ableger: Fenstertitel "[*]Projekt - <Slicer>", Konfig %APPDATA%\<Slicer>\<Slicer>.conf (JSON,
# recent_projects "001".. = zuletzt), eigene Profile %APPDATA%\<Slicer>\user\<Konto|default>\process|filament\*.json
$SLICER_KINDS = @(   # Reihenfolge: Snapmaker vor Orca ("Snapmaker Orca" enthaelt "orca")
    @{ key = 'bambu';     name = 'Bambu Studio';         kw = 'bambu' },
    @{ key = 'snapmaker'; name = 'Snapmaker Orca';       kw = 'snapmaker' },
    @{ key = 'elegoo';    name = 'ElegooSlicer';         kw = 'elegoo' },
    @{ key = 'anycubic';  name = 'Anycubic Slicer Next'; kw = 'anycubic' },
    @{ key = 'sovol';     name = 'SovolSlicer';          kw = 'sovol' },
    @{ key = 'orca';      name = 'OrcaSlicer';           kw = 'orca' }
)
function Get-SlicerKind($text) {
    $t = ([string]$text).ToLower() -replace '[^a-z]', ''
    foreach ($k in $SLICER_KINDS) { if ($t.Contains($k.kw)) { return $k } }
    return $null
}
function Split-SlicerTitle($title) {
    # "*Halter - Bambu Studio" -> @{ project='Halter'; dirty=$true }
    $t = ([string]$title).Trim(); $dirty = $t.StartsWith('*'); if ($dirty) { $t = $t.Substring(1) }
    $i = $t.LastIndexOf(' - '); $proj = if ($i -gt 0) { $t.Substring(0, $i).Trim() } else { '' }
    return @{ project = $proj; dirty = $dirty }
}
function Get-SlicerDataDir($kind) {
    $root = $env:APPDATA; if (-not $root -or -not (Test-Path -LiteralPath $root)) { return $null }
    $best = $null; $bestTime = [datetime]::MinValue
    foreach ($d in (Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
        $k = Get-SlicerKind $d.Name; if (-not $k -or $k.key -ne $kind.key) { continue }
        $conf = Join-Path $d.FullName ($d.Name + '.conf')
        if (-not (Test-Path -LiteralPath $conf)) { $c = Get-ChildItem -LiteralPath $d.FullName -Filter *.conf -File -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $conf = $c.FullName } else { continue } }
        $tm = (Get-Item -LiteralPath $conf).LastWriteTime
        if ($tm -gt $bestTime) { $bestTime = $tm; $best = @{ dir = $d.FullName; conf = $conf } }
    }
    return $best
}
function Get-RecentProjects($confPath) {
    try {
        $j = Get-Content -LiteralPath $confPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $rp = $j.recent_projects; if (-not $rp) { return @() }
        return @($rp.PSObject.Properties | Sort-Object Name | ForEach-Object { ([string]$_.Value) -replace '/', [System.IO.Path]::DirectorySeparatorChar })
    } catch { return @() }
}
function Find-ProjectPath($confPath, $project) {
    if (-not $project -or -not $confPath) { return $null }
    foreach ($p in (Get-RecentProjects $confPath)) {
        if ([System.IO.Path]::GetFileNameWithoutExtension($p) -eq $project -and (Test-Path -LiteralPath $p -PathType Leaf)) { return $p }
    }
    return $null
}
function Get-RunningSlicers {
    $out = @()
    # Testmodus (nur fuer den Container-Test): vorgetaeuschter Slicer, keine Fensterbedienung
    if ($env:VOLME3D_TEST_SLICER) { $f = $env:VOLME3D_TEST_SLICER | ConvertFrom-Json; $f.dirty = [bool]$f.dirty; if (-not $f.path) { $f.path = Find-ProjectPath (Join-Path $f.dataDir 'BambuStudio.conf') $f.project }; return @($f) }
    foreach ($pr in (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero })) {
        $kind = Get-SlicerKind $pr.ProcessName; if (-not $kind) { continue }
        $t = Split-SlicerTitle $pr.MainWindowTitle
        $dd = Get-SlicerDataDir $kind
        $path = if ($dd) { Find-ProjectPath $dd.conf $t.project } else { $null }
        $users = @(); if ($dd -and (Test-Path -LiteralPath (Join-Path $dd.dir 'user'))) { $users = @(Get-ChildItem -LiteralPath (Join-Path $dd.dir 'user') -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }) }
        $out += [pscustomobject][ordered]@{ key = $kind.key; name = $kind.name; pid = $pr.Id; title = $pr.MainWindowTitle; project = $t.project; dirty = $t.dirty
            path = $path; dataDir = $(if ($dd) { $dd.dir } else { $null }); userDirs = $users; hwnd = [int64]$pr.MainWindowHandle }
    }
    return $out
}
function Get-SlicerByPid($procId) { foreach ($s in (Get-RunningSlicers)) { if ([string]$s.pid -eq [string]$procId) { return $s } }; return $null }

$V3DWIN_OK = $false
function Init-Win {
    if ($script:V3DWIN_OK) { return }
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -TypeDefinition @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class V3dWin {
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  public static bool Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    IntPtr fg = GetForegroundWindow(); uint dummy; uint ft = GetWindowThreadProcessId(fg, out dummy); uint me = GetCurrentThreadId();
    bool att = ft != 0 && ft != me && AttachThreadInput(me, ft, true);
    BringWindowToTop(h); SetForegroundWindow(h);
    if (att) AttachThreadInput(me, ft, false);
    if (GetForegroundWindow() != h) { keybd_event(0x12, 0, 0, UIntPtr.Zero); SetForegroundWindow(h); keybd_event(0x12, 0, 2, UIntPtr.Zero); }
    return GetForegroundWindow() == h;
  }
  // sichtbare Fenster des Prozesses: "Klasse|Titel" (Datei-Dialoge = #32770)
  public static string[] Windows(uint pid, out IntPtr dialog) {
    var list = new List<string>(); IntPtr dlg = IntPtr.Zero;
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && IsWindowVisible(h)) { var c = new StringBuilder(256); GetClassName(h, c, 256); var t = new StringBuilder(512); GetWindowText(h, t, 512);
        list.Add(c + "|" + t); if (dlg == IntPtr.Zero && c.ToString() == "#32770") dlg = h; }
      return true; }, IntPtr.Zero);
    dialog = dlg; return list.ToArray();
  }
}
'@
    $script:V3DWIN_OK = $true
}
function Find-Dialog($procId) { $d = [IntPtr]::Zero; [void][V3dWin]::Windows([uint32]$procId, [ref]$d); return $d }
function Wait-Dialog($procId, $sec) {
    $until = (Get-Date).AddSeconds($sec)
    while ((Get-Date) -lt $until) { $d = Find-Dialog $procId; if ($d -ne [IntPtr]::Zero) { return $d }; Start-Sleep -Milliseconds 200 }
    return [IntPtr]::Zero
}
function Send-Keys($k) { [System.Windows.Forms.SendKeys]::SendWait($k); Start-Sleep -Milliseconds 120 }
# Pfad in einen offenen Datei-Dialog eintragen (ueber die Zwischenablage, damit Sonderzeichen stimmen)
function Fill-FileDialog($dlg, $path) {
    $old = $null; try { $old = Get-Clipboard -Raw -ErrorAction SilentlyContinue } catch {}
    Set-Clipboard -Value $path
    [void][V3dWin]::Focus($dlg); Start-Sleep -Milliseconds 250
    Send-Keys '^a'; Send-Keys '^v'; Start-Sleep -Milliseconds 200; Send-Keys '{ENTER}'
    Start-Sleep -Milliseconds 400
    if ($old) { try { Set-Clipboard -Value $old } catch {} }
}
function Save-SlicerProject($s) {
    # gespeichert und ohne Stern: nichts zu tun
    if ($s.path -and -not $s.dirty) { return @{ ok = $true; path = $s.path; saved = $false } }
    Init-Win
    if (-not [V3dWin]::Focus([IntPtr]$s.hwnd)) { return @{ ok = $false; error = 'Slicer-Fenster liess sich nicht nach vorn holen' } }
    Start-Sleep -Milliseconds 300
    if ($s.path) {
        $t0 = (Get-Item -LiteralPath $s.path).LastWriteTime
        Send-Keys '^s'
        $until = (Get-Date).AddSeconds(30)
        while ((Get-Date) -lt $until) {
            Start-Sleep -Milliseconds 300
            $n = Get-SlicerByPid $s.pid
            if ($n -and -not $n.dirty -and (Get-Item -LiteralPath $s.path).LastWriteTime -gt $t0) { return @{ ok = $true; path = $s.path; saved = $true } }
        }
        return @{ ok = $false; error = 'Speichern hat nicht geklappt (Stern im Titel blieb)' }
    }
    # noch nie gespeichert: "Speichern unter" in die Bibliothek (Unterordner Projekte)
    $dir = Join-Path (Get-LibDir) 'Projekte'; if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $base = if ($s.project) { $s.project } else { 'Projekt' }
    $base = ($base.Split([System.IO.Path]::GetInvalidFileNameChars()) -join '_')
    $target = Get-UniquePath $dir ($base + '.3mf')
    Send-Keys '^s'
    $dlg = Wait-Dialog $s.pid 6
    if ($dlg -eq [IntPtr]::Zero) { [void][V3dWin]::Focus([IntPtr]$s.hwnd); Send-Keys '^%s'; $dlg = Wait-Dialog $s.pid 6 }
    if ($dlg -eq [IntPtr]::Zero) { return @{ ok = $false; error = 'Der Speichern-Dialog ist nicht aufgegangen. Bitte das Projekt einmal selbst speichern.' } }
    Fill-FileDialog $dlg $target
    $until = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $until) { if ((Test-Path -LiteralPath $target) -and (Find-Dialog $s.pid) -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 800; return @{ ok = $true; path = $target; saved = $true } }; Start-Sleep -Milliseconds 300 }
    return @{ ok = $false; error = 'Projekt wurde nicht gespeichert' }
}
function Open-InSlicer($s, $path) {
    if ([int64]$s.hwnd -eq 0) { return @{ ok = $true; question = '' } }   # Testmodus
    Init-Win
    if (-not [V3dWin]::Focus([IntPtr]$s.hwnd)) { return @{ ok = $false; error = 'Slicer-Fenster liess sich nicht nach vorn holen' } }
    Start-Sleep -Milliseconds 300
    Send-Keys '^o'
    $dlg = Wait-Dialog $s.pid 6
    if ($dlg -eq [IntPtr]::Zero) { return @{ ok = $false; error = 'Der Oeffnen-Dialog ist nicht aufgegangen' } }
    Fill-FileDialog $dlg $path
    # Rueckfrage des Slicers (z. B. ungespeicherte Profil-Aenderungen)? Dann nicht selbst entscheiden, nur melden.
    Start-Sleep -Seconds 3
    $n = Get-SlicerByPid $s.pid; $main = if ($n) { $n.title } else { $s.title }
    $d = [IntPtr]::Zero; $w = @([V3dWin]::Windows([uint32]$s.pid, [ref]$d))
    $ask = @($w | ForEach-Object { $p = $_ -split '\|', 2; if ($p[1] -and $p[1] -ne $main -and ($p[0] -eq '#32770' -or $p[0] -like 'wx*')) { $p[1] } }) -join '; '
    return @{ ok = $true; question = $ask }
}
function Write-SlicerPreset($s, $type, $name, $jsonText) {
    if ($type -ne 'process' -and $type -ne 'filament') { return @{ ok = $false; error = 'Typ muss process oder filament sein' } }
    if (-not $s.dataDir) { return @{ ok = $false; error = 'Profilordner des Slicers nicht gefunden' } }
    if ($name -notmatch 'V3D' -or $name.IndexOfAny([System.IO.Path]::GetInvalidFileNameChars()) -ge 0) { return @{ ok = $false; error = 'ungueltiger Profilname' } }
    try { $j = $jsonText | ConvertFrom-Json } catch { return @{ ok = $false; error = 'Profil ist kein gueltiges JSON' } }
    if ($j.name -ne $name -or -not $j.inherits -or $j.from -ne 'User') { return @{ ok = $false; error = 'Profil unvollstaendig (name/inherits/from)' } }
    $userRoot = Join-Path $s.dataDir 'user'
    $subs = @(); if (Test-Path -LiteralPath $userRoot) { $subs = @(Get-ChildItem -LiteralPath $userRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) }
    if ($subs.Count -eq 0) { $subs = @(Join-Path $userRoot 'default') }
    $utf8 = New-Object System.Text.UTF8Encoding $false; $files = @()
    foreach ($sub in $subs) {
        $dir = Join-Path $sub $type; if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $fp = Join-Path $dir ($name + '.json')
        if (Test-Path -LiteralPath $fp) { Copy-Item -LiteralPath $fp -Destination ($fp + '.bak') -Force }
        [System.IO.File]::WriteAllText($fp, $jsonText, $utf8); $files += $fp
    }
    return @{ ok = $true; files = $files }
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
    if ($method -eq 'GET' -and $path -eq '/ping') { Send-Json $stream '200 OK' ([ordered]@{ ok = $true; app = 'volme3d-print-helper'; version = 13; assistant = $true; os = 'Windows'; slicers = @((Get-Slicers).Keys); libDir = (Get-LibDir); dir = (Get-RootDir); custom = [bool](Get-CustomDir) }) $origin; return }
    if ($path -like '/slicer/*') {
        # Druck-Assistent: alles nur fuer erlaubte Web-Adressen (Projektdateien, Tastendruecke, Profile)
        if (-not (Test-Origin $origin)) { Send-Json $stream '403 Forbidden' (@{ ok = $false; error = "origin not allowed: $origin" }) $origin; return }
        $len = 0; if ($headers.ContainsKey('content-length')) { [void][int]::TryParse($headers['content-length'], [ref]$len) }
        $body = if ($len -gt 0) { Read-Body $stream $len } else { New-Object byte[] 0 }
        $qpid = ''; if ($query -match '(?:^|&)pid=(\d+)') { $qpid = $Matches[1] }
        if ($headers.ContainsKey('x-pid')) { $qpid = $headers['x-pid'] }
        if ($method -eq 'GET' -and $path -eq '/slicer/state') {
            $run = @(Get-RunningSlicers | ForEach-Object { $_ | Select-Object key, name, pid, title, project, dirty, path, dataDir, userDirs })
            Send-Json $stream '200 OK' ([ordered]@{ ok = $true; version = 13; running = $run; installed = @((Get-Slicers).Keys) }) $origin; return
        }
        $s = if ($qpid) { Get-SlicerByPid $qpid } else { $null }
        if (-not $s) { Send-Json $stream '404 Not Found' (@{ ok = $false; error = 'Slicer laeuft nicht (mehr)' }) $origin; return }
        try {
            if ($method -eq 'POST' -and $path -eq '/slicer/save') { $r = Save-SlicerProject $s; Send-Json $stream ($(if ($r.ok) { '200 OK' } else { '409 Conflict' })) $r $origin; return }
            if ($method -eq 'GET' -and $path -eq '/slicer/file') {
                if (-not $s.path) { Send-Json $stream '409 Conflict' (@{ ok = $false; error = 'Projekt ist noch nicht gespeichert' }) $origin; return }
                $h = New-Cors $origin; $h['X-Filename'] = [System.Uri]::EscapeDataString((Split-Path -Leaf $s.path)); $h['Access-Control-Expose-Headers'] = 'X-Filename'
                Send-Bytes $stream '200 OK' $h 'application/octet-stream' ([System.IO.File]::ReadAllBytes($s.path)); return
            }
            if ($method -eq 'POST' -and $path -eq '/slicer/apply') {
                if (-not $s.path -or $s.path -notlike '*.3mf') { Send-Json $stream '409 Conflict' (@{ ok = $false; error = 'Kein gespeichertes 3MF-Projekt offen' }) $origin; return }
                if ($s.dirty) { Send-Json $stream '409 Conflict' (@{ ok = $false; error = 'Im Slicer wurde inzwischen etwas geaendert. Bitte neu pruefen.' }) $origin; return }
                if ($body.Length -lt 100 -or $body[0] -ne 0x50 -or $body[1] -ne 0x4B) { Send-Json $stream '400 Bad Request' (@{ ok = $false; error = 'kein 3MF' }) $origin; return }
                $bdir = Join-Path (Get-LibDir) 'Projekte\Vorher'; if (-not (Test-Path -LiteralPath $bdir)) { New-Item -ItemType Directory -Path $bdir -Force | Out-Null }
                $backup = Join-Path $bdir ([System.IO.Path]::GetFileNameWithoutExtension($s.path) + '_' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.3mf')
                Copy-Item -LiteralPath $s.path -Destination $backup -Force
                [System.IO.File]::WriteAllBytes($s.path, $body)
                $o = Open-InSlicer $s $s.path
                Send-Json $stream '200 OK' ([ordered]@{ ok = $o.ok; path = $s.path; backup = $backup; reopened = $o.ok; question = $o.question; error = $o.error }) $origin; return
            }
            if ($method -eq 'POST' -and $path -eq '/slicer/undo') {
                $j = [System.Text.Encoding]::UTF8.GetString($body) | ConvertFrom-Json
                $bdir = (Join-Path (Get-LibDir) 'Projekte\Vorher').TrimEnd('\')
                $b = [string]$j.backup
                if (-not $s.path -or -not $b -or (Split-Path -Parent $b).TrimEnd('\') -ne $bdir -or -not (Test-Path -LiteralPath $b)) { Send-Json $stream '400 Bad Request' (@{ ok = $false; error = 'Sicherung nicht gefunden' }) $origin; return }
                Copy-Item -LiteralPath $b -Destination $s.path -Force
                $o = Open-InSlicer $s $s.path
                Send-Json $stream '200 OK' ([ordered]@{ ok = $o.ok; path = $s.path; question = $o.question; error = $o.error }) $origin; return
            }
            if ($method -eq 'POST' -and $path -eq '/slicer/preset') {
                $j = [System.Text.Encoding]::UTF8.GetString($body) | ConvertFrom-Json
                $r = Write-SlicerPreset $s ([string]$j.type) ([string]$j.name) ([string]$j.json)
                Send-Json $stream ($(if ($r.ok) { '200 OK' } else { '400 Bad Request' })) $r $origin; return
            }
        } catch { Send-Json $stream '500 Error' (@{ ok = $false; error = "$_" }) $origin; return }
        Send-Json $stream '404 Not Found' (@{ ok = $false; error = 'not found' }) $origin; return
    }
    if ($method -eq 'GET' -and $path -eq '/list') {
        if (-not (Test-Origin $origin)) { Send-Json $stream '403 Forbidden' (@{ ok = $false; error = 'origin not allowed' }) $origin; return }
        Send-Json $stream '200 OK' ([ordered]@{ ok = $true; dir = (Get-RootDir); custom = [bool](Get-CustomDir); files = @(Get-LibList) }) $origin; return
    }
    if ($method -eq 'POST' -and $path -eq '/pickdir') {
        # Ordnerdialog auf dem PC oeffnen (Firefox/Safari haben keinen showDirectoryPicker);
        # Body {reset:true} = zurueck zur Volme3D-Bibliothek
        if (-not (Test-Origin $origin)) { Send-Json $stream '403 Forbidden' (@{ ok = $false; error = 'origin not allowed' }) $origin; return }
        $len = 0; if ($headers.ContainsKey('content-length')) { [void][int]::TryParse($headers['content-length'], [ref]$len) }
        $body = if ($len -gt 0) { Read-Body $stream $len } else { New-Object byte[] 0 }
        $reset = $false
        try { if ($body.Length -gt 0) { $j = [System.Text.Encoding]::UTF8.GetString($body) | ConvertFrom-Json; if ($j.reset) { $reset = $true } } } catch {}
        if ($reset) { Set-CustomDir $null; Send-Json $stream '200 OK' ([ordered]@{ ok = $true; dir = (Get-LibDir); custom = $false }) $origin; return }
        $sel = Show-FolderDialog (Get-RootDir)
        if (-not $sel) { Send-Json $stream '200 OK' (@{ ok = $false; cancelled = $true }) $origin; return }
        Set-CustomDir $sel
        Send-Json $stream '200 OK' ([ordered]@{ ok = $true; dir = $sel; custom = $true }) $origin; return
    }
    if ($method -eq 'GET' -and $path -eq '/file') {
        if (-not (Test-Origin $origin)) { Send-Json $stream '403 Forbidden' (@{ ok = $false; error = 'origin not allowed' }) $origin; return }
        $name = ''; foreach ($kv in ($query -split '&')) { if ($kv -like 'name=*') { $name = [System.Uri]::UnescapeDataString($kv.Substring(5)) } }
        $fp = Get-LibFilePath $name
        if (-not $fp) { Send-Json $stream '404 Not Found' (@{ ok = $false; error = 'Datei nicht gefunden' }) $origin; return }
        Send-Bytes $stream '200 OK' (New-Cors $origin) 'model/stl' ([System.IO.File]::ReadAllBytes($fp)); return
    }
    if ($method -eq 'POST' -and ($path -eq '/delete' -or $path -eq '/rename')) {
        if (-not (Test-Origin $origin)) { Send-Json $stream '403 Forbidden' (@{ ok = $false; error = 'origin not allowed' }) $origin; return }
        $fp = Get-LibFilePath (Hdr $headers 'x-libfile')
        if (-not $fp) { Send-Json $stream '404 Not Found' (@{ ok = $false; error = 'Datei nicht gefunden' }) $origin; return }
        if ($path -eq '/delete') {
            try { Remove-Item -LiteralPath $fp -Force; Send-Json $stream '200 OK' (@{ ok = $true }) $origin }
            catch { Send-Json $stream '500 Error' (@{ ok = $false; error = "$_" }) $origin }
            return
        }
        $new = Split-Path -Leaf (Hdr $headers 'x-newname')
        if (-not $new) { Send-Json $stream '400 Bad Request' (@{ ok = $false; error = 'kein Name' }) $origin; return }
        $parent = Split-Path -Parent $fp
        $dst = Join-Path $parent $new
        if (Test-Path -LiteralPath $dst) { Send-Json $stream '409 Conflict' (@{ ok = $false; error = 'Name existiert bereits' }) $origin; return }
        try {
            Rename-Item -LiteralPath $fp -NewName $new
            $baseLen = (Get-RootDir).TrimEnd('\').Length
            $rel = ($dst.Substring($baseLen).TrimStart('\')) -replace '\\', '/'
            Send-Json $stream '200 OK' (@{ ok = $true; name = $rel }) $origin
        }
        catch { Send-Json $stream '500 Error' (@{ ok = $false; error = "$_" }) $origin }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/replace') {
        # v12: vereinfachte Fassung ersetzt die Datei (gleicher Name), das Original
        # wandert nach <Ordner>\Original\ - V3D CAD prueft grosse Dateien in der Bibliothek.
        if (-not (Test-Origin $origin)) { Send-Json $stream '403 Forbidden' (@{ ok = $false; error = 'origin not allowed' }) $origin; return }
        $len = 0; if ($headers.ContainsKey('content-length')) { [void][int]::TryParse($headers['content-length'], [ref]$len) }
        $body = if ($len -gt 0) { Read-Body $stream $len } else { New-Object byte[] 0 }
        $fp = Get-LibFilePath (Hdr $headers 'x-libfile')
        if (-not $fp) { Send-Json $stream '404 Not Found' (@{ ok = $false; error = 'Datei nicht gefunden' }) $origin; return }
        if ($len -lt 100 -or $body.Length -ne $len) { Send-Json $stream '400 Bad Request' (@{ ok = $false; error = 'Datei unvollstaendig' }) $origin; return }
        $parent = Split-Path -Parent $fp; $leaf = Split-Path -Leaf $fp
        if ((Split-Path -Leaf $parent) -eq 'Original') { Send-Json $stream '400 Bad Request' (@{ ok = $false; error = 'Originale werden nicht ersetzt' }) $origin; return }
        $tmp = $fp + '.v3dtmp'
        try {
            $odir = Join-Path $parent 'Original'
            if (-not (Test-Path -LiteralPath $odir)) { New-Item -ItemType Directory -Path $odir -Force | Out-Null }
            $op = Get-UniquePath $odir $leaf
            $when = (Get-Item -LiteralPath $fp).LastWriteTime
            [System.IO.File]::WriteAllBytes($tmp, $body)
            Move-Item -LiteralPath $fp -Destination $op -Force
            Move-Item -LiteralPath $tmp -Destination $fp -Force
            (Get-Item -LiteralPath $fp).LastWriteTime = $when   # Reihenfolge in der Bibliothek bleibt
            $baseLen = (Get-RootDir).TrimEnd('\').Length
            $rel = ($fp.Substring($baseLen).TrimStart('\')) -replace '\\', '/'
            $orel = ($op.Substring($baseLen).TrimStart('\')) -replace '\\', '/'
            Send-Json $stream '200 OK' ([ordered]@{ ok = $true; name = $rel; original = $orel; size = $body.Length; mtime = [int64]([DateTimeOffset]$when).ToUnixTimeMilliseconds() }) $origin
        }
        catch {
            if (Test-Path -LiteralPath $tmp) { try { Remove-Item -LiteralPath $tmp -Force } catch {} }
            Send-Json $stream '500 Error' (@{ ok = $false; error = "$_" }) $origin
        }
        return
    }
    if ($method -eq 'POST' -and $path -eq '/printmulti') {
        if (-not (Test-Origin $origin)) { Send-Json $stream '403 Forbidden' (@{ ok = $false; error = "origin not allowed: $origin" }) $origin; return }
        $len = 0; if ($headers.ContainsKey('content-length')) { [void][int]::TryParse($headers['content-length'], [ref]$len) }
        $body = if ($len -gt 0) { Read-Body $stream $len } else { New-Object byte[] 0 }
        $names = @(); $want = ''
        try { $j = [System.Text.Encoding]::UTF8.GetString($body) | ConvertFrom-Json; if ($j.files) { $names = @($j.files) }; if ($j.slicer) { $want = ([string]$j.slicer).ToLower() } } catch {}
        if ($names.Count -eq 0) { Send-Json $stream '400 Bad Request' (@{ ok = $false; error = 'keine Dateien' }) $origin; return }
        $slicers = Get-Slicers
        if ($slicers.Count -eq 0) { Send-Json $stream '500 Error' (@{ ok = $false; error = 'Kein Slicer gefunden' }) $origin; return }
        $key = if ($slicers.Contains($want)) { $want } else { @($slicers.Keys)[0] }
        $exe = $slicers[$key]; $argList = @(); $okFiles = @()
        foreach ($n in $names) { $fp = Get-LibFilePath ([string]$n); if ($fp) { $argList += ('"' + $fp + '"'); $okFiles += (Split-Path -Leaf $fp) } }
        if ($argList.Count -eq 0) { Send-Json $stream '404 Not Found' (@{ ok = $false; error = 'keine Datei gefunden' }) $origin; return }
        try { Start-Process -FilePath $exe -ArgumentList $argList | Out-Null }
        catch { Send-Json $stream '500 Error' (@{ ok = $false; error = "Slicer-Start fehlgeschlagen: $_" }) $origin; return }
        Send-Json $stream '200 OK' ([ordered]@{ ok = $true; slicer = $key; count = $argList.Count; files = $okFiles }) $origin; return
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
        $lib = Hdr $headers 'x-libfile'
        if ($lib) {
            $toOpen = Get-LibFilePath $lib
            if (-not $toOpen) { Send-Json $stream '404 Not Found' (@{ ok = $false; error = 'Bibliotheksdatei nicht gefunden' }) $origin; return }
        } else {
            if ($body.Length -eq 0) { Send-Json $stream '400 Bad Request' (@{ ok = $false; error = 'leere Datei' }) $origin; return }
            $fname = 'modell.stl'; $hf = Hdr $headers 'x-filename'; if ($hf) { $fname = Split-Path -Leaf $hf }
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
