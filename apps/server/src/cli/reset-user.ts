import qrcode from "qrcode-terminal";
import { generateRandomCredential, removeCredentialArtifacts, writeResetCredentials } from "../bootstrap.js";
import { loadConfig } from "../config.js";
import { AppDatabase } from "../database.js";
import { buildTotpUri, encryptTotpSecret, generateTotpSecret, hashPassword } from "../security.js";
import { promptHidden, promptText } from "./prompt.js";

const config = loadConfig();
const db = new AppDatabase(config.DB_PATH);
try {
  const user = db.getSingleUser();
  if (!user) throw new Error("Account not found");

  const credentialMode = (await promptText("Credentials [random/manual]: ")).toLowerCase();
  if (credentialMode !== "random" && credentialMode !== "manual") throw new Error("Invalid credential mode");

  let username: string;
  let password: string;
  if (credentialMode === "random") {
    username = generateRandomCredential();
    password = generateRandomCredential();
  } else {
    username = await promptText("New username: ");
    if (!username || username.length > 64) throw new Error("Username must contain 1-64 characters");
    password = await promptHidden("New password (minimum 8 characters): ");
    const confirmation = await promptHidden("Confirm password: ");
    if (password !== confirmation) throw new Error("Passwords do not match");
  }
  const passwordHash = await hashPassword(password);

  const totpMode = (await promptText("TOTP [keep/disable/regenerate]: ")).toLowerCase();
  if (!new Set(["keep", "disable", "regenerate"]).has(totpMode)) throw new Error("Invalid TOTP mode");

  db.updateCredentials(user.id, username, passwordHash);
  if (totpMode === "disable") {
    db.disableTotp(user.id);
  } else if (totpMode === "regenerate") {
    const secret = generateTotpSecret();
    db.updateUserSecurity(user.id, passwordHash, encryptTotpSecret(secret, config.masterKeyBytes), true);
    const uri = buildTotpUri(username, secret);
    console.log("\nScan this replacement TOTP QR code and store the text secret offline:");
    qrcode.generate(uri, { small: true });
    console.log(`Secret: ${secret}`);
  }

  db.revokeAllSessions(user.id);
  removeCredentialArtifacts(config.dataDirectory);
  if (credentialMode === "random") {
    const filename = writeResetCredentials(config.dataDirectory, username, password);
    console.log(`\nUsername: ${username}`);
    console.log(`Password: ${password}`);
    console.log(`Saved to: ${filename}`);
  }
  console.log("Account recovery completed. All sessions were revoked.");
} finally {
  db.close();
}
