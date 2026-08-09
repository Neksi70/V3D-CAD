# ============================================================================
#  VolmeDriver - Treiber sichern, wiederherstellen und aktualisieren
#  Einzeldatei-Tool fuer Windows 10/11 (Windows PowerShell 5.1, WPF-GUI)
#  Start: VolmeDriver.cmd doppelklicken (holt sich selbst Admin-Rechte)
# ============================================================================

param([switch]$Elevated)

# --- Selbst-Erhoehung: Treiber-Export/-Installation braucht Admin-Rechte ----
$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
        '-NoProfile','-ExecutionPolicy','Bypass','-STA','-WindowStyle','Hidden',
        '-File', ('"{0}"' -f $PSCommandPath), '-Elevated')
    exit
}

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Data

# ----------------------------------------------------------------------------
#  Oberflaeche (XAML)
# ----------------------------------------------------------------------------
$xamlText = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="VolmeDriver - Treiber sichern und aktualisieren"
        Width="960" Height="700" WindowStartupLocation="CenterScreen"
        Background="#F4F5F7" FontFamily="Segoe UI" FontSize="13">
  <Grid>
    <Grid.RowDefinitions>
      <RowDefinition Height="56"/>
      <RowDefinition Height="*"/>
      <RowDefinition Height="150"/>
      <RowDefinition Height="30"/>
    </Grid.RowDefinitions>

    <Border Grid.Row="0" Background="#1F2937">
      <StackPanel Orientation="Horizontal" VerticalAlignment="Center" Margin="16,0">
        <TextBlock Text="VolmeDriver" Foreground="White" FontSize="22" FontWeight="Bold"/>
        <TextBlock x:Name="txtHost" Foreground="#9CA3AF" FontSize="13" Margin="16,6,0,0"/>
      </StackPanel>
    </Border>

    <TabControl Grid.Row="1" Margin="10" x:Name="tabMain">

      <TabItem Header=" Inventar ">
        <Grid Margin="8">
          <Grid.RowDefinitions>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="*"/>
          </Grid.RowDefinitions>
          <StackPanel Orientation="Horizontal" Margin="0,0,0,8">
            <Button x:Name="btnInvRefresh" Content="Neu einlesen" Width="130" Height="30" Margin="0,0,8,0"/>
            <Button x:Name="btnReport" Content="Bericht speichern (HTML)" Width="180" Height="30" Margin="0,0,8,0"/>
            <TextBlock x:Name="txtInvCount" VerticalAlignment="Center" Foreground="#4B5563"/>
          </StackPanel>
          <DataGrid Grid.Row="1" x:Name="dgInv" IsReadOnly="True" AutoGenerateColumns="True"
                    HeadersVisibility="Column" GridLinesVisibility="Horizontal"
                    AlternatingRowBackground="#EEF1F5" CanUserAddRows="False"/>
        </Grid>
      </TabItem>

      <TabItem Header=" Sichern ">
        <StackPanel Margin="16" MaxWidth="640" HorizontalAlignment="Left">
          <TextBlock TextWrapping="Wrap" Margin="0,0,0,12" Foreground="#374151">
            Sichert alle von Fremdherstellern installierten Treiber dieses PCs in einen
            Ordner (pnputil-Export). Ideal vor einer Windows-Neuinstallation oder als
            Notfall-Kopie. Ein Inventar (CSV) wird mit abgelegt.
          </TextBlock>
          <TextBlock Text="Zielordner:" FontWeight="SemiBold" Margin="0,0,0,4"/>
          <DockPanel Margin="0,0,0,12">
            <Button x:Name="btnBrowseBackup" Content="..." Width="36" Height="28" DockPanel.Dock="Right" Margin="6,0,0,0"/>
            <TextBox x:Name="txtBackupDir" Height="28" VerticalContentAlignment="Center"/>
          </DockPanel>
          <Button x:Name="btnBackup" Content="Treiber jetzt sichern" Width="220" Height="34"
                  HorizontalAlignment="Left" Background="#2563EB" Foreground="White" FontWeight="SemiBold"/>
        </StackPanel>
      </TabItem>

      <TabItem Header=" Wiederherstellen ">
        <StackPanel Margin="16" MaxWidth="640" HorizontalAlignment="Left">
          <TextBlock TextWrapping="Wrap" Margin="0,0,0,12" Foreground="#374151">
            Spielt ein zuvor gesichertes Treiberpaket wieder ein (z. B. auf einer frischen
            Windows-Installation). Es werden alle INF-Dateien im gewaehlten Ordner
            inklusive Unterordnern installiert.
          </TextBlock>
          <TextBlock Text="Ordner mit gesicherten Treibern:" FontWeight="SemiBold" Margin="0,0,0,4"/>
          <DockPanel Margin="0,0,0,12">
            <Button x:Name="btnBrowseRestore" Content="..." Width="36" Height="28" DockPanel.Dock="Right" Margin="6,0,0,0"/>
            <TextBox x:Name="txtRestoreDir" Height="28" VerticalContentAlignment="Center"/>
          </DockPanel>
          <Button x:Name="btnRestore" Content="Treiber installieren" Width="220" Height="34"
                  HorizontalAlignment="Left" Background="#2563EB" Foreground="White" FontWeight="SemiBold"/>
        </StackPanel>
      </TabItem>

      <TabItem Header=" Updates ">
        <Grid Margin="8">
          <Grid.RowDefinitions>
            <RowDefinition Height="Auto"/>
            <RowDefinition Height="*"/>
          </Grid.RowDefinitions>
          <StackPanel Orientation="Horizontal" Margin="0,0,0,8">
            <Button x:Name="btnSearchUpd" Content="Treiber-Updates suchen" Width="180" Height="30" Margin="0,0,8,0"/>
            <Button x:Name="btnInstallSel" Content="Ausgewaehlte installieren" Width="180" Height="30" Margin="0,0,8,0" IsEnabled="False"/>
            <Button x:Name="btnInstallAll" Content="Alle installieren" Width="140" Height="30" IsEnabled="False"/>
          </StackPanel>
          <DataGrid Grid.Row="1" x:Name="dgUpd" IsReadOnly="True" AutoGenerateColumns="True"
                    HeadersVisibility="Column" GridLinesVisibility="Horizontal"
                    SelectionMode="Extended" AlternatingRowBackground="#EEF1F5" CanUserAddRows="False"/>
        </Grid>
      </TabItem>

      <TabItem Header=" Hersteller ">
        <StackPanel Margin="16" MaxWidth="760" HorizontalAlignment="Left">
          <TextBlock TextWrapping="Wrap" Foreground="#374151" Margin="0,0,0,10">
            Windows Update liefert oft nicht die neuesten Treiber. Diese Links fuehren
            direkt zur Treiber-Seite des Geraete-Herstellers und der wichtigsten
            Komponenten. Gefundene Hersteller-Updater lassen sich hier starten.
          </TextBlock>
          <TextBlock x:Name="txtSystem" TextWrapping="Wrap" FontWeight="SemiBold" Margin="0,0,0,12"/>
          <WrapPanel x:Name="pnlLinks"/>
        </StackPanel>
      </TabItem>

    </TabControl>

    <GroupBox Grid.Row="2" Header="Protokoll" Margin="10,0,10,4">
      <TextBox x:Name="txtLog" IsReadOnly="True" TextWrapping="NoWrap"
               VerticalScrollBarVisibility="Auto" HorizontalScrollBarVisibility="Auto"
               FontFamily="Consolas" FontSize="12" Background="#FFFFFF" BorderThickness="0"/>
    </GroupBox>

    <StatusBar Grid.Row="3">
      <StatusBarItem>
        <StackPanel Orientation="Horizontal">
          <ProgressBar x:Name="pbBusy" Width="120" Height="12" Margin="4,0,10,0"/>
          <TextBlock x:Name="txtStatus" Text="Bereit"/>
        </StackPanel>
      </StatusBarItem>
    </StatusBar>
  </Grid>
