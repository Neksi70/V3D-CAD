namespace VolmeThin.Capture;

/// <summary>
/// Standardfilter gegen Rauschen. Ohne die Listen besteht ein Diff zu 90 Prozent aus
/// Windows-Eigenleben (Prefetch, Logs, MuiCache) statt aus der installierten Anwendung.
/// </summary>
public static class Excludes
{
    /// <summary>Teilpfade (case-insensitiv); trifft irgendwo im Pfad.</summary>
    public static readonly List<string> PathParts = new()
    {
        @"\$recycle.bin\", @"\system volume information\",
        @"\windows\prefetch\", @"\windows\softwaredistribution\", @"\windows\winsxs\",
        @"\windows\servicing\", @"\windows\logs\", @"\windows\temp\",
        @"\windows\system32\config\", @"\windows\system32\catroot2\",
        @"\windows\system32\logfiles\", @"\windows\system32\sru\",
        @"\windows\system32\winevt\", @"\windows\system32\spool\",
        @"\windows\system32\driverstore\filerepository\",
        @"\windows\inf\", @"\windows\assembly\",
        @"\appdata\local\temp\", @"\appdata\local\microsoft\windows\inetcache\",
        @"\appdata\local\microsoft\windows\explorer\",
        @"\appdata\local\microsoft\windows\webcache\",
        @"\appdata\local\microsoft\windows\notifications\",
        @"\appdata\local\packages\", @"\appdata\local\crashdumps\",
        @"\appdata\local\connecteddevicesplatform\",
        @"\appdata\roaming\microsoft\windows\recent\",
        @"\programdata\microsoft\windows defender\",
        @"\programdata\microsoft\windows\wer\",
        @"\programdata\microsoft\diagnosis\",
        @"\programdata\usoshared\", @"\programdata\ntuser.pol"
    };

    /// <summary>Dateinamen/Endungen, die nie ins Paket gehoeren.</summary>
    public static readonly List<string> FileSuffixes = new()
    {
        ".log", ".tmp", ".etl", ".evtx", ".dmp", ".pf", ".chk", ".bak~",
        "thumbs.db", "desktop.ini", "ntuser.dat", "ntuser.dat.log1", "ntuser.dat.log2",
        "pagefile.sys", "hiberfil.sys", "swapfile.sys", "usrclass.dat"
    };

    /// <summary>Registry-Teilpfade (case-insensitiv), die beim Diff verworfen werden.</summary>
    public static readonly List<string> RegistryParts = new()
    {
        @"\currentversion\installer\", @"\currentversion\reliability",
        @"\currentversion\search\", @"\currentversion\tracing",
        @"\currentversion\appmodel\", @"\currentversion\notifications\",
        @"\shell extensions\cached", @"\muicache", @"\shellnoroam",
        @"\microsoft\windows\currentversion\explorer\streams",
        @"\microsoft\windows\currentversion\explorer\usersettings",
        @"\microsoft\windows\currentversion\explorer\wallpapers",
        @"\microsoft\windows\currentversion\explorer\ribbon",
        @"\microsoft\windows\currentversion\explorer\typedpaths",
        @"\microsoft\windows nt\currentversion\appcompatflags\",
        @"\microsoft\windows\currentversion\bam\", @"\microsoft\windows\currentversion\dusmsvc",
        @"\microsoft\windowsupdate\", @"\microsoft\cryptography\rng",
        @"\microsoft\sqmclient\", @"\microsoft\windows\currentversion\wintrust\",
        @"\directx\usergpuprefer", @"\microsoft\windows\currentversion\appcontainer"
    };

    public static bool SkipPath(string fullPath)
    {
        var p = fullPath.ToLowerInvariant();
        foreach (var part in PathParts) if (p.Contains(part, StringComparison.Ordinal)) return true;
        foreach (var suf in FileSuffixes) if (p.EndsWith(suf, StringComparison.Ordinal)) return true;
        return false;
    }

    public static bool SkipRegistry(string rootAndKey)
    {
        var p = rootAndKey.ToLowerInvariant();
        foreach (var part in RegistryParts) if (p.Contains(part, StringComparison.Ordinal)) return true;
        return false;
    }
}
