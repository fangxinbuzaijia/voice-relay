using System.Text;
using System.Security.Cryptography;
using Sodium;
using Xunit;

namespace VoiceRelay.Windows.Tests;

public sealed class SecurityPersistenceTests
{
    [Fact]
    public void SendInputStructureMatchesNativeWindowsAbi()
    {
        Assert.Equal(IntPtr.Size == 8 ? 40 : 28, ClipboardInjector.NativeInputSize);
    }

    [Fact]
    public void StartupCommandQuotesExecutablePaths()
    {
        Assert.Equal("\"C:\\Program Files\\Voice Relay\\VoiceRelay.exe\"",
            StartupManager.BuildCommand("C:\\Program Files\\Voice Relay\\VoiceRelay.exe"));
    }

    [Fact]
    public void OpensBrowserGeneratedSealedBoxVector()
    {
        const string publicKey = "RwHQhIhFH1RaQJ+1iuPlhYHKQKw/fxFGmM1x3qxzygE=";
        const string privateKey = "PZTupJxYCu+BaTV2K+BJVZ1tFEDe3hLmoSXxhB//jm8=";
        const string ciphertext = "vZ8c4ZRyjCmoQNNIo25t+lsxvM78PDoOR5Rcb1j/YljsxDLLxNEUjlN6nFIV83/kSdZC/uA5JomLH7U1xOhADDxpiIwyYPy/RAdg+FC9TPs/MfvMves1AmXiMRjJziPWNWue19Q4VjohJJCGg5vZKkuFJAs2GMKxClfD1efPBhYQcRFLcqMatoecFzurNxWrK8l8QZdzar+W5u+pd8neZg+GipezFFfJZVo=";
        const string expected = "{\"v\":1,\"messageId\":\"11111111-2222-4333-8444-555555555555\",\"sentAt\":1893456000000,\"text\":\"中文 English\\n第二行\\t🙂\"}";

        var keyPair = new KeyPair(Convert.FromBase64String(publicKey), Convert.FromBase64String(privateKey));
        var plaintext = SealedPublicKeyBox.Open(Convert.FromBase64String(ciphertext), keyPair);

        Assert.Equal(expected, Encoding.UTF8.GetString(plaintext));
    }

    [Fact]
    public void CryptoServiceRejectsTamperedBrowserCiphertext()
    {
        const string privateKey = "PZTupJxYCu+BaTV2K+BJVZ1tFEDe3hLmoSXxhB//jm8=";
        const string ciphertext = "vZ8c4ZRyjCmoQNNIo25t+lsxvM78PDoOR5Rcb1j/YljsxDLLxNEUjlN6nFIV83/kSdZC/uA5JomLH7U1xOhADDxpiIwyYPy/RAdg+FC9TPs/MfvMves1AmXiMRjJziPWNWue19Q4VjohJJCGg5vZKkuFJAs2GMKxClfD1efPBhYQcRFLcqMatoecFzurNxWrK8l8QZdzar+W5u+pd8neZg+GipezFFfJZVo=";
        var directory = Path.Combine(Path.GetTempPath(), $"voice-relay-test-{Guid.NewGuid():N}");
        var settings = new ClientSettings { ProtectedPrivateKey = AppStateStore.ProtectString(privateKey) };
        var crypto = new CryptoService(settings, new AppStateStore(directory));
        var tampered = Convert.FromBase64String(ciphertext);
        tampered[^1] ^= 0x01;

        try
        {
            Assert.Throws<CryptographicException>(() => crypto.Decrypt(Convert.ToBase64String(tampered)));
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }

    [Fact]
    public void DpapiRoundTripIsBoundToCurrentUser()
    {
        const string secret = "refresh-token-机密🙂";
        var protectedValue = AppStateStore.ProtectString(secret);

        Assert.NotEqual(secret, protectedValue);
        Assert.Equal(secret, AppStateStore.UnprotectString(protectedValue));
        Assert.Null(AppStateStore.UnprotectString("not-base64"));
    }

    [Fact]
    public void DuplicateIdsSurviveStoreReload()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"voice-relay-test-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        try
        {
            var first = new DuplicateStore(directory);
            first.Add("message-1");

            var second = new DuplicateStore(directory);
            Assert.True(second.Contains("message-1"));
            Assert.False(second.Contains("message-2"));
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }
}
