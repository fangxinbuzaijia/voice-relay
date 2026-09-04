import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  History,
  KeyRound,
  LogOut,
  Monitor,
  PauseCircle,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  UserRound,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ACK_TIMEOUT_MS, MAX_TEXT_CODE_UNITS, type AckStatus, type DevicePresence } from "@voice-relay/protocol";
import { ApiClient, ApiError, type Account, type WebSession } from "./lib/api";
import { encryptTextForDevice, fingerprintPublicKey } from "./lib/crypto";
import { RelaySocket } from "./lib/relay-socket";
import {
  addHistory,
  clearHistory,
  deleteHistory,
  getHistory,
  getTrustedFingerprint,
  loadDraft,
  loadSelectedDevice,
  saveDraft,
  saveSelectedDevice,
  trustFingerprint,
  type HistoryEntry,
} from "./lib/storage";

type View = "main" | "devices" | "account";
type ConnectionState = "connecting" | "online" | "offline";
type SendState =
  | { kind: "idle"; text: string }
  | { kind: "sending"; text: string }
  | { kind: "success"; text: string }
  | { kind: "warning"; text: string }
  | { kind: "error"; text: string };

interface PendingSend {
  messageId: string;
  text: string;
  targetName: string;
  sentAt: number;
}

interface KeyConflict {
  device: DevicePresence;
  fingerprint: string;
}

const api = new ApiClient();

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      invalid_credentials: "账号、密码或动态验证码不正确",
      totp_required: "此账户已启用二步验证，请输入六位动态码",
      invalid_totp: "动态验证码不正确",
      totp_setup_expired: "二维码已过期，请重新生成",
      username_unavailable: "这个用户名不可用",
      too_many_attempts: "登录失败次数过多，请稍后再试",
      invalid_refresh_token: "登录已过期，请重新登录",
      invalid_origin: "当前网页来源未被服务器允许",
    };
    return messages[error.code] ?? `服务器拒绝了请求：${error.code}`;
  }
  if (error instanceof Error) return error.message;
  return "发生了未知错误";
}

function ackText(status: AckStatus, detail?: string): SendState {
  const messages: Record<AckStatus, string> = {
    injected: "电脑已写入剪贴板并提交粘贴",
    duplicate: "电脑已处理过这条消息，没有重复粘贴",
    unknown: "结果未知，请先检查电脑输入框，不要立即重发",
    paused: "电脑客户端已暂停接收",
    desktop_locked: "电脑桌面已锁定",
    no_foreground_window: "电脑上没有可用的前台窗口",
    target_elevated: "目标程序权限高于客户端，无法粘贴",
    modifier_pressed: "电脑上有修饰键正被按下",
    clipboard_busy: "Windows 剪贴板持续被其他程序占用",
    focus_changed: "粘贴前焦点窗口发生了变化",
    decrypt_failed: "电脑无法解密这条消息",
    invalid_payload: "解密后的消息格式无效",
    input_failed: "Windows 未能提交 Ctrl+V 输入事件",
  };
  const baseText = messages[status] ?? status;
  const text = detail ? `${baseText} · ${detail}` : baseText;
  if (status === "injected" || status === "duplicate") return { kind: "success", text };
  if (status === "unknown") return { kind: "warning", text };
  return { kind: "error", text };
}

