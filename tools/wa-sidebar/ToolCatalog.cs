using System.Net;
using System.Text.RegularExpressions;

namespace WaSidebar;

public record CatalogItem(string Category, string Name, string Url);

/// Liste der V3D Tools. Wird live von der Tools-Seite gelesen (neue Tools erscheinen
/// automatisch); ist die Seite nicht erreichbar, gilt die eingebaute Liste.
static class ToolCatalog
{
    public const string PageUrl = "https://v3da.tailf05fe9.ts.net/tools/";

    public static async Task<(List<CatalogItem> Items, bool Online)> LoadAsync()
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(8) };
            string html = await http.GetStringAsync(PageUrl);
            var items = Parse(html);
            if (items.Count >= 5) return (items, true);
        }
        catch { }
        return (BuiltIn(), false);
    }

    static List<CatalogItem> Parse(string html)
    {
        var list = new List<CatalogItem>();
        string cat = "V3D Tools";
        var rx = new Regex(@"<h2[^>]*>(?<h>.*?)</h2>|<a\b[^>]*href\s*=\s*""(?<u>[^""]+)""[^>]*>(?<t>.*?)</a>",
            RegexOptions.IgnoreCase | RegexOptions.Singleline);
        foreach (Match m in rx.Matches(html))
        {
            if (m.Groups["h"].Success) { cat = Clean(m.Groups["h"].Value); continue; }
            string url = WebUtility.HtmlDecode(m.Groups["u"].Value.Trim());
            string name = Clean(m.Groups["t"].Value);
            if (!url.StartsWith("http", StringComparison.OrdinalIgnoreCase) || name.Length == 0) continue;
            if (list.Any(x => x.Url == url)) continue;
            list.Add(new CatalogItem(cat, name, url));
        }
        return list;
    }

    static string Clean(string s) =>
        WebUtility.HtmlDecode(Regex.Replace(s, "<[^>]+>", "")).Trim();

    static List<CatalogItem> BuiltIn()
    {
        const string B = "https://v3da.tailf05fe9.ts.net";
        var l = new List<CatalogItem>();
        void Add(string c, string n, string u) => l.Add(new CatalogItem(c, n, u));
        string c1 = "CAD & 3D-Druck", c2 = "Büro & Geschäft", c3 = "Dateien & Server", c4 = "Familie & Alltag", c5 = "Spiele & Quiz";
        Add(c1, "V3D CAD", "https://v3dcad.volme3dakademie.de");
        Add(c1, "V3D CAD auf V3DA", B + "/");
        Add(c1, "V3D Kids", "https://v3dcad.volme3dakademie.de/kids");
        Add(c1, "V3D CAM", "https://v3dcad.volme3dakademie.de/cam/");
        Add(c1, "V3D Slicer", B + "/slicer");
        Add(c1, "V3D Druckcheck", B + "/druckcheck");
        Add(c1, "V3D Schichthöhe", B + "/schichten");
        Add(c1, "V3D Kristall", B + "/kristall");
        Add(c1, "VolmeCut (Plotten)", B + "/plotten");
        Add(c1, "V3D Typenschild", B + "/typenschild");
        Add(c1, "CAD-Agent-Monitor", B + "/cad-agent/");
        Add(c2, "V3D Mail", B + "/mail");
        Add(c2, "VolmeRechnung", B + "/rechnung");
        Add(c2, "V3D Beleg", B + "/beleg");
        Add(c2, "VolmeShop (Bestellen)", B + "/bestellen");
        Add(c2, "V3D Kurse", "https://kurse.volme3dakademie.de");
        Add(c2, "Gutscheine", "https://gutscheine.volme3dakademie.de");
        Add(c2, "V3D Karte (Visitenkarte)", "https://karte.volme3dakademie.de");
        Add(c2, "Anrufannahme", B + "/anrufe");
        Add(c2, "V3D Todo", B + "/todo");
        Add(c2, "Terminfinder", B + "/termine");
        Add(c2, "VolmeWrite", B + "/schreiben");
        Add(c2, "V3D Transkript", B + "/transkript");
        Add(c2, "V3D Bewerbung", B + "/bewerbung/");
        Add(c2, "V3D Tafel (Kursraum)", B + "/tafel");
        Add(c2, "V3D Licht", B + "/licht");
        Add(c2, "VolmeInventar", B + "/inventar");
        Add(c3, "V3D Ablage", B + "/ablage");
        Add(c3, "Mimi share (Teilen)", B + "/teilen");
        Add(c3, "V3D SSH", B + "/ssh");
        Add(c3, "V3D Handy", B + "/handy");
        Add(c3, "MeshCentral (Fernwartung)", B + ":8443");
        Add(c4, "V3D Familie", B + "/familie");
        Add(c4, "V3D Vorrat", B + "/vorrat");
        Add(c4, "Marchi Einkauf", B + "/einkauf");
        Add(c4, "V3D Laden (E-Auto)", B + "/laden");
        Add(c4, "Fotobox-Galerie", B + "/fotos");
        Add(c5, "Fragenquiz", B + "/quiz");
        Add(c5, "Geburtstags-Quiz", B + "/geburtstag");
        Add(c5, "Blockfall", B + "/tetris");
        Add(c5, "Fass-Alarm", B + "/fassalarm");
        Add(c5, "Phoenix", B + "/phoenix");
        Add(c5, "Ballast", B + "/ballast");
        return l;
    }

    /// Kurzzeichen fürs Icon: "V3D Slicer" -> "Sl", "VolmeRechnung" -> "Re", "V3D CAD" -> "CAD".
    public static string Abbrev(string name)
    {
        string n = Regex.Replace(name, @"\(.*?\)", "").Trim();
        n = Regex.Replace(n, @"^(V3D\s+|Volme(?=[A-ZÄÖÜ]))", "");
        if (n.Length == 0) n = name;
        if (n.StartsWith("CAD", StringComparison.Ordinal)) return "CAD";
        var letters = new string(n.Where(char.IsLetterOrDigit).ToArray());
        if (letters.Length == 0) return "?";
        return letters.Length == 1 ? letters.ToUpper() : char.ToUpper(letters[0]) + letters[1..2].ToLower();
    }

    public static string ColorFor(string category) => category switch
    {
        var c when c.StartsWith("CAD") => "#2563EB",
        var c when c.StartsWith("Büro") => "#D97706",
        var c when c.StartsWith("Dateien") => "#64748B",
        var c when c.StartsWith("Familie") => "#DB2777",
        var c when c.StartsWith("Spiele") => "#7C3AED",
        _ => "#0EA5E9",
    };

    public static string IdFor(string url)
    {
        var slug = Regex.Replace(url.ToLowerInvariant().Replace("https://", "").Replace("http://", ""), "[^a-z0-9]+", "-").Trim('-');
        return "v3d-" + slug;
    }
}
