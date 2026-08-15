using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Hosting.WindowsServices;
using VolmeThin.Core;
using VolmeThin.Server;

var exeOrdner = AppContext.BaseDirectory;
var cfg = Konfiguration.LadenOderAnlegen(Path.Combine(exeOrdner, "config.json"));
var speicher = new Speicher(cfg.Datenverzeichnis);

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = WindowsServiceHelpers.IsWindowsService() ? exeOrdner : default
});
builder.Host.UseWindowsService(o => o.ServiceName = "VolmeThin Verteilserver");
builder.WebHost.UseKestrel(k => k.Limits.MaxRequestBodySize = 8L * 1024 * 1024 * 1024);
builder.WebHost.UseUrls($"http://0.0.0.0:{cfg.Port}");
builder.Services.Configure<FormOptions>(o => o.MultipartBodyLengthLimit = 8L * 1024 * 1024 * 1024);

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();

// ---------------------------------------------------------------- Zugang

static bool Gleich(string? a, string b) =>
    a is not null &&
    CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));

bool IstAdmin(HttpContext c) =>
    Gleich(c.Request.Headers["X-VT-Admin"], cfg.AdminSchluessel) ||
    Gleich(c.Request.Cookies["vt_admin"], cfg.AdminSchluessel);

Rechner? AgentVon(HttpContext c)
{
    var token = c.Request.Headers["X-VT-Token"].ToString();
    if (token.Length == 0) return null;
    return speicher.Daten.Rechner.FirstOrDefault(r => Gleich(token, r.Token));
}

IResult NurAdmin() => Results.Json(new { fehler = "Nicht angemeldet." }, statusCode: 401);

app.MapPost("/api/anmelden", async (HttpContext c) =>
{
    var body = await c.Request.ReadFromJsonAsync<Dictionary<string, string>>() ?? new();
    if (!Gleich(body.GetValueOrDefault("schluessel"), cfg.AdminSchluessel))
        return Results.Json(new { fehler = "Schluessel stimmt nicht." }, statusCode: 401);

    c.Response.Cookies.Append("vt_admin", cfg.AdminSchluessel, new CookieOptions
    {
        HttpOnly = true,
        SameSite = SameSiteMode.Lax,
        Expires = DateTimeOffset.Now.AddDays(30)
    });
    return Results.Json(new { ok = true });
});

// ---------------------------------------------------------------- Katalog (Browser)

app.MapGet("/api/stand", (HttpContext c) =>
{
    if (!IstAdmin(c)) return NurAdmin();
    return Results.Json(new
    {
        programme = speicher.Daten.Programme.OrderBy(p => p.Name).ToList(),
        rechner = speicher.Daten.Rechner.OrderBy(r => r.Raum).ThenBy(r => r.Name).ToList(),
        zuweisung = speicher.Daten.Zuweisung,
        raeume = speicher.Daten.Rechner.Select(r => r.Raum).Distinct().OrderBy(x => x).ToList(),
        agentSchluessel = cfg.AgentSchluessel,
        port = cfg.Port
    });
});