export default function App() {
  const [session, setSession] = useState<WebSession | null | undefined>(undefined);
  const [connection, setConnection] = useState<ConnectionState>("offline");
  const [devices, setDevices] = useState<DevicePresence[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>(() => loadSelectedDevice());
  const [draft, setDraft] = useState(loadDraft);
  const [submitWithEnter, setSubmitWithEnter] = useState(() => localStorage.getItem("voice-relay:submit-with-enter") === "true");
  const [sendState, setSendState] = useState<SendState>({ kind: "idle", text: "等待输入" });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [view, setView] = useState<View>("main");
  const [keyConflict, setKeyConflict] = useState<KeyConflict | undefined>();
  const socketRef = useRef<RelaySocket | undefined>(undefined);
  const pendingRef = useRef<PendingSend | undefined>(undefined);
  const pendingTimeoutRef = useRef<number | undefined>(undefined);

  const clearPendingTimeout = useCallback((): void => {
    if (pendingTimeoutRef.current !== undefined) window.clearTimeout(pendingTimeoutRef.current);
    pendingTimeoutRef.current = undefined;
  }, []);

  const refreshHistory = useCallback(async () => setHistory(await getHistory()), []);

  const finishAck = useCallback(async (messageId: string, status: AckStatus, detail?: string) => {
    const pending = pendingRef.current;
    if (!pending || pending.messageId !== messageId) return;
    clearPendingTimeout();
    const nextState = ackText(status, detail);
    setSendState(nextState);
    if (status === "injected" || status === "duplicate") {
      await addHistory({ id: messageId, text: pending.text, targetName: pending.targetName, sentAt: pending.sentAt });
      setDraft("");
      saveDraft("");
      await refreshHistory();
    }
    pendingRef.current = undefined;
  }, [clearPendingTimeout, refreshHistory]);

  useEffect(() => {
    let active = true;
    void api.refresh().then(async (result) => {
      if (!active) return;
      const user = await api.getAccount();
      if (active) setSession({ ...result, user });
    }).catch(() => {
      if (active) setSession(null);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!session) return;
    api.setAccessToken(session.accessToken);
    let active = true;
    let reconnectTimer: number | undefined;
    const relay = new RelaySocket({
      onPresence: (nextDevices) => {
        if (!active) return;
        setDevices(nextDevices.sort((left, right) => left.name.localeCompare(right.name, "zh-CN")));
      },
      onAck: (messageId, status, detail) => void finishAck(messageId, status, detail),
      onError: (code, message, messageId) => {
        if (!active) return;
        if (messageId && pendingRef.current?.messageId === messageId) {
          clearPendingTimeout();
          pendingRef.current = undefined;
          setSendState({ kind: "error", text: `${message} · ${code}` });
        }
      },
      onDisconnected: (code) => {
        if (!active || code === 1000) return;
        setConnection("offline");
        reconnectTimer = window.setTimeout(() => {
          if (!active) return;
          if (code === 4001 || session.accessExpiresAt < Date.now() + 30_000) {
            void api.refresh().then((result) => {
              if (active) setSession({ ...session, ...result });
            }).catch(() => { if (active) setSession(null); });
          } else {
            void connect();
          }
        }, 2_000);
      },
    });
    socketRef.current = relay;
    const connect = async (): Promise<void> => {
      setConnection("connecting");
      try {
        await relay.connect(session.accessToken);
        if (active) setConnection("online");
      } catch {
        if (active) {
          setConnection("offline");
          reconnectTimer = window.setTimeout(() => void connect(), 2_000);
        }
      }
    };
    void connect();
    void refreshHistory();
    return () => {
      active = false;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      relay.close();
      if (socketRef.current === relay) socketRef.current = undefined;
    };
  }, [clearPendingTimeout, finishAck, refreshHistory, session]);

  useEffect(() => {
    if (!session) return;
    const delay = Math.max(1_000, session.accessExpiresAt - Date.now() - 60_000);
    const timer = window.setTimeout(() => {
      void api.refresh().then((result) => setSession({ ...session, ...result })).catch(() => setSession(null));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [session]);

  useEffect(() => {
    if (devices.length === 0) return;
    const existing = selectedId && devices.some((device) => device.id === selectedId);
    if (existing) return;
    const next = devices.find((device) => device.online && !device.paused) ?? devices[0];
    if (next) {
      setSelectedId(next.id);
      saveSelectedDevice(next.id);
    }
  }, [devices, selectedId]);

  const selectedDevice = useMemo(() => devices.find((device) => device.id === selectedId), [devices, selectedId]);

  const selectDevice = (id: string): void => {
    setSelectedId(id);
    saveSelectedDevice(id);
    setSendState({ kind: "idle", text: "目标电脑已切换" });
  };

  const updateDraft = (text: string): void => {
    setDraft(text);
    saveDraft(text);
  };

  const updateSubmitWithEnter = (enabled: boolean): void => {
    setSubmitWithEnter(enabled);
    localStorage.setItem("voice-relay:submit-with-enter", String(enabled));
  };

  const sendText = async (): Promise<void> => {
    const target = selectedDevice;
    if (!target || !target.online || target.paused || connection !== "online") return;
    if (!draft || draft.length > MAX_TEXT_CODE_UNITS || pendingRef.current) return;
    try {
      const fingerprint = await fingerprintPublicKey(target.publicKey);
      const trusted = await getTrustedFingerprint(target.id);
      if (!trusted) await trustFingerprint(target.id, fingerprint);
      else if (trusted !== fingerprint) {
        setKeyConflict({ device: target, fingerprint });
        setSendState({ kind: "error", text: "设备密钥发生变化，发送已被阻止" });
        return;
      }
      const messageId = crypto.randomUUID();
      const sentAt = Date.now();
      const ciphertext = await encryptTextForDevice(target, draft, messageId, sentAt, submitWithEnter);
      pendingRef.current = { messageId, text: draft, targetName: target.name, sentAt };
      clearPendingTimeout();
      pendingTimeoutRef.current = window.setTimeout(() => {
        if (pendingRef.current?.messageId !== messageId) return;
        pendingRef.current = undefined;
        pendingTimeoutRef.current = undefined;
        setSendState({ kind: "warning", text: "结果未知，请先检查电脑输入框，不要立即重发" });
      }, ACK_TIMEOUT_MS);
      setSendState({ kind: "sending", text: `正在发送到 ${target.name}` });
      socketRef.current?.sendText(messageId, target.id, sentAt, ciphertext);
    } catch (error) {
      clearPendingTimeout();
      pendingRef.current = undefined;
      setSendState({ kind: "error", text: errorText(error) });
    }
  };

  const trustReplacement = async (): Promise<void> => {
    if (!keyConflict) return;
    await trustFingerprint(keyConflict.device.id, keyConflict.fingerprint);
    setKeyConflict(undefined);
    setSendState({ kind: "idle", text: "已信任新的设备密钥，请重新点击发送" });
  };

  const logout = async (all: boolean): Promise<void> => {
    try { await api.logout(all); } finally {
      clearPendingTimeout();
      pendingRef.current = undefined;
      socketRef.current?.close();
      localStorage.removeItem("voice-relay:username");
      setSession(null);
    }
  };

  if (session === undefined) return <LoadingScreen />;
  if (session === null) return <LoginScreen onLoggedIn={(nextSession) => setSession(nextSession)} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("main")} aria-label="返回发送页面">
          <span className="brand-mark"><Send size={18} strokeWidth={2.5} /></span>
          <span><strong>文字接力</strong><small>手机输入 · 电脑粘贴</small></span>
        </button>
        <div className={`connection-chip ${connection}`}>
          {connection === "online" ? <Wifi size={15} /> : <WifiOff size={15} />}
          <span>{connection === "online" ? "已连接" : connection === "connecting" ? "连接中" : "未连接"}</span>
        </div>
      </header>

      {view === "main" ? (
        <main className="main-layout">
          {session.user.bootstrapPending && (
            <section className="bootstrap-notice">
              <AlertTriangle size={22} />
              <div><strong>仍在使用首次生成的账号密码</strong><p>可以先正常发送；建议尽快改成你自己的用户名和密码。</p></div>
              <button onClick={() => setView("account")}>去修改</button>
            </section>
          )}
          <section className="device-rail" aria-label="目标电脑">
            <div className="section-label">发送到</div>
            <div className="device-scroll">
              {devices.length === 0 ? <div className="empty-device">尚未注册电脑客户端</div> : devices.map((device) => (
                <button
                  key={device.id}
                  className={`device-pill ${selectedId === device.id ? "selected" : ""}`}
                  onClick={() => selectDevice(device.id)}
                >
                  <Monitor size={19} />
                  <span>{device.name}</span>
                  <i className={device.online && !device.paused ? "live" : "dead"} />
                  <small>{device.paused ? "暂停" : device.online ? "在线" : "离线"}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="editor-panel">
            <div className="editor-head">
              <div className="section-label">输入文字</div>
              <span className={draft.length > MAX_TEXT_CODE_UNITS ? "count over" : "count"}>{draft.length}/{MAX_TEXT_CODE_UNITS}</span>
            </div>
            <textarea
              value={draft}
              onChange={(event) => updateDraft(event.target.value)}
              placeholder="点这里，然后使用手机输入法的麦克风。识别完成后可以先校对，再发送。"
              aria-label="要发送的文字"
              maxLength={MAX_TEXT_CODE_UNITS + 1}
            />
            <label className="submit-option">
              <input
                type="checkbox"
                checked={submitWithEnter}
                onChange={(event) => updateSubmitWithEnter(event.target.checked)}
              />
              <span>
                <strong>发送后按一次回车</strong>
                <small>适合需要提交的输入框</small>
              </span>
            </label>
            <div className={`send-status ${sendState.kind}`} role="status">
              {sendState.kind === "success" ? <CheckCircle2 size={18} /> : sendState.kind === "warning" || sendState.kind === "error" ? <AlertTriangle size={18} /> : <Clock3 size={18} />}
              <span>{sendState.text}</span>
            </div>
          </section>

          {keyConflict && (
            <section className="key-warning">
              <ShieldCheck size={28} />
              <div>
                <strong>{keyConflict.device.name} 的密钥已改变</strong>
                <p>新指纹：<code>{keyConflict.fingerprint}</code></p>
              </div>
              <button onClick={() => void trustReplacement()}>确认并重新信任</button>
            </section>
          )}

          <nav className="action-dock" aria-label="发送操作">
            <button className="dock-button" onClick={() => setHistoryOpen(true)} aria-label="打开历史">
              <History size={21} /><span>历史</span>
            </button>
            <button
              className="send-button"
              onClick={() => void sendText()}
              disabled={!draft || draft.length > MAX_TEXT_CODE_UNITS || !selectedDevice?.online || selectedDevice.paused || connection !== "online" || Boolean(pendingRef.current)}
            >
              <Send size={22} strokeWidth={2.5} />
              <span>发送到 {selectedDevice?.name ?? "电脑"}</span>
            </button>
            <button className="dock-button" onClick={() => setView("devices")} aria-label="打开设置">
              <Settings size={21} /><span>设备</span>
            </button>
          </nav>
        </main>
      ) : view === "devices" ? (
        <DeviceView
          devices={devices}
          username={session.user.username}
          onBack={() => setView("main")}
          onAccount={() => setView("account")}
          onRename={async (id, name) => { await api.renameDevice(id, name); }}
          onRevoke={async (id) => { await api.revokeDevice(id); setDevices((current) => current.filter((device) => device.id !== id)); }}
          onLogout={() => void logout(false)}
          onLogoutAll={() => void logout(true)}
        />
      ) : (
        <AccountSecurityView
          account={session.user}
          onBack={() => setView("devices")}
          onChanged={(user) => {
            localStorage.setItem("voice-relay:username", user.username);
            setSession((current) => current ? { ...current, user } : current);
          }}
        />
      )}

      <HistoryDrawer
        open={historyOpen}
        entries={history}
        onClose={() => setHistoryOpen(false)}
        onReuse={(text) => { updateDraft(text); setHistoryOpen(false); }}
        onDelete={async (id) => { await deleteHistory(id); await refreshHistory(); }}
        onClear={async () => { await clearHistory(); await refreshHistory(); }}
      />
    </div>
  );
}

function LoadingScreen() {
  return <div className="loading-screen"><span className="loading-mark"><Send size={28} /></span><p>正在连接</p></div>;
}

function LoginScreen({ onLoggedIn }: { onLoggedIn(session: WebSession): void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const nextSession = await api.login(username, password, totp);
      localStorage.setItem("voice-relay:username", nextSession.user.username);
      onLoggedIn(nextSession);
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-layout">
      <section className="login-intro">
        <span className="eyebrow">自己的文字传送器</span>
        <h1>手机输入，<br />电脑粘贴。</h1>
        <p>在手机上说完，选一台电脑发送。文字只会由那台电脑解开。</p>
        <div className="login-diagram"><span><Smartphone size={18} />手机</span><i /><span><Monitor size={18} />电脑</span></div>
      </section>
      <form className="login-form" onSubmit={(event) => void submit(event)}>
        <div className="form-title"><ShieldCheck size={23} /><div><strong>登录</strong><small>开启二步验证后才需要动态码</small></div></div>
        <label>账号<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
        <label>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <label>六位动态码（可选）<input className="mono-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={totp} onChange={(event) => setTotp(event.target.value.replace(/\D/g, ""))} /></label>
        {error && <div className="form-error"><AlertTriangle size={17} />{error}</div>}
        <button type="submit" disabled={busy || (totp.length > 0 && totp.length !== 6)}>{busy ? "正在验证" : "登录"}<Send size={18} /></button>
      </form>
    </main>
  );
}

interface TotpSetupResult {
  secret: string;
  otpauthUri: string;
  expiresAt: number;
}

function AccountSecurityView({ account, onBack, onChanged }: {
  account: Account;
  onBack(): void;
  onChanged(account: Account): void;
}) {
  const [username, setUsername] = useState(account.username);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [credentialTotp, setCredentialTotp] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupCurrentTotp, setSetupCurrentTotp] = useState("");
  const [setup, setSetup] = useState<TotpSetupResult>();
  const [confirmCode, setConfirmCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string }>();

  const fail = (error: unknown): void => setNotice({ kind: "error", text: errorText(error) });
  const changeCredentials = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const usernameChanged = username.trim() !== account.username;
    if (!usernameChanged && !newPassword) return setNotice({ kind: "error", text: "请填写新用户名或新密码" });
    setBusy("credentials"); setNotice(undefined);
    try {
      const next = await api.updateCredentials({
        currentPassword,
        ...(usernameChanged ? { newUsername: username.trim() } : {}),
        ...(newPassword ? { newPassword } : {}),
        ...(credentialTotp ? { totp: credentialTotp } : {}),
      });
      onChanged(next);
      setCurrentPassword(""); setNewPassword(""); setCredentialTotp("");
      setNotice({ kind: "success", text: "账号凭据已更新，其他设备会话已注销" });
    } catch (error) { fail(error); } finally { setBusy(undefined); }
  };

  const beginTotpSetup = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setBusy("setup"); setNotice(undefined);
    try {
      setSetup(await api.setupTotp(setupPassword, setupCurrentTotp || undefined));
      setConfirmCode("");
    } catch (error) { fail(error); } finally { setBusy(undefined); }
  };

  const confirmTotp = async (event: FormEvent): Promise<void> => {
    event.preventDefault(); setBusy("confirm"); setNotice(undefined);
    try {
      const next = await api.confirmTotp(confirmCode);
      onChanged(next); setSetup(undefined); setSetupPassword(""); setSetupCurrentTotp(""); setConfirmCode("");
      setNotice({ kind: "success", text: "二步验证已启用，其他设备会话已注销" });
    } catch (error) { fail(error); } finally { setBusy(undefined); }
  };

  const disableTotp = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!window.confirm("确认关闭二步验证？之后登录只需要用户名和密码。")) return;
    setBusy("disable"); setNotice(undefined);
    try {
      const next = await api.disableTotp(disablePassword, disableCode);
      onChanged(next); setDisablePassword(""); setDisableCode("");
      setNotice({ kind: "success", text: "二步验证已关闭，其他设备会话已注销" });
    } catch (error) { fail(error); } finally { setBusy(undefined); }
  };

  return (
    <main className="settings-layout security-layout">
      <button className="back-button" onClick={onBack}><ChevronLeft size={20} />返回电脑与会话</button>
      <div className="settings-heading"><span className="eyebrow">登录与安全</span><h1>账户安全</h1><p>修改后保留当前手机会话，其他手机和电脑需要重新登录。</p></div>
      <div className={`security-status ${account.totpEnabled ? "enabled" : "disabled"}`}>
        <ShieldCheck size={22} /><div><strong>二步验证{account.totpEnabled ? "已启用" : "未启用"}</strong><small>{account.totpEnabled ? "登录时必须填写六位动态码" : "登录时只验证用户名和密码"}</small></div>
      </div>
      {notice && <div className={`account-notice ${notice.kind}`} role="status">{notice.kind === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}{notice.text}</div>}

      <section className="security-section">
        <div className="security-section-title"><UserRound size={22} /><div><h2>用户名与密码</h2><p>新密码至少 8 位。</p></div></div>
        <form className="security-form" onSubmit={(event) => void changeCredentials(event)}>
          <label>新用户名<input value={username} maxLength={64} onChange={(event) => setUsername(event.target.value)} required /></label>
          <label>新密码（不修改可留空）<input type="password" minLength={8} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <label>当前密码<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
          {account.totpEnabled && <label>当前六位动态码<input className="mono-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={credentialTotp} onChange={(event) => setCredentialTotp(event.target.value.replace(/\D/g, ""))} required /></label>}
          <button type="submit" disabled={Boolean(busy)}>保存账号凭据</button>
        </form>
      </section>

      <section className="security-section">
        <div className="security-section-title"><KeyRound size={22} /><div><h2>{account.totpEnabled ? "更换验证器" : "启用二步验证"}</h2><p>兼容 Google、Microsoft Authenticator 和 Bitwarden。</p></div></div>
        {!setup ? (
          <form className="security-form" onSubmit={(event) => void beginTotpSetup(event)}>
            <label>当前密码<input type="password" autoComplete="current-password" value={setupPassword} onChange={(event) => setSetupPassword(event.target.value)} required /></label>
            {account.totpEnabled && <label>当前六位动态码<input className="mono-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={setupCurrentTotp} onChange={(event) => setSetupCurrentTotp(event.target.value.replace(/\D/g, ""))} required /></label>}
            <button type="submit" disabled={Boolean(busy)}>{account.totpEnabled ? "生成替换二维码" : "生成二维码"}</button>
          </form>
        ) : (
          <div className="totp-setup">
            <div className="qr-card"><QRCodeSVG value={setup.otpauthUri} size={196} title="二步验证二维码" /></div>
            <div className="totp-instructions"><strong>1. 用验证器扫码</strong><p>不能扫码时，手工输入下面的密钥：</p><code>{setup.secret}</code><small>此二维码将在 {new Date(setup.expiresAt).toLocaleTimeString("zh-CN")} 失效。</small></div>
            <form className="security-form confirm-form" onSubmit={(event) => void confirmTotp(event)}>
              <label>2. 输入验证器显示的六位动态码<input className="mono-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={confirmCode} onChange={(event) => setConfirmCode(event.target.value.replace(/\D/g, ""))} required /></label>
              <button type="submit" disabled={Boolean(busy) || confirmCode.length !== 6}>确认启用</button>
              <button className="secondary-action" type="button" onClick={() => setSetup(undefined)} disabled={Boolean(busy)}>重新生成二维码</button>
            </form>
          </div>
        )}
      </section>

      {account.totpEnabled && (
        <section className="security-section danger-section">
          <div className="security-section-title"><AlertTriangle size={22} /><div><h2>关闭二步验证</h2><p>需要当前密码和当前动态码。</p></div></div>
          <form className="security-form" onSubmit={(event) => void disableTotp(event)}>
            <label>当前密码<input type="password" autoComplete="current-password" value={disablePassword} onChange={(event) => setDisablePassword(event.target.value)} required /></label>
            <label>当前六位动态码<input className="mono-input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={disableCode} onChange={(event) => setDisableCode(event.target.value.replace(/\D/g, ""))} required /></label>
            <button className="danger-action" type="submit" disabled={Boolean(busy) || disableCode.length !== 6}>关闭二步验证</button>
          </form>
        </section>
      )}
    </main>
  );
}

function DeviceView({ devices, username, onBack, onAccount, onRename, onRevoke, onLogout, onLogoutAll }: {
  devices: DevicePresence[];
  username: string;
  onBack(): void;
  onAccount(): void;
  onRename(id: string, name: string): Promise<void>;
  onRevoke(id: string): Promise<void>;
  onLogout(): void;
  onLogoutAll(): void;
}) {
  return (
    <main className="settings-layout">
      <button className="back-button" onClick={onBack}><ChevronLeft size={20} />返回发送</button>
      <div className="settings-heading"><span className="eyebrow">我的设备</span><h1>电脑与会话</h1><p>当前账户：<strong>{username}</strong></p></div>
      <section className="device-list">
        {devices.map((device) => <DeviceRow key={device.id} device={device} onRename={onRename} onRevoke={onRevoke} />)}
        {devices.length === 0 && <p className="settings-empty">安装并登录 Windows 客户端后，电脑会出现在这里。</p>}
      </section>
      <section className="session-actions">
        <button onClick={onAccount}><ShieldCheck size={18} />账户与二步验证</button>
        <button onClick={onLogout}><LogOut size={18} />退出这台手机</button>
        <button className="danger-action" onClick={onLogoutAll}><Trash2 size={18} />注销全部设备会话</button>
      </section>
    </main>
  );
}

function DeviceRow({ device, onRename, onRevoke }: { device: DevicePresence; onRename(id: string, name: string): Promise<void>; onRevoke(id: string): Promise<void> }) {
  const [name, setName] = useState(device.name);
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    if (!name.trim() || name.trim() === device.name) return;
    setBusy(true);
    try { await onRename(device.id, name.trim()); } finally { setBusy(false); }
  };
  const revoke = async (): Promise<void> => {
    if (!window.confirm(`确认撤销电脑“${device.name}”？客户端需要重新登录。`)) return;
    setBusy(true);
    try { await onRevoke(device.id); } finally { setBusy(false); }
  };
  return (
    <article className="device-row">
      <div className={`device-state ${device.online && !device.paused ? "online" : "offline"}`}>
        {device.paused ? <PauseCircle size={20} /> : device.online ? <Wifi size={20} /> : <WifiOff size={20} />}
      </div>
      <div className="device-data">
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} aria-label="电脑名称" />
        <code>{device.id}</code>
      </div>
      <button onClick={() => void save()} disabled={busy || !name.trim() || name.trim() === device.name}><RotateCcw size={17} />保存</button>
      <button className="icon-danger" onClick={() => void revoke()} disabled={busy} aria-label="撤销电脑"><Trash2 size={18} /></button>
    </article>
  );
}

function HistoryDrawer({ open, entries, onClose, onReuse, onDelete, onClear }: {
  open: boolean;
  entries: HistoryEntry[];
  onClose(): void;
  onReuse(text: string): void;
  onDelete(id: string): Promise<void>;
  onClear(): Promise<void>;
}) {
  return (
    <div className={`drawer-layer ${open ? "open" : ""}`} aria-hidden={!open}>
      <button className="drawer-scrim" onClick={onClose} aria-label="关闭历史" tabIndex={open ? 0 : -1} />
      <aside className="history-drawer">
        <header><div><span className="eyebrow">保存在这台手机</span><h2>发送历史</h2></div><button onClick={onClose}><ChevronLeft size={20} />关闭</button></header>
        <p className="history-note">仅保存在这台手机浏览器，最多 100 条 / 30 天。</p>
        <div className="history-list">
          {entries.map((entry) => (
            <article key={entry.id}>
              <button className="history-copy" onClick={() => onReuse(entry.text)}>
                <span>{entry.text}</span>
                <small>{entry.targetName} · {new Date(entry.sentAt).toLocaleString("zh-CN")}</small>
              </button>
              <button className="history-delete" onClick={() => void onDelete(entry.id)} aria-label="删除这条历史"><Trash2 size={17} /></button>
            </article>
          ))}
          {entries.length === 0 && <div className="history-empty">确认粘贴成功的文字会出现在这里。</div>}
        </div>
        {entries.length > 0 && <button className="clear-history" onClick={() => void onClear()}><Trash2 size={17} />清空全部本地历史</button>}
      </aside>
    </div>
  );
}

