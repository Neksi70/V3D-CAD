using VolmeThin.Core;

namespace VolmeThin.Capture;

/// <summary>Macht aus einem Diff ein fertiges .v3pkg.</summary>
public static class PackageFactory
{
    public static PackageManifest Build(DiffResult diff, PackageManifest meta, string outPath,
                                        Action<int, int, string>? progress = null,
                                        CancellationToken ct = default)
    {
        var macros = PathMacros.Resolve();
        var manifest = meta;
        manifest.Files.Clear();
        manifest.Registry.Clear();
        manifest.Registry.AddRange(diff.Registry);

        using (var writer = new PackageWriter(outPath))
        {
            int i = 0;
            foreach (var file in diff.Files)
            {
                ct.ThrowIfCancellationRequested();
                i++;
                progress?.Invoke(i, diff.Files.Count, file);
                try
                {
                    manifest.Files.Add(writer.AddFile(file, PathMacros.Pack(file, macros)));
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException)
                {
                    // Gesperrte Dateien (laufender Dienst, Virenscanner) sind kein Grund, das Paket zu verwerfen.
                    progress?.Invoke(i, diff.Files.Count, $"uebersprungen: {file} ({e.Message})");
                }
            }
            writer.Finish(manifest);
        }
        return manifest;
    }
}
