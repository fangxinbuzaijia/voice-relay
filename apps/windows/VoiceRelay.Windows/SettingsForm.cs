namespace VoiceRelay.Windows;

internal sealed class SettingsForm : Form
{
    private readonly TextBox _host;
    private readonly NumericUpDown _port;
    private readonly CheckBox _secure;
    private readonly TextBox _deviceName;

    public SettingsForm(ClientSettings settings, Icon? applicationIcon = null)
    {
        Text = "Voice Relay 设置";
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        Width = 430;
        Height = 315;
        if (applicationIcon is not null) Icon = applicationIcon;

        _host = new TextBox { Dock = DockStyle.Fill, Text = settings.ServerHost };
        _port = new NumericUpDown { Dock = DockStyle.Fill, Minimum = 1, Maximum = 65535, Value = settings.ServerPort };
        _secure = new CheckBox { Text = "使用 HTTPS / WSS（推荐）", Checked = settings.Secure, AutoSize = true };
        _deviceName = new TextBox { Dock = DockStyle.Fill, Text = settings.DeviceName, MaxLength = 64 };
        var save = new Button { Text = "保存", DialogResult = DialogResult.OK, Dock = DockStyle.Fill, Height = 36 };
        var cancel = new Button { Text = "取消", DialogResult = DialogResult.Cancel, Dock = DockStyle.Fill, Height = 36 };

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(22), ColumnCount = 2, RowCount = 6 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        layout.Controls.Add(new Label { Text = "服务器域名或 IP", AutoSize = true }, 0, 0);
        layout.SetColumnSpan(_host, 2); layout.Controls.Add(_host, 0, 1);
        layout.Controls.Add(new Label { Text = "端口", AutoSize = true }, 0, 2);
        layout.Controls.Add(new Label { Text = "电脑名称", AutoSize = true }, 1, 2);
        layout.Controls.Add(_port, 0, 3); layout.Controls.Add(_deviceName, 1, 3);
        layout.SetColumnSpan(_secure, 2); layout.Controls.Add(_secure, 0, 4);
        layout.Controls.Add(cancel, 0, 5); layout.Controls.Add(save, 1, 5);
        Controls.Add(layout);
        AcceptButton = save;
        CancelButton = cancel;
        save.Click += (_, _) =>
        {
            if (!TryApply(settings))
            {
                DialogResult = DialogResult.None;
            }
        };
    }

    private bool TryApply(ClientSettings settings)
    {
        var host = _host.Text.Trim();
        if (string.IsNullOrWhiteSpace(host) || host.Contains("://", StringComparison.Ordinal) || host.Contains('/') || host.Contains('\\'))
        {
            MessageBox.Show(this, "服务器字段只填写域名或 IP，不要填写协议和路径。", "设置无效", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return false;
        }
        if (string.IsNullOrWhiteSpace(_deviceName.Text))
        {
            MessageBox.Show(this, "电脑名称不能为空。", "设置无效", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return false;
        }
        settings.ServerHost = host;
        settings.ServerPort = (int)_port.Value;
        settings.Secure = _secure.Checked;
        settings.DeviceName = _deviceName.Text.Trim();
        return true;
    }
}
