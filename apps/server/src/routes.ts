import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { removeCredentialArtifacts } from "./bootstrap.js";
import type { AppDatabase, SessionRow, UserRow } from "./database.js";
import { LoginLimiter } from "./login-limiter.js";
import type { RelayHub } from "./relay-hub.js";
import {
  buildTotpUri, decryptTotpSecret, encryptTotpSecret, generateTotpSecret,
  hashPassword, verifyPassword, verifyTotp,
} from "./security.js";
import { authenticateAccess, issueSession, rotateSession } from "./session-service.js";

const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(1024),
  totp: z.string().regex(/^\d{6}$/).nullish(),
  clientType: z.enum(["web", "windows"]),
});
const refreshSchema = z.object({ refreshToken: z.string().min(32).optional() });
const deviceCreateSchema = z.object({ name: z.string().trim().min(1).max(64), publicKey: z.string().base64() });
const deviceRenameSchema = z.object({ name: z.string().trim().min(1).max(64) });
const totpCodeSchema = z.string().regex(/^\d{6}$/);
const credentialsSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newUsername: z.string().trim().min(1).max(64).optional(),
  newPassword: z.string().min(8).max(1024).optional(),
  totp: totpCodeSchema.optional(),
}).refine((body) => body.newUsername !== undefined || body.newPassword !== undefined);
const totpSetupSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  totp: totpCodeSchema.optional(),
});
const totpConfirmSchema = z.object({ code: totpCodeSchema });
const totpDisableSchema = z.object({ currentPassword: z.string().min(1).max(1024), totp: totpCodeSchema });

function accountView(user: UserRow): { id: string; username: string; totpEnabled: boolean; bootstrapPending: boolean } {
  return { id: user.id, username: user.username, totpEnabled: user.totp_enabled === 1, bootstrapPending: user.bootstrap_pending === 1 };
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice(7);
}

function requireSession(db: AppDatabase, request: FastifyRequest, reply: FastifyReply): SessionRow | undefined {
  const token = bearerToken(request);
  const session = token ? authenticateAccess(db, token) : undefined;
  if (!session) void reply.code(401).send({ error: "unauthorized" });
  return session;
}

function setRefreshCookie(reply: FastifyReply, config: AppConfig, refreshToken: string): void {
  reply.setCookie("voice_relay_refresh", refreshToken, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/v1/auth",
    maxAge: 30 * 24 * 60 * 60,
  });
}

