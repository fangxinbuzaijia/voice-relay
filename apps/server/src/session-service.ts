import { randomUUID } from "node:crypto";
import type { ClientType } from "@voice-relay/protocol";
import type { AppDatabase, SessionRow } from "./database.js";
import { generateToken, hashToken } from "./security.js";

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface IssuedSession {
  sessionId: string;
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
  clientType: ClientType;
}

function tokensFor(sessionId: string, userId: string, clientType: ClientType, now: number): { row: SessionRow; issued: IssuedSession } {
  const accessToken = generateToken();
  const refreshToken = generateToken();
  const accessExpiresAt = now + ACCESS_TTL_MS;
  const refreshExpiresAt = now + REFRESH_TTL_MS;
  return {
    row: {
      id: sessionId,
      user_id: userId,
      access_hash: hashToken(accessToken),
      access_expires_at: accessExpiresAt,
      refresh_hash: hashToken(refreshToken),
      refresh_expires_at: refreshExpiresAt,
      client_type: clientType,
      revoked_at: null,
      created_at: now,
      updated_at: now,
    },
    issued: { sessionId, accessToken, accessExpiresAt, refreshToken, refreshExpiresAt, clientType },
  };
}

export function issueSession(db: AppDatabase, userId: string, clientType: ClientType): IssuedSession {
  const now = Date.now();
  const pair = tokensFor(randomUUID(), userId, clientType, now);
  db.createSession(pair.row);
  return pair.issued;
}

export function rotateSession(db: AppDatabase, refreshToken: string): IssuedSession | undefined {
  const existing = db.getSessionByRefreshHash(hashToken(refreshToken));
  const now = Date.now();
  if (!existing || existing.revoked_at !== null || existing.refresh_expires_at <= now) return undefined;
  const pair = tokensFor(existing.id, existing.user_id, existing.client_type, now);
  db.rotateSession(existing.id, pair.row.access_hash, pair.row.access_expires_at, pair.row.refresh_hash, pair.row.refresh_expires_at);
  return pair.issued;
}

export function authenticateAccess(db: AppDatabase, accessToken: string): SessionRow | undefined {
  const session = db.getSessionByAccessHash(hashToken(accessToken));
  if (!session || session.revoked_at !== null || session.access_expires_at <= Date.now()) return undefined;
  return session;
}

