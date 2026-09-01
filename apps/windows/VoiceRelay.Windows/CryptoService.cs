using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Sodium;

namespace VoiceRelay.Windows;

internal sealed class CryptoService
{
    private readonly ClientSettings _settings;
    private readonly AppStateStore _store;
    private KeyPair? _keyPair;

    public CryptoService(ClientSettings settings, AppStateStore store)
    {
        _settings = settings;
        _store = store;
    }

    public string EnsurePublicKey()
    {
        EnsureKeyPair();
        return Convert.ToBase64String(_keyPair!.PublicKey);
    }

    public EncryptedPayload Decrypt(string ciphertext)
    {
        EnsureKeyPair();
        byte[] plain;
        try
        {
            plain = SealedPublicKeyBox.Open(Convert.FromBase64String(ciphertext), _keyPair!);
        }
        catch (Exception exception) when (exception is CryptographicException or FormatException or ArgumentException)
        {
            throw new CryptographicException("Unable to open the sealed message", exception);
        }
        return JsonSerializer.Deserialize<EncryptedPayload>(Encoding.UTF8.GetString(plain))
            ?? throw new JsonException("The encrypted payload is empty");
    }

    private void EnsureKeyPair()
    {
        if (_keyPair is not null) return;
        var privateKeyValue = AppStateStore.UnprotectString(_settings.ProtectedPrivateKey);
        if (privateKeyValue is not null)
        {
            try
            {
                _keyPair = PublicKeyBox.GenerateKeyPair(Convert.FromBase64String(privateKeyValue));
                return;
            }
            catch (Exception exception) when (exception is FormatException or CryptographicException or ArgumentException)
            {
                _settings.ProtectedPrivateKey = null;
                _settings.DeviceId = null;
            }
        }

        _keyPair = PublicKeyBox.GenerateKeyPair();
        _settings.ProtectedPrivateKey = AppStateStore.ProtectString(Convert.ToBase64String(_keyPair.PrivateKey));
        _store.Save(_settings);
    }
}
