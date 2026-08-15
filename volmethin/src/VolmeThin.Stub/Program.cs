namespace VolmeThin.Stub;

/// <summary>Betriebsart, ueber Kommandozeilenschalter gewaehlt.</summary>
internal enum RunMode
{
    /// <summary>Normalfall: bei Bedarf einrichten, dann Anwendung starten.</summary>
    Normal,
    /// <summary>Nur einrichten, nichts starten. Fuer den Verteil-Agenten.</summary>
    SetupOnly,
    /// <summary>Nur den Benutzerteil (HKCU) nachziehen. Wird von Active Setup aufgerufen.</summary>
    UserPart,
    /// <summary>Paketangaben ausgeben.</summary>
    Info
}

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        var mode = RunMode.Normal;
        var rest = new List<string>(args.Length);

        foreach (var a in args)
        {
            switch (a.ToLowerInvariant())
            {
                case "--vt-einrichten": mode = RunMode.SetupOnly; break;
                case "--vt-benutzer": mode = RunMode.UserPart; break;
                case "--vt-info": mode = RunMode.Info; break;
                default: rest.Add(a); break;   // alles Uebrige geht an die Anwendung
            }
        }

        try
        {
            return Runner.Run(rest.ToArray(), mode);
        }
        catch (Exception e)
        {
            Runner.Log(null, e.ToString());
            if (mode is RunMode.Normal)
                Runner.MessageBox(IntPtr.Zero,
                    e.Message + "\n\nEinzelheiten im Protokoll unter %LOCALAPPDATA%\\VolmeThin\\logs.",
                    "VolmeThin", 0x10);
            return 1;
        }
    }
}