app.MapPost("/api/upload", async (HttpContext c) =>
{
    if (!IstAdmin(c)) return NurAdmin();

    var datei = c.Request.Form.Files.FirstOrDefault();
    if (datei is null || datei.Length == 0) return Results.BadRequest(new { fehler = "Keine Datei." });
    if (!datei.FileName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
        return Results.BadRequest(new { fehler = "Nur fertige .exe-Dateien aus VolmeThin." });

    var tmp = Path.Combine(speicher.PaketOrdner, Guid.NewGuid().ToString("N") + ".upload");
    await using (var fs = File.Create(tmp)) await datei.CopyToAsync(fs);

    // Nur uebernehmen, was auch wirklich ein VolmeThin-Paket traegt.
    PackageManifest m;
    try
    {
        using var reader = PackageReader.FromSelfExtracting(tmp)
            ?? throw new InvalidDataException("An dieser EXE haengt kein VolmeThin-Paket.");
        m = reader.Manifest;
    }
    catch (Exception e)
    {
        File.Delete(tmp);
        return Results.BadRequest(new { fehler = e.Message });
    }

    // Dateiname aus Kennung und Version, nicht aus dem Upload-Namen: sonst bleibt bei jeder
    // neuen Fassung die alte Datei als Waise liegen. Beides kommt aus dem hochgeladenen
    // Manifest und wird darum entschaerft - ein Paket soll nicht aus dem Ordner ausbrechen.
    var dateiname = $"{Dateiname(m.Id)}-{Dateiname(m.Version)}.exe";
    var ziel = Path.Combine(speicher.PaketOrdner, dateiname);
    File.Move(tmp, ziel, true);

    var eintrag = new Programm
    {
        Id = m.Id,
        Name = m.Name.Length > 0 ? m.Name : m.Id,
        Version = m.Version,
        Hersteller = m.Publisher,
        Notiz = m.Notes,
        Datei = dateiname,
        Groesse = new FileInfo(ziel).Length,
        Sha256 = Speicher.Sha256Datei(ziel),
        Modus = m.Mode.ToString(),
        Dateien = m.Files.Count,
        Hochgeladen = DateTime.Now
    };

    var alt = speicher.Sperre(() =>
    {
        var vorher = speicher.Daten.Programme
            .FirstOrDefault(p => string.Equals(p.Id, eintrag.Id, StringComparison.OrdinalIgnoreCase));
        speicher.Daten.Programme.RemoveAll(p => string.Equals(p.Id, eintrag.Id, StringComparison.OrdinalIgnoreCase));
        speicher.Daten.Programme.Add(eintrag);
        return vorher;
    });
    speicher.Sichern();

    // Vorgaengerfassung wegraeumen. Laeuft gerade ein Download darauf, bleibt sie liegen -
    // das ist unschoen, aber kein Grund, den Upload scheitern zu lassen.
    if (alt is not null && !string.Equals(alt.Datei, dateiname, StringComparison.OrdinalIgnoreCase))
    {
        try { File.Delete(Path.Combine(speicher.PaketOrdner, alt.Datei)); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    return Results.Json(eintrag);
});

app.MapDelete("/api/programm/{id}", (HttpContext c, string id) =>
{
    if (!IstAdmin(c)) return NurAdmin();

    var p = speicher.Daten.Programme.FirstOrDefault(x => x.Id == id);
    if (p is null) return Results.NotFound();

    speicher.Sperre(() =>
    {
        speicher.Daten.Programme.Remove(p);
        foreach (var liste in speicher.Daten.Zuweisung.ProRaum.Values) liste.Remove(id);
        foreach (var liste in speicher.Daten.Zuweisung.ProRechner.Values) liste.Remove(id);
        return 0;
    });
    speicher.Sichern();

    try { File.Delete(Path.Combine(speicher.PaketOrdner, p.Datei)); } catch { }
    return Results.Json(new { ok = true });
});

app.MapPost("/api/zuweisung", async (HttpContext c) =>
{
    if (!IstAdmin(c)) return NurAdmin();

    var body = await c.Request.ReadFromJsonAsync<ZuweisungsWunsch>();
    if (body is null) return Results.BadRequest();

    speicher.Sperre(() =>
    {
        var ziel = body.Art == "rechner" ? speicher.Daten.Zuweisung.ProRechner : speicher.Daten.Zuweisung.ProRaum;
        if (body.Programme.Count == 0) ziel.Remove(body.Schluessel);
        else ziel[body.Schluessel] = body.Programme;
        return 0;
    });
    speicher.Sichern();
    return Results.Json(new { ok = true });
});

app.MapPost("/api/rechner/{id}", async (HttpContext c, string id) =>
{
    if (!IstAdmin(c)) return NurAdmin();

    var r = speicher.Daten.Rechner.FirstOrDefault(x => x.Id == id);
    if (r is null) return Results.NotFound();

    var body = await c.Request.ReadFromJsonAsync<Dictionary<string, string>>() ?? new();
    if (body.TryGetValue("name", out var name) && name.Length > 0) r.Name = name;
    if (body.TryGetValue("raum", out var raum) && raum.Length > 0) r.Raum = raum;
    speicher.Sichern();
    return Results.Json(r);
});

app.MapDelete("/api/rechner/{id}", (HttpContext c, string id) =>
{
    if (!IstAdmin(c)) return NurAdmin();

    speicher.Sperre(() =>
    {
        speicher.Daten.Rechner.RemoveAll(x => x.Id == id);
        speicher.Daten.Zuweisung.ProRechner.Remove(id);
        return 0;
    });
    speicher.Sichern();
    return Results.Json(new { ok = true });
});

// ---------------------------------------------------------------- Agenten

app.MapPost("/api/agent/anmelden", async (HttpContext c) =>
{
    var body = await c.Request.ReadFromJsonAsync<AnmeldeWunsch>();
    if (body is null || !Gleich(body.Schluessel, cfg.AgentSchluessel))
        return Results.Json(new { fehler = "Schluessel stimmt nicht." }, statusCode: 401);

    var name = body.Name.Trim();
    if (name.Length == 0) return Results.BadRequest(new { fehler = "Rechnername fehlt." });

    var r = speicher.Sperre(() =>
    {
        // Meldet sich derselbe Rechner erneut (Neuinstallation des Agenten), bleibt sein Eintrag bestehen.
        var vorhanden = speicher.Daten.Rechner.FirstOrDefault(
            x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));
        if (vorhanden is not null) return vorhanden;

        var neu = new Rechner
        {
            Id = Guid.NewGuid().ToString("N")[..12],
            Name = name,
            Raum = body.Raum is { Length: > 0 } ? body.Raum : "Ohne Raum",
            Token = Speicher.NeuerSchluessel()
        };
        speicher.Daten.Rechner.Add(neu);
        return neu;
    });

    r.Betriebssystem = body.Betriebssystem;
    r.AgentVersion = body.AgentVersion;
    r.Ip = c.Connection.RemoteIpAddress?.ToString();
    r.LetzteMeldung = DateTime.Now;
    if (body.Raum is { Length: > 0 } && r.Raum == "Ohne Raum") r.Raum = body.Raum;
    speicher.Sichern();

    return Results.Json(new { id = r.Id, token = r.Token, raum = r.Raum });
});

app.MapGet("/api/agent/auftraege", (HttpContext c) =>
{
    var r = AgentVon(c);
    if (r is null) return Results.Json(new { fehler = "Unbekannter Agent." }, statusCode: 401);

    r.LetzteMeldung = DateTime.Now;
    r.Ip = c.Connection.RemoteIpAddress?.ToString();

    var offen = speicher.SollFuer(r)
        .Where(p => !r.Installiert.TryGetValue(p.Id, out var v) || v != p.Version)
        .Select(p => new { p.Id, p.Name, p.Version, p.Sha256, p.Groesse, p.Modus })
        .ToList();

    speicher.Sichern();
    return Results.Json(new { auftraege = offen });
});

app.MapGet("/api/agent/paket/{id}", (HttpContext c, string id) =>
{
    var r = AgentVon(c);
    if (r is null) return Results.Json(new { fehler = "Unbekannter Agent." }, statusCode: 401);

    var p = speicher.Daten.Programme.FirstOrDefault(x => x.Id == id);
    if (p is null) return Results.NotFound();

    var pfad = Path.Combine(speicher.PaketOrdner, p.Datei);
    if (!File.Exists(pfad)) return Results.NotFound();

    // Wiederaufnahme erlauben: 200-MB-Pakete ueber WLAN reissen sonst staendig ab.
    return Results.File(pfad, "application/octet-stream", p.Datei, enableRangeProcessing: true);
});

app.MapPost("/api/agent/meldung", async (HttpContext c) =>
{
    var r = AgentVon(c);
    if (r is null) return Results.Json(new { fehler = "Unbekannter Agent." }, statusCode: 401);

    var body = await c.Request.ReadFromJsonAsync<Meldung>();
    if (body is null) return Results.BadRequest();

    r.LetzteMeldung = DateTime.Now;
    if (body.Ok)
    {
        r.Installiert[body.ProgrammId] = body.Version;
        r.Fehler.Remove(body.ProgrammId);
    }
    else
    {
        r.Fehler[body.ProgrammId] = body.Text ?? "unbekannter Fehler";
    }
    speicher.Sichern();
    return Results.Json(new { ok = true });
});

// ---------------------------------------------------------------- Start

if (!WindowsServiceHelpers.IsWindowsService())
{
    Console.WriteLine($"VolmeThin Verteilserver auf http://localhost:{cfg.Port}");
    Console.WriteLine($"  Adminschluessel : {cfg.AdminSchluessel}");
    Console.WriteLine($"  Agentschluessel : {cfg.AgentSchluessel}");
    Console.WriteLine($"  Daten           : {speicher.Wurzel}");
}
app.Run();

/// <summary>Macht aus Kennung oder Version einen unbedenklichen Dateinamensteil.</summary>
static string Dateiname(string roh)
{
    var schlecht = Path.GetInvalidFileNameChars();
    var sauber = new string(roh.Select(c => schlecht.Contains(c) || c is '.' or ' ' ? '_' : c).ToArray()).Trim('_');
    return sauber.Length == 0 ? "paket" : sauber;
}

internal sealed class ZuweisungsWunsch
{
    /// <summary>"raum" oder "rechner".</summary>
    public string Art { get; set; } = "raum";
    public string Schluessel { get; set; } = "";
    public List<string> Programme { get; set; } = new();
}

internal sealed class AnmeldeWunsch
{
    public string Schluessel { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Raum { get; set; }
    public string? Betriebssystem { get; set; }
    public string? AgentVersion { get; set; }
}

internal sealed class Meldung
{
    public string ProgrammId { get; set; } = "";
    public string Version { get; set; } = "";
    public bool Ok { get; set; }
    public string? Text { get; set; }
}
