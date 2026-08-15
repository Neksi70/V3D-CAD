using System.Runtime.InteropServices;

namespace VolmeThin.Builder;

/// <summary>
/// Setzt das Programmsymbol einer fertigen EXE. Muss vor dem Anhaengen des Pakets
/// laufen: die Ressourcen-API schreibt die Datei neu und wuerde ein Overlay verwerfen.
/// </summary>
public static class IconPatcher
{
    private const int RT_ICON = 3, RT_GROUP_ICON = 14;
    private const ushort LangNeutral = 0;

    public static void Apply(string exePath, string icoPath)
    {
        var ico = File.ReadAllBytes(icoPath);
        if (ico.Length < 6 || BitConverter.ToUInt16(ico, 2) != 1)
            throw new InvalidDataException("Keine gueltige .ico-Datei.");

        int count = BitConverter.ToUInt16(ico, 4);
        if (count == 0) throw new InvalidDataException(".ico enthaelt kein Bild.");

        ushort groupId = FindFirstGroupIconId(exePath) ?? 1;

        IntPtr h = BeginUpdateResource(exePath, false);
        if (h == IntPtr.Zero) throw new IOException($"Ressourcen nicht beschreibbar (Fehler {Marshal.GetLastWin32Error()}).");

        try
        {
            // Gruppenkopf: 6 Byte Kopf + 14 Byte je Bild
            var group = new byte[6 + 14 * count];
            Buffer.BlockCopy(ico, 0, group, 0, 6);

            for (int i = 0; i < count; i++)
            {
                int src = 6 + i * 16;
                int bytesInRes = BitConverter.ToInt32(ico, src + 8);
                int offset = BitConverter.ToInt32(ico, src + 12);
                if (offset < 0 || bytesInRes < 0 || offset + bytesInRes > ico.Length)
                    throw new InvalidDataException(".ico ist beschaedigt (Bildbereich ausserhalb der Datei).");

                var image = new byte[bytesInRes];
                Buffer.BlockCopy(ico, offset, image, 0, bytesInRes);

                ushort iconId = (ushort)(i + 1);
                if (!UpdateResource(h, (IntPtr)RT_ICON, (IntPtr)iconId, LangNeutral, image, image.Length))
                    throw new IOException($"Symbol {iconId} nicht schreibbar (Fehler {Marshal.GetLastWin32Error()}).");

                int dst = 6 + i * 14;
                Buffer.BlockCopy(ico, src, group, dst, 12);           // alles bis einschliesslich bytesInRes
                BitConverter.GetBytes(iconId).CopyTo(group, dst + 12); // statt Dateioffset steht hier die Ressourcen-ID
            }

            if (!UpdateResource(h, (IntPtr)RT_GROUP_ICON, (IntPtr)groupId, LangNeutral, group, group.Length))
                throw new IOException($"Symbolgruppe nicht schreibbar (Fehler {Marshal.GetLastWin32Error()}).");

            if (!EndUpdateResource(h, false))
                throw new IOException($"Ressourcen nicht speicherbar (Fehler {Marshal.GetLastWin32Error()}).");
            h = IntPtr.Zero;
        }
        finally
        {
            if (h != IntPtr.Zero) EndUpdateResource(h, true);   // Verwerfen
        }
    }

    /// <summary>Der Explorer zeigt die Symbolgruppe mit der kleinsten ID. Genau die muss ersetzt werden.</summary>
    private static ushort? FindFirstGroupIconId(string exePath)
    {
        IntPtr mod = LoadLibraryEx(exePath, IntPtr.Zero, 0x00000002 /* LOAD_LIBRARY_AS_DATAFILE */);
        if (mod == IntPtr.Zero) return null;
        try
        {
            ushort? found = null;
            EnumResourceNames(mod, (IntPtr)RT_GROUP_ICON, (m, type, name, l) =>
            {
                if ((long)name >> 16 == 0)   // ganzzahlige ID, kein Name
                {
                    ushort id = (ushort)(long)name;
                    if (found is null || id < found) found = id;
                }
                return true;
            }, IntPtr.Zero);
            return found;
        }
        finally { FreeLibrary(mod); }
    }

    private delegate bool EnumResNameProc(IntPtr module, IntPtr type, IntPtr name, IntPtr param);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr BeginUpdateResource(string fileName, bool deleteExistingResources);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort lang, byte[] data, int cb);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool EndUpdateResource(IntPtr update, bool discard);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool EnumResourceNames(IntPtr module, IntPtr type, EnumResNameProc callback, IntPtr param);
}

