using System.Security.Cryptography;
using System.Text.Json;

namespace VolmeThin.Server;

/// <summary>
/// Haelt Katalog, Rechnerliste und Zuweisungen. Bewusst nur JSON-Dateien:
/// bei einer Handvoll Kursraeumen ist eine Datenbank mehr Pflege als Nutzen.
/// </summary>
public sealed class Speicher
{
    private readonly object _sperre = new();
    private readonly string _datenDatei;

    public string Wurzel { get; }
    public string PaketOrdner { get; }
    public Datenbestand Daten { get; private set; } = new();

    public Speicher(string wurzel)
    {
        Wurzel = wurzel;
        PaketOrdner = Path.Combine(wurzel, "pakete");
        _datenDatei = Path.Combine(wurzel, "daten.json");
        Directory.CreateDirectory(PaketOrdner);
        Laden();
    }

    private void Laden()
    {
        if (!File.Exists(_datenDatei)) return;
        try
        {
            var json = File.ReadAllText(_datenDatei);
            Daten = JsonSerializer.Deserialize(json, DatenJson.Default.Datenbestand) ?? new Datenbestand();
        }
        catch (Exception e)
        {
            // Lieber mit leerem Bestand starten als gar nicht - die kaputte Datei bleibt zur Ansicht liegen.
            var kaputt = _datenDatei + ".kaputt";
            try { File.Move(_datenDatei, kaputt, true); } catch { }
            Console.Error.WriteLine($"daten.json unlesbar ({e.Message}), umbenannt nach {kaputt}");
            Daten = new Datenbestand();
        }
    }

    public void Sichern()
    {
        lock (_sperre)
        {
            var json = JsonSerializer.Serialize(Daten, DatenJson.Default.Datenbestand);
            var tmp = _datenDatei + ".tmp";
            File.WriteAllText(tmp, json);
            File.Move(tmp, _datenDatei, true);   // atomar, damit ein Absturz nichts zerreisst
        }
    }

    public T Sperre<T>(Func<T> arbeit)
    {
        lock (_sperre) return arbeit();
    }

    /// <summary>Programme, die dieser Rechner haben soll: Raumzuweisung plus eigene.</summary>
    public List<Programm> SollFuer(Rechner r)
    {
        var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (Daten.Zuweisung.ProRaum.TryGetValue(r.Raum, out var proRaum)) ids.UnionWith(proRaum);
        if (Daten.Zuweisung.ProRechner.TryGetValue(r.Id, out var proRechner)) ids.UnionWith(proRechner);

        return Daten.Programme.Where(p => ids.Contains(p.Id)).ToList();
    }

    public static string NeuerSchluessel(int bytes = 24) =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(bytes))
               .Replace('+', '-').Replace('/', '_').TrimEnd('=');

    public static string Sha256Datei(string pfad)
    {
        using var sha = SHA256.Create();
        using var fs = File.OpenRead(pfad);
        return Convert.ToHexString(sha.ComputeHash(fs));
    }
}

/// <summary>Einstellungen aus config.json neben der EXE.</summary>
public sealed class Konfiguration
{
    public int Port { get; set; } = 8790;
    public string AdminSchluessel { get; set; } = "";
    /// <summary>Den brauchen Agenten einmalig, um sich anzumelden.</summary>
    public string AgentSchluessel { get; set; } = "";
    public string Datenverzeichnis { get; set; } = "";

    public static Konfiguration LadenOderAnlegen(string pfad)
    {
        Konfiguration k;
        if (File.Exists(pfad))
        {
            k = JsonSerializer.Deserialize<Konfiguration>(File.ReadAllText(pfad),
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                ?? new Konfiguration();
        }
        else k = new Konfiguration();

        bool neu = false;
        if (k.AdminSchluessel.Length == 0) { k.AdminSchluessel = Speicher.NeuerSchluessel(); neu = true; }
        if (k.AgentSchluessel.Length == 0) { k.AgentSchluessel = Speicher.NeuerSchluessel(12); neu = true; }
        if (k.Datenverzeichnis.Length == 0)
        {
            k.Datenverzeichnis = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "VolmeThin", "Server");
            neu = true;
        }

        if (neu)
        {
            File.WriteAllText(pfad, JsonSerializer.Serialize(k, new JsonSerializerOptions { WriteIndented = true }));
        }
        return k;
    }
}