</Window>
'@

$reader = New-Object System.Xml.XmlNodeReader ([xml]$xamlText)
$script:Window = [Windows.Markup.XamlReader]::Load($reader)

foreach ($name in @('txtHost','btnInvRefresh','btnReport','txtInvCount','dgInv',
                    'btnBrowseBackup','txtBackupDir','btnBackup',
                    'btnBrowseRestore','txtRestoreDir','btnRestore',
                    'btnSearchUpd','btnInstallSel','btnInstallAll','dgUpd',
                    'txtSystem','pnlLinks',
                    'txtLog','txtStatus','pbBusy')) {
    Set-Variable -Name $name -Scope Script -Value $script:Window.FindName($name)
}

$script:txtHost.Text      = 'PC: {0}  |  {1}' -f $env:COMPUTERNAME, (Get-CimInstance Win32_OperatingSystem).Caption
$script:txtBackupDir.Text = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Treiber-Sicherung'

# ----------------------------------------------------------------------------
#  Hintergrund-Arbeiten (Runspace + Timer, damit die GUI nicht einfriert)
# ----------------------------------------------------------------------------
$script:Sync = [hashtable]::Synchronized(@{
    Log    = [System.Collections.Queue]::Synchronized((New-Object System.Collections.Queue))
    Busy   = $false
    Done   = $false
    Result = $null
})
$script:OnDone        = $null
$script:CurPS         = $null
$script:LastInventory = $null

