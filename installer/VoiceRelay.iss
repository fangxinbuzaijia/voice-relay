#define MyAppName "Voice Relay"
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#define MyAppPublisher "Voice Relay"
#define MyAppExeName "VoiceRelay.exe"

[Setup]
AppId={{BE219976-1BF9-4B89-BFC0-4550A68A8818}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\VoiceRelay
DefaultGroupName={#MyAppName}
PrivilegesRequired=lowest
OutputDir=..\artifacts\installer
OutputBaseFilename=VoiceRelay-Setup-{#MyAppVersion}-win-x64

Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\apps\windows\VoiceRelay.Windows\Assets\VoiceRelay.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[Files]
Source: "..\artifacts\windows\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加快捷方式："
Name: "autostart"; Description: "登录 Windows 后自动启动"; GroupDescription: "启动选项："; Flags: checkedonce

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "VoiceRelay"; ValueData: """{app}\{#MyAppExeName}"""; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent
