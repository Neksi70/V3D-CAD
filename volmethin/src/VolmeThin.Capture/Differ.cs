using VolmeThin.Core;

namespace VolmeThin.Capture;

public sealed class DiffResult
{
    /// <summary>Echte Pfade der Dateien, die durch die Installation entstanden oder sich geaendert haben.</summary>
    public List<string> Files { get; } = new();
    public List<RegistryEntry> Registry { get; } = new();
    public long TotalBytes { get; set; }

    /// <summary>Verteilung der Fundstellen auf Wurzelverzeichnisse, fuer die Anzeige.</summary>
    public Dictionary<string, int> ByRoot { get; } = new(StringComparer.OrdinalIgnoreCase);
}

public static class Differ
{
    /// <summary>Vergleicht zwei Snapshots. Alles, was nach der Installation neu oder veraendert ist, kommt ins Paket.</summary>
    public static DiffResult Diff(SystemSnapshot before, SystemSnapshot after, bool useExcludes = true)
    {
        var result = new DiffResult();
        var macros = PathMacros.Resolve();

        foreach (var (path, stamp) in after.Files)
        {
            if (before.Files.TryGetValue(path, out var old) &&
                old.Size == stamp.Size && old.MTimeUtcTicks == stamp.MTimeUtcTicks)
                continue;

            if (useExcludes && Excludes.SkipPath(path)) continue;
            if (!File.Exists(path)) continue;   // zwischenzeitlich wieder weg

            result.Files.Add(path);
            result.TotalBytes += stamp.Size;

            var root = PathMacros.Pack(path, macros);
            var label = root.StartsWith('{') ? root.Substring(0, root.IndexOf('}') + 1) : "(sonstige)";
            result.ByRoot[label] = result.ByRoot.GetValueOrDefault(label) + 1;
        }

        foreach (var (key, val) in after.Registry)
        {
            if (before.Registry.TryGetValue(key, out var old) &&
                old.Kind == val.Kind && old.Value == val.Value)
                continue;

            if (useExcludes && Excludes.SkipRegistry(key)) continue;

            int bar = key.LastIndexOf('|');
            if (bar < 0) continue;
            var fullKey = key.Substring(0, bar);
            var name = key.Substring(bar + 1);

            int slash = fullKey.IndexOf('\\');
            if (slash < 0) continue;

            result.Registry.Add(new RegistryEntry
            {
                Root = fullKey.Substring(0, slash),
                Key = fullKey.Substring(slash + 1),
                Name = name,
                Kind = val.Kind,
                Value = val.Value
            });
        }

        result.Files.Sort(StringComparer.OrdinalIgnoreCase);
        return result;
    }

    /// <summary>
    /// Raet den Startpunkt: bevorzugt eine EXE unter {ProgramFiles}, die nicht nach
    /// Deinstallation, Hilfsprogramm oder Dienst aussieht.
    /// </summary>
    public static string? GuessEntryPoint(IEnumerable<string> files)
    {
        var macros = PathMacros.Resolve();
        string[] bad = { "unins", "setup", "install", "update", "crashpad", "helper",
                         "vcredist", "repair", "report", "service", "daemon", "watchdog" };

        string? best = null;
        long bestScore = long.MinValue;

        foreach (var f in files)
        {
            if (!f.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) continue;
            var name = Path.GetFileNameWithoutExtension(f).ToLowerInvariant();

            long score = 0;
            var packed = PathMacros.Pack(f, macros);
            if (packed.StartsWith("{ProgramFiles", StringComparison.OrdinalIgnoreCase)) score += 10_000_000;
            foreach (var b in bad) if (name.Contains(b, StringComparison.Ordinal)) score -= 50_000_000;

            // Tiefe bestrafen: die Hauptanwendung liegt selten funf Ebenen unter dem Programmordner.
            score -= packed.Count(c => c == '\\') * 200_000;

            try { score += new FileInfo(f).Length / 1024; } catch { }

            if (score > bestScore) { bestScore = score; best = f; }
        }
        return best is null ? null : PathMacros.Pack(best, macros);
    }
}
