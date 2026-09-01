import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import WebSocket from "ws";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const username = process.env.SMOKE_USERNAME;
const password = process.env.SMOKE_PASSWORD;
const totpSecret = process.env.SMOKE_TOTP_SECRET;
assert(username && password && totpSecret, "SMOKE_USERNAME, SMOKE_PASSWORD and SMOKE_TOTP_SECRET are required");

const origin = new URL(baseUrl).origin;
const wsUrl = `${origin.replace(/^http/, "ws")}/ws`;
const totp = new OTPAuth.TOTP({
  issuer: "Voice Relay",
  algorithm: "SHA1",
  digits: 6,
  period: 30,
  secret: OTPAuth.Secret.fromBase32(totpSecret),
});

async function api(path, options = {}) {
  const headers = { Origin: origin, ...options.headers };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });
}

async function login(clientType) {
  const response = await api("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password, totp: totp.generate(), clientType }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

class FrameQueue {
  #frames = [];
  #waiters = [];

  constructor(socket) {
    socket.on("message", (data) => this.#push(JSON.parse(data.toString())));
  }

  next(predicate, timeoutMs = 4_000) {
    const existing = this.#frames.findIndex(predicate);
    if (existing >= 0) return Promise.resolve(this.#frames.splice(existing, 1)[0]);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.#waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (index >= 0) this.#waiters.splice(index, 1);
        reject(new Error("Timed out waiting for WebSocket frame"));
      }, timeoutMs);
      this.#waiters.push({ predicate, resolve, timeout });
    });
  }

  #push(frame) {
    const waiterIndex = this.#waiters.findIndex((waiter) => waiter.predicate(frame));
    if (waiterIndex < 0) {
      this.#frames.push(frame);
      return;
    }
    const [waiter] = this.#waiters.splice(waiterIndex, 1);
    clearTimeout(waiter.timeout);
    waiter.resolve(frame);
  }
}

async function connect(accessToken, clientType, deviceId) {
  const socket = new WebSocket(wsUrl, { headers: { Origin: origin } });
  const queue = new FrameQueue(socket);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(JSON.stringify({ v: 1, type: "auth", accessToken, clientType, ...(deviceId ? { deviceId } : {}) }));
  await queue.next((frame) => frame.type === "auth.ok");
  return { socket, queue };
}

const live = await api("/health/live");
assert.deepEqual(await live.json(), { status: "ok" });
const page = await api("/");
assert.equal(page.status, 200);
assert.match(await page.text(), /<div id="root"><\/div>/);
const rejectedOrigin = await fetch(`${baseUrl}/health/live`, { headers: { Origin: "https://untrusted.invalid" } });
assert.equal(rejectedOrigin.status, 403);

const initialWindowsLogin = await login("windows");
assert(initialWindowsLogin.refreshToken);
const rotated = await api("/api/v1/auth/refresh", {
  method: "POST",
  body: JSON.stringify({ refreshToken: initialWindowsLogin.refreshToken }),
});
assert.equal(rotated.status, 200);
const rotatedTokens = await rotated.json();
assert(rotatedTokens.refreshToken);
const reused = await api("/api/v1/auth/refresh", {
  method: "POST",
  body: JSON.stringify({ refreshToken: initialWindowsLogin.refreshToken }),
});
assert.equal(reused.status, 401);

const publicKey = randomBytes(32).toString("base64");
const registration = await api("/api/v1/devices", {
  method: "POST",
  headers: { Authorization: `Bearer ${rotatedTokens.accessToken}` },
  body: JSON.stringify({ name: "E2E Windows", publicKey }),
});
assert.equal(registration.status, 201);
const device = await registration.json();

const windows = await connect(rotatedTokens.accessToken, "windows", device.id);
const webLogin = await login("web");
const web = await connect(webLogin.accessToken, "web");
const snapshot = await web.queue.next((frame) => frame.type === "presence.snapshot");
assert(snapshot.devices.some((candidate) => candidate.id === device.id && candidate.online));

const staleId = randomUUID();
web.socket.send(JSON.stringify({
  v: 1,
  type: "text.send",
  messageId: staleId,
  targetDeviceId: device.id,
  sentAt: Date.now() - 60_000,
  ciphertext: "dGVzdA==",
}));
const stale = await web.queue.next((frame) => frame.type === "error" && frame.messageId === staleId);
assert.equal(stale.code, "stale_message");

const messageId = randomUUID();
const sentAt = Date.now();
web.socket.send(JSON.stringify({
  v: 1,
  type: "text.send",
  messageId,
  targetDeviceId: device.id,
  sentAt,
  ciphertext: "dGVzdA==",
}));
const delivered = await windows.queue.next((frame) => frame.type === "text.deliver" && frame.messageId === messageId);
assert.equal(delivered.sentAt, sentAt);
windows.socket.send(JSON.stringify({ v: 1, type: "text.ack", messageId, status: "injected" }));
const acknowledged = await web.queue.next((frame) => frame.type === "text.ack" && frame.messageId === messageId);
assert.equal(acknowledged.status, "injected");

const unknownId = randomUUID();
const unknownFrame = {
  v: 1,
  type: "text.send",
  messageId: unknownId,
  targetDeviceId: device.id,
  sentAt: Date.now(),
  ciphertext: "dGVzdA==",
};
web.socket.send(JSON.stringify(unknownFrame));
await windows.queue.next((frame) => frame.type === "text.deliver" && frame.messageId === unknownId);
web.socket.send(JSON.stringify(unknownFrame));
const duplicatePending = await web.queue.next((frame) => frame.type === "error" && frame.messageId === unknownId);
assert.equal(duplicatePending.code, "duplicate_message");
const unknownAck = await web.queue.next((frame) => frame.type === "text.ack" && frame.messageId === unknownId, 7_000);
assert.equal(unknownAck.status, "unknown");

windows.socket.send(JSON.stringify({ v: 1, type: "device.pause", paused: true }));
await web.queue.next((frame) => frame.type === "presence.changed" && frame.device.id === device.id && frame.device.paused);
const pausedId = randomUUID();
web.socket.send(JSON.stringify({
  v: 1,
  type: "text.send",
  messageId: pausedId,
  targetDeviceId: device.id,
  sentAt: Date.now(),
  ciphertext: "dGVzdA==",
}));
const paused = await web.queue.next((frame) => frame.type === "error" && frame.messageId === pausedId);
assert.equal(paused.code, "target_paused");

windows.socket.close(1000, "smoke complete");
await web.queue.next((frame) => frame.type === "presence.changed" && frame.device.id === device.id && !frame.device.online);
const offlineId = randomUUID();
web.socket.send(JSON.stringify({
  v: 1,
  type: "text.send",
  messageId: offlineId,
  targetDeviceId: device.id,
  sentAt: Date.now(),
  ciphertext: "dGVzdA==",
}));
const offline = await web.queue.next((frame) => frame.type === "error" && frame.messageId === offlineId);
assert.equal(offline.code, "target_offline");

const revoked = await api(`/api/v1/devices/${device.id}`, {
  method: "DELETE",
  headers: { Authorization: `Bearer ${webLogin.accessToken}` },
});
assert.equal(revoked.status, 204, `Device revoke failed: ${await revoked.text()}`);
web.socket.close(1000, "smoke complete");
console.log("E2E smoke passed: health, origin, login, refresh rotation, presence, relay, ACK timeout, pause, and offline rejection");
