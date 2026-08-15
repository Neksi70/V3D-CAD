using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using VolmeThin.Agent;

const string DienstName = "VolmeThinAgent";
const string AgentVersion = "1.0.0";

if (args.Length > 0)
{
    switch (args[0].ToLowerInvariant())
    {
        case "einrichten": return await Einrichten(args);
        case "entfernen": return Entfernen();
        case "jetzt": return await Jetzt();
        case "stand": return Stand();
        case "hilfe" or "-h" or "--help": Hilfe(); return 0;
    }
}

// Ohne Befehl: als Dienst laufen.
var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddHostedService<Schleife>();
builder.Services.AddWindowsService(o => o.ServiceName = DienstName);
await builder.Build().RunAsync();
return 0;

// ------------------------------------------------------------------ Befehle

async Task<int> Einrichten(string[] args)
{
    var server = Wert(args, "--server");
    var schluessel = Wert(args, "--schluessel");
    if (server is null || schluessel is null)
    {
        Console.Error.WriteLine("--server und --schluessel werden gebraucht.");
        Hilfe();
        return 1;
    }
    server = server.TrimEnd('/');

    var raum = Wert(args, "--raum") ?? "Ohne Raum";
    var intervall = int.TryParse(Wert(args, "--intervall"), out var i) ? Math.Max(30, i) : 300;
    var name = Wert(args, "--name") ?? Environment.MachineName;

    Console.WriteLine($"Meldet sich als \"{name}\" bei {server} an ...");

    using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
    var wunsch = JsonSerializer.Serialize(new AnmeldeWunsch
    {
        Schluessel = schluessel,
        Name = name,
        Raum = raum,
        Betriebssystem = Environment.OSVersion.VersionString,
        AgentVersion = AgentVersion
    }, AgentJson.Default.AnmeldeWunsch);

    using var inhalt = new StringContent(wunsch, Encoding.UTF8, "application/json");
    var antwort = await http.PostAsync($"{server}/api/agent/anmelden", inhalt);

    if (!antwort.IsSuccessStatusCode)
    {
        Console.Error.WriteLine($"Anmeldung abgelehnt ({(int)antwort.StatusCode}): {await antwort.Content.ReadAsStringAsync()}");
        return 1;
    }

    var daten = JsonSerializer.Deserialize(await antwort.Content.ReadAsStringAsync(), AgentJson.Default.AnmeldeAntwort)!;
    var cfg = new Einstellungen
    {
        Server = server, Token = daten.Token, RechnerId = daten.Id,
        Raum = daten.Raum ?? raum, Intervall = intervall
    };
    cfg.Sichern();
    Console.WriteLine($"Angemeldet. Kennung {daten.Id}, Raum \"{cfg.Raum}\".");

    // Der Dienst braucht einen festen Pfad - die EXE zieht dazu an ihren Dauerplatz um.
    Directory.CreateDirectory(Einstellungen.Ordner);
    var dauerhaft = Path.Combine(Einstellungen.Ordner, "VolmeThinAgent.exe");
    var selbst = Environment.ProcessPath!;
    if (!string.Equals(selbst, dauerhaft, StringComparison.OrdinalIgnoreCase))
    {
        try { File.Copy(selbst, dauerhaft, true); }
        catch (IOException e) { Console.Error.WriteLine($"Kopieren nach {dauerhaft} fehlgeschlagen: {e.Message}"); return 1; }
    }

    Sc("stop", DienstName, still: true);
    Sc("delete", DienstName, still: true);

    if (Sc("create", $"{DienstName} binPath= \"\\\"{dauerhaft}\\\"\" start= auto DisplayName= \"VolmeThin Agent\"") != 0)
    {
        Console.Error.WriteLine("Dienst liess sich nicht anlegen. Laeuft die Eingabeaufforderung als Administrator?");
        return 1;
    }
    Sc("description", $"{DienstName} \"Holt zugewiesene Programme vom VolmeThin-Verteilserver und richtet sie ein.\"", still: true);
    // Nach einem Fehlstart nicht aufgeben, sondern nach einer Minute erneut versuchen.
    Sc("failure", $"{DienstName} reset= 86400 actions= restart/60000/restart/60000/restart/60000", still: true);
    Sc("start", DienstName);

    Console.WriteLine("Dienst laeuft. Der Rechner erscheint jetzt in der Verteilstelle.");
    return 0;
}

