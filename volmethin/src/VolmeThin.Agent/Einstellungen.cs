using System.Text.Json;
using System.Text.Json.Serialization;

namespace VolmeThin.Agent;

public sealed class Einstellungen
{
    public string Server { get; set; } = "";
    public string Token { get; set; } = "";
    public string RechnerId { get; set; } = "";
    public string Raum { get; set; } = "";
    /// <summary>Abstand zwischen zwei Nachfragen in Sekunden.</summary>
    public int Intervall { get; set; } = 300;

    public static string Ordner => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "VolmeThin", "Agent");

    public static string Pfad => Path.Combine(Ordner, "config.json");
    public static string CacheOrdner => Path.Combine(Ordner, "cache");
    /// <summary>Hier bleiben die Programm-EXEs dauerhaft liegen - Active Setup verweist darauf.</summary>
    public static string ProgrammOrdner => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "VolmeThin", "installiert");

    public static Einstellungen Laden()
    {
        if (!File.Exists(Pfad))
            throw new FileNotFoundException(
                $"Der Agent ist noch nicht eingerichtet ({Pfad} fehlt).\n" +
                "Einmalig ausfuehren: VolmeThinAgent.exe einrichten --server http://... --schluessel ...");

        return JsonSerializer.Deserialize(File.ReadAllText(Pfad), AgentJson.Default.Einstellungen)
               ?? throw new InvalidDataException("config.json ist unlesbar.");
    }

    public void Sichern()
    {
        Directory.CreateDirectory(Ordner);
        File.WriteAllText(Pfad, JsonSerializer.Serialize(this, AgentJson.Default.Einstellungen));
    }
}

public sealed class Auftrag
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Version { get; set; } = "";
    public string Sha256 { get; set; } = "";
    public long Groesse { get; set; }
    public string Modus { get; set; } = "Install";
}

public sealed class AuftragsAntwort
{
    public List<Auftrag> Auftraege { get; set; } = new();
}

public sealed class AnmeldeAntwort
{
    public string Id { get; set; } = "";
    public string Token { get; set; } = "";
    public string? Raum { get; set; }
}

/// <summary>Was der Agent beim Anmelden schickt.</summary>
public sealed class AnmeldeWunsch
{
    public string Schluessel { get; set; } = "";
    public string Name { get; set; } = "";
    public string Raum { get; set; } = "";
    public string Betriebssystem { get; set; } = "";
    public string AgentVersion { get; set; } = "";
}

/// <summary>Rueckmeldung nach einem Einrichtungsversuch.</summary>
public sealed class MeldungsWunsch
{
    public string ProgrammId { get; set; } = "";
    public string Version { get; set; } = "";
    public bool Ok { get; set; }
    public string? Text { get; set; }
}

[JsonSourceGenerationOptions(WriteIndented = true, PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(Einstellungen))]
[JsonSerializable(typeof(Auftrag))]
[JsonSerializable(typeof(AuftragsAntwort))]
[JsonSerializable(typeof(AnmeldeAntwort))]
[JsonSerializable(typeof(AnmeldeWunsch))]
[JsonSerializable(typeof(MeldungsWunsch))]
[JsonSerializable(typeof(Dictionary<string, string>))]
[JsonSerializable(typeof(Dictionary<string, object>))]
public partial class AgentJson : JsonSerializerContext { }