function Set-Buttons([bool]$Enabled) {
    foreach ($b in @($script:btnInvRefresh,$script:btnReport,$script:btnBackup,
                     $script:btnRestore,$script:btnSearchUpd)) { $b.IsEnabled = $Enabled }
    $hasUpd = ($script:dgUpd.ItemsSource -ne $null) -and ($script:dgUpd.Items.Count -gt 0)
    $script:btnInstallSel.IsEnabled = $Enabled -and $hasUpd
    $script:btnInstallAll.IsEnabled = $Enabled -and $hasUpd
    $script:pbBusy.IsIndeterminate  = -not $Enabled
}

function Write-Log([string]$msg) {
    $script:txtLog.AppendText(('{0}  {1}' -f (Get-Date -Format 'HH:mm:ss'), $msg) + [Environment]::NewLine)
    $script:txtLog.ScrollToEnd()
}

function Start-Work {
    param([string]$Status, [scriptblock]$Work, [object]$Arg, [scriptblock]$Done)
    if ($script:Sync.Busy) {
        [System.Windows.MessageBox]::Show('Es laeuft bereits ein Vorgang. Bitte warten.','VolmeDriver') | Out-Null
        return
    }
    $script:Sync.Busy = $true; $script:Sync.Done = $false; $script:Sync.Result = $null
    $script:OnDone = $Done
    Set-Buttons $false
    $script:txtStatus.Text = $Status

    $rs = [runspacefactory]::CreateRunspace()
    $rs.ApartmentState = 'STA'
    $rs.Open()
    $rs.SessionStateProxy.SetVariable('Sync',     $script:Sync)
    $rs.SessionStateProxy.SetVariable('Arg',      $Arg)
    $rs.SessionStateProxy.SetVariable('WorkText', $Work.ToString())

    $ps = [powershell]::Create()
    $ps.Runspace = $rs
    [void]$ps.AddScript({
        function Log([string]$m) { $Sync.Log.Enqueue(('{0}  {1}' -f (Get-Date -Format 'HH:mm:ss'), $m)) }
        try {
            $sb = [scriptblock]::Create($WorkText)
            $Sync.Result = & $sb $Arg
        } catch {
            Log ('FEHLER: ' + $_.Exception.Message)
        }
        $Sync.Done = $true
    })
    $script:CurPS = $ps
    [void]$ps.BeginInvoke()
}

# PSCustomObject-Listen zuverlaessig im WPF-DataGrid anzeigen -> DataTable
function ConvertTo-Table($items) {
    $dt = New-Object System.Data.DataTable
    $items = @($items)
    if ($items.Count -eq 0) { return ,$dt }
    foreach ($p in $items[0].PSObject.Properties.Name) { [void]$dt.Columns.Add($p) }
    foreach ($it in $items) {
        $row = $dt.NewRow()
        foreach ($p in $it.PSObject.Properties) { $row[$p.Name] = [string]$p.Value }
        $dt.Rows.Add($row)
    }
    ,$dt
}

# Timer: Log-Zeilen aus dem Runspace abholen, Abschluss erkennen
$script:Timer = New-Object System.Windows.Threading.DispatcherTimer
$script:Timer.Interval = [TimeSpan]::FromMilliseconds(250)
$script:Timer.Add_Tick({
    while ($script:Sync.Log.Count -gt 0) {
        $script:txtLog.AppendText([string]$script:Sync.Log.Dequeue() + [Environment]::NewLine)
        $script:txtLog.ScrollToEnd()
    }
    if ($script:Sync.Done) {
        $script:Sync.Done = $false
        $script:Sync.Busy = $false
        if ($script:CurPS) { try { $script:CurPS.Dispose() } catch {}; $script:CurPS = $null }
        Set-Buttons $true
        $script:txtStatus.Text = 'Bereit'
        if ($script:OnDone) {
            $cb = $script:OnDone; $script:OnDone = $null
            & $cb $script:Sync.Result
        }
    }
})
$script:Timer.Start()

