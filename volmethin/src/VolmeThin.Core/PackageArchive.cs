using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;

namespace VolmeThin.Core;

/// <summary>Schreibt ein .v3pkg (ZIP mit package.json + files/...).</summary>
public sealed class PackageWriter : IDisposable
{
    private readonly ZipArchive _zip;
    private readonly Dictionary<string, string> _byHash = new(StringComparer.OrdinalIgnoreCase);
    private int _counter;

    public PackageWriter(string path)
        : this(new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None)) { }

    public PackageWriter(Stream target) =>
        _zip = new ZipArchive(target, ZipArchiveMode.Create, leaveOpen: false, Encoding.UTF8);

    /// <summary>
    /// Nimmt eine Datei ins Paket auf und liefert den fertigen Eintrag.
    /// Inhaltsgleiche Dateien werden nur einmal gespeichert.
    /// </summary>
    public PackagedFile AddFile(string sourcePath, string macroTarget)
    {
        var info = new FileInfo(sourcePath);
        string hash = Sha256File(sourcePath);

        if (!_byHash.TryGetValue(hash, out var entryName))
        {
            entryName = $"files/{++_counter:D5}.bin";
            var entry = _zip.CreateEntry(entryName, CompressionLevel.Optimal);
            using var es = entry.Open();
            using var fs = File.OpenRead(sourcePath);
            fs.CopyTo(es);
            _byHash[hash] = entryName;
        }

        return new PackagedFile { Src = entryName, Target = macroTarget, Size = info.Length, Sha256 = hash };
    }

    /// <summary>Beliebige Zusatzdatei ablegen (z.B. Icon).</summary>
    public void AddRaw(string entryName, byte[] data)
    {
        var entry = _zip.CreateEntry(entryName, CompressionLevel.Optimal);
        using var es = entry.Open();
        es.Write(data, 0, data.Length);
    }

    /// <summary>Schreibt das Manifest. Muss als Letztes aufgerufen werden.</summary>
    public void Finish(PackageManifest manifest)
    {
        var entry = _zip.CreateEntry("package.json", CompressionLevel.Optimal);
        using var es = entry.Open();
        using var w = new StreamWriter(es, new UTF8Encoding(false));
        w.Write(manifest.ToJson());
    }

    public static string Sha256File(string path)
    {
        using var sha = SHA256.Create();
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite, 1 << 16);
        return Convert.ToHexString(sha.ComputeHash(fs));
    }

    public void Dispose() => _zip.Dispose();
}

/// <summary>Liest ein .v3pkg, egal ob als eigene Datei oder an eine EXE angehaengt.</summary>
public sealed class PackageReader : IDisposable
{
    private readonly ZipArchive _zip;
    public PackageManifest Manifest { get; }

    private PackageReader(Stream source)
    {
        _zip = new ZipArchive(source, ZipArchiveMode.Read, leaveOpen: false, Encoding.UTF8);
        var entry = _zip.GetEntry("package.json")
                    ?? throw new InvalidDataException("Kein package.json im Paket.");
        using var sr = new StreamReader(entry.Open(), Encoding.UTF8);
        Manifest = PackageManifest.FromJson(sr.ReadToEnd());
    }

    public static PackageReader Open(string path) =>
        new(new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read));

    public static PackageReader FromStream(Stream s) => new(s);

    /// <summary>Paket aus der eigenen EXE (Overlay). Liefert null, wenn keins angehaengt ist.</summary>
    public static PackageReader? FromSelfExtracting(string exePath)
    {
        var payload = Overlay.TryOpen(exePath);
        return payload is null ? null : new PackageReader(payload);
    }

    public Stream OpenEntry(string entryName) =>
        (_zip.GetEntry(entryName) ?? throw new InvalidDataException($"Eintrag fehlt: {entryName}")).Open();

    public bool HasEntry(string entryName) => _zip.GetEntry(entryName) is not null;

    public void Dispose() => _zip.Dispose();
}
