using VolmeThin.Capture;
using VolmeThin.Core;

namespace VolmeThin.Builder;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length == 0) { Usage(); return 1; }

        try
        {
            return args[0].ToLowerInvariant() switch
            {
                "vorher" or "snapshot" => CmdSnapshot(args),
                "nachher" or "diff" => CmdDiff(args),
                "bauen" or "build" => CmdBuild(args),
                "info" => CmdInfo(args),
                "hilfe" or "-h" or "--help" => Usage(),
                _ => Unknown(args[0])
            };
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"Fehler: {e.Message}");
            return 1;
        }
    }

    private static int CmdSnapshot(string[] args)
    {
        var outFile = Arg(args, "--out") ?? (args.Length > 1 && !args[1].StartsWith("--") ? args[1] : "vorher.snap");
        var opt = new CaptureOptions();
        var sw = System.Diagnostics.Stopwatch.StartNew();

        var snap = new Snapshotter(opt, s => Console.WriteLine("  " + s)).Take();
        snap.Save(outFile);

        Console.WriteLine($"Aufnahme gespeichert: {outFile} ({sw.Elapsed.TotalSeconds:F0} s)");
        Console.WriteLine("Jetzt die Anwendung installieren, danach: volmethin nachher " + outFile);
        return 0;
    }

    private static int CmdDiff(string[] args)
    {
        var beforeFile = args.Length > 1 && !args[1].StartsWith("--") ? args[1] : Arg(args, "--vorher");
        if (beforeFile is null) { Console.Error.WriteLine("Vorher-Aufnahme fehlt."); return 1; }

        var outPkg = Arg(args, "--out") ?? "paket.v3pkg";
        var name = Arg(args, "--name") ?? Path.GetFileNameWithoutExtension(outPkg);
        var id = Arg(args, "--id") ?? name.ToLowerInvariant().Replace(' ', '-');
        var version = Arg(args, "--version") ?? "1.0.0";
        var mode = (Arg(args, "--modus") ?? Arg(args, "--mode") ?? "install").ToLowerInvariant() switch
        {
            "portable" => DeployMode.Portable,
            _ => DeployMode.Install
        };

        Console.WriteLine("Vorher-Aufnahme wird geladen ...");
        var before = SystemSnapshot.Load(beforeFile);

        Console.WriteLine("Nachher-Aufnahme laeuft ...");
        var after = new Snapshotter(new CaptureOptions(), s => Console.WriteLine("  " + s)).Take();

        var diff = Differ.Diff(before, after);
        Console.WriteLine($"Unterschied: {diff.Files.Count} Dateien ({diff.TotalBytes / 1024 / 1024} MB), " +
                          $"{diff.Registry.Count} Registry-Werte");
        foreach (var (root, n) in diff.ByRoot.OrderByDescending(k => k.Value))
            Console.WriteLine($"    {root,-24} {n}");

        if (diff.Files.Count == 0)
        {
            Console.Error.WriteLine("Keine neuen Dateien gefunden - wurde zwischen den Aufnahmen wirklich installiert?");
            return 2;
        }

        var entry = Arg(args, "--start") ?? Differ.GuessEntryPoint(diff.Files);
        if (entry is null)
        {
            Console.Error.WriteLine("Keine Startdatei erkannt. Bitte mit --start \"{ProgramFiles}\\...\\app.exe\" angeben.");
            return 2;
        }
        Console.WriteLine($"Startdatei: {entry}");

        var meta = new PackageManifest
        {
            Id = id, Name = name, Version = version, Mode = mode, EntryPoint = entry,
            Publisher = Arg(args, "--hersteller"), Notes = Arg(args, "--notiz")
        };

        int lastPercent = -1;
        PackageFactory.Build(diff, meta, outPkg, (i, total, file) =>
        {
            int p = total == 0 ? 100 : i * 100 / total;
            if (p != lastPercent) { lastPercent = p; Console.Write($"\r  Paket wird geschrieben: {p} %   "); }
        });
        Console.WriteLine();
        Console.WriteLine($"Paket fertig: {outPkg} ({new FileInfo(outPkg).Length / 1024 / 1024} MB)");
        Console.WriteLine($"Weiter mit: volmethin bauen {outPkg} --out {id}.exe");
        return 0;
    }

    private static int CmdBuild(string[] args)
    {
        var pkg = args.Length > 1 && !args[1].StartsWith("--") ? args[1] : Arg(args, "--paket");
        if (pkg is null) { Console.Error.WriteLine("Paketdatei fehlt."); return 1; }

        var outExe = Arg(args, "--out") ?? Path.ChangeExtension(pkg, ".exe");
        ExeBuilder.Build(pkg, outExe, Arg(args, "--stub"), Arg(args, "--icon"), Console.WriteLine);
        return 0;
    }

    private static int CmdInfo(string[] args)
    {
        var file = args.Length > 1 ? args[1] : null;
        if (file is null) { Console.Error.WriteLine("Datei fehlt."); return 1; }

        using var reader = file.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
            ? PackageReader.FromSelfExtracting(file) ?? throw new InvalidDataException("An dieser EXE haengt kein Paket.")
            : PackageReader.Open(file);

        var m = reader.Manifest;
        Console.WriteLine($"Name       : {m.Name}");
        Console.WriteLine($"Kennung    : {m.Id}");
        Console.WriteLine($"Version    : {m.Version}");
        Console.WriteLine($"Modus      : {m.Mode}");
        Console.WriteLine($"Startdatei : {m.EntryPoint}");
        Console.WriteLine($"Dateien    : {m.Files.Count} ({m.Files.Sum(f => f.Size) / 1024 / 1024} MB entpackt)");
        Console.WriteLine($"Registry   : {m.Registry.Count} Werte");
        return 0;
    }

    private static string? Arg(string[] args, string name)
    {
        for (int i = 0; i < args.Length - 1; i++)
            if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase)) return args[i + 1];
        return null;
    }

    private static int Unknown(string cmd)
    {
        Console.Error.WriteLine($"Unbekannter Befehl: {cmd}");
        Usage();
        return 1;
    }

    private static int Usage()
    {
        Console.WriteLine("""
            VolmeThin - Anwendungen einpacken und als eine EXE ausliefern

              volmethin vorher  <vorher.snap>
                  Zustand von Dateisystem und Registry aufnehmen (vor der Installation).

              volmethin nachher <vorher.snap> --out <paket.v3pkg> [--name "..."] [--id ...]
                                [--version 1.0.0] [--modus install|portable] [--start "{ProgramFiles}\\..."]
                  Zweite Aufnahme, Vergleich und Paket schreiben (nach der Installation).

              volmethin bauen   <paket.v3pkg> --out <programm.exe> [--icon symbol.ico] [--stub pfad]
                  Aus dem Paket eine startbare Einzeldatei machen.

              volmethin info    <paket.v3pkg | programm.exe>
                  Inhalt anzeigen.
            """);
        return 0;
    }
}
