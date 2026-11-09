using System.Text.Json;

namespace WaSidebar;

public class ServiceDef
{
    public string Id { get; set; }
    public string Name { get; set; }
    public string Url { get; set; }
    public string Letter { get; set; }
    public string Color { get; set; } = "#25D366";
    public string Group { get; set; }      // "v3d" = V3D Tool (eckiges Icon, lädt erst beim ersten Klick)
    public string Profile { get; set; }
    public bool? Wide { get; set; }        // Vollbild: Dienst füllt beim Öffnen den ganzen Bildschirm    // gemeinsamer Profilordner; leer = eigener Ordner je Dienst
    public string ProfileDir => Path.Combine(AppSettings.BaseDir, "profiles", string.IsNullOrEmpty(Profile) ? Id : Profile);
}

public class AppSettings
{
    public string Dock { get; set; } = "right";          // "right" | "left"
    public int PanelWidth { get; set; } = 440;           // Breite der offenen Leiste (logische Pixel)
    public bool Pinned { get; set; } = false;            // Platz am Bildschirmrand fuer offene Leiste reservieren
    public bool AutoCollapse { get; set; } = true;       // nicht angeheftet: beim Wegklicken einklappen
    public bool Notifications { get; set; } = true;
    public bool RememberPins { get; set; } = true;     // PINs der V3D Tools merken + eintragen
    public string ScreenDevice { get; set; } = "";       // leer = Hauptbildschirm
    public string ActiveId { get; set; } = "privat";
    public List<ServiceDef> Services { get; set; } = new();

    /// CAD-artige Tools brauchen Platz: standardmäßig Vollbild.
    public static bool DefaultWide(ServiceDef x) =>
        x.Group == "v3d" && System.Text.RegularExpressions.Regex.IsMatch(x.Name ?? "", @"\bCAD\b|\bCAM\b|Kids|Slicer");

    public static string BaseDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WaSidebar");
    static string FilePath => Path.Combine(BaseDir, "settings.json");
    static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    public static AppSettings Load()
    {
        AppSettings s = null;
        try { if (File.Exists(FilePath)) s = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath)); }
        catch { }
        s ??= new AppSettings();
        if (s.Services == null || s.Services.Count == 0)
        {
            s.Services = new List<ServiceDef>
            {
                new() { Id = "privat",   Name = "WhatsApp (privat)", Url = "https://web.whatsapp.com/", Letter = "P", Color = "#25D366" },
                new() { Id = "business", Name = "WhatsApp Business", Url = "https://web.whatsapp.com/", Letter = "B", Color = "#128C7E" },
            };
        }
        s.PanelWidth = Math.Clamp(s.PanelWidth, 300, 1400);
        foreach (var x in s.Services) x.Wide ??= DefaultWide(x);
        return s;
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(BaseDir);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this, Json));
        }
        catch { }
    }
}
