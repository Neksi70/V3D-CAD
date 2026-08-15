using System.Text.Json;
using System.Text.Json.Serialization;

namespace VolmeThin.Core;

/// <summary>Wie die Anwendung auf dem Zielrechner abgelegt wird.</summary>
public enum DeployMode
{
    /// <summary>Dateien und Registry landen an den Originalpfaden (braucht Adminrechte).</summary>
    Install,
    /// <summary>Alles landet in einem Cache unter %LOCALAPPDATA%, HKLM wird nach HKCU gespiegelt.</summary>
    Portable
}

public enum RegKind { String, ExpandString, MultiString, Dword, Qword, Binary, None }

public sealed class RegistryEntry
{
    /// <summary>HKLM, HKCU, HKCR oder HKU.</summary>
    public string Root { get; set; } = "HKLM";
    /// <summary>Schluesselpfad ohne Root, z.B. "Software\\Firma\\Produkt".</summary>
    public string Key { get; set; } = "";
    /// <summary>Wertname; leer = Standardwert des Schluessels.</summary>
    public string Name { get; set; } = "";
    public RegKind Kind { get; set; } = RegKind.String;
    /// <summary>Textwert; bei Binary Base64, bei MultiString mit \n getrennt.</summary>
    public string? Value { get; set; }
}

public sealed class PackagedFile
{
    /// <summary>Pfad innerhalb des Pakets, z.B. "files/00001.bin".</summary>
    public string Src { get; set; } = "";
    /// <summary>Zielpfad mit Makros, z.B. "{ProgramFiles}\\Firma\\app.exe".</summary>
    public string Target { get; set; } = "";
    public long Size { get; set; }
    public string? Sha256 { get; set; }
}

public sealed class PackageManifest
{
    public int Schema { get; set; } = 1;
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Version { get; set; } = "1.0.0";
    public string? Publisher { get; set; }
    public string? Notes { get; set; }

    /// <summary>Zu startende Datei, Zielpfad mit Makros.</summary>
    public string EntryPoint { get; set; } = "";
    public string? EntryArgs { get; set; }
    public string? WorkingDir { get; set; }

    public DeployMode Mode { get; set; } = DeployMode.Install;
    /// <summary>Nach Beenden der Anwendung alles wieder entfernen (nur Portable sinnvoll).</summary>
    public bool CleanupOnExit { get; set; }
    /// <summary>Stub bleibt bis zum Ende der Anwendung offen (noetig fuer CleanupOnExit).</summary>
    public bool WaitForExit { get; set; } = true;
    /// <summary>Stub fordert beim Start Adminrechte an.</summary>
    public bool Elevate { get; set; }

    public List<PackagedFile> Files { get; set; } = new();
    public List<RegistryEntry> Registry { get; set; } = new();
    /// <summary>Umgebungsvariablen fuer den gestarteten Prozess (Werte duerfen Makros enthalten).</summary>
    public Dictionary<string, string> Env { get; set; } = new();

    public string ToJson() => JsonSerializer.Serialize(this, ManifestJson.Default.PackageManifest);

    public static PackageManifest FromJson(string json) =>
        JsonSerializer.Deserialize(json, ManifestJson.Default.PackageManifest)
        ?? throw new InvalidDataException("package.json konnte nicht gelesen werden.");
}

[JsonSourceGenerationOptions(
    WriteIndented = true,
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    Converters = new[] { typeof(JsonStringEnumConverter<DeployMode>), typeof(JsonStringEnumConverter<RegKind>) })]
[JsonSerializable(typeof(PackageManifest))]
public partial class ManifestJson : JsonSerializerContext { }
