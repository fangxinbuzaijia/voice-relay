import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ClientType } from "@voice-relay/protocol";

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  totp_secret_encrypted: string;
  totp_enabled: number;
  totp_pending_secret_encrypted: string | null;
  totp_pending_expires_at: number | null;
  bootstrap_pending: number;
  created_at: number;
  updated_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  access_hash: string;
  access_expires_at: number;
  refresh_hash: string;
  refresh_expires_at: number;
  client_type: ClientType;
  revoked_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface DeviceRow {
  id: string;
  user_id: string;
  name: string;
  public_key: string;
  revoked_at: number | null;
  created_at: number;
  updated_at: number;
}

function rowAs<T>(value: unknown): T | undefined {
  return value === undefined ? undefined : (value as T);
}

export class AppDatabase {
  readonly db: DatabaseSync;

  constructor(filename: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        totp_secret_encrypted TEXT NOT NULL,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        totp_pending_secret_encrypted TEXT,
        totp_pending_expires_at INTEGER,
        bootstrap_pending INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        access_hash TEXT NOT NULL UNIQUE,
        access_expires_at INTEGER NOT NULL,
        refresh_hash TEXT NOT NULL UNIQUE,
        refresh_expires_at INTEGER NOT NULL,
        client_type TEXT NOT NULL CHECK(client_type IN ('web', 'windows')),
        revoked_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_refresh ON sessions(refresh_hash);
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        public_key TEXT NOT NULL,
        revoked_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
    `);
    const userColumns = new Set((this.db.prepare("PRAGMA table_info(users)").all() as unknown as Array<{ name: string }>).map((column) => column.name));
    if (!userColumns.has("totp_enabled")) this.db.exec("ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 1");
    if (!userColumns.has("totp_pending_secret_encrypted")) this.db.exec("ALTER TABLE users ADD COLUMN totp_pending_secret_encrypted TEXT");
    if (!userColumns.has("totp_pending_expires_at")) this.db.exec("ALTER TABLE users ADD COLUMN totp_pending_expires_at INTEGER");
    if (!userColumns.has("bootstrap_pending")) this.db.exec("ALTER TABLE users ADD COLUMN bootstrap_pending INTEGER NOT NULL DEFAULT 0");
  }

  countUsers(): number {
    const row = rowAs<{ count: number }>(this.db.prepare("SELECT COUNT(*) AS count FROM users").get());
    return row?.count ?? 0;
  }

  getUserByUsername(username: string): UserRow | undefined {
    return rowAs<UserRow>(this.db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username));
  }

  getUserById(id: string): UserRow | undefined {
    return rowAs<UserRow>(this.db.prepare("SELECT * FROM users WHERE id = ?").get(id));
  }

  getSingleUser(): UserRow | undefined {
    return rowAs<UserRow>(this.db.prepare("SELECT * FROM users ORDER BY created_at LIMIT 1").get());
  }

  createUser(user: UserRow): void {
    this.db.prepare(`INSERT INTO users
      (id, username, password_hash, totp_secret_encrypted, totp_enabled,
       totp_pending_secret_encrypted, totp_pending_expires_at, bootstrap_pending, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, user.username, user.password_hash, user.totp_secret_encrypted, user.totp_enabled,
        user.totp_pending_secret_encrypted, user.totp_pending_expires_at, user.bootstrap_pending,
        user.created_at, user.updated_at);
  }

  updateUserSecurity(id: string, passwordHash: string, totpSecretEncrypted: string, totpEnabled = true): void {
    this.db.prepare(`UPDATE users SET password_hash = ?, totp_secret_encrypted = ?, totp_enabled = ?,
      totp_pending_secret_encrypted = NULL, totp_pending_expires_at = NULL, bootstrap_pending = 0,
      updated_at = ? WHERE id = ?`)
      .run(passwordHash, totpSecretEncrypted, totpEnabled ? 1 : 0, Date.now(), id);
  }

  updateCredentials(id: string, username: string, passwordHash: string): void {
    this.db.prepare("UPDATE users SET username = ?, password_hash = ?, bootstrap_pending = 0, updated_at = ? WHERE id = ?")
      .run(username, passwordHash, Date.now(), id);
  }

