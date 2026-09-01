import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { AppDatabase } from "./database.js";

test("creates only user, session, and device domain tables", () => {
  const database = new AppDatabase(":memory:");
  try {
    const rows = database.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as unknown as Array<{ name: string }>;
    const names = rows.map((row) => row.name).filter((name) => !name.startsWith("sqlite_"));
    assert.deepEqual(names, ["devices", "sessions", "users"]);
  } finally {
    database.close();
  }
});

test("migrates an existing TOTP account without changing its enabled state", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "voice-relay-migration-"));
  const filename = path.join(directory, "legacy.db");
  const legacy = new DatabaseSync(filename);
  legacy.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
    totp_secret_encrypted TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  ); INSERT INTO users VALUES ('user-1', 'legacy', 'hash', 'encrypted', 1, 1);`);
  legacy.close();
  const database = new AppDatabase(filename);
  try {
    const user = database.getUserById("user-1");
    assert.equal(user?.totp_enabled, 1);
    assert.equal(user?.bootstrap_pending, 0);
    assert.equal(user?.totp_secret_encrypted, "encrypted");
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