# ----------------------------------------------------------------------------
#  Arbeits-Bloecke (laufen im Hintergrund-Runspace; 'Log' ist dort definiert)
# ----------------------------------------------------------------------------
$script:InventoryWork = {
    param($a)
    Log 'Lese Geraete und Treiber ein ...'
    $list = Get-CimInstance Win32_PnPSignedDriver |
        Where-Object { $_.DeviceName } |
        Sort-Object DeviceName |
        ForEach-Object {
            [pscustomobject]@{
                Geraet     = $_.DeviceName
                Klasse     = $_.DeviceClass
                Hersteller = $_.Manufacturer
                Version    = $_.DriverVersion
                Datum      = if ($_.DriverDate) { $_.DriverDate.ToString('dd.MM.yyyy') } else { '' }
                InfDatei   = $_.InfName
            }
        }
    Log ('{0} Treiber-Eintraege gefunden.' -f @($list).Count)
    ,@($list)
}

$script:BackupWork = {
    param($dir)
    $dest = Join-Path $dir ('VolmeDriver_{0}_{1}' -f $env:COMPUTERNAME, (Get-Date -Format 'yyyy-MM-dd_HHmm'))
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    Log ('Sichere Treiber nach: {0}' -f $dest)
    Log 'Das kann einige Minuten dauern ...'
    $null = & pnputil.exe /export-driver * $dest 2>&1
    if ($LASTEXITCODE -ne 0) { Log ('Hinweis: pnputil meldete Exit-Code {0}' -f $LASTEXITCODE) }
    $n = @(Get-ChildItem -Path $dest -Directory).Count
    Log ('Fertig: {0} Treiberpakete gesichert.' -f $n)
    Log 'Lege Inventarliste (inventar.csv) mit ab ...'
    Get-CimInstance Win32_PnPSignedDriver |
        Where-Object { $_.DeviceName } |
        Select-Object DeviceName, DeviceClass, Manufacturer, DriverVersion, DriverDate, InfName |
        Export-Csv -Path (Join-Path $dest 'inventar.csv') -NoTypeInformation -Encoding UTF8
    $dest
}

$script:RestoreWork = {
    param($dir)
    $infCount = @(Get-ChildItem -Path $dir -Filter *.inf -Recurse -ErrorAction SilentlyContinue).Count
    if ($infCount -eq 0) { Log 'Keine INF-Dateien im gewaehlten Ordner gefunden.'; return $null }
    Log ('Installiere {0} INF-Datei(en) aus: {1}' -f $infCount, $dir)
    Log 'Das kann einige Minuten dauern ...'
    $out = & pnputil.exe /add-driver (Join-Path $dir '*.inf') /subdirs /install 2>&1
    $out | Where-Object { $_ -match 'erfolgreich|Fehler|hinzugef|installiert|added|success|fail' } |
        ForEach-Object { Log ('  ' + $_) }
    $summary = $out | Select-Object -Last 3
    $summary | ForEach-Object { Log $_ }
    'fertig'
}

$script:SearchWork = {
    param($a)
    Log 'Verbinde mit Windows Update ...'
    $session  = New-Object -ComObject Microsoft.Update.Session
    $searcher = $session.CreateUpdateSearcher()
    Log 'Suche nach Treiber-Updates (dauert oft 1-3 Minuten) ...'
    $res  = $searcher.Search("IsInstalled=0 and Type='Driver'")
    $list = @()
    foreach ($u in $res.Updates) {
        $mb = ''
        try { $mb = [math]::Round($u.MaxDownloadSize / 1MB, 1) } catch {}
        $datum = ''
        try { if ($u.DriverVerDate) { $datum = ([datetime]$u.DriverVerDate).ToString('dd.MM.yyyy') } } catch {}
        $herst = ''; $modell = ''
        try { $herst  = $u.DriverManufacturer } catch {}
        try { $modell = $u.DriverModel } catch {}
        $list += [pscustomobject]@{
            Titel      = $u.Title
            Hersteller = $herst
            Modell     = $modell
            Datum      = $datum
            MB         = $mb
        }
    }
    Log ('{0} Treiber-Update(s) gefunden.' -f @($list).Count)
    ,@($list)
}

