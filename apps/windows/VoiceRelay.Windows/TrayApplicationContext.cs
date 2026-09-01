namespace VoiceRelay.Windows;

internal sealed class TrayApplicationContext : ApplicationContext
{
    private readonly AppStateStore _store = new();
    private readonly ClientSettings _settings;
    private readonly Icon _appIcon;
    private readonly NotifyIcon _trayIcon;
    private readonly ToolStripMenuItem _statusItem;
    private readonly ToolStripMenuItem _pauseItem;
    private readonly ToolStripMenuItem _startupItem;
    private readonly Control _dispatcher = new();
    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private RelayApiClient? _api;
    private CryptoService? _crypto;
    private RelayClient? _relay;
    private string? _accessToken;
    private long _accessExpiresAt;
    private bool _exiting;
    private bool _refreshUnavailable;
    private bool _trayHintShown;
    private System.Windows.Forms.Timer? _startupRetryTimer;

    public TrayApplicationContext()
    {
        _settings = _store.Load();
        _dispatcher.CreateControl();
        var extractedIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        _appIcon = (Icon)(extractedIcon ?? SystemIcons.Application).Clone();
        extractedIcon?.Dispose();
        _statusItem = new ToolStripMenuItem("尚未连接") { Enabled = false };
        _pauseItem = new ToolStripMenuItem("暂停接收") { CheckOnClick = true };
        _startupItem = new ToolStripMenuItem("开机自动启动") { Checked = StartupManager.IsEnabled() };
        var settingsItem = new ToolStripMenuItem("服务器与设备设置");
        var loginItem = new ToolStripMenuItem("重新登录");
        var logoutItem = new ToolStripMenuItem("注销当前客户端");
        var exitItem = new ToolStripMenuItem("退出");
        var menu = new ContextMenuStrip();
        menu.Items.AddRange([_statusItem, new ToolStripSeparator(), _pauseItem, _startupItem, settingsItem,
            new ToolStripSeparator(), loginItem, logoutItem, new ToolStripSeparator(), exitItem]);
        _trayIcon = new NotifyIcon
        {
            Icon = _appIcon,
            Text = "Voice Relay",
            Visible = true,
            ContextMenuStrip = menu,
        };

        _pauseItem.CheckedChanged += (_, _) => _relay?.SetPaused(_pauseItem.Checked);
        _startupItem.Click += (_, _) => ToggleStartup();
        settingsItem.Click += async (_, _) => await ShowSettingsAsync();
        loginItem.Click += async (_, _) => await ForceLoginAsync();
        logoutItem.Click += async (_, _) => await LogoutAsync();
        exitItem.Click += async (_, _) => await ExitAsync();
        _trayIcon.DoubleClick += (_, _) => { _ = ShowSettingsAsync(); };
        Application.Idle += StartOnIdle;
    }

    protected override void ExitThreadCore()
    {
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
        _appIcon.Dispose();
        _dispatcher.Dispose();
        _api?.Dispose();
        _startupRetryTimer?.Dispose();
        _tokenLock.Dispose();
        base.ExitThreadCore();
    }

    private async void StartOnIdle(object? sender, EventArgs eventArgs)
    {
        Application.Idle -= StartOnIdle;
        if (string.IsNullOrWhiteSpace(_settings.ProtectedRefreshToken))
        {
            using var settingsForm = new SettingsForm(_settings, _appIcon);
            if (settingsForm.ShowDialog() != DialogResult.OK)
            {
                SetStatus("等待服务器设置", false);
                ShowTrayHint();
                return;
            }
            _store.Save(_settings);
        }
        await EnsureStartedAsync(showLoginWhenNeeded: true);
    }

