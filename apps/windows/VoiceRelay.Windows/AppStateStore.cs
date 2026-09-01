using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace VoiceRelay.Windows;

internal sealed class AppStateStore
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };
    private readonly string _directory;
    private readonly string _settingsPath;

    public AppStateStore(string? dataDirectory = null)
    {
        _directory = dataDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VoiceRelay");
        _settingsPath = Path.Combine(_directory, "settings.json");
        Directory.CreateDirectory(_directory);
    }

    public string DataDirectory => _directory;

    public ClientSettings Load()
    {
        if (!File.Exists(_settingsPath)) return new ClientSettings();
        try
        {
            return JsonSerializer.Deserialize<ClientSettings>(File.ReadAllText(_settingsPath), JsonOptions) ?? new ClientSettings();
        }
        catch (JsonException)
        {
            return new ClientSettings();
        }
    }

    public void Save(ClientSettings settings)
    {
        Directory.CreateDirectory(_directory);
        var temporaryPath = _settingsPath + ".tmp";
        File.WriteAllText(temporaryPath, JsonSerializer.Serialize(settings, JsonOptions));
        File.Move(temporaryPath, _settingsPath, true);
    }

    public static string ProtectString(string value)
    {
        var protectedBytes = ProtectedData.Protect(Encoding.UTF8.GetBytes(value), null, DataProtectionScope.CurrentUser);
        return Convert.ToBase64String(protectedBytes);
    }

    public static string? UnprotectString(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        try
        {
            var bytes = ProtectedData.Unprotect(Convert.FromBase64String(value), null, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(bytes);
        }
        catch (CryptographicException)
        {
            return null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    public static void ClearIdentity(ClientSettings settings)
    {
        settings.ProtectedRefreshToken = null;
        settings.DeviceId = null;
        settings.ProtectedPrivateKey = null;
    }
}