$script:InstallWork = {
    param($titles)
    $session  = New-Object -ComObject Microsoft.Update.Session
    $searcher = $session.CreateUpdateSearcher()
    Log 'Gleiche Auswahl mit Windows Update ab ...'
    $res  = $searcher.Search("IsInstalled=0 and Type='Driver'")
    $coll = New-Object -ComObject Microsoft.Update.UpdateColl
    foreach ($u in $res.Updates) {
        if ($titles -contains $u.Title) {
            if (-not $u.EulaAccepted) { try { $u.AcceptEula() } catch {} }
            [void]$coll.Add($u)
        }
    }
    if ($coll.Count -eq 0) { Log 'Keine passenden Updates mehr gefunden.'; return $false }
    Log ('Lade {0} Update(s) herunter ...' -f $coll.Count)
    $dl = $session.CreateUpdateDownloader()
    $dl.Updates = $coll
    $null = $dl.Download()
    Log 'Installiere ...'
    $inst = $session.CreateUpdateInstaller()
    $inst.Updates = $coll
    $ir = $inst.Install()
    for ($i = 0; $i -lt $coll.Count; $i++) {
        $rc  = $ir.GetUpdateResult($i).ResultCode
        $txt = switch ($rc) {
            2 { 'OK' } 3 { 'OK (mit Hinweisen)' } 4 { 'FEHLGESCHLAGEN' } 5 { 'Abgebrochen' }
            default { 'Code {0}' -f $rc }
        }
        Log ('  {0}: {1}' -f $coll.Item($i).Title, $txt)
    }
    if ($ir.RebootRequired) { Log 'NEUSTART erforderlich, um die Installation abzuschliessen.' }
    [bool]$ir.RebootRequired
}

# ----------------------------------------------------------------------------
#  Aktionen / Ereignisse
# ----------------------------------------------------------------------------
function Invoke-InventoryRefresh {
    Start-Work -Status 'Lese Inventar ein ...' -Work $script:InventoryWork -Arg $null -Done {
        param($result)
        $script:LastInventory = @($result)
        $dt = ConvertTo-Table $script:LastInventory
        $script:dgInv.ItemsSource = $dt.DefaultView
        $script:txtInvCount.Text  = '{0} Eintraege' -f $script:LastInventory.Count
    }
}

$script:btnInvRefresh.Add_Click({ Invoke-InventoryRefresh })