/// <summary>Uebernimmt das Symbol direkt aus einer anderen EXE/DLL, ohne Umweg ueber eine .ico-Datei.</summary>
public static class IconCopier
{
    private const int RT_ICON = 3, RT_GROUP_ICON = 14;
    private const ushort LangNeutral = 0;

    public static bool TryCopy(string sourceExe, string targetExe)
    {
        IntPtr src = LoadLibraryEx(sourceExe, IntPtr.Zero, 0x00000002);
        if (src == IntPtr.Zero) return false;

        try
        {
            ushort? groupId = null;
            EnumResourceNames(src, (IntPtr)RT_GROUP_ICON, (m, t, name, l) =>
            {
                if ((long)name >> 16 == 0)
                {
                    ushort id = (ushort)(long)name;
                    if (groupId is null || id < groupId) groupId = id;
                }
                return true;
            }, IntPtr.Zero);
            if (groupId is null) return false;

            var group = ReadResource(src, (IntPtr)RT_GROUP_ICON, (IntPtr)groupId.Value);
            if (group is null || group.Length < 6) return false;

            int count = BitConverter.ToUInt16(group, 4);
            var images = new List<(ushort Id, byte[] Data)>();
            for (int i = 0; i < count; i++)
            {
                int off = 6 + i * 14;
                if (off + 14 > group.Length) return false;
                ushort id = BitConverter.ToUInt16(group, off + 12);
                var data = ReadResource(src, (IntPtr)RT_ICON, (IntPtr)id);
                if (data is null) return false;
                images.Add((id, data));
            }

            IntPtr h = BeginUpdateResource(targetExe, false);
            if (h == IntPtr.Zero) return false;
            try
            {
                foreach (var (id, data) in images)
                    if (!UpdateResource(h, (IntPtr)RT_ICON, (IntPtr)id, LangNeutral, data, data.Length))
                        return false;

                ushort targetGroup = FindFirstGroupIconIdPublic(targetExe) ?? groupId.Value;
                if (!UpdateResource(h, (IntPtr)RT_GROUP_ICON, (IntPtr)targetGroup, LangNeutral, group, group.Length))
                    return false;

                bool ok = EndUpdateResource(h, false);
                h = IntPtr.Zero;
                return ok;
            }
            finally { if (h != IntPtr.Zero) EndUpdateResource(h, true); }
        }
        finally { FreeLibrary(src); }
    }

    private static ushort? FindFirstGroupIconIdPublic(string exePath)
    {
        IntPtr mod = LoadLibraryEx(exePath, IntPtr.Zero, 0x00000002);
        if (mod == IntPtr.Zero) return null;
        try
        {
            ushort? found = null;
            EnumResourceNames(mod, (IntPtr)RT_GROUP_ICON, (m, t, name, l) =>
            {
                if ((long)name >> 16 == 0)
                {
                    ushort id = (ushort)(long)name;
                    if (found is null || id < found) found = id;
                }
                return true;
            }, IntPtr.Zero);
            return found;
        }
        finally { FreeLibrary(mod); }
    }

    private static byte[]? ReadResource(IntPtr module, IntPtr type, IntPtr name)
    {
        IntPtr info = FindResource(module, name, type);
        if (info == IntPtr.Zero) return null;
        uint size = SizeofResource(module, info);
        IntPtr res = LoadResource(module, info);
        if (res == IntPtr.Zero || size == 0) return null;
        IntPtr ptr = LockResource(res);
        if (ptr == IntPtr.Zero) return null;
        var buf = new byte[size];
        Marshal.Copy(ptr, buf, 0, (int)size);
        return buf;
    }

    private delegate bool EnumResNameProc(IntPtr module, IntPtr type, IntPtr name, IntPtr param);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr BeginUpdateResource(string fileName, bool deleteExistingResources);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort lang, byte[] data, int cb);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool EndUpdateResource(IntPtr update, bool discard);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool EnumResourceNames(IntPtr module, IntPtr type, EnumResNameProc callback, IntPtr param);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr FindResource(IntPtr module, IntPtr name, IntPtr type);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LoadResource(IntPtr module, IntPtr res);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LockResource(IntPtr resData);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint SizeofResource(IntPtr module, IntPtr res);
}
