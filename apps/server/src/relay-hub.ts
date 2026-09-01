import { randomUUID } from "node:crypto";
import {
  ACK_TIMEOUT_MS,
  OFFLINE_AFTER_MS,
  PROTOCOL_VERSION,
  SEND_CLOCK_SKEW_MS,
  parseClientFrame,
  type AckStatus,
  type DevicePresence,
  type ServerFrame,
} from "@voice-relay/protocol";
import type { WebSocket, RawData } from "ws";
import type { AppDatabase, SessionRow } from "./database.js";
import { authenticateAccess } from "./session-service.js";

interface RelayConnection {
  id: string;
  socket: WebSocket;
  session: SessionRow;
  role: "web" | "windows";
  deviceId?: string;
  paused: boolean;
  lastSeen: number;
}

interface PendingSend {
  sender: RelayConnection;
  targetDeviceId: string;
  timeout: NodeJS.Timeout;
}

function safeSend(socket: WebSocket, frame: ServerFrame): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(frame));
}

function errorFrame(code: string, message: string, messageId?: string): ServerFrame {
  return messageId
    ? { v: PROTOCOL_VERSION, type: "error", code, message, messageId }
    : { v: PROTOCOL_VERSION, type: "error", code, message };
}

export class RelayHub {
  private readonly connections = new Map<string, RelayConnection>();
  private readonly deviceConnections = new Map<string, RelayConnection>();
  private readonly pending = new Map<string, PendingSend>();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly db: AppDatabase) {
    this.timer = setInterval(() => this.sweep(), 5_000);
    this.timer.unref();
  }

  close(): void {
    clearInterval(this.timer);
    for (const pending of this.pending.values()) clearTimeout(pending.timeout);
    for (const connection of this.connections.values()) connection.socket.close(1001, "Server shutting down");
    this.connections.clear();
    this.deviceConnections.clear();
    this.pending.clear();
  }

  attach(socket: WebSocket): void {
    let authenticated: RelayConnection | undefined;
    const authDeadline = setTimeout(() => socket.close(4001, "Authentication timeout"), 5_000);

    socket.on("message", (data: RawData) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString()) as unknown;
      } catch {
        safeSend(socket, errorFrame("invalid_json", "Frame is not valid JSON"));
        return;
      }

      let frame;
      try {
        frame = parseClientFrame(raw);
      } catch {
        safeSend(socket, errorFrame("invalid_frame", "Frame does not match protocol version 1"));
        return;
      }

      if (!authenticated) {
        if (frame.type !== "auth") {
          safeSend(socket, errorFrame("not_authenticated", "The first frame must be auth"));
          return;
        }
        const result = this.authenticate(socket, frame.accessToken, frame.clientType, frame.deviceId);
        if (!result) return;
        authenticated = result;
        clearTimeout(authDeadline);
        return;
      }

      authenticated.lastSeen = Date.now();
      switch (frame.type) {
        case "heartbeat":
          safeSend(socket, { v: PROTOCOL_VERSION, type: "heartbeat", at: Date.now() });
          break;
        case "text.send":
          this.handleSend(authenticated, frame);
          break;
        case "text.ack":
          this.handleAck(authenticated, frame.messageId, frame.status, frame.detail);
          break;
        case "device.pause":
          this.handlePause(authenticated, frame.paused);
          break;
        case "auth":
          safeSend(socket, errorFrame("already_authenticated", "Connection is already authenticated"));
          break;
      }
    });

    socket.on("close", () => {
      clearTimeout(authDeadline);
      if (authenticated) this.removeConnection(authenticated);
    });

    socket.on("error", () => {
      if (authenticated) this.removeConnection(authenticated);
    });
  }

  closeSession(sessionId: string): void {
    for (const connection of this.connections.values()) {
      if (connection.session.id === sessionId) connection.socket.close(4001, "Session revoked");
    }
  }

  closeAllSessions(userId: string, exceptSessionId?: string): void {
    for (const connection of this.connections.values()) {
      if (connection.session.user_id === userId && connection.session.id !== exceptSessionId) {
        connection.socket.close(4001, "Session revoked");
      }
    }
  }

  closeDevice(deviceId: string): void {
    this.deviceConnections.get(deviceId)?.socket.close(4003, "Device revoked");
  }

  broadcastDevice(userId: string, deviceId: string): void {
    const device = this.db.getDevice(deviceId);
    if (!device || device.user_id !== userId || device.revoked_at !== null) return;
    const presence = this.toPresence(device.id, device.name, device.public_key, device.updated_at);
    this.broadcastToWeb(userId, { v: PROTOCOL_VERSION, type: "presence.changed", device: presence });
  }

  private authenticate(socket: WebSocket, accessToken: string, clientType: "web" | "windows", deviceId?: string): RelayConnection | undefined {
    const session = authenticateAccess(this.db, accessToken);
    if (!session || session.client_type !== clientType) {
      safeSend(socket, errorFrame("invalid_session", "Access token is invalid or expired"));
      socket.close(4001, "Invalid session");
      return undefined;
    }

    if (clientType === "windows") {
      if (!deviceId) {
        safeSend(socket, errorFrame("device_required", "Windows connections require a device ID"));
        socket.close(4002, "Device required");
        return undefined;
      }
      const device = this.db.getDevice(deviceId);
      if (!device || device.user_id !== session.user_id || device.revoked_at !== null) {
        safeSend(socket, errorFrame("invalid_device", "Device is missing or revoked"));
        socket.close(4003, "Invalid device");
        return undefined;
      }
    }

    const connection: RelayConnection = {
      id: randomUUID(),
      socket,
      session,
      role: clientType,
      ...(deviceId ? { deviceId } : {}),
      paused: false,
      lastSeen: Date.now(),
    };
    this.connections.set(connection.id, connection);

    if (deviceId) {
      this.deviceConnections.get(deviceId)?.socket.close(4004, "Replaced by a newer connection");
      this.deviceConnections.set(deviceId, connection);
      this.broadcastDevice(session.user_id, deviceId);
    }

    safeSend(socket, {
      v: PROTOCOL_VERSION,
      type: "auth.ok",
      connectionId: connection.id,
      expiresAt: session.access_expires_at,
    });
    if (clientType === "web") this.sendSnapshot(connection);
    return connection;
  }

  private handleSend(connection: RelayConnection, frame: { messageId: string; targetDeviceId: string; sentAt: number; ciphertext: string }): void {
    if (connection.role !== "web") {
      safeSend(connection.socket, errorFrame("forbidden", "Only web clients may send text", frame.messageId));
      return;
    }
    if (Math.abs(Date.now() - frame.sentAt) > SEND_CLOCK_SKEW_MS) {
      safeSend(connection.socket, errorFrame("stale_message", "Message timestamp is outside the 30 second window", frame.messageId));
      return;
    }
    if (Buffer.byteLength(frame.ciphertext, "base64") > 64 * 1024) {
      safeSend(connection.socket, errorFrame("message_too_large", "Ciphertext exceeds 64 KiB", frame.messageId));
      return;
    }
    if (this.pending.has(frame.messageId)) {
      safeSend(connection.socket, errorFrame("duplicate_message", "Message ID is already pending", frame.messageId));
      return;
    }
    const device = this.db.getDevice(frame.targetDeviceId);
    if (!device || device.user_id !== connection.session.user_id || device.revoked_at !== null) {
      safeSend(connection.socket, errorFrame("invalid_target", "Target device is missing or revoked", frame.messageId));
      return;
    }
    const target = this.deviceConnections.get(frame.targetDeviceId);
    if (!target || Date.now() - target.lastSeen > OFFLINE_AFTER_MS) {
      safeSend(connection.socket, errorFrame("target_offline", "Target computer is offline", frame.messageId));
      return;
    }
    if (target.paused) {
      safeSend(connection.socket, errorFrame("target_paused", "Target computer is paused", frame.messageId));
      return;
    }

    const timeout = setTimeout(() => this.expirePending(frame.messageId), ACK_TIMEOUT_MS);
    timeout.unref();
    this.pending.set(frame.messageId, {
      sender: connection,
      targetDeviceId: frame.targetDeviceId,
      timeout,
    });
    safeSend(target.socket, {
      v: PROTOCOL_VERSION,
      type: "text.deliver",
      messageId: frame.messageId,
      sentAt: frame.sentAt,
      ciphertext: frame.ciphertext,
    });
  }

  private handleAck(connection: RelayConnection, messageId: string, status: AckStatus, detail?: string): void {
    if (connection.role !== "windows" || !connection.deviceId) return;
    const pending = this.pending.get(messageId);
    if (!pending || pending.targetDeviceId !== connection.deviceId) return;
    this.pending.delete(messageId);
    clearTimeout(pending.timeout);
    const frame: ServerFrame = detail
      ? { v: PROTOCOL_VERSION, type: "text.ack", messageId, status, detail }
      : { v: PROTOCOL_VERSION, type: "text.ack", messageId, status };
    safeSend(pending.sender.socket, frame);
  }

  private handlePause(connection: RelayConnection, paused: boolean): void {
    if (connection.role !== "windows" || !connection.deviceId) return;
    connection.paused = paused;
    this.broadcastDevice(connection.session.user_id, connection.deviceId);
  }

  private removeConnection(connection: RelayConnection): void {
    if (!this.connections.delete(connection.id)) return;
    if (connection.deviceId && this.deviceConnections.get(connection.deviceId)?.id === connection.id) {
      this.deviceConnections.delete(connection.deviceId);
      this.broadcastDevice(connection.session.user_id, connection.deviceId);
    }
  }

  private sendSnapshot(connection: RelayConnection): void {
    const devices = this.db.listDevices(connection.session.user_id).map((device) =>
      this.toPresence(device.id, device.name, device.public_key, device.updated_at));
    safeSend(connection.socket, { v: PROTOCOL_VERSION, type: "presence.snapshot", devices });
  }

  private toPresence(id: string, name: string, publicKey: string, updatedAt: number): DevicePresence {
    const connection = this.deviceConnections.get(id);
    const online = Boolean(connection && Date.now() - connection.lastSeen <= OFFLINE_AFTER_MS);
    return { id, name, publicKey, online, paused: connection?.paused ?? false, updatedAt: new Date(updatedAt).toISOString() };
  }

  private broadcastToWeb(userId: string, frame: ServerFrame): void {
    for (const connection of this.connections.values()) {
      if (connection.role === "web" && connection.session.user_id === userId) safeSend(connection.socket, frame);
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const connection of this.connections.values()) {
      if (connection.session.access_expires_at <= now) connection.socket.close(4001, "Access token expired");
      else if (now - connection.lastSeen > OFFLINE_AFTER_MS) connection.socket.close(4000, "Heartbeat timeout");
    }
  }

  private expirePending(messageId: string): void {
    const pending = this.pending.get(messageId);
    if (!pending) return;
    this.pending.delete(messageId);
    safeSend(pending.sender.socket, {
      v: PROTOCOL_VERSION,
      type: "text.ack",
      messageId,
      status: "unknown",
      detail: "The target did not acknowledge within five seconds",
    });
  }
}
