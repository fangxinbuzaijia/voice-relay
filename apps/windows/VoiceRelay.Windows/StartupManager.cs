using Microsoft.Win32;

namespace VoiceRelay.Windows;

internal static class StartupManager
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "VoiceRelay";

    public static bool IsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, false);
        return key?.GetValue(ValueName) is string;
    }

    internal static string BuildCommand(string executablePath) => $"\"{executablePath}\"";

    public static void SetEnabled(bool enabled)
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, true) ?? Registry.CurrentUser.CreateSubKey(RunKey, true);
        if (enabled) key.SetValue(ValueName, BuildCommand(Application.ExecutablePath), RegistryValueKind.String);
        else key.DeleteValue(ValueName, false);
    }
}