    private async Task EnsureStartedAsync(bool showLoginWhenNeeded)
    {
        await StopRelayAsync();
        _api?.Dispose();
        _api = new RelayApiClient(_settings);
        _crypto = new CryptoService(_settings, _store);

        var authenticated = await TryRefreshAsync();
        if (!authenticated && _refreshUnavailable)
        {
            SetStatus("服务器暂时不可达，5 秒后重试", false);
            ScheduleStartupRetry();
            return;
        }
        if (!authenticated && showLoginWhenNeeded) authenticated = await ShowLoginAsync();
        if (!authenticated) { SetStatus("需要重新登录", false); return; }
        StopStartupRetry();

        if (_settings.DeviceId is null)
        {
            var publicKey = _crypto.EnsurePublicKey();
            var registration = await _api.RegisterDeviceAsync(_accessToken!, _settings.DeviceName, publicKey, CancellationToken.None);
            _settings.DeviceId = registration.Id;
            _store.Save(_settings);
        }

        _relay = new RelayClient(
            _api,
            _settings,
            _crypto,
            new DuplicateStore(_store.DataDirectory),
            new ClipboardInjector(_dispatcher),
            GetAccessTokenAsync);
        _relay.ConnectionChanged += SetStatus;
        _relay.DeliveryReported += message => _dispatcher.BeginInvoke((Action)(() =>
        {
            _trayIcon.BalloonTipTitle = "Voice Relay";
            _trayIcon.BalloonTipText = message;
            _trayIcon.ShowBalloonTip(2500);
        }));
        _relay.SetPaused(_pauseItem.Checked);
        _relay.Start();
    }

    private async Task<bool> TryRefreshAsync()
    {
        _refreshUnavailable = false;
        var refreshToken = AppStateStore.UnprotectString(_settings.ProtectedRefreshToken);
        if (refreshToken is null || _api is null) return false;
        try
        {
            var result = await _api.RefreshAsync(refreshToken, CancellationToken.None);
            StoreTokens(result.AccessToken, result.AccessExpiresAt, result.RefreshToken);
            return true;
        }
        catch (HttpRequestException exception) when (exception.StatusCode == System.Net.HttpStatusCode.Unauthorized)
        {
            _settings.ProtectedRefreshToken = null;
            _store.Save(_settings);
            return false;
        }
        catch (HttpRequestException)
        {
            _refreshUnavailable = true;
            return false;
        }
    }

    private void ScheduleStartupRetry()
    {
        StopStartupRetry();
        _startupRetryTimer = new System.Windows.Forms.Timer { Interval = 5_000 };
        _startupRetryTimer.Tick += RetryStartup;
        _startupRetryTimer.Start();
    }

    private async void RetryStartup(object? sender, EventArgs eventArgs)
    {
        StopStartupRetry();
        if (!_exiting) await EnsureStartedAsync(showLoginWhenNeeded: false);
    }

    private void StopStartupRetry()
    {
        if (_startupRetryTimer is null) return;
        _startupRetryTimer.Stop();
        _startupRetryTimer.Tick -= RetryStartup;
        _startupRetryTimer.Dispose();
        _startupRetryTimer = null;
    }

    private async Task<bool> ShowLoginAsync()
    {
        if (_api is null) return false;
        LoginResponse? loginResult = null;
        using var form = new LoginForm(_api.BaseUri, async (username, password, totp) =>
        {
            loginResult = await _api.LoginAsync(username, password, totp, CancellationToken.None);
        }, _appIcon);
        if (form.ShowDialog() != DialogResult.OK || loginResult is null)
        {
            ShowTrayHint();
            return false;
        }
        StoreTokens(loginResult.AccessToken, loginResult.AccessExpiresAt, loginResult.RefreshToken);
        return true;
    }

    private async Task<string> GetAccessTokenAsync(CancellationToken cancellationToken)
    {
        await _tokenLock.WaitAsync(cancellationToken);
        try
        {
            if (_accessToken is not null && _accessExpiresAt > DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 30_000)
                return _accessToken;
            var refreshToken = AppStateStore.UnprotectString(_settings.ProtectedRefreshToken)
                ?? throw new InvalidOperationException("登录会话已丢失，请重新登录");
            var result = await (_api ?? throw new InvalidOperationException("API client is not ready"))
                .RefreshAsync(refreshToken, cancellationToken);
            StoreTokens(result.AccessToken, result.AccessExpiresAt, result.RefreshToken);
            return result.AccessToken;
        }
        finally { _tokenLock.Release(); }
    }