export async function registerRoutes(app: FastifyInstance, db: AppDatabase, hub: RelayHub, config: AppConfig): Promise<void> {
  const limiter = new LoginLimiter();

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => ({ status: "ready" }));

  app.post("/api/v1/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const limitKeys = [`ip:${request.ip}`, `account:${parsed.data.username.toLowerCase()}`];
    if (limitKeys.some((key) => limiter.isBlocked(key))) {
      return reply.code(429).send({ error: "too_many_attempts" });
    }

    const user = db.getUserByUsername(parsed.data.username);
    const validPassword = user ? await verifyPassword(user.password_hash, parsed.data.password) : false;
    if (!user || !validPassword) {
      for (const key of limitKeys) limiter.recordFailure(key);
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    if (user.totp_enabled === 1 && !parsed.data.totp) return reply.code(401).send({ error: "totp_required" });
    if (user.totp_enabled === 1 && !verifyTotp(decryptTotpSecret(user.totp_secret_encrypted, config.masterKeyBytes), parsed.data.totp ?? "")) {
      for (const key of limitKeys) limiter.recordFailure(key);
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    for (const key of limitKeys) limiter.clear(key);
    const session = issueSession(db, user.id, parsed.data.clientType);
    if (parsed.data.clientType === "web") setRefreshCookie(reply, config, session.refreshToken);
    return reply.send({
      accessToken: session.accessToken,
      accessExpiresAt: session.accessExpiresAt,
      ...(parsed.data.clientType === "windows" ? { refreshToken: session.refreshToken } : {}),
      user: accountView(user),
    });
  });

  app.post("/api/v1/auth/refresh", async (request, reply) => {
    const parsed = refreshSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const refreshToken = parsed.data.refreshToken ?? request.cookies.voice_relay_refresh;
    if (!refreshToken) return reply.code(401).send({ error: "missing_refresh_token" });
    const issued = rotateSession(db, refreshToken);
    if (!issued) return reply.code(401).send({ error: "invalid_refresh_token" });
    if (issued.clientType === "web") setRefreshCookie(reply, config, issued.refreshToken);
    return reply.send({
      accessToken: issued.accessToken,
      accessExpiresAt: issued.accessExpiresAt,
      ...(issued.clientType === "windows" ? { refreshToken: issued.refreshToken } : {}),
    });
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const session = requireSession(db, request, reply);
    if (!session) return;
    db.revokeSession(session.id);
    hub.closeSession(session.id);
    reply.clearCookie("voice_relay_refresh", { path: "/api/v1/auth" });
    return reply.code(204).send();
  });

  app.post("/api/v1/auth/logout-all", async (request, reply) => {
    const session = requireSession(db, request, reply);
    if (!session) return;
    db.revokeAllSessions(session.user_id);
    hub.closeAllSessions(session.user_id);
    reply.clearCookie("voice_relay_refresh", { path: "/api/v1/auth" });
    return reply.code(204).send();
  });

  app.get("/api/v1/account", async (request, reply) => {
    const session = requireSession(db, request, reply);
    if (!session) return;
    const user = db.getUserById(session.user_id);
    if (!user) return reply.code(404).send({ error: "account_not_found" });
    return reply.send({ user: accountView(user) });
  });

  app.patch("/api/v1/account/credentials", async (request, reply) => {
    const session = requireSession(db, request, reply);
    if (!session) return;
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const user = db.getUserById(session.user_id);
    if (!user || !await verifyPassword(user.password_hash, parsed.data.currentPassword)) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    if (user.totp_enabled === 1 && (!parsed.data.totp
      || !verifyTotp(decryptTotpSecret(user.totp_secret_encrypted, config.masterKeyBytes), parsed.data.totp))) {
      return reply.code(401).send({ error: parsed.data.totp ? "invalid_credentials" : "totp_required" });
    }
    const username = parsed.data.newUsername ?? user.username;
    const passwordHash = parsed.data.newPassword ? await hashPassword(parsed.data.newPassword) : user.password_hash;
    try {
      db.updateCredentials(user.id, username, passwordHash);
    } catch {
      return reply.code(409).send({ error: "username_unavailable" });
    }
    removeCredentialArtifacts(config.dataDirectory);
    db.revokeAllSessions(user.id, session.id);
    hub.closeAllSessions(user.id, session.id);
    return reply.send({ user: accountView(db.getUserById(user.id)!) });
  });

  app.post("/api/v1/account/totp/setup", async (request, reply) => {
    const session = requireSession(db, request, reply);
    if (!session) return;
    const parsed = totpSetupSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const user = db.getUserById(session.user_id);
    if (!user || !await verifyPassword(user.password_hash, parsed.data.currentPassword)) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    if (user.totp_enabled === 1 && (!parsed.data.totp
      || !verifyTotp(decryptTotpSecret(user.totp_secret_encrypted, config.masterKeyBytes), parsed.data.totp))) {
      return reply.code(401).send({ error: parsed.data.totp ? "invalid_credentials" : "totp_required" });
    }
    const secret = generateTotpSecret();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    db.setPendingTotp(user.id, encryptTotpSecret(secret, config.masterKeyBytes), expiresAt);
    reply.header("Cache-Control", "no-store");
    return reply.send({ secret, otpauthUri: buildTotpUri(user.username, secret), expiresAt });
  });

  app.post("/api/v1/account/totp/confirm", async (request, reply) => {
    const session = requireSession(db, request, reply);
    if (!session) return;
    const parsed = totpConfirmSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const user = db.getUserById(session.user_id);
    if (!user?.totp_pending_secret_encrypted || !user.totp_pending_expires_at || user.totp_pending_expires_at <= Date.now()) {
      return reply.code(400).send({ error: "totp_setup_expired" });
    }
    const secret = decryptTotpSecret(user.totp_pending_secret_encrypted, config.masterKeyBytes);
    if (!verifyTotp(secret, parsed.data.code)) return reply.code(401).send({ error: "invalid_totp" });
    db.enablePendingTotp(user.id);
    db.revokeAllSessions(user.id, session.id);
    hub.closeAllSessions(user.id, session.id);
    return reply.send({ user: accountView(db.getUserById(user.id)!) });
  });

  app.delete("/api/v1/account/totp", async (request, reply) => {
    const session = requireSession(db, request, reply);
    if (!session) return;
    const parsed = totpDisableSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const user = db.getUserById(session.user_id);
    if (!user || user.totp_enabled !== 1 || !await verifyPassword(user.password_hash, parsed.data.currentPassword)
      || !verifyTotp(decryptTotpSecret(user.totp_secret_encrypted, config.masterKeyBytes), parsed.data.totp)) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    db.disableTotp(user.id);
    db.revokeAllSessions(user.id, session.id);
    hub.closeAllSessions(user.id, session.id);
    return reply.send({ user: accountView(db.getUserById(user.id)!) });
  });

  app.get("/api/v1/devices", async (request, reply) => {
    const session = requireSession(db, request, reply);
    if (!session) return;
    return reply.send({ devices: db.listDevices(session.user_id).map((device) => ({
      id: device.id,
      name: device.name,
      publicKey: device.public_key,
      createdAt: new Date(device.created_at).toISOString(),
      updatedAt: new Date(device.updated_at).toISOString(),
    })) });
  });

  app.post("/api/v1/devices", async (request, reply) => {
    const session = requireSession(db, request, reply);
    if (!session) return;
    if (session.client_type !== "windows") return reply.code(403).send({ error: "windows_session_required" });
    const parsed = deviceCreateSchema.safeParse(request.body);
    if (!parsed.success || Buffer.from(parsed.success ? parsed.data.publicKey : "", "base64").length !== 32) {
      return reply.code(400).send({ error: "invalid_device" });
    }
    const now = Date.now();
    const id = randomUUID();
    db.createDevice({
      id,
      user_id: session.user_id,
      name: parsed.data.name,
      public_key: parsed.data.publicKey,
      revoked_at: null,
      created_at: now,
      updated_at: now,
    });
    return reply.code(201).send({ id, name: parsed.data.name, publicKey: parsed.data.publicKey });
  });

  app.patch("/api/v1/devices/:id", async (request, reply) => {
    const session = requireSession(db, request, reply);
    if (!session) return;
    const idResult = z.object({ id: z.uuid() }).safeParse(request.params);
    const bodyResult = deviceRenameSchema.safeParse(request.body);
    if (!idResult.success || !bodyResult.success) return reply.code(400).send({ error: "invalid_request" });
    if (!db.renameDevice(idResult.data.id, session.user_id, bodyResult.data.name)) {
      return reply.code(404).send({ error: "device_not_found" });
    }
    hub.broadcastDevice(session.user_id, idResult.data.id);
    return reply.send({ id: idResult.data.id, name: bodyResult.data.name });
  });

  app.delete("/api/v1/devices/:id", async (request, reply) => {
    const session = requireSession(db, request, reply);
    if (!session) return;
    const parsed = z.object({ id: z.uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    if (!db.revokeDevice(parsed.data.id, session.user_id)) return reply.code(404).send({ error: "device_not_found" });
    hub.closeDevice(parsed.data.id);
    return reply.code(204).send();
  });
}
