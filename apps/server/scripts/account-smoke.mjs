import fs from "node:fs";
import path from "node:path";
import * as OTPAuth from "otpauth";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://127.0.0.1:3199";
const dataDirectory = process.env.SMOKE_DATA_DIR;
if (!dataDirectory) throw new Error("SMOKE_DATA_DIR is required");

const credentialFile = path.join(dataDirectory, "initial-credentials.txt");
const credentials = Object.fromEntries(fs.readFileSync(credentialFile, "utf8").trim().split("\n").map((line) => line.split("=")));

async function request(route, init = {}, expected = 200) {
  const response = await fetch(`${baseUrl}${route}`, init);
  const body = response.status === 204 ? undefined : await response.json();
  if (response.status !== expected) throw new Error(`${route}: expected ${expected}, received ${response.status} ${JSON.stringify(body)}`);
  return body;
}

const login = await request("/api/v1/auth/login", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: credentials.username, password: credentials.password, clientType: "web" }),
});
if (!login.user.bootstrapPending || login.user.totpEnabled) throw new Error("Unexpected bootstrap account state");
const authorization = { authorization: `Bearer ${login.accessToken}`, "content-type": "application/json" };

const setup = await request("/api/v1/account/totp/setup", {
  method: "POST", headers: authorization, body: JSON.stringify({ currentPassword: credentials.password }),
});
if (!setup.otpauthUri.startsWith("otpauth://totp/") || !setup.otpauthUri.includes("algorithm=SHA1")) throw new Error("Invalid TOTP URI");
const generator = new OTPAuth.TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(setup.secret) });
await request("/api/v1/account/totp/confirm", {
  method: "POST", headers: authorization, body: JSON.stringify({ code: generator.generate() }),
});

await request("/api/v1/account/credentials", {
  method: "PATCH", headers: authorization,
  body: JSON.stringify({ currentPassword: credentials.password, newUsername: "smoke-user", newPassword: "smoke-pass-123", totp: generator.generate() }),
});
if (fs.existsSync(credentialFile)) throw new Error("Initial credential file was not removed");

const missingTotp = await request("/api/v1/auth/login", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "smoke-user", password: "smoke-pass-123", clientType: "web" }),
}, 401);
if (missingTotp.error !== "totp_required") throw new Error("Missing TOTP was not reported distinctly");
await request("/api/v1/auth/login", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "smoke-user", password: "smoke-pass-123", totp: generator.generate(), clientType: "web" }),
});

console.log("Account bootstrap and optional-TOTP smoke flow passed.");