int Entfernen()
{
    Sc("stop", DienstName, still: true);
    var code = Sc("delete", DienstName);
    Console.WriteLine(code == 0 ? "Dienst entfernt." : "Dienst war nicht eingerichtet.");
    Console.WriteLine($"Einstellungen und Zwischenspeicher bleiben unter {Einstellungen.Ordner} liegen.");
    return 0;
}

async Task<int> Jetzt()
{
    var cfg = Einstellungen.Laden();
    var verteiler = new Verteiler(cfg, Console.WriteLine);
    var fertig = await verteiler.DurchlaufAsync(CancellationToken.None);
    Console.WriteLine(fertig == 0 ? "Nichts zu tun." : $"{fertig} Programm(e) eingerichtet.");
    return 0;
}

int Stand()
{
    try
    {
        var cfg = Einstellungen.Laden();
        Console.WriteLine($"Server    : {cfg.Server}");
        Console.WriteLine($"Kennung   : {cfg.RechnerId}");
        Console.WriteLine($"Raum      : {cfg.Raum}");
        Console.WriteLine($"Intervall : {cfg.Intervall} s");
        Console.WriteLine($"Protokoll : {Path.Combine(Einstellungen.Ordner, "agent.log")}");
        return 0;
    }
    catch (Exception e) { Console.Error.WriteLine(e.Message); return 1; }
}

void Hilfe() => Console.WriteLine("""
    VolmeThin Agent - holt zugewiesene Programme vom Verteilserver

      VolmeThinAgent.exe einrichten --server http://vhs-server:8790 --schluessel ABC
                                    [--raum "Kursraum 1"] [--name PC-01] [--intervall 300]
      VolmeThinAgent.exe jetzt        einmal sofort nachfragen (zum Ausprobieren)
      VolmeThinAgent.exe stand        Einstellungen anzeigen
      VolmeThinAgent.exe entfernen    Dienst wieder abmelden

    Einrichten und Entfernen brauchen eine Eingabeaufforderung als Administrator.
    """);

static string? Wert(string[] args, string name)
{
    for (int i = 0; i < args.Length - 1; i++)
        if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
    return null;
}

static int Sc(string befehl, string rest, bool still = false)
{
    var psi = new ProcessStartInfo("sc.exe", $"{befehl} {rest}")
    {
        UseShellExecute = false, CreateNoWindow = true,
        RedirectStandardOutput = true, RedirectStandardError = true
    };
    using var p = Process.Start(psi);
    if (p is null) return -1;
    var ausgabe = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
    p.WaitForExit();
    if (!still && p.ExitCode != 0) Console.Error.WriteLine(ausgabe.Trim());
    return p.ExitCode;
}

/// <summary>Der Dienst selbst: fragt in festem Abstand nach.</summary>
internal sealed class Schleife : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        Einstellungen cfg;
        try { cfg = Einstellungen.Laden(); }
        catch (Exception e) { Protokoll(e.Message); return; }

        var verteiler = new Verteiler(cfg, Protokoll);
        Protokoll($"Agent gestartet, fragt alle {cfg.Intervall} s bei {cfg.Server} nach.");

        while (!ct.IsCancellationRequested)
        {
            try { await verteiler.DurchlaufAsync(ct); }
            catch (OperationCanceledException) { break; }
            catch (Exception e) { Protokoll("Durchlauf fehlgeschlagen: " + e); }

            try { await Task.Delay(TimeSpan.FromSeconds(cfg.Intervall), ct); }
            catch (OperationCanceledException) { break; }
        }
        Protokoll("Agent beendet.");
    }

    private static readonly object Sperre = new();

    private static void Protokoll(string text)
    {
        var zeile = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss}  {text}";
        Console.WriteLine(zeile);
        try
        {
            Directory.CreateDirectory(Einstellungen.Ordner);
            var datei = Path.Combine(Einstellungen.Ordner, "agent.log");
            lock (Sperre)
            {
                // Protokoll begrenzen, damit es auf Kurs-PCs nicht endlos waechst.
                if (File.Exists(datei) && new FileInfo(datei).Length > 2 * 1024 * 1024)
                    File.Move(datei, datei + ".alt", true);
                File.AppendAllText(datei, zeile + Environment.NewLine);
            }
        }
        catch { }
    }
}
