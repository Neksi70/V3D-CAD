using System.Text.Json;
using System.Text.Json.Serialization;

namespace VolmeThin.Server;

/// <summary>Ein einsatzbereites Programm im Katalog.</summary>
public sealed class Programm
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Version { get; set; } = "1.0.0";
    public string? Hersteller { get; set; }
    public string? Notiz { get; set; }
    /// <summary>Dateiname im Paketordner.</summary>
    public string Datei { get; set; } = "";
    public long Groesse { get; set; }
    public string Sha256 { get; set; } = "";
    public DateTime Hochgeladen { get; set; } = DateTime.Now;
    /// <summary>Modus aus dem Paket: Install oder Portable.</summary>
    public string Modus { get; set; } = "Install";
    public int Dateien { get; set; }
}

public sealed class Rechner
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Raum { get; set; } = "Ohne Raum";
    public string Token { get; set; } = "";
    public string? Ip { get; set; }
    public string? Betriebssystem { get; set; }
    public string? AgentVersion { get; set; }
    public DateTime? LetzteMeldung { get; set; }
    /// <summary>Programm-Id -> installierte Version.</summary>
    public Dictionary<string, string> Installiert { get; set; } = new();
    /// <summary>Programm-Id -> letzte Fehlermeldung.</summary>
    public Dictionary<string, string> Fehler { get; set; } = new();
}

/// <summary>Wer bekommt was. Zuweisung geht pro Raum oder pro einzelnem Rechner.</summary>
public sealed class Zuweisung
{
    public Dictionary<string, List<string>> ProRaum { get; set; } = new();
    public Dictionary<string, List<string>> ProRechner { get; set; } = new();
}

public sealed class Datenbestand
{
    public List<Programm> Programme { get; set; } = new();
    public List<Rechner> Rechner { get; set; } = new();
    public Zuweisung Zuweisung { get; set; } = new();
}

[JsonSourceGenerationOptions(WriteIndented = true, PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(Datenbestand))]
[JsonSerializable(typeof(Programm))]
[JsonSerializable(typeof(Rechner))]
[JsonSerializable(typeof(List<Programm>))]
[JsonSerializable(typeof(List<Rechner>))]
[JsonSerializable(typeof(Zuweisung))]
public partial class DatenJson : JsonSerializerContext { }
