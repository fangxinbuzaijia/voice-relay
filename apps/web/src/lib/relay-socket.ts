import {
  HEARTBEAT_INTERVAL_MS,
  PROTOCOL_VERSION,
  parseServerFrame,
  type AckStatus,
  type DevicePresence,
  type ServerFrame,
} from "@voice-relay/protocol";

export interface RelaySocketEvents {
  onPresence(devices: DevicePresence[]): void;
  onAck(messageId: string, status: AckStatus, detail?: string): void;
  onError(code: string, message: string, messageId?: string): void;
  onDisconnected(code: number): void;
}

export class RelaySocket {
  private socket: WebSocket | undefined;
  private heartbeat: number | undefined;
  private devices = new Map<string, DevicePresence>();

  constructor(private readonly events: RelaySocketEvents) {}

  connect(accessToken: string): Promise<void> {
    this.close();
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    this.socket = socket;

    return new Promise((resolve, reject) => {
      let authenticated = false;
      const timeout = window.setTimeout(() => {
        if (!authenticated) {
          socket.close();
          reject(new Error("socket_auth_timeout"));
        }
      }, 5_000);

      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({
          v: PROTOCOL_VERSION,
          type: "auth",
          accessToken,
          clientType: "web",
        }));
      });
      socket.addEventListener("message", (event) => {
        try {
          const value: unknown = JSON.parse(String(event.data));
          const frame = parseServerFrame(value);
          if (frame.type === "auth.ok") {
            authenticated = true;
            window.clearTimeout(timeout);
            this.startHeartbeat();
            resolve();
          }
          this.handleFrame(frame);
        } catch {
          this.events.onError("invalid_server_frame", "服务器返回了无法识别的数据");
        }
      });
      socket.addEventListener("error", () => {
        if (!authenticated) {
          window.clearTimeout(timeout);
          reject(new Error("socket_connection_failed"));
        }
      });
      socket.addEventListener("close", (event) => {
        window.clearTimeout(timeout);
        this.stopHeartbeat();
        if (this.socket === socket) this.socket = undefined;
        this.events.onDisconnected(event.code);
      });
    });
  }

  close(): void {
    this.stopHeartbeat();
    this.socket?.close(1000, "Client closing");
    this.socket = undefined;
  }

  sendText(messageId: string, targetDeviceId: string, sentAt: number, ciphertext: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("socket_not_connected");
    this.socket.send(JSON.stringify({
      v: PROTOCOL_VERSION,
      type: "text.send",
      messageId,
      targetDeviceId,
      sentAt,
      ciphertext,
    }));
  }

  private handleFrame(frame: ServerFrame): void {
    switch (frame.type) {
      case "presence.snapshot":
        this.devices = new Map(frame.devices.map((device) => [device.id, device]));
        this.events.onPresence([...this.devices.values()]);
        break;
      case "presence.changed":
        this.devices.set(frame.device.id, frame.device);
        this.events.onPresence([...this.devices.values()]);
        break;
      case "text.ack":
        this.events.onAck(frame.messageId, frame.status, frame.detail);
        break;
      case "error":
        this.events.onError(frame.code, frame.message, frame.messageId);
        break;
      default:
        break;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = window.setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: "heartbeat", at: Date.now() }));
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== undefined) window.clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }
}

