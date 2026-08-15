using System.Text;

namespace VolmeThin.Core;

/// <summary>
/// Uebersetzt zwischen echten Windows-Pfaden und portablen Makro-Pfaden
/// ("C:\Program Files\X" &lt;-&gt; "{ProgramFiles}\X").
/// </summary>
public static class PathMacros
{
    /// <summary>Reihenfolge zaehlt: der laengste/spezifischste Pfad muss zuerst greifen.</summary>
    public static readonly string[] Order =
    {
        "LocalAppData", "AppData", "CommonAppData",
        "ProgramFilesX86", "ProgramFiles", "CommonProgramFilesX86", "CommonProgramFiles",
        "Desktop", "StartMenu", "CommonDesktop", "CommonStartMenu",
        "SystemDir", "SystemRoot", "UserProfile", "SystemDrive"
    };

    public static Dictionary<string, string> Resolve()
    {
        string Env(string n) => Environment.GetEnvironmentVariable(n) ?? "";
        string Fld(Environment.SpecialFolder f) => Environment.GetFolderPath(f);

        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["ProgramFiles"] = Env("ProgramW6432") is { Length: > 0 } pw ? pw : Fld(Environment.SpecialFolder.ProgramFiles),
            ["ProgramFilesX86"] = Fld(Environment.SpecialFolder.ProgramFilesX86),
            ["CommonProgramFiles"] = Fld(Environment.SpecialFolder.CommonProgramFiles),
            ["CommonProgramFilesX86"] = Fld(Environment.SpecialFolder.CommonProgramFilesX86),
            ["CommonAppData"] = Fld(Environment.SpecialFolder.CommonApplicationData),
            ["AppData"] = Fld(Environment.SpecialFolder.ApplicationData),
            ["LocalAppData"] = Fld(Environment.SpecialFolder.LocalApplicationData),
            ["Desktop"] = Fld(Environment.SpecialFolder.DesktopDirectory),
            ["CommonDesktop"] = Fld(Environment.SpecialFolder.CommonDesktopDirectory),
            ["StartMenu"] = Fld(Environment.SpecialFolder.Programs),
            ["CommonStartMenu"] = Fld(Environment.SpecialFolder.CommonPrograms),
            ["SystemRoot"] = Env("SystemRoot") is { Length: > 0 } sr ? sr : @"C:\Windows",
            ["SystemDir"] = Environment.SystemDirectory,
            ["UserProfile"] = Fld(Environment.SpecialFolder.UserProfile),
            ["SystemDrive"] = Env("SystemDrive") is { Length: > 0 } sd ? sd : "C:"
        };
        return map;
    }

    /// <summary>Echter Pfad -> Makro-Pfad. Unbekannte Pfade bleiben unveraendert.</summary>
    public static string Pack(string fullPath, Dictionary<string, string>? map = null)
    {
        map ??= Resolve();
        foreach (var key in Order)
        {
            if (!map.TryGetValue(key, out var root) || root.Length == 0) continue;
            var trimmed = root.TrimEnd('\\');
            if (fullPath.Length >= trimmed.Length &&
                fullPath.StartsWith(trimmed, StringComparison.OrdinalIgnoreCase) &&
                (fullPath.Length == trimmed.Length || fullPath[trimmed.Length] == '\\'))
            {
                return "{" + key + "}" + fullPath.Substring(trimmed.Length);
            }
        }
        return fullPath;
    }

    /// <summary>Makro-Pfad -> echter Pfad. Zusaetzliche Makros (z.B. PkgRoot) via extra.</summary>
    public static string Expand(string macroPath, Dictionary<string, string>? map = null,
                                Dictionary<string, string>? extra = null)
    {
        map ??= Resolve();
        var sb = new StringBuilder(macroPath.Length + 32);
        for (int i = 0; i < macroPath.Length; i++)
        {
            if (macroPath[i] != '{') { sb.Append(macroPath[i]); continue; }
            int end = macroPath.IndexOf('}', i + 1);
            if (end < 0) { sb.Append(macroPath[i]); continue; }

            var name = macroPath.Substring(i + 1, end - i - 1);
            string? val = null;
            if (extra is not null) extra.TryGetValue(name, out val);
            if (val is null) map.TryGetValue(name, out val);

            if (val is null) sb.Append(macroPath, i, end - i + 1);   // unbekannt: unveraendert lassen
            else sb.Append(val.TrimEnd('\\'));
            i = end;
        }
        return sb.ToString();
    }

    /// <summary>
    /// Makro-Pfad -> Pfad innerhalb des Portable-Caches, z.B.
    /// "{ProgramFiles}\X\a.exe" -> "&lt;cache&gt;\vfs\ProgramFiles\X\a.exe".
    /// Pfade ohne Makro werden unter "vfs\_abs\C" einsortiert.
    /// </summary>
    public static string ToVfs(string macroPath, string cacheRoot)
    {
        string rel;
        if (macroPath.StartsWith("{", StringComparison.Ordinal) && macroPath.IndexOf('}') > 0)
        {
            int end = macroPath.IndexOf('}');
            rel = macroPath.Substring(1, end - 1) + macroPath.Substring(end + 1);
        }
        else if (macroPath.Length > 2 && macroPath[1] == ':')
        {
            rel = Path.Combine("_abs", macroPath[0].ToString(), macroPath.Substring(3));
        }
        else
        {
            rel = macroPath.TrimStart('\\');
        }
        return Path.Combine(cacheRoot, "vfs", rel.Replace('/', '\\').TrimStart('\\'));
    }
}
