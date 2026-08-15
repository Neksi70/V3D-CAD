using System.Text;

namespace VolmeThin.Core;

/// <summary>
/// Haengt ein Paket hinten an eine EXE an (selbstentpackende Einzeldatei) und findet es
/// dort wieder. Am Dateiende steht: [Paketdaten][int64 Laenge][int32 Version][8 Byte Magic].
/// </summary>
public static class Overlay
{
    private static readonly byte[] Magic = Encoding.ASCII.GetBytes("V3THINPK");
    private const int FooterSize = 8 + 4 + 8;   // Laenge + Version + Magic
    public const int FormatVersion = 1;

    public static void Append(string stubExe, string packageFile, string outExe)
    {
        using var outFs = new FileStream(outExe, FileMode.Create, FileAccess.Write, FileShare.None);
        using (var stub = File.OpenRead(stubExe)) stub.CopyTo(outFs);

        long payloadLen;
        using (var pkg = File.OpenRead(packageFile))
        {
            payloadLen = pkg.Length;
            pkg.CopyTo(outFs);
        }

        using var w = new BinaryWriter(outFs, Encoding.ASCII, leaveOpen: true);
        w.Write(payloadLen);
        w.Write(FormatVersion);
        w.Write(Magic);
    }

    /// <summary>Oeffnet das angehaengte Paket. Liefert null, wenn die Datei keins traegt.</summary>
    public static SubStream? TryOpen(string exePath)
    {
        var fs = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        try
        {
            if (fs.Length < FooterSize) { fs.Dispose(); return null; }

            fs.Position = fs.Length - Magic.Length;
            var magic = new byte[Magic.Length];
            fs.ReadExactly(magic);
            if (!magic.AsSpan().SequenceEqual(Magic)) { fs.Dispose(); return null; }

            fs.Position = fs.Length - FooterSize;
            using var r = new BinaryReader(fs, Encoding.ASCII, leaveOpen: true);
            long payloadLen = r.ReadInt64();
            int version = r.ReadInt32();

            if (version != FormatVersion) { fs.Dispose(); throw new InvalidDataException($"Paketformat {version} wird nicht unterstuetzt."); }
            long start = fs.Length - FooterSize - payloadLen;
            if (start < 0 || payloadLen <= 0) { fs.Dispose(); return null; }

            return new SubStream(fs, start, payloadLen);   // uebernimmt fs
        }
        catch
        {
            fs.Dispose();
            throw;
        }
    }
}