  setPendingTotp(id: string, encryptedSecret: string, expiresAt: number): void {
    this.db.prepare(`UPDATE users SET totp_pending_secret_encrypted = ?, totp_pending_expires_at = ?,
      updated_at = ? WHERE id = ?`).run(encryptedSecret, expiresAt, Date.now(), id);
  }

  enablePendingTotp(id: string): void {
    this.db.prepare(`UPDATE users SET totp_secret_encrypted = totp_pending_secret_encrypted,
      totp_enabled = 1, totp_pending_secret_encrypted = NULL, totp_pending_expires_at = NULL,
      updated_at = ? WHERE id = ? AND totp_pending_secret_encrypted IS NOT NULL`)
      .run(Date.now(), id);
  }

  disableTotp(id: string): void {
    this.db.prepare(`UPDATE users SET totp_enabled = 0, totp_secret_encrypted = '',
      totp_pending_secret_encrypted = NULL, totp_pending_expires_at = NULL, updated_at = ? WHERE id = ?`)
      .run(Date.now(), id);
  }

  createSession(session: SessionRow): void {
    this.db.prepare(`INSERT INTO sessions
      (id, user_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at,
       client_type, revoked_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .run(session.id, session.user_id, session.access_hash, session.access_expires_at,
        session.refresh_hash, session.refresh_expires_at, session.client_type,
        session.created_at, session.updated_at);
  }

  getSessionByAccessHash(hash: string): SessionRow | undefined {
    return rowAs<SessionRow>(this.db.prepare("SELECT * FROM sessions WHERE access_hash = ?").get(hash));
  }

  getSessionByRefreshHash(hash: string): SessionRow | undefined {
    return rowAs<SessionRow>(this.db.prepare("SELECT * FROM sessions WHERE refresh_hash = ?").get(hash));
  }

  rotateSession(id: string, accessHash: string, accessExpiresAt: number, refreshHash: string, refreshExpiresAt: number): void {
    this.db.prepare(`UPDATE sessions SET access_hash = ?, access_expires_at = ?,
      refresh_hash = ?, refresh_expires_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL`)
      .run(accessHash, accessExpiresAt, refreshHash, refreshExpiresAt, Date.now(), id);
  }

  revokeSession(id: string): void {
    this.db.prepare("UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(Date.now(), Date.now(), id);
  }

  revokeAllSessions(userId: string, exceptSessionId?: string): void {
    const now = Date.now();
    if (exceptSessionId) {
      this.db.prepare("UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL")
        .run(now, now, userId, exceptSessionId);
    } else {
      this.db.prepare("UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE user_id = ? AND revoked_at IS NULL")
        .run(now, now, userId);
    }
  }

  deleteExpiredSessions(now = Date.now()): void {
    this.db.prepare("DELETE FROM sessions WHERE refresh_expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)")
      .run(now, now - 30 * 24 * 60 * 60 * 1000);
  }

  createDevice(device: DeviceRow): void {
    this.db.prepare(`INSERT INTO devices
      (id, user_id, name, public_key, revoked_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?, ?)`)
      .run(device.id, device.user_id, device.name, device.public_key, device.created_at, device.updated_at);
  }

  getDevice(id: string): DeviceRow | undefined {
    return rowAs<DeviceRow>(this.db.prepare("SELECT * FROM devices WHERE id = ?").get(id));
  }

  listDevices(userId: string): DeviceRow[] {
    return this.db.prepare("SELECT * FROM devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at")
      .all(userId) as unknown as DeviceRow[];
  }

  renameDevice(id: string, userId: string, name: string): boolean {
    const result = this.db.prepare("UPDATE devices SET name = ?, updated_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
      .run(name, Date.now(), id, userId);
    return result.changes > 0;
  }

  revokeDevice(id: string, userId: string): boolean {
    const result = this.db.prepare("UPDATE devices SET revoked_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
      .run(Date.now(), Date.now(), id, userId);
    return result.changes > 0;
  }
}
