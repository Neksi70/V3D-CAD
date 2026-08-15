using System.Runtime.InteropServices;

namespace VolmeThin.Stub;

/// <summary>
/// Kleines Fortschrittsfenster direkt auf Win32-Basis. Kein WinForms/WPF, damit der Stub
/// klein bleibt und sich als NativeAOT uebersetzen laesst.
/// </summary>
internal sealed class SplashWindow : IDisposable
{
    private const int WS_CHILD = 0x40000000, WS_VISIBLE = 0x10000000;
    private const int WS_CAPTION = 0x00C00000, WS_SYSMENU = 0x00080000;
    private const int WM_DESTROY = 0x0002, WM_SETFONT = 0x0030, WM_CLOSE = 0x0010;
    private const int PBM_SETRANGE32 = 0x0406, PBM_SETPOS = 0x0402, PBM_SETMARQUEE = 0x040A;
    private const int PBS_MARQUEE = 0x08;
    private const int SW_SHOW = 5, DEFAULT_GUI_FONT = 17;
    private const int SM_CXSCREEN = 0, SM_CYSCREEN = 1;

    private IntPtr _hwnd, _label, _bar;
    private Thread? _thread;
    private WndProcDelegate? _wndProc;      // muss leben, solange das Fenster existiert
    private readonly ManualResetEventSlim _ready = new(false);
    private readonly string _title;

    public SplashWindow(string title) => _title = title;

    public void Show()
    {
        _thread = new Thread(Pump) { IsBackground = true };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
        _ready.Wait(3000);
    }

    private void Pump()
    {
        var icc = new INITCOMMONCONTROLSEX { dwSize = Marshal.SizeOf<INITCOMMONCONTROLSEX>(), dwICC = 0x20 };
        InitCommonControlsEx(ref icc);

        _wndProc = WndProc;
        var cls = new WNDCLASSEX
        {
            cbSize = Marshal.SizeOf<WNDCLASSEX>(),
            lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_wndProc),
            hInstance = GetModuleHandle(null),
            lpszClassName = "VolmeThinSplash",
            hbrBackground = (IntPtr)(15 + 1),          // COLOR_3DFACE
            hCursor = LoadCursor(IntPtr.Zero, 32512)   // IDC_ARROW
        };
        RegisterClassEx(ref cls);

        const int w = 460, h = 150;
        int x = (GetSystemMetrics(SM_CXSCREEN) - w) / 2;
        int y = (GetSystemMetrics(SM_CYSCREEN) - h) / 2;

        _hwnd = CreateWindowEx(0, "VolmeThinSplash", _title, WS_CAPTION | WS_SYSMENU,
                               x, y, w, h, IntPtr.Zero, IntPtr.Zero, cls.hInstance, IntPtr.Zero);

        _label = CreateWindowEx(0, "STATIC", "Wird vorbereitet ...", WS_CHILD | WS_VISIBLE,
                                18, 22, w - 50, 40, _hwnd, IntPtr.Zero, cls.hInstance, IntPtr.Zero);

        _bar = CreateWindowEx(0, "msctls_progress32", "", WS_CHILD | WS_VISIBLE,
                              18, 72, w - 50, 22, _hwnd, IntPtr.Zero, cls.hInstance, IntPtr.Zero);

        var font = GetStockObject(DEFAULT_GUI_FONT);
        SendMessage(_label, WM_SETFONT, font, (IntPtr)1);

        SendMessage(_bar, PBM_SETRANGE32, IntPtr.Zero, (IntPtr)1000);
        ShowWindow(_hwnd, SW_SHOW);
        UpdateWindow(_hwnd);
        _ready.Set();

        while (GetMessage(out var msg, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
    }

    private IntPtr WndProc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (msg == WM_DESTROY) { PostQuitMessage(0); return IntPtr.Zero; }
        return DefWindowProc(hwnd, msg, wParam, lParam);
    }

    /// <summary>Fortschritt setzen. done/total &lt;= 0 schaltet auf Laufband um.</summary>
    public void Update(string text, long done, long total)
    {
        if (_label == IntPtr.Zero) return;
        SetWindowText(_label, text);
        if (total > 0)
        {
            int promille = (int)Math.Clamp(done * 1000 / total, 0, 1000);
            SendMessage(_bar, PBM_SETPOS, (IntPtr)promille, IntPtr.Zero);
        }
    }

    public void Dispose()
    {
        if (_hwnd != IntPtr.Zero) PostMessage(_hwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        _hwnd = IntPtr.Zero;
        _ready.Dispose();
    }

    private delegate IntPtr WndProcDelegate(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WNDCLASSEX
    {
        public int cbSize; public int style; public IntPtr lpfnWndProc;
        public int cbClsExtra, cbWndExtra;
        public IntPtr hInstance, hIcon, hCursor, hbrBackground;
        [MarshalAs(UnmanagedType.LPWStr)] public string? lpszMenuName;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpszClassName;
        public IntPtr hIconSm;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd; public uint message; public IntPtr wParam, lParam;
        public uint time; public int ptX, ptY;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INITCOMMONCONTROLSEX { public int dwSize, dwICC; }

    [DllImport("comctl32.dll")] private static extern bool InitCommonControlsEx(ref INITCOMMONCONTROLSEX icc);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern ushort RegisterClassEx(ref WNDCLASSEX c);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateWindowEx(int exStyle, string cls, string name, int style,
        int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
    [DllImport("user32.dll")] private static extern IntPtr DefWindowProc(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] private static extern bool UpdateWindow(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref MSG m);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr DispatchMessage(ref MSG m);
    [DllImport("user32.dll")] private static extern void PostQuitMessage(int code);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool SetWindowText(IntPtr h, string text);
    [DllImport("user32.dll")] private static extern IntPtr LoadCursor(IntPtr inst, int name);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("gdi32.dll")] private static extern IntPtr GetStockObject(int obj);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string? name);
}
