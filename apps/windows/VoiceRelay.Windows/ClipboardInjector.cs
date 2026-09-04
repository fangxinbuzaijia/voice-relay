using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace VoiceRelay.Windows;

internal sealed class ClipboardInjector
{
    private const uint InputKeyboard = 1;
    private const uint KeyEventKeyUp = 0x0002;
    private const ushort VirtualKeyControl = 0x11;
    private const ushort VirtualKeyShift = 0x10;
    private const ushort VirtualKeyMenu = 0x12;
    private const ushort VirtualKeyLeftWindows = 0x5B;
    private const ushort VirtualKeyRightWindows = 0x5C;
    private const ushort VirtualKeyV = 0x56;
    private const ushort VirtualKeyReturn = 0x0D;
    private const uint DesktopSwitchDesktop = 0x0100;
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const uint TokenQuery = 0x0008;
    private const int TokenIntegrityLevel = 25;
    private readonly Control _dispatcher;

    internal static int NativeInputSize => Marshal.SizeOf<INPUT>();

    public ClipboardInjector(Control dispatcher)
    {
        _dispatcher = dispatcher;
    }

    public async Task<InjectionResult> PasteAsync(string text, bool submitWithEnter, CancellationToken cancellationToken)
    {
        if (!IsInteractiveDesktopAvailable()) return new InjectionResult("desktop_locked");
        var foreground = GetForegroundWindow();
        if (foreground == IntPtr.Zero) return new InjectionResult("no_foreground_window");
        if (IsModifierPressed()) return new InjectionResult("modifier_pressed");
        if (IsHigherIntegrityTarget(foreground)) return new InjectionResult("target_elevated");

        var clipboardWritten = false;
        for (var attempt = 0; attempt < 20 && !clipboardWritten; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                _dispatcher.Invoke(() => Clipboard.SetText(text, TextDataFormat.UnicodeText));
                clipboardWritten = true;
            }
            catch (ExternalException)
            {
                await Task.Delay(50, cancellationToken);
            }
        }
        if (!clipboardWritten) return new InjectionResult("clipboard_busy");
        if (GetForegroundWindow() != foreground) return new InjectionResult("focus_changed");
        if (IsModifierPressed()) return new InjectionResult("modifier_pressed");

        var pasteInputs = new[]
        {
            KeyboardInput(VirtualKeyControl, 0),
            KeyboardInput(VirtualKeyV, 0),
            KeyboardInput(VirtualKeyV, KeyEventKeyUp),
            KeyboardInput(VirtualKeyControl, KeyEventKeyUp),
        };
        var sentPaste = SendInput((uint)pasteInputs.Length, pasteInputs, Marshal.SizeOf<INPUT>());
        if (sentPaste != (uint)pasteInputs.Length)
        {
            var error = Marshal.GetLastWin32Error();
            return new InjectionResult("input_failed", error == 0 ? null : new Win32Exception(error).Message);
        }
        if (submitWithEnter)
        {
            if (GetForegroundWindow() != foreground) return new InjectionResult("focus_changed");
            if (IsModifierPressed()) return new InjectionResult("modifier_pressed");
            var enterInputs = new[]
            {
                KeyboardInput(VirtualKeyReturn, 0),
                KeyboardInput(VirtualKeyReturn, KeyEventKeyUp),
            };
            var sentEnter = SendInput((uint)enterInputs.Length, enterInputs, Marshal.SizeOf<INPUT>());
            if (sentEnter != (uint)enterInputs.Length)
            {
                var error = Marshal.GetLastWin32Error();
                return new InjectionResult("input_failed", error == 0 ? null : new Win32Exception(error).Message);
            }
        }
        return new InjectionResult("injected");
    }

    private static bool IsInteractiveDesktopAvailable()
    {
        var desktop = OpenInputDesktop(0, false, DesktopSwitchDesktop);
        if (desktop == IntPtr.Zero) return false;
        try { return SwitchDesktop(desktop); }
        finally { CloseDesktop(desktop); }
    }

    private static bool IsModifierPressed() =>
        IsKeyPressed(VirtualKeyControl) || IsKeyPressed(VirtualKeyShift) || IsKeyPressed(VirtualKeyMenu) ||
        IsKeyPressed(VirtualKeyLeftWindows) || IsKeyPressed(VirtualKeyRightWindows);

    private static bool IsKeyPressed(int virtualKey) => (GetAsyncKeyState(virtualKey) & 0x8000) != 0;

    private static bool IsHigherIntegrityTarget(IntPtr window)
    {
        GetWindowThreadProcessId(window, out var processId);
        if (processId == 0) return false;
        var currentLevel = GetProcessIntegrityLevel(Process.GetCurrentProcess().Handle);
        var process = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (process == IntPtr.Zero) return false;
        try
        {
            var targetLevel = GetProcessIntegrityLevel(process);
            return currentLevel.HasValue && targetLevel.HasValue && targetLevel.Value > currentLevel.Value;
        }
        finally { CloseHandle(process); }
    }

    private static int? GetProcessIntegrityLevel(IntPtr process)
    {
        if (!OpenProcessToken(process, TokenQuery, out var token)) return null;
        try
        {
            _ = GetTokenInformation(token, TokenIntegrityLevel, IntPtr.Zero, 0, out var length);
            if (length == 0) return null;
            var buffer = Marshal.AllocHGlobal((int)length);
            try
            {
                if (!GetTokenInformation(token, TokenIntegrityLevel, buffer, length, out _)) return null;
                var label = Marshal.PtrToStructure<TOKEN_MANDATORY_LABEL>(buffer);
                var countPointer = GetSidSubAuthorityCount(label.Label.Sid);
                if (countPointer == IntPtr.Zero) return null;
                var count = Marshal.ReadByte(countPointer);
                if (count == 0) return null;
                var authority = GetSidSubAuthority(label.Label.Sid, (uint)(count - 1));
                return authority == IntPtr.Zero ? null : Marshal.ReadInt32(authority);
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        finally { CloseHandle(token); }
    }

    private static INPUT KeyboardInput(ushort virtualKey, uint flags) => new()
    {
        Type = InputKeyboard,
        Union = new INPUT_UNION
        {
            Keyboard = new KEYBDINPUT { VirtualKey = virtualKey, Flags = flags },
        },
    };

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint Type;
        public INPUT_UNION Union;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct INPUT_UNION
    {
        [FieldOffset(0)] public MOUSEINPUT Mouse;
        [FieldOffset(0)] public KEYBDINPUT Keyboard;
        [FieldOffset(0)] public HARDWAREINPUT Hardware;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int X;
        public int Y;
        public uint MouseData;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort VirtualKey;
        public ushort ScanCode;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HARDWAREINPUT
    {
        public uint Message;
        public ushort ParamLow;
        public ushort ParamHigh;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SID_AND_ATTRIBUTES
    {
        public IntPtr Sid;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TOKEN_MANDATORY_LABEL
    {
        public SID_AND_ATTRIBUTES Label;
    }

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int virtualKey);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint desiredAccess);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SwitchDesktop(IntPtr desktop);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int informationClass, IntPtr information, uint informationLength, out uint returnLength);
    [DllImport("advapi32.dll")] private static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
    [DllImport("advapi32.dll")] private static extern IntPtr GetSidSubAuthority(IntPtr sid, uint subAuthority);
}

