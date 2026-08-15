using System.Security;
using Microsoft.Win32;

namespace VolmeThin.Core;

/// <summary>Gemeinsamer Registry-Zugriff fuer Aufnahme (lesen) und Stub (schreiben).</summary>
public static class RegistryIo
{
    public static (RegistryHive Hive, string SubPath) SplitRoot(string rootPath)
    {
        var p = rootPath.Replace('/', '\\').TrimStart('\\');
        int slash = p.IndexOf('\\');
        var head = (slash < 0 ? p : p.Substring(0, slash)).ToUpperInvariant();
        var rest = slash < 0 ? "" : p.Substring(slash + 1);

        var hive = head switch
        {
            "HKLM" or "HKEY_LOCAL_MACHINE" => RegistryHive.LocalMachine,
            "HKCU" or "HKEY_CURRENT_USER" => RegistryHive.CurrentUser,
            "HKCR" or "HKEY_CLASSES_ROOT" => RegistryHive.ClassesRoot,
            "HKU" or "HKEY_USERS" => RegistryHive.Users,
            "HKCC" or "HKEY_CURRENT_CONFIG" => RegistryHive.CurrentConfig,
            _ => throw new ArgumentException($"Unbekannter Registry-Zweig: {head}")
        };
        return (hive, rest);
    }

    public static string HiveShortName(RegistryHive hive) => hive switch
    {
        RegistryHive.LocalMachine => "HKLM",
        RegistryHive.CurrentUser => "HKCU",
        RegistryHive.ClassesRoot => "HKCR",
        RegistryHive.Users => "HKU",
        RegistryHive.CurrentConfig => "HKCC",
        _ => hive.ToString()
    };

    public static RegistryKey? TryOpen(RegistryKey parent, string subPath, bool writable = false)
    {
        try { return subPath.Length == 0 ? parent : parent.OpenSubKey(subPath, writable); }
        catch (SecurityException) { return null; }
        catch (UnauthorizedAccessException) { return null; }
        catch (IOException) { return null; }
    }

    /// <summary>Liest einen Wert als Text. Liefert null, wenn der Typ nicht uebernommen werden kann.</summary>
    public static RegKind? ReadValue(RegistryKey key, string name, out string text)
    {
        text = "";
        object? raw;
        RegistryValueKind kind;
        try
        {
            kind = key.GetValueKind(name);
            raw = key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
        }
        catch (Exception e) when (e is UnauthorizedAccessException or IOException or ArgumentException)
        {
            return null;
        }
        if (raw is null) return null;

        switch (kind)
        {
            case RegistryValueKind.String:
                text = (string)raw; return RegKind.String;
            case RegistryValueKind.ExpandString:
                text = (string)raw; return RegKind.ExpandString;
            case RegistryValueKind.MultiString:
                text = string.Join("\n", (string[])raw); return RegKind.MultiString;
            case RegistryValueKind.DWord:
                text = Convert.ToInt64(raw).ToString(); return RegKind.Dword;
            case RegistryValueKind.QWord:
                text = Convert.ToInt64(raw).ToString(); return RegKind.Qword;
            case RegistryValueKind.Binary:
                text = Convert.ToBase64String((byte[])raw); return RegKind.Binary;
            default:
                return null;   // None/Unknown werden nicht uebernommen
        }
    }

    /// <summary>Schreibt einen Manifest-Eintrag in die Registry. Legt fehlende Schluessel an.</summary>
    public static void WriteValue(RegistryEntry entry, RegistryHive? overrideHive = null, string? keyPrefix = null)
    {
        var hive = overrideHive ?? SplitRoot(entry.Root).Hive;
        var keyPath = keyPrefix is { Length: > 0 } ? $"{keyPrefix}\\{entry.Key}" : entry.Key;

        using var baseKey = RegistryKey.OpenBaseKey(hive, RegistryView.Default);
        using var key = baseKey.CreateSubKey(keyPath, writable: true)
                        ?? throw new IOException($"Registry-Schluessel nicht anlegbar: {hive}\\{keyPath}");

        var text = entry.Value ?? "";
        switch (entry.Kind)
        {
            case RegKind.String:
                key.SetValue(entry.Name, text, RegistryValueKind.String); break;
            case RegKind.ExpandString:
                key.SetValue(entry.Name, text, RegistryValueKind.ExpandString); break;
            case RegKind.MultiString:
                key.SetValue(entry.Name, text.Split('\n'), RegistryValueKind.MultiString); break;
            case RegKind.Dword:
                key.SetValue(entry.Name, unchecked((int)long.Parse(text)), RegistryValueKind.DWord); break;
            case RegKind.Qword:
                key.SetValue(entry.Name, long.Parse(text), RegistryValueKind.QWord); break;
            case RegKind.Binary:
                key.SetValue(entry.Name, Convert.FromBase64String(text), RegistryValueKind.Binary); break;
        }
    }
}
