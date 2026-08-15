namespace VolmeThin.Stub;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            return Runner.Run(args);
        }
        catch (Exception e)
        {
            Runner.Log(null, e.ToString());
            Runner.MessageBox(IntPtr.Zero,
                e.Message + "\n\nEinzelheiten im Protokoll unter %LOCALAPPDATA%\\VolmeThin\\logs.",
                "VolmeThin", 0x10);
            return 1;
        }
    }
}
