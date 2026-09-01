using System.Net.Http.Json;
using System.Text.Json;

namespace VoiceRelay.Windows;

internal sealed class RelayApiClient : IDisposable
{
    private readonly HttpClient _httpClient = new();
    private readonly ClientSettings _settings;

    public RelayApiClient(ClientSettings settings)
    {
        _settings = settings;
        _httpClient.Timeout = TimeSpan.FromSeconds(15);
    }

    public Uri BaseUri => BuildUri("/");
    public Uri WebSocketUri => BuildUri("/ws", webSocket: true);

    public async Task<LoginResponse> LoginAsync(string username, string password, string totp, CancellationToken cancellationToken)
    {
        using var response = await _httpClient.PostAsJsonAsync(BuildUri("/api/v1/auth/login"), new
        {
            username,
            password,
            totp = string.IsNullOrWhiteSpace(totp) ? null : totp,
            clientType = "windows",
        }, cancellationToken);
        return await ReadRequiredAsync<LoginResponse>(response, cancellationToken);
    }

    public async Task<RefreshResponse> RefreshAsync(string refreshToken, CancellationToken cancellationToken)
    {
        using var response = await _httpClient.PostAsJsonAsync(BuildUri("/api/v1/auth/refresh"), new { refreshToken }, cancellationToken);
        return await ReadRequiredAsync<RefreshResponse>(response, cancellationToken);
    }

    public async Task<DeviceRegistrationResponse> RegisterDeviceAsync(string accessToken, string name, string publicKey, CancellationToken cancellationToken)
    {
        using var request = AuthorizedRequest(HttpMethod.Post, "/api/v1/devices", accessToken);
        request.Content = JsonContent.Create(new { name, publicKey });
        using var response = await _httpClient.SendAsync(request, cancellationToken);
        return await ReadRequiredAsync<DeviceRegistrationResponse>(response, cancellationToken);
    }

    public async Task RenameDeviceAsync(string accessToken, string deviceId, string name, CancellationToken cancellationToken)
    {
        using var request = AuthorizedRequest(HttpMethod.Patch, $"/api/v1/devices/{Uri.EscapeDataString(deviceId)}", accessToken);
        request.Content = JsonContent.Create(new { name });
        using var response = await _httpClient.SendAsync(request, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task LogoutAsync(string accessToken, CancellationToken cancellationToken)
    {
        using var request = AuthorizedRequest(HttpMethod.Post, "/api/v1/auth/logout", accessToken);
        using var response = await _httpClient.SendAsync(request, cancellationToken);
        if (response.StatusCode != System.Net.HttpStatusCode.Unauthorized)
            await EnsureSuccessAsync(response, cancellationToken);
    }

    public void Dispose() => _httpClient.Dispose();

    private Uri BuildUri(string path, bool webSocket = false)
    {
        var scheme = webSocket
            ? (_settings.Secure ? "wss" : "ws")
            : (_settings.Secure ? "https" : "http");
        return new UriBuilder(scheme, _settings.ServerHost, _settings.ServerPort, path).Uri;
    }

    private HttpRequestMessage AuthorizedRequest(HttpMethod method, string path, string accessToken)
    {
        var request = new HttpRequestMessage(method, BuildUri(path));
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
        return request;
    }

    private static async Task<T> ReadRequiredAsync<T>(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        await EnsureSuccessAsync(response, cancellationToken);
        return await response.Content.ReadFromJsonAsync<T>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Server returned an empty response");
    }

    private static async Task EnsureSuccessAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode) return;
        var detail = await response.Content.ReadAsStringAsync(cancellationToken);
        string code;
        try
        {
            using var document = JsonDocument.Parse(detail);
            code = document.RootElement.TryGetProperty("error", out var error) ? error.GetString() ?? detail : detail;
        }
        catch (JsonException)
        {
            code = detail;
        }
        throw new HttpRequestException($"Server rejected the request ({(int)response.StatusCode}): {code}", null, response.StatusCode);
    }
}
