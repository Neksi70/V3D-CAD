using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace WaSidebar;

/// Merkt PINs der V3D Tools je Seite (z. B. https://v3da…/mail).
/// Gespeichert mit Windows-DPAPI: nur das eigene Windows-Konto kann sie lesen.
static class PinStore
{
    static string FilePath => Path.Combine(AppSettings.BaseDir, "pins.dat");
    static Dictionary<string, string> _pins;
    static readonly Dictionary<string, string> Pending = new();

    static Dictionary<string, string> Pins => _pins ??= Load();

    public static string Get(string key) => Pins.TryGetValue(key, out var p) ? p : null;
    public static void SetPending(string key, string pin) => Pending[key] = pin;

    public static void Confirm(string key)
    {
        if (!Pending.Remove(key, out var pin)) return;
        if (Get(key) == pin) return;
        Pins[key] = pin; Save();
    }

    public static void Reject(string key)
    {
        Pending.Remove(key);
        if (Pins.Remove(key)) Save();
    }

    public static int Count => Pins.Count;
    public static void Clear() { Pins.Clear(); Pending.Clear(); Save(); }

    static Dictionary<string, string> Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<Dictionary<string, string>>(Unprotect(File.ReadAllBytes(FilePath))) ?? new();
        }
        catch { }
        return new();
    }

    static void Save()
    {
        try
        {
            Directory.CreateDirectory(AppSettings.BaseDir);
            File.WriteAllBytes(FilePath, Protect(JsonSerializer.SerializeToUtf8Bytes(Pins)));
        }
        catch { }
    }

    // ---- DPAPI (CryptProtectData), ohne Zusatzpaket ----
    [StructLayout(LayoutKind.Sequential)]
    struct DATA_BLOB { public int cbData; public IntPtr pbData; }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CryptProtectData(ref DATA_BLOB pIn, string desc, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, ref DATA_BLOB pOut);
    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CryptUnprotectData(ref DATA_BLOB pIn, IntPtr desc, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, ref DATA_BLOB pOut);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr h);
    const int CRYPTPROTECT_UI_FORBIDDEN = 1;

    static byte[] Protect(byte[] data) => Run(data, true);
    static byte[] Unprotect(byte[] data) => Run(data, false);

    static byte[] Run(byte[] data, bool protect)
    {
        var inBlob = new DATA_BLOB { cbData = data.Length, pbData = Marshal.AllocHGlobal(data.Length) };
        var outBlob = new DATA_BLOB();
        try
        {
            Marshal.Copy(data, 0, inBlob.pbData, data.Length);
            bool ok = protect
                ? CryptProtectData(ref inBlob, "WaSidebar", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, CRYPTPROTECT_UI_FORBIDDEN, ref outBlob)
                : CryptUnprotectData(ref inBlob, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, CRYPTPROTECT_UI_FORBIDDEN, ref outBlob);
            if (!ok) throw new InvalidOperationException("DPAPI fehlgeschlagen");
            var res = new byte[outBlob.cbData];
            Marshal.Copy(outBlob.pbData, res, 0, outBlob.cbData);
            return res;
        }
        finally
        {
            Marshal.FreeHGlobal(inBlob.pbData);
            if (outBlob.pbData != IntPtr.Zero) LocalFree(outBlob.pbData);
        }
    }

    // Seitenskript: erkennt reine PIN-Anmeldungen, meldet eingegebene PINs und trägt gespeicherte ein.
    public const string Script = """
(() => {
  if (window.top !== window || !window.chrome || !chrome.webview) return;
  const W = chrome.webview;
  const key = location.origin + '/' + (location.pathname.split('/')[1] || '');
  const RX = /pin|passw|kennw|schl(u|ü)ssel|key|code|zugang/i;
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  function findPin() {
    let pin = null;
    for (const el of document.querySelectorAll('input')) {
      if (el.disabled || !vis(el)) continue;
      const t = (el.type || 'text').toLowerCase();
      const d = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.autocomplete,
                 el.labels && el.labels[0] && el.labels[0].textContent].join(' ');
      // Seiten mit Benutzername/E-Mail sind keine reinen PIN-Anmeldungen -> nicht anfassen
      if (t === 'email' || /user|benutzer|e-?mail|login/i.test(d) && t !== 'password') return null;
      if (!pin && !el.readOnly && (t === 'password' || ((t === 'text' || t === 'tel' || t === 'number') && RX.test(d)))) pin = el;
    }
    return pin;
  }
  let reported = false, autoVal = null;
  const setVal = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  function submit(el) {
    const f = el.form;
    const b = (f || document).querySelector('button[type=submit],input[type=submit]') || (f && f.querySelector('button'));
    if (b) { b.click(); return; }
    if (f && f.requestSubmit) { f.requestSubmit(); return; }
    for (const n of ['keydown', 'keypress', 'keyup'])
      el.dispatchEvent(new KeyboardEvent(n, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  }
  W.addEventListener('message', e => {
    const m = e.data;
    if (!m || m.t !== 'pin' || autoVal !== null) return;
    const el = findPin();
    if (!el || el.value) return;
    autoVal = m.pin;
    setVal(el, m.pin);
    setTimeout(() => submit(el), 150);
    setTimeout(() => { if (findPin()) W.postMessage({ t: 'pin-bad', key }); }, 5000);
  });
  function capture() {
    const el = findPin();
    if (!el || !el.value || el.value === autoVal) return;
    W.postMessage({ t: 'pin-pending', key, pin: el.value });
    setTimeout(() => { if (!findPin()) W.postMessage({ t: 'pin-ok', key }); }, 3000);
  }
  document.addEventListener('submit', capture, true);
  document.addEventListener('keydown', e => { if (e.key === 'Enter') capture(); }, true);
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('button,input[type=submit]')) setTimeout(capture, 0); }, true);
  function check() { if (!reported && findPin()) { reported = true; W.postMessage({ t: 'pin-need', key }); } }
  function start() {
    new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    check();
    setTimeout(() => { if (!findPin()) W.postMessage({ t: 'pin-ok', key }); }, 2500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
""";
}