$script:btnReport.Add_Click({
    if (-not $script:LastInventory -or $script:LastInventory.Count -eq 0) {
        [System.Windows.MessageBox]::Show('Bitte zuerst das Inventar einlesen.','VolmeDriver') | Out-Null
        return
    }
    $dlg = New-Object System.Windows.Forms.SaveFileDialog
    $dlg.Filter   = 'HTML-Bericht (*.html)|*.html'
    $dlg.FileName = 'Treiberbericht_{0}_{1}.html' -f $env:COMPUTERNAME, (Get-Date -Format 'yyyy-MM-dd')
    if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { return }

    $enc  = [System.Net.WebUtility]
    $rows = foreach ($it in $script:LastInventory) {
        '<tr><td>{0}</td><td>{1}</td><td>{2}</td><td>{3}</td><td>{4}</td><td>{5}</td></tr>' -f
            $enc::HtmlEncode([string]$it.Geraet),  $enc::HtmlEncode([string]$it.Klasse),
            $enc::HtmlEncode([string]$it.Hersteller), $enc::HtmlEncode([string]$it.Version),
            $enc::HtmlEncode([string]$it.Datum),   $enc::HtmlEncode([string]$it.InfDatei)
    }
    $os   = (Get-CimInstance Win32_OperatingSystem).Caption
    $html = @"
<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>Treiberbericht $($env:COMPUTERNAME)</title>
<style>
 body{font-family:Segoe UI,Arial,sans-serif;margin:32px;color:#1F2937}
 h1{font-size:22px;margin:0 0 4px} .sub{color:#6B7280;margin:0 0 20px}
 table{border-collapse:collapse;width:100%;font-size:13px}
 th,td{border:1px solid #D1D5DB;padding:6px 10px;text-align:left}
 th{background:#1F2937;color:#fff} tr:nth-child(even){background:#F3F4F6}
</style></head><body>
<h1>Treiberbericht &ndash; $($env:COMPUTERNAME)</h1>
<p class="sub">$os &middot; erstellt am $(Get-Date -Format 'dd.MM.yyyy HH:mm') &middot; VolmeDriver</p>
<table><tr><th>Geraet</th><th>Klasse</th><th>Hersteller</th><th>Version</th><th>Datum</th><th>INF-Datei</th></tr>
$($rows -join "`n")
</table></body></html>
"@
    [System.IO.File]::WriteAllText($dlg.FileName, $html, (New-Object System.Text.UTF8Encoding($true)))
    Write-Log ('Bericht gespeichert: {0}' -f $dlg.FileName)
    Start-Process $dlg.FileName
})

$script:btnBrowseBackup.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = 'Zielordner fuer die Treiber-Sicherung waehlen'
    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        $script:txtBackupDir.Text = $dlg.SelectedPath
    }
})

$script:btnBackup.Add_Click({
    $dir = $script:txtBackupDir.Text.Trim()
    if (-not $dir) {
        [System.Windows.MessageBox]::Show('Bitte einen Zielordner angeben.','VolmeDriver') | Out-Null
        return
    }
    Start-Work -Status 'Sichere Treiber ...' -Work $script:BackupWork -Arg $dir -Done {
        param($result)
        if ($result) {
            [System.Windows.MessageBox]::Show(('Sicherung abgeschlossen:{0}{1}' -f [Environment]::NewLine, $result),
                'VolmeDriver') | Out-Null
        }
    }
})

$script:btnBrowseRestore.Add_Click({
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = 'Ordner mit gesicherten Treibern waehlen'
    if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        $script:txtRestoreDir.Text = $dlg.SelectedPath
    }
})

$script:btnRestore.Add_Click({
    $dir = $script:txtRestoreDir.Text.Trim()
    if (-not $dir -or -not (Test-Path $dir)) {
        [System.Windows.MessageBox]::Show('Bitte einen vorhandenen Ordner waehlen.','VolmeDriver') | Out-Null
        return
    }
    $answer = [System.Windows.MessageBox]::Show(
        ('Alle Treiber aus{0}{1}{0}auf diesem PC installieren?' -f [Environment]::NewLine, $dir),
        'VolmeDriver', 'YesNo', 'Warning')
    if ($answer -ne 'Yes') { return }
    Start-Work -Status 'Installiere Treiber ...' -Work $script:RestoreWork -Arg $dir -Done {
        param($result)
        if ($result) {
            [System.Windows.MessageBox]::Show('Treiber-Installation abgeschlossen. Details im Protokoll.',
                'VolmeDriver') | Out-Null
        }
    }
})

$script:btnSearchUpd.Add_Click({
    Start-Work -Status 'Suche Treiber-Updates ...' -Work $script:SearchWork -Arg $null -Done {
        param($result)
        $list = @($result)
        $dt = ConvertTo-Table $list
        $script:dgUpd.ItemsSource = $dt.DefaultView
        $has = $list.Count -gt 0
        $script:btnInstallSel.IsEnabled = $has
        $script:btnInstallAll.IsEnabled = $has
        if (-not $has) {
            [System.Windows.MessageBox]::Show('Keine Treiber-Updates verfuegbar - alles aktuell.','VolmeDriver') | Out-Null
        }
    }
})

function Invoke-UpdateInstall([string[]]$titles) {
    if (-not $titles -or $titles.Count -eq 0) {
        [System.Windows.MessageBox]::Show('Bitte zuerst Updates in der Liste auswaehlen.','VolmeDriver') | Out-Null
        return
    }
    $answer = [System.Windows.MessageBox]::Show(
        ('{0} Treiber-Update(s) herunterladen und installieren?' -f $titles.Count),
        'VolmeDriver', 'YesNo', 'Question')
    if ($answer -ne 'Yes') { return }
    Start-Work -Status 'Installiere Updates ...' -Work $script:InstallWork -Arg $titles -Done {
        param($result)
        $script:dgUpd.ItemsSource = $null
        $script:btnInstallSel.IsEnabled = $false
        $script:btnInstallAll.IsEnabled = $false
        if ($result -eq $true) {
            [System.Windows.MessageBox]::Show('Installation abgeschlossen - bitte den PC neu starten.',
                'VolmeDriver') | Out-Null
        } else {
            Write-Log 'Tipp: Erneut suchen, um den aktuellen Stand zu sehen.'
        }
    }
}

