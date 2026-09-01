import { randomUUID } from "node:crypto";
import qrcode from "qrcode-terminal";
import { loadConfig } from "../config.js";
import { AppDatabase } from "../database.js";
import { buildTotpUri, encryptTotpSecret, generateTotpSecret, hashPassword } from "../security.js";
import { promptHidden, promptText } from "./prompt.js";

const config = loadConfig();
const db = new AppDatabase(config.DB_PATH);
try {
  if (db.countUsers() > 0) throw new Error("The single account already exists; use user:reset instead");
  const username = await promptText("Username: ");
  if (!username || username.length > 64) throw new Error("Username must contain 1-64 characters");
  const password = await promptHidden("Password (minimum 8 characters): ");
  const confirmation = await promptHidden("Confirm password: ");
  if (password !== confirmation) throw new Error("Passwords do not match");
  const secret = generateTotpSecret();
  const uri = buildTotpUri(username, secret);
  const now = Date.now();
  db.createUser({
    id: randomUUID(),
    username,
    password_hash: await hashPassword(password),
    totp_secret_encrypted: encryptTotpSecret(secret, config.masterKeyBytes),
    totp_enabled: 1,
    totp_pending_secret_encrypted: null,
    totp_pending_expires_at: null,
    bootstrap_pending: 0,
    created_at: now,
    updated_at: now,
  });
  console.log("\nScan this TOTP QR code and store the text secret offline:");
  qrcode.generate(uri, { small: true });
  console.log(`Secret: ${secret}`);
} finally {
  db.close();
}
