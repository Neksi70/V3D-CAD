using System.Runtime.InteropServices;

namespace WaSidebar;

/// Meldet das Fenster als "AppBar" bei Windows an (wie die Taskleiste):
/// maximierte Fenster lassen dann den reservierten Streifen frei.
static class AppBar
{
    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int left, top, right, bottom; }

    [StructLayout(LayoutKind.Sequential)]
    struct APPBARDATA
    {
        public int cbSize; public IntPtr hWnd; public uint uCallbackMessage;
        public uint uEdge; public RECT rc; public IntPtr lParam;
    }

    const uint ABM_NEW = 0, ABM_REMOVE = 1, ABM_QUERYPOS = 2, ABM_SETPOS = 3;
    public const uint ABE_LEFT = 0, ABE_RIGHT = 2;
    public const int ABN_POSCHANGED = 1, ABN_FULLSCREENAPP = 2;

    [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterWindowMessage(string s);

    public static readonly uint CallbackMessage = RegisterWindowMessage("WaSidebar_AppBarMsg");

    static APPBARDATA Data(IntPtr hwnd) => new() { cbSize = Marshal.SizeOf<APPBARDATA>(), hWnd = hwnd };

    public static void Register(IntPtr hwnd)
    {
        var d = Data(hwnd); d.uCallbackMessage = CallbackMessage;
        SHAppBarMessage(ABM_NEW, ref d);
    }

    public static void Unregister(IntPtr hwnd)
    {
        var d = Data(hwnd);
        SHAppBarMessage(ABM_REMOVE, ref d);
    }

    /// Reserviert 'width' physische Pixel am Rand von 'screen' und liefert das zugeteilte Rechteck.
    public static Rectangle Reserve(IntPtr hwnd, Rectangle screen, bool right, int width)
    {
        var d = Data(hwnd);
        d.uEdge = right ? ABE_RIGHT : ABE_LEFT;
        d.rc = new RECT { left = screen.Left, top = screen.Top, right = screen.Right, bottom = screen.Bottom };
        if (right) d.rc.left = d.rc.right - width; else d.rc.right = d.rc.left + width;
        SHAppBarMessage(ABM_QUERYPOS, ref d);
        if (right) d.rc.left = d.rc.right - width; else d.rc.right = d.rc.left + width;
        SHAppBarMessage(ABM_SETPOS, ref d);
        return Rectangle.FromLTRB(d.rc.left, d.rc.top, d.rc.right, d.rc.bottom);
    }
}
