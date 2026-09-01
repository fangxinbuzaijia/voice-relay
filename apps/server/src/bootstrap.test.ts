import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AppDatabase } from "./database.js";
import { ensureBootstrapAccount, generateRandomCredential, loadOrCreateMasterKey, migrateLegacyDatabase } from "./bootstrap.js";

function temporaryDirectory(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "voice-relay-bootstrap-"));
}

test("generates exact alphanumeric credentials", () => {
  for (let index = 0; index < 100; index += 1) assert.match(generateRandomCredential(), /^[A-Za-z0-9]{8}$/);
});

test("persists and reuses a generated master key", () => {
  const directory = temporaryDirectory();
  try {
    const databasePath = path.join(directory, "voice-relay.db");
    const first = loadOrCreateMasterKey(databasePath);
    const second = loadOrCreateMasterKey(databasePath);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.deepEqual(first.bytes, second.bytes);
    assert.equal(fs.readFileSync(path.join(directory, "master.key"), "utf8").trim(), first.bytes.toString("base64"));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("migrates a legacy environment key and refuses an existing database without one", () => {
  const migrationDirectory = temporaryDirectory();
  const brokenDirectory = temporaryDirectory();
  try {
    const legacy = Buffer.alloc(32, 9).toString("base64");
    const migrated = loadOrCreateMasterKey(path.join(migrationDirectory, "voice-relay.db"), legacy);
    assert.deepEqual(migrated.bytes, Buffer.alloc(32, 9));
    fs.writeFileSync(path.join(brokenDirectory, "voice-relay.db"), "existing");
    assert.throws(() => loadOrCreateMasterKey(path.join(brokenDirectory, "voice-relay.db")), /has no master\.key/);
  } finally {
    fs.rmSync(migrationDirectory, { recursive: true, force: true });
    fs.rmSync(brokenDirectory, { recursive: true, force: true });
  }
});

test("copies the previous Compose volume database into the bind-mounted data directory once", () => {
  const directory = temporaryDirectory();
  try {
    const legacy = path.join(directory, "legacy");
    const current = path.join(directory, "current");
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, "voice-relay.db"), "legacy-database");
    assert.equal(migrateLegacyDatabase(path.join(current, "voice-relay.db"), legacy), true);
    assert.equal(fs.readFileSync(path.join(current, "voice-relay.db"), "utf8"), "legacy-database");
    assert.equal(migrateLegacyDatabase(path.join(current, "voice-relay.db"), legacy), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("creates the disabled-TOTP bootstrap account only once", async () => {
  const directory = temporaryDirectory();
  const db = new AppDatabase(path.join(directory, "voice-relay.db"));
  try {
    const created = await ensureBootstrapAccount(db, directory);
    assert.ok(created);
    assert.match(created.username, /^[A-Za-z0-9]{8}$/);
    assert.match(created.password, /^[A-Za-z0-9]{8}$/);
    assert.equal(db.getSingleUser()?.totp_enabled, 0);
    assert.equal(db.getSingleUser()?.bootstrap_pending, 1);
    assert.equal(await ensureBootstrapAccount(db, directory), undefined);
    assert.match(fs.readFileSync(created.file, "utf8"), /^username=[A-Za-z0-9]{8}\npassword=[A-Za-z0-9]{8}\n$/);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
