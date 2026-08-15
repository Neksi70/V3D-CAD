using System.Text;
using VolmeThin.Core;

int failed = 0, passed = 0;

void Check(string name, Func<bool> test)
{
    try
    {
        if (test()) { passed++; Console.WriteLine($"  ok    {name}"); }
        else { failed++; Console.WriteLine($"  FEHLT {name}"); }
    }
    catch (Exception e) { failed++; Console.WriteLine($"  KNALL {name}: {e.Message}"); }
}

var tmp = Path.Combine(Path.GetTempPath(), "vthin_test_" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(tmp);

// --- Pfad-Makros -------------------------------------------------------
var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
{
    ["ProgramFiles"] = @"C:\Program Files",
    ["ProgramFilesX86"] = @"C:\Program Files (x86)",
    ["LocalAppData"] = @"C:\Users\kurs\AppData\Local",
    ["AppData"] = @"C:\Users\kurs\AppData\Roaming",
    ["SystemRoot"] = @"C:\Windows",
    ["SystemDir"] = @"C:\Windows\System32"
};

Console.WriteLine("Pfad-Makros");
Check("Pack erkennt Program Files", () =>
    PathMacros.Pack(@"C:\Program Files\Firma\app.exe", map) == @"{ProgramFiles}\Firma\app.exe");

Check("Pack bevorzugt x86 vor dem kuerzeren Program Files", () =>
    PathMacros.Pack(@"C:\Program Files (x86)\Firma\app.exe", map) == @"{ProgramFilesX86}\Firma\app.exe");

Check("Pack bevorzugt LocalAppData vor AppData-Praefix", () =>
    PathMacros.Pack(@"C:\Users\kurs\AppData\Local\Firma\x.dll", map) == @"{LocalAppData}\Firma\x.dll");

Check("Pack trennt an Verzeichnisgrenze, nicht mitten im Namen", () =>
    PathMacros.Pack(@"C:\Program Files Alt\x.exe", map) == @"C:\Program Files Alt\x.exe");

Check("Pack laesst System32 vor Windows gewinnen", () =>
    PathMacros.Pack(@"C:\Windows\System32\msvcp.dll", map) == @"{SystemDir}\msvcp.dll");

Check("Expand ist die Umkehrung von Pack", () =>
    PathMacros.Expand(PathMacros.Pack(@"C:\Program Files\Firma\app.exe", map), map) == @"C:\Program Files\Firma\app.exe");

Check("Expand laesst unbekannte Makros stehen", () =>
    PathMacros.Expand(@"{GibtsNicht}\x", map) == @"{GibtsNicht}\x");

Check("Expand kennt Zusatzmakros", () =>
    PathMacros.Expand(@"{PkgRoot}\a.exe", map, new() { ["PkgRoot"] = @"C:\cache" }) == @"C:\cache\a.exe");

Check("ToVfs baut den Cache-Pfad", () =>
    PathMacros.ToVfs(@"{ProgramFiles}\Firma\app.exe", @"C:\cache")
        .Replace('/', '\\') == @"C:\cache\vfs\ProgramFiles\Firma\app.exe");

Check("ToVfs faengt Pfade ohne Makro ab", () =>
    PathMacros.ToVfs(@"D:\Tools\x.exe", @"C:\cache").Replace('/', '\\') == @"C:\cache\vfs\_abs\D\Tools\x.exe");

// --- Paket schreiben und lesen ----------------------------------------
Console.WriteLine("Paket");
var fileA = Path.Combine(tmp, "a.bin");
var fileB = Path.Combine(tmp, "b.bin");
var fileC = Path.Combine(tmp, "c.bin");
File.WriteAllText(fileA, "Inhalt A");
File.WriteAllText(fileB, "Inhalt B");
File.WriteAllText(fileC, "Inhalt A");            // inhaltsgleich zu A

var pkgPath = Path.Combine(tmp, "test.v3pkg");
PackagedFile pa, pb, pc;
var manifest = new PackageManifest
{
    Id = "test", Name = "Testpaket", Version = "1.2.3",
    EntryPoint = @"{ProgramFiles}\Test\a.exe", Mode = DeployMode.Portable,
    Registry = { new RegistryEntry { Root = "HKLM", Key = @"Software\Test", Name = "Pfad", Kind = RegKind.String, Value = @"C:\x" },
                 new RegistryEntry { Root = "HKCU", Key = @"Software\Test", Name = "Zahl", Kind = RegKind.Dword, Value = "42" } }
};

using (var w = new PackageWriter(pkgPath))
{
    pa = w.AddFile(fileA, @"{ProgramFiles}\Test\a.exe");
    pb = w.AddFile(fileB, @"{ProgramFiles}\Test\b.dll");
    pc = w.AddFile(fileC, @"{AppData}\Test\c.dat");
    manifest.Files.AddRange(new[] { pa, pb, pc });
    w.Finish(manifest);
}

Check("Paketdatei entstanden", () => File.Exists(pkgPath) && new FileInfo(pkgPath).Length > 0);
Check("Gleiche Inhalte werden nur einmal gespeichert", () => pa.Src == pc.Src && pa.Src != pb.Src);
Check("Groesse und Hash sind gefuellt", () => pa.Size == 8 && pa.Sha256 is { Length: 64 });

using (var r = PackageReader.Open(pkgPath))
{
    Check("Manifest kommt unveraendert zurueck", () =>
        r.Manifest.Id == "test" && r.Manifest.Version == "1.2.3" && r.Manifest.Files.Count == 3);
    Check("Modus ueberlebt JSON", () => r.Manifest.Mode == DeployMode.Portable);
    Check("Registry-Typ ueberlebt JSON", () =>
        r.Manifest.Registry[1].Kind == RegKind.Dword && r.Manifest.Registry[1].Value == "42");
    Check("Dateiinhalt kommt korrekt zurueck", () =>
    {
        using var s = r.OpenEntry(pb.Src);
        using var sr = new StreamReader(s);
        return sr.ReadToEnd() == "Inhalt B";
    });
}

// --- Overlay: Paket an eine EXE haengen -------------------------------
Console.WriteLine("Overlay");
var fakeStub = Path.Combine(tmp, "stub.exe");
File.WriteAllBytes(fakeStub, Encoding.ASCII.GetBytes(new string('M', 4096)));   // Platzhalter-EXE
var outExe = Path.Combine(tmp, "fertig.exe");
Overlay.Append(fakeStub, pkgPath, outExe);

Check("Ergebnis ist groesser als Stub plus Paket", () =>
    new FileInfo(outExe).Length > new FileInfo(fakeStub).Length + new FileInfo(pkgPath).Length);

Check("Stub-Teil bleibt vorne unveraendert", () =>
{
    using var fs = File.OpenRead(outExe);
    var head = new byte[4096];
    fs.ReadExactly(head);
    return head.All(b => b == (byte)'M');
});

Check("Angehaengtes Paket ist wieder lesbar", () =>
{
    using var r = PackageReader.FromSelfExtracting(outExe)!;
    return r.Manifest.Id == "test" && r.Manifest.Files.Count == 3;
});

Check("Dateien aus dem Overlay lassen sich entpacken", () =>
{
    using var r = PackageReader.FromSelfExtracting(outExe)!;
    using var s = r.OpenEntry(pa.Src);
    using var sr = new StreamReader(s);
    return sr.ReadToEnd() == "Inhalt A";
});

Check("EXE ohne Overlay wird erkannt", () => PackageReader.FromSelfExtracting(fakeStub) is null);

Check("Abgeschnittene Datei liefert kein halbes Paket", () =>
{
    var broken = Path.Combine(tmp, "kaputt.exe");
    var all = File.ReadAllBytes(outExe);
    File.WriteAllBytes(broken, all.AsSpan(0, all.Length - 100).ToArray());
    return PackageReader.FromSelfExtracting(broken) is null;
});

Directory.Delete(tmp, true);
Console.WriteLine($"\n{passed} bestanden, {failed} fehlgeschlagen");
return failed == 0 ? 0 : 1;
