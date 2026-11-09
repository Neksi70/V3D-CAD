using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace WaSidebar;

public class SidebarForm : Form
{
    // ---------- Win32 ----------
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern bool DestroyIcon(IntPtr h);
    const int WM_HOTKEY = 0x0312;
    const uint MOD_ALT = 1, MOD_CONTROL = 2, MOD_SHIFT = 4, MOD_NOREPEAT = 0x4000;
    const int HK_TOGGLE = 1, HK_SERVICE_BASE = 10;
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string RunName = "WaSidebar";

    static readonly Color StripBack = Color.FromArgb(0x11, 0x1B, 0x21);
    static readonly Color StripActive = Color.FromArgb(0x2A, 0x39, 0x42);
    static readonly Color GripBack = Color.FromArgb(0x22, 0x2E, 0x35);

    readonly AppSettings _s;
    readonly bool _firstRun;
    readonly Panel _strip = new();
    readonly FlowLayoutPanel _serviceList = new();
    readonly Panel _content = new();
    readonly Panel _grip = new();
    readonly Button _pinBtn, _moreBtn;
    readonly NotifyIcon _tray = new();
    readonly ContextMenuStrip _menu = new();
    readonly ToolTip _tip = new();
    readonly Dictionary<string, WebView2> _views = new();
    readonly Dictionary<string, ServiceButton> _buttons = new();
    readonly Dictionary<string, int> _unread = new();
    readonly System.Windows.Forms.Timer _collapseTimer = new() { Interval = 250 };
    readonly Icon _baseIcon;
    IntPtr _trayIconHandle;
    EventWaitHandle _showEvent;

    bool _expanded, _hidden, _appBarOn, _inLayout, _exiting;
    string _lastNotifService;
    CoreWebView2Notification _lastNotif;
    int _dragStartX, _dragStartWidth; bool _dragging;
    Font _glyphFont; int _glyphFontDpi;

    float S => DeviceDpi / 96f;
    bool DockRight => _s.Dock != "left";

    public SidebarForm()
    {
        _firstRun = !File.Exists(Path.Combine(AppSettings.BaseDir, "settings.json"));
        _s = AppSettings.Load();
        if (_s.Services.All(x => x.Id != _s.ActiveId)) _s.ActiveId = _s.Services[0].Id;

        Text = "WA Seitenleiste";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        BackColor = StripBack;
        try { _baseIcon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!); } catch { }
        _baseIcon ??= SystemIcons.Application;
        Icon = _baseIcon;

        // Icon-Leiste
        _strip.BackColor = StripBack;
        _serviceList.FlowDirection = FlowDirection.TopDown;
        _serviceList.WrapContents = false;
        _serviceList.BackColor = StripBack;
        _serviceList.Padding = new Padding(0, 6, 0, 0);
        _strip.Controls.Add(_serviceList);
        _pinBtn = GlyphButton("", "Offene Leiste anheften (Platz am Rand reservieren)", (_, _) => TogglePinned());
        _moreBtn = GlyphButton("", "Menü", (_, _) => _menu.Show(_moreBtn, new Point(0, _moreBtn.Height), ToolStripDropDownDirection.AboveRight));
        _strip.Controls.Add(_pinBtn);
        _strip.Controls.Add(_moreBtn);

        // Ziehgriff zum Breite aendern
        _grip.BackColor = GripBack;
        _grip.Cursor = Cursors.SizeWE;
        _grip.MouseDown += (_, e) => { if (e.Button == MouseButtons.Left) { _dragging = true; _dragStartX = Cursor.Position.X; _dragStartWidth = _s.PanelWidth; _grip.Capture = true; } };
        _grip.MouseMove += (_, _) =>
        {
            if (!_dragging) return;
            int dx = Cursor.Position.X - _dragStartX;
            int w = _dragStartWidth + (int)((DockRight ? -dx : dx) / S);
            w = Math.Clamp(w, 300, 1400);
            if (w != _s.PanelWidth) { _s.PanelWidth = w; DoLayout(); }
        };
        _grip.MouseUp += (_, _) => { if (_dragging) { _dragging = false; _grip.Capture = false; _s.Save(); } };

