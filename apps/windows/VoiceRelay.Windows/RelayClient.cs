using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace VoiceRelay.Windows;

internal sealed class RelayClient : IAsyncDisposable
{
    private const int ProtocolVersion = 1;
    private const int MaxTextCodeUnits = 10_000;
    private const long ClockSkewMs = 30_000;
    private readonly RelayApiClient _api;
    private readonly ClientSettings _settings;
    private readonly CryptoService _crypto;
    private readonly DuplicateStore _duplicates;
    private readonly ClipboardInjector _injector;
    private readonly Func<CancellationToken, Task<string>> _getAccessToken;
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private readonly CancellationTokenSource _stop = new();
    private ClientWebSocket? _socket;
    private Task? _runTask;
    private volatile bool _paused;

    public RelayClient(
        RelayApiClient api,
        ClientSettings settings,
        CryptoService crypto,
        DuplicateStore duplicates,
        ClipboardInjector injector,
        Func<CancellationToken, Task<string>> getAccessToken)
    {
        _api = api;
        _settings = settings;
        _crypto = crypto;
        _duplicates = duplicates;
        _injector = injector;
        _getAccessToken = getAccessToken;
    }

    public event Action<string, bool>? ConnectionChanged;
    public event Action<string>? DeliveryReported;

    public bool Paused => _paused;

    public void Start()
    {
        _runTask ??= RunAsync(_stop.Token);
    }

    public void SetPaused(bool paused)
    {
        _paused = paused;
        _ = SendPauseBestEffortAsync(paused);
    }

    public async ValueTask DisposeAsync()
    {
        _stop.Cancel();
        if (_socket is { State: WebSocketState.Open or WebSocketState.Connecting })
        {
            try { await _socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Client exiting", CancellationToken.None); }
            catch (WebSocketException) { }
        }
        if (_runTask is not null)
        {
            try { await _runTask; }
            catch (OperationCanceledException) { }
        }
        _socket?.Dispose();
        _sendLock.Dispose();
        _stop.Dispose();
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var accessToken = await _getAccessToken(cancellationToken);
                using var socket = new ClientWebSocket();
                socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
                _socket = socket;
                ConnectionChanged?.Invoke("正在连接服务器", false);
                await socket.ConnectAsync(_api.WebSocketUri, cancellationToken);
                await SendAsync(new
                {
                    v = ProtocolVersion,
                    type = "auth",
                    accessToken,
                    clientType = "windows",
                    deviceId = _settings.DeviceId,
                }, cancellationToken);
                await ReceiveLoopAsync(socket, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception) when (exception is WebSocketException or HttpRequestException or InvalidOperationException or JsonException)
            {
                ConnectionChanged?.Invoke(exception.Message, false);
            }
            finally
            {
                _socket = null;
            }

            try { await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task ReceiveLoopAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        using var heartbeatCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var heartbeatTask = HeartbeatLoopAsync(heartbeatCancellation.Token);
        try
        {
            while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            {
                var json = await ReceiveMessageAsync(socket, cancellationToken);
                if (json is null) break;
                using var document = JsonDocument.Parse(json);
                var root = document.RootElement;
                var type = root.TryGetProperty("type", out var typeProperty) ? typeProperty.GetString() : null;
                switch (type)
                {
                    case "auth.ok":
                        ConnectionChanged?.Invoke(_paused ? "在线 · 已暂停" : "在线 · 正在接收", true);
                        await SendAsync(new { v = ProtocolVersion, type = "device.pause", paused = _paused }, cancellationToken);
                        break;
                    case "text.deliver":
                        await HandleDeliveryAsync(root, cancellationToken);
                        break;
                    case "error":
                        var code = root.TryGetProperty("code", out var codeProperty) ? codeProperty.GetString() : "server_error";
                        ConnectionChanged?.Invoke($"服务器错误：{code}", false);
                        break;
                }
            }
        }
        finally
        {
            heartbeatCancellation.Cancel();
            try { await heartbeatTask; }
            catch (OperationCanceledException) { }
        }
    }

    private async Task HandleDeliveryAsync(JsonElement root, CancellationToken cancellationToken)
    {
        var messageId = root.GetProperty("messageId").GetString();
        var sentAt = root.GetProperty("sentAt").GetInt64();
        var ciphertext = root.GetProperty("ciphertext").GetString();
        if (messageId is null || ciphertext is null || !Guid.TryParse(messageId, out _)) return;

        if (_duplicates.Contains(messageId))
        {
            await SendAckAsync(messageId, "duplicate", null, cancellationToken);
            return;
        }
        if (_paused)
        {
            await SendAckAsync(messageId, "paused", null, cancellationToken);
            return;
        }

        EncryptedPayload payload;
        try
        {
            payload = _crypto.Decrypt(ciphertext);
        }
        catch (Exception exception) when (exception is CryptographicException or JsonException)
        {
            await SendAckAsync(messageId, "decrypt_failed", null, cancellationToken);
            return;
        }

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (payload.Version != ProtocolVersion || payload.MessageId != messageId || payload.SentAt != sentAt ||
            Math.Abs(now - payload.SentAt) > ClockSkewMs || payload.Text is null || payload.Text.Length > MaxTextCodeUnits)
        {
            await SendAckAsync(messageId, "invalid_payload", null, cancellationToken);
            return;
        }

        var result = await _injector.PasteAsync(payload.Text, payload.SubmitWithEnter, cancellationToken);
        if (result.Status == "injected") _duplicates.Add(messageId);
        await SendAckAsync(messageId, result.Status, result.Detail, cancellationToken);
        DeliveryReported?.Invoke(result.Status == "injected" ? "文字已粘贴" : $"粘贴失败：{result.Status}");
    }

    private async Task HeartbeatLoopAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(20));
        while (await timer.WaitForNextTickAsync(cancellationToken))
        {
            await SendAsync(new
            {
                v = ProtocolVersion,
                type = "heartbeat",
                at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            }, cancellationToken);
        }
    }