    private void StoreTokens(string accessToken, long accessExpiresAt, string refreshToken)
    {
        _accessToken = accessToken;
        _accessExpiresAt = accessExpiresAt;
        _settings.ProtectedRefreshToken = AppStateStore.ProtectString(refreshToken);
        _store.Save(_settings);
    }

    private async Task ShowSettingsAsync()
    {
        var oldEndpoint = (_settings.ServerHost, _settings.ServerPort, _settings.Secure);
        var oldName = _settings.DeviceName;
        using var form = new SettingsForm(_settings, _appIcon);
        if (form.ShowDialog() != DialogResult.OK)
        {
            ShowTrayHint();
            return;
        }
        var endpointChanged = oldEndpoint != (_settings.ServerHost, _settings.ServerPort, _settings.Secure);
        if (endpointChanged)
        {
            var confirmation = MessageBox.Show("更改服务器会注销当前会话并生成新的设备身份。是否继续？", "确认更改服务器",
                MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (confirmation != DialogResult.Yes)
            {
                (_settings.ServerHost, _settings.ServerPort, _settings.Secure) = oldEndpoint;
                _settings.DeviceName = oldName;
                return;
            }
            AppStateStore.ClearIdentity(_settings);
            _accessToken = null;
            _accessExpiresAt = 0;
        }
        _store.Save(_settings);

        if (!endpointChanged && oldName != _settings.DeviceName && _settings.DeviceId is not null && _api is not null && _accessToken is not null)
        {
            try { await _api.RenameDeviceAsync(_accessToken, _settings.DeviceId, _settings.DeviceName, CancellationToken.None); }
            catch (HttpRequestException exception) { MessageBox.Show(exception.Message, "重命名失败", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        }
        if (endpointChanged) await EnsureStartedAsync(showLoginWhenNeeded: true);
    }

    private async Task ForceLoginAsync()
    {
        AppStateStore.ClearIdentity(_settings);
        _accessToken = null;
        _accessExpiresAt = 0;
        _store.Save(_settings);
        await EnsureStartedAsync(showLoginWhenNeeded: true);
    }

    private async Task LogoutAsync()
    {
        await StopRelayAsync();
        if (_api is not null && _accessToken is not null)
        {
            try { await _api.LogoutAsync(_accessToken, CancellationToken.None); }
            catch (HttpRequestException) { }
        }
        AppStateStore.ClearIdentity(_settings);
        _accessToken = null;
        _accessExpiresAt = 0;
        _store.Save(_settings);
        SetStatus("已注销", false);
    }

    private async Task StopRelayAsync()
    {
        if (_relay is null) return;
        _relay.ConnectionChanged -= SetStatus;
        await _relay.DisposeAsync();
        _relay = null;
    }

    private void SetStatus(string message, bool online)
    {
        if (_dispatcher.IsDisposed) return;
        _dispatcher.BeginInvoke((Action)(() =>
        {
            _statusItem.Text = message.Length > 60 ? message[..60] : message;
            _trayIcon.Text = online ? "Voice Relay · 在线" : "Voice Relay · 离线";
        }));
    }

    private void ToggleStartup()
    {
        var requested = !_startupItem.Checked;
        try
        {
            StartupManager.SetEnabled(requested);
            _startupItem.Checked = StartupManager.IsEnabled();
        }
        catch (Exception exception)
        {
            _startupItem.Checked = StartupManager.IsEnabled();
            MessageBox.Show($"无法修改开机自启动设置：{exception.Message}", "Voice Relay",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void ShowTrayHint()
    {
        if (_trayHintShown || _exiting) return;
        _trayHintShown = true;
        _trayIcon.BalloonTipTitle = "Voice Relay 仍在运行";
        _trayIcon.BalloonTipText = "窗口已关闭到系统托盘。双击图标打开设置，右键菜单可以退出。";
        _trayIcon.ShowBalloonTip(3500);
    }

    private async Task ExitAsync()
    {
        if (_exiting) return;
        _exiting = true;
        StopStartupRetry();
        await StopRelayAsync();
        ExitThread();
    }
}
