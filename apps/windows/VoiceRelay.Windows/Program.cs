namespace VoiceRelay.Windows;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        using var singleInstance = new Mutex(true, @"Local\VoiceRelay.Windows.SingleInstance", out var isFirstInstance);
        if (!isFirstInstance)
        {
            MessageBox.Show("Voice Relay 已经在右下角系统托盘中运行。", "Voice Relay",
                MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.Run(new TrayApplicationContext());
    }
}
