using System.IO.Compression;
using System.Text;
using Microsoft.Win32;
using VolmeThin.Core;

namespace VolmeThin.Capture;

public readonly record struct FileStamp(long Size, long MTimeUtcTicks);
public readonly record struct RegValue(RegKind Kind, string Value);

public sealed class CaptureOptions
{
    /// <summary>Verzeichnisse, die gescannt werden (Makro-Pfade erlaubt).</summary>
    public List<string> FileRoots { get; set; } = new()
    {
        "{ProgramFiles}", "{ProgramFilesX86}", "{CommonAppData}",
        "{AppData}", "{LocalAppData}", "{SystemDir}",
        "{Desktop}", "{CommonDesktop}", "{StartMenu}", "{CommonStartMenu}"
    };

    /// <summary>Registry-Zweige, die gescannt werden.</summary>
    public List<string> RegistryRoots { get; set; } = new()
    {
        @"HKLM\SOFTWARE", @"HKCU\SOFTWARE", @"HKLM\SYSTEM\CurrentControlSet\Services"
    };

    public bool UseDefaultExcludes { get; set; } = true;
}

/// <summary>Zustand von Dateisystem und Registry zu einem Zeitpunkt.</summary>
public sealed class SystemSnapshot
{
    private const uint Magic = 0x50534E53;   // "SNSP"
    private const int Version = 1;

    public DateTime TakenUtc { get; set; } = DateTime.UtcNow;
    public Dictionary<string, FileStamp> Files { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    /// <summary>Schluessel: "HKLM\Pfad|Wertname".</summary>
    public Dictionary<string, RegValue> Registry { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public void Save(string path)
    {
        using var fs = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None);
        using var gz = new GZipStream(fs, CompressionLevel.Fastest);
        using var w = new BinaryWriter(gz, Encoding.UTF8);

        w.Write(Magic);
        w.Write(Version);
        w.Write(TakenUtc.Ticks);

        w.Write(Files.Count);
        foreach (var (k, v) in Files) { w.Write(k); w.Write(v.Size); w.Write(v.MTimeUtcTicks); }

        w.Write(Registry.Count);
        foreach (var (k, v) in Registry) { w.Write(k); w.Write((int)v.Kind); w.Write(v.Value); }
    }

    public static SystemSnapshot Load(string path)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        using var gz = new GZipStream(fs, CompressionMode.Decompress);
        using var r = new BinaryReader(gz, Encoding.UTF8);

        if (r.ReadUInt32() != Magic) throw new InvalidDataException("Keine Snapshot-Datei.");
        int ver = r.ReadInt32();
        if (ver != Version) throw new InvalidDataException($"Snapshot-Version {ver} wird nicht unterstuetzt.");

        var snap = new SystemSnapshot { TakenUtc = new DateTime(r.ReadInt64(), DateTimeKind.Utc) };

        int fileCount = r.ReadInt32();
        snap.Files = new Dictionary<string, FileStamp>(fileCount, StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < fileCount; i++)
            snap.Files[r.ReadString()] = new FileStamp(r.ReadInt64(), r.ReadInt64());

        int regCount = r.ReadInt32();
        snap.Registry = new Dictionary<string, RegValue>(regCount, StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < regCount; i++)
            snap.Registry[r.ReadString()] = new RegValue((RegKind)r.ReadInt32(), r.ReadString());

        return snap;
    }
}

public sealed class Snapshotter
{
    private readonly CaptureOptions _opt;
    private readonly Action<string>? _progress;

    public Snapshotter(CaptureOptions options, Action<string>? progress = null)
    {
        _opt = options;
        _progress = progress;
    }

    public SystemSnapshot Take(CancellationToken ct = default)
    {
        var snap = new SystemSnapshot();
        var macros = PathMacros.Resolve();

        foreach (var rootMacro in _opt.FileRoots)
        {
            ct.ThrowIfCancellationRequested();
            var root = PathMacros.Expand(rootMacro, macros);
            if (root.Length == 0 || !Directory.Exists(root)) continue;
            _progress?.Invoke($"Dateien: {root}");
            ScanDirectory(root, snap.Files, ct);
        }

        foreach (var regRoot in _opt.RegistryRoots)
        {
            ct.ThrowIfCancellationRequested();
            _progress?.Invoke($"Registry: {regRoot}");
            ScanRegistry(regRoot, snap.Registry, ct);
        }

        _progress?.Invoke($"Fertig: {snap.Files.Count} Dateien, {snap.Registry.Count} Registry-Werte");
        return snap;
    }

    private void ScanDirectory(string root, Dictionary<string, FileStamp> into, CancellationToken ct)
    {
        var stack = new Stack<string>();
        stack.Push(root);

        while (stack.Count > 0)
        {
            ct.ThrowIfCancellationRequested();
            var dir = stack.Pop();

            if (_opt.UseDefaultExcludes && Excludes.SkipPath(dir + "\\")) continue;

            try
            {
                foreach (var sub in Directory.EnumerateDirectories(dir))
                {
                    // Verzeichnis-Verknuepfungen nicht verfolgen, sonst laeuft der Scan im Kreis.
                    var attr = File.GetAttributes(sub);
                    if ((attr & FileAttributes.ReparsePoint) != 0) continue;
                    stack.Push(sub);
                }
            }
            catch (UnauthorizedAccessException) { }
            catch (IOException) { }

            try
            {
                foreach (var file in Directory.EnumerateFiles(dir))
                {
                    if (_opt.UseDefaultExcludes && Excludes.SkipPath(file)) continue;
                    try
                    {
                        var fi = new FileInfo(file);
                        into[file] = new FileStamp(fi.Length, fi.LastWriteTimeUtc.Ticks);
                    }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
            }
            catch (UnauthorizedAccessException) { }
            catch (IOException) { }
        }
    }

    private void ScanRegistry(string rootPath, Dictionary<string, RegValue> into, CancellationToken ct)
    {
        var (hive, subPath) = RegistryIo.SplitRoot(rootPath);
        using var baseKey = RegistryKey.OpenBaseKey(hive, RegistryView.Default);
        using var start = RegistryIo.TryOpen(baseKey, subPath);
        if (start is null) return;

        var prefix = RegistryIo.HiveShortName(hive);
        var stack = new Stack<(RegistryKey Key, string Path)>();
        stack.Push((start, subPath));
        var opened = new List<RegistryKey>();

        try
        {
            while (stack.Count > 0)
            {
                ct.ThrowIfCancellationRequested();
                var (key, path) = stack.Pop();
                var full = $"{prefix}\\{path}";

                if (_opt.UseDefaultExcludes && Excludes.SkipRegistry(full)) continue;

                try
                {
                    foreach (var valueName in key.GetValueNames())
                    {
                        var kind = RegistryIo.ReadValue(key, valueName, out var text);
                        if (kind is null) continue;
                        into[$"{full}|{valueName}"] = new RegValue(kind.Value, text);
                    }
                }
                catch (Exception e) when (e is UnauthorizedAccessException or IOException) { }

                try
                {
                    foreach (var subName in key.GetSubKeyNames())
                    {
                        var sub = RegistryIo.TryOpen(key, subName);
                        if (sub is null) continue;
                        opened.Add(sub);
                        stack.Push((sub, path.Length == 0 ? subName : $"{path}\\{subName}"));
                    }
                }
                catch (Exception e) when (e is UnauthorizedAccessException or IOException) { }
            }
        }
        finally
        {
            foreach (var k in opened) k.Dispose();
        }
    }
}
