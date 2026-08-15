using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using VolmeThin.Builder;
using VolmeThin.Capture;
using VolmeThin.Core;

namespace VolmeThin.App;

public partial class MainWindow : Window
{
    private SystemSnapshot? _vorher;
    private DiffResult? _diff;
    private List<string> _dateien = new();
    private string? _paketPfad;
    private string? _gebauteExe;
    private int _schritt;
    private bool _busy;

    public MainWindow() => InitializeComponent();

    // ------------------------------------------------------------ Schritt 1

    private async void BtnVorher_Click(object sender, RoutedEventArgs e)
    {
        await RunAsync("Aufnahme vor der Installation ...", async () =>
        {
            var snap = await Task.Run(() => new Snapshotter(new CaptureOptions(), Log).Take());
            _vorher = snap;
            TxtVorher.Text = $"{snap.Files.Count:N0} Dateien, {snap.Registry.Count:N0} Registry-Werte";
            BtnInstaller.IsEnabled = true;
            BtnNachher.IsEnabled = true;
        });
    }

    private async void BtnInstaller_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Setup auswaehlen",
            Filter = "Installationsprogramme|*.exe;*.msi|Alle Dateien|*.*"
        };
        if (dlg.ShowDialog() != true) return;

        TxtInstaller.Text = "Setup laeuft ...";
        await RunAsync("Setup laeuft - bitte durchklicken.", async () =>
        {
            var psi = new ProcessStartInfo(dlg.FileName) { UseShellExecute = true };
            using var p = Process.Start(psi);
            if (p is not null) await p.WaitForExitAsync();
            TxtInstaller.Text = "Setup beendet.";
            Log($"Setup beendet: {Path.GetFileName(dlg.FileName)}");
        });
    }

    private async void BtnNachher_Click(object sender, RoutedEventArgs e)
    {
        if (_vorher is null) return;

        await RunAsync("Aufnahme nach der Installation ...", async () =>
        {
            var nachher = await Task.Run(() => new Snapshotter(new CaptureOptions(), Log).Take());
            var diff = await Task.Run(() => Differ.Diff(_vorher!, nachher));
            _diff = diff;
            _dateien = new List<string>(diff.Files);

            TxtNachher.Text = $"{diff.Files.Count:N0} neue Dateien, {diff.Registry.Count:N0} Registry-Werte";
            Log(TxtNachher.Text);

            if (diff.Files.Count == 0)
            {
                MessageBox.Show(
                    "Es wurde nichts Neues gefunden. Wurde zwischen den beiden Aufnahmen wirklich installiert?",
                    "VolmeThin", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            FuelleSchrittZwei(diff);
            BtnWeiter.IsEnabled = true;
        });
    }

    // ------------------------------------------------------------ Schritt 2

    private void FuelleSchrittZwei(DiffResult diff)
    {
        var start = Differ.GuessEntryPoint(diff.Files);
        var exes = diff.Files
            .Where(f => f.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            .Select(f => PathMacros.Pack(f))
            .OrderBy(f => f.Count(c => c == '\\'))
            .ThenBy(f => f, StringComparer.OrdinalIgnoreCase)
            .ToList();

        CbStart.ItemsSource = exes;
        CbStart.Text = start ?? exes.FirstOrDefault() ?? "";

        if (TbName.Text.Length == 0 && start is not null)
            TbName.Text = Path.GetFileNameWithoutExtension(start);
        TbId.Text = Kennung(TbName.Text);

        var mb = diff.TotalBytes / 1024.0 / 1024.0;
        TxtBilanz.Text =
            $"{diff.Files.Count:N0} Dateien, {mb:N0} MB\n{diff.Registry.Count:N0} Registry-Werte\n\n" +
            string.Join("\n", diff.ByRoot.OrderByDescending(k => k.Value).Select(k => $"{k.Value,7:N0}  {k.Key}"));

        ZeigeDateien();
    }

    private void ZeigeDateien()
    {
        var filter = TbFilter.Text;
        LstDateien.ItemsSource = filter.Length == 0
            ? _dateien
            : _dateien.Where(f => f.Contains(filter, StringComparison.OrdinalIgnoreCase)).ToList();
        TxtStatus.Text = $"{_dateien.Count:N0} Dateien im Paket.";
    }

    private void TbFilter_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (IsLoaded) ZeigeDateien();
    }

    private void BtnEntfernen_Click(object sender, RoutedEventArgs e)
    {
        var weg = LstDateien.SelectedItems.Cast<string>().ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (weg.Count == 0) return;
        _dateien.RemoveAll(weg.Contains);
        Log($"{weg.Count} Dateien aus dem Paket genommen.");
        ZeigeDateien();
    }

    // ------------------------------------------------------------ Schritt 3

    private void BtnZiel_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new Microsoft.Win32.SaveFileDialog
        {
            Title = "Zieldatei", Filter = "Programm|*.exe", FileName = Path.GetFileName(TbZiel.Text)
        };
        if (dlg.ShowDialog() == true) TbZiel.Text = dlg.FileName;
    }

    private void BtnIcon_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new Microsoft.Win32.OpenFileDialog { Title = "Symbol", Filter = "Symboldatei|*.ico" };
        if (dlg.ShowDialog() == true) TbIcon.Text = dlg.FileName;
    }

    private async void BtnBauen_Click(object sender, RoutedEventArgs e)
    {
        if (_paketPfad is null) { MessageBox.Show("Es liegt noch kein Paket vor."); return; }
        var ziel = TbZiel.Text.Trim();
        if (ziel.Length == 0) { MessageBox.Show("Bitte eine Zieldatei angeben."); return; }

        await RunAsync("EXE wird gebaut ...", async () =>
        {
            var icon = TbIcon.Text.Trim();
            await Task.Run(() => ExeBuilder.Build(_paketPfad!, ziel, null, icon.Length == 0 ? null : icon, Log));
            _gebauteExe = ziel;
            BtnOrdner.IsEnabled = true;
            var mb = new FileInfo(ziel).Length / 1024 / 1024;
            TxtStatus.Text = $"Fertig: {Path.GetFileName(ziel)} ({mb} MB)";
            MessageBox.Show($"{Path.GetFileName(ziel)} ist fertig ({mb} MB).", "VolmeThin",
                            MessageBoxButton.OK, MessageBoxImage.Information);
        });
    }

    private void BtnOrdner_Click(object sender, RoutedEventArgs e)
    {
        if (_gebauteExe is null) return;
        Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{_gebauteExe}\"") { UseShellExecute = true });
    }

    // ------------------------------------------------------------ Ablauf

    private async void BtnWeiter_Click(object sender, RoutedEventArgs e)
    {
        if (_schritt == 1)
        {
            if (!await PaketSchreiben()) return;
        }
        Zeige(_schritt + 1);
    }

    private void BtnZurueck_Click(object sender, RoutedEventArgs e) => Zeige(_schritt - 1);

    private async Task<bool> PaketSchreiben()
    {
        if (_diff is null) return false;

        var start = CbStart.Text.Trim();
        if (start.Length == 0)
        {
            MessageBox.Show("Bitte die Startdatei angeben.", "VolmeThin", MessageBoxButton.OK, MessageBoxImage.Warning);
            return false;
        }

        var id = Kennung(TbId.Text.Length > 0 ? TbId.Text : TbName.Text);
        var modus = (CbModus.SelectedItem as ComboBoxItem)?.Tag as string == "portable"
            ? DeployMode.Portable : DeployMode.Install;

        var meta = new PackageManifest
        {
            Id = id,
            Name = TbName.Text.Trim(),
            Version = TbVersion.Text.Trim(),
            Publisher = TbHersteller.Text.Trim(),
            EntryPoint = start,
            Mode = modus,
            CleanupOnExit = ChkCleanup.IsChecked == true,
            WaitForExit = ChkWait.IsChecked == true || ChkCleanup.IsChecked == true
        };

        var ordner = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VolmeThin", "pakete");
        Directory.CreateDirectory(ordner);
        var pkg = Path.Combine(ordner, id + ".v3pkg");

        // Nur die in Schritt 2 uebrig gebliebenen Dateien wandern ins Paket.
        var gefiltert = new DiffResult();
        gefiltert.Files.AddRange(_dateien);
        gefiltert.Registry.AddRange(_diff.Registry);

        bool ok = false;
        await RunAsync("Paket wird geschrieben ...", async () =>
        {
            await Task.Run(() => PackageFactory.Build(gefiltert, meta, pkg,
                (i, total, datei) => Fortschritt2(i, total, datei)));
            _paketPfad = pkg;
            Log($"Paket geschrieben: {pkg} ({new FileInfo(pkg).Length / 1024 / 1024} MB)");

            TbZiel.Text = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), id + ".exe");
            ok = true;
        });
        return ok;
    }

    private void Zeige(int schritt)
    {
        _schritt = Math.Clamp(schritt, 0, 2);
        PanelAufnehmen.Visibility = _schritt == 0 ? Visibility.Visible : Visibility.Collapsed;
        PanelPruefen.Visibility = _schritt == 1 ? Visibility.Visible : Visibility.Collapsed;
        PanelBauen.Visibility = _schritt == 2 ? Visibility.Visible : Visibility.Collapsed;

        TxtSchritt.Text = _schritt switch
        {
            0 => "Schritt 1 von 3 - Aufnehmen",
            1 => "Schritt 2 von 3 - Pruefen und benennen",
            _ => "Schritt 3 von 3 - EXE bauen"
        };
        BtnZurueck.IsEnabled = _schritt > 0 && !_busy;
        BtnWeiter.IsEnabled = _schritt < 2 && _diff is not null && !_busy;
    }

    private async Task RunAsync(string status, Func<Task> arbeit)
    {
        if (_busy) return;
        _busy = true;
        SperreBedienung(true);
        TxtStatus.Text = status;
        Fortschritt.IsIndeterminate = true;
        try
        {
            await arbeit();
        }
        catch (Exception e)
        {
            Log("FEHLER: " + e);
            MessageBox.Show(e.Message, "VolmeThin", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            _busy = false;
            Fortschritt.IsIndeterminate = false;
            Fortschritt.Value = 0;
            SperreBedienung(false);
            if (TxtStatus.Text == status) TxtStatus.Text = "Bereit.";
        }
    }

    private void SperreBedienung(bool busy)
    {
        BtnVorher.IsEnabled = !busy;
        BtnInstaller.IsEnabled = !busy && _vorher is not null;
        BtnNachher.IsEnabled = !busy && _vorher is not null;
        BtnBauen.IsEnabled = !busy;
        BtnZurueck.IsEnabled = !busy && _schritt > 0;
        BtnWeiter.IsEnabled = !busy && _schritt < 2 && _diff is not null;
    }

    private void Fortschritt2(int i, int total, string datei)
    {
        Dispatcher.InvokeAsync(() =>
        {
            Fortschritt.IsIndeterminate = false;
            Fortschritt.Value = total == 0 ? 0 : i * 1000.0 / total;
            TxtStatus.Text = $"Paket wird geschrieben: {i:N0} von {total:N0}";
        });
    }

    private void Log(string text) => Dispatcher.InvokeAsync(() =>
    {
        TbProtokoll.AppendText($"{DateTime.Now:HH:mm:ss}  {text}{Environment.NewLine}");
        TbProtokoll.ScrollToEnd();
    });

    private static string Kennung(string name)
    {
        var roh = name.Trim().ToLowerInvariant();
        var sb = new System.Text.StringBuilder(roh.Length);
        foreach (var c in roh)
        {
            if (char.IsLetterOrDigit(c)) sb.Append(c);
            else if (c is ' ' or '-' or '_' or '.') sb.Append('-');
        }
        var s = sb.ToString().Trim('-');
        while (s.Contains("--")) s = s.Replace("--", "-");
        return s.Length == 0 ? "paket" : s;
    }
}
