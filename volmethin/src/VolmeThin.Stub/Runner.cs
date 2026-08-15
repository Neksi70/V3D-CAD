using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32;
using VolmeThin.Core;

namespace VolmeThin.Stub;

/// <summary>Packt das angehaengte Paket aus und startet die Anwendung.</summary>
internal static class Runner
{
    public static int Run(string[] args)
    {
        var self = Environment.ProcessPath
                   ?? throw new InvalidOperationException("Eigener Programmpfad nicht ermittelbar.");

        using var reader = PackageReader.FromSelfExtracting(self)
            ?? throw new InvalidDataException(
                "An dieser Datei haengt kein Paket. Sie wurde vermutlich unvollstaendig kopiert.");

        var m = reader.Manifest;
        var macros = PathMacros.Resolve();
        bool portable = m.Mode == DeployMode.Portable;

        var cacheRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "VolmeThin", Sanitize(m.Id), Sanitize(m.Version));

        var markerDir = portable
            ? cacheRoot
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                           "VolmeThin", Sanitize(m.Id));
        var marker = Path.Combine(markerDir, Sanitize(m.Version) + ".ok");

        bool needsSetup = !File.Exists(marker);

        // Installationsmodus schreibt nach Program Files und HKLM: dafuer sind Adminrechte noetig.
        if (needsSetup && !portable && !IsElevated())
            return Relaunch(self, args, m.Name);
        if (m.Elevate && !IsElevated())
            return Relaunch(self, args, m.Name);

        if (needsSetup)
        {
            using var splash = new SplashWindow(m.Name.Length > 0 ? m.Name : "VolmeThin");
            splash.Show();
            try
            {
                Deploy(reader, m, macros, portable, cacheRoot, splash);
                Directory.CreateDirectory(markerDir);
                File.WriteAllText(marker, DateTime.Now.ToString("O"));
            }
            catch
            {
                // Halbfertige Installation nicht als fertig markieren: beim naechsten Start neu versuchen.
                TryDelete(marker);
                throw;
            }
        }

        return Launch(m, macros, portable, cacheRoot, args);
    }

    private static void Deploy(PackageReader reader, PackageManifest m, Dictionary<string, string> macros,
                               bool portable, string cacheRoot, SplashWindow splash)
    {
        long total = 0;
        foreach (var f in m.Files) total += f.Size;
        long done = 0;
        int n = 0;

        foreach (var f in m.Files)
        {
            n++;
            var target = portable ? PathMacros.ToVfs(f.Target, cacheRoot) : PathMacros.Expand(f.Target, macros);
            splash.Update($"Datei {n} von {m.Files.Count}\n{Path.GetFileName(target)}", done, total);

            var dir = Path.GetDirectoryName(target);
            if (dir is { Length: > 0 }) Directory.CreateDirectory(dir);

            try
            {
                using var src = reader.OpenEntry(f.Src);
                using var dst = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16);
                src.CopyTo(dst);
            }
            catch (Exception e) when (e is UnauthorizedAccessException or IOException)
            {
                // Eine gesperrte Systemdatei (z.B. bereits geladene DLL) darf den Start nicht verhindern.
                Log(m, $"Datei uebersprungen: {target} ({e.Message})");
            }
            done += f.Size;
        }

        splash.Update("Registrierung wird geschrieben ...", total, total);
        foreach (var r in m.Registry)
        {
            try
            {
                if (portable) WritePortableRegistry(r);
                else RegistryIo.WriteValue(r);
            }
            catch (Exception e)
            {
                Log(m, $"Registry uebersprungen: {r.Root}\\{r.Key}|{r.Name} ({e.Message})");
            }
        }
    }

    /// <summary>
    /// Ohne Adminrechte wird HKLM auf HKCU umgebogen. Fuer HKLM\Software\Classes ist das
    /// verlaesslich (Windows blendet HKCU\Software\Classes in HKCR ein), fuer andere
    /// Zweige greift es nur, wenn die Anwendung HKCU zuerst befragt.
    /// </summary>
    private static void WritePortableRegistry(RegistryEntry r)
    {
        var hive = RegistryIo.SplitRoot(r.Root).Hive;
        if (hive == RegistryHive.LocalMachine || hive == RegistryHive.ClassesRoot)
        {
            var key = r.Key;
            if (hive == RegistryHive.ClassesRoot) key = "Software\\Classes\\" + key;
            RegistryIo.WriteValue(new RegistryEntry
            {
                Root = "HKCU", Key = key, Name = r.Name, Kind = r.Kind, Value = r.Value
            }, RegistryHive.CurrentUser);
        }
        else
        {
            RegistryIo.WriteValue(r);
        }
    }

    private static int Launch(PackageManifest m, Dictionary<string, string> macros,
                              bool portable, string cacheRoot, string[] args)
    {
        var extra = new Dictionary<string, string> { ["PkgRoot"] = cacheRoot };
        var exe = portable ? PathMacros.ToVfs(m.EntryPoint, cacheRoot)
                           : PathMacros.Expand(m.EntryPoint, macros, extra);

        if (!File.Exists(exe))
            throw new FileNotFoundException($"Startdatei nicht gefunden:\n{exe}", exe);

        var psi = new ProcessStartInfo
        {
            FileName = exe,
            UseShellExecute = false,
            WorkingDirectory = m.WorkingDir is { Length: > 0 }
                ? (portable ? PathMacros.ToVfs(m.WorkingDir, cacheRoot) : PathMacros.Expand(m.WorkingDir, macros, extra))
                : Path.GetDirectoryName(exe) ?? ""
        };

        if (m.EntryArgs is { Length: > 0 }) psi.Arguments = m.EntryArgs;
        foreach (var a in args) psi.ArgumentList.Add(a);

        foreach (var (k, v) in m.Env)
            psi.Environment[k] = portable ? PathMacros.Expand(v, macros, extra) : PathMacros.Expand(v, macros, extra);

        using var proc = Process.Start(psi)
            ?? throw new InvalidOperationException("Anwendung liess sich nicht starten.");

        if (!m.WaitForExit && !m.CleanupOnExit) return 0;

        proc.WaitForExit();

        if (m.CleanupOnExit && portable)
        {
            try { Directory.Delete(cacheRoot, recursive: true); }
            catch (Exception e) { Log(m, $"Aufraeumen fehlgeschlagen: {e.Message}"); }
        }
        return proc.ExitCode;
    }

    private static int Relaunch(string self, string[] args, string appName)
    {
        var psi = new ProcessStartInfo
        {
            FileName = self,
            UseShellExecute = true,
            Verb = "runas"
        };
        foreach (var a in args) psi.ArgumentList.Add(a);

        try
        {
            using var p = Process.Start(psi);
            p?.WaitForExit();
            return p?.ExitCode ?? 0;
        }
        catch (System.ComponentModel.Win32Exception)
        {
            MessageBox(IntPtr.Zero,
                $"{appName} muss einmalig mit Administratorrechten eingerichtet werden.\n" +
                "Die Anfrage wurde abgelehnt.",
                "VolmeThin", 0x10);
            return 5;
        }
    }

    public static bool IsElevated()
    {
        using var id = WindowsIdentity.GetCurrent();
        return new WindowsPrincipal(id).IsInRole(WindowsBuiltInRole.Administrator);
    }

    public static void Log(PackageManifest? m, string text)
    {
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "VolmeThin", "logs");
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, Sanitize(m?.Id ?? "stub") + ".log");
            File.AppendAllText(file, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss}  {text}{Environment.NewLine}");
        }
        catch { /* Protokoll ist Beiwerk, kein Grund zum Abbruch */ }
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }

    private static string Sanitize(string s)
    {
        var bad = Path.GetInvalidFileNameChars();
        var chars = s.Select(c => bad.Contains(c) ? '_' : c).ToArray();
        var cleaned = new string(chars).Trim();
        return cleaned.Length == 0 ? "paket" : cleaned;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);
}
