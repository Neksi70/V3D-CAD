namespace WaSidebar;

static class Program
{
    public const string ShowEventName = "WaSidebar_ShowEvent_v1";

    [STAThread]
    static void Main()
    {
        using var mutex = new Mutex(true, "WaSidebar_SingleInstance_v1", out bool first);
        if (!first)
        {
            // Laeuft schon: vorhandene Instanz aufklappen und beenden.
            try { using var ev = EventWaitHandle.OpenExisting(ShowEventName); ev.Set(); } catch { }
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.Run(new SidebarForm());
    }
}
