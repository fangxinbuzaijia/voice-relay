namespace VoiceRelay.Windows;

internal sealed class LoginForm : Form
{
    private readonly TextBox _username = new() { Dock = DockStyle.Fill };
    private readonly TextBox _password = new() { Dock = DockStyle.Fill, UseSystemPasswordChar = true };
    private readonly TextBox _totp = new() { Dock = DockStyle.Fill, MaxLength = 6 };
    private readonly Label _error = new() { Dock = DockStyle.Fill, ForeColor = Color.Firebrick, AutoSize = true };
    private readonly Button _login = new() { Text = "登录", Dock = DockStyle.Fill, Height = 36 };
    private readonly Func<string, string, string, Task> _loginAction;

    public LoginForm(Uri server, Func<string, string, string, Task> loginAction, Icon? applicationIcon = null)
    {
        _loginAction = loginAction;
        Text = "Voice Relay 登录";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        Width = 420;
        Height = 330;
        if (applicationIcon is not null) Icon = applicationIcon;
        AcceptButton = _login;

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(22), ColumnCount = 1, RowCount = 9 };
        layout.Controls.Add(new Label { Text = $"服务器：{server.Authority}", AutoSize = true, ForeColor = Color.DimGray });
        layout.Controls.Add(new Label { Text = "账号", AutoSize = true });
        layout.Controls.Add(_username);
        layout.Controls.Add(new Label { Text = "密码", AutoSize = true });
        layout.Controls.Add(_password);
        layout.Controls.Add(new Label { Text = "六位动态验证码（启用二步验证后必填）", AutoSize = true });
        layout.Controls.Add(_totp);
        layout.Controls.Add(_error);
        layout.Controls.Add(_login);
        Controls.Add(layout);
        _login.Click += LoginClicked;
        _totp.KeyPress += (_, eventArgs) =>
        {
            if (!char.IsControl(eventArgs.KeyChar) && !char.IsDigit(eventArgs.KeyChar)) eventArgs.Handled = true;
        };
    }

    private async void LoginClicked(object? sender, EventArgs eventArgs)
    {
        if (_totp.Text.Length is > 0 and < 6) { _error.Text = "动态验证码应为六位数字，也可以留空。"; return; }
        _login.Enabled = false;
        _error.Text = "";
        try
        {
            await _loginAction(_username.Text.Trim(), _password.Text, _totp.Text);
            DialogResult = DialogResult.OK;
            Close();
        }
        catch (Exception exception)
        {
            _error.Text = exception.Message;
            _login.Enabled = true;
        }
    }
}
