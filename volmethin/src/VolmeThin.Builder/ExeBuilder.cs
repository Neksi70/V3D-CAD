using VolmeThin.Core;

namespace VolmeThin.Builder;

/// <summary>Fuegt Stub und Paket zu einer startbaren Einzeldatei zusammen.</summary>
public static class ExeBuilder
{
    public static string FindStub(string? explicitPath = null)
    {
        if (explicitPath is { Length: > 0 })
        {
            if (!File.Exists(explicitPath)) throw new FileNotFoundException("Stub nicht gefunden.", explicitPath);
            return explicitPath;
        }

        var baseDir = AppContext.BaseDirectory;
        string[] candidates =
        {
            Path.Combine(baseDir, "VolmeThinStub.exe"),
            Path.Combine(baseDir, "stub", "VolmeThinStub.exe"),
            Path.Combine(baseDir, "..", "stub", "VolmeThinStub.exe")
        };
        foreach (var c in candidates)
            if (File.Exists(c)) return Path.GetFullPath(c);

        throw new FileNotFoundException(
            "VolmeThinStub.exe nicht gefunden. Erwartet neben dem Programm oder im Unterordner 'stub'.");
    }

    /// <param name="iconFile">Optionale .ico-Datei. Ohne Angabe wird das Symbol der Startdatei uebernommen.</param>
    public static void Build(string packagePath, string outExe, string? stubPath = null,
                             string? iconFile = null, Action<string>? log = null)
    {
        var stub = FindStub(stubPath);
        var temp = outExe + ".build.tmp";

        try
        {
            File.Copy(stub, temp, overwrite: true);
            File.SetAttributes(temp, FileAttributes.Normal);

            // Symbol muss vor dem Overlay gesetzt werden - die Ressourcen-API schreibt die Datei neu.
            if (iconFile is { Length: > 0 })
            {
                IconPatcher.Apply(temp, iconFile);
                log?.Invoke($"Symbol aus {Path.GetFileName(iconFile)} uebernommen.");
            }
            else if (TryIconFromEntryPoint(packagePath, temp, log))
            {
                log?.Invoke("Symbol der Startdatei uebernommen.");
            }

            Overlay.Append(temp, packagePath, outExe);
            log?.Invoke($"Fertig: {outExe} ({new FileInfo(outExe).Length / 1024 / 1024} MB)");
        }
        finally
        {
            if (File.Exists(temp)) { try { File.Delete(temp); } catch { } }
        }
    }

    /// <summary>Holt das Symbol aus der im Paket enthaltenen Startdatei.</summary>
    private static bool TryIconFromEntryPoint(string packagePath, string targetExe, Action<string>? log)
    {
        try
        {
            using var reader = PackageReader.Open(packagePath);
            var m = reader.Manifest;
            var entry = m.Files.FirstOrDefault(f =>
                string.Equals(f.Target, m.EntryPoint, StringComparison.OrdinalIgnoreCase));
            if (entry is null) return false;

            var tmpExe = Path.Combine(Path.GetTempPath(), $"vthin_icon_{Guid.NewGuid():N}.exe");
            try
            {
                using (var src = reader.OpenEntry(entry.Src))
                using (var dst = File.Create(tmpExe))
                    src.CopyTo(dst);

                return IconCopier.TryCopy(tmpExe, targetExe);
            }
            finally { try { File.Delete(tmpExe); } catch { } }
        }
        catch (Exception e)
        {
            log?.Invoke($"Symbol konnte nicht uebernommen werden: {e.Message}");
            return false;
        }
    }
}