        _content.BackColor = Color.FromArgb(0x0B, 0x14, 0x1A);
        Controls.Add(_content);
        Controls.Add(_grip);
        Controls.Add(_strip);

        foreach (var svc in _s.Services) AddButton(svc);

        // Tray + Menue
        _menu.Opening += (_, _) => BuildMenu();
        _tray.ContextMenuStrip = _menu;
        _tray.Text = "WA Seitenleiste";
        _tray.Icon = _baseIcon;
        _tray.Visible = true;
        _tray.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) { if (_hidden) ShowBar(true); else ToggleExpanded(); } };
        _tray.BalloonTipClicked += (_, _) => OpenFromNotification();

        _collapseTimer.Tick += (_, _) => { _collapseTimer.Stop(); MaybeAutoCollapse(); };
        Deactivate += (_, _) => { if (_expanded && !_s.Pinned && _s.AutoCollapse) _collapseTimer.Start(); };
        SystemEvents.DisplaySettingsChanged += OnDisplayChanged;
        _expanded = _firstRun;
    }

    // ---------- Fensterstil: kein Alt-Tab-Eintrag ----------
    protected override CreateParams CreateParams
    {
        get { var cp = base.CreateParams; cp.ExStyle |= 0x80; /* WS_EX_TOOLWINDOW */ return cp; }
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        AppBar.Register(Handle); _appBarOn = true;
        RegisterHotKey(Handle, HK_TOGGLE, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, (uint)Keys.W);
        for (int i = 0; i < 9; i++)
            RegisterHotKey(Handle, HK_SERVICE_BASE + i, MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT, (uint)(Keys.D1 + i));
        DoLayout();
        StartShowListener();
        if (_firstRun)
            _tray.ShowBalloonTip(8000, "WA Seitenleiste",
                "Oben P = privat, B = Business. Jeweils einmal per QR-Code anmelden. Strg+Alt+W blendet die Leiste ein und aus.", ToolTipIcon.Info);
        foreach (var svc in _s.Services.ToList())
        {
            try { await InitView(svc); }
            catch (Exception ex) { ShowError(svc, ex); }
        }
        ActivateService(_s.ActiveId, false);
    }

    void StartShowListener()
    {
        _showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ShowEventName);
        var t = new Thread(() =>
        {
            while (!_exiting)
            {
                if (_showEvent.WaitOne(1000) && !_exiting)
                    BeginInvoke(() => ShowBar(true));
            }
        }) { IsBackground = true };
        t.Start();
    }

    // ---------- WebView pro Dienst, jeder mit eigenem Profilordner ----------
    async Task InitView(ServiceDef svc)
    {
        var wv = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = _content.BackColor };
        _content.Controls.Add(wv);
        _views[svc.Id] = wv;
        _ = wv.Handle; // Handle sofort anlegen, auch wenn verdeckt

        string dir = Path.Combine(AppSettings.BaseDir, "profiles", svc.Id);
        Directory.CreateDirectory(dir);
        var env = await CoreWebView2Environment.CreateAsync(null, dir, new CoreWebView2EnvironmentOptions());
        await wv.EnsureCoreWebView2Async(env);
        var c = wv.CoreWebView2;
        c.Settings.IsStatusBarEnabled = false;
        c.Settings.IsZoomControlEnabled = true;

        c.PermissionRequested += (_, e) =>
        {
            if (e.PermissionKind is CoreWebView2PermissionKind.Notifications or CoreWebView2PermissionKind.Microphone
                or CoreWebView2PermissionKind.Camera or CoreWebView2PermissionKind.ClipboardRead)
            {
                e.State = CoreWebView2PermissionState.Allow;
                e.SavesInProfile = true;
            }
        };
        // Links aus Chats im normalen Browser oeffnen
        c.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
        c.DocumentTitleChanged += (_, _) => SetUnread(svc.Id, ParseUnread(c.DocumentTitle));
        c.NotificationReceived += (_, e) =>
        {
            e.Handled = true;
            var n = e.Notification;
            n.ReportShown();
            ShowNotification(svc, n);
        };
        c.ProcessFailed += (_, e) =>
        {
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) return;
            try { c.Reload(); } catch { }
        };
        c.Navigate(svc.Url);
    }

    static int ParseUnread(string title)
    {
        var m = Regex.Match(title ?? "", @"^\s*\((\d+)\)");
        return m.Success ? int.Parse(m.Groups[1].Value) : 0;
    }

    void ShowError(ServiceDef svc, Exception ex)
    {
        MessageBox.Show(this,
            $"{svc.Name} konnte nicht gestartet werden.\n\n{ex.Message}\n\n" +
            "Ist die \"Microsoft Edge WebView2 Runtime\" installiert? (Bei Windows 10/11 normalerweise ja.)",
            "WA Seitenleiste", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    // ---------- Benachrichtigungen ----------
    void ShowNotification(ServiceDef svc, CoreWebView2Notification n)
    {
        if (!_s.Notifications) return;
        bool looking = !_hidden && _expanded && _s.ActiveId == svc.Id && IsOurForeground();
        if (looking) return;
        _lastNotifService = svc.Id;
        _lastNotif = n;
        string title = $"{svc.Name}: {n.Title}";
        string body = string.IsNullOrWhiteSpace(n.Body) ? "Neue Nachricht" : n.Body;
        _tray.ShowBalloonTip(6000, Trunc(title, 63), Trunc(body, 250), ToolTipIcon.None);
    }

    void OpenFromNotification()
    {
        if (_lastNotifService == null) return;
        ShowBar(false);
        ActivateService(_lastNotifService, true);
        try { _lastNotif?.ReportClicked(); } catch { } // oeffnet den passenden Chat
    }

    static string Trunc(string s, int n) => s.Length <= n ? s : s[..(n - 1)] + "…";

    void SetUnread(string id, int count)
    {
        _unread[id] = count;
        if (_buttons.TryGetValue(id, out var b)) { b.Unread = count; b.Invalidate(); }
        UpdateTrayIcon();
    }

    void UpdateTrayIcon()
    {
        int total = _unread.Values.Sum();
        var lines = _s.Services.Select(x => $"{x.Name}: {(_unread.TryGetValue(x.Id, out var u) ? u : 0)}");
        _tray.Text = Trunc("WA Seitenleiste\n" + string.Join("\n", lines), 127);
        var old = _trayIconHandle;
        if (total == 0) { _tray.Icon = _baseIcon; _trayIconHandle = IntPtr.Zero; }
        else
        {
            using var bmp = new Bitmap(32, 32);
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                using (var ic = new Icon(_baseIcon, 32, 32)) g.DrawIcon(ic, new Rectangle(0, 0, 32, 32));
                using var pen = new Pen(Color.White, 1.5f);
                g.FillEllipse(Brushes.Red, 16, 0, 16, 16);
                g.DrawEllipse(pen, 16, 0, 16, 16);
            }
            _trayIconHandle = bmp.GetHicon();
            _tray.Icon = Icon.FromHandle(_trayIconHandle);
        }
        if (old != IntPtr.Zero) DestroyIcon(old);
    }

    // ---------- Anzeige ----------
    void ActivateService(string id, bool expand)
    {
        if (!_views.ContainsKey(id) && _s.Services.All(x => x.Id != id)) return;
        _s.ActiveId = id;
        if (_views.TryGetValue(id, out var wv)) wv.BringToFront();
        foreach (var (bid, b) in _buttons) { b.Active = bid == id; b.Invalidate(); }
        if (expand && !_expanded) { _expanded = true; DoLayout(); }
        if (expand) { Activate(); wv?.Focus(); }
        _s.Save();
    }

    void OnServiceClick(string id)
    {
        if (_expanded && _s.ActiveId == id) { _expanded = false; DoLayout(); }
        else ActivateService(id, true);
    }

    void ToggleExpanded()
    {
        if (_hidden) { ShowBar(true); return; }
        _expanded = !_expanded;
        DoLayout();
        if (_expanded) { Activate(); if (_views.TryGetValue(_s.ActiveId, out var wv)) wv.Focus(); }
    }

    void ShowBar(bool expand)
    {
        if (_hidden)
        {
            _hidden = false;
            Show();
            AppBar.Register(Handle); _appBarOn = true;
        }
        if (expand) _expanded = true;
        DoLayout();
        Activate();
    }

    void HideBar()
    {
        _hidden = true;
        if (_appBarOn) { AppBar.Unregister(Handle); _appBarOn = false; }
        Hide();
    }

    void MaybeAutoCollapse()
    {
        if (!_expanded || _s.Pinned || !_s.AutoCollapse || _menu.Visible) return;
        if (IsOurForeground()) return;
        _expanded = false;
        DoLayout();
    }

    bool IsOurForeground()
    {
        var fg = GetForegroundWindow();
        if (fg == IntPtr.Zero) return false;
        var root = GetAncestor(fg, 2 /* GA_ROOT */);
        return fg == Handle || root == Handle || OwnedForms.Any(f => f.Handle == fg);
    }

    Screen TargetScreen() =>
        Screen.AllScreens.FirstOrDefault(x => x.DeviceName == _s.ScreenDevice) ?? Screen.PrimaryScreen!;

    void DoLayout()
    {
        if (_inLayout || _hidden || !IsHandleCreated) return;
        _inLayout = true;
        try
        {
            var scr = TargetScreen();
            int strip = (int)(48 * S), grip = (int)(5 * S), panel = (int)(_s.PanelWidth * S);
            int total = _expanded ? strip + grip + panel : strip;
            int reserve = _expanded && _s.Pinned ? total : strip;

            Rectangle area;
            if (_appBarOn) area = AppBar.Reserve(Handle, scr.Bounds, DockRight, reserve);
            else area = scr.WorkingArea;
            int x = DockRight ? area.Right - total : area.Left;
            Bounds = new Rectangle(x, area.Top, total, area.Height);

            int h = area.Height;
            if (DockRight)
            {
                _grip.SetBounds(0, 0, _expanded ? grip : 0, h);
                _content.SetBounds(_expanded ? grip : 0, 0, _expanded ? panel : 0, h);
                _strip.SetBounds(total - strip, 0, strip, h);
            }
            else
            {
                _strip.SetBounds(0, 0, strip, h);
                _content.SetBounds(strip, 0, _expanded ? panel : 0, h);
                _grip.SetBounds(strip + (_expanded ? panel : 0), 0, _expanded ? grip : 0, h);
            }
            _grip.Visible = _content.Visible = _expanded;

            int btn = (int)(40 * S);
            _serviceList.SetBounds(0, 0, strip, h - 2 * btn - (int)(8 * S));
            foreach (var b in _buttons.Values) { b.Size = new Size(strip, (int)(46 * S)); b.Margin = Padding.Empty; }
            _pinBtn.SetBounds(0, h - 2 * btn - (int)(4 * S), strip, btn);
            _moreBtn.SetBounds(0, h - btn - (int)(4 * S), strip, btn);
            _pinBtn.Text = _s.Pinned ? "" : "";
            _pinBtn.ForeColor = _s.Pinned ? Color.FromArgb(0x25, 0xD3, 0x66) : Color.Gainsboro;
            if (_glyphFont == null || _glyphFontDpi != DeviceDpi)
            {
                _glyphFont?.Dispose();
                _glyphFont = new Font("Segoe MDL2 Assets", 16 * S, GraphicsUnit.Pixel);
                _glyphFontDpi = DeviceDpi;
                _pinBtn.Font = _moreBtn.Font = _glyphFont;
            }
        }
        finally { _inLayout = false; }
    }

    protected override void OnDpiChanged(DpiChangedEventArgs e)
    {
        base.OnDpiChanged(e);
        BeginInvoke(DoLayout);
    }

    void OnDisplayChanged(object sender, EventArgs e)
    {
        if (IsHandleCreated) BeginInvoke(DoLayout);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY)
        {
            int id = m.WParam.ToInt32();
            if (id == HK_TOGGLE) ToggleExpanded();
            else if (id >= HK_SERVICE_BASE && id < HK_SERVICE_BASE + 9)
            {
                int i = id - HK_SERVICE_BASE;
                if (i < _s.Services.Count) { ShowBar(false); OnServiceClick(_s.Services[i].Id); }
            }
            return;
        }
        if (_appBarOn && m.Msg == (int)AppBar.CallbackMessage)
        {
            int code = m.WParam.ToInt32();
            if (code == AppBar.ABN_POSCHANGED) BeginInvoke(DoLayout);
            else if (code == AppBar.ABN_FULLSCREENAPP) TopMost = m.LParam == IntPtr.Zero; // Vollbild-Videos nicht ueberdecken
            return;
        }
        base.WndProc(ref m);
    }

    // ---------- Menue ----------
    void BuildMenu()
    {
        _menu.Items.Clear();
        _menu.Items.Add("Leiste auf-/zuklappen\tStrg+Alt+W", null, (_, _) => ToggleExpanded());
        _menu.Items.Add(_hidden ? "Leiste einblenden" : "Leiste ganz ausblenden (nur Tray)", null,
            (_, _) => { if (_hidden) ShowBar(false); else HideBar(); });
        _menu.Items.Add(new ToolStripSeparator());

        var side = new ToolStripMenuItem("Seite");
        side.DropDownItems.Add(Check("Rechts", DockRight, () => SetDock("right")));
        side.DropDownItems.Add(Check("Links", !DockRight, () => SetDock("left")));
        _menu.Items.Add(side);

        if (Screen.AllScreens.Length > 1)
        {
            var scr = new ToolStripMenuItem("Bildschirm");
            var cur = TargetScreen();
            int n = 1;
            foreach (var sc in Screen.AllScreens)
            {
                var dev = sc.DeviceName;
                scr.DropDownItems.Add(Check($"Bildschirm {n++}{(sc.Primary ? " (Haupt)" : "")} – {sc.Bounds.Width}×{sc.Bounds.Height}",
                    sc.DeviceName == cur.DeviceName, () => { _s.ScreenDevice = dev; _s.Save(); RelayoutAppBar(); }));
            }
            _menu.Items.Add(scr);
        }
        _menu.Items.Add(Check("Offene Leiste anheften (Platz reservieren)", _s.Pinned, TogglePinned));
        _menu.Items.Add(Check("Beim Wegklicken einklappen", _s.AutoCollapse, () => { _s.AutoCollapse = !_s.AutoCollapse; _s.Save(); }));
        _menu.Items.Add(Check("Benachrichtigungen anzeigen", _s.Notifications, () => { _s.Notifications = !_s.Notifications; _s.Save(); }));
        _menu.Items.Add(Check("Mit Windows starten", IsAutostart(), () => SetAutostart(!IsAutostart())));
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add("Dienst hinzufügen …", null, (_, _) => AddServiceInteractive());
        _menu.Items.Add("Aktuellen Dienst neu laden", null, (_, _) => ReloadService(_s.ActiveId));
        _menu.Items.Add("Datenordner öffnen", null, (_, _) => OpenExternal(AppSettings.BaseDir));
        _menu.Items.Add(new ToolStripSeparator());
        _menu.Items.Add("Beenden", null, (_, _) => ExitApp());
    }

    static ToolStripMenuItem Check(string text, bool on, Action a)
    {
        var i = new ToolStripMenuItem(text) { Checked = on };
        i.Click += (_, _) => a();
        return i;
    }

    void SetDock(string side) { _s.Dock = side; _s.Save(); RelayoutAppBar(); }

    // Seite/Bildschirm gewechselt: AppBar neu anmelden, damit Windows den alten Platz freigibt.
    void RelayoutAppBar()
    {
        if (_appBarOn) { AppBar.Unregister(Handle); AppBar.Register(Handle); }
        DoLayout();
    }

    void TogglePinned() { _s.Pinned = !_s.Pinned; _s.Save(); DoLayout(); }

    void ReloadService(string id)
    {
        if (_views.TryGetValue(id, out var wv)) try { wv.CoreWebView2?.Reload(); } catch { }
    }

    async void AddServiceInteractive()
    {
        using var dlg = new AddServiceDialog();
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        if (string.IsNullOrWhiteSpace(dlg.ServiceName) || !Uri.TryCreate(dlg.ServiceUrl, UriKind.Absolute, out var uri)) return;
        string id = "d" + DateTime.Now.ToString("yyyyMMddHHmmss");
        string[] palette = { "#3B82F6", "#F59E0B", "#8B5CF6", "#EF4444", "#0EA5E9", "#EC4899" };
        var svc = new ServiceDef
        {
            Id = id, Name = dlg.ServiceName, Url = uri.ToString(),
            Letter = dlg.ServiceName[..1].ToUpperInvariant(),
            Color = palette[_s.Services.Count % palette.Length],
        };
        _s.Services.Add(svc);
        _s.Save();
        AddButton(svc);
        DoLayout();
        try { await InitView(svc); } catch (Exception ex) { ShowError(svc, ex); }
        ActivateService(id, true);
    }

    void RemoveService(ServiceDef svc)
    {
        if (_s.Services.Count <= 1) return;
        if (MessageBox.Show(this, $"\"{svc.Name}\" aus der Leiste entfernen?\n(Die Anmeldedaten bleiben im Datenordner liegen.)",
                "WA Seitenleiste", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        _s.Services.Remove(svc);
        if (_views.Remove(svc.Id, out var wv)) wv.Dispose();
        if (_buttons.Remove(svc.Id, out var b)) b.Dispose();
        _unread.Remove(svc.Id);
        UpdateTrayIcon();
        if (_s.ActiveId == svc.Id) ActivateService(_s.Services[0].Id, false);
        _s.Save();
    }

    // ---------- Autostart ----------
    static bool IsAutostart()
    {
        using var k = Registry.CurrentUser.OpenSubKey(RunKey);
        return k?.GetValue(RunName) is string v && v.Contains(Environment.ProcessPath!, StringComparison.OrdinalIgnoreCase);
    }

    static void SetAutostart(bool on)
    {
        using var k = Registry.CurrentUser.CreateSubKey(RunKey);
        if (on) k.SetValue(RunName, $"\"{Environment.ProcessPath}\"");
        else k.DeleteValue(RunName, false);
    }

    static void OpenExternal(string target)
    {
        try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); } catch { }
    }

    void ExitApp()
    {
        _exiting = true;
        _s.Save();
        if (_appBarOn) { AppBar.Unregister(Handle); _appBarOn = false; }
        _tray.Visible = false;
        Application.Exit();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!_exiting && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; HideBar(); return; }
        _exiting = true;
        if (_appBarOn) { AppBar.Unregister(Handle); _appBarOn = false; }
        UnregisterHotKey(Handle, HK_TOGGLE);
        for (int i = 0; i < 9; i++) UnregisterHotKey(Handle, HK_SERVICE_BASE + i);
        SystemEvents.DisplaySettingsChanged -= OnDisplayChanged;
        _tray.Visible = false;
        base.OnFormClosing(e);
    }

    // ---------- Bausteine ----------
    Button GlyphButton(string glyph, string tip, EventHandler click)
    {
        var b = new Button
        {
            Text = glyph, FlatStyle = FlatStyle.Flat, ForeColor = Color.Gainsboro, BackColor = StripBack,
            TabStop = false, Cursor = Cursors.Hand,
        };
        b.FlatAppearance.BorderSize = 0;
        b.FlatAppearance.MouseOverBackColor = StripActive;
        b.Click += click;
        _tip.SetToolTip(b, tip);
        return b;
    }

    void AddButton(ServiceDef svc)
    {
        var b = new ServiceButton(svc) { Active = svc.Id == _s.ActiveId };
        b.MouseUp += (_, e) =>
        {
            if (e.Button == MouseButtons.Left) OnServiceClick(svc.Id);
            else if (e.Button == MouseButtons.Right)
            {
                var m = new ContextMenuStrip();
                m.Items.Add("Neu laden", null, (_, _) => ReloadService(svc.Id));
                if (_s.Services.Count > 1) m.Items.Add("Aus Leiste entfernen", null, (_, _) => RemoveService(svc));
                m.Show(b, e.Location);
            }
        };
        int idx = _s.Services.IndexOf(svc);
        _tip.SetToolTip(b, svc.Name + (idx < 9 ? $"  (Strg+Umschalt+Alt+{idx + 1})" : ""));
        _buttons[svc.Id] = b;
        _serviceList.Controls.Add(b);
    }

    sealed class ServiceButton : Control
    {
        readonly ServiceDef _svc;
        public bool Active;
        public int Unread;
        bool _hover;

        public ServiceButton(ServiceDef svc)
        {
            _svc = svc;
            DoubleBuffered = true;
            Cursor = Cursors.Hand;
            BackColor = StripBack;
        }

        protected override void OnMouseEnter(EventArgs e) { _hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { _hover = false; Invalidate(); base.OnMouseLeave(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            float s = DeviceDpi / 96f;
            g.Clear(Active || _hover ? StripActive : StripBack);
            if (Active)
                using (var acc = new SolidBrush(Color.FromArgb(0x25, 0xD3, 0x66)))
                    g.FillRectangle(acc, 0, Height * 0.2f, 3 * s, Height * 0.6f);

            float d = 32 * s;
            var r = new RectangleF((Width - d) / 2, (Height - d) / 2, d, d);
            Color col;
            try { col = ColorTranslator.FromHtml(_svc.Color); } catch { col = Color.SeaGreen; }
            using (var br = new SolidBrush(col)) g.FillEllipse(br, r);
            using (var f = new Font("Segoe UI Semibold", 15 * s, GraphicsUnit.Pixel))
            using (var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                g.DrawString(_svc.Letter ?? "?", f, Brushes.White, r, sf);

            if (Unread > 0)
            {
                string t = Unread > 99 ? "99+" : Unread.ToString();
                using var f = new Font("Segoe UI", 10 * s, FontStyle.Bold, GraphicsUnit.Pixel);
                var size = g.MeasureString(t, f);
                float bw = Math.Max(17 * s, size.Width + 4 * s), bh = 17 * s;
                var br2 = new RectangleF(r.Right - bw + 6 * s, r.Top - 4 * s, bw, bh);
                using (var path = Rounded(br2, bh / 2)) g.FillPath(Brushes.Red, path);
                using var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                g.DrawString(t, f, Brushes.White, br2, sf);
            }
        }

        static GraphicsPath Rounded(RectangleF r, float rad)
        {
            var p = new GraphicsPath();
            p.AddArc(r.Left, r.Top, rad * 2, rad * 2, 180, 90);
            p.AddArc(r.Right - rad * 2, r.Top, rad * 2, rad * 2, 270, 90);
            p.AddArc(r.Right - rad * 2, r.Bottom - rad * 2, rad * 2, rad * 2, 0, 90);
            p.AddArc(r.Left, r.Bottom - rad * 2, rad * 2, rad * 2, 90, 90);
            p.CloseFigure();
            return p;
        }
    }
}
