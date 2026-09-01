import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type { AppDatabase } from "./database.js";
import { hashPassword } from "./security.js";

const CREDENTIAL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export interface MasterKeyResult {
  bytes: Buffer;
  path: string;
  created: boolean;
}

export interface BootstrapCredentials {
  username: string;
  password: string;
  file: string;
}

export function migrateLegacyDatabase(databasePath: string, legacyDirectory?: string): boolean {
  if (!legacyDirectory || fs.existsSync(databasePath)) return false;
  const legacyDatabase = path.join(legacyDirectory, path.basename(databasePath));
  if (!fs.existsSync(legacyDatabase) || fs.statSync(legacyDatabase).size === 0) return false;
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    const source = `${legacyDatabase}${suffix}`;
    if (fs.existsSync(source)) fs.copyFileSync(source, `${databasePath}${suffix}`, fs.constants.COPYFILE_EXCL);
  }
  return true;
}

function decodeMasterKey(value: string): Buffer {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) throw new Error("The server master key is not valid base64");
  const bytes = Buffer.from(trimmed, "base64");
  if (bytes.length !== 32) throw new Error("The server master key must contain exactly 32 bytes");
  return bytes;
}

function writePrivateFile(filename: string, value: string): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, filename);
    fs.chmodSync(filename, 0o600);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function loadOrCreateMasterKey(databasePath: string, legacyKey?: string): MasterKeyResult {
  const dataDirectory = path.dirname(databasePath);
  const masterKeyPath = path.join(dataDirectory, "master.key");
  fs.mkdirSync(dataDirectory, { recursive: true });

  if (fs.existsSync(masterKeyPath)) {
    const bytes = decodeMasterKey(fs.readFileSync(masterKeyPath, "utf8"));
    if (legacyKey && !bytes.equals(decodeMasterKey(legacyKey))) {
      throw new Error("MASTER_KEY does not match the persistent /data/master.key");
    }
    return { bytes, path: masterKeyPath, created: false };
  }

  if (legacyKey) {
    const bytes = decodeMasterKey(legacyKey);
    writePrivateFile(masterKeyPath, `${bytes.toString("base64")}\n`);
    return { bytes, path: masterKeyPath, created: true };
  }

  const databaseAlreadyExists = fs.existsSync(databasePath) && fs.statSync(databasePath).size > 0;
  if (databaseAlreadyExists) {
    throw new Error(`Existing database ${databasePath} has no master.key. Restore the original key or start once with the old MASTER_KEY value.`);
  }

  const bytes = randomBytes(32);
  writePrivateFile(masterKeyPath, `${bytes.toString("base64")}\n`);
  return { bytes, path: masterKeyPath, created: true };
}

export function generateRandomCredential(length = 8): string {
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += CREDENTIAL_ALPHABET[randomInt(CREDENTIAL_ALPHABET.length)];
  }
  return result;
}

export async function ensureBootstrapAccount(db: AppDatabase, dataDirectory: string): Promise<BootstrapCredentials | undefined> {
  if (db.countUsers() > 0) return undefined;
  const username = generateRandomCredential();
  const password = generateRandomCredential();
  const credentialsFile = path.join(dataDirectory, "initial-credentials.txt");
  writePrivateFile(credentialsFile, `username=${username}\npassword=${password}\n`);
  const now = Date.now();
  db.createUser({
    id: randomUUID(), username, password_hash: await hashPassword(password), totp_secret_encrypted: "",
    totp_enabled: 0, totp_pending_secret_encrypted: null, totp_pending_expires_at: null,
    bootstrap_pending: 1, created_at: now, updated_at: now,
  });
  return { username, password, file: credentialsFile };
}

export function removeCredentialArtifacts(dataDirectory: string): void {
  for (const filename of ["initial-credentials.txt", "reset-credentials.txt"]) {
    const target = path.join(dataDirectory, filename);
    try { if (fs.existsSync(target)) fs.unlinkSync(target); } catch { /* Retry on the next credential change. */ }
  }
}

export function writeResetCredentials(dataDirectory: string, username: string, password: string): string {
  const filename = path.join(dataDirectory, "reset-credentials.txt");
  writePrivateFile(filename, `username=${username}\npassword=${password}\n`);
  return filename;
}
