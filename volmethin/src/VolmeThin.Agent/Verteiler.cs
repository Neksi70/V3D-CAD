using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Security.Cryptography;
using System.Text.Json;

namespace VolmeThin.Agent;

/// <summary>Fragt den Server nach Auftraegen, holt die Pakete und richtet sie ein.</summary>
public sealed class Verteiler
{
    private readonly Einstellungen _cfg;
    private readonly HttpClient _http;
    private readonly Action<string> _log;

    public Verteiler(Einstellungen cfg, Action<string> log)
    {
        _cfg = cfg;
        _log = log;
        _http = new HttpClient { BaseAddress = new Uri(cfg.Server), Timeout = TimeSpan.FromMinutes(30) };
        _http.DefaultRequestHeaders.Add("X-VT-Token", cfg.Token);
    }

    public async Task<int> DurchlaufAsync(CancellationToken ct)
    {
        AuftragsAntwort? antwort;
        try
        {
            var json = await _http.GetStringAsync("/api/agent/auftraege", ct);
            antwort = JsonSerializer.Deserialize(json, AgentJson.Default.AuftragsAntwort);
        }
        catch (Exception e)
        {
            _log($"Server nicht erreichbar: {e.Message}");
            return 0;
        }

        var offen = antwort?.Auftraege ?? new List<Auftrag>();
        if (offen.Count == 0) return 0;

        _log($"{offen.Count} Auftrag/Auftraege offen.");
        int fertig = 0;

        foreach (var a in offen)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                await VerarbeiteAsync(a, ct);
                await MeldeAsync(a, true, null, ct);
                fertig++;
                _log($"{a.Name} {a.Version} eingerichtet.");
            }
            catch (Exception e)
            {
                _log($"{a.Name} fehlgeschlagen: {e.Message}");
                await MeldeAsync(a, false, e.Message, ct);
            }
        }
        return fertig;
    }

    private async Task VerarbeiteAsync(Auftrag a, CancellationToken ct)
    {
        Directory.CreateDirectory(Einstellungen.CacheOrdner);
        Directory.CreateDirectory(Einstellungen.ProgrammOrdner);

        var ziel = Path.Combine(Einstellungen.CacheOrdner, $"{Sauber(a.Id)}-{Sauber(a.Version)}.exe");

        if (!File.Exists(ziel) || !PruefeHash(ziel, a.Sha256))
        {
            await LadeAsync(a, ziel, ct);
            if (!PruefeHash(ziel, a.Sha256))
            {
                File.Delete(ziel);
                throw new InvalidDataException("Pruefsumme stimmt nicht - Download war unvollstaendig.");
            }
        }

        // Die EXE muss dauerhaft liegen bleiben: Active Setup zieht den Benutzerteil
        // spaeter ueber genau diesen Pfad nach.
        var dauerhaft = Path.Combine(Einstellungen.ProgrammOrdner, Sauber(a.Id) + ".exe");
        File.Copy(ziel, dauerhaft, overwrite: true);

        var psi = new ProcessStartInfo(dauerhaft, "--vt-einrichten")
        {
            UseShellExecute = false,
            CreateNoWindow = true
        };
        using var p = Process.Start(psi) ?? throw new InvalidOperationException("Paket liess sich nicht starten.");

        using var frist = CancellationTokenSource.CreateLinkedTokenSource(ct);
        frist.CancelAfter(TimeSpan.FromMinutes(30));
        try { await p.WaitForExitAsync(frist.Token); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            try { p.Kill(true); } catch { }
            throw new TimeoutException("Einrichtung hat laenger als 30 Minuten gebraucht und wurde abgebrochen.");
        }

        if (p.ExitCode != 0)
            throw new InvalidOperationException($"Einrichtung endete mit Code {p.ExitCode}.");
    }

    /// <summary>Laedt das Paket. Abgebrochene Downloads werden fortgesetzt, nicht neu begonnen.</summary>
    private async Task LadeAsync(Auftrag a, string ziel, CancellationToken ct)
    {
        var teil = ziel + ".teil";
        long vorhanden = File.Exists(teil) ? new FileInfo(teil).Length : 0;
        if (vorhanden > a.Groesse) { File.Delete(teil); vorhanden = 0; }

        var anfrage = new HttpRequestMessage(HttpMethod.Get, $"/api/agent/paket/{a.Id}");
        if (vorhanden > 0)
        {
            anfrage.Headers.Range = new RangeHeaderValue(vorhanden, null);
            _log($"{a.Name}: Download wird ab {vorhanden / 1024 / 1024} MB fortgesetzt.");
        }
        else _log($"{a.Name} {a.Version} wird geladen ({a.Groesse / 1024 / 1024} MB) ...");

        using var antwort = await _http.SendAsync(anfrage, HttpCompletionOption.ResponseHeadersRead, ct);
        antwort.EnsureSuccessStatusCode();

        bool anhaengen = antwort.StatusCode == System.Net.HttpStatusCode.PartialContent;
        await using (var quelle = await antwort.Content.ReadAsStreamAsync(ct))
        await using (var datei = new FileStream(teil, anhaengen ? FileMode.Append : FileMode.Create,
                                                FileAccess.Write, FileShare.None, 1 << 16))
        {
            await quelle.CopyToAsync(datei, ct);
        }

        File.Move(teil, ziel, overwrite: true);
    }

    private async Task MeldeAsync(Auftrag a, bool ok, string? text, CancellationToken ct)
    {
        try
        {
            var json = JsonSerializer.Serialize(
                new MeldungsWunsch { ProgrammId = a.Id, Version = a.Version, Ok = ok, Text = text },
                AgentJson.Default.MeldungsWunsch);
            using var inhalt = new StringContent(json, Encoding.UTF8, "application/json");
            await _http.PostAsync("/api/agent/meldung", inhalt, ct);
        }
        catch (Exception e) { _log($"Rueckmeldung fehlgeschlagen: {e.Message}"); }
    }

    private static bool PruefeHash(string pfad, string erwartet)
    {
        if (erwartet.Length == 0) return true;
        try
        {
            using var sha = SHA256.Create();
            using var fs = File.OpenRead(pfad);
            return string.Equals(Convert.ToHexString(sha.ComputeHash(fs)), erwartet, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    private static string Sauber(string s)
    {
        var bad = Path.GetInvalidFileNameChars();
        return new string(s.Select(c => bad.Contains(c) ? '_' : c).ToArray());
    }
}