$script:btnInstallSel.Add_Click({
    $titles = @($script:dgUpd.SelectedItems | ForEach-Object { [string]$_.Row['Titel'] })
    Invoke-UpdateInstall $titles
})

$script:btnInstallAll.Add_Click({
    $titles = @($script:dgUpd.Items | ForEach-Object { [string]$_.Row['Titel'] })
    Invoke-UpdateInstall $titles
})

# ----------------------------------------------------------------------------
#  Hersteller-Reiter: Systemerkennung + Direkt-Links
# ----------------------------------------------------------------------------
function Add-LinkKnopf([string]$Text, [scriptblock]$Aktion, [bool]$Primaer) {
    $b = New-Object System.Windows.Controls.Button
    $b.Content = $Text
    $b.Margin = '0,0,8,8'
    $b.Padding = '12,6'
    if ($Primaer) {
        $b.Background = [System.Windows.Media.BrushConverter]::new().ConvertFromString('#2563EB')
        $b.Foreground = [System.Windows.Media.Brushes]::White
        $b.FontWeight = 'SemiBold'
    }
    $b.Tag = $Aktion
    $b.Add_Click({ & $this.Tag })
    [void]$script:pnlLinks.Children.Add($b)
}

function Invoke-HerstellerErkennung {
    try {
        $cs   = Get-CimInstance Win32_ComputerSystem
        $bios = Get-CimInstance Win32_BIOS
        $bb   = $null; try { $bb = Get-CimInstance Win32_BaseBoard } catch {}
        $gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object {
                    @{ name = [string]$_.Name; version = [string]$_.DriverVersion } })
        $netz  = @(Get-CimInstance Win32_NetworkAdapter -Filter "PhysicalAdapter=TRUE" |
                     ForEach-Object { [string]$_.Name })
        $audio = @(Get-CimInstance Win32_SoundDevice | ForEach-Object { [string]$_.Name })
    } catch {
        $script:txtSystem.Text = 'Systemerkennung fehlgeschlagen: ' + $_.Exception.Message
        return
    }

    $generisch = (-not $cs.Manufacturer) -or
                 ($cs.Manufacturer -match 'System manufacturer|To be filled|Default')
    $herst  = if ($generisch -and $bb) { [string]$bb.Manufacturer } else { [string]$cs.Manufacturer }
    $modell = if ($generisch -and $bb) { [string]$bb.Product }     else { [string]$cs.Model }
    $sn = [string]$bios.SerialNumber
    if ($sn -match 'To be filled|Default') { $sn = '' }
    $name = ('{0} {1}' -f $herst, $modell).Trim()

    $teile = @($name)
    if ($sn) { $teile += ('S/N ' + $sn) }
    foreach ($g in $gpus) { $teile += ('{0} (Treiber {1})' -f $g.name, $g.version) }
    $script:txtSystem.Text = ($teile -join '  |  ')

    $script:pnlLinks.Children.Clear()
    $h = $herst.ToLower()
    $links = New-Object System.Collections.ArrayList
    $snEnc = [uri]::EscapeDataString($sn)
    if ($h -match 'dell') {
        $url = if ($sn) { "https://www.dell.com/support/home/de-de/product-support/servicetag/$snEnc/drivers" }
               else { 'https://www.dell.com/support/home/de-de' }
        [void]$links.Add(@('Dell-Treiber fuer dieses Geraet', $url))
    } elseif ($h -match 'lenovo') {
        $q = if ($sn) { $snEnc } else { [uri]::EscapeDataString($modell) }
        [void]$links.Add(@('Lenovo-Treiber fuer dieses Geraet', "https://pcsupport.lenovo.com/de/de/search?query=$q"))
    } elseif ($h -match 'hewlett|^hp$|^hp ') {
        [void]$links.Add(@('HP-Treiber (Geraet wird erkannt)', 'https://support.hp.com/de-de/drivers'))
    } elseif ($h -match 'asus')       { [void]$links.Add(@('ASUS Download-Center', 'https://www.asus.com/de/support/download-center/')) }
    elseif ($h -match 'micro-star|msi') { [void]$links.Add(@('MSI-Treiber', 'https://de.msi.com/support/download')) }
    elseif ($h -match 'gigabyte')     { [void]$links.Add(@('Gigabyte-Support', 'https://www.gigabyte.com/de/Support')) }
    elseif ($h -match 'asrock')       { [void]$links.Add(@('ASRock-Support', 'https://www.asrock.com/support/index.de.asp')) }
    elseif ($h -match 'acer')         { [void]$links.Add(@('Acer Treiber und Handbuecher', 'https://www.acer.com/de-de/support/drivers-and-manuals')) }
    elseif ($h -match 'medion')       { [void]$links.Add(@('Medion-Service', 'https://www.medion.com/de/service/')) }
    elseif ($h -match 'microsoft')    { [void]$links.Add(@('Surface-Support', 'https://support.microsoft.com/de-de/surface')) }
    elseif ($h -match 'fujitsu')      { [void]$links.Add(@('Fujitsu-Support', 'https://support.ts.fujitsu.com/')) }
    elseif ($name) {
        [void]$links.Add(@(('"{0}" Treiber suchen' -f $name),
            ('https://duckduckgo.com/?q=' + [uri]::EscapeDataString($name + ' Treiber Download'))))
    }

    $gpuText = (($gpus | ForEach-Object { $_.name }) -join ' ').ToLower()
    if ($gpuText -match 'nvidia|geforce|quadro|rtx |gtx ') {
        [void]$links.Add(@('NVIDIA-Grafiktreiber', 'https://www.nvidia.com/de-de/drivers/'))
    }
    if ($gpuText -match 'radeon|amd') {
        [void]$links.Add(@('AMD-Grafiktreiber', 'https://www.amd.com/de/support/download/drivers.html'))
    }
    $naText = (($netz + $audio) -join ' ').ToLower()
    if ($gpuText -match 'intel' -or $naText -match 'intel') {
        [void]$links.Add(@('Intel Treiber-Assistent', 'https://www.intel.de/content/www/de/de/support/detect.html'))
    }
    if ($naText -match 'realtek') {
        [void]$links.Add(@('Realtek (Netzwerk/Audio)', 'https://www.realtek.com/Download'))
    }

    $gesehen = @{}
    foreach ($l in $links) {
        if ($gesehen.ContainsKey($l[1])) { continue }
        $gesehen[$l[1]] = $true
        $url = $l[1]
        Add-LinkKnopf ($l[0] + '  >') ([scriptblock]::Create("Start-Process '$url'")) $false
    }

    # Installierte Hersteller-Updater als Start-Knopf anbieten
    $kand = @(
        @{ n = 'Dell Command Update';  p = "$env:ProgramFiles\Dell\CommandUpdate\dcu-ui.exe" },
        @{ n = 'Dell Command Update';  p = "${env:ProgramFiles(x86)}\Dell\CommandUpdate\dcu-ui.exe" },
        @{ n = 'Lenovo System Update'; p = "${env:ProgramFiles(x86)}\Lenovo\System Update\tvsu.exe" },
        @{ n = 'HP Support Assistant'; p = "${env:ProgramFiles(x86)}\Hp\HP Support Framework\HPSF.exe" },
        @{ n = 'MSI Center';           p = "$env:ProgramFiles\MSI\MSI Center\MSI Center.exe" },
        @{ n = 'ASUS Armoury Crate';   p = "$env:ProgramFiles\ASUS\ARMOURY CRATE Service\ArmouryCrate.exe" }
    )
    foreach ($k in $kand) {
        if ($k.p -and (Test-Path -LiteralPath $k.p)) {
            $pfad = $k.p
            Add-LinkKnopf ($k.n + ' starten') ([scriptblock]::Create("Start-Process '$pfad'")) $true
        }
    }
}

# ----------------------------------------------------------------------------
#  Start
# ----------------------------------------------------------------------------
$script:Window.Add_ContentRendered({
    Write-Log 'VolmeDriver gestartet (mit Administrator-Rechten).'
    Invoke-HerstellerErkennung
    Invoke-InventoryRefresh
})

[void]$script:Window.ShowDialog()