    private Task SendAckAsync(string messageId, string status, string? detail, CancellationToken cancellationToken)
    {
        object frame = detail is null
            ? new { v = ProtocolVersion, type = "text.ack", messageId, status }
            : new { v = ProtocolVersion, type = "text.ack", messageId, status, detail };
        return SendAsync(frame, cancellationToken);
    }

    private async Task SendPauseBestEffortAsync(bool paused)
    {
        try
        {
            await SendAsync(new { v = ProtocolVersion, type = "device.pause", paused }, _stop.Token);
            ConnectionChanged?.Invoke(paused ? "在线 · 已暂停" : "在线 · 正在接收", true);
        }
        catch (Exception exception) when (exception is WebSocketException or InvalidOperationException or OperationCanceledException)
        {
            // The connection loop will publish the authoritative state after reconnecting.
        }
    }

    private async Task SendAsync(object frame, CancellationToken cancellationToken)
    {
        var socket = _socket;
        if (socket is null || socket.State != WebSocketState.Open) throw new InvalidOperationException("WebSocket is not connected");
        var bytes = JsonSerializer.SerializeToUtf8Bytes(frame);
        await _sendLock.WaitAsync(cancellationToken);
        try { await socket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken); }
        finally { _sendLock.Release(); }
    }

    private static async Task<string?> ReceiveMessageAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[16 * 1024];
        using var stream = new MemoryStream();
        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close) return null;
            if (result.MessageType != WebSocketMessageType.Text) throw new WebSocketException("Only text WebSocket frames are supported");
            stream.Write(buffer, 0, result.Count);
            if (stream.Length > 128 * 1024) throw new WebSocketException("Server frame exceeds 128 KiB");
            if (result.EndOfMessage) return Encoding.UTF8.GetString(stream.ToArray());
        }
    }
}

