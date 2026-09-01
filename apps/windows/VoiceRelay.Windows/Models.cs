using System.Text.Json.Serialization;

namespace VoiceRelay.Windows;

internal sealed class ClientSettings
{
    public string ServerHost { get; set; } = "localhost";
    public int ServerPort { get; set; } = 443;
    public bool Secure { get; set; } = true;
    public string DeviceName { get; set; } = Environment.MachineName;
    public string? ProtectedRefreshToken { get; set; }
    public string? DeviceId { get; set; }
    public string? ProtectedPrivateKey { get; set; }
}

internal sealed record LoginResponse(
    [property: JsonPropertyName("accessToken")] string AccessToken,
    [property: JsonPropertyName("accessExpiresAt")] long AccessExpiresAt,
    [property: JsonPropertyName("refreshToken")] string RefreshToken);

internal sealed record RefreshResponse(
    [property: JsonPropertyName("accessToken")] string AccessToken,
    [property: JsonPropertyName("accessExpiresAt")] long AccessExpiresAt,
    [property: JsonPropertyName("refreshToken")] string RefreshToken);

internal sealed record DeviceRegistrationResponse(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("publicKey")] string PublicKey);

internal sealed record EncryptedPayload(
    [property: JsonPropertyName("v")] int Version,
    [property: JsonPropertyName("messageId")] string? MessageId,
    [property: JsonPropertyName("sentAt")] long SentAt,
    [property: JsonPropertyName("text")] string? Text);

internal sealed record DuplicateEntry(
    [property: JsonPropertyName("messageId")] string MessageId,
    [property: JsonPropertyName("processedAt")] long ProcessedAt);

internal sealed record InjectionResult(string Status, string? Detail = null);
