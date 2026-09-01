# Voice Relay / 文字接力

[English](README.en.md) · [更新记录](CHANGELOG.md) · [安全说明](SECURITY.md) · [参与贡献](CONTRIBUTING.md)

把手机系统语音输入得到的文字，安全地发送到指定 Windows 电脑，并粘贴进当前输入框。

`手机 PWA → HTTPS/反向代理 → 转发服务 → Windows 托盘客户端 → Unicode 剪贴板 + Ctrl+V`

![手机发送页面](docs/images/web-preview.png)

## 特点

- 手机端是可添加到主屏幕的 PWA，无需安装原生 App。
- 支持区分多台 Windows 电脑，并显示在线、离线和暂停状态。
- 消息使用目标电脑的 Curve25519 公钥加密；服务端不保存消息。
- Windows 客户端常驻托盘，关闭窗口不会退出，支持开机自动启动。
- 完整保留 Unicode 纯文本，包括中文、表情、换行和制表符，不自动按回车。
- 单账户、自托管、二步验证可选，兼容 Google Authenticator、Microsoft Authenticator 和 Bitwarden。
- 服务只提供内部 HTTP 端口，不占用或配置 80/443、证书和反向代理。

## 三分钟部署服务端

要求：Linux、Docker Compose v2，以及由你自己维护的域名、HTTPS 和反向代理。

```bash
mkdir voice-relay && cd voice-relay
curl -LO https://raw.githubusercontent.com/fangxinbuzaijia/voice-relay/main/docker-compose.yml
docker compose up -d
docker compose exec relay cat /data/initial-credentials.txt
```

Compose 默认只把服务映射到宿主机的 `127.0.0.1:3100`，不会监听 80/443。首次启动会自动生成：

- `/data/master.key`：32 字节服务端主密钥。
- 唯一账户：用户名和密码均为 8 位随机字母数字。
- `/data/initial-credentials.txt`：首次登录凭据；修改用户名或密码后自动删除。

登录后建议立即修改用户名和密码。二步验证默认关闭，可在“账户安全”中扫码开启。

### 更改监听地址或端口

无需创建 `.env`。需要让其他机器直接访问内部端口时，可以临时传入 Compose 变量：

```bash
BIND_ADDRESS=0.0.0.0 APP_PORT=3100 docker compose up -d
```

公网访问必须使用有效 HTTPS。反向代理应把同一域名根路径下的 `/`、`/api/v1/*`、`/ws` 和健康检查转发到 `127.0.0.1:3100`，并保留外部 `Host` 和 WebSocket Upgrade。项目不支持部署到任意 URL 子目录。示例见 [反向代理说明](docs/reverse-proxy.md)。

## 安装 Windows 客户端

打开仓库的 [Releases](https://github.com/fangxinbuzaijia/voice-relay/releases)，下载：

- `VoiceRelay-Setup-版本-win-x64.exe`：推荐的按用户安装程序。
- `VoiceRelay-版本-win-x64-portable.zip`：免安装便携版。

客户端首次启动时填写服务器域名/IP、端口、HTTPS 开关和电脑名称，然后使用服务端账户登录。只有账户已经启用二步验证时才需要填写动态码。

关闭设置或登录窗口只会缩到系统托盘。必须从托盘右键菜单选择“退出”才会结束客户端；同一菜单可以切换暂停接收和开机自动启动。

## 手机端使用

1. 用 Android Chrome 或 iPhone Safari 打开你的 HTTPS 域名。
2. 登录并选择一台在线电脑。
3. 点击文本框，使用手机输入法自带的麦克风完成语音转文字。
4. 校对后发送，Windows 客户端会把文字写入剪贴板并提交一次 `Ctrl+V`。
5. 需要时把网页添加到手机主屏幕，获得接近 App 的使用体验。

手机历史只保存在当前浏览器的 IndexedDB 中，最多 100 条且最长保留 30 天。ACK 丢失时页面会显示“结果未知”，不会自动重发，以免重复粘贴。

## 账户恢复

忘记密码或丢失二步验证时，在服务器运行：

```bash
docker compose exec relay node apps/server/dist/cli/reset-user.js
```

命令支持随机生成或手工填写用户名和密码，并可保持、关闭或重新生成 TOTP。随机模式生成的用户名和密码均为 8 位字母数字；重置会注销全部现有会话。

## 更新与备份

更新公开镜像：

```bash
docker compose pull
docker compose up -d
```

备份前先停止服务，然后整体备份项目的 `data` 目录。数据库、WAL 文件和 `master.key` 必须一起保存；主密钥丢失后无法读取已有 TOTP 秘钥。

更完整的升级、回滚和恢复步骤见 [备份与升级](docs/backup-and-upgrade.md)。

## 从源码构建

服务端和网页端要求 Node.js 24、pnpm 11；Windows 客户端要求 .NET 10 SDK。

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Windows 客户端：

```powershell
dotnet publish apps/windows/VoiceRelay.Windows/VoiceRelay.Windows.csproj `
  -c Release -r win-x64 --self-contained true -o artifacts/windows
```

项目使用 GitHub Actions 持续验证 Web、服务端、Docker 和 Windows 客户端。推送 `v*` 标签时会自动发布多架构 GHCR 镜像、Windows 安装程序和便携版。

## 安全边界

- 服务端保存账户、会话和设备，不创建消息表，也不记录明文或密文载荷。
- 每台电脑拥有独立 Curve25519 密钥；手机使用 sealed box 加密，只有目标电脑私钥可以解密。
- 首次信任采用 TOFU：之后同一设备公钥变化会阻止发送，但它不能防御首次访问时已经恶意的自有服务端。
- Windows `SendInput` 受 UIPI 限制，普通权限客户端无法可靠粘贴到管理员权限程序、UAC 安全桌面或锁屏桌面。
- “成功”表示剪贴板已写入且 `Ctrl+V` 输入事件已提交，不能保证第三方控件最终接受全部内容。

发现安全问题请按照 [SECURITY.md](SECURITY.md) 私下报告，不要公开包含凭据、令牌或部署地址的 Issue。

## 许可证

[MIT](LICENSE)

